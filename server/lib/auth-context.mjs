import { db } from './prisma.mjs'
import { verifySessionToken } from './security.mjs'

// Scale-readiness follow-up: every authenticated request re-fetched the user + roles from the DB,
// even for back-to-back requests from the same session a few hundred milliseconds apart -- the
// single largest per-request DB load multiplier in the app (identified in
// docs/launch/SCALE_READINESS_1M.md as the #1 blocker past ~5-20k users, ahead of connection
// pooling). Cached per-process, keyed by user id, short TTL. A short TTL is a deliberate tradeoff:
// an admin suspending a user or changing their roles can take up to CACHE_TTL_MS to take effect for
// that user's own already-issued session, in exchange for cutting the DB round-trip on most
// requests. Not shared across replicas (unlike rate-limit/email-suppression, which needed a shared
// store for CORRECTNESS) -- a stale cache entry here is a bounded staleness window, not a security
// bypass class, so a per-process cache is the right tool, not a premature optimization.
const CACHE_TTL_MS = Number(process.env.AUTH_SESSION_CACHE_TTL_MS || 30_000)
const userCache = new Map() // userId -> { value: {user, roles}, expiresAt }

function getCached(userId) {
  const entry = userCache.get(userId)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    userCache.delete(userId)
    return null
  }
  return entry.value
}

function setCached(userId, value) {
  userCache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

// Exported so a future admin suspend/ban/role-change feature can call this and immediately drop
// the stale cache entry rather than wait out the TTL. Checked (2026-08-27): no code path in this
// app currently mutates user.status or user_roles after account creation, so there is no actual
// staleness exposure today -- this exists for when that changes, not because it's wired somewhere.
export function invalidateAuthCache(userId) {
  userCache.delete(userId)
}

export async function getAuthContext(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const session = token ? verifySessionToken(token) : null
  if (!session?.sub) return null

  const cached = getCached(session.sub)
  if (cached) return cached

  const user = await db().user.findUnique({
    where: { id: session.sub },
    include: { roles: true },
  })
  if (!user || user.status !== 'ACTIVE') {
    invalidateAuthCache(session.sub)
    return null
  }

  const context = {
    user,
    roles: user.roles.map((item) => item.role),
  }
  setCached(session.sub, context)
  return context
}

export function requireAuth(context, roles = []) {
  if (!context?.user) {
    const error = new Error('Authentication required.')
    error.statusCode = 401
    error.code = 'AUTH_REQUIRED'
    error.expose = true
    throw error
  }

  if (roles.length > 0 && !roles.some((role) => context.roles.includes(role))) {
    const error = new Error('This account does not have permission for this V6 action.')
    error.statusCode = 403
    error.code = 'FORBIDDEN'
    error.expose = true
    throw error
  }
}
