import { trustedNow } from './clock.mjs'
// STEP 5 -- the ONE authorization entry point for admin code (Step 5 spec section 8):
//   can(ctx, permission, resource, options)       -> result (never throws on deny)
//   authorize(ctx, permission, resource, options) -> result, or throws 401/403 (deny by default)
//
// Route handlers, search, navigation and exports all call this. Components never invent their own
// conditions. The frontend may display the result, but the server always re-decides.
import { db } from '../prisma.mjs'
import { log } from '../logger.mjs'
import { evaluateAccess, holdsPermissionAnywhere, DENY } from './evaluate.mjs'
import { loadAssignmentsForUser, loadOrgIndex, loadPermission, loadPolicy, loadSuspensions } from './loader.mjs'
import { writeEvidence } from './evidence.mjs'
import { PERMISSION_RULESET_VERSION } from './catalogue.mjs'

export { DENY } from './evaluate.mjs'

function authError(statusCode, code, message, extra = {}) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  Object.assign(error, extra)
  return error
}

// How strongly this session authenticated. Derived from what the existing login flow enforces: an
// account holding the legacy ADMIN role cannot sign in without an emailed one-time code
// (server/lib/admin-login.mjs). Recorded as derived evidence; richer MFA methods plug in here later.
export function sessionAuthFacts(ctx, sessionRow) {
  // Strength comes from how THIS session was issued (user_sessions.mfa_method, set only when the
  // emailed admin code was verified). Legacy ADMIN sessions issued before 080 are recognised by role.
  const legacyAdmin = sessionRow?.mfaMethod === 'EMAIL_OTP' || (Array.isArray(ctx?.roles) && ctx.roles.includes('ADMIN'))
  const issuedAt = sessionRow?.issuedAt ?? null
  const stepUpAt = sessionRow?.stepUpAt ?? null
  const recentAuthAt = [issuedAt, stepUpAt].filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  return {
    recentAuthAt,
    authStrength: legacyAdmin ? 'PASSWORD_PLUS_EMAIL_CODE' : 'PASSWORD',
    mfaMethod: legacyAdmin ? 'EMAIL_OTP' : null,
    mfaResult: legacyAdmin ? 'VERIFIED_AT_LOGIN' : 'NOT_PERFORMED',
  }
}

/** Load everything the evaluator needs ONCE, so many decisions in one request cost one round of queries. */
export async function loadSnapshot(ctx, options = {}) {
  const client = options.tx || db()
  const now = options.now ?? trustedNow()
  const [assignments, suspensions, orgIndex, policy, sessionRow] = await Promise.all([
    loadAssignmentsForUser(client, ctx.user.id),
    loadSuspensions(client),
    loadOrgIndex(client),
    loadPolicy(client, now),
    ctx.sessionId ? client.userSession.findUnique({ where: { id: ctx.sessionId }, select: { issuedAt: true, stepUpAt: true, mfaMethod: true } }) : null,
  ])
  return { client, now, assignments, suspensions, orgIndex, policy, auth: sessionAuthFacts(ctx, sessionRow) }
}

function evidenceRecord(ctx, code, permission, resource, result, snap, options) {
  return {
    userId: ctx.user.id, sessionId: ctx.sessionId ?? null,
    roleAssignmentId: result.grant?.assignmentId ?? null, roleVersionId: result.grant?.roleVersionId ?? null,
    roleCode: result.grant?.roleCode ?? null, roleVersionNumber: result.grant?.roleVersionNumber ?? null,
    permissionId: permission?.id ?? null, permissionCode: code,
    scopeId: result.grant?.scopeId ?? null, scopeKind: result.grant?.scopeKind ?? null, scopeTarget: result.grant?.scopeTarget ?? null,
    scopeDescription: result.grant?.scopeDescription ?? null, platformContext: result.grant?.platformContext ?? null,
    resourceType: resource.type ?? null, resourceId: resource.id != null ? String(resource.id) : null,
    action: options.action ?? code.split('.').pop(),
    authStrength: snap.auth.authStrength, mfaMethod: snap.auth.mfaMethod, mfaResult: snap.auth.mfaResult, recentAuthAt: snap.auth.recentAuthAt,
    requestId: options.requestId ?? null, correlationId: options.correlationId ?? options.requestId ?? null,
    decision: result.decision, denyReason: result.reason, policyVersionId: snap.policy.id ?? null, rulesetVersion: PERMISSION_RULESET_VERSION,
    auditEventId: options.auditEventId ?? null, approvalSnapshotId: options.approvalSnapshotId ?? null,
  }
}

