// STEP 5H -- organization boundary for security events, audit log and authorization evidence, over REAL HTTP
// against a real database: two organizations, one OWNER in each, plus rows of A, of B and an UNATTRIBUTED row.
// A user of organization A must not list, read, review, export or verify organization B's records (and the other way
// round) while keeping valid access to its own; unattributed rows are visible to nobody.
//
//   DATABASE_URL=<THROWAWAY TEST db, migrated through 083 and seeded> node tests/e2e/admin2-org-boundary.e2e.mjs
//
// NOTE: this creates a second ORGANIZATION that cannot be deleted afterwards (audit rows reference it with
// ON DELETE RESTRICT and are append-only). Run it only on a throwaway database.
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID, assertTestDatabase } from './helpers/admin2-harness.mjs'

assertTestDatabase()
const run = randomUUID().slice(0, 8)
const p = db()
const { t, summary } = makeRunner()

// Organization A is simply the seeded organization; no admin2 module treats any organization as "the" organization any more (STEP 5I).
const orgA = await p.organization.findFirst({ orderBy: { createdAt: 'asc' } })
assert.ok(orgA, 'the test database must be seeded (node scripts/admin-foundation-seed.mjs)')
// Organization B is created BEFORE the API starts so the API's registry sees it.
const orgB = await p.organization.create({ data: { code: `E2E-B-${run}`, name: `E2E organization B ${run}` } })
const A = orgA.id; const B = orgB.id

const mkOwner = async (label, organizationId) => {
  const u = await createStaffUser(label, run)
  await assignRole(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId }])
  return u
}
const ownerA = await mkOwner('ownera', A)
const ownerB = await mkOwner('ownerb', B)
const nobody = await createStaffUser('nobody', run) // no assignment at all

const tag = (kind) => `e2e.org.${run}.${kind}`
const mkEvent = (organizationId, kind) => p.securityEvent.create({ data: { severity: 'WARNING', eventType: 'e2e.org_boundary', summary: tag(kind), organizationId } })
const mkAudit = (organizationId, kind) => p.adminAuditLog.create({ data: { actorUserId: ownerA.id, action: tag(kind), entityType: 'e2e_probe', entityId: `${run}-${kind}`, reason: 'organization boundary e2e', organizationId, correlationId: `${run}-corr` } })

const evA = await mkEvent(A, 'A'); const evB = await mkEvent(B, 'B'); const evX = await mkEvent(null, 'legacy')
const auA = await mkAudit(A, 'A'); const auB = await mkAudit(B, 'B'); const auX = await mkAudit(null, 'legacy')

const api = await startApi()
const sA = await loginAsStaff(api, ownerA)
const sB = await loginAsStaff(api, ownerB)
const sN = await loginAsStaff(api, nobody)
const base = '/api/admin2'
const summaries = (res) => (res.json?.items ?? []).map((x) => x.summary)
const actions = (res) => (res.json?.items ?? []).map((x) => x.action)

await t('security events: A lists only A, B lists only B, the unattributed event is visible to nobody', async () => {
  const a = await sA.http.get(`${base}/security/events?pageSize=100`)
  const b = await sB.http.get(`${base}/security/events?pageSize=100`)
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.ok(a.json.items.every((e) => e.organizationId === A), 'every event A sees belongs to A')
  assert.ok(b.json.items.every((e) => e.organizationId === B), 'every event B sees belongs to B')
  assert.ok(summaries(a).includes(tag('A')), 'A keeps valid access to its own event')
  assert.ok(summaries(b).includes(tag('B')), 'B keeps valid access to its own event')
  for (const list of [summaries(a), summaries(b)]) assert.ok(!list.includes(tag('legacy')), 'unattributed fails closed')
  assert.ok(!summaries(a).includes(tag('B')) && !summaries(b).includes(tag('A')))
})

await t('an organization named in the query or a header is ignored (it can neither widen nor switch)', async () => {
  const q = await sA.http.get(`${base}/security/events?pageSize=100&organizationId=${B}`)
  assert.ok(q.json.items.every((e) => e.organizationId === A))
  const h = await sA.http.call('GET', `${base}/security/events?pageSize=100`, undefined, { 'x-organization-id': B })
  assert.ok(h.json.items.every((e) => e.organizationId === A))
})

await t('security event by id: own is readable, the other organization\'s and the unattributed one are a plain 404', async () => {
  assert.equal((await sA.http.get(`${base}/security/events/${evA.id}`)).status, 200)
  assert.equal((await sB.http.get(`${base}/security/events/${evB.id}`)).status, 200)
  for (const [s, id] of [[sA, evB.id], [sB, evA.id], [sA, evX.id], [sB, evX.id]]) assert.equal((await s.http.get(`${base}/security/events/${id}`)).status, 404)
})

