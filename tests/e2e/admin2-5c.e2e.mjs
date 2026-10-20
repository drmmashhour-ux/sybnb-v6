// STEP 5C part 1 (test DB only): the two bootstrap guards (A,B), secret lifecycle (C,D), trusted time (E), scheduler mode (F).
process.env.ADMIN_BOOTSTRAP_SECRET = 'test-bootstrap-secret-0123456789abcdef0123'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, assignRoleVersion, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'
import { completeBootstrapForRole as bootForRole } from '../support/bootstrap-test-adapter.mjs'
import { completeOwnerBootstrap, bootstrapSecretDiagnostics, BOOTSTRAP_REQUIRED, BOOTSTRAP_COMPLETED, SECRET_LEFT_CONFIGURED_WARNING } from '../../server/lib/authz/bootstrap.mjs'
import { createAssignment, reviewAssignment, approveAssignment } from '../../server/lib/authz/assignment-workflow.mjs'
import { permissionSummary } from '../../server/lib/authz/index.mjs'
import { verifyEvidenceChain } from '../../server/lib/authz/evidence.mjs'
import { syncClock, _resetClockForTests, clockStatus } from '../../server/lib/authz/clock.mjs'
import { runActivationCycle } from '../../server/lib/authz/activation-worker.mjs'

const run = randomUUID().slice(0, 8)
const { t, summary } = makeRunner()
const p = db()
const SECRET = process.env.ADMIN_BOOTSTRAP_SECRET
const STRONG = 'PASSWORD_PLUS_EMAIL_CODE'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mkOrg = async (tag) => {
  const org = await p.organization.create({ data: { code: `T5D${tag}${run}`.slice(0, 30), name: `t5c ${tag} ${run}` } })
  return org
}
const scope = (org) => [{ kind: 'ORGANIZATION', organizationId: org.id }]
const boot = (org, user, over = {}) => completeOwnerBootstrap(p, { actorUserId: user.id, organizationId: org.id, reason: 'initial Owner security bootstrap for the organization', operatorSecret: SECRET, authStrength: STRONG, requestId: `req-${run}`, ...over })
const bootRole = (roleCode, org, user, over = {}) => bootForRole(p, roleCode, { actorUserId: user.id, organizationId: org.id, reason: 'guard test bootstrap of a throwaway role', operatorSecret: SECRET, authStrength: STRONG, requestId: `req-${run}`, ...over })
const code = async (promise) => { try { await promise; return 'OK' } catch (e) { return e.code || e.message } }
const latestOwner = await p.roleVersion.findFirst({ where: { status: 'EFFECTIVE', role: { code: 'OWNER' } } })
const CONT = ['access.assign', 'access.approve', 'user.reactivate']

/** Throwaway role with the given versions (each a list of permission codes); the last one is EFFECTIVE. Never touches OWNER. */
async function mkRole(tag, versions) {
  const roleCode = `T5C_${tag}_${run}`
  const role = await p.role.create({ data: { code: roleCode, name: `t5c ${tag}`, description: 'step 5c guard test role' } })
  let prev = null
  for (let i = 0; i < versions.length; i += 1) {
    if (prev) await p.roleVersion.update({ where: { id: prev.id }, data: { status: 'SUPERSEDED', effectiveTo: new Date(Date.now() - 30_000) } })
    const rv = await p.roleVersion.create({ data: { roleId: role.id, versionNumber: i + 1, status: 'DRAFT', classification: i === 0 ? 'INITIAL' : 'REDUCING', platformCoverage: ['*'], contentHash: `h-${tag}-${i}-${run}`, changeReason: 'guard test', changeReference: 'STEP5C-TEST' } })
    const perms = await p.permissionDefinition.findMany({ where: { code: { in: versions[i] } } })
    assert.equal(perms.length, versions[i].length)
    await p.roleVersionPermission.createMany({ data: perms.map((x) => ({ roleVersionId: rv.id, permissionId: x.id })) })
    await p.roleVersion.update({ where: { id: rv.id }, data: { status: 'EFFECTIVE', effectiveFrom: new Date(Date.now() - 60_000) } })
    prev = rv
  }
  return { roleCode, role, latest: prev }
}
const snapshot = async (org, user) => ({
  state: (await p.securityBootstrap.findUnique({ where: { organizationId: org.id } })).state,
  assignments: (await p.roleAssignment.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true, roleVersionId: true, revokedAt: true } })),
  events: await p.roleAssignmentEvent.count({ where: { assignment: { userId: user.id } } }),
  completedAudit: await p.adminAuditLog.count({ where: { action: 'security.owner_bootstrap_completed', entityId: org.id } }),
  completedEvents: await p.securityEvent.count({ where: { eventType: 'OWNER_BOOTSTRAP_COMPLETED', entityId: org.id } }),
  evidence: await p.authorizationEvidence.count({ where: { action: 'owner_bootstrap', resourceId: org.id } }),
})
const denied = (org, c) => p.securityEvent.findFirst({ where: { eventType: 'OWNER_BOOTSTRAP_DENIED', entityId: org.id }, orderBy: { createdAt: 'desc' } }).then((e) => e && e.detail?.code === c ? e : null)

