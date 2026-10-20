// STEP 5C part 2 (test DB only): notification failure + retry (G), concurrent last-authority removal (H),
// 48 h regression (I), emergency suspension regression (J).
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { createStaffUser, assignRole, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'
import { createAssignment, reviewAssignment, approveAssignment, revokeAssignment } from '../../server/lib/authz/assignment-workflow.mjs'
import { suspendUser } from '../../server/lib/authz/emergency.mjs'
import { registerTransport, unregisterTransport, retryFailedDeliveries } from '../../server/lib/authz/notifications.mjs'
import { permissionSummary } from '../../server/lib/authz/index.mjs'

const run = randomUUID().slice(0, 8)
const { t, summary } = makeRunner()
const p = db()
const mkOrg = (tag) => p.organization.create({ data: { code: `T5E${tag}${run}`.slice(0, 30), name: `t5c-b ${tag} ${run}` } })
const scope = (org) => [{ kind: 'ORGANIZATION', organizationId: org.id }]
const code = async (promise) => { try { await promise; return 'OK' } catch (e) { return e.code || e.message } }
const latestOwner = await p.roleVersion.findFirst({ where: { status: 'EFFECTIVE', role: { code: 'OWNER' } } })

await t('G: transport failure never undoes a security action; it is recorded and retried later, once', async () => {
  const org = await mkOrg('G'); const keep = await createStaffUser('keep', run); const target = await createStaffUser('tgt', run); const actor = await createStaffUser('act', run)
  await assignRole(keep, 'OWNER', scope(org)); await assignRole(target, 'OWNER', scope(org)) // another Owner remains, so the suspension is allowed
  let down = true; let sent = 0
  registerTransport({ name: 'sms_test', async deliver({ recipients }) { if (down) throw new Error('provider unavailable'); sent += 1; return { delivered: recipients.length } } })
  try {
    const out = await suspendUser(p, { actorUserId: actor.id, targetUserId: target.id, reason: 'emergency during transport outage', kind: 'EMERGENCY' })
    assert.equal((await p.user.findUnique({ where: { id: target.id } })).status, 'SUSPENDED', 'the action result is correct')
    const ev = await p.securityEvent.findUnique({ where: { id: out.securityEvent.id } })
    assert.equal(ev.severity, 'CRITICAL'); assert.ok(ev.delivery.sms_test.error.includes('provider unavailable')); assert.equal(ev.delivery.sms_test.attempts, 1)
    assert.ok(ev.delivery.in_app.delivered >= 1, 'in-app delivery still worked')
    assert.ok(await p.adminAuditLog.findFirst({ where: { action: 'iam.user.emergency_suspended', entityId: target.id } }), 'audit persisted')
    assert.ok(await p.userSuspension.findFirst({ where: { userId: target.id, reactivatedAt: null } }))
    // still down: the retry records the next failure, does not roll anything back
    const r1 = await retryFailedDeliveries(p, { limit: 500 })
    assert.ok(r1.stillFailing >= 1)
    const mid = await p.securityEvent.findUnique({ where: { id: ev.id } })
    assert.equal(mid.delivery.sms_test.attempts, 2); assert.ok(mid.delivery.sms_test.lastAttemptAt)
    // provider recovers: the retry delivers exactly once and marks it recovered
    down = false
    const r2 = await retryFailedDeliveries(p, { limit: 500 })
    assert.ok(r2.recovered >= 1)
    const after = await p.securityEvent.findUnique({ where: { id: ev.id } })
    assert.equal(after.delivery.sms_test.error, undefined); assert.ok(after.delivery.sms_test.recoveredAt); assert.equal(sent >= 1, true)
    const sentBefore = sent
    await retryFailedDeliveries(p, { limit: 500 })
    assert.equal(sent, sentBefore, 'a recovered event is not sent again')
  } finally { unregisterTransport('sms_test') }
  // an event whose transport is not configured on this deployment is abandoned, not retried forever
  const ev2 = await p.securityEvent.findFirst({ where: { eventType: 'USER_EMERGENCY_SUSPENDED', entityId: target.id } })
  await p.$executeRaw`UPDATE security_events SET delivery = '{"ghost_transport": {"error": "x", "attempts": 1}}'::jsonb WHERE id = ${ev2.id}::uuid`
  await retryFailedDeliveries(p, { limit: 500 })
  assert.equal((await p.securityEvent.findUnique({ where: { id: ev2.id } })).delivery.ghost_transport.abandoned, 'TRANSPORT_NOT_REGISTERED')
})

await t('H: two administrators removing two different "last" holders at once -- exactly one succeeds (suspend vs suspend)', async () => {
  for (let round = 0; round < 3; round += 1) {
    const org = await mkOrg(`H${round}`); const x = await createStaffUser(`hx${round}`, run); const y = await createStaffUser(`hy${round}`, run)
    const a1 = await createStaffUser(`ha1${round}`, run); const a2 = await createStaffUser(`ha2${round}`, run)
    await assignRole(x, 'OWNER', scope(org)); await assignRole(y, 'OWNER', scope(org))
    const res = await Promise.all([
      code(suspendUser(p, { actorUserId: a1.id, targetUserId: x.id, reason: 'concurrent removal one' })),
      code(suspendUser(p, { actorUserId: a2.id, targetUserId: y.id, reason: 'concurrent removal two' })),
    ])
    assert.deepEqual([...res].sort(), ['LAST_AUTHORITY', 'OK'], `round ${round}: ${res}`)
    const active = await p.user.count({ where: { id: { in: [x.id, y.id] }, status: 'ACTIVE' } })
    assert.equal(active, 1, 'one valid Owner always remains')
  }
})

await t('H: revoke vs revoke, and suspend vs revoke, are serialized the same way', async () => {
  const org = await mkOrg('RV1'); const x = await createStaffUser('rx', run); const y = await createStaffUser('ry', run); const a1 = await createStaffUser('ra1', run); const a2 = await createStaffUser('ra2', run)
  const ax = await assignRole(x, 'OWNER', scope(org)); const ay = await assignRole(y, 'OWNER', scope(org))
  const res = await Promise.all([
    code(revokeAssignment(p, { actorUserId: a1.id, assignmentId: ax.id, reason: 'concurrent revoke one' })),
    code(revokeAssignment(p, { actorUserId: a2.id, assignmentId: ay.id, reason: 'concurrent revoke two' })),
  ])
  assert.deepEqual([...res].sort(), ['LAST_AUTHORITY', 'OK'], String(res))
  const org2 = await mkOrg('RV2'); const x2 = await createStaffUser('mx', run); const y2 = await createStaffUser('my', run)
  await assignRole(x2, 'OWNER', scope(org2)); const ay2 = await assignRole(y2, 'OWNER', scope(org2))
  const mixed = await Promise.all([
    code(suspendUser(p, { actorUserId: a1.id, targetUserId: x2.id, reason: 'mixed removal suspend' })),
    code(revokeAssignment(p, { actorUserId: a2.id, assignmentId: ay2.id, reason: 'mixed removal revoke' })),
  ])
  assert.deepEqual([...mixed].sort(), ['LAST_AUTHORITY', 'OK'], String(mixed))
  // different organizations do not block each other
  const o3 = await mkOrg('RV3'); const o4 = await mkOrg('RV4'); const s3 = await createStaffUser('s3', run); const s4 = await createStaffUser('s4', run); const k3 = await createStaffUser('k3', run); const k4 = await createStaffUser('k4', run)
  await assignRole(s3, 'OWNER', scope(o3)); await assignRole(k3, 'OWNER', scope(o3)); await assignRole(s4, 'OWNER', scope(o4)); await assignRole(k4, 'OWNER', scope(o4))
  const indep = await Promise.all([
    code(suspendUser(p, { actorUserId: a1.id, targetUserId: s3.id, reason: 'independent org three' })),
    code(suspendUser(p, { actorUserId: a2.id, targetUserId: s4.id, reason: 'independent org four' })),
  ])
  assert.deepEqual(indep, ['OK', 'OK'])
})

await t('I: no regression of the 48-hour rule (exactly 48 h on one clock; denied 1 ms before, allowed at the instant)', async () => {
  const org = await mkOrg('I'); const req = await createStaffUser('ireq', run); const rev = await createStaffUser('irev', run); const apr = await createStaffUser('iapr', run); const target = await createStaffUser('itgt', run)
  const g = await createAssignment(p, { actorUserId: req.id, targetUserId: target.id, roleVersionId: latestOwner.id, scopeRows: scope(org), reason: 'regression 48h grant' })
  assert.equal(g.assignment.status, 'PENDING_APPROVAL')
  await reviewAssignment(p, { actorUserId: rev.id, assignmentId: g.assignment.id, decision: 'APPROVE', reason: 'regression review' })
  const ok = await approveAssignment(p, { actorUserId: apr.id, assignmentId: g.assignment.id, reason: 'regression approval' })
  const row = await p.roleAssignment.findUnique({ where: { id: g.assignment.id } })
  assert.equal(ok.status, 'PENDING_ACTIVATION'); assert.equal((row.activationAt.getTime() - row.approvedAt.getTime()) / 3_600_000, 48)
  const ctx = { user: { id: target.id, status: 'ACTIVE' } }
  const at = (ms) => permissionSummary(ctx, ['user.view'], { now: new Date(ms) }).then((s) => s['user.view'])
  assert.equal(await at(row.activationAt.getTime() - 1), false); assert.equal(await at(row.activationAt.getTime()), true)
  assert.equal(await at(row.approvedAt.getTime() + 47 * 3_600_000), false)
})

await t('J: no regression of emergency suspension (immediate, CRITICAL, sessions revoked, history kept, last owner protected)', async () => {
  const org = await mkOrg('J'); const o1 = await createStaffUser('jo1', run); const o2 = await createStaffUser('jo2', run); const act = await createStaffUser('jact', run)
  const a1 = await assignRole(o1, 'OWNER', scope(org)); await assignRole(o2, 'OWNER', scope(org))
  await p.userSession.create({ data: { id: randomUUID(), userId: o1.id, expiresAt: new Date(Date.now() + 3_600_000) } })
  const out = await suspendUser(p, { actorUserId: act.id, targetUserId: o1.id, reason: 'emergency regression check', kind: 'EMERGENCY' })
  assert.equal(out.securityEvent.severity, 'CRITICAL'); assert.ok(out.sessionsRevoked >= 1)
  assert.equal((await p.user.findUnique({ where: { id: o1.id } })).status, 'SUSPENDED')
  assert.equal(await p.userSession.count({ where: { userId: o1.id, revokedAt: null } }), 0)
  assert.equal((await p.roleAssignment.findUnique({ where: { id: a1.id } })).status, 'ACTIVE', 'assignment history untouched')
  assert.equal(await code(suspendUser(p, { actorUserId: act.id, targetUserId: o2.id, reason: 'emergency on the last owner', kind: 'EMERGENCY' })), 'LAST_AUTHORITY')
})

const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
