// STEP 5 -- Users & Access API over real HTTP (test DB only).
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const ORG = [{ kind: 'ORGANIZATION', organizationId: org.id }]
const mk = async (label, role) => { const u = await createStaffUser(label, run); if (role) await assignRole(u, role, ORG); return u }

const [owner1, owner2, owner3, secUser, supUser] = await Promise.all([mk('o1', 'OWNER'), mk('o2', 'OWNER'), mk('o3', 'OWNER'), mk('sec', 'SECURITY_ADMIN'), mk('sup', 'SUPPORT_AGENT')])
const [o1, o2, o3, sec, sup] = await Promise.all([owner1, owner2, owner3, secUser, supUser].map((u) => loginAsStaff(api, u)))

await t('support agent cannot list users, assignments, roles or sessions (deny by default)', async () => {
  for (const path of ['/users', '/assignments', '/roles', '/sessions', '/permissions', '/scopes']) {
    const r = await sup.http.get(`/api/admin2/access${path}`)
    assert.equal(r.status, 403, path)
  }
})

await t('security admin can read users/roles but cannot grant roles', async () => {
  assert.equal((await sec.http.get('/api/admin2/access/users')).status, 200)
  assert.equal((await sec.http.get('/api/admin2/access/roles')).status, 200)
  const target = await mk('t1')
  const r = await sec.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'SUPPORT_AGENT', scopes: ORG, reason: 'attempt without permission' })
  assert.equal(r.status, 403)
})

await t('users list is paginated, searchable, and never returns password hashes', async () => {
  const r = await o1.http.get(`/api/admin2/access/users?q=s5t-${run}&pageSize=5`)
  assert.equal(r.status, 200)
  assert.ok(r.json.items.length > 0 && r.json.items.length <= 5)
  assert.equal(/passwordHash|password_hash/i.test(r.text), false)
  assert.ok(r.json.total >= 5)
})

await t('owner grants a non-high-risk role: ACTIVE immediately, with audit + evidence', async () => {
  const target = await mk('t2')
  const r = await o1.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'SUPPORT_AGENT', scopes: ORG, reason: 'new support hire' })
  assert.equal(r.status, 201, r.text)
  assert.equal(r.json.assignment.status, 'ACTIVE')
  assert.equal(r.json.needsSecondApproval, false)
  const audit = await p.adminAuditLog.findFirst({ where: { entityId: r.json.assignment.id, action: 'iam.role_assignment.granted' } })
  assert.ok(audit && audit.correlationId)
  const ev = await p.authorizationEvidence.findFirst({ where: { userId: owner1.id, permissionCode: 'access.assign' }, orderBy: { sequence: 'desc' } })
  assert.equal(ev.decision, 'ALLOW')
})

await t('self-grant and unknown role/scope/user are rejected', async () => {
  assert.equal((await o1.http.post('/api/admin2/access/assignments', { userId: owner1.id, roleCode: 'SUPPORT_AGENT', scopes: ORG, reason: 'grant myself more' })).status, 400)
  const target = await mk('t3')
  assert.equal((await o1.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'NOPE', scopes: ORG, reason: 'unknown role here' })).status, 400)
  assert.equal((await o1.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'SUPPORT_AGENT', scopes: [{ kind: 'PLATFORM', platformId: randomUUID() }], reason: 'unknown platform' })).status, 400)
  assert.equal((await o1.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'SUPPORT_AGENT', scopes: ORG, reason: 'x' })).status, 400, 'short reason')
  assert.equal((await o1.http.post('/api/admin2/access/assignments', { userId: randomUUID(), roleCode: 'SUPPORT_AGENT', scopes: ORG, reason: 'unknown target user' })).status, 400)
})