await t('A: LATEST_VERSION_INCOMPLETE -- the latest version lacks a continuity permission; nothing changes, bootstrap stays REQUIRED', async () => {
  const org = await mkOrg('A'); const u = await createStaffUser('incomplete', run)
  const { roleCode } = await mkRole('INC', [[...CONT, 'console.access'], ['access.assign', 'access.approve', 'console.access']]) // v2 has no user.reactivate
  await assignRoleVersion(u, roleCode, 1, scope(org))
  const before = await snapshot(org, u)
  assert.equal(await code(bootRole(roleCode, org, u)), 'LATEST_VERSION_INCOMPLETE')
  const after = await snapshot(org, u)
  assert.deepEqual(after, before, 'no partial migration: same assignments, events, audit, evidence, state')
  assert.equal(after.state, BOOTSTRAP_REQUIRED); assert.equal(after.assignments.length, 1); assert.equal(after.assignments[0].status, 'ACTIVE')
  assert.equal(after.completedEvents, 0)
  const ev = await denied(org, 'LATEST_VERSION_INCOMPLETE'); assert.ok(ev, 'denial recorded'); assert.equal(ev.severity, 'WARNING')
  assert.ok(await p.adminAuditLog.findFirst({ where: { action: 'security.owner_bootstrap_denied', entityId: org.id, reason: 'LATEST_VERSION_INCOMPLETE' } }))
  // the guard is a pre-write check; the rollback of a late failure is proven by test B
})

await t('B: WOULD_LEAVE_NO_AUTHORITY -- fails AFTER the new assignment was written, so the whole transaction must roll back', async () => {
  const org = await mkOrg('B'); const u = await createStaffUser('noauth', run)
  const { roleCode, role } = await mkRole('NOA', [[...CONT, 'console.access'], [...CONT, 'console.access']])
  await assignRoleVersion(u, roleCode, 1, scope(org))
  await p.role.update({ where: { id: role.id }, data: { status: 'RETIRED' } }) // a retired role confers no authority, so the migrated Owner would hold nothing
  const before = await snapshot(org, u)
  assert.equal(await code(bootRole(roleCode, org, u)), 'WOULD_LEAVE_NO_AUTHORITY')
  const after = await snapshot(org, u)
  assert.deepEqual(after, before, 'old assignment still ACTIVE and valid, new assignment not persisted, nothing completed')
  assert.equal(after.state, BOOTSTRAP_REQUIRED); assert.equal(after.assignments.length, 1); assert.equal(after.assignments[0].status, 'ACTIVE'); assert.equal(after.assignments[0].revokedAt, null)
  assert.equal(after.completedAudit, 0); assert.equal(after.completedEvents, 0); assert.equal(after.evidence, 0)
  const ev = await denied(org, 'WOULD_LEAVE_NO_AUTHORITY'); assert.ok(ev, 'the denied attempt is recorded'); assert.equal(ev.severity, 'WARNING')
  assert.ok(await p.adminAuditLog.findFirst({ where: { action: 'security.owner_bootstrap_denied', entityId: org.id, reason: 'WOULD_LEAVE_NO_AUTHORITY' } }))
  assert.equal((await verifyEvidenceChain(p)).ok, true)
})

