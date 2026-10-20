// STEP 5A unit tests: 48h activation (21), SECURITY_ADMIN/role design (22), catalogue/role version/retention
// invariants (25, 26), scope rules (27). Database-backed behaviour is in tests/e2e/admin2-5a.e2e.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAccess, DENY, isAssignmentActiveAt, DEFAULT_POLICY, HIGH_RISK_ACTIVATION_DELAY_MS } from '../../server/lib/authz/evaluate.mjs'
import { PERMISSIONS, ROLES, resolveRoleVersions, POLICY_V2_CONFIG } from '../../server/lib/authz/catalogue.mjs'
import { LEGACY_PERMISSION_ALIASES } from '../../server/lib/authz/permission-aliases.mjs'
import { addYears, RETENTION_FLOOR_YEARS, RETENTION_CATEGORIES } from '../../server/lib/authz/retention.mjs'

const H = 3_600_000
const NOW = new Date('2026-10-19T12:00:00Z')
const orgIndex = {
  organizationsById: new Map([['org1', { id: 'org1' }]]), legalEntitiesById: new Map([['le1', { id: 'le1', organizationId: 'org1' }]]),
  businessUnitsById: new Map([['bu1', { id: 'bu1', legalEntityId: 'le1' }]]), platformsById: new Map([['p1', { id: 'p1' }]]),
  platformsByCode: new Map([['str', { id: 'p1', businessUnitId: 'bu1' }], ['cars', { id: 'p2', businessUnitId: 'bu1' }]]),
}
const user = { id: 'u1', status: 'ACTIVE' }
const rv = (codes) => ({ id: 'rv', versionNumber: 1, status: 'EFFECTIVE', effectiveFrom: new Date('2026-01-01'), platformCoverage: ['*'], permissionCodes: codes, role: { code: 'R', status: 'ACTIVE' } })
const asg = (over = {}) => ({ id: 'a1', userId: 'u1', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), effectiveTo: null, revokedAt: null, platformQualifier: [], roleVersion: rv(['access.assign']), scopes: [{ id: 's', kind: 'ORGANIZATION', organizationId: 'org1' }], ...over })
const run = (over = {}, at = NOW) => evaluateAccess({ user, permission: { code: 'access.assign', tier: 4, highRisk: true }, assignments: [asg()], resource: { type: 't', facts: { organizationId: 'org1' } }, context: { now: at, session: { recentAuthAt: at } }, orgIndex, ...over })

test('policy: the delay is 48 hours by default and in policy v2', () => {
  assert.equal(HIGH_RISK_ACTIVATION_DELAY_MS, 48 * H)
  assert.equal(DEFAULT_POLICY.highRiskActivationDelayMs, 48 * H)
  assert.equal(POLICY_V2_CONFIG.highRiskActivationDelayHours, 48)
})

test('21: PENDING_ACTIVATION is denied before activation_at, allowed at/after it (backend, not UI)', () => {
  const approvedAt = NOW
  const activationAt = new Date(NOW.getTime() + 48 * H)
  const a = asg({ status: 'PENDING_ACTIVATION', approvedAt, activationAt })
  const before = run({ assignments: [a] }, new Date(activationAt.getTime() - 1))
  assert.equal(before.decision, 'DENY'); assert.equal(before.reason, DENY.ACTIVATION_PENDING)
  const at = run({ assignments: [a] }, activationAt)
  assert.equal(at.decision, 'ALLOW', 'usable exactly at activation_at')
  assert.equal(run({ assignments: [a] }, new Date(activationAt.getTime() + 1)).decision, 'ALLOW')
})

test('21: 47h59m after approval is denied, 48h is allowed', () => {
  const approvedAt = new Date('2026-10-19T12:00:00Z'); const activationAt = new Date(approvedAt.getTime() + 48 * H)
  const a = asg({ status: 'PENDING_ACTIVATION', approvedAt, activationAt })
  assert.equal(run({ assignments: [a] }, new Date(approvedAt.getTime() + 47 * H + 59 * 60_000)).decision, 'DENY')
  assert.equal(run({ assignments: [a] }, new Date(approvedAt.getTime() + 48 * H)).decision, 'ALLOW')
})

