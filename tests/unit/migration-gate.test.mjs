// STEP 5E -- the migration approval gate blocks a gated migration before any schema change unless approved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pendingGatedMigrations, bannerFor, unreviewedBanner, reviewedChainLabel, runGate, GATED_MIGRATIONS } from '../../server/lib/migration-gate.mjs'

const G = '082_security_foundation_closure'
const L = '083_security_record_organization_boundary' // the latest reviewed migration
const dir = (names) => { const d = mkdtempSync(join(tmpdir(), 'mig-')); for (const n of names) mkdirSync(join(d, n)); return d }
const fakePrisma = ({ table = '_prisma_migrations', applied = [], fail = false } = {}) => () => {
  let calls = 0
  return {
    $queryRaw: async () => { calls += 1; if (fail) throw new Error('connect ECONNREFUSED'); return calls === 1 ? [{ t: table }] : applied.map((migration_name) => ({ migration_name })) },
    $disconnect: async () => {},
  }
}
const quiet = () => { const out = []; return { out, log: { log: (m) => out.push(m), error: (m) => out.push(m) } } }

test('every Step 5 migration (078..083) is gated', () => {
  for (const n of ['078_admin_foundation', '079_admin_modules', '080_session_mfa_method', '081_security_reconciliation', G, L]) assert.ok(Object.hasOwn(GATED_MIGRATIONS, n), n)
  assert.equal(Object.hasOwn(GATED_MIGRATIONS, '077_driver_base'), false)
})

test('approving 082 approves the earlier pending gated migrations too, but approving only 078 does not approve 082', () => {
  const names = ['077_driver_base', '078_admin_foundation', '079_admin_modules', '080_session_mfa_method', '081_security_reconciliation', G]
  const all = pendingGatedMigrations({ dirNames: names, appliedNames: ['077_driver_base'], approved: G })
  assert.deepEqual(all.blocked, []); assert.equal(all.pending.length, 5)
  const partial = pendingGatedMigrations({ dirNames: names, appliedNames: ['077_driver_base'], approved: '078_admin_foundation' })
  assert.deepEqual(partial.blocked, names.slice(2))
  assert.equal(pendingGatedMigrations({ dirNames: names, appliedNames: ['077_driver_base'], approved: '077_driver_base' }).blocked.length, 5, 'an ungated name approves nothing')
})

test('pending gated migration without approval is blocked; with approval, or already applied, it is not', () => {
  const names = ['081_security_reconciliation', G]
  assert.deepEqual(pendingGatedMigrations({ dirNames: names, appliedNames: ['081_security_reconciliation'], approved: '' }).blocked, [G])
  assert.deepEqual(pendingGatedMigrations({ dirNames: names, appliedNames: ['081_security_reconciliation'], approved: 'something-else' }).blocked, [G])
  const ok = pendingGatedMigrations({ dirNames: names, appliedNames: ['081_security_reconciliation'], approved: ` ${G} ` })
  assert.deepEqual(ok.blocked, []); assert.deepEqual(ok.pending, [G])
  assert.deepEqual(pendingGatedMigrations({ dirNames: names, appliedNames: names, approved: '' }), { pending: [], blocked: [], unreviewed: [] })
  assert.deepEqual(pendingGatedMigrations({ dirNames: ['001_x', '002_y'], appliedNames: [], approved: '' }).blocked, [], 'ungated migrations never block')
})

test('the banner names the migration, the consequence and the approval variable', () => {
  const b = bannerFor([G])
  assert.match(b, /WILL apply it/); assert.match(b, /every earlier gated/); assert.match(b, /APPROVED_MIGRATIONS=082_security_foundation_closure/); assert.match(b, /recovery point/)
  // the banner for the whole pending chain names the LATEST reviewed migration (083), never the stale 082 example
  const chain = bannerFor([G, L])
  assert.match(chain, /APPROVED_MIGRATIONS=083_security_record_organization_boundary/); assert.doesNotMatch(chain, /APPROVED_MIGRATIONS=082/)
})

test('runGate: blocks (ok=false) when 082 is pending and unapproved, passes when approved or applied', async () => {
  const d = dir(['081_security_reconciliation', G])
  const q = quiet()
  const blocked = await runGate({ env: {}, migrationsDir: d, prismaFactory: fakePrisma({ applied: ['081_security_reconciliation'] }), log: q.log })
  assert.equal(blocked.ok, false); assert.match(q.out.join('\n'), /MIGRATION APPROVAL REQUIRED/)
  const approved = await runGate({ env: { APPROVED_MIGRATIONS: G }, migrationsDir: d, prismaFactory: fakePrisma({ applied: ['081_security_reconciliation'] }), log: quiet().log })
  assert.equal(approved.ok, true)
  const applied = await runGate({ env: {}, migrationsDir: d, prismaFactory: fakePrisma({ applied: ['081_security_reconciliation', G] }), log: quiet().log })
  assert.equal(applied.ok, true); assert.deepEqual(applied.pending, [])
  const fresh = await runGate({ env: {}, migrationsDir: d, prismaFactory: fakePrisma({ table: null }), log: quiet().log })
  assert.equal(fresh.ok, false, 'a brand-new database also needs the approval')
})

