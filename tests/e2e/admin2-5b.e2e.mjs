// STEP 5B part 1 (test DB only): one-time Owner bootstrap (A-F), notification transports, no-self/ruleset evidence.
process.env.ADMIN_BOOTSTRAP_SECRET = 'test-bootstrap-secret-0123456789abcdef0123'
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, assignRoleVersion, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'
import { completeOwnerBootstrap, BOOTSTRAP_COMPLETED, BOOTSTRAP_REQUIRED } from '../../server/lib/authz/bootstrap.mjs'
import { createAssignment, reviewAssignment, approveAssignment } from '../../server/lib/authz/assignment-workflow.mjs'
import { recordSecurityEvent } from '../../server/lib/authz/security-events.mjs'
import { registerTransport, unregisterTransport } from '../../server/lib/authz/notifications.mjs'
import { permissionSummary } from '../../server/lib/authz/index.mjs'
import { verifyEvidenceChain } from '../../server/lib/authz/evidence.mjs'
import { PERMISSION_RULESET_VERSION } from '../../server/lib/authz/catalogue.mjs'

const run = randomUUID().slice(0, 8)
const { t, summary } = makeRunner()
const p = db()
const SECRET = process.env.ADMIN_BOOTSTRAP_SECRET
const STRONG = 'PASSWORD_PLUS_EMAIL_CODE'
const mkOrg = async (tag) => {
  const org = await p.organization.create({ data: { code: `T5B${tag}${run}`.slice(0, 30), name: `t5b ${tag} ${run}` } })
  return org
}
const scope = (org) => [{ kind: 'ORGANIZATION', organizationId: org.id }]
const mkUser = (label) => createStaffUser(label, run)
const boot = (org, user, over = {}) => completeOwnerBootstrap(p, { actorUserId: user.id, organizationId: org.id, reason: 'initial Owner security bootstrap for the organization', operatorSecret: SECRET, authStrength: STRONG, requestId: `req-${run}`, ...over })
const code = async (promise) => { try { await promise; return 'OK' } catch (e) { return e.code || e.message } }
const latestOwner = await p.roleVersion.findFirst({ where: { status: 'EFFECTIVE', role: { code: 'OWNER' } } })

const orgA = await mkOrg('A')
const ownerA = await mkUser('ownerA')
const oldA = await assignRoleVersion(ownerA, 'OWNER', 1, scope(orgA))
let result

await t('C: bootstrap refuses non-owners, wrong organization, wrong secret, weak auth, disabled deployment', async () => {
  const stranger = await mkUser('stranger')
  assert.equal(await code(boot(orgA, stranger)), 'NOT_LEGITIMATE_OWNER', 'no assignment at all')
  const supportUser = await mkUser('supportA'); await assignRole(supportUser, 'SUPPORT_AGENT', scope(orgA))
  assert.equal(await code(boot(orgA, supportUser)), 'NOT_LEGITIMATE_OWNER', 'not an Owner')
  const orgOther = await mkOrg('X'); const otherOwner = await mkUser('ownerX'); await assignRoleVersion(otherOwner, 'OWNER', 1, scope(orgOther))
  assert.equal(await code(boot(orgA, otherOwner)), 'NOT_LEGITIMATE_OWNER', 'Owner of another organization')
  assert.equal(await code(boot(orgA, ownerA, { operatorSecret: 'wrong-secret' })), 'BOOTSTRAP_SECRET_INVALID')
  assert.equal(await code(boot(orgA, ownerA, { operatorSecret: undefined })), 'BOOTSTRAP_SECRET_INVALID')
  assert.equal(await code(boot(orgA, ownerA, { authStrength: 'PASSWORD' })), 'STRONG_AUTH_REQUIRED')
  assert.equal(await code(boot(orgA, ownerA, { reason: 'too short' })), 'REASON_REQUIRED')
  const saved = process.env.ADMIN_BOOTSTRAP_SECRET; delete process.env.ADMIN_BOOTSTRAP_SECRET
  assert.equal(await code(boot(orgA, ownerA)), 'BOOTSTRAP_DISABLED', 'fail closed without a deployment secret')
  process.env.ADMIN_BOOTSTRAP_SECRET = saved
  // nothing changed
  assert.equal((await p.roleAssignment.findUnique({ where: { id: oldA.id } })).status, 'ACTIVE')
  assert.equal((await p.securityBootstrap.findUnique({ where: { organizationId: orgA.id } })).state, BOOTSTRAP_REQUIRED)
  // denials are audited and raise a WARNING event, never including the secret
  const ev = await p.securityEvent.findFirst({ where: { eventType: 'OWNER_BOOTSTRAP_DENIED', entityId: orgA.id }, orderBy: { createdAt: 'desc' } })
  assert.equal(ev.severity, 'WARNING'); assert.equal(JSON.stringify(ev).includes(SECRET), false)
})

