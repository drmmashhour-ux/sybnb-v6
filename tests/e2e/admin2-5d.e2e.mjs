// STEP 5D (test DB only): security-time readiness against the real DB (A), guaranteed bootstrap provisioning (B),
// REQUIRED/COMPLETED shape + referential integrity (C), mandatory ruleset_version (D), HTTP closed-first + health (E).
process.env.ADMIN_BOOTSTRAP_SECRET = 'test-bootstrap-secret-0123456789abcdef0123'
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRoleVersion, makeRunner, randomUUID, client } from './helpers/admin2-harness.mjs'
import { completeOwnerBootstrap, BOOTSTRAP_COMPLETED, BOOTSTRAP_REQUIRED } from '../../server/lib/authz/bootstrap.mjs'
import { can, authorize } from '../../server/lib/authz/index.mjs'
import { writeEvidence, verifyEvidenceChain, LEGACY_RULESET_VERSION } from '../../server/lib/authz/evidence.mjs'
import { PERMISSION_RULESET_VERSION } from '../../server/lib/authz/catalogue.mjs'
import { syncClock, securityTimeStatus, _resetClockForTests, _ageClockSampleForTests, DEFAULT_MAX_SAMPLE_AGE_MS } from '../../server/lib/authz/clock.mjs'

const run = randomUUID().slice(0, 8)
const { t, summary } = makeRunner()
const p = db()
const SECRET = process.env.ADMIN_BOOTSTRAP_SECRET
const STRONG = 'PASSWORD_PLUS_EMAIL_CODE'
const mkOrg = (tag) => p.organization.create({ data: { code: `T5D${tag}${run}`.slice(0, 30), name: `t5d ${tag} ${run}` } })
const scope = (org) => [{ kind: 'ORGANIZATION', organizationId: org.id }]
const boot = (org, user, over = {}) => completeOwnerBootstrap(p, { actorUserId: user.id, organizationId: org.id, reason: 'initial Owner security bootstrap for the organization', operatorSecret: SECRET, authStrength: STRONG, requestId: `req-${run}`, ...over })
const rejected = async (promise) => { try { await promise; return null } catch (e) { return String(e.meta?.message || e.message).replace(/\s+/g, ' ') } }
const bootRow = (org) => p.securityBootstrap.findUnique({ where: { organizationId: org.id } })
const COMPLETION_FIELDS = ['completedAt', 'completedById', 'targetUserId', 'oldAssignmentId', 'newAssignmentId', 'oldRoleVersionId', 'newRoleVersionId', 'reason', 'workflowUnavailableReason', 'securityEventId', 'auditEventId', 'evidenceId']

