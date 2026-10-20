// STEP 5A -- security reconciliation over real HTTP (test DB only): SECURITY_ADMIN (22), emergency
// suspension (23), reactivation (24), role versions (25), retention (26), activation sweeper (21).
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, assignRoleVersion, makeRunner, randomUUID, client, PASSWORD } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const ORG = [{ kind: 'ORGANIZATION', organizationId: org.id }]
const str = await p.platform.findUnique({ where: { code: 'str' } })
const mk = async (label, role) => { const u = await createStaffUser(label, run); if (role) await assignRole(u, role, ORG); return u }
const A = '/api/admin2/access'

const [owner1, owner2, owner3, secUser, superUser, mgrUser] = await Promise.all([mk('o1', 'OWNER'), mk('o2', 'OWNER'), mk('o3', 'OWNER'), mk('sec', 'SECURITY_ADMIN'), mk('sup', 'SUPER_ADMIN'), createStaffUser('mgr', run)])
await assignRole(mgrUser, 'STR_MANAGER', [{ kind: 'PLATFORM', platformId: str.id }])
const [o1, o2, o3, sec, sup, mgr] = await Promise.all([owner1, owner2, owner3, secUser, superUser, mgrUser].map((u) => loginAsStaff(api, u)))

const victimWithSession = async (label, role = 'SUPPORT_AGENT') => { const u = await mk(label, role); return { user: u, s: await loginAsStaff(api, u) } }
const events = (where) => p.securityEvent.findMany({ where, orderBy: { createdAt: 'desc' } })

await t('22: SECURITY_ADMIN has the approved security powers and none of the financial or approval powers', async () => {
  const d = await sec.http.get(`${A}/users/${secUser.id}`)
  assert.equal(d.status, 200, d.text)
  const held = new Set(d.json.effectivePermissions)
  for (const c of ['security.view', 'security.manage', 'user.suspend_emergency', 'session.revoke', 'privileged_access.review', 'break_glass.review', 'security_event.review']) assert.ok(held.has(c), c)
  for (const c of ['payment.release', 'payout.release', 'accounting.post', 'tax.approve', 'vendor.bank_change.approve', 'access.approve', 'role.publish', 'access.assign']) assert.ok(!held.has(c), `must not hold ${c}`)
  const target = await mk('x1')
  assert.equal((await sec.http.post(`${A}/assignments`, { userId: target.id, roleCode: 'SUPPORT_AGENT', scopes: ORG, reason: 'security admin grant attempt' })).status, 403)
  assert.equal((await sec.http.get('/api/admin2/security/events')).status, 200)
  assert.equal((await sec.http.get('/api/admin2/security/overview')).status, 200)
})

await t('23: platform manager cannot emergency-suspend; SUPER_ADMIN without security authority cannot either', async () => {
  const v = await mk('v23a', 'SUPPORT_AGENT')
  assert.equal((await mgr.http.post(`${A}/users/${v.id}/emergency-suspend`, { reason: 'platform manager attempt' })).status, 403)
  assert.equal((await sup.http.post(`${A}/users/${v.id}/emergency-suspend`, { reason: 'super admin without authority' })).status, 403)
  assert.equal((await p.user.findUnique({ where: { id: v.id } })).status, 'ACTIVE')
})