let pendingId
await t('high-risk grant: request -> review -> Owner approval -> PENDING_ACTIVATION; nobody can short-circuit it', async () => {
  const target = await mk('t4')
  const g = await o1.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'OWNER', scopes: ORG, reason: 'second owner for continuity' })
  assert.equal(g.status, 201, g.text)
  assert.equal(g.json.assignment.status, 'PENDING_APPROVAL')
  assert.ok(g.json.highRiskPermissions.includes('access.approve'))
  pendingId = g.json.assignment.id
  // approval before review is refused; requester cannot review; reviewer cannot approve
  assert.equal((await o2.http.post(`/api/admin2/access/assignments/${pendingId}/approve`, { reason: 'skipping the review step' })).status, 409)
  assert.equal((await o1.http.post(`/api/admin2/access/assignments/${pendingId}/review`, { reason: 'reviewing my own request' })).status, 400)
  assert.equal((await o2.http.post(`/api/admin2/access/assignments/${pendingId}/review`, { reason: 'checked with the owner' })).status, 200)
  assert.equal((await o2.http.post(`/api/admin2/access/assignments/${pendingId}/approve`, { reason: 'reviewer also approving' })).status, 400)
  assert.equal((await o1.http.post(`/api/admin2/access/assignments/${pendingId}/approve`, { reason: 'requester approving' })).status, 400)
  const ok = await o3.http.post(`/api/admin2/access/assignments/${pendingId}/approve`, { reason: 'verified out of band' })
  assert.equal(ok.status, 200, ok.text)
  assert.equal(ok.json.status, 'PENDING_ACTIVATION')
  const row = await p.roleAssignment.findUnique({ where: { id: pendingId } })
  assert.equal(row.status, 'PENDING_ACTIVATION'); assert.equal(row.approvedById, owner3.id); assert.equal(row.reviewedById, owner2.id)
  const hours = (row.activationAt.getTime() - row.approvedAt.getTime()) / 3_600_000
  assert.equal(hours, 48, 'activation_at = approved_at + 48h')
  // the new owner cannot use the console yet (backend denial), even though the row exists
  const tl = await loginAsStaff(api, target)
  assert.equal((await tl.http.get('/api/admin2/me')).status, 403)
  // time passes (test sets the clock forward on the row): now it is usable
  await p.$executeRaw`UPDATE role_assignments SET activation_at = now() - interval '1 minute' WHERE id = ${pendingId}::uuid`
  assert.equal((await tl.http.get('/api/admin2/me')).status, 200)
})

await t('revoke closes the assignment, needs a reason, and cannot target yourself', async () => {
  const target = await mk('t5')
  const g = await o1.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'SUPPORT_AGENT', scopes: ORG, reason: 'temporary cover' })
  const id = g.json.assignment.id
  assert.equal((await o1.http.post(`/api/admin2/access/assignments/${id}/revoke`, { reason: '' })).status, 400)
  assert.equal((await o1.http.post(`/api/admin2/access/assignments/${id}/revoke`, { reason: 'cover period over' })).status, 200)
  assert.equal((await p.roleAssignment.findUnique({ where: { id } })).status, 'REVOKED')
  const mine = await p.roleAssignment.findFirst({ where: { userId: owner1.id } })
  assert.equal((await o1.http.post(`/api/admin2/access/assignments/${mine.id}/revoke`, { reason: 'revoking myself now' })).status, 400)
  const ev = await o1.http.get(`/api/admin2/access/assignments/${id}/events`)
  assert.deepEqual(ev.json.events.map((e) => e.eventType), ['GRANTED', 'REVOKED'])
})

await t('suspend a user: sessions die at once; self-suspend refused; reactivate works', async () => {
  const victim = await mk('v1', 'SUPPORT_AGENT'); const v = await loginAsStaff(api, victim)
  assert.equal((await v.http.get('/api/admin2/me')).status, 200)
  assert.equal((await o1.http.post(`/api/admin2/access/users/${owner1.id}/suspend`, { reason: 'suspending myself' })).status, 400)
  assert.equal((await o1.http.post(`/api/admin2/access/users/${victim.id}/suspend`, { reason: 'investigation under way' })).status, 200)
  assert.equal((await v.http.get('/api/admin2/me')).status, 401)
  assert.equal((await o1.http.post(`/api/admin2/access/users/${victim.id}/reactivate`, { reason: 'cleared after review', acknowledgeAssignmentReview: true })).status, 400, 'the suspender cannot reactivate')
  assert.equal((await o2.http.post(`/api/admin2/access/users/${victim.id}/reactivate`, { reason: 'cleared after review' })).status, 400, 'assignment review acknowledgement is required')
  assert.equal((await o2.http.post(`/api/admin2/access/users/${victim.id}/reactivate`, { reason: 'cleared after review', acknowledgeAssignmentReview: true })).status, 200)
  assert.equal((await p.user.findUnique({ where: { id: victim.id } })).status, 'ACTIVE')
  assert.equal((await v.http.get('/api/admin2/me')).status, 401, 'old sessions are not restored')
})

await t('user detail shows assignments + effective permissions; org sessions listing requires tier-3 permission', async () => {
  const d = await o1.http.get(`/api/admin2/access/users/${supUser.id}`)
  assert.equal(d.status, 200)
  assert.ok(d.json.effectivePermissions.includes('support.view'))
  assert.ok(d.json.assignments.length >= 1)
  assert.equal((await o1.http.get('/api/admin2/access/sessions')).status, 200)
  assert.equal((await sup.http.get('/api/admin2/access/sessions')).status, 403)
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
