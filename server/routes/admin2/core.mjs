// STEP 5 -- /api/admin2 core: who am I, what may I see, context registry, step-up, own sessions.
import { db } from '../../lib/prisma.mjs'
import { dbNow, trustedNow } from '../../lib/authz/clock.mjs'
import { verifyPassword } from '../../lib/security.mjs'
import { isRateLimited, clientIp } from '../../lib/rateLimit.mjs'
import { loadSnapshot, decide } from '../../lib/authz/index.mjs'
import { holdsPermissionAnywhere } from '../../lib/authz/evaluate.mjs'
import { loadPermission } from '../../lib/authz/loader.mjs'
import { computeLanding } from '../../lib/authz/landing.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { badRequest, notFoundError } from './router.mjs'



export async function heldCodes(snap, user) {
  const defs = await snap.client.permissionDefinition.findMany({ where: { deprecated: false } })
  const held = new Set()
  for (const d of defs) {
    if (holdsPermissionAnywhere({ user, permission: { code: d.code, deprecated: d.deprecated }, assignments: snap.assignments, suspensions: snap.suspensions, now: snap.now })) held.add(d.code)
  }
  return held
}

// The platform shells this user may open. Evaluated per platform through the SAME decide() as
// every other action (permission + scope + platform coverage), never by a name check.
export async function authorizedPlatformsFor(snap, ctx, requestId) {
  const platforms = await db().platform.findMany({ orderBy: { sortOrder: 'asc' } })
  const out = []
  for (const p of platforms) {
    const r = await decide(snap, ctx, 'platform.view', { type: 'platform_shell', id: p.code, platform: p.code, facts: { platformCode: p.code } }, { requestId })
    out.push({ ...p, authorized: r.decision === 'ALLOW' })
  }
  return out
}