test('21: an ACTIVE row that still carries a future activation_at is not usable; a missing approval is not usable', () => {
  const future = new Date(NOW.getTime() + H)
  assert.equal(run({ assignments: [asg({ activationAt: future })] }).decision, 'DENY')
  assert.equal(isAssignmentActiveAt(asg({ status: 'PENDING_ACTIVATION', activationAt: new Date(NOW.getTime() - H), approvedAt: null }), NOW.getTime()), false)
  assert.equal(isAssignmentActiveAt(asg({ status: 'PENDING_ACTIVATION', activationAt: null, approvedAt: NOW }), NOW.getTime()), false)
})

test('21: requested / under review / rejected / revoked never grant access, whatever the clock says', () => {
  for (const status of ['PENDING_APPROVAL', 'UNDER_REVIEW', 'REJECTED', 'REVOKED']) {
    assert.equal(run({ assignments: [asg({ status, activationAt: new Date(NOW.getTime() - H), approvedAt: new Date(NOW.getTime() - 50 * H) })] }).decision, 'DENY', status)
  }
  // revoked during the wait: revokedAt blocks even if the status were still PENDING_ACTIVATION
  const a = asg({ status: 'PENDING_ACTIVATION', approvedAt: new Date(NOW.getTime() - 50 * H), activationAt: new Date(NOW.getTime() - 2 * H), revokedAt: new Date(NOW.getTime() - H) })
  assert.equal(run({ assignments: [a] }).decision, 'DENY')
})

test('21: removal is immediate (a revoked ACTIVE assignment is denied at the same instant)', () => {
  assert.equal(run({ assignments: [asg()] }).decision, 'ALLOW')
  assert.equal(run({ assignments: [asg({ status: 'REVOKED', revokedAt: NOW })] }).decision, 'DENY')
})

test('catalogue: canonical names, tier-4 is always high-risk, no duplicates', () => {
  const codes = PERMISSIONS.map((p) => p.code)
  assert.equal(new Set(codes).size, codes.length)
  for (const c of codes) assert.match(c, /^[a-z_]+(\.[a-z_]+){1,2}$/, c)
  for (const p of PERMISSIONS.filter((x) => x.tier === 4)) assert.ok(p.highRisk, `${p.code} is tier 4 so it must be flagged high-risk`)
  assert.equal(new Set(Object.values(LEGACY_PERMISSION_ALIASES)).size, Object.keys(LEGACY_PERMISSION_ALIASES).length, 'alias map is one-to-one')
  for (const legacy of Object.keys(LEGACY_PERMISSION_ALIASES)) assert.ok(!codes.includes(legacy), `${legacy} must not remain a live code`)
  for (const canonical of Object.values(LEGACY_PERMISSION_ALIASES)) assert.ok(codes.includes(canonical), canonical)
})

const roleCodes = (code, v) => new Set(resolveRoleVersions(ROLES.find((r) => r.code === code))[v - 1].permissions)
const RESERVED_FIN = ['payment.release', 'payout.release', 'accounting.post', 'tax.approve', 'vendor.bank_change.approve']

test('22: SECURITY_ADMIN v2 holds the approved set and NO financial authority', () => {
  const s = roleCodes('SECURITY_ADMIN', 2)
  for (const c of ['security.view', 'security.manage', 'user.suspend_emergency', 'session.revoke', 'privileged_access.review', 'break_glass.review', 'security_event.review']) assert.ok(s.has(c), c)
  for (const c of RESERVED_FIN) assert.ok(!s.has(c), `SECURITY_ADMIN must not include ${c}`)
  assert.ok(!s.has('access.approve') && !s.has('role.publish'), 'cannot approve its own grants or publish roles')
})