await t('C/D: after completion the secret is ignored -- BOOTSTRAP_CLOSED comes first, whatever the secret, strength or reason', async () => {
  const org = await mkOrg('D'); const u = await createStaffUser('doneowner', run)
  await assignRoleVersion(u, 'OWNER', 1, scope(org))
  await boot(org, u)
  assert.equal((await p.securityBootstrap.findUnique({ where: { organizationId: org.id } })).state, BOOTSTRAP_COMPLETED)
  assert.equal(await code(boot(org, u)), 'BOOTSTRAP_CLOSED', 'correct secret still refused')
  assert.equal(await code(boot(org, u, { operatorSecret: 'not-the-secret' })), 'BOOTSTRAP_CLOSED', 'the secret is not even evaluated')
  assert.equal(await code(boot(org, u, { operatorSecret: undefined, authStrength: 'PASSWORD', reason: 'x' })), 'BOOTSTRAP_CLOSED', 'strength and reason are not evaluated either')
  const saved = process.env.ADMIN_BOOTSTRAP_SECRET; delete process.env.ADMIN_BOOTSTRAP_SECRET
  assert.equal(await code(boot(org, u)), 'BOOTSTRAP_CLOSED', 'not BOOTSTRAP_DISABLED: closed is answered before the deployment configuration is read')
  process.env.ADMIN_BOOTSTRAP_SECRET = saved
  assert.equal(await code(boot(org, await createStaffUser('other', run))), 'BOOTSTRAP_CLOSED')
  // a second organization still REQUIRED is unaffected by the first one closing, and its own secret rules still apply
  const org2 = await mkOrg('D2'); const u2 = await createStaffUser('owner2', run); await assignRoleVersion(u2, 'OWNER', 1, scope(org2))
  assert.equal(await code(boot(org2, u2, { operatorSecret: 'wrong' })), 'BOOTSTRAP_SECRET_INVALID')
})

await t('secret diagnostics: warns when a secret remains configured after completion; never exposes the value', async () => {
  const d = await bootstrapSecretDiagnostics(p)
  assert.equal(d.secretConfigured, true); assert.ok(d.organizationsCompleted >= 1)
  assert.equal(d.warning, SECRET_LEFT_CONFIGURED_WARNING); assert.match(d.instruction, /REMOVE OR ROTATE ADMIN_BOOTSTRAP_SECRET AFTER SUCCESSFUL BOOTSTRAP/)
  assert.equal(JSON.stringify(d).includes(SECRET), false)
  const saved = process.env.ADMIN_BOOTSTRAP_SECRET; delete process.env.ADMIN_BOOTSTRAP_SECRET
  const none = await bootstrapSecretDiagnostics(p)
  assert.equal(none.secretConfigured, false); assert.equal(none.warning, null)
  process.env.ADMIN_BOOTSTRAP_SECRET = saved
  // no security event, audit row or log line ever carries the secret
  const leaked = await p.securityEvent.count({ where: { detail: { string_contains: SECRET } } }).catch(() => 0)
  assert.equal(leaked, 0)
  assert.equal(await p.adminAuditLog.count({ where: { reason: { contains: SECRET } } }), 0)
})

const withSkew = async (ms, fn) => {
  const Real = Date
  class Skew extends Real {
    constructor(...a) { if (a.length === 0) super(Real.now() + ms); else super(...a) }
    static now() { return Real.now() + ms }
  }
  globalThis.Date = Skew
  try { return await fn() } finally { globalThis.Date = Real }
}

await t('E: trusted time -- bootstrap and a fresh grant work whatever the application clock says (+8 s, -8 s)', async () => {
  for (const skew of [8_000, -8_000]) {
    _resetClockForTests()
    const org = await mkOrg(`S${skew > 0 ? 'p' : 'm'}`); const u = await createStaffUser(`skew${skew}`, run)
    await assignRoleVersion(u, 'OWNER', 1, scope(org))
    await withSkew(skew, async () => {
      await syncClock(p)
      assert.ok(Math.abs(clockStatus().offsetMs + skew) < 1_500, `offset ${clockStatus().offsetMs} should undo the ${skew} ms skew`)
      const r = await boot(org, u)
      assert.equal(r.newRoleVersion, latestOwner.versionNumber, 'bootstrap succeeds: its own timestamp comes from the database transaction')
      const sum = await permissionSummary({ user: { id: u.id, status: 'ACTIVE' } }, ['access.assign', 'user.view'])
      assert.equal(sum['user.view'], true, 'the evaluator, corrected to the database clock, sees the new grant immediately')
      const row = await p.roleAssignment.findUnique({ where: { id: r.newAssignmentId } })
      assert.ok(Math.abs(row.effectiveFrom.getTime() - row.activationAt.getTime()) === 0 && Math.abs(row.approvedAt.getTime() - row.effectiveFrom.getTime()) === 0, 'one timestamp for effective_from / approved_at / activation_at')
    })
  }
  _resetClockForTests()
})