let suspended
await t('23: OWNER emergency-suspends: immediate, sessions revoked, login blocked, history kept, CRITICAL event + audit + notifications', async () => {
  const { user, s } = await victimWithSession('v23b')
  assert.equal((await s.http.get('/api/admin2/me')).status, 200)
  assert.equal((await o1.http.post(`${A}/users/${user.id}/emergency-suspend`, { reason: 'x' })).status, 400, 'reason required')
  assert.equal((await o1.http.post(`${A}/users/${owner1.id}/emergency-suspend`, { reason: 'suspending myself' })).status, 400)
  const before = await p.authorizationEvidence.count()
  const r = await o1.http.post(`${A}/users/${user.id}/emergency-suspend`, { reason: 'credential compromise suspected' })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.severity, 'CRITICAL')
  assert.equal((await s.http.get('/api/admin2/me')).status, 401, 'existing session dead at once')
  const login = await client(api.base).post('/api/auth/login', { email: user.email, password: PASSWORD })
  assert.notEqual(login.status, 200, 'authentication blocked')
  assert.equal((await p.user.findUnique({ where: { id: user.id } })).status, 'SUSPENDED')
  assert.equal(await p.userSession.count({ where: { userId: user.id, revokedAt: null } }), 0)
  assert.equal(await p.roleAssignment.count({ where: { userId: user.id, status: 'ACTIVE' } }), 1, 'assignment history preserved, not deleted')
  const sus = await p.userSuspension.findFirst({ where: { userId: user.id } })
  assert.equal(sus.kind, 'EMERGENCY'); assert.equal(sus.suspendedById, owner1.id); assert.ok(sus.sessionsRevoked >= 1)
  const ev = await p.securityEvent.findUnique({ where: { id: r.json.securityEventId } })
  assert.equal(ev.severity, 'CRITICAL'); assert.equal(ev.eventType, 'USER_EMERGENCY_SUSPENDED'); assert.ok(ev.auditEventId); assert.ok(ev.notifiedCount >= 2)
  const audit = await p.adminAuditLog.findUnique({ where: { id: ev.auditEventId } })
  assert.equal(audit.action, 'iam.user.emergency_suspended'); assert.equal(audit.reason, 'credential compromise suspected')
  const notes = await p.adminNotification.findMany({ where: { type: 'SECURITY', link: `/admin/security/events/${ev.id}` } })
  const ids = new Set(notes.map((n) => n.userId))
  assert.ok(ids.has(owner2.id) && ids.has(secUser.id), 'owner and authorized security users notified')
  assert.ok(!ids.has(user.id), 'the suspended user is not notified')
  assert.ok((await p.authorizationEvidence.count()) > before, 'evidence written for the privileged decision')
  suspended = user
})

await t('23: SECURITY_ADMIN and SUPER_ADMIN + explicit SECURITY_AUTHORITY can emergency-suspend', async () => {
  const a = await mk('v23c', 'SUPPORT_AGENT')
  assert.equal((await sec.http.post(`${A}/users/${a.id}/emergency-suspend`, { reason: 'security admin response' })).status, 200)
  const b = await mk('v23d', 'SUPPORT_AGENT')
  await assignRole(superUser, 'SECURITY_AUTHORITY', ORG)
  const sup2 = await loginAsStaff(api, superUser)
  assert.equal((await sup2.http.post(`${A}/users/${b.id}/emergency-suspend`, { reason: 'super admin with security authority' })).status, 200)
  const kinds = await p.userSuspension.findMany({ where: { userId: { in: [a.id, b.id] } } })
  assert.ok(kinds.every((k) => k.kind === 'EMERGENCY'))
})

await t('23: a standard suspension raises a HIGH (not CRITICAL) event', async () => {
  const v = await mk('v23e', 'SUPPORT_AGENT')
  const r = await o1.http.post(`${A}/users/${v.id}/suspend`, { reason: 'standard suspension for review' })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.severity, 'HIGH')
})