export function registerCore(router) {
  router.get('/me', async (r) => {
    await r.requireAnywhere('console.access')
    const user = r.auth.user
    const snap = await loadSnapshot(r.auth)
    const held = await heldCodes(snap, { id: user.id, status: user.status })
    const platforms = await authorizedPlatformsFor(snap, r.auth, r.requestId)
    const authorized = platforms.filter((p) => p.authorized)
    const setting = await db().adminSetting.findUnique({ where: { category_key: { category: 'landing', key: 'default' } } })
    const landing = computeLanding({ permissions: held, authorizedPlatforms: authorized.map((p) => ({ code: p.code, route: p.route })), configuredDefault: setting?.value?.route ?? null })
    const session = r.auth.sessionId ? await db().userSession.findUnique({ where: { id: r.auth.sessionId }, select: { id: true, issuedAt: true, expiresAt: true, stepUpAt: true } }) : null
    r.ok({
      user: { id: user.id, displayName: user.displayName, email: user.email },
      permissions: [...held].sort(),
      platforms: platforms.map((p) => ({ code: p.code, displayName: p.displayName, route: p.route, status: p.status, authorized: p.authorized })),
      landing,
      authentication: { strength: snap.auth.authStrength, mfaMethod: snap.auth.mfaMethod, recentAuthAt: snap.auth.recentAuthAt, stepUpWindowsMinutes: { t3: snap.policy.stepUpWindowMs[3] / 60000, t4: snap.policy.stepUpWindowMs[4] / 60000 } },
      session: session && { id: session.id, issuedAt: session.issuedAt, expiresAt: session.expiresAt },
    })
  })

  // Context switcher registry: ONLY scopes the user is authorized for (Step 5 section 6). The
  // organization/legal-entity/business-unit levels appear only as ancestors of a platform the user
  // may open, or because an assignment is scoped to them. Names come from the database.
  router.get('/context', async (r) => {
    await r.requireAnywhere('console.access')
    const snap = await loadSnapshot(r.auth)
    const platforms = (await authorizedPlatformsFor(snap, r.auth, r.requestId)).filter((p) => p.authorized)
    const { orgIndex } = snap
    const buIds = new Set(platforms.map((p) => p.businessUnitId).filter(Boolean))
    const scopeKinds = snap.assignments.flatMap((a) => a.scopes)
    for (const s of scopeKinds) if (s.kind === 'BUSINESS_UNIT') buIds.add(s.businessUnitId)
    const leIds = new Set([...buIds].map((id) => orgIndex.businessUnitsById.get(id)?.legalEntityId).filter(Boolean))
    for (const s of scopeKinds) if (s.kind === 'LEGAL_ENTITY') leIds.add(s.legalEntityId)
    const orgIds = new Set([...leIds].map((id) => orgIndex.legalEntitiesById.get(id)?.organizationId).filter(Boolean))
    for (const s of scopeKinds) if (s.kind === 'ORGANIZATION') orgIds.add(s.organizationId)
    // An ORGANIZATION / LEGAL_ENTITY / BUSINESS_UNIT scope covers everything beneath it: include children.
    const expand = { legalEntities: new Set(leIds), businessUnits: new Set(buIds) }
    for (const s of scopeKinds) {
      if (s.kind === 'ORGANIZATION') for (const le of orgIndex.legalEntitiesById.values()) if (le.organizationId === s.organizationId) expand.legalEntities.add(le.id)
    }
    for (const s of scopeKinds) {
      if (s.kind === 'ORGANIZATION' || s.kind === 'LEGAL_ENTITY') {
        for (const bu of orgIndex.businessUnitsById.values()) if (expand.legalEntities.has(bu.legalEntityId)) expand.businessUnits.add(bu.id)
      }
    }
    r.ok({
      organizations: [...orgIds].map((id) => orgIndex.organizationsById.get(id)).filter(Boolean).map((o) => ({ id: o.id, code: o.code, name: o.name })),
      legalEntities: [...expand.legalEntities].map((id) => orgIndex.legalEntitiesById.get(id)).filter(Boolean).map((o) => ({ id: o.id, code: o.code, name: o.legalName, organizationId: o.organizationId })),
      businessUnits: [...expand.businessUnits].map((id) => orgIndex.businessUnitsById.get(id)).filter(Boolean).map((o) => ({ id: o.id, code: o.code, name: o.name, legalEntityId: o.legalEntityId })),
      platforms: platforms.map((p) => ({ id: p.id, code: p.code, displayName: p.displayName, businessUnitId: p.businessUnitId, route: p.route, status: p.status })),
    })
  })

  // Step-up (foundation): re-enter the account password. Fail-closed windows are enforced by the
  // evaluator; this only refreshes the session's step_up_at. Rate limited per user and per IP.
  router.post('/step-up', async (r) => {
    await r.requireAnywhere('console.access')
    const user = r.auth.user
    if (await isRateLimited(`admin2-step-up:${user.id}`, 15 * 60_000, 8) || await isRateLimited(`admin2-step-up-ip:${clientIp(r.req)}`, 15 * 60_000, 30)) {
      const error = new Error('Too many attempts. Wait a few minutes.')
      error.statusCode = 429; error.code = 'RATE_LIMITED'; error.expose = true
      throw error
    }
    const body = await r.body()
    const full = await db().user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
    const good = body?.password && full?.passwordHash && verifyPassword(String(body.password), full.passwordHash)
    if (!good) {
      await writeAdminAudit(db(), { actorUserId: user.id, action: 'security.step_up_failed', entityType: 'user_session', entityId: r.auth.sessionId, correlationId: r.requestId })
      const error = new Error('That password is not correct.')
      error.statusCode = 401; error.code = 'STEP_UP_FAILED'; error.expose = true
      throw error
    }
    let now
    await db().$transaction(async (tx) => {
      now = await dbNow(tx) // database clock stamps the step-up
      await tx.userSession.update({ where: { id: r.auth.sessionId }, data: { stepUpAt: now } })
      await writeAdminAudit(tx, { actorUserId: user.id, action: 'security.step_up_succeeded', entityType: 'user_session', entityId: r.auth.sessionId, correlationId: r.requestId })
    })
    r.ok({ stepUpAt: now })
  })

  // Own sessions (never exposes tokens).
  router.get('/sessions', async (r) => {
    await r.requireAnywhere('session.view_own')
    r.ok({ sessions: await listSessions(r.auth.user.id, r.auth.sessionId) })
  })

  router.post('/sessions/:id/revoke', async (r) => {
    const target = await db().userSession.findUnique({ where: { id: r.params.id } })
    if (!target || target.userId !== r.auth.user.id) throw notFoundError('Session not found.')
    await r.requireAnywhere('session.revoke_own')
    if (target.id === r.auth.sessionId) throw badRequest('Use sign out to end the session you are using.', 'CANNOT_REVOKE_CURRENT')
    await db().$transaction(async (tx) => {
      await tx.userSession.updateMany({ where: { id: target.id, revokedAt: null }, data: { revokedAt: trustedNow(), revokedReason: 'admin2_self_revoke' } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'security.session_revoked', entityType: 'user_session', entityId: target.id, correlationId: r.requestId, reason: 'own session' })
    })
    r.ok({ revoked: true })
  })
}

export async function listSessions(userId, currentSessionId) {
  const rows = await db().userSession.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: trustedNow() } }, orderBy: { issuedAt: 'desc' }, take: 50 })
  return rows.map((s) => ({
    id: s.id, current: s.id === currentSessionId, createdAt: s.createdAt, issuedAt: s.issuedAt, expiresAt: s.expiresAt, lastUsedAt: s.lastUsedAt,
    device: summarizeUserAgent(s.userAgent), stepUpAt: s.stepUpAt,
  }))
}

export function summarizeUserAgent(ua) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS'
  return `${browser} on ${os}`
}