await t('A/D/E: initial Owner bootstrap succeeds once, with CRITICAL event, audit, evidence, notifications', async () => {
  result = await boot(orgA, ownerA)
  assert.equal(result.oldRoleVersion, 1); assert.equal(result.newRoleVersion, latestOwner.versionNumber)
  const old = await p.roleAssignment.findUnique({ where: { id: oldA.id } })
  const now = await p.roleAssignment.findUnique({ where: { id: result.newAssignmentId }, include: { roleVersion: true } })
  assert.equal(old.status, 'SUPERSEDED'); assert.equal(now.status, 'ACTIVE'); assert.equal(now.roleVersionId, latestOwner.id)
  assert.ok(now.activationAt.getTime() <= Date.now(), 'exception: active immediately')
  assert.equal(now.supersedesAssignmentId, oldA.id)
  const row = await p.securityBootstrap.findUnique({ where: { organizationId: orgA.id } })
  assert.equal(row.state, BOOTSTRAP_COMPLETED); assert.equal(row.completedById, ownerA.id); assert.equal(row.targetUserId, ownerA.id)
  assert.equal(row.oldRoleVersionId, oldA.roleVersionId); assert.equal(row.newRoleVersionId, latestOwner.id)
  assert.match(row.workflowUnavailableReason, /ordinary request\/review\/approve workflow/)
  const ev = await p.securityEvent.findUnique({ where: { id: result.securityEventId } })
  assert.equal(ev.severity, 'CRITICAL'); assert.equal(ev.eventType, 'OWNER_BOOTSTRAP_COMPLETED')
  assert.equal(ev.detail.normalWorkflowUnavailable, true); assert.equal(ev.detail.oldRoleVersion, 1); assert.equal(ev.detail.newRoleVersion, latestOwner.versionNumber)
  assert.ok(ev.notifiedCount >= 1, 'security recipients notified in-app')
  assert.ok(ev.delivery.in_app.delivered >= 1)
  const audit = await p.adminAuditLog.findUnique({ where: { id: result.auditEventId } })
  assert.equal(audit.action, 'security.owner_bootstrap_completed'); assert.ok(audit.reason.length >= 20)
  const evidence = await p.authorizationEvidence.findUnique({ where: { id: result.evidenceId } })
  assert.equal(evidence.action, 'owner_bootstrap'); assert.equal(evidence.decision, 'ALLOW'); assert.equal(evidence.roleVersionNumber, latestOwner.versionNumber)
  assert.equal(evidence.rulesetVersion, PERMISSION_RULESET_VERSION); assert.equal(evidence.authStrength, STRONG)
  assert.equal((await verifyEvidenceChain(p)).ok, true, 'hash chain still verifies (ruleset field is hashed only when present)')
  const evs = (await p.roleAssignmentEvent.findMany({ where: { assignmentId: { in: [oldA.id, now.id] } } })).map((e) => e.eventType).sort()
  assert.deepEqual(evs, ['BOOTSTRAP_GRANTED', 'BOOTSTRAP_SUPERSEDED'])
})

await t('B: a second bootstrap is denied, and the database refuses to reopen or delete a completed row', async () => {
  assert.equal(await code(boot(orgA, ownerA)), 'BOOTSTRAP_CLOSED')
  const other = await mkUser('ownerA2'); await assignRoleVersion(other, 'OWNER', 1, scope(orgA))
  assert.equal(await code(boot(orgA, other)), 'BOOTSTRAP_CLOSED', 'cannot be reused for a later Owner')
  await assert.rejects(p.$executeRaw`UPDATE security_bootstrap SET state = 'SECURITY_BOOTSTRAP_REQUIRED', completed_at = NULL WHERE organization_id = ${orgA.id}::uuid`)
  await assert.rejects(p.$executeRaw`UPDATE security_bootstrap SET reason = 'x' WHERE organization_id = ${orgA.id}::uuid`)
  await assert.rejects(p.$executeRaw`DELETE FROM security_bootstrap WHERE organization_id = ${orgA.id}::uuid`)
  await assert.rejects(p.$executeRaw`INSERT INTO security_bootstrap (organization_id, state) VALUES (${randomUUID()}::uuid, 'SECURITY_BOOTSTRAP_COMPLETED')`)
  assert.equal((await p.securityBootstrap.findUnique({ where: { organizationId: orgA.id } })).state, BOOTSTRAP_COMPLETED)
})

await t('bootstrap is not needed (and stays REQUIRED) when a current-version Owner already exists', async () => {
  const org = await mkOrg('N'); const o1 = await mkUser('ownerN1'); const o2 = await mkUser('ownerN2')
  await assignRoleVersion(o1, 'OWNER', 1, scope(org)); await assignRole(o2, 'OWNER', scope(org))
  assert.equal(await code(boot(org, o1)), 'BOOTSTRAP_NOT_NEEDED')
  assert.equal((await p.securityBootstrap.findUnique({ where: { organizationId: org.id } })).state, BOOTSTRAP_REQUIRED)
})