await t('24: reactivation is separate, audited, needs a different person and an assignment-review acknowledgement; sessions and closed roles stay closed', async () => {
  const { user, s } = await victimWithSession('v24')
  const revokedA = await assignRole(user, 'STR_MANAGER', [{ kind: 'PLATFORM', platformId: str.id }])
  await p.roleAssignment.update({ where: { id: revokedA.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'before suspension' } })
  const expired = await assignRole(user, 'FINANCE_VIEWER', ORG)
  await p.$executeRaw`UPDATE role_assignments SET status = 'EXPIRED' WHERE id = ${expired.id}::uuid`
  assert.equal((await sec.http.post(`${A}/users/${user.id}/emergency-suspend`, { reason: 'investigation under way' })).status, 200)
  assert.equal((await sec.http.post(`${A}/users/${user.id}/reactivate`, { reason: 'cleared after review', acknowledgeAssignmentReview: true })).status, 400, 'suspender cannot reactivate')
  assert.equal((await sup.http.post(`${A}/users/${user.id}/reactivate`, { reason: 'super admin lacks authority', acknowledgeAssignmentReview: true })).status, 403)
  assert.equal((await o1.http.post(`${A}/users/${user.id}/reactivate`, { reason: 'cleared after review' })).status, 400, 'ack required')
  const ok = await o1.http.post(`${A}/users/${user.id}/reactivate`, { reason: 'cleared after review', acknowledgeAssignmentReview: true })
  assert.equal(ok.status, 200, ok.text)
  assert.equal(ok.json.sessionsRestored, 0)
  assert.ok(ok.json.assignmentsToReview.length >= 1)
  assert.equal((await s.http.get('/api/admin2/me')).status, 401, 'old session not restored')
  assert.equal((await p.roleAssignment.findUnique({ where: { id: revokedA.id } })).status, 'REVOKED')
  assert.equal((await p.roleAssignment.findUnique({ where: { id: expired.id } })).status, 'EXPIRED')
  const sus = await p.userSuspension.findFirst({ where: { userId: user.id } })
  assert.equal(sus.reactivatedById, owner1.id); assert.ok(sus.reactivatedAt)
  assert.ok(await p.securityEvent.findFirst({ where: { subjectUserId: user.id, eventType: 'USER_REACTIVATED' } }))
  assert.ok(await p.adminAuditLog.findFirst({ where: { entityId: user.id, action: 'iam.user.reactivated' } }))
  const fresh = await loginAsStaff(api, user)
  assert.equal((await fresh.http.get('/api/admin2/me')).status, 200, 'user can sign in again with a NEW session')
})

await t('21: sweeper activates due high-risk grants; a grant revoked while waiting never activates; removal is immediate', async () => {
  const mkPending = async (label) => {
    const target = await mk(label)
    const g = await o1.http.post(`${A}/assignments`, { userId: target.id, roleCode: 'OWNER', scopes: ORG, reason: 'sweeper test grant' })
    assert.equal(g.status, 201, g.text)
    const id = g.json.assignment.id
    assert.equal((await o2.http.post(`${A}/assignments/${id}/review`, { reason: 'reviewed for sweeper' })).status, 200)
    assert.equal((await o3.http.post(`${A}/assignments/${id}/approve`, { reason: 'approved for sweeper' })).status, 200)
    return { target, id }
  }
  const a = await mkPending('sw1'); const b = await mkPending('sw2')
  await p.$executeRaw`UPDATE role_assignments SET activation_at = now() - interval '1 minute' WHERE id IN (${a.id}::uuid, ${b.id}::uuid)`
  assert.equal((await o1.http.post(`${A}/assignments/${b.id}/revoke`, { reason: 'changed our mind in the wait' })).status, 200, 'revocation needs no delay')
  await o1.http.get(`${A}/assignments`) // listing runs the sweeper
  assert.equal((await p.roleAssignment.findUnique({ where: { id: a.id } })).status, 'ACTIVE')
  assert.equal((await p.roleAssignment.findUnique({ where: { id: b.id } })).status, 'REVOKED', 'revoked grant never activates')
  assert.ok(await p.securityEvent.findFirst({ where: { entityId: a.id, eventType: 'HIGH_RISK_ACCESS_ACTIVATED' } }))
  const evs = (await o1.http.get(`${A}/assignments/${a.id}/events`)).json.events.map((e) => e.eventType)
  assert.deepEqual(evs, ['REQUESTED', 'REVIEWED', 'APPROVED', 'ACTIVATED'])
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