await t('review: A cannot review B\'s event (404, nothing changes); A can review its own', async () => {
  const note = 'reviewed by the organization boundary e2e'
  const cross = await sA.http.post(`${base}/security/events/${evB.id}/review`, { note })
  assert.equal(cross.status, 404)
  assert.equal((await p.securityEvent.findUnique({ where: { id: evB.id } })).status, 'OPEN', 'B\'s event is untouched')
  const own = await sA.http.post(`${base}/security/events/${evA.id}/review`, { note })
  assert.equal(own.status, 200)
  const after = await p.securityEvent.findUnique({ where: { id: evA.id } })
  assert.equal(after.status, 'REVIEWED'); assert.equal(after.organizationId, A)
  const audit = await p.adminAuditLog.findFirst({ where: { action: 'security.event_reviewed', entityId: evA.id } })
  assert.equal(audit?.organizationId, A, 'the review is recorded inside A')
  assert.equal((await sA.http.post(`${base}/security/events/${evX.id}/review`, { note })).status, 404, 'unattributed events cannot be reviewed')
})

await t('audit events: list and read are per organization; unattributed rows are never shown', async () => {
  const a = await sA.http.get(`${base}/audit/events?pageSize=100&q=${run}`)
  const b = await sB.http.get(`${base}/audit/events?pageSize=100&q=${run}`)
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.ok(a.json.items.every((x) => x.organizationId === A) && b.json.items.every((x) => x.organizationId === B))
  assert.ok(actions(a).includes(tag('A')) && actions(b).includes(tag('B')))
  assert.ok(![...actions(a), ...actions(b)].includes(tag('legacy')))
  assert.ok(!actions(a).includes(tag('B')) && !actions(b).includes(tag('A')))
  assert.equal((await sA.http.get(`${base}/audit/events/${auA.id}`)).status, 200)
  for (const [s, id] of [[sA, auB.id], [sB, auA.id], [sA, auX.id], [sB, auX.id]]) assert.equal((await s.http.get(`${base}/audit/events/${id}`)).status, 404)
})

await t('audit export: A\'s CSV contains A\'s rows only; the export is audited inside A', async () => {
  const a = await sA.http.get(`${base}/audit/export?q=${run}`)
  assert.equal(a.status, 200)
  assert.ok(a.text.includes(tag('A')))
  assert.ok(!a.text.includes(tag('B')) && !a.text.includes(tag('legacy')) && !a.text.includes(B), 'nothing of B or of the unattributed rows')
  const b = await sB.http.get(`${base}/audit/export?q=${run}`)
  assert.ok(b.text.includes(tag('B')) && !b.text.includes(tag('A')) && !b.text.includes(A))
  const exportRow = await p.adminAuditLog.findFirst({ where: { action: 'audit.export', actorUserId: ownerA.id }, orderBy: { createdAt: 'desc' } })
  assert.equal(exportRow?.organizationId, A)
})

await t('authorization evidence: list and verify cover only the caller\'s organization', async () => {
  // A reviewed its own event above; let B review its own too, so each organization has evidence of its own.
  assert.equal((await sB.http.post(`${base}/security/events/${evB.id}/review`, { note: 'B reviews its own event' })).status, 200)
  const a = await sA.http.get(`${base}/audit/evidence?pageSize=100`)
  const b = await sB.http.get(`${base}/audit/evidence?pageSize=100`)
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.ok(a.json.items.every((e) => e.organizationId === A), 'A sees only A\'s evidence')
  assert.ok(b.json.items.every((e) => e.organizationId === B), 'B sees only B\'s evidence')
  assert.ok(a.json.items.length > 0 && b.json.items.length > 0, 'each organization has evidence of its own')
  const va = await sA.http.get(`${base}/audit/evidence/verify`)
  assert.equal(va.status, 200)
  assert.deepEqual(va.json.result.organizations.map((o) => o.organizationId), [A], 'A verifies A only')
  const vb = await sB.http.get(`${base}/audit/evidence/verify`)
  assert.deepEqual(vb.json.result.organizations.map((o) => o.organizationId), [B])
})

await t('overview and break-glass history stay inside the organization', async () => {
  assert.equal((await sA.http.get(`${base}/security/overview`)).status, 200)
  const bg = await sB.http.get(`${base}/security/break-glass`)
  assert.equal(bg.status, 200)
  assert.ok(Array.isArray(bg.json.events) && bg.json.events.every((x) => x.organizationId === B))
})

await t('a user with no assignment gets nothing (403) and anonymous gets 401', async () => {
  for (const path of ['security/events', 'audit/events', 'audit/export', 'audit/evidence', 'audit/evidence/verify']) {
    assert.equal((await sN.http.get(`${base}/${path}`)).status, 403, path)
  }
  const anon = await fetch(`${api.base}${base}/security/events`)
  assert.equal(anon.status, 401)
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