test('runGate fails closed when the migration history cannot be read', async () => {
  const q = quiet()
  const r = await runGate({ env: { APPROVED_MIGRATIONS: G }, migrationsDir: dir([G]), prismaFactory: fakePrisma({ fail: true }), log: q.log })
  assert.equal(r.ok, false); assert.equal(r.error, true)
})

test('the gate is wired into BOTH deploy paths and the Docker image can run it', () => {
  const root = join(import.meta.dirname, '..', '..')
  assert.match(readFileSync(join(root, 'render.yaml'), 'utf8'), /preDeployCommand: "node server\/lib\/migration-gate\.mjs && npx prisma migrate deploy"/)
  assert.match(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['start:render'], /^node server\/lib\/migration-gate\.mjs && prisma migrate deploy/)
  assert.match(readFileSync(join(root, 'Dockerfile'), 'utf8'), /COPY --from=build \/app\/server \.\/server/, 'the gate lives under server/, which the image copies')
})

test('an approval for the reviewed chain never authorizes an unrelated pending migration', async () => {
  const chain = ['077_driver_base', '078_admin_foundation', '079_admin_modules', '080_session_mfa_method', '081_security_reconciliation', G, L]
  const withFuture = [...chain, '084_something_new']
  const r = pendingGatedMigrations({ dirNames: withFuture, appliedNames: ['077_driver_base'], approved: L })
  assert.deepEqual(r.blocked, []); assert.deepEqual(r.unreviewed, ['084_something_new'])
  const q = quiet()
  const gate = await runGate({ env: { APPROVED_MIGRATIONS: L }, migrationsDir: dir(withFuture), prismaFactory: fakePrisma({ applied: ['077_driver_base'] }), log: q.log })
  assert.equal(gate.ok, false); assert.match(q.out.join('\n'), /UNREVIEWED MIGRATIONS PENDING/); assert.match(q.out.join('\n'), /084_something_new/)
  assert.match(q.out.join('\n'), /reviewed Step 5 chain \(078-083\)/, 'the banner names the real reviewed chain')
  // once the chain is applied, a later migration is not the gate's business
  assert.equal((await runGate({ env: {}, migrationsDir: dir(withFuture), prismaFactory: fakePrisma({ applied: chain }), log: quiet().log })).ok, true)
  // exactly the reviewed chain pending + approval of the LATEST migration => allowed
  assert.equal((await runGate({ env: { APPROVED_MIGRATIONS: L }, migrationsDir: dir(chain), prismaFactory: fakePrisma({ applied: ['077_driver_base'] }), log: quiet().log })).ok, true)
})

test('APPROVED_MIGRATIONS=082 does NOT approve 083; =083 approves the reviewed 078-083 chain and nothing else', async () => {
  const chain = ['077_driver_base', '078_admin_foundation', '079_admin_modules', '080_session_mfa_method', '081_security_reconciliation', G, L]
  const stale = pendingGatedMigrations({ dirNames: chain, appliedNames: ['077_driver_base'], approved: G })
  assert.deepEqual(stale.blocked, [L], '082 approves 078-082 only')
  const q = quiet()
  const blocked = await runGate({ env: { APPROVED_MIGRATIONS: G }, migrationsDir: dir(chain), prismaFactory: fakePrisma({ applied: ['077_driver_base'] }), log: q.log })
  assert.equal(blocked.ok, false); assert.deepEqual(blocked.blocked, [L])
  assert.match(q.out.join('\n'), /APPROVED_MIGRATIONS=083_security_record_organization_boundary/, 'the operator is told to approve 083')
  const full = pendingGatedMigrations({ dirNames: chain, appliedNames: ['077_driver_base'], approved: L })
  assert.deepEqual(full.blocked, []); assert.equal(full.pending.length, 6)
  // 083 alone pending (078-082 already applied) is still gated
  assert.deepEqual(pendingGatedMigrations({ dirNames: chain, appliedNames: chain.slice(0, 6), approved: '' }).blocked, [L])
})

test('operator-facing wording is derived from the gated list and carries no stale 082 chain', () => {
  assert.equal(reviewedChainLabel(), '078-083')
  assert.equal(reviewedChainLabel({ '078_a': 'x', '084_b': 'y' }), '078-084', 'grows with the list')
  assert.match(unreviewedBanner(['084_x']), /\(078-083\)/)
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'server', 'lib', 'migration-gate.mjs'), 'utf8')
  assert.doesNotMatch(src, /078.082|APPROVED_MIGRATIONS=082/, 'no stale chain or 082 approval example in the operator-facing text')
  assert.match(src, /APPROVED_MIGRATIONS=083_security_record_organization_boundary/)
  const render = readFileSync(join(import.meta.dirname, '..', '..', 'render.yaml'), 'utf8')
  assert.doesNotMatch(render, /APPROVED_MIGRATIONS=082/)
})