test('3A-10: only OWNER, SECURITY_ADMIN and the explicit SECURITY_AUTHORITY add-on can emergency-suspend', () => {
  const holders = ROLES.filter((r) => resolveRoleVersions(r).some((v) => v.permissions.includes('user.suspend_emergency'))).map((r) => r.code).sort()
  assert.deepEqual(holders, ['OWNER', 'SECURITY_ADMIN', 'SECURITY_AUTHORITY'])
  assert.ok(!roleCodes('SUPER_ADMIN', 1).has('user.suspend_emergency'), 'SUPER_ADMIN alone has no suspension authority')
  assert.ok(!ROLES.some((r) => r.code === 'GENERAL_MANAGER'))
})

test('financial authority is reserved to OWNER only', () => {
  for (const r of ROLES.filter((x) => x.code !== 'OWNER')) {
    const all = new Set(resolveRoleVersions(r).flatMap((v) => v.permissions))
    for (const c of RESERVED_FIN) assert.ok(!all.has(c), `${r.code} must not hold ${c}`)
  }
})

test('25: role versions are deltas in one direction and v1 sets are preserved', () => {
  for (const r of ROLES) {
    const vs = resolveRoleVersions(r)
    vs.forEach((v, i) => { if (i > 0) { assert.ok(!(v.add.length && v.remove.length), `${r.code} v${v.n} mixes directions`); assert.equal(v.n, i + 1) } })
  }
  const o1 = roleCodes('OWNER', 1); const o2 = roleCodes('OWNER', 2)
  for (const c of o1) assert.ok(o2.has(c), 'v2 keeps every v1 permission')
  assert.ok(o2.has('access.approve') && !o1.has('access.approve'), 'the expansion is new in v2 (holders of v1 do not get it silently)')
})

test('26: retention floor is 7 years and categories cover the required evidence', () => {
  assert.equal(RETENTION_FLOOR_YEARS, 7)
  for (const c of ['AUTHORIZATION_EVIDENCE', 'SECURITY_EVENT', 'PRIVILEGED_ACCESS', 'ROLE_HISTORY', 'ACCESS_APPROVAL', 'BREAK_GLASS', 'USER_SUSPENSION', 'AUDIT']) assert.ok(RETENTION_CATEGORIES.includes(c), c)
  assert.equal(addYears(new Date('2026-10-19T00:00:00Z'), 7).toISOString(), '2033-10-19T00:00:00.000Z')
})

test('27: PROPERTY / VEHICLE / PROJECT scopes do not inherit platform permissions', () => {
  const mk = (kind, field, ref) => asg({ roleVersion: rv(['access.assign']), scopes: [{ id: 's', kind, [field]: ref }] })
  for (const [kind, field] of [['PROPERTY', 'propertyRef'], ['VEHICLE', 'vehicleRef'], ['PROJECT', 'projectRef']]) {
    const a = mk(kind, field, 'X1')
    const hit = run({ assignments: [a], resource: { type: 't', facts: { organizationId: 'org1', platformCode: kind === 'VEHICLE' ? 'cars' : 'str', [field]: ['X1'] } } })
    const miss = run({ assignments: [a], resource: { type: 't', facts: { organizationId: 'org1', platformCode: 'str' } } })
    assert.equal(hit.decision, 'ALLOW', `${kind} matches its own record`)
    assert.equal(miss.decision, 'DENY', `${kind} does not cover the whole platform`)
  }
})

test('27: SELF is resolved through explicit relations only, never created_by', () => {
  const a = asg({ scopes: [{ id: 's', kind: 'SELF' }] })
  const withRel = run({ assignments: [a], resource: { type: 'doc', facts: { relations: [{ relation: 'SELF_USER', userId: 'u1' }] } } })
  const createdBy = run({ assignments: [a], resource: { type: 'doc', facts: { created_by: 'u1', createdById: 'u1' } } })
  const other = run({ assignments: [a], resource: { type: 'doc', facts: { relations: [{ relation: 'SELF_USER', userId: 'u2' }] } } })
  assert.equal(withRel.decision, 'ALLOW'); assert.equal(createdBy.decision, 'DENY'); assert.equal(other.decision, 'DENY')
})
