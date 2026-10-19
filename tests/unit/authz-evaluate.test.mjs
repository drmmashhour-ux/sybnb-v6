import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAccess, DENY, isAssignmentActiveAt, effectivePlatforms } from '../../server/lib/authz/evaluate.mjs'

const NOW = new Date('2026-10-19T12:00:00Z')
const day = (s) => new Date(`${s}T00:00:00Z`)

// Registry fixture: ORG -> LE(9375) -> BU_STAYS(str) / BU_SR(sr_ride) / BU_MKT(marketplace); LE2 is another entity.
const orgIndex = {
  organizationsById: new Map([['org1', { id: 'org1', name: 'Org' }]]),
  legalEntitiesById: new Map([['le1', { id: 'le1', organizationId: 'org1', legalName: '9375-7649 Québec inc.' }], ['le2', { id: 'le2', organizationId: 'org1', legalName: 'Other inc.' }]]),
  businessUnitsById: new Map([['bu_stays', { id: 'bu_stays', legalEntityId: 'le1', name: 'Stays' }], ['bu_sr', { id: 'bu_sr', legalEntityId: 'le1', name: 'SR' }], ['bu_mkt', { id: 'bu_mkt', legalEntityId: 'le2', name: 'Marketplace' }]]),
  platformsById: new Map([['p_str', { id: 'p_str', displayName: 'SYBNB STR' }], ['p_sr', { id: 'p_sr', displayName: 'SR Ride' }], ['p_mkt', { id: 'p_mkt', displayName: 'Marketplace' }], ['p_syn', { id: 'p_syn', displayName: 'Syntrise' }]]),
  platformsByCode: new Map([['str', { id: 'p_str', businessUnitId: 'bu_stays' }], ['sr_ride', { id: 'p_sr', businessUnitId: 'bu_sr' }], ['marketplace', { id: 'p_mkt', businessUnitId: 'bu_mkt' }], ['syntrise', { id: 'p_syn', businessUnitId: 'bu_stays' }]]),
}

const user = { id: 'u1', status: 'ACTIVE' }
const perm = (code, extra = {}) => ({ code, tier: 1, ...extra })
const role = (code = 'R', status = 'ACTIVE') => ({ code, status })
const version = (over = {}) => ({ id: 'rv1', versionNumber: 1, status: 'EFFECTIVE', effectiveFrom: day('2026-01-01'), platformCoverage: ['*'], permissionCodes: ['x.y.z'], role: role(), ...over })
const assignment = (over = {}) => ({ id: 'a1', userId: 'u1', status: 'ACTIVE', effectiveFrom: day('2026-01-01'), effectiveTo: null, revokedAt: null, platformQualifier: [], roleVersion: version(), scopes: [{ id: 's1', kind: 'ORGANIZATION', organizationId: 'org1' }], ...over })
const run = (over = {}) => evaluateAccess({ user, permission: perm('x.y.z'), assignments: [assignment()], suspensions: [], resource: { type: 'thing', facts: { organizationId: 'org1' } }, context: { now: NOW }, orgIndex, ...over })

test('allows an explicit permission + scope match and reports the evidence grant', () => {
  const r = run()
  assert.equal(r.decision, 'ALLOW')
  assert.equal(r.grant.assignmentId, 'a1')
  assert.equal(r.grant.roleCode, 'R')
  assert.equal(r.grant.scopeKind, 'ORGANIZATION')
})

test('DENY: unknown permission, deprecated permission, no assignments', () => {
  assert.equal(run({ permission: null }).reason, DENY.UNKNOWN_PERMISSION)
  assert.equal(run({ permission: perm('x.y.z', { deprecated: true }) }).reason, DENY.PERMISSION_DEPRECATED)
  assert.equal(run({ assignments: [] }).reason, DENY.NO_ACTIVE_ASSIGNMENT)
})

test('DENY: suspended, deleted or missing user', () => {
  assert.equal(run({ user: { id: 'u1', status: 'SUSPENDED' } }).reason, DENY.USER_NOT_ACTIVE)
  assert.equal(run({ user: { id: 'u1', status: 'DELETED' } }).reason, DENY.USER_NOT_ACTIVE)
  assert.equal(run({ user: null }).reason, DENY.USER_NOT_ACTIVE)
})

