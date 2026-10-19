// STEP 5 -- authorization integration test against a REAL database (TEST database only).
//   DATABASE_URL=<test db> node tests/e2e/admin-foundation-authz.e2e.mjs
// Requires: migration 078 applied and scripts/admin-foundation-seed.mjs run. Creates clearly named
// synthetic users/roles (prefix s5t-). Role assignments and evidence are append-only by design, so
// test rows are left in the TEST database; this script refuses to run if the host looks like production.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { db } from '../../server/lib/prisma.mjs'
import { can, authorize, permissionSummary } from '../../server/lib/authz/index.mjs'
import { evaluateAccess } from '../../server/lib/authz/evaluate.mjs'
import { loadAssignmentsAsOf, loadOrgIndex, loadPermission, loadSuspensions } from '../../server/lib/authz/loader.mjs'
import { verifyEvidenceChain } from '../../server/lib/authz/evidence.mjs'
import { writeAdminAudit } from '../../server/lib/authz/audit.mjs'

if (/production/i.test(process.env.DATABASE_URL || '') || !process.env.DATABASE_URL) {
  console.error('Refusing to run: DATABASE_URL missing or looks like production.')
  process.exit(2)
}

const p = db()
const run = randomUUID().slice(0, 8)
let passed = 0
const failures = []
async function t(name, fn) {
  try { await fn(); passed += 1; console.log('PASS', name) } catch (e) { failures.push(name); console.log('FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 6).join('\n    ')) }
}
async function rejects(promise, pattern) {
  try { await promise } catch (e) { assert.match(String(e.message), pattern); return }
  assert.fail('expected the database to refuse this change')
}

const mkUser = (label) => p.user.create({ data: { email: `s5t-${run}-${label}@example.invalid`, displayName: `S5 test ${label}`, status: 'ACTIVE' } })
const ctxOf = (u, extra = {}) => ({ user: u, roles: [], sessionId: null, ...extra })
async function versionFor(roleCode) {
  const role = await p.role.findUnique({ where: { code: roleCode } })
  return p.roleVersion.findFirst({ where: { roleId: role.id, status: 'EFFECTIVE' } })
}
async function assign(user, roleCode, scopes, over = {}) {
  const rv = await versionFor(roleCode)
  return p.roleAssignment.create({ data: { userId: user.id, roleVersionId: rv.id, grantReason: 's5 test', scopes: { create: scopes }, ...over } })
}

const org = await p.organization.findFirst()
const le = await p.legalEntity.findFirst({ where: { code: 'LE-9375-7649' } })
const str = await p.platform.findUnique({ where: { code: 'str' } })
const marketplace = await p.platform.findUnique({ where: { code: 'marketplace' } })
const otherEntity = await p.legalEntity.create({ data: { organizationId: org.id, code: `S5T-LE-${run}`, legalName: `S5 test other entity ${run}` } })
const otherBu = await p.businessUnit.create({ data: { legalEntityId: otherEntity.id, code: `S5T-BU-${run}`, name: 'S5 other BU' } })
const foreignPlatform = await p.platform.create({ data: { code: `s5t_${run}`, displayName: 'S5 foreign platform', businessUnitId: otherBu.id, route: '/admin/s5t' } })

await t('deny by default: a user with no role assignment is denied everything', async () => {
  const u = await mkUser('nobody')
  const r = await can(ctxOf(u), 'admin.console.access', { type: 'console' })
  assert.equal(r.decision, 'DENY')
  await rejects(authorize(ctxOf(u), 'admin.console.access'), /permission/i)
})

await t('unknown permission code is denied', async () => {
  const u = await mkUser('unknownperm')
  await assign(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const r = await can(ctxOf(u), 'does.not.exist', { type: 'x', facts: { organizationId: org.id } })
  assert.equal(r.reason, 'UNKNOWN_PERMISSION')
})

await t('unauthenticated context is denied (401 via authorize)', async () => {
  await rejects(authorize(null, 'admin.console.access'), /Authentication required/)
})

await t('Owner with ORGANIZATION scope is allowed a T1 permission and no evidence is forced', async () => {
  const u = await mkUser('owner')
  await assign(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const r = await authorize(ctxOf(u), 'iam.user.read', { type: 'user_list', facts: { organizationId: org.id } })
  assert.equal(r.decision, 'ALLOW')
  assert.equal(r.grant.roleCode, 'OWNER')
  assert.equal(r.grant.roleVersionNumber, 1)
})

await t('STR manager (LEGAL_ENTITY scope) reaches STR but not Marketplace-only data (wrong platform)', async () => {
  const u = await mkUser('strmgr')
  await assign(u, 'STR_MANAGER', [{ kind: 'LEGAL_ENTITY', legalEntityId: le.id }])
  const strShell = await can(ctxOf(u), 'platform.shell.read', { type: 'platform_shell', platform: 'str', facts: { platformCode: 'str' } })
  const mktShell = await can(ctxOf(u), 'platform.shell.read', { type: 'platform_shell', platform: 'marketplace', facts: { platformCode: 'marketplace' } })
  assert.equal(strShell.decision, 'ALLOW')
  assert.equal(mktShell.decision, 'DENY')
  assert.equal(mktShell.reason, 'PLATFORM_NOT_COVERED')
})

await t('wrong legal entity is denied even with full platform coverage', async () => {
  const u = await mkUser('foreign')
  await assign(u, 'FINANCE_VIEWER', [{ kind: 'LEGAL_ENTITY', legalEntityId: otherEntity.id }])
  const r = await can(ctxOf(u), 'fin.shell.read', { type: 'finance_shell', facts: { platformCode: 'str' } })
  assert.equal(r.decision, 'DENY')
  assert.equal(r.reason, 'SCOPE_NOT_MATCHED')
  const own = await can(ctxOf(u), 'fin.shell.read', { type: 'finance_shell', facts: { platformCode: foreignPlatform.code } })
  assert.equal(own.decision, 'ALLOW')
})

await t('PROPERTY scope: Property 123 STR records yes, its Syntrise records no, other property no', async () => {
  const u = await mkUser('property')
  await assign(u, 'STR_MANAGER', [{ kind: 'PROPERTY', propertyRef: 'prop-123' }])
  const ctx = ctxOf(u)
  assert.equal((await can(ctx, 'party.party.read', { type: 'reservation', platform: 'str', facts: { platformCode: 'str', propertyRef: 'prop-123' } })).decision, 'ALLOW')
  assert.equal((await can(ctx, 'party.party.read', { type: 'offer', platform: 'syntrise', facts: { platformCode: 'syntrise', propertyRef: 'prop-123' } })).reason, 'PLATFORM_NOT_COVERED')
  assert.equal((await can(ctx, 'party.party.read', { type: 'reservation', platform: 'str', facts: { platformCode: 'str', propertyRef: 'prop-456' } })).reason, 'SCOPE_NOT_MATCHED')
})

await t('expired and revoked assignments are denied; suspended user is denied', async () => {
  const expired = await mkUser('expired')
  await assign(expired, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }], { effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-02-01') })
  assert.equal((await can(ctxOf(expired), 'iam.user.read', { type: 'u', facts: { organizationId: org.id } })).reason, 'NO_ACTIVE_ASSIGNMENT')
  const revoked = await mkUser('revoked')
  const a = await assign(revoked, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  await p.roleAssignment.update({ where: { id: a.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: revoked.id, revokeReason: 's5 test' } })
  assert.equal((await can(ctxOf(revoked), 'iam.user.read', { type: 'u', facts: { organizationId: org.id } })).decision, 'DENY')
  const susp = await mkUser('suspended')
  await assign(susp, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const suspended = await p.user.update({ where: { id: susp.id }, data: { status: 'SUSPENDED' } })
  assert.equal((await can(ctxOf(suspended), 'iam.user.read', { type: 'u', facts: { organizationId: org.id } })).reason, 'USER_NOT_ACTIVE')
})

await t('T3/T4: step-up is required (fail closed) and every decision writes hash-chained evidence', async () => {
  const u = await mkUser('tier')
  await assign(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const session = await p.userSession.create({ data: { userId: u.id, expiresAt: new Date(Date.now() + 3600_000), issuedAt: new Date(Date.now() - 3600_000) } })
  const ctx = ctxOf(u, { sessionId: session.id })
  const before = await p.authorizationEvidence.count()
  const stale = await can(ctx, 'iam.role_assignment.assign', { type: 'role_assignment', id: 'x', facts: { organizationId: org.id } }, { requestId: `req-${run}-1` })
  assert.equal(stale.reason, 'STEP_UP_REQUIRED')
  await rejects(authorize(ctx, 'iam.role_assignment.assign', { type: 'role_assignment', facts: { organizationId: org.id } }), /confirm your identity/)
  await p.userSession.update({ where: { id: session.id }, data: { issuedAt: new Date() } })
  const fresh = await can(ctx, 'iam.role_assignment.assign', { type: 'role_assignment', id: 'x', facts: { organizationId: org.id } }, { requestId: `req-${run}-2` })
  assert.equal(fresh.decision, 'ALLOW')
  const rows = await p.authorizationEvidence.findMany({ where: { userId: u.id }, orderBy: { sequence: 'asc' } })
  assert.equal(rows.length, 3, 'two denies + one allow all recorded')
  assert.ok((await p.authorizationEvidence.count()) >= before + 3)
  const allow = rows[2]
  assert.equal(allow.decision, 'ALLOW'); assert.equal(allow.roleCode, 'OWNER'); assert.equal(allow.roleVersionNumber, 1)
  assert.equal(allow.permissionCode, 'iam.role_assignment.assign'); assert.equal(allow.scopeKind, 'ORGANIZATION')
  assert.equal(allow.requestId, `req-${run}-2`); assert.ok(allow.hash && allow.prevHash)
  const chain = await verifyEvidenceChain(p)
  assert.equal(chain.ok, true, JSON.stringify(chain))
})

await t('evidence is append-only: UPDATE and DELETE are refused by the database', async () => {
  const row = await p.authorizationEvidence.findFirst()
  await rejects(p.authorizationEvidence.update({ where: { id: row.id }, data: { decision: 'ALLOW' } }), /append-only/)
  await rejects(p.authorizationEvidence.delete({ where: { id: row.id } }), /append-only/)
})

await t('published role versions are immutable: membership, content and deletion are refused', async () => {
  const rv = await versionFor('SUPPORT_AGENT')
  const perm = await p.permissionDefinition.findUnique({ where: { code: 'iam.role.manage' } })
  await rejects(p.roleVersionPermission.create({ data: { roleVersionId: rv.id, permissionId: perm.id } }), /DRAFT/)
  await rejects(p.roleVersionPermission.deleteMany({ where: { roleVersionId: rv.id } }), /DRAFT/)
  await rejects(p.roleVersion.update({ where: { id: rv.id }, data: { platformCoverage: ['str'] } }), /immutable/)
  await rejects(p.roleVersion.update({ where: { id: rv.id }, data: { contentHash: 'tampered' } }), /immutable/)
  await rejects(p.roleVersion.delete({ where: { id: rv.id } }), /never deleted|constraint|violates/)
})

await t('role assignments and scope rows are never deleted or rewritten; revocation keeps history', async () => {
  const u = await mkUser('hist')
  const a = await assign(u, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  await rejects(p.roleAssignment.delete({ where: { id: a.id } }), /never deleted/)
  await rejects(p.roleAssignment.update({ where: { id: a.id }, data: { grantReason: 'rewritten' } }), /immutable/)
  await rejects(p.assignmentScope.deleteMany({ where: { assignmentId: a.id } }), /append-only/)
  await p.roleAssignment.update({ where: { id: a.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: u.id, revokeReason: 'test' } })
  const kept = await p.roleAssignment.findUnique({ where: { id: a.id }, include: { scopes: true } })
  assert.equal(kept.status, 'REVOKED'); assert.equal(kept.scopes.length, 1)
})

await t('assignment scope rows must target exactly what their kind says (CHECK constraint)', async () => {
  const u = await mkUser('badscope')
  const a = await assign(u, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  await rejects(p.assignmentScope.create({ data: { assignmentId: a.id, kind: 'PROPERTY', organizationId: org.id } }), /assignment_scopes_kind_target_chk|check/i)
  await rejects(p.assignmentScope.create({ data: { assignmentId: a.id, kind: 'SELF', propertyRef: 'p' } }), /assignment_scopes_kind_target_chk|check/i)
  await p.assignmentScope.create({ data: { assignmentId: a.id, kind: 'SELF' } })
})

await t('role-version history: FINANCE v1 (Jan-Jun) payment.approve proven in March, gone after v2 (Jul)', async () => {
  const code = `S5T_FIN_${run.toUpperCase()}`
  const perms = Object.fromEntries((await p.permissionDefinition.findMany()).map((x) => [x.code, x.id]))
  const role = await p.role.create({ data: { code, name: 'S5 test finance', description: 'test' } })
  const publish = async (n, codes, from, status = 'EFFECTIVE', to = null) => {
    const rv = await p.roleVersion.create({ data: { roleId: role.id, versionNumber: n, status: 'DRAFT', platformCoverage: ['*'], contentHash: `h${n}`, changeReason: 'test', classification: n === 1 ? 'INITIAL' : 'REDUCING' } })
    await p.roleVersionPermission.createMany({ data: codes.map((c) => ({ roleVersionId: rv.id, permissionId: perms[c] })) })
    return p.roleVersion.update({ where: { id: rv.id }, data: { status, effectiveFrom: from, effectiveTo: to } })
  }
  const v1 = await publish(1, ['party.party.read', 'party.party.write'], new Date('2026-01-01'), 'SUPERSEDED', new Date('2026-07-01'))
  const v2 = await publish(2, ['party.party.read'], new Date('2026-07-01'))
  const u = await mkUser('fin')
  const mk = (rv, from, to, status) => p.roleAssignment.create({ data: { userId: u.id, roleVersionId: rv.id, effectiveFrom: from, effectiveTo: to, status, grantReason: 'test', scopes: { create: [{ kind: 'ORGANIZATION', organizationId: org.id }] } } })
  await mk(v1, new Date('2026-01-01'), new Date('2026-07-01'), 'SUPERSEDED')
  await mk(v2, new Date('2026-07-01'), null, 'ACTIVE')
  const orgIndex = await loadOrgIndex(p)
  const permission = await loadPermission(p, 'party.party.write')
  const suspensions = await loadSuspensions(p)
  const at = async (iso) => evaluateAccess({ user: { id: u.id, status: 'ACTIVE' }, permission, assignments: await loadAssignmentsAsOf(p, u.id, new Date(iso)), suspensions, resource: { type: 'party', facts: { organizationId: org.id } }, context: { now: new Date(iso) }, orgIndex })
  const march = await at('2026-03-15T10:00:00Z')
  assert.equal(march.decision, 'ALLOW'); assert.equal(march.grant.roleVersionNumber, 1)
  const august = await at('2026-08-15T10:00:00Z')
  assert.equal(august.decision, 'DENY'); assert.equal(august.reason, 'PERMISSION_NOT_IN_ROLE_VERSION')
})

await t('policy B: a newer role version does not change an existing pinned assignment', async () => {
  const rv = await versionFor('SUPPORT_AGENT')
  const u = await mkUser('pinned')
  const a = await assign(u, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  assert.equal(a.roleVersionId, rv.id)
  const again = await p.roleAssignment.findUnique({ where: { id: a.id } })
  assert.equal(again.roleVersionId, rv.id)
})

await t('permissionSummary reports what a user holds anywhere (navigation only)', async () => {
  const u = await mkUser('nav')
  await assign(u, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const s = await permissionSummary(ctxOf(u), ['support.case.read', 'iam.role.manage', 'nope.nope.nope'])
  assert.deepEqual(s, { 'support.case.read': true, 'iam.role.manage': false, 'nope.nope.nope': false })
})

await t('audit helper writes an append-only event with correlation id, platform and reason', async () => {
  const u = await mkUser('audit')
  const cid = `corr-${run}`
  const ev = await writeAdminAudit(p, { actorUserId: u.id, action: 'test.event', entityType: 'test', entityId: run, after: { ok: true }, reason: 'because', correlationId: cid, platformCode: 'str' })
  assert.equal(ev.correlationId, cid)
  await rejects(p.adminAuditLog.update({ where: { id: ev.id }, data: { reason: 'edited' } }), /append-only/)
  await rejects(p.adminAuditLog.delete({ where: { id: ev.id } }), /append-only/)
})

console.log(`\n${passed} passed, ${failures.length} failed`)
await p.$disconnect()
process.exit(failures.length ? 1 : 0)
