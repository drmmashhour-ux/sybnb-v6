// STEP 5H -- organization boundary for security / audit / evidence records.
//
// Security events, admin audit rows and authorization evidence carry an `organization_id` (migration 083).
// A row with NO organization is UNATTRIBUTED and is never visible through an organization-scoped route: the
// boundary fails closed. Nothing in here replaces central authorization; every ALLOW below comes from the
// same decide() / evaluateAccess() that r.require() uses. These helpers only answer "at WHICH organizations
// does the central evaluator allow this caller to act?" so a route can add `organizationId IN (...)` to its query.
//
// The organization is NEVER read from the request (query, body, header, route parameter). It comes from
//   * the caller's own ORGANIZATION-scoped assignments (candidate organizations), each then re-decided centrally, or
//   * the stored row itself (organizationId written at write time).

export function authError(statusCode, code, message, extra = {}) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  Object.assign(error, extra)
  return error
}

const DENIED = () => authError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')

/**
 * Organizations the caller could possibly hold an organization-level permission at: the ORGANIZATION-kind scopes of
 * the caller's own loaded assignments. Legal-entity / business-unit / platform / department / self scopes never
 * identify an organization for security records (they cannot match an organization-level resource anyway).
 */
export function candidateOrganizationIds(snap) {
  const known = snap?.orgIndex?.organizationsById
  const ids = new Set()
  for (const a of snap?.assignments ?? []) {
    for (const s of a.scopes ?? []) {
      if (s.kind === 'ORGANIZATION' && s.organizationId && (!known || known.has(s.organizationId))) ids.add(s.organizationId)
    }
  }
  return [...ids].sort()
}

/**
 * The organizations at which the CENTRAL evaluator allows `code` for this caller. Throws 401 / 403 (STEP_UP_REQUIRED
 * when that is the only thing missing, PERMISSION_DENIED otherwise: no rule is disclosed). Never returns an empty list.
 * `authorizedOrganizations` also returns the loaded snapshot ({ ids, snap }) so a route can reuse its organization index.
 * `authz` is { loadSnapshot, decide } from server/lib/authz/index.mjs (injectable for tests).
 */
export async function authorizedOrganizations(r, authz, code, resourceType, options = {}) {
  if (!r.auth?.user) throw authError(401, 'AUTH_REQUIRED', 'Authentication required.')
  const snap = await authz.loadSnapshot(r.auth, {})
  const allowed = []
  let stepUp = false
  for (const organizationId of candidateOrganizationIds(snap)) {
    const res = await authz.decide(snap, r.auth, code, { type: resourceType, facts: { organizationId } }, { requestId: r.requestId, ...options })
    if (res.decision === 'ALLOW') allowed.push(organizationId)
    else if (res.reason === 'STEP_UP_REQUIRED') stepUp = true
  }
  if (allowed.length) return { ids: allowed, snap }
  if (stepUp) throw authError(403, 'STEP_UP_REQUIRED', 'Please confirm your identity again to continue.', { stepUpRequired: true })
  throw DENIED()
}

export async function authorizedOrganizationIds(r, authz, code, resourceType, options = {}) {
  return (await authorizedOrganizations(r, authz, code, resourceType, options)).ids
}

/** Prisma filter: only rows attributed to one of these organizations (unattributed NULL rows never match). */
export const inOrganizations = (organizationIds) => ({ organizationId: { in: organizationIds } })

/**
 * Prisma filter on role-assignment SCOPES that sit inside the given organizations: ORGANIZATION scopes directly, and
 * legal-entity / business-unit / platform scopes through the organization tree. Department / property / vehicle / project /
 * self scopes are not attributable to an organization here and are excluded (fail closed).
 */
export function scopesWithinOrganizations(orgIndex, organizationIds) {
  const orgs = new Set(organizationIds)
  const legalEntityIds = []; const businessUnitIds = []; const platformIds = []
  const les = orgIndex?.legalEntitiesById ?? new Map(); const bus = orgIndex?.businessUnitsById ?? new Map(); const platforms = orgIndex?.platformsById ?? new Map()
  for (const le of les.values()) if (orgs.has(le.organizationId)) legalEntityIds.push(le.id)
  const leSet = new Set(legalEntityIds)
  for (const bu of bus.values()) if (leSet.has(bu.legalEntityId)) businessUnitIds.push(bu.id)
  const buSet = new Set(businessUnitIds)
  for (const p of platforms.values()) if (buSet.has(p.businessUnitId)) platformIds.push(p.id)
  const clauses = [{ kind: 'ORGANIZATION', organizationId: { in: [...orgs] } }]
  if (legalEntityIds.length) clauses.push({ kind: 'LEGAL_ENTITY', legalEntityId: { in: legalEntityIds } })
  if (businessUnitIds.length) clauses.push({ kind: 'BUSINESS_UNIT', businessUnitId: { in: businessUnitIds } })
  if (platformIds.length) clauses.push({ kind: 'PLATFORM', platformId: { in: platformIds } })
  return { some: { OR: clauses } }
}

/**
 * The single organization a user acts in, from the user's OWN active ORGANIZATION-scoped assignments; null when there is
 * none or several (fail closed: an ambiguous actor organization never attributes a record). Used for user-level events
 * (own session, own step-up) that are not about one organization's resource.
 */
export async function resolveActorOrganizationId(client, userId) {
  if (!userId) return null
  const rows = await client.roleAssignment.findMany({
    where: { userId, status: 'ACTIVE', revokedAt: null, scopes: { some: { kind: 'ORGANIZATION' } } },
    select: { scopes: { where: { kind: 'ORGANIZATION' }, select: { organizationId: true } } },
  })
  const ids = [...new Set(rows.flatMap((a) => a.scopes.map((s) => s.organizationId)).filter(Boolean))]
  return ids.length === 1 ? ids[0] : null
}

/**
 * The single organization a set of assignment scope rows belongs to (organization directly, or through the legal-entity /
 * business-unit / platform tree); null when none or more than one organization is involved.
 */
export async function organizationOfScopes(client, scopes) {
  const ids = new Set()
  for (const s of scopes ?? []) {
    let orgId = null
    if (s.kind === 'ORGANIZATION') orgId = s.organizationId
    else if (s.kind === 'LEGAL_ENTITY') orgId = (await client.legalEntity.findUnique({ where: { id: s.legalEntityId }, select: { organizationId: true } }))?.organizationId
    else if (s.kind === 'BUSINESS_UNIT') orgId = (await client.businessUnit.findUnique({ where: { id: s.businessUnitId }, select: { legalEntity: { select: { organizationId: true } } } }))?.legalEntity?.organizationId
    else if (s.kind === 'PLATFORM') orgId = (await client.platform.findUnique({ where: { id: s.platformId }, select: { businessUnit: { select: { legalEntity: { select: { organizationId: true } } } } } }))?.businessUnit?.legalEntity?.organizationId
    if (!orgId) return null // a scope that cannot be placed in an organization makes the whole attribution ambiguous
    ids.add(orgId)
  }
  return ids.size === 1 ? [...ids][0] : null
}
