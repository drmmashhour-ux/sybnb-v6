// SEC-002 — the single place where SYBNB sessions are created and destroyed.
//
// Every security-sensitive account change routes through this module rather than editing
// users/user_roles directly, because "change the row" and "kill the credentials that row already
// authorised" have to happen together or not at all. Before this existed, the only mutation paths
// were raw `db().user.update(...)` calls and there was no revocation step to forget -- which is
// exactly how a suspended admin kept working. Anything that adds a new way to suspend, delete,
// or re-role an account must call revokeUserAccess() (or one of the wrappers here) rather than
// re-implementing the two-step dance inline.
//
// Two layers, deliberately:
//
//   user_sessions row  -- per-session. Revoking one row is a real single-device logout.
//   users.session_epoch -- per-user. Bumping it invalidates every token for the account at once,
//                          including any session inserted concurrently with the revocation. A
//                          sweep of user_sessions alone would leave that race open: a login that
//                          INSERTs its row after the sweep's UPDATE has already scanned the table
//                          would survive a suspension. The epoch closes it because the login reads
//                          the epoch inside its own transaction.

import { randomUUID } from 'node:crypto'
import { db } from './prisma.mjs'
import { createSessionToken } from './security.mjs'
import { sessionTtlSecondsForRoles } from './admin-login.mjs'
import { runBoundedRevocation } from './revocation-contention.mjs'

export const REVOCATION_REASONS = {
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  ACCOUNT_REINSTATED: 'ACCOUNT_REINSTATED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  CREDENTIAL_RESET: 'CREDENTIAL_RESET',
  ADMIN_REVOKED: 'ADMIN_REVOKED',
}

// user_agent is stored so a person reviewing their own active sessions can tell devices apart.
// It is attacker-controlled free text, so it is truncated and never interpreted.
function safeUserAgent(req) {
  const raw = req?.headers?.['user-agent']
  if (typeof raw !== 'string' || !raw) return null
  return raw.slice(0, 255)
}

// Issue a session: INSERT the row and sign a token bound to it, reading the account's CURRENT
// epoch inside the same transaction. Reading the epoch transactionally is the point -- a login
// racing a suspension either reads the pre-bump epoch and gets swept by the suspension's own
// UPDATE, or reads the post-bump epoch and is issued against an account that is already
// SUSPENDED and therefore fails the status check on its first request. Neither ordering yields a
// usable credential.
//
// Lifetime: 7 days, except an account holding ADMIN gets ADMIN_SESSION_TTL_HOURS (default 12h) --
// owner decision of 2026-10-08 (server/lib/admin-login.mjs). Decided from the roles the CALLER
// loaded for this account; when none were loaded they are read here, so a caller can never mint a
// 7-day admin session by forgetting to include roles.
export async function issueUserSession(user, req = null) {
  const sessionId = randomUUID()
  const roles = Array.isArray(user.roles)
    ? user.roles
    : await db().userRole.findMany({ where: { userId: user.id }, select: { role: true } })
  const ttlSeconds = sessionTtlSecondsForRoles(roles)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  const epoch = await db().$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { sessionEpoch: true } })
    if (!current) {
      const error = new Error('Account not found.')
      error.statusCode = 401
      error.code = 'AUTH_REQUIRED'
      error.expose = true
      throw error
    }
    await tx.userSession.create({
      data: { id: sessionId, userId: user.id, expiresAt, userAgent: safeUserAgent(req) },
    })
    return current.sessionEpoch
  })

  return {
    sessionId,
    expiresAt,
    token: createSessionToken(user, { sessionId, epoch, ttlSeconds }),
  }
}

// Single-session logout. updateMany (not update) so revoking an already-revoked or unknown session
// is a no-op instead of a throw -- repeated logout must be safe, and a client retrying a logout it
// is unsure landed must not get a 500. Returns whether this call was the one that revoked it.
export async function revokeSession(sessionId, reason = REVOCATION_REASONS.LOGOUT) {
  if (!sessionId) return { revoked: false }
  const result = await db().userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  return { revoked: result.count > 0 }
}

// Kill every credential for one account, atomically. The epoch bump alone is sufficient for
// enforcement; the user_sessions sweep is done in the same transaction so the stored session list
// an operator (or the user's own session list) reads back is truthful about what happened, rather
// than showing rows that say "active" while the epoch has already invalidated them.
export async function revokeUserAccess(userId, reason, options = {}) {
  const { exceptSessionId = null, tx = null } = options
  const run = async (client) => {
    await client.userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
    // Bumping the epoch invalidates EVERY outstanding token including any session being kept in
    // user_sessions, so a keep-this-session logout-all must re-issue that session under the new
    // epoch. The caller does that (see logout-all in server/routes/auth.mjs); this function's job
    // is only to make the old credentials unusable.
    const updated = await client.user.update({
      where: { id: userId },
      data: { sessionEpoch: { increment: 1 } },
      select: { sessionEpoch: true },
    })
    return updated.sessionEpoch
  }
  // SEC-F1: when this opens its OWN transaction (POST /api/auth/logout-all, credential reset), it
  // must be bounded. Both rows it writes are exactly the rows a Class A transaction holds FOR UPDATE
  // for its whole duration, so an unbounded write here hung for the holder's full lifetime and then
  // died with an ambiguous P2028/500 having revoked nothing. runBoundedRevocation() caps the lock
  // wait in Postgres, retries inside a small budget, and otherwise raises an explicit,
  // provably-nothing-was-written REVOCATION_CONTENDED refusal. When the caller supplies `tx`, the
  // bound is that caller's responsibility (see the admin routes) -- nesting a second one here would
  // be a no-op at best and would silently re-scope the caller's transaction at worst.
  return tx ? run(tx) : runBoundedRevocation(run, { action: `REVOKE_USER_ACCESS:${reason}` })
}

