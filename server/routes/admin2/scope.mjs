// STEP 5 -- shared helpers for module routes: which platform-scoped records may this user see, and
// per-record authorization. Both go through the SAME central decide() as everything else.
import { db } from '../../lib/prisma.mjs'
import { loadSnapshot, decide } from '../../lib/authz/index.mjs'

const err = (status, code, message) => Object.assign(new Error(message), { statusCode: status, code, expose: true })

let ctxCache = { at: 0, org: null, platforms: [] }
export async function registryContext() {
  if (Date.now() - ctxCache.at > 15_000) {
    const [org, platforms] = await Promise.all([db().organization.findFirst({ orderBy: { createdAt: 'asc' } }), db().platform.findMany()])
    ctxCache = { at: Date.now(), org, platforms }
  }
  return ctxCache
}

/** Facts for a record that belongs to a platform (or to the organization when platformId is null). */
export async function recordFacts(platformId, extra = {}) {
  const { org, platforms } = await registryContext()
  const platform = platformId ? platforms.find((p) => p.id === platformId) : null
  return { organizationId: org?.id, ...(platform ? { platformCode: platform.code } : {}), ...extra }
}

/**
 * Which records can the user list under `code`? Evaluates once per platform + once for org-level
 * records. Use for tier 1-2 permissions only (tier 3+ writes evidence per decision, so those are
 * authorized per record instead). Throws 403 when the user can see nothing.
 */
export async function visibleScope(r, code) {
  // Step 5G: an anonymous call used to crash with a 500 further down; it is an authentication failure, answered as one.
  if (!r.auth?.user) throw err(401, 'AUTH_REQUIRED', 'Authentication required.')
  const snap = await loadSnapshot(r.auth)
  const { org, platforms } = await registryContext()
  const ok = async (facts) => (await decide(snap, r.auth, code, { type: 'list', facts }, { requestId: r.requestId })).decision === 'ALLOW'
  const orgLevel = await ok({ organizationId: org?.id })
  const platformIds = []
  for (const p of platforms) if (await ok({ organizationId: org?.id, platformCode: p.code })) platformIds.push(p.id)
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
