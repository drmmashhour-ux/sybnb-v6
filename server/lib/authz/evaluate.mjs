// STEP 5 -- pure authorization evaluator (Step 3 section 6, Step 3A.4). NO I/O: everything it needs
// is passed in, so it is exhaustively unit-testable and the same function answers both "is this
// allowed now" and "was this allowed at time T" (3A.1 point-in-time rule).
//
// Deny by default. Every branch that is not an explicit match ends in DENY. There is no fallback.

export const DENY = Object.freeze({
  UNKNOWN_PERMISSION: 'UNKNOWN_PERMISSION',
  PERMISSION_DEPRECATED: 'PERMISSION_DEPRECATED',
  USER_NOT_ACTIVE: 'USER_NOT_ACTIVE',
  NO_ACTIVE_ASSIGNMENT: 'NO_ACTIVE_ASSIGNMENT',
  ROLE_VERSION_NOT_USABLE: 'ROLE_VERSION_NOT_USABLE',
  PERMISSION_NOT_IN_ROLE_VERSION: 'PERMISSION_NOT_IN_ROLE_VERSION',
  PERMISSION_SUSPENDED: 'PERMISSION_SUSPENDED',
  PLATFORM_NOT_COVERED: 'PLATFORM_NOT_COVERED',
  SCOPE_NOT_MATCHED: 'SCOPE_NOT_MATCHED',
  UNKNOWN_SCOPE_KIND: 'UNKNOWN_SCOPE_KIND',
  SOD_SELF_ACTION: 'SOD_SELF_ACTION',
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  ACTIVATION_PENDING: 'ACTIVATION_PENDING',
  SECURITY_TIME_NOT_READY: 'SECURITY_TIME_NOT_READY',
})

// Candidate failures are ranked; the furthest-reached reason is reported (all of them are a DENY).
const RANK = { ROLE_VERSION_NOT_USABLE: 1, PERMISSION_NOT_IN_ROLE_VERSION: 2, PERMISSION_SUSPENDED: 3, PLATFORM_NOT_COVERED: 4, SCOPE_NOT_MATCHED: 5, SOD_SELF_ACTION: 6, STEP_UP_REQUIRED: 7 }

export const SCOPE_KINDS = Object.freeze(['ORGANIZATION', 'LEGAL_ENTITY', 'BUSINESS_UNIT', 'PLATFORM', 'DEPARTMENT', 'PROPERTY', 'VEHICLE', 'PROJECT', 'SELF'])

// SELF relation registry (Step 3A.5). A SELF scope only matches a resource that carries one of
// these EXPLICIT relations to the acting user. `created_by` is deliberately not a relation.
export const SELF_RELATIONS = Object.freeze(['SELF_USER', 'SELF_PARTY', 'SELF_DRIVER_PROFILE', 'SELF_COURIER_PROFILE', 'SELF_EMPLOYEE', 'MERCHANT_ASSIGNMENT', 'DRAFT_AUTHOR'])

// Default step-up windows by tier (Step 3). Overridden by the security policy version in force.
export const HIGH_RISK_ACTIVATION_DELAY_MS = 48 * 3_600_000
export const DEFAULT_POLICY = Object.freeze({ version: 0, stepUpWindowMs: { 3: 15 * 60_000, 4: 5 * 60_000 }, highRiskActivationDelayMs: HIGH_RISK_ACTIVATION_DELAY_MS })

const T = (d) => (d == null ? null : new Date(d).getTime())

// STEP 5A (3A-4): a high-risk grant is usable only once activationAt (approval + 48h) has passed. This is
// enforced HERE (backend authorization), independent of any sweeper or UI. A PENDING_ACTIVATION row whose
// activationAt has passed is treated as active even before the sweeper flips its status; an ACTIVE row
// that still carries a future activationAt is NOT usable.
export function isAssignmentPendingActivationAt(a, nowMs) {
  if (!a) return false
  if (a.status === 'PENDING_ACTIVATION') return true
  return a.status === 'ACTIVE' && a.activationAt != null && T(a.activationAt) > nowMs
}

/** 5D: the only assignments honored while trusted time is unavailable: ACTIVE, no activation/expiry window, not revoked. */
export function isPlainAssignment(a) {
  return !!a && a.status === 'ACTIVE' && a.activationAt == null && a.effectiveTo == null && a.revokedAt == null
}