await t('F: after bootstrap an ordinary Owner grant still needs request, review, approval and a full 48 hours', async () => {
  const target = await mkUser('futureOwner'); const reviewer = await mkUser('reviewer')
  const g = await createAssignment(p, { actorUserId: ownerA.id, targetUserId: target.id, roleVersionId: latestOwner.id, scopeRows: scope(orgA), reason: 'second owner after bootstrap closed' })
  assert.equal(g.assignment.status, 'PENDING_APPROVAL'); assert.equal(g.highRisk, true)
  await reviewAssignment(p, { actorUserId: reviewer.id, assignmentId: g.assignment.id, decision: 'APPROVE', reason: 'reviewed after bootstrap' })
  const approver = await mkUser('approver2')
  const ok = await approveAssignment(p, { actorUserId: approver.id, assignmentId: g.assignment.id, reason: 'approved after bootstrap' })
  assert.equal(ok.status, 'PENDING_ACTIVATION')
  const row = await p.roleAssignment.findUnique({ where: { id: g.assignment.id } })
  assert.equal((row.activationAt.getTime() - row.approvedAt.getTime()) / 3_600_000, 48)
  assert.equal(await code(boot(orgA, target)), 'BOOTSTRAP_CLOSED')
})

await t('notifications: a failing transport never blocks or loses the security event; later transports still run', async () => {
  const seen = []
  registerTransport({ name: 'test_fail', async deliver() { throw new Error('smtp down') } })
  registerTransport({ name: 'test_record', async deliver({ event, recipients }) { seen.push([event.id, recipients.length]); return { delivered: recipients.length } } })
  try {
    const ev = await p.$transaction((tx) => recordSecurityEvent(tx, { severity: 'CRITICAL', eventType: 'TEST_TRANSPORT', summary: 'transport failure test', organizationId: orgA.id }), { timeout: 30_000, maxWait: 10_000 })
    const row = await p.securityEvent.findUnique({ where: { id: ev.id } })
    assert.ok(row, 'event persisted'); assert.ok(row.delivery.test_fail.error.includes('smtp down'))
    assert.ok(row.delivery.in_app.delivered >= 1, 'in-app unaffected by the failing transport')
    assert.equal(row.delivery.test_record.delivered, row.delivery.recipients)
    assert.equal(seen.length, 1)
    const nonCritical = await p.$transaction((tx) => recordSecurityEvent(tx, { severity: 'HIGH', eventType: 'TEST_TRANSPORT_HIGH', summary: 'high is not pushed' }))
    assert.equal(seen.length, 1, 'only CRITICAL events notify'); assert.ok(nonCritical.id)
  } finally { unregisterTransport('test_fail'); unregisterTransport('test_record') }
})

await t('notification policy grants nothing: an Owner-role recipient still lacks security_event.review if the version lacks it', async () => {
  const v1owner = await mkUser('v1only'); await assignRoleVersion(v1owner, 'OWNER', 1, scope(orgA))
  await p.$transaction((tx) => recordSecurityEvent(tx, { severity: 'CRITICAL', eventType: 'TEST_POLICY', summary: 'policy test', organizationId: orgA.id }))
  assert.ok(await p.adminNotification.findFirst({ where: { userId: v1owner.id, type: 'SECURITY', title: { contains: 'policy test' } } }), 'v1 Owner is named by the policy and is notified')
  const held = await permissionSummary({ user: { id: v1owner.id, status: 'ACTIVE' } }, ['security_event.review'])
  assert.equal(held['security_event.review'], false, 'being notified does not confer permission')
})

await t('evidence for ordinary decisions records the permission rule-set version', async () => {
  process.env.ADMIN_ACTIVATION_JOB = 'off'
  const api = await startApi({ ADMIN_ACTIVATION_JOB: 'off' })
  try {
    const org = await p.organization.findFirst({ orderBy: { createdAt: 'asc' } })
    const u = await mkUser('evid'); await assignRole(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
    const s = await loginAsStaff(api, u)
    assert.equal((await s.http.get('/api/admin2/access/sessions')).status, 200)
    const ev = await p.authorizationEvidence.findFirst({ where: { userId: u.id, permissionCode: 'session.view' }, orderBy: { sequence: 'desc' } })
    assert.equal(ev.rulesetVersion, PERMISSION_RULESET_VERSION)
    // HTTP bootstrap endpoint: wrong operator secret is refused and changes nothing (main org stays REQUIRED)
    const r = await s.http.post('/api/admin2/security/bootstrap/owner', { reason: 'attempt with the wrong operator secret' })
    assert.ok([403, 503].includes(r.status), `status ${r.status}`)
    assert.equal((await p.securityBootstrap.findUnique({ where: { organizationId: org.id } })).state, BOOTSTRAP_REQUIRED)
  } finally { api.stop() }
})

const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