await t('A: trusted time end to end -- before the first sample high-risk permissions fail closed, reads still work; ready; stale; recovery', async () => {
  const org = await mkOrg('A'); const u = await createStaffUser('time', run)
  await assignRoleVersion(u, 'OWNER', 1, scope(org))
  const session = await p.userSession.create({ data: { userId: u.id, expiresAt: new Date(Date.now() + 3_600_000), mfaMethod: 'EMAIL_OTP' } })
  const ctx = { user: { id: u.id, status: 'ACTIVE' }, sessionId: session.id }
  const res = { type: 'time_test', facts: { organizationId: org.id } }
  const evidenceCount = (reason) => p.authorizationEvidence.count({ where: { userId: u.id, permissionCode: 'access.assign', denyReason: reason } })

  _resetClockForTests() // simulate: process just started, no database clock sample yet
  assert.equal(securityTimeStatus().ready, false)
  assert.equal((await can(ctx, 'user.view', res)).decision, 'ALLOW', 'a harmless read is not blocked before trusted time exists')
  const early = await can(ctx, 'access.assign', res)
  assert.equal(early.decision, 'DENY'); assert.equal(early.reason, 'SECURITY_TIME_NOT_READY')
  assert.equal(await evidenceCount('SECURITY_TIME_NOT_READY'), 1, 'the fail-closed denial of a tier-4 permission is itself recorded as evidence')
  await assert.rejects(authorize(ctx, 'access.assign', res), (e) => e.statusCode === 403 && e.code === 'PERMISSION_DENIED', 'callers see a plain denial (no rule enumeration)')

  await syncClock(p) // first database clock sample => ready
  assert.equal(securityTimeStatus().ready, true)
  assert.equal((await can(ctx, 'access.assign', res)).decision, 'ALLOW', 'once trusted time is ready the same request is allowed')

  _ageClockSampleForTests(DEFAULT_MAX_SAMPLE_AGE_MS + 5_000) // clock sync has been unavailable for longer than the bound
  const st = securityTimeStatus(); assert.equal(st.ready, false); assert.equal(st.reason, 'STALE')
  assert.equal((await can(ctx, 'access.assign', res)).reason, 'SECURITY_TIME_NOT_READY', 'stale sample: privileged time-sensitive authorization fails closed')
  assert.equal((await can(ctx, 'user.view', res)).decision, 'ALLOW', 'stale sample: harmless reads continue')

  await syncClock(p) // recovery after resampling
  assert.equal(securityTimeStatus().ready, true)
  assert.equal((await can(ctx, 'access.assign', res)).decision, 'ALLOW', 'recovered after resampling')
  assert.equal(await evidenceCount('SECURITY_TIME_NOT_READY'), 3, 'two NOT_READY denials before the first sample (can + authorize), one while stale')
})

await t('B: a new organization automatically gets exactly one REQUIRED bootstrap row, in the same transaction', async () => {
  const org = await mkOrg('B1')
  const rows = await p.securityBootstrap.findMany({ where: { organizationId: org.id } })
  assert.equal(rows.length, 1); assert.equal(rows[0].state, BOOTSTRAP_REQUIRED)
  for (const f of COMPLETION_FIELDS) assert.equal(rows[0][f], null, f)
  // bulk and nested creation paths get it too
  await p.organization.createMany({ data: [1, 2, 3].map((i) => ({ code: `T5DB2${i}${run}`.slice(0, 30), name: `t5d bulk ${i} ${run}` })) })
  const bulk = await p.organization.findMany({ where: { code: { startsWith: `T5DB2` }, name: { endsWith: run } }, select: { id: true } })
  assert.equal(bulk.length, 3)
  assert.equal(await p.securityBootstrap.count({ where: { organizationId: { in: bulk.map((o) => o.id) }, state: BOOTSTRAP_REQUIRED } }), 3)
  // rolled-back organization creation leaves no orphan bootstrap row
  const ghostId = randomUUID()
  await rejected(p.$transaction(async (tx) => { await tx.organization.create({ data: { id: ghostId, code: `T5DB3${run}`.slice(0, 30), name: 'ghost' } }); throw new Error('abort') }))
  assert.equal(await p.securityBootstrap.count({ where: { organizationId: ghostId } }), 0)
  // no organization anywhere lacks a row
  const [{ missing }] = await p.$queryRaw`SELECT count(*)::int AS missing FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM security_bootstrap b WHERE b.organization_id = o.id)`
  assert.equal(missing, 0)
  // exactly one: a second row cannot exist; an explicit insert is harmless only with ON CONFLICT
  assert.ok(await rejected(p.$executeRaw`INSERT INTO security_bootstrap (organization_id) VALUES (${org.id}::uuid)`))
  await p.$executeRaw`INSERT INTO security_bootstrap (organization_id) VALUES (${org.id}::uuid) ON CONFLICT (organization_id) DO NOTHING`
  assert.equal(await p.securityBootstrap.count({ where: { organizationId: org.id } }), 1)
})

