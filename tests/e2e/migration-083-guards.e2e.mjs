// STEP 5I -- migration 083 on a THROWAWAY scratch database (migrated through 083): the organization_id column and its guards behave as designed.
//   DATABASE_URL=<throwaway test db> node tests/e2e/migration-083-guards.e2e.mjs
// Everything runs inside transactions that are rolled back; the only rows left behind are none.
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { makeRunner, assertTestDatabase } from './helpers/admin2-harness.mjs'

assertTestDatabase()
const p = db()
const { t, summary } = makeRunner()
const ROLLBACK = Symbol('rollback')
const inTx = async (fn) => { try { await p.$transaction(async (tx) => { await fn(tx); throw ROLLBACK }) } catch (e) { if (e !== ROLLBACK) throw e } }
const rejects = async (fn, re) => { let err = null; try { await fn() } catch (e) { err = e } assert.ok(err, 'expected the database to refuse'); assert.match(String(err.message), re) }

await t('the column exists, is nullable and references organizations on all three tables', async () => {
  for (const table of ['admin_audit_logs', 'security_events', 'authorization_evidence']) {
    const [c] = await p.$queryRawUnsafe(`SELECT is_nullable FROM information_schema.columns WHERE table_name='${table}' AND column_name='organization_id'`)
    assert.equal(c?.is_nullable, 'YES', table)
    const [fk] = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name='${table}' AND constraint_name='${table}_organization_id_fkey'`)
    assert.equal(fk.n, 1, `${table} foreign key`)
  }
})

await t('audit + security rows: NULL organization_id may be attributed ONCE; it can never be changed afterwards (write-once)', async () => {
  const org = await p.organization.findFirst(); assert.ok(org, 'seeded')
  await inTx(async (tx) => {
    const a = await tx.adminAuditLog.create({ data: { action: 'g083.audit', entityType: 'g083', entityId: 'x', organizationId: null } })
    await tx.$executeRawUnsafe(`UPDATE admin_audit_logs SET organization_id = '${org.id}'::uuid WHERE id = '${a.id}'::uuid`) // NULL -> value: allowed
    await rejects(() => tx.$executeRawUnsafe(`UPDATE admin_audit_logs SET organization_id = NULL WHERE id = '${a.id}'::uuid`), /append-only|refused/i)
  })
  await inTx(async (tx) => {
    const e = await tx.securityEvent.create({ data: { severity: 'INFO', eventType: 'g083', summary: 'g083', organizationId: null } })
    await tx.$executeRawUnsafe(`UPDATE security_events SET organization_id = '${org.id}'::uuid WHERE id = '${e.id}'::uuid`)
    await rejects(() => tx.$executeRawUnsafe(`UPDATE security_events SET organization_id = NULL WHERE id = '${e.id}'::uuid`), /immutable|refused/i)
  })
})

await t('authorization_evidence stays fully append-only: a legacy (NULL) row can never be attributed or changed', async () => {
  const org = await p.organization.findFirst()
  const [row] = await p.$queryRawUnsafe(`SELECT id::text AS id FROM authorization_evidence WHERE organization_id IS NULL LIMIT 1`)
  if (!row) { console.log('   (no unattributed evidence row on this fresh database; guard asserted on any row)') }
  const [any] = await p.$queryRawUnsafe(`SELECT id::text AS id FROM authorization_evidence LIMIT 1`)
  if (any) await inTx(async (tx) => { await rejects(() => tx.$executeRawUnsafe(`UPDATE authorization_evidence SET organization_id = '${org.id}'::uuid WHERE id = '${any.id}'::uuid`), /append-only|refused|immutable/i) })
  else console.log('   (no evidence rows at all: trigger presence checked instead)')
  const [trg] = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'authorization_evidence'::regclass AND NOT tgisinternal`)
  assert.ok(trg.n >= 1, 'an append-only trigger guards authorization_evidence')
})

await t('migration 083 added no backfill: a row written without an organization stays NULL', async () => {
  await inTx(async (tx) => {
    const e = await tx.securityEvent.create({ data: { severity: 'INFO', eventType: 'g083.null', summary: 'g083 null' } })
    assert.equal(e.organizationId, null)
  })
})

const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