test('DENY: expired, not-yet-started, revoked and non-ACTIVE assignments (half-open interval)', () => {
  // NOW is 12:00 on the 19th; effectiveTo 00:00 on the 19th is in the past -> expired
  assert.equal(run({ assignments: [assignment({ effectiveTo: day('2026-10-19') })] }).decision, 'DENY')
  assert.equal(run({ assignments: [assignment({ effectiveFrom: day('2026-11-01') })] }).reason, DENY.NO_ACTIVE_ASSIGNMENT)
  assert.equal(run({ assignments: [assignment({ revokedAt: day('2026-10-01'), status: 'REVOKED' })] }).reason, DENY.NO_ACTIVE_ASSIGNMENT)
  assert.equal(run({ assignments: [assignment({ status: 'SUSPENDED' })] }).reason, DENY.NO_ACTIVE_ASSIGNMENT)
  assert.equal(run({ assignments: [assignment({ status: 'PENDING_APPROVAL' })] }).reason, DENY.NO_ACTIVE_ASSIGNMENT)
  const edge = assignment({ effectiveTo: new Date('2026-10-19T12:00:00Z') })
  assert.equal(isAssignmentActiveAt(edge, NOW.getTime()), false, 'effective_to is exclusive')
})

test('DENY: role version in DRAFT / review / approved / rejected / withdrawn, retired role, not yet started', () => {
  for (const status of ['DRAFT', 'IN_SECURITY_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN']) {
    assert.equal(run({ assignments: [assignment({ roleVersion: version({ status }) })] }).reason, DENY.ROLE_VERSION_NOT_USABLE, status)
  }
  assert.equal(run({ assignments: [assignment({ roleVersion: version({ role: role('R', 'RETIRED') }) })] }).reason, DENY.ROLE_VERSION_NOT_USABLE)
  assert.equal(run({ assignments: [assignment({ roleVersion: version({ effectiveFrom: day('2027-01-01') }) })] }).reason, DENY.ROLE_VERSION_NOT_USABLE)
})

test('pinned assignment on a SUPERSEDED version stays valid (policy B) and keeps its own permission set', () => {
  const v1 = version({ id: 'v1', versionNumber: 1, status: 'SUPERSEDED', permissionCodes: ['expense.approve', 'payment.approve'] })
  const a = assignment({ roleVersion: v1 })
  assert.equal(run({ assignments: [a], permission: perm('payment.approve') }).decision, 'ALLOW')
})

test('role-version history: FINANCE_MANAGER v1 (Jan-Jun) has payment.approve, v2 (Jul-) drops it; March proves it', () => {
  const v1 = version({ id: 'v1', versionNumber: 1, status: 'SUPERSEDED', effectiveFrom: day('2026-01-01'), permissionCodes: ['expense.approve', 'payment.approve'] })
  const v2 = version({ id: 'v2', versionNumber: 2, status: 'EFFECTIVE', effectiveFrom: day('2026-07-01'), permissionCodes: ['expense.approve'] })
  const A1 = assignment({ id: 'A1', roleVersion: v1, effectiveFrom: day('2026-01-01'), effectiveTo: day('2026-07-01'), status: 'SUPERSEDED' })
  const A2 = assignment({ id: 'A2', roleVersion: v2, effectiveFrom: day('2026-07-01') })
  const at = (iso, code) => run({ assignments: [A1, A2], permission: perm(code), context: { now: new Date(iso) } })
  // The assignment A1 is SUPERSEDED today, so point-in-time queries use history rows flagged active-at-T.
  const asOfMarch = { ...A1, status: 'ACTIVE' } // the history query loads the row as it stood in March
  const march = run({ assignments: [asOfMarch, A2], permission: perm('payment.approve'), context: { now: new Date('2026-03-15T10:00:00Z') } })
  assert.equal(march.decision, 'ALLOW')
  assert.equal(march.grant.roleVersionNumber, 1)
  const august = run({ assignments: [A2], permission: perm('payment.approve'), context: { now: new Date('2026-08-15T10:00:00Z') } })
  assert.equal(august.decision, 'DENY')
  assert.equal(august.reason, DENY.PERMISSION_NOT_IN_ROLE_VERSION)
  assert.equal(at('2026-08-15T10:00:00Z', 'expense.approve').grant.roleVersionNumber, 2)
})

