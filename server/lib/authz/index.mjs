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
  const legacyAdmin = Array.isArray(ctx?.roles) && ctx.roles.includes('ADMIN')
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

/**
 * @param ctx        result of getAuthContext(req): { user, roles, sessionId }
 * @param code       permission code, e.g. 'iam.user.read'
 * @param resource   { type, id?, platform?, platforms?, facts? } -- facts carry the resource's scope facts
 * @param options    { requestId, correlationId, tx, evidence (force), action, now, auditEventId, approvalSnapshotId }
 */
export async function can(ctx, code, resource = {}, options = {}) {
  const client = options.tx || db()
  const now = options.now ?? new Date()
  if (!ctx?.user) return { decision: 'DENY', reason: 'NOT_AUTHENTICATED', grant: null, visiblePlatforms: null, stepUpRequired: false }

  const [permission, assignments, suspensions, orgIndex, policy, sessionRow] = await Promise.all([
    loadPermission(client, code),
    loadAssignmentsForUser(client, ctx.user.id),
    loadSuspensions(client),
    loadOrgIndex(client),
    loadPolicy(client, now),
    ctx.sessionId ? client.userSession.findUnique({ where: { id: ctx.sessionId }, select: { issuedAt: true } }) : null,
  ])
  const auth = sessionAuthFacts(ctx, sessionRow)
  const result = evaluateAccess({
    user: { id: ctx.user.id, status: ctx.user.status }, permission, assignments, suspensions, resource, orgIndex, policy,
    context: { now, session: { recentAuthAt: auth.recentAuthAt } },
  })

  const mustRecord = options.evidence === true || (permission && permission.tier >= 3)
  if (mustRecord) {
    const record = {
      userId: ctx.user.id, sessionId: ctx.sessionId ?? null,
      roleAssignmentId: result.grant?.assignmentId ?? null, roleVersionId: result.grant?.roleVersionId ?? null,
      roleCode: result.grant?.roleCode ?? null, roleVersionNumber: result.grant?.roleVersionNumber ?? null,
      permissionId: permission?.id ?? null, permissionCode: code,
      scopeId: result.grant?.scopeId ?? null, scopeKind: result.grant?.scopeKind ?? null, scopeTarget: result.grant?.scopeTarget ?? null,
      scopeDescription: result.grant?.scopeDescription ?? null, platformContext: result.grant?.platformContext ?? null,
      resourceType: resource.type ?? null, resourceId: resource.id != null ? String(resource.id) : null,
      action: options.action ?? code.split('.').pop(),
      authStrength: auth.authStrength, mfaMethod: auth.mfaMethod, mfaResult: auth.mfaResult, recentAuthAt: auth.recentAuthAt,
      requestId: options.requestId ?? null, correlationId: options.correlationId ?? options.requestId ?? null,
      decision: result.decision, denyReason: result.reason, policyVersionId: policy.id ?? null,
      auditEventId: options.auditEventId ?? null, approvalSnapshotId: options.approvalSnapshotId ?? null,
    }
    // Inside the caller's transaction when one was given; otherwise its own (fail closed on error).
    if (options.tx) await writeEvidence(options.tx, record)
    else await db().$transaction((tx) => writeEvidence(tx, record))
  }
  if (result.decision === 'DENY') {
    log.warn('authz_denied', { userId: ctx.user.id, permission: code, reason: result.reason, requestId: options.requestId })
  }
  return result
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
    out[code] = holdsPermissionAnywhere({ user: { id: ctx.user.id, status: ctx.user.status }, permission: byCode.get(code) ?? null, assignments, suspensions, now: options.now ?? new Date() })
  }
  return out
}
