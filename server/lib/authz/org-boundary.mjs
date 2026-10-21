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

import { resolveChain, evaluateAccess } from './evaluate.mjs'

export function authError(statusCode, code, message, extra = {}) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  Object.assign(error, extra)
  return error
}

const DENIED = () => authError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')

// ---------------------------------------------------------------------------------------------------------------------
// STEP 5I -- ONE central way to place things in an organization. Nothing below decides access; every ALLOW still comes from
// decide() / evaluateAccess(). These helpers only answer "which organization is this scope / record / caller in?".
//   * a scope row         -> directly (ORGANIZATION) or through the tree LEGAL_ENTITY / BUSINESS_UNIT / PLATFORM -> its organization
//   * a record            -> its platform's organization (platform -> business unit -> legal entity -> organization)
//   * a record WITHOUT a platform and WITHOUT an organization column of its own -> the registry's SOLE organization, and only
//     when the registry has exactly one; with zero or several organizations it is unattributed (null) and fails closed.
//     This is not "the oldest organization": it never picks one of several.
// DEPARTMENT / PROPERTY / VEHICLE / PROJECT / SELF scopes cannot be placed in an organization on their own.
// ---------------------------------------------------------------------------------------------------------------------

/** The organization of ONE scope row through the organization tree (sync, from the loaded index); null if it cannot be placed. */
export function organizationOfScopeRow(orgIndex, s) {
  const orgs = orgIndex?.organizationsById
  const known = (id) => (id && (!orgs || orgs.has(id)) ? id : null)
  switch (s?.kind) {
    case 'ORGANIZATION': return known(s.organizationId)
    case 'LEGAL_ENTITY': return known(orgIndex?.legalEntitiesById?.get(s.legalEntityId)?.organizationId)
    case 'BUSINESS_UNIT': return known(orgIndex?.legalEntitiesById?.get(orgIndex?.businessUnitsById?.get(s.businessUnitId)?.legalEntityId)?.organizationId)
    case 'PLATFORM': {
      const bu = orgIndex?.businessUnitsById?.get(orgIndex?.platformsById?.get(s.platformId)?.businessUnitId)
      return known(orgIndex?.legalEntitiesById?.get(bu?.legalEntityId)?.organizationId)
    }
    default: return null
  }
}

/** Organizations a set of scope rows lead to (only the ones that can be placed). */
export function organizationsOfScopeRows(orgIndex, scopes) {
  const out = new Set()
  for (const s of scopes ?? []) { const id = organizationOfScopeRow(orgIndex, s); if (id) out.add(id) }
  return [...out].sort()
}

/** The registry's only organization, or null when there are none or several. Never picks one of several. */
export function soleOrganizationId(orgIndex) {
  const ids = [...(orgIndex?.organizationsById?.keys() ?? [])]
  return ids.length === 1 ? ids[0] : null
}

/** The organization a resource belongs to, from the facts it carries (platform / business unit / legal entity / organization). */
export function organizationOfFacts(orgIndex, facts) {
  const id = resolveChain(facts, orgIndex).organizationId
  return id && (!orgIndex?.organizationsById || orgIndex.organizationsById.has(id)) ? id : null
}

/**
 * The organization of a RECORD that may carry a platform. With a platform: that platform's organization (null when the platform is
 * not attached to the organization tree: fail closed). Without one: the sole organization of the registry, else null.
 */
export function organizationOfRecord(orgIndex, { platformId = null, platformCode = null } = {}) {
  if (platformId || platformCode) {
    const platform = platformId ? orgIndex?.platformsById?.get(platformId) : orgIndex?.platformsByCode?.get(platformCode)
    return platform ? organizationOfFacts(orgIndex, { platformCode: platform.code }) : null
  }
  return soleOrganizationId(orgIndex)
}

/** Organizations of a USER's assignments (scopes placed through the tree); falls back to the sole organization for unplaceable scopes only. */
export function organizationsOfAssignments(orgIndex, assignments) {
  const ids = organizationsOfScopeRows(orgIndex, (assignments ?? []).flatMap((a) => a.scopes ?? []))
  if (ids.length) return ids
  const sole = (assignments ?? []).length ? soleOrganizationId(orgIndex) : null
  return sole ? [sole] : []
}

/**
 * Organizations the caller could possibly hold a permission at: every organization the caller's OWN assignment scopes lead to,
 * whatever the scope kind (ORGANIZATION directly; LEGAL_ENTITY / BUSINESS_UNIT / PLATFORM through the tree). A legal-entity or
 * platform administrator therefore still reaches the central evaluator at their parent organization. Being a candidate grants
 * NOTHING: the evaluator then decides at that organization / resource, and a child scope does not match organization-level facts.
 */
export function candidateOrganizationIds(snap) {
  const known = snap?.orgIndex?.organizationsById
  const ids = new Set()
  for (const a of snap?.assignments ?? []) {
    for (const s of a.scopes ?? []) {
      const id = snap?.orgIndex ? organizationOfScopeRow(snap.orgIndex, s) : (s.kind === 'ORGANIZATION' ? s.organizationId : null)
      if (id && (!known || known.has(id))) ids.add(id)
    }
  }
  return [...ids].sort()
}
export const callerOrganizationIds = candidateOrganizationIds

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