await t('B: REQUIRED rows are removable only together with their evidence-free organization', async () => {
  const org = await mkOrg('B4')
  assert.match(await rejected(p.$executeRaw`DELETE FROM security_bootstrap WHERE organization_id = ${org.id}::uuid`) ?? '', /never deleted/)
  await p.organization.delete({ where: { id: org.id } })
  assert.equal(await p.securityBootstrap.count({ where: { organizationId: org.id } }), 0)
})

await t('C: a REQUIRED row can never look partially completed (every completion field is rejected individually)', async () => {
  const org = await mkOrg('C1'); const u = await createStaffUser('shape', run)
  const asg = await assignRoleVersion(u, 'OWNER', 1, scope(org))
  const any = { role: await p.roleVersion.findFirst({ select: { id: true } }), ev: await p.securityEvent.findFirst({ select: { id: true } }), au: await p.adminAuditLog.findFirst({ select: { id: true } }), evd: await p.authorizationEvidence.findFirst({ select: { id: true } }) }
  const sets = {
    completed_at: 'completed_at = now()', completed_by_id: `completed_by_id = '${u.id}'`, target_user_id: `target_user_id = '${u.id}'`,
    old_assignment_id: `old_assignment_id = '${asg.id}'`, new_assignment_id: `new_assignment_id = '${asg.id}'`,
    old_role_version_id: `old_role_version_id = '${any.role.id}'`, new_role_version_id: `new_role_version_id = '${any.role.id}'`,
    reason: `reason = 'partial completion attempt'`, workflow_unavailable_reason: `workflow_unavailable_reason = 'partial'`,
    security_event_id: `security_event_id = '${any.ev.id}'`, audit_event_id: `audit_event_id = '${any.au.id}'`, evidence_id: `evidence_id = '${any.evd.id}'`,
  }
  for (const [name, set] of Object.entries(sets)) {
    const msg = await rejected(p.$executeRawUnsafe(`UPDATE security_bootstrap SET ${set} WHERE organization_id = '${org.id}'`))
    assert.match(msg ?? 'ALLOWED', /security_bootstrap_shape_chk/, `${name} must be rejected while REQUIRED`)
  }
  assert.equal((await bootRow(org)).state, BOOTSTRAP_REQUIRED)
  // flipping the state alone is also rejected (COMPLETED needs every field)
  assert.match(await rejected(p.$executeRawUnsafe(`UPDATE security_bootstrap SET state = 'SECURITY_BOOTSTRAP_COMPLETED', completed_at = now() WHERE organization_id = '${org.id}'`)) ?? 'ALLOWED', /shape_chk/)
})

await t('C: all ten references are RESTRICT/RESTRICT foreign keys', async () => {
  const fks = await p.$queryRaw`SELECT conname, confdeltype::text AS del, confupdtype::text AS upd, confrelid::regclass::text AS ref FROM pg_constraint WHERE conrelid = 'security_bootstrap'::regclass AND contype = 'f' ORDER BY conname`
  assert.equal(fks.length, 10)
  for (const f of fks) { assert.equal(f.del, 'r', f.conname); assert.equal(f.upd, 'r', f.conname) }
  assert.deepEqual(fks.map((f) => f.ref).sort(), ['admin_audit_logs', 'authorization_evidence', 'organizations', 'role_assignments', 'role_assignments', 'role_versions', 'role_versions', 'security_events', 'users', 'users'])
})

const completed = await (async () => {
  const org = await mkOrg('C2'); const u = await createStaffUser('done', run)
  await assignRoleVersion(u, 'OWNER', 1, scope(org))
  const out = await boot(org, u)
  return { org, u, out }
})()

