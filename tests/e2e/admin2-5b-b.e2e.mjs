// STEP 5B part 2 (test DB only): activation worker (G-L) and last-authority continuity (M).
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { createStaffUser, assignRole, assignRoleVersion, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'
import { createAssignment, reviewAssignment, approveAssignment, revokeAssignment } from '../../server/lib/authz/assignment-workflow.mjs'
import { runActivationCycle } from '../../server/lib/authz/activation-worker.mjs'
import { suspendUser, reactivateUser } from '../../server/lib/authz/emergency.mjs'
import { permissionSummary } from '../../server/lib/authz/index.mjs'

const run = randomUUID().slice(0, 8)
const { t, summary } = makeRunner()
const p = db()
const mkOrg = async (tag) => p.organization.create({ data: { code: `T5C${tag}${run}`.slice(0, 30), name: `t5c ${tag} ${run}` } })
const scope = (org) => [{ kind: 'ORGANIZATION', organizationId: org.id }]
const code = async (promise) => { try { await promise; return 'OK' } catch (e) { return e.code || e.message } }
const latestOwner = await p.roleVersion.findFirst({ where: { status: 'EFFECTIVE', role: { code: 'OWNER' } } })
const org = await mkOrg('W')
const requester = await createStaffUser('req', run); const reviewer = await createStaffUser('rev', run); const approver = await createStaffUser('apr', run)
const pending = async (label) => {
  const target = await createStaffUser(label, run)
  const g = await createAssignment(p, { actorUserId: requester.id, targetUserId: target.id, roleVersionId: latestOwner.id, scopeRows: scope(org), reason: `worker test ${label}` })
  await reviewAssignment(p, { actorUserId: reviewer.id, assignmentId: g.assignment.id, decision: 'APPROVE', reason: 'reviewed for worker' })
  await approveAssignment(p, { actorUserId: approver.id, assignmentId: g.assignment.id, reason: 'approved for worker' })
  return { target, id: g.assignment.id }
}
const due = (id) => p.$executeRaw`UPDATE role_assignments SET activation_at = now() - interval '1 minute' WHERE id = ${id}::uuid`
const status = async (id) => (await p.roleAssignment.findUnique({ where: { id } })).status
const events = async (id) => (await p.roleAssignmentEvent.findMany({ where: { assignmentId: id }, orderBy: { createdAt: 'asc' } })).map((e) => e.eventType)

await t('H: worker does not activate an early grant', async () => {
  const e = await pending('early')
  await runActivationCycle(p)
  assert.equal(await status(e.id), 'PENDING_ACTIVATION')
  assert.ok(!(await events(e.id)).includes('ACTIVATED'))
})

await t('G/L: worker activates a due grant; evaluator already allowed it before the worker ran', async () => {
  const d = await pending('due'); const early = await pending('early2')
  await due(d.id)
  const ctx = (u) => ({ user: { id: u.id, status: 'ACTIVE' } })
  assert.equal((await permissionSummary(ctx(d.target), ['user.view']))['user.view'], true, 'evaluator enforces now >= activation_at itself (state not yet normalized)')
  assert.equal(await status(d.id), 'PENDING_ACTIVATION')
  assert.equal((await permissionSummary(ctx(early.target), ['user.view']))['user.view'], false, 'before activation_at the evaluator denies')
  await runActivationCycle(p)
  assert.equal(await status(d.id), 'ACTIVE'); assert.equal(await status(early.id), 'PENDING_ACTIVATION')
  assert.ok(await p.securityEvent.findFirst({ where: { entityId: d.id, eventType: 'HIGH_RISK_ACCESS_ACTIVATED' } }))
  assert.ok(await p.adminAuditLog.findFirst({ where: { entityId: d.id, action: 'iam.role_assignment.activated' } }))
  assert.ok((await events(d.id)).includes('ACTIVATED'))
  assert.equal((await permissionSummary(ctx(d.target), ['user.view']))['user.view'], true)
})

await t('I: a revoked pending grant never activates', async () => {
  const r = await pending('revoked'); await due(r.id)
  await revokeAssignment(p, { actorUserId: requester.id, assignmentId: r.id, reason: 'withdrawn during the wait' })
  await runActivationCycle(p)
  assert.equal(await status(r.id), 'REVOKED')
  assert.ok(!(await events(r.id)).includes('ACTIVATED'))
})

await t('J: a suspended target is not activated; activates after reactivation', async () => {
  const s = await pending('susp'); await due(s.id)
  await suspendUser(p, { actorUserId: requester.id, targetUserId: s.target.id, reason: 'suspended during the wait for test' })
  const r1 = await runActivationCycle(p)
  assert.equal(await status(s.id), 'PENDING_ACTIVATION'); assert.ok(r1.blocked >= 1)
  assert.ok(await p.roleAssignmentEvent.findFirst({ where: { assignmentId: s.id, eventType: 'ACTIVATION_BLOCKED' } }))
  await runActivationCycle(p)
  const blocks = await p.roleAssignmentEvent.count({ where: { assignmentId: s.id, eventType: 'ACTIVATION_BLOCKED' } })
  assert.equal(blocks, 1, 'a block is recorded once per reason')
  await reactivateUser(p, { actorUserId: approver.id, targetUserId: s.target.id, reason: 'reactivated for the test', acknowledgeAssignmentReview: true })
  await runActivationCycle(p)
  assert.equal(await status(s.id), 'ACTIVE')
})

await t('K: repeated and concurrent workers activate exactly once with no duplicated effects', async () => {
  const k = await pending('idem'); await due(k.id)
  const results = await Promise.all([runActivationCycle(p), runActivationCycle(p), runActivationCycle(p)])
  await runActivationCycle(p)
  assert.equal(await status(k.id), 'ACTIVE')
  assert.equal(await p.roleAssignmentEvent.count({ where: { assignmentId: k.id, eventType: 'ACTIVATED' } }), 1)
  assert.equal(await p.securityEvent.count({ where: { entityId: k.id, eventType: 'HIGH_RISK_ACCESS_ACTIVATED' } }), 1)
  assert.equal(await p.adminAuditLog.count({ where: { entityId: k.id, action: 'iam.role_assignment.activated' } }), 1)
  assert.ok(results.reduce((n, r) => n + r.errors, 0) === 0, 'no worker errored')
})

await t('M: last-authority protection (suspend, revoke, recovery path)', async () => {
  const o = await mkOrg('M')
  const sole = await createStaffUser('sole', run); const actor = await createStaffUser('actor', run); const actor2 = await createStaffUser('actor2', run)
  const soleA = await assignRole(sole, 'OWNER', scope(o))
  assert.equal(await code(suspendUser(p, { actorUserId: actor.id, targetUserId: sole.id, reason: 'attempt on the last owner' })), 'LAST_AUTHORITY')
  assert.equal(await code(suspendUser(p, { actorUserId: actor.id, targetUserId: sole.id, reason: 'emergency attempt on last owner', kind: 'EMERGENCY' })), 'LAST_AUTHORITY', 'emergency suspension is also bound by continuity')
  assert.equal(await code(revokeAssignment(p, { actorUserId: actor.id, assignmentId: soleA.id, reason: 'attempt to revoke the last owner' })), 'LAST_AUTHORITY')
  assert.equal((await p.user.findUnique({ where: { id: sole.id } })).status, 'ACTIVE')
  assert.equal(await status(soleA.id), 'ACTIVE')
  // recovery/transfer path: a second valid holder first, then the first can be suspended or removed
  const second = await createStaffUser('second', run); const secondA = await assignRole(second, 'OWNER', scope(o))
  assert.equal(await code(suspendUser(p, { actorUserId: actor.id, targetUserId: sole.id, reason: 'another owner remains now' })), 'OK')
  assert.equal(await code(suspendUser(p, { actorUserId: actor.id, targetUserId: second.id, reason: 'now second is the last owner' })), 'LAST_AUTHORITY')
  assert.equal(await code(revokeAssignment(p, { actorUserId: actor.id, assignmentId: secondA.id, reason: 'attempt to revoke the last remaining' })), 'LAST_AUTHORITY')
  // a suspended Owner does not count as a holder: reactivating restores the recovery path
  await reactivateUser(p, { actorUserId: actor2.id, targetUserId: sole.id, reason: 'recovered the first owner', acknowledgeAssignmentReview: true })
  assert.equal(await code(suspendUser(p, { actorUserId: actor.id, targetUserId: second.id, reason: 'first owner is back now' })), 'OK')
  // an organization that never had the capability is not blocked by it
  const o2 = await mkOrg('M2'); const plain = await createStaffUser('plain', run); await assignRole(plain, 'SUPPORT_AGENT', scope(o2))
  assert.equal(await code(suspendUser(p, { actorUserId: actor.id, targetUserId: plain.id, reason: 'ordinary support suspension' })), 'OK')
})

const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