/** 5D: permissions whose decision depends on a trustworthy clock (tier 3+, high-risk, or any step-up window). */
export function isTimeSensitivePermission(permission, policy = DEFAULT_POLICY) {
  if (!permission) return false
  return permission.tier >= 3 || permission.highRisk === true || policy?.stepUpWindowMs?.[permission.tier] != null
}

export function isAssignmentActiveAt(a, nowMs) {
  if (!a) return false
  if (a.status !== 'ACTIVE' && a.status !== 'PENDING_ACTIVATION') return false
  if (a.status === 'PENDING_ACTIVATION' && (a.activationAt == null || a.approvedAt == null)) return false
  if (a.activationAt != null && T(a.activationAt) > nowMs) return false
  if (T(a.effectiveFrom) > nowMs) return false
  if (a.effectiveTo != null && nowMs >= T(a.effectiveTo)) return false
  if (a.revokedAt != null && T(a.revokedAt) <= nowMs) return false
  return true
}

// A pinned assignment keeps its version even after a newer one becomes effective (policy B), so a
// SUPERSEDED version stays usable. DRAFT / review / approved-not-yet-effective / rejected / withdrawn
// versions, retired roles and versions that have not started are not.
export function isRoleVersionUsableAt(rv, nowMs) {
  if (!rv || !rv.role || rv.role.status !== 'ACTIVE') return false
  if (rv.status !== 'EFFECTIVE' && rv.status !== 'SUPERSEDED') return false
  if (rv.effectiveFrom == null || T(rv.effectiveFrom) > nowMs) return false
  return true
}

export function effectivePlatforms(rv, assignment) {
  const coverage = rv.platformCoverage || []
  const all = coverage.includes('*')
  const qualifier = assignment.platformQualifier || []
  if (all) return qualifier.length ? { all: false, set: new Set(qualifier) } : { all: true, set: null }
  if (!qualifier.length) return { all: false, set: new Set(coverage) }
  return { all: false, set: new Set(coverage.filter((c) => qualifier.includes(c))) } // narrows, never widens
}

// Resolve the organization-tree position of a resource from whichever fact it carries.
export function resolveChain(facts, orgIndex) {
  const chain = { organizationId: null, legalEntityId: null, businessUnitId: null, platformId: null }
  if (!facts) return chain
  let platform = null
  if (facts.platformCode) platform = orgIndex?.platformsByCode?.get(facts.platformCode) || null
  if (platform) {
    chain.platformId = platform.id
    chain.businessUnitId = platform.businessUnitId || null
  }
  if (!chain.businessUnitId && facts.businessUnitId) chain.businessUnitId = facts.businessUnitId
  const bu = chain.businessUnitId ? orgIndex?.businessUnitsById?.get(chain.businessUnitId) : null
  chain.legalEntityId = bu?.legalEntityId || facts.legalEntityId || null
  const le = chain.legalEntityId ? orgIndex?.legalEntitiesById?.get(chain.legalEntityId) : null
  chain.organizationId = le?.organizationId || facts.organizationId || null
  return chain
}

const includesRef = (value, target) => (Array.isArray(value) ? value.includes(target) : value === target)

// Does ONE scope row match the resource for this user? Missing facts never match.
export function scopeMatches(scope, resource, userId, orgIndex) {
  const facts = resource?.facts || {}
  switch (scope.kind) {
    case 'ORGANIZATION': {
      const c = resolveChain(facts, orgIndex)
      return c.organizationId != null && c.organizationId === scope.organizationId
    }
    case 'LEGAL_ENTITY': {
      const c = resolveChain(facts, orgIndex)
      return c.legalEntityId != null && c.legalEntityId === scope.legalEntityId
    }
    case 'BUSINESS_UNIT': {
      const c = resolveChain(facts, orgIndex)
      return c.businessUnitId != null && c.businessUnitId === scope.businessUnitId
    }
    case 'PLATFORM': {
      const c = resolveChain(facts, orgIndex)
      return c.platformId != null && c.platformId === scope.platformId
    }
    case 'DEPARTMENT': return facts.departmentId != null && facts.departmentId === scope.departmentId
    case 'PROPERTY': return facts.propertyRef != null && includesRef(facts.propertyRef, scope.propertyRef)
    case 'VEHICLE': return facts.vehicleRef != null && includesRef(facts.vehicleRef, scope.vehicleRef)
    case 'PROJECT': return facts.projectRef != null && includesRef(facts.projectRef, scope.projectRef)
    case 'SELF': {
      const rels = Array.isArray(facts.relations) ? facts.relations : []
      return rels.some((r) => r && SELF_RELATIONS.includes(r.relation) && r.userId === userId)
    }
    default: return false
  }
}

