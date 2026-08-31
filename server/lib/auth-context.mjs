import { db } from './prisma.mjs'
import { verifySessionToken } from './security.mjs'
import { isLockContentionError } from './revocation-contention.mjs'
import { log } from './logger.mjs'

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

// SEC-F1 ROUND 2 -- the admission-time last_used_at refresh must not be able to defeat the
// containment bound.
//
// WHAT WENT WRONG
//
// SEC-F1 round 1 bounded the three revocation vectors (logout-all, admin suspend, admin role
// removal) at REVOCATION_TOTAL_BUDGET_MS (6s) inside runBoundedRevocation()
// (server/lib/revocation-contention.mjs). But that wrapper only covers the ROUTE HANDLER. The
// refresh below runs earlier, in getAuthContext(), on EVERY authenticated request including those
// three -- and it is an UPDATE on the ACTING session's own `user_sessions` row, which is exactly
// the row a stalled Class A transaction holds `SELECT ... FOR UPDATE` on via reauthorizeAtCommit()
// (server/lib/commit-authorization.mjs). It had no lock_timeout and was not inside any bounded
// transaction, so it blocked for the holder's FULL lifetime before the route handler ever ran.
//
// This is not an edge case: LAST_USED_REFRESH_MS is five minutes, so the refresh fires whenever the
// acting session has merely been idle that long -- the ordinary state of an operator opening the
// admin console to respond to an incident. Reproduced against this repo's local sybnb_v6
// (2026-08-31), logout-all with a cold session: 12,026ms against a 12s holder and 40,014ms against
// a 40s holder, versus 6,241ms (correct, bounded 503) for the same call on a warm session. Round 5's
// MERGED_TX_OPTIONS allows a legitimate holder up to 60s, so the containment button could hang for
// about a minute. The response was still HONEST when it finally arrived -- this never produced a
// false success or a partial write -- but the BOUND that SEC-F1 exists to establish was not real.
//
// WHY IT IS SAFE TO SKIP THIS WRITE
//
// last_used_at is telemetry, not authorization state. Every consumer in the codebase was traced:
// the column is written ONLY here, and read ONLY by listActiveSessions()
// (server/lib/session-store.mjs), which feeds the read-only "your active sessions" list at
// GET /api/auth/sessions for display. Nothing gates access on it, no session-expiry or
// idle-timeout feature consults it (expiry is `expires_at`; revocation is `revoked_at` and
// `users.session_epoch`, all checked above and none of them touched here), and the Prisma schema
// declares it nullable with no index, no constraint and no relation. Skipping one refresh leaves
// the field at its previous value -- the same state it legitimately holds for any session that has
// simply not made a request in the last five minutes -- and the next request past the interval
// writes it. No correctness or security consequence follows.
//
// WHY BOUNDED-AND-SKIPPED RATHER THAN DROPPED, DEFERRED OR MADE ASYNC
//
// Dropping the field would remove a real operator-facing signal for a problem that is only about
// WAITING for it. Making the write a floating unawaited promise would leave an unbounded statement
// parked on a pooled connection and an unhandled rejection path, trading a visible hang for an
// invisible one. Bounding the wait in Postgres and skipping only on contention keeps the field, its
// meaning, and the connection accounting exactly as they were.
//
// WHY THIS DOES NOT SILENTLY SWALLOW A REAL PROBLEM
//
// Only lock contention is tolerated, decided by the same isLockContentionError() predicate round 1
// already uses to distinguish "someone else holds the rows" from a genuine fault. Anything else --
// a connection failure, a schema error, a constraint violation -- propagates unchanged and still
// fails the request. Every tolerated skip emits a distinct `session_last_used_refresh_contended`
// warn line carrying the session id and the observed wait, so a skip is an observable event with
// its own signature, not an absence.
//
// SCOPE. This is one write site. getAuthContext()'s authorization checks above are untouched, and
// runBoundedRevocation() is deliberately NOT reused here: this is not revocation work, it needs no
// retry budget and no REVOCATION_CONTENDED translation -- only the contention predicate is shared.
// Because getAuthContext() is common admission code it cannot be narrowed to the three containment
// routes; every authenticated route therefore also stops being able to block unboundedly here,
// which is strictly an improvement and changes no route's success semantics.
export const LAST_USED_LOCK_WAIT_MS = 500
// Far above LAST_USED_LOCK_WAIT_MS on purpose, for the same reason as REVOCATION_TX_OPTIONS: the
// wait must be ended by Postgres' lock_timeout (which cancels the statement and rolls the
// transaction back cleanly) rather than by Prisma's own transaction bound.
const LAST_USED_TX_OPTIONS = { maxWait: 2_000, timeout: 10_000 }

/**
 * Refresh this session's last_used_at, waiting at most LAST_USED_LOCK_WAIT_MS for the row lock.
 *
 * Resolves either way. On lock contention the refresh is abandoned and logged; the row is provably
 * untouched, because a lock_timeout aborts the statement and rolls back the whole transaction.
 * Any non-contention error is re-thrown and fails the request as it did before.
 */
async function refreshLastUsedAt(sessionId) {
  const startedAt = Date.now()
  try {
    await db().$transaction(async (tx) => {
      // Integer literal built from this module's own constant -- no caller-supplied value reaches
      // this statement, and `lock_timeout` cannot be parameterized.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${LAST_USED_LOCK_WAIT_MS}`)
      await tx.userSession.updateMany({ where: { id: sessionId }, data: { lastUsedAt: new Date() } })
    }, LAST_USED_TX_OPTIONS)
  } catch (err) {
    if (!isLockContentionError(err)) throw err
    log.warn('session_last_used_refresh_contended', {
      sessionId,
      waitedMs: Date.now() - startedAt,
      lockWaitMs: LAST_USED_LOCK_WAIT_MS,
      skipped: true,
    })
  }
}

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
    // SEC-F1 round 2: bounded. See refreshLastUsedAt() above -- this write used to be able to block
    // for the full lifetime of a stalled Class A transaction holding this very row.
    await refreshLastUsedAt(session.id)
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