await t('C: a COMPLETED row is fully populated, terminal, and its referenced evidence cannot be deleted or re-keyed', async () => {
  const { org, u, out } = completed
  const row = await bootRow(org)
  assert.equal(row.state, BOOTSTRAP_COMPLETED)
  for (const f of COMPLETION_FIELDS) assert.notEqual(row[f], null, f)
  assert.equal(row.targetUserId, u.id); assert.equal(row.completedById, u.id); assert.equal(row.newAssignmentId, out.newAssignmentId)
  assert.match(await rejected(p.$executeRaw`UPDATE security_bootstrap SET reason = 'edited later' WHERE organization_id = ${org.id}::uuid`) ?? 'ALLOWED', /permanently closed/)
  assert.match(await rejected(p.$executeRaw`DELETE FROM security_bootstrap WHERE organization_id = ${org.id}::uuid`) ?? 'ALLOWED', /never deleted/)
  assert.ok(await rejected(p.organization.delete({ where: { id: org.id } })), 'an organization with completed bootstrap evidence cannot be deleted')
  assert.equal(await p.securityBootstrap.count({ where: { organizationId: org.id } }), 1)
  // foreign-key level (not masked by append-only triggers): re-keying or deleting referenced rows is refused
  assert.ok(await rejected(p.$executeRaw`UPDATE users SET id = gen_random_uuid() WHERE id = ${u.id}::uuid`), 'a referenced person cannot be re-keyed')
  assert.match(await rejected(p.$executeRaw`DELETE FROM users WHERE id = ${u.id}::uuid`) ?? 'ALLOWED', /foreign key|violates|append-only/i)
  assert.ok(await rejected(p.$executeRaw`DELETE FROM authorization_evidence WHERE id = ${out.evidenceId}::uuid`))
  assert.ok(await rejected(p.$executeRaw`DELETE FROM security_events WHERE id = ${out.securityEventId}::uuid`))
  assert.ok(await rejected(p.$executeRaw`DELETE FROM admin_audit_logs WHERE id = ${out.auditEventId}::uuid`))
  assert.ok(await rejected(p.$executeRaw`DELETE FROM role_assignments WHERE id = ${out.newAssignmentId}::uuid`))
  assert.ok(await rejected(p.$executeRaw`UPDATE role_versions SET id = gen_random_uuid() WHERE id = ${row.newRoleVersionId}::uuid`))
  assert.equal((await bootRow(org)).state, BOOTSTRAP_COMPLETED)
})

await t('D: ruleset_version is mandatory for new evidence; historical rows carry the explicit legacy marker and still verify', async () => {
  const [{ nullable }] = await p.$queryRaw`SELECT is_nullable AS nullable FROM information_schema.columns WHERE table_name = 'authorization_evidence' AND column_name = 'ruleset_version'`
  assert.equal(nullable, 'NO')
  const base = { userId: null, permissionCode: 'user.view', action: 'view', decision: 'ALLOW' }
  for (const bad of [undefined, null, '', '   ', LEGACY_RULESET_VERSION]) {
    const e = await p.$transaction((tx) => writeEvidence(tx, { ...base, rulesetVersion: bad })).catch((x) => x)
    assert.equal(e?.code, 'EVIDENCE_RULESET_REQUIRED', `writer must refuse ${JSON.stringify(bad)}`)
  }
  assert.match(await rejected(p.$executeRaw`INSERT INTO authorization_evidence (id, permission_code, action, decision, hash) VALUES (gen_random_uuid(), 'x.y', 'a', 'ALLOW', 'h')`) ?? 'ALLOWED', /null value|not-null|Failing row/i)
  assert.match(await rejected(p.$executeRaw`INSERT INTO authorization_evidence (id, permission_code, action, decision, hash, ruleset_version) VALUES (gen_random_uuid(), 'x.y', 'a', 'ALLOW', 'h', '  ')`) ?? 'ALLOWED', /ruleset_version_chk/)
  const good = await p.$transaction((tx) => writeEvidence(tx, { ...base, rulesetVersion: PERMISSION_RULESET_VERSION }))
  assert.equal(good.rulesetVersion, PERMISSION_RULESET_VERSION)
  const [{ legacy, modern }] = await p.$queryRaw`SELECT count(*) FILTER (WHERE ruleset_version = 'LEGACY_PRE_VERSIONED')::int AS legacy, count(*) FILTER (WHERE ruleset_version <> 'LEGACY_PRE_VERSIONED')::int AS modern FROM authorization_evidence`
  assert.ok(legacy > 0, 'historical evidence exists and is marked LEGACY_PRE_VERSIONED'); assert.ok(modern > 0)
  const chain = await verifyEvidenceChain(p)
  assert.equal(chain.ok, true, `chain must verify across legacy and versioned rows: ${JSON.stringify(chain)}`)
  assert.match(await rejected(p.$executeRaw`UPDATE authorization_evidence SET ruleset_version = 'CHANGED' WHERE ruleset_version = 'LEGACY_PRE_VERSIONED'`) ?? 'ALLOWED', /append-only/)
})