function scopeDescription(scope, orgIndex) {
  switch (scope.kind) {
    case 'ORGANIZATION': return `Organization ${orgIndex?.organizationsById?.get(scope.organizationId)?.name ?? scope.organizationId}`
    case 'LEGAL_ENTITY': return `Legal entity ${orgIndex?.legalEntitiesById?.get(scope.legalEntityId)?.legalName ?? scope.legalEntityId}`
    case 'BUSINESS_UNIT': return `Business unit ${orgIndex?.businessUnitsById?.get(scope.businessUnitId)?.name ?? scope.businessUnitId}`
    case 'PLATFORM': return `Platform ${orgIndex?.platformsById?.get(scope.platformId)?.displayName ?? scope.platformId}`
    case 'DEPARTMENT': return `Department ${scope.departmentId}`
    case 'PROPERTY': return `Property ${scope.propertyRef}`
    case 'VEHICLE': return `Vehicle ${scope.vehicleRef}`
    case 'PROJECT': return `Project ${scope.projectRef}`
    case 'SELF': return 'Own records'
    default: return String(scope.kind)
  }
}

function scopeTarget(scope) {
  return scope.organizationId || scope.legalEntityId || scope.businessUnitId || scope.platformId || scope.departmentId || scope.propertyRef || scope.vehicleRef || scope.projectRef || null
}

/**
 * @param input.user         { id, status }
 * @param input.permission   { code, tier, deprecated?, noSelf? } as read from permission_definitions, or null if unknown
 * @param input.assignments  role assignments (with .roleVersion {role, permissionCodes:Set|[]}, .scopes[])
 * @param input.suspensions  permission_suspensions rows
 * @param input.resource     { type, id?, platform?, platforms?, facts? }
 * @param input.context      { session?: { recentAuthAt }, now? }
 * @param input.orgIndex     org tree lookup maps
 * @param input.policy       security policy ({ version, stepUpWindowMs })
 * @returns { decision, reason, grant, visiblePlatforms, stepUpRequired }
 */