test('permission suspension overlay wins (by permission code and by role version)', () => {
  const byCode = [{ permissionCode: 'x.y.z', effectiveFrom: day('2026-10-01'), effectiveTo: null, liftedAt: null }]
  const byVersion = [{ roleVersionId: 'rv1', effectiveFrom: day('2026-10-01'), effectiveTo: null, liftedAt: null }]
  assert.equal(run({ suspensions: byCode }).reason, DENY.PERMISSION_SUSPENDED)
  assert.equal(run({ suspensions: byVersion }).reason, DENY.PERMISSION_SUSPENDED)
  assert.equal(run({ suspensions: [{ ...byCode[0], liftedAt: day('2026-10-10') }] }).decision, 'ALLOW', 'lifted overlay no longer applies')
  assert.equal(run({ suspensions: [{ ...byCode[0], effectiveFrom: day('2026-11-01') }] }).decision, 'ALLOW', 'not yet started')
})

test('organization tree inherits downward only', () => {
  const orgScope = assignment({ scopes: [{ id: 's', kind: 'ORGANIZATION', organizationId: 'org1' }] })
  const leScope = assignment({ scopes: [{ id: 's', kind: 'LEGAL_ENTITY', legalEntityId: 'le1' }] })
  const buScope = assignment({ scopes: [{ id: 's', kind: 'BUSINESS_UNIT', businessUnitId: 'bu_stays' }] })
  const platScope = assignment({ scopes: [{ id: 's', kind: 'PLATFORM', platformId: 'p_str' }] })
  const strRecord = { type: 'reservation', facts: { platformCode: 'str' }, platform: 'str' }
  const mktRecord = { type: 'listing', facts: { platformCode: 'marketplace' }, platform: 'marketplace' }
  assert.equal(run({ assignments: [orgScope], resource: strRecord }).decision, 'ALLOW')
  assert.equal(run({ assignments: [orgScope], resource: mktRecord }).decision, 'ALLOW')
  assert.equal(run({ assignments: [leScope], resource: strRecord }).decision, 'ALLOW')
  assert.equal(run({ assignments: [leScope], resource: mktRecord }).reason, DENY.SCOPE_NOT_MATCHED, 'wrong legal entity')
  assert.equal(run({ assignments: [buScope], resource: strRecord }).decision, 'ALLOW')
  assert.equal(run({ assignments: [buScope], resource: { type: 'ride', facts: { platformCode: 'sr_ride' }, platform: 'sr_ride' } }).reason, DENY.SCOPE_NOT_MATCHED)
  assert.equal(run({ assignments: [platScope], resource: strRecord }).decision, 'ALLOW')
  // a platform scope grants nothing about the business unit above it
  assert.equal(run({ assignments: [platScope], resource: { type: 'bu-record', facts: { businessUnitId: 'bu_stays' } } }).reason, DENY.SCOPE_NOT_MATCHED)
})

test('PROPERTY scope: STR_MANAGER on Property 123 reaches STR records, NOT the same property\'s Syntrise records', () => {
  const strManager = assignment({
    roleVersion: version({ platformCoverage: ['str'], permissionCodes: ['x.y.z'] }),
    scopes: [{ id: 's', kind: 'PROPERTY', propertyRef: 'prop-123' }],
  })
  const strReservation = { type: 'reservation', platform: 'str', facts: { platformCode: 'str', propertyRef: 'prop-123' } }
  const syntriseOffer = { type: 'offer', platform: 'syntrise', facts: { platformCode: 'syntrise', propertyRef: 'prop-123' } }
  const otherProperty = { type: 'reservation', platform: 'str', facts: { platformCode: 'str', propertyRef: 'prop-456' } }
  assert.equal(run({ assignments: [strManager], resource: strReservation }).decision, 'ALLOW')
  assert.equal(run({ assignments: [strManager], resource: syntriseOffer }).reason, DENY.PLATFORM_NOT_COVERED)
  assert.equal(run({ assignments: [strManager], resource: otherProperty }).reason, DENY.SCOPE_NOT_MATCHED)
  // a master property record shared by STR and Syntrise reveals only the covered platform
  const master = { type: 'property', platforms: ['str', 'syntrise'], facts: { propertyRef: 'prop-123' } }
  const r = run({ assignments: [strManager], resource: master })
  assert.equal(r.decision, 'ALLOW')
  assert.deepEqual(r.visiblePlatforms, ['str'])
  const onlySyntrise = { type: 'property', platforms: ['syntrise'], facts: { propertyRef: 'prop-123' } }
  assert.equal(run({ assignments: [strManager], resource: onlySyntrise }).reason, DENY.PLATFORM_NOT_COVERED)
})