await t('E: trusted time -- a skewed application clock can never make a pending grant active early', async () => {
  _resetClockForTests()
  const org = await mkOrg('SB'); const req = await createStaffUser('breq', run); const rev = await createStaffUser('brev', run); const apr = await createStaffUser('bapr', run); const target = await createStaffUser('btarget', run)
  const g = await createAssignment(p, { actorUserId: req.id, targetUserId: target.id, roleVersionId: latestOwner.id, scopeRows: scope(org), reason: 'boundary test grant' })
  await reviewAssignment(p, { actorUserId: rev.id, assignmentId: g.assignment.id, decision: 'APPROVE', reason: 'reviewed for boundary' })
  await approveAssignment(p, { actorUserId: apr.id, assignmentId: g.assignment.id, reason: 'approved for boundary' })
  const row = await p.roleAssignment.findUnique({ where: { id: g.assignment.id } })
  assert.equal((row.activationAt.getTime() - row.approvedAt.getTime()) / 3_600_000, 48, '48 h measured on one (database) clock')
  await p.$executeRaw`UPDATE role_assignments SET activation_at = now() + interval '3 seconds' WHERE id = ${g.assignment.id}::uuid`
  const ctx = { user: { id: target.id, status: 'ACTIVE' } }
  await withSkew(10_000, async () => { // the host clock is 10 s fast; the corrector must undo that
    await syncClock(p)
    assert.equal((await permissionSummary(ctx, ['user.view']))['user.view'], false, 'denied before activation_at despite the fast host clock')
    await sleep(3_600)
    assert.equal((await permissionSummary(ctx, ['user.view']))['user.view'], true, 'allowed once the database clock passes activation_at (worker has not run)')
  })
  assert.equal((await p.roleAssignment.findUnique({ where: { id: g.assignment.id } })).status, 'PENDING_ACTIVATION')
  _resetClockForTests()
})

await t('F: scheduler deployment mode -- EXTERNAL starts no in-process job; IN_PROCESS does; the external runner works', async () => {
  const org = await mkOrg('F')
  const mk = async (label) => {
    const req = await createStaffUser(`${label}rq`, run); const rev = await createStaffUser(`${label}rv`, run); const apr = await createStaffUser(`${label}ap`, run); const target = await createStaffUser(`${label}tg`, run)
    const g = await createAssignment(p, { actorUserId: req.id, targetUserId: target.id, roleVersionId: latestOwner.id, scopeRows: scope(org), reason: `scheduler mode ${label}` })
    await reviewAssignment(p, { actorUserId: rev.id, assignmentId: g.assignment.id, decision: 'APPROVE', reason: 'reviewed for mode' })
    await approveAssignment(p, { actorUserId: apr.id, assignmentId: g.assignment.id, reason: 'approved for mode' })
    await p.$executeRaw`UPDATE role_assignments SET activation_at = now() - interval '1 minute' WHERE id = ${g.assignment.id}::uuid`
    return g.assignment.id
  }
  const status = async (id) => (await p.roleAssignment.findUnique({ where: { id } })).status
  const ext = await mk('ext')
  const apiExt = await startApi({ ADMIN_ACTIVATION_MODE: 'EXTERNAL', ADMIN_ACTIVATION_INTERVAL_MS: '5000' })
  try {
    await sleep(9_000)
    assert.equal(await status(ext), 'PENDING_ACTIVATION', 'EXTERNAL: the API did not run the schedule')
    assert.match(apiExt.logs(), /activation_mode[^\n]*EXTERNAL/)
  } finally { apiExt.stop() }
  const r = spawnSync(process.execPath, ['scripts/admin-activation-run.mjs'], { env: process.env, encoding: 'utf8', timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(await status(ext), 'ACTIVE', 'the external runner activated it')
  const inproc = await mk('inp')
  const apiIn = await startApi({ ADMIN_ACTIVATION_MODE: 'IN_PROCESS', ADMIN_ACTIVATION_INTERVAL_MS: '5000' })
  try {
    let ok = false
    for (let i = 0; i < 30 && !ok; i += 1) { await sleep(1_000); ok = (await status(inproc)) === 'ACTIVE' }
    assert.ok(ok, 'IN_PROCESS: the API ran the schedule')
    assert.match(apiIn.logs(), /activation_mode[^\n]*IN_PROCESS/)
  } finally { apiIn.stop() }
  const disabled = await mk('dis')
  const apiOff = await startApi({ ADMIN_ACTIVATION_MODE: 'DISABLED', ADMIN_ACTIVATION_INTERVAL_MS: '5000' })
  try { await sleep(7_000); assert.equal(await status(disabled), 'PENDING_ACTIVATION', 'DISABLED: nothing runs'); } finally { apiOff.stop() }
  await runActivationCycle(p)
})

const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