/**
 * Authorize `code` at EVERY organization in `organizationIds` (one central decision each; the first refusal throws its own 403 /
 * STEP_UP_REQUIRED). An empty list is a refusal: a subject that cannot be placed in any organization is never authorized.
 * `build(organizationId)` returns the resource for that organization (the organization is trusted server state, never the request).
 */
export async function requireAtOrganizations(r, code, organizationIds, build, options = {}) {
  if (!organizationIds?.length) throw DENIED()
  for (const organizationId of organizationIds) await r.require(code, build(organizationId), options)
  return organizationIds
}

// ---------------------------------------------------------------------------------------------------------------------
// STEP 5I -- PLACES. A "place" is the most specific point of the organization tree a scope (or a record) sits at:
//   { organizationId }                                              an organization
//   { organizationId, legalEntityId }                               a legal entity
//   { organizationId, legalEntityId, businessUnitId }               a business unit
//   { organizationId, legalEntityId, businessUnitId, platformId, platformCode }   a platform
// A place is just FACTS for the central evaluator. A legal-entity / business-unit / platform administrator is evaluated AT THEIR
// OWN place, so they keep their legitimate access, and a child scope never matches organization-level facts, so it never
// grants organization-wide permissions. Platform A and platform B of the same organization are different places.
// ---------------------------------------------------------------------------------------------------------------------

const PLACE_KEY = (p) => [p.organizationId, p.legalEntityId ?? '', p.businessUnitId ?? '', p.platformId ?? ''].join('|')

/** The place of ONE scope row (null for scopes that cannot be placed: department / property / vehicle / project / self). */
export function placeOfScopeRow(orgIndex, s) {
  const organizationId = organizationOfScopeRow(orgIndex, s)
  if (!organizationId) return null
  switch (s.kind) {
    case 'ORGANIZATION': return { organizationId }
    case 'LEGAL_ENTITY': return { organizationId, legalEntityId: s.legalEntityId }
    case 'BUSINESS_UNIT': { const bu = orgIndex.businessUnitsById.get(s.businessUnitId); return { organizationId, legalEntityId: bu.legalEntityId, businessUnitId: bu.id } }
    case 'PLATFORM': {
      const pl = orgIndex.platformsById.get(s.platformId); const bu = orgIndex.businessUnitsById.get(pl.businessUnitId)
      return { organizationId, legalEntityId: bu.legalEntityId, businessUnitId: bu.id, platformId: pl.id, platformCode: pl.code }
    }
    default: return null
  }
}

/** Evaluator facts for a place (organization / legal entity / business unit / platform code). */
export function factsOfPlace(place) {
  const f = { organizationId: place.organizationId }
  if (place.legalEntityId) f.legalEntityId = place.legalEntityId
  if (place.businessUnitId) f.businessUnitId = place.businessUnitId
  if (place.platformCode) f.platformCode = place.platformCode
  return f
}

/** Distinct places of a set of scope rows. */
export function placesOfScopeRows(orgIndex, scopes) {
  const seen = new Map()
  for (const s of scopes ?? []) { const p = placeOfScopeRow(orgIndex, s); if (p && !seen.has(PLACE_KEY(p))) seen.set(PLACE_KEY(p), p) }
  return [...seen.values()]
}

/**
 * The places a SUBJECT (a user, an assignment) is in: the places of its scopes. A subject with only unplaceable scopes (or, for a user,
 * with assignments but none placeable) falls back to the registry's sole organization when there is exactly one; otherwise [] (fail closed).
 */
export function placesOfSubject(orgIndex, scopes, { hasAssignments = true } = {}) {
  const places = placesOfScopeRows(orgIndex, scopes)
  if (places.length) return places
  const sole = hasAssignments ? soleOrganizationId(orgIndex) : null
  return sole ? [{ organizationId: sole }] : []
}

/** Places a CALLER sits at (their own assignment scopes). Being at a place grants nothing; the evaluator decides there. */
export function callerPlaces(snap) {
  return snap?.orgIndex ? placesOfScopeRows(snap.orgIndex, (snap.assignments ?? []).flatMap((a) => a.scopes ?? [])) : []
}

/**
 * The places at which the CENTRAL evaluator allows `code` for this caller (each caller place decided individually). Throws 401 / 403
 * (STEP_UP_REQUIRED when that is the only thing missing). Never returns an empty list.
 */
export async function authorizedPlaces(r, authz, code, resourceType, options = {}) {
  if (!r.auth?.user) throw authError(401, 'AUTH_REQUIRED', 'Authentication required.')
  const snap = await authz.loadSnapshot(r.auth, {})
  const allowed = []
  let stepUp = false
  for (const place of callerPlaces(snap)) {
    const res = await authz.decide(snap, r.auth, code, { type: resourceType, facts: factsOfPlace(place) }, { requestId: r.requestId, ...options })
    if (res.decision === 'ALLOW') allowed.push(place)
    else if (res.reason === 'STEP_UP_REQUIRED') stepUp = true
  }
  if (allowed.length) return { places: allowed, snap }
  if (stepUp) throw authError(403, 'STEP_UP_REQUIRED', 'Please confirm your identity again to continue.', { stepUpRequired: true })
  throw DENIED()
}