test('VEHICLE / PROJECT / DEPARTMENT scopes match by membership; missing facts deny', () => {
  const veh = assignment({ scopes: [{ id: 's', kind: 'VEHICLE', vehicleRef: 'veh-7' }] })
  const proj = assignment({ scopes: [{ id: 's', kind: 'PROJECT', projectRef: 'proj-1' }] })
  const dept = assignment({ scopes: [{ id: 's', kind: 'DEPARTMENT', departmentId: 'dep-1' }] })
  assert.equal(run({ assignments: [veh], resource: { type: 'v', facts: { vehicleRef: 'veh-7' } } }).decision, 'ALLOW')
  assert.equal(run({ assignments: [veh], resource: { type: 'v', facts: { vehicleRef: ['veh-1', 'veh-7'] } } }).decision, 'ALLOW')
  assert.equal(run({ assignments: [veh], resource: { type: 'v', facts: { vehicleRef: 'veh-8' } } }).reason, DENY.SCOPE_NOT_MATCHED)
  assert.equal(run({ assignments: [veh], resource: { type: 'v', facts: {} } }).reason, DENY.SCOPE_NOT_MATCHED, 'unknown fact never allows')
  assert.equal(run({ assignments: [proj], resource: { type: 'p', facts: { projectRef: 'proj-1' } } }).decision, 'ALLOW')
  assert.equal(run({ assignments: [dept], resource: { type: 'd', facts: { departmentId: 'dep-1' } } }).decision, 'ALLOW')
})

test('unknown scope kind never matches', () => {
  const bad = assignment({ scopes: [{ id: 's', kind: 'GALAXY' }] })
  assert.equal(run({ assignments: [bad] }).decision, 'DENY')
})

test('SELF resolves through explicit relations, never created_by', () => {
  const self = assignment({ scopes: [{ id: 's', kind: 'SELF' }] })
  const own = { type: 'profile', facts: { relations: [{ relation: 'SELF_USER', userId: 'u1' }] } }
  const someoneElse = { type: 'profile', facts: { relations: [{ relation: 'SELF_USER', userId: 'u2' }] } }
  const createdByMe = { type: 'profile', facts: { createdBy: 'u1' } }
  const fakeRelation = { type: 'profile', facts: { relations: [{ relation: 'CREATED_BY', userId: 'u1' }] } }
  assert.equal(run({ assignments: [self], resource: own }).decision, 'ALLOW')
  assert.equal(run({ assignments: [self], resource: someoneElse }).reason, DENY.SCOPE_NOT_MATCHED)
  assert.equal(run({ assignments: [self], resource: createdByMe }).reason, DENY.SCOPE_NOT_MATCHED)
  assert.equal(run({ assignments: [self], resource: fakeRelation }).reason, DENY.SCOPE_NOT_MATCHED)
})