// Account status changes are security state, not profile state: moving to SUSPENDED or DELETED must
// take the account's live credentials with it. Moving BACK to ACTIVE also revokes -- the documented
// policy is that a revoked session stays revoked forever and reinstatement requires a fresh login,
// so a suspension can never be "undone" into a still-live pre-suspension token.
//
// SEC-002R: accepts an external `tx` so the caller can run this INSIDE the same transaction as
// reauthorizeAtCommit() (this is a Class A privilege mutation -- see server/routes/admin.mjs's
// /api/admin/users/:id/status handler). Same pattern revokeUserAccess() above already offers.
export async function setAccountStatus(userId, status, reason, options = {}) {
  const { tx = null } = options
  const run = async (client) => {
    const before = await client.user.findUnique({ where: { id: userId }, select: { id: true, status: true } })
    if (!before) {
      const error = new Error('Account not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }
    // SEC-002R: revoke BEFORE writing the status, not after. Both statements are in one transaction
    // either way, so no caller and no reader can tell the difference in the committed result -- the
    // change is purely about the order locks are taken in. revokeUserAccess() touches user_sessions
    // and then users, which is exactly the order reauthorizeAtCommit() takes its own two locks in;
    // writing the status first took the users-row lock BEFORE the user_sessions-row lock, giving
    // the two paths opposite lock orders and therefore a real deadlock window between an admin
    // suspending an account and that same account's own in-flight Class A mutation.
    await revokeUserAccess(userId, reason, { tx: client })
    const after = await client.user.update({ where: { id: userId }, data: { status }, select: { id: true, status: true } })
    return { before, after }
  }
  // SEC-F1: same bound as revokeUserAccess() above, for direct (non-route) callers.
  return tx ? run(tx) : runBoundedRevocation(run, { action: `SET_ACCOUNT_STATUS:${status}` })
}

// Role changes made through this function revoke every session for the account, in BOTH directions.
// Removal must be immediate (that is the security requirement). Grants revoke too, deliberately: it
// keeps one rule instead of two, and it means a token's authority can only ever shrink relative to
// what the account had when it was issued -- never silently grow under a session the user opened
// before they were trusted with the role. The cost is that a newly promoted admin re-logs in once.
//
// One documented exception exists repo-wide: the seller-plan approval in server/lib/finance-ledger.mjs
// grants SELLER without revoking (see the comment there). It is grant-only and therefore cannot
// affect the removal guarantee. Every role REMOVAL must come through here.
//
// SEC-002R: accepts an external `tx` for the same reason setAccountStatus() above does -- a role
// change is a Class A privilege mutation and its caller runs it inside the transaction that also
// holds the acting admin's own commit-boundary re-authorization.
export async function applyRoleChange(userId, { add = [], remove = [] }, reason = REVOCATION_REASONS.ROLE_CHANGED, options = {}) {
  const { tx = null } = options
  const run = async (client) => {
    const before = await client.userRole.findMany({ where: { userId }, select: { role: true } })
    if (remove.length) {
      await client.userRole.deleteMany({ where: { userId, role: { in: remove } } })
    }
    for (const role of add) {
      await client.userRole.upsert({
        where: { userId_role: { userId, role } },
        create: { userId, role },
        update: {},
      })
    }
    const after = await client.userRole.findMany({ where: { userId }, select: { role: true } })
    await revokeUserAccess(userId, reason, { tx: client })
    return { before: before.map((r) => r.role), after: after.map((r) => r.role) }
  }
  // SEC-F1: same bound as revokeUserAccess() above, for direct (non-route) callers.
  return tx ? run(tx) : runBoundedRevocation(run, { action: 'APPLY_ROLE_CHANGE' })
}

// Hook for the separate password-reset work item (out of scope for SEC-002, which is why there is
// no reset endpoint here yet). Whoever builds it MUST call this in the same transaction that writes
// the new password hash: a credential reset that leaves the pre-reset sessions alive is the classic
// "I changed my password but the attacker is still signed in" failure.
export async function revokeAfterCredentialReset(userId, tx = null) {
  return revokeUserAccess(userId, REVOCATION_REASONS.CREDENTIAL_RESET, { tx })
}

export async function listActiveSessions(userId) {
  return db().userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { issuedAt: 'desc' },
    select: { id: true, issuedAt: true, expiresAt: true, lastUsedAt: true, userAgent: true },
  })
}