export function evaluateAccess(input) {
  const { user, permission, assignments = [], suspensions = [], resource = {}, context = {}, orgIndex, policy = DEFAULT_POLICY } = input
  const nowMs = T(context.now ?? new Date())
  const deny = (reason, extra = {}) => ({ decision: 'DENY', reason, grant: null, visiblePlatforms: null, stepUpRequired: false, ...extra })

  if (!permission) return deny(DENY.UNKNOWN_PERMISSION)
  if (permission.deprecated) return deny(DENY.PERMISSION_DEPRECATED)
  if (!user || user.status !== 'ACTIVE') return deny(DENY.USER_NOT_ACTIVE)

  // STEP 5D: when trusted time is not available (no first DB sample, or a stale one) every time-sensitive
  // permission fails CLOSED; harmless reads continue on plain open-ended ACTIVE assignments only.
  const timeTrusted = context.timeTrusted !== false
  if (!timeTrusted && isTimeSensitivePermission(permission, policy)) return deny(DENY.SECURITY_TIME_NOT_READY)

  let bestRank = 0
  let bestReason = DENY.NO_ACTIVE_ASSIGNMENT
  const fail = (reason) => { if (RANK[reason] > bestRank) { bestRank = RANK[reason]; bestReason = reason } }

  const plainOnly = (a) => timeTrusted || isPlainAssignment(a)
  const suspensionsInForce = timeTrusted ? suspensions : suspensions.filter((s) => s.liftedAt == null) // untrusted: ignore windows, fail closed
  const active = assignments.filter((a) => a.userId == null || a.userId === user.id).filter((a) => plainOnly(a) && isAssignmentActiveAt(a, nowMs))
  active.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (!active.length) {
    const waiting = assignments.some((a) => (a.userId == null || a.userId === user.id) && isAssignmentPendingActivationAt(a, nowMs) && a.revokedAt == null)
    return deny(waiting ? DENY.ACTIVATION_PENDING : DENY.NO_ACTIVE_ASSIGNMENT)
  }

  for (const a of active) {
    const rv = a.roleVersion
    if (!isRoleVersionUsableAt(rv, nowMs)) { fail(DENY.ROLE_VERSION_NOT_USABLE); continue }
    const codes = rv.permissionCodes instanceof Set ? rv.permissionCodes : new Set(rv.permissionCodes || [])
    if (!codes.has(permission.code)) { fail(DENY.PERMISSION_NOT_IN_ROLE_VERSION); continue }

    const suspended = suspensionsInForce.some((s) => {
      if (!timeTrusted) return (s.permissionCode != null && s.permissionCode === permission.code) || (s.roleVersionId != null && s.roleVersionId === rv.id)
      if (s.liftedAt != null && T(s.liftedAt) <= nowMs) return false
      if (T(s.effectiveFrom) > nowMs) return false
      if (s.effectiveTo != null && nowMs >= T(s.effectiveTo)) return false
      return (s.permissionCode != null && s.permissionCode === permission.code) || (s.roleVersionId != null && s.roleVersionId === rv.id)
    })
    if (suspended) { fail(DENY.PERMISSION_SUSPENDED); continue }

    // Platform context (3A.4): the role version's coverage, narrowed by the assignment qualifier,
    // must include the resource's platform. A resource with no platform is not platform-bound.
    const eff = effectivePlatforms(rv, a)
    let visiblePlatforms = null
    const facts = resource.facts || {}
    const platformsOfResource = Array.isArray(resource.platforms) && resource.platforms.length ? resource.platforms : (resource.platform ? [resource.platform] : (facts.platformCode ? [facts.platformCode] : null))
    if (platformsOfResource) {
      const visible = eff.all ? platformsOfResource : platformsOfResource.filter((p) => eff.set.has(p))
      if (!visible.length) { fail(DENY.PLATFORM_NOT_COVERED); continue }
      visiblePlatforms = visible
    }

    let matched = null
    for (const sc of a.scopes || []) {
      if (!SCOPE_KINDS.includes(sc.kind)) continue
      if (scopeMatches(sc, resource, user.id, orgIndex)) { matched = sc; break }
    }
    if (!matched) { fail(DENY.SCOPE_NOT_MATCHED); continue }

    if (permission.noSelf && facts.subjectUserId != null && facts.subjectUserId === user.id) { fail(DENY.SOD_SELF_ACTION); continue }

    // Step-up (fail closed): T3/T4 need a recent authentication within the policy window.
    const window = policy.stepUpWindowMs?.[permission.tier]
    if (window != null) {
      const recent = T(context.session?.recentAuthAt)
      if (recent == null || nowMs - recent > window) { fail(DENY.STEP_UP_REQUIRED); continue }
    }

    return {
      decision: 'ALLOW', reason: null, stepUpRequired: false, visiblePlatforms,
      grant: {
        assignmentId: a.id, roleVersionId: rv.id, roleCode: rv.role.code, roleVersionNumber: rv.versionNumber,
        scopeId: matched.id ?? null, scopeKind: matched.kind, scopeTarget: scopeTarget(matched),
        scopeDescription: scopeDescription(matched, orgIndex), platformContext: platformsOfResource ? platformsOfResource.join(',') : null,
      },
    }
  }

  return deny(bestReason, { stepUpRequired: bestReason === DENY.STEP_UP_REQUIRED })
}

/**
 * Navigation helper: does the user hold this permission through ANY active, usable, unsuspended
 * assignment, ignoring resource and scope? Used only to decide what to SHOW; every action is still
 * decided by evaluateAccess() on the server.
 */
export function holdsPermissionAnywhere({ user, permission, assignments = [], suspensions = [], now = new Date() }) {
  if (!permission || permission.deprecated || !user || user.status !== 'ACTIVE') return false
  const nowMs = T(now)
  return assignments.some((a) => {
    if (a.userId != null && a.userId !== user.id) return false
    if (!isAssignmentActiveAt(a, nowMs) || !isRoleVersionUsableAt(a.roleVersion, nowMs)) return false
    const codes = a.roleVersion.permissionCodes instanceof Set ? a.roleVersion.permissionCodes : new Set(a.roleVersion.permissionCodes || [])
    if (!codes.has(permission.code)) return false
    const suspended = suspensions.some((s) => {
      if (s.liftedAt != null && T(s.liftedAt) <= nowMs) return false
      if (T(s.effectiveFrom) > nowMs) return false
      if (s.effectiveTo != null && nowMs >= T(s.effectiveTo)) return false
      return (s.permissionCode != null && s.permissionCode === permission.code) || (s.roleVersionId != null && s.roleVersionId === a.roleVersion.id)
    })
    return !suspended
  })
}
