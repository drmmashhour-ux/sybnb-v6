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

const owner1 = await mk('o1', 'OWNER'); const owner2 = await mk('o2', 'OWNER'); const owner3 = await mk('o3', 'OWNER')
const o1 = await loginAsStaff(api, owner1); const o2 = await loginAsStaff(api, owner2); const o3 = await loginAsStaff(api, owner3)
const secUser = await mk('sec', 'SECURITY_ADMIN'); const sec = await loginAsStaff(api, secUser)
const supUser = await mk('sup', 'SUPPORT_AGENT'); const sup = await loginAsStaff(api, supUser)

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
  const ev = await p.authorizationEvidence.findFirst({ where: { userId: owner1.id, permissionCode: 'iam.role_assignment.assign' }, orderBy: { sequence: 'desc' } })
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
await t('high-risk role grant waits for a SECOND approver; requester cannot self-approve', async () => {
  const target = await mk('t4')
  const g = await o1.http.post('/api/admin2/access/assignments', { userId: target.id, roleCode: 'OWNER', scopes: ORG, reason: 'second owner for continuity' })
  assert.equal(g.status, 201, g.text)
  assert.equal(g.json.assignment.status, 'PENDING_APPROVAL')
  pendingId = g.json.assignment.id
  // pending assignment grants nothing yet
  const tl = await loginAsStaff(api, target).catch(() => null)
  if (tl) assert.equal((await tl.http.get('/api/admin2/me')).status, 403)
  assert.equal((await o1.http.post(`/api/admin2/access/assignments/${pendingId}/approve`, { reason: 'approving my own request' })).status, 400)
  assert.equal((await o2.http.post(`/api/admin2/access/assignments/${pendingId}/approve`, { reason: 'verified out of band' })).status, 200)
  const row = await p.roleAssignment.findUnique({ where: { id: pendingId } })
  assert.equal(row.status, 'ACTIVE'); assert.equal(row.approvedById, owner2.id)
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
  assert.equal((await o1.http.post(`/api/admin2/access/users/${victim.id}/reactivate`, { reason: 'cleared after review' })).status, 200)
  assert.equal((await p.user.findUnique({ where: { id: victim.id } })).status, 'ACTIVE')
})

await t('user detail shows assignments + effective permissions; org sessions listing requires tier-3 permission', async () => {
  const d = await o1.http.get(`/api/admin2/access/users/${supUser.id}`)
  assert.equal(d.status, 200)
  assert.ok(d.json.effectivePermissions.includes('support.case.read'))
  assert.ok(d.json.assignments.length >= 1)
  assert.equal((await o1.http.get('/api/admin2/access/sessions')).status, 200)
  assert.equal((await sup.http.get('/api/admin2/access/sessions')).status, 403)
})

await t('role version lifecycle: draft -> review -> activate with three different people; no in-place edit', async () => {
  const detail = (await o1.http.get('/api/admin2/access/roles/SUPPORT_AGENT')).json
  const eff = detail.versions.find((v) => v.status === 'EFFECTIVE')
  const codes = eff.permissions.map((x) => x.code)
  const toggle = 'comment.internal.write'
  const next = codes.includes(toggle) ? codes.filter((c) => c !== toggle) : [...codes, toggle]
  // mixed change (add one, remove another) is refused
  const mixed = await o1.http.post('/api/admin2/access/roles/SUPPORT_AGENT/versions', { permissions: [...next, 'party.party.write'].filter((c) => c !== codes[0]), reason: 'mixed change attempt' })
  assert.equal(mixed.status, 400); assert.equal(mixed.json.error.code, 'MIXED_CHANGE_REJECTED')
  const draft = await o1.http.post('/api/admin2/access/roles/SUPPORT_AGENT/versions', { permissions: next, reason: 'tighten internal comments' })
  assert.equal(draft.status, 201, draft.text)
  const id = draft.json.version.id
  assert.equal((await o1.http.post('/api/admin2/access/roles/SUPPORT_AGENT/versions', { permissions: next, reason: 'second concurrent draft' })).status, 409)
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'skip the review steps' })).status, 409)
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/submit`, { reason: 'ready for review' })).status, 200)
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/review`, { reason: 'reviewing my own work' })).status, 400, 'author cannot review')
  assert.equal((await o2.http.post(`/api/admin2/access/role-versions/${id}/review`, { reason: 'reviewed the diff' })).status, 200)
  assert.equal((await o2.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'reviewer activating' })).status, 400, 'reviewer cannot activate')
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'author activating' })).status, 400, 'author cannot activate')
  assert.equal((await o3.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'independent approval' })).status, 200)
  const after = (await o1.http.get('/api/admin2/access/roles/SUPPORT_AGENT')).json
  assert.equal(after.versions.filter((v) => v.status === 'EFFECTIVE').length, 1)
  assert.equal(after.versions.find((v) => v.id === eff.id).status, 'SUPERSEDED')
  // existing assignments stay pinned to the version they were granted under
  const still = await p.roleAssignment.findFirst({ where: { userId: supUser.id }, include: { roleVersion: true } })
  assert.ok(still.roleVersion.versionNumber <= eff.versionNumber)
})

await t('service accounts: only secret REFERENCES accepted, never echoed back; disable works', async () => {
  const bad = await o1.http.post('/api/admin2/access/service-accounts', { name: 'bad-secret', secretRef: 'sk_live_abcdef1234567890', reason: 'register integration' })
  assert.equal(bad.status, 400)
  const ok = await o1.http.post('/api/admin2/access/service-accounts', { name: `svc-${run}`, secretRef: 'vault://sybnb/test/svc', permissionCodes: ['work.item.read'], reason: 'register integration' })
  assert.equal(ok.status, 201, ok.text)
  const list = await o1.http.get('/api/admin2/access/service-accounts')
  assert.equal(list.text.includes('vault://'), false)
  assert.equal((await o1.http.post(`/api/admin2/access/service-accounts/${ok.json.id}/disable`, { reason: 'no longer used' })).status, 200)
})

await t('permissions catalogue + scope registry load from the database', async () => {
  const perms = (await o1.http.get('/api/admin2/access/permissions')).json.permissions
  assert.ok(perms.length >= 46 && perms.every((x) => x.tier >= 1 && x.tier <= 4))
  const sc = (await o1.http.get('/api/admin2/access/scopes')).json
  assert.ok(sc.platforms.length >= 8 && sc.legalEntities.some((x) => x.code === 'LE-9375-7649'))
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
