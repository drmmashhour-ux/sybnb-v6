import { db } from './prisma.mjs'
import { verifySessionToken } from './security.mjs'

// SEC-002. This file used to keep a 30-second per-process cache of {user, roles} keyed by user id,
// added as a scale optimisation (docs/launch/SCALE_READINESS_1M.md #1 blocker). Its own comment
// argued a stale entry was "a bounded staleness window, not a security bypass class" on the stated
// grounds that nothing in the app ever mutated user.status or user_roles after account creation.
// That premise is what failed. Verified live against the pre-fix build: with the account row set to
// SUSPENDED in Postgres, GET /api/admin/audit-log still returned 200 for the cached token, and with
// the ADMIN role row deleted it still returned 200 -- full admin authority surviving the removal of
// the role that granted it, for as long as the account's own traffic kept the entry warm.
//
// The cache is removed rather than wired to an invalidation hook. Invalidation could have fixed the
// single-process case, but the cache is per-process by construction: on more than one replica, the
// replica that did NOT process the suspension keeps serving the suspended session until its own TTL
// expires, and no in-process call can reach it. A revocation model whose guarantee degrades from
// "immediate" to "up to 30 seconds, on some replicas" the moment the service scales out is not a
// revocation model.
//
// The throughput cost is smaller than it looks. The cache's alternative was a users+user_roles
// lookup; the replacement is a single user_sessions primary-key lookup that joins the user and role
// rows in the same query. That is one round trip per authenticated request either way -- the cache
// saved the round trip entirely on a hit, so this does give up that hit rate. If that becomes a real
// ceiling, the correct fix is a shared store with cross-replica invalidation (the same reasoning
// already applied to rate-limit and email-suppression state, both of which were moved to Postgres
// for exactly this correctness reason), or short-lived access tokens refreshed against this check --
// not a per-process cache in front of an authorization decision.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// last_used_at is useful for the "your active sessions" list, but writing it on every request would
// turn every authenticated read into a write. Refreshed at most this often per session instead.
const LAST_USED_REFRESH_MS = 5 * 60_000

export async function getAuthContext(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const claims = token ? verifySessionToken(token) : null
  if (!claims?.sub) return null

  // Tokens issued before SEC-002 carry neither claim. They are rejected outright: they are exactly
  // the unrevocable credentials this finding is about, and there is no safe way to honour one.
  if (!claims.sid || !Number.isInteger(claims.epoch)) return null
  // Ids come straight off an attacker-supplied token. Prisma raises on a malformed uuid against a
  // uuid column, which would surface as a 500 instead of a clean 401.
  if (!UUID_RE.test(claims.sid) || !UUID_RE.test(claims.sub)) return null

  // One authoritative read per request: session row, its owner, and that owner's live roles.
  // Nothing here is cached and nothing is taken from the token's own claims.
  const session = await db().userSession.findUnique({
    where: { id: claims.sid },
    include: { user: { include: { roles: true } } },
  })

  if (!session) return null
  // The token's subject must be the session's owner. A signed token whose sub was swapped for
  // another user's id must not ride someone else's live session row.
  if (session.userId !== claims.sub) return null
  if (session.revokedAt) return null
  if (session.expiresAt.getTime() <= Date.now()) return null

  const user = session.user
  // SUSPENDED and DELETED are real security states, not labels: neither may authenticate.
  if (!user || user.status !== 'ACTIVE') return null
  // The epoch check is what makes logout-all, suspension, deletion, and role changes take effect
  // across every outstanding token for this account at once.
  if (user.sessionEpoch !== claims.epoch) return null

  if (!session.lastUsedAt || Date.now() - session.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
    await db().userSession.updateMany({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
  }

  return {
    user,
    // Live from the DB, never from the token's `roles` claim.
    roles: user.roles.map((item) => item.role),
    sessionId: session.id,
    // SEC-002R, additive only -- no check above changed. The epoch this request was ADMITTED under,
    // carried explicitly rather than left to be dug back out of `user.sessionEpoch` by callers, so
    // reauthorizeAtCommit() (server/lib/commit-authorization.mjs) can re-assert the same equality
    // this function just asserted, against a fresh, locked read, at a Class A mutation's commit
    // boundary. Equal to claims.epoch by the check immediately above.
    epoch: user.sessionEpoch,
  }
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