await t('E: HTTP -- COMPLETED bootstrap answers BOOTSTRAP_CLOSED before any privileged validation (wrong secret, missing reason, no secret); a role-less user is simply denied; health reports securityTimeReady', async () => {
  await p.rateLimitBucket.deleteMany({ where: { bucketKey: { contains: 'admin2-bootstrap' } } }) // test hygiene: per-IP counters persist across runs
  const api = await startApi({ ADMIN_ACTIVATION_JOB: 'off' })
  try {
    // health: public, boolean only
    let health = null
    for (let i = 0; i < 40; i += 1) { health = (await client(api.base).get('/api/health')).json; if (health?.securityTimeReady) break; await new Promise((r) => setTimeout(r, 500)) }
    assert.equal(health.securityTimeReady, true, 'the API marks security time READY after its start-up database sample')
    assert.equal(typeof health.securityTimeReady, 'boolean')
    assert.equal(JSON.stringify(health).includes('offset'), false, 'no clock internals on the public health endpoint')
    assert.match(api.logs(), /security_time_ready/)

    const owner = completed.u
    const s = await loginAsStaff(api, owner)
    const url = '/api/admin2/security/bootstrap/owner' // STEP 5E: no organization override; the Owner's own organization is resolved server-side
    const before = await p.securityBootstrap.findUnique({ where: { organizationId: completed.org.id } })
    const cases = [
      ['wrong secret', { reason: 'attempt with the wrong operator secret', }, { 'x-bootstrap-secret': 'definitely-not-the-secret-0123456789abcd' }],
      ['correct secret still configured', { reason: 'attempt with the right operator secret after completion' }, { 'x-bootstrap-secret': SECRET }],
      ['missing reason', {}, { 'x-bootstrap-secret': 'wrong' }],
      ['no secret header at all', { reason: 'x' }, {}],
    ]
    for (const [label, body, headers] of cases) {
      const r = await s.http.call('POST', url, body, headers)
      assert.equal(r.status, 409, `${label}: ${r.text.slice(0, 160)}`)
      assert.equal(r.json?.error?.code ?? r.json?.code, 'BOOTSTRAP_CLOSED', label)
    }
    // a user with no Owner assignment has no bootstrap organization: a plain denial (it is not told the bootstrap state)
    const weak = await createStaffUser('weakhttp', run)
    const w = await loginAsStaff(api, weak)
    const rw = await w.http.call('POST', url, { reason: 'a user without any role tries to bootstrap' }, { 'x-bootstrap-secret': SECRET })
    assert.equal(rw.status, 403); assert.equal(rw.json?.error?.code ?? rw.json?.code, 'PERMISSION_DENIED')
    const after = await p.securityBootstrap.findUnique({ where: { organizationId: completed.org.id } })
    assert.deepEqual(after, before, 'the completed bootstrap record is untouched')
    assert.ok(await p.securityEvent.count({ where: { eventType: 'OWNER_BOOTSTRAP_DENIED', entityId: completed.org.id } }) >= 4, 'each closed attempt was recorded')
  } finally { api.stop() }
})

const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