test('platform qualifier narrows coverage and never widens it', () => {
  const rvAll = version({ platformCoverage: ['*'] })
  const rvTwo = version({ platformCoverage: ['str', 'sr_ride'] })
  assert.deepEqual([...effectivePlatforms(rvTwo, { platformQualifier: ['str', 'marketplace'] }).set], ['str'])
  assert.equal(effectivePlatforms(rvAll, { platformQualifier: [] }).all, true)
  assert.deepEqual([...effectivePlatforms(rvAll, { platformQualifier: ['cars'] }).set], ['cars'])
  const a = assignment({ roleVersion: rvTwo, platformQualifier: ['str'], scopes: [{ id: 's', kind: 'ORGANIZATION', organizationId: 'org1' }] })
  assert.equal(run({ assignments: [a], resource: { type: 'r', platform: 'sr_ride', facts: { platformCode: 'sr_ride' } } }).reason, DENY.PLATFORM_NOT_COVERED)
  assert.equal(run({ assignments: [a], resource: { type: 'r', platform: 'str', facts: { platformCode: 'str' } } }).decision, 'ALLOW')
})

test('assignments are evaluated independently: role A permission + role B scope do not combine', () => {
  const holdsPermissionWrongScope = assignment({ id: 'a1', roleVersion: version({ id: 'rvA', permissionCodes: ['x.y.z'] }), scopes: [{ id: 's1', kind: 'LEGAL_ENTITY', legalEntityId: 'le2' }] })
  const rightScopeNoPermission = assignment({ id: 'a2', roleVersion: version({ id: 'rvB', permissionCodes: ['other.perm.code'] }), scopes: [{ id: 's2', kind: 'LEGAL_ENTITY', legalEntityId: 'le1' }] })
  const r = run({ assignments: [holdsPermissionWrongScope, rightScopeNoPermission], resource: { type: 'r', platform: 'str', facts: { platformCode: 'str' } } })
  assert.equal(r.decision, 'DENY')
})

test('segregation of duties: noSelf permissions are refused on a record about the actor', () => {
  const p = perm('approval.request.decide', { noSelf: true })
  const a = assignment({ roleVersion: version({ permissionCodes: ['approval.request.decide'] }) })
  const mine = { type: 'approval', facts: { organizationId: 'org1', subjectUserId: 'u1' } }
  const theirs = { type: 'approval', facts: { organizationId: 'org1', subjectUserId: 'u2' } }
  assert.equal(run({ permission: p, assignments: [a], resource: mine }).reason, DENY.SOD_SELF_ACTION)
  assert.equal(run({ permission: p, assignments: [a], resource: theirs }).decision, 'ALLOW')
})

test('step-up: T3 needs recent auth within 15 minutes, T4 within 5; fails closed when unknown', () => {
  const p3 = perm('x.y.z', { tier: 3 })
  const p4 = perm('x.y.z', { tier: 4 })
  const at = (minsAgo) => ({ now: NOW, session: { recentAuthAt: new Date(NOW.getTime() - minsAgo * 60_000) } })
  const policy = { version: 1, stepUpWindowMs: { 3: 15 * 60_000, 4: 5 * 60_000 } }
  assert.equal(run({ permission: p3, policy, context: at(10) }).decision, 'ALLOW')
  assert.equal(run({ permission: p3, policy, context: at(20) }).reason, DENY.STEP_UP_REQUIRED)
  assert.equal(run({ permission: p4, policy, context: at(4) }).decision, 'ALLOW')
  const r = run({ permission: p4, policy, context: at(6) })
  assert.equal(r.reason, DENY.STEP_UP_REQUIRED)
  assert.equal(r.stepUpRequired, true)
  assert.equal(run({ permission: p4, policy, context: { now: NOW } }).reason, DENY.STEP_UP_REQUIRED, 'no recentAuthAt -> fail closed')
  assert.equal(run({ permission: perm('x.y.z', { tier: 1 }), policy, context: { now: NOW } }).decision, 'ALLOW', 'T1/T2 need no step-up')
})

test('evaluating is pure: inputs are not mutated and the result is deterministic', () => {
  const input = { user, permission: perm('x.y.z'), assignments: [assignment()], suspensions: [], resource: { type: 't', facts: { organizationId: 'org1' } }, context: { now: NOW }, orgIndex }
  const before = JSON.stringify(input, (k, v) => (v instanceof Map ? [...v] : v))
  const a = evaluateAccess(input)
  const b = evaluateAccess(input)
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(input, (k, v) => (v instanceof Map ? [...v] : v)), before)
})