/** Decide against an already-loaded snapshot. Writes evidence for T3/T4 (or when forced). */
export async function decide(snap, ctx, code, resource = {}, options = {}) {
  // Permission definitions are read once per snapshot (a list endpoint decides many times).
  snap.permissionCache ??= new Map()
  let permission = snap.permissionCache.get(code)
  if (permission === undefined) { permission = await loadPermission(snap.client, code); snap.permissionCache.set(code, permission) }
  const result = evaluateAccess({
    user: { id: ctx.user.id, status: ctx.user.status }, permission, assignments: snap.assignments, suspensions: snap.suspensions,
    resource, orgIndex: snap.orgIndex, policy: snap.policy, context: { now: snap.now, session: { recentAuthAt: snap.auth.recentAuthAt } },
  })
  if (options.evidence === true || (permission && permission.tier >= 3)) {
    const record = evidenceRecord(ctx, code, permission, resource, result, snap, options)
    // Inside the caller's transaction when one was given; otherwise its own (fail closed on error).
    if (options.tx) await writeEvidence(options.tx, record)
    else await db().$transaction((tx) => writeEvidence(tx, record))
  }
  if (result.decision === 'DENY') {
    log.warn('authz_denied', { userId: ctx.user.id, permission: code, reason: result.reason, requestId: options.requestId })
  }
  return { ...result, permission }
}

/**
 * @param ctx        result of getAuthContext(req): { user, roles, sessionId }
 * @param code       permission code, e.g. 'user.view'
 * @param resource   { type, id?, platform?, platforms?, facts? } -- facts carry the resource's scope facts
 * @param options    { requestId, correlationId, tx, evidence (force), action, now, auditEventId, approvalSnapshotId }
 */
export async function can(ctx, code, resource = {}, options = {}) {
  if (!ctx?.user) return { decision: 'DENY', reason: 'NOT_AUTHENTICATED', grant: null, visiblePlatforms: null, stepUpRequired: false }
  const snap = await loadSnapshot(ctx, options)
  return decide(snap, ctx, code, resource, options)
}

/** Many resources, one permission, one snapshot (e.g. which platforms may this user open?). */
export async function canMany(ctx, code, resources, options = {}) {
  if (!ctx?.user) return resources.map(() => ({ decision: 'DENY', reason: 'NOT_AUTHENTICATED' }))
  const snap = await loadSnapshot(ctx, options)
  const out = []
  for (const r of resources) out.push(await decide(snap, ctx, code, r, options))
  return out
}

export async function authorize(ctx, code, resource = {}, options = {}) {
  if (!ctx?.user) throw authError(401, 'AUTH_REQUIRED', 'Authentication required.')
  const result = await can(ctx, code, resource, options)
  if (result.decision === 'ALLOW') return result
  if (result.reason === DENY.STEP_UP_REQUIRED) throw authError(403, 'STEP_UP_REQUIRED', 'Please confirm your identity again to continue.', { stepUpRequired: true })
  // The client learns only that access was denied, never which rule fired (no enumeration).
  throw authError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')
}

/** Which of these permissions does the user hold anywhere (any scope)? For navigation display only. */
export async function permissionSummary(ctx, codes, options = {}) {
  const client = options.tx || db()
  const out = {}
  if (!ctx?.user) { for (const c of codes) out[c] = false; return out }
  const [assignments, suspensions, defs] = await Promise.all([
    loadAssignmentsForUser(client, ctx.user.id), loadSuspensions(client),
    client.permissionDefinition.findMany({ where: { code: { in: codes } } }),
  ])
  const byCode = new Map(defs.map((d) => [d.code, { code: d.code, deprecated: d.deprecated }]))
  for (const code of codes) {
    out[code] = holdsPermissionAnywhere({ user: { id: ctx.user.id, status: ctx.user.status }, permission: byCode.get(code) ?? null, assignments, suspensions, now: options.now ?? trustedNow() })
  }
  return out
}
