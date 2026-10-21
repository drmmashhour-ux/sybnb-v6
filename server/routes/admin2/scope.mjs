// STEP 5 -- shared helpers for module routes: which platform-scoped records may this user see, and
// per-record authorization. Both go through the SAME central decide() as everything else.
//
// STEP 5I: no helper here chooses "the" organization. A record's organization comes from the record itself:
//   * a record with a platform  -> that platform's organization (platform -> business unit -> legal entity -> organization);
//   * a record without a platform and without an organization column -> the registry's sole organization when it has exactly
//     one, otherwise it is UNATTRIBUTED and nobody is authorized for it (fail closed). See org-boundary.mjs.
// The organization is never read from the request.
import { db } from '../../lib/prisma.mjs'
import { loadSnapshot, decide } from '../../lib/authz/index.mjs'
import { loadOrgIndex } from '../../lib/authz/loader.mjs'
import { organizationOfRecord, soleOrganizationId, authorizedPlaces, requireAtOrganizations } from '../../lib/authz/org-boundary.mjs'

const err = (status, code, message) => Object.assign(new Error(message), { statusCode: status, code, expose: true })

// Not cached: a record's organization comes from the registry as it is NOW (organizations / platforms can be added at any time).
export async function registryContext() {
  const [orgIndex, platforms] = await Promise.all([loadOrgIndex(db()), db().platform.findMany()])
  return { orgIndex, platforms }
}

/** Organization of a record (see the header). null = unattributed. */
export async function recordOrganizationId(platformId = null) {
  const { orgIndex } = await registryContext()
  return organizationOfRecord(orgIndex, { platformId })
}

/** The organization an audit row of a record belongs to: the record's own organization, never a default. null = unattributed. */
export async function auditOrganizationId(platformId = null) {
  return recordOrganizationId(platformId)
}

/** Facts for a record that belongs to a platform (or to the organization-level when platformId is null). */
export async function recordFacts(platformId, extra = {}) {
  const { orgIndex } = await registryContext()
  const platform = platformId ? orgIndex.platformsById.get(platformId) : null
  const organizationId = organizationOfRecord(orgIndex, { platformId })
  return { ...(organizationId ? { organizationId } : {}), ...(platform ? { platformCode: platform.code } : {}), ...extra }
}

/**
 * Which records can the user list under `code`? Evaluates once per platform (at that platform's OWN organization) + once for
 * organization-level records (only when the registry has a sole organization). Use for tier 1-2 permissions only (tier 3+
 * writes evidence per decision, so those are authorized per record instead). Throws 403 when the user can see nothing.
 */
export async function visibleScope(r, code) {
  // Step 5G: an anonymous call used to crash with a 500 further down; it is an authentication failure, answered as one.
  if (!r.auth?.user) throw err(401, 'AUTH_REQUIRED', 'Authentication required.')
  const snap = await loadSnapshot(r.auth)
  const { orgIndex, platforms } = await registryContext()
  const ok = async (facts) => (await decide(snap, r.auth, code, { type: 'list', facts }, { requestId: r.requestId })).decision === 'ALLOW'
  const sole = soleOrganizationId(orgIndex)
  const orgLevel = sole ? await ok({ organizationId: sole }) : false
  const platformIds = []
  for (const p of platforms) {
    const organizationId = organizationOfRecord(orgIndex, { platformId: p.id })
    if (organizationId && await ok({ organizationId, platformCode: p.code })) platformIds.push(p.id)
  }
  if (!orgLevel && platformIds.length === 0) throw err(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')
  const clauses = []
  if (orgLevel) clauses.push({ platformId: null })
  if (platformIds.length) clauses.push({ platformId: { in: platformIds } })
  return { orgLevel, platformIds, where: { OR: clauses } }
}

/** Authorize one record. Resource facts come from the record itself, never from the client. */
export async function requireRecord(r, code, platformId, type, id, options = {}) {
  return r.require(code, { type, id, facts: await recordFacts(platformId, options.facts) }, options)
}

export async function canRecord(r, code, platformId, type, id, options = {}) {
  const res = await r.can(code, { type, id, facts: await recordFacts(platformId, options.facts) }, options)
  return res.decision === 'ALLOW'
}

export async function addTimeline(tx, { entityType, entityId, eventType, actorUserId, summary, detail = {} }) {
  return tx.timelineEvent.create({ data: { entityType, entityId: String(entityId), eventType, actorUserId: actorUserId ?? null, summary: String(summary).slice(0, 300), detail } })
}

export function validateEnum(value, allowed, name) {
  if (!allowed.includes(value)) throw Object.assign(new Error(`${name} is not valid.`), { statusCode: 400, code: 'VALIDATION_ERROR', expose: true })
  return value
}

export function cleanText(value, { min = 1, max = 500, name = 'Text' } = {}) {
  const s = String(value ?? '').trim()
  if (s.length < min || s.length > max) throw Object.assign(new Error(`${name} must be ${min}-${max} characters.`), { statusCode: 400, code: 'VALIDATION_ERROR', expose: true })
  return s
}

// GLOBAL records (settings, feature flags, the role catalogue) have no organization of their own.
//   view  : the central evaluator must allow it at some place the caller sits at;
//   change: it must be allowed at EVERY organization of the registry (one organization's administrator cannot change what all of them share).
export const requireGlobalView = (r, code, type) => authorizedPlaces(r, { loadSnapshot, decide }, code, type)
export async function requireGlobalWrite(r, code, type, id, options = {}) {
  const { orgIndex } = await registryContext()
  const ids = [...orgIndex.organizationsById.keys()].sort()
  await requireAtOrganizations(r, code, ids, (organizationId) => ({ type, id, facts: { organizationId } }), options)
  return ids
}
/** A change to a global record is audited in EVERY organization it affects. */
export async function auditGlobal(tx, organizationIds, row, write) {
  for (const organizationId of organizationIds?.length ? organizationIds : [null]) await write(tx, { ...row, organizationId })
}