/** Places that are whole organizations (organization-level resources are only visible through these). */
export const organizationLevelIds = (places) => [...new Set(places.filter((p) => !p.legalEntityId).map((p) => p.organizationId))]

/** True when `candidate` lies inside (or equals) any of the allowed places. A parent place covers its descendants; a child never covers its parent. */
export function placeWithin(candidate, allowedPlaces) {
  return allowedPlaces.some((a) => a.organizationId === candidate.organizationId
    && (!a.legalEntityId || a.legalEntityId === candidate.legalEntityId)
    && (!a.businessUnitId || a.businessUnitId === candidate.businessUnitId)
    && (!a.platformId || a.platformId === candidate.platformId))
}

/** A subject is visible when EVERY one of its places lies inside an allowed place (a multi-org subject is never fully visible to one org). */
export const subjectWithin = (subjectPlaces, allowedPlaces) => subjectPlaces.length > 0 && subjectPlaces.every((p) => placeWithin(p, allowedPlaces))
/** ...and partially visible when at least one place does (used to filter lists to the rows the caller may see). */
export const subjectTouches = (subjectPlaces, allowedPlaces) => subjectPlaces.some((p) => placeWithin(p, allowedPlaces))

/** Everything in the registry that lies inside the allowed places: { orgs, les, bus, platforms } (id Sets; descendants included, parents NOT). */
export function expandPlaces(orgIndex, places) {
  const orgs = new Set(); const les = new Set(); const bus = new Set(); const platforms = new Set()
  for (const p of places) {
    if (!p.legalEntityId) orgs.add(p.organizationId)
    else if (!p.businessUnitId) les.add(p.legalEntityId)
    else if (!p.platformId) bus.add(p.businessUnitId)
    else platforms.add(p.platformId)
  }
  for (const le of orgIndex?.legalEntitiesById?.values?.() ?? []) if (orgs.has(le.organizationId)) les.add(le.id)
  for (const bu of orgIndex?.businessUnitsById?.values?.() ?? []) if (les.has(bu.legalEntityId)) bus.add(bu.id)
  for (const pl of orgIndex?.platformsById?.values?.() ?? []) if (bus.has(pl.businessUnitId)) platforms.add(pl.id)
  return { orgs, les, bus, platforms }
}

/** Prisma filter on role-assignment SCOPES within the allowed places (descendants included; unplaceable scopes excluded). */
export function scopesWithinPlaces(orgIndex, places) {
  const { orgs, les, bus, platforms } = expandPlaces(orgIndex, places)
  const clauses = []
  if (orgs.size) clauses.push({ kind: 'ORGANIZATION', organizationId: { in: [...orgs] } })
  if (les.size) clauses.push({ kind: 'LEGAL_ENTITY', legalEntityId: { in: [...les] } })
  if (bus.size) clauses.push({ kind: 'BUSINESS_UNIT', businessUnitId: { in: [...bus] } })
  if (platforms.size) clauses.push({ kind: 'PLATFORM', platformId: { in: [...platforms] } })
  return { some: { OR: clauses.length ? clauses : [{ id: '00000000-0000-0000-0000-000000000000' }] } }
}

/** Authorize `code` at EVERY place in `places` (first refusal throws its own 403 / STEP_UP_REQUIRED). [] is a refusal. */
export async function requireAtPlaces(r, code, places, build, options = {}) {
  if (!places?.length) throw DENIED()
  for (const place of places) await r.require(code, build(factsOfPlace(place), place), options)
  return places
}

/**
 * STEP 5J -- does the CALLER hold `permission` (a loaded definition: { code, tier, highRisk, deprecated, noSelf }) at the place described by
 * `facts`? This is the central evaluator (evaluateAccess), evaluated read-only: no evidence is written and no request is decided.
 * A stale session (STEP_UP_REQUIRED) still counts as HOLDING it: freshness is enforced where the grant itself is authorized.
 * Used for anti-escalation: a grantor may hand out only what they hold AT THE PLACE the grant lands, never what they hold elsewhere.
 */
export function callerHoldsPermissionAt(snap, ctx, permission, facts) {
  if (!permission) return false
  const res = evaluateAccess({
    user: { id: ctx.user.id, status: ctx.user.status }, permission, assignments: snap.assignments, suspensions: snap.suspensions,
    resource: { type: 'role_assignment', facts }, orgIndex: snap.orgIndex, policy: snap.policy,
    context: { now: snap.now, timeTrusted: snap.timeTrusted, session: { recentAuthAt: snap.auth?.recentAuthAt } },
  })
  return res.decision === 'ALLOW' || res.reason === 'STEP_UP_REQUIRED'
}
