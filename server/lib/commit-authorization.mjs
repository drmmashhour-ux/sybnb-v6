// SEC-002R — authorization that is still true at the moment an irreversible mutation commits.
//
// SEC-002 made sessions revocable and getAuthContext() (server/lib/auth-context.mjs) the single
// authoritative per-request check. That check is correct, and it is deliberately left exactly as it
// is. What it cannot do, by construction, is speak for anything that happens AFTER it returns:
// server/index.mjs calls it once, near the top of the pipeline, BEFORE the route handler has even
// read the request body, and the `context` it produces is then trusted for the remainder of that
// request's life.
//
// Finding N4 proved that gap is real, not theoretical. An in-flight PATCH whose body was still being
// dribbled onto the socket was admitted with valid ADMIN authority; the acting admin's own session
// was then revoked (logout-all) while the body was still arriving; the handler nevertheless ran to
// completion and its mutation genuinely committed -- a real account was suspended by an admin who,
// by the time the write landed, had no session at all.
//
// This module closes that window for the operations where the consequence justifies it -- money that
// cannot be un-moved, and privilege that cannot be un-granted. It is deliberately NOT wired into the
// ordinary request path: adding a second authorization round trip to every harmless GET would be a
// real, permanent cost paid to close a window whose worst case there is "a read completed 40ms after
// a logout". See docs in each Class A call site and the commit message for the full inventory.
//
// WHY THE ROW LOCKS, AND NOT JUST A FRESH READ
//
// A fresh read inside the mutating transaction would already be a large improvement: under READ
// COMMITTED (Prisma/Postgres default) each statement sees a new snapshot, so any revocation that
// committed before the re-read is observed and the whole transaction rolls back. But a fresh read
// alone still leaves the exact shape of race the owner spec forbids -- check authority, then mutate,
// with a revocation free to commit in between. Postgres cannot un-commit our write once we commit,
// so the only way to make the boundary genuinely meaningful is to stop the revoker from committing
// inside our window at all.
//
// So the check takes real row locks (SELECT ... FOR UPDATE) on the two rows that ARE the revocation
// mechanism:
//
//   user_sessions (this session's row)  -- what revokeSession()/revokeUserAccess() set revoked_at on
//   users         (this actor's row)    -- what carries session_epoch and status
//
// Every revocation path in the codebase writes one or both of those rows (see session-store.mjs:
// revokeSession -> user_sessions; revokeUserAccess -> user_sessions then users; setAccountStatus and
// applyRoleChange -> both, via revokeUserAccess, inside their own single transaction). Holding those
// locks for the remainder of the mutating transaction means a concurrent revoker either commits
// BEFORE our lock is granted -- in which case our own SELECT sees the revoked row and we throw --
// or blocks until we commit, and is therefore genuinely a revocation that happened after the
// protected mutation, not during it. There is no third ordering.
//
// LOCK ORDER
//
// user_sessions first, then users -- the same order revokeUserAccess() writes them in, so the two
// cannot form a cycle. setAccountStatus() was reordered (revoke first, then write the status) as
// part of this change for exactly that reason; it is one transaction either way, so the reordering
// is invisible to every caller and to the DB's final state.
//
// ROLES ARE READ, NOT LOCKED
//
// user_roles rows are re-read but never locked. They do not need to be: every role REMOVAL in this
// codebase goes through applyRoleChange(), which bumps session_epoch on the users row in the SAME
// transaction (session-store.mjs enforces this as a documented invariant, with one grant-only
// exception in finance-ledger.mjs that cannot remove authority). Our lock on the users row therefore
// already blocks any role removal from committing inside our window, without taking a second class
// of lock that would create new lock-ordering surface.

// Distinct codes rather than one generic AUTH_REVOKED: an operator reading an audit trail (or a
// regression test asserting a specific race outcome) needs to tell "your session was revoked" apart
// from "your account was suspended" apart from "you lost the role", and a client needs to know a
// re-login might help for some of these and never will for others.
export const REAUTH_FAILURE_CODES = {
  CONTEXT_INVALID: 'REAUTHORIZATION_CONTEXT_INVALID',
  SESSION_MISSING: 'SESSION_REVOKED_BEFORE_COMMIT',
  SESSION_OWNER_MISMATCH: 'SESSION_OWNER_MISMATCH_BEFORE_COMMIT',
  SESSION_REVOKED: 'SESSION_REVOKED_BEFORE_COMMIT',
  SESSION_EXPIRED: 'SESSION_EXPIRED_BEFORE_COMMIT',
  USER_MISSING: 'ACCOUNT_MISSING_BEFORE_COMMIT',
  USER_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE_BEFORE_COMMIT',
  EPOCH_STALE: 'SESSION_EPOCH_STALE_BEFORE_COMMIT',
  ROLE_LOST: 'ROLE_REVOKED_BEFORE_COMMIT',
  SELF_DEALING: 'SELF_REVIEW_FORBIDDEN',
  // SEC-002R round 3, item 5. The self-dealing predicate below is genuinely shared, but its default
  // wording ("approve or reject their own submission") is review-queue language. Creating a business
  // account naming yourself as its business-admin is the same CLASS of conflict of interest and uses
  // the same predicate, but it is not a review decision, and an operator reading a 403 needs to be
  // told which rule they hit. See the `selfDealingError` option on reauthorizeAtCommit().
  BUSINESS_ACCOUNT_SELF_DEALING: 'BUSINESS_ACCOUNT_SELF_DEALING',
}

function authError(message, code) {
  const error = new Error(message)
  error.statusCode = 401
  error.code = code
  error.expose = true
  error.reauthorizationFailure = true
  return error
}

function forbiddenError(message, code) {
  const error = new Error(message)
  error.statusCode = 403
  error.code = code
  error.expose = true
  error.reauthorizationFailure = true
  return error
}

/**
 * Re-establish, against authoritative DB state and inside the CALLER'S OWN transaction, that the
 * actor who was admitted at the top of this request is still allowed to perform this exact action.
 *
 * MUST be called inside the same `db().$transaction(...)` as the state-changing write it protects,
 * with no network/IO and no lock release between this call and that write. Throwing from here rolls
 * the whole transaction back, so a failed re-check leaves no partial mutation behind.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx  the caller's open transaction
 * @param {object} context  the admission-time context produced by getAuthContext()
 * @param {object}   options
 * @param {string}   options.action              short label, used only in the audit/error text
 * @param {string[]} [options.requiredRoles]     roles of which the actor must still hold at least one
 * @param {string[]} [options.interestedPartyIds] ids the actor must still not be, re-checked here
 * @param {{code: string, message: string}} [options.selfDealingError]  overrides the wording/code of
 *        the interestedPartyIds refusal for call sites that are not review-queue decisions. The
 *        PREDICATE is unchanged and still shared -- this only names the rule that was hit.
 */
export async function reauthorizeAtCommit(
  tx,
  context,
  { action, requiredRoles = [], interestedPartyIds = [], selfDealingError = null } = {},
) {
  // Fail closed on a malformed context rather than treating "nothing to check" as "check passed".
  // Nothing in the current codebase can reach a Class A handler without a context, but a future
  // caller that forgets to pass one must get a refusal, not a silent bypass.
  const sessionId = context?.sessionId
  const userId = context?.user?.id
  const epoch = context?.epoch
  if (!sessionId || !userId || !Number.isInteger(epoch)) {
    throw authError(
      `Authorization could not be re-verified at the commit boundary for ${action}.`,
      REAUTH_FAILURE_CODES.CONTEXT_INVALID,
    )
  }

  // Lock 1: the session row. Blocks revokeSession() and revokeUserAccess()'s session sweep.
  const sessionRows = await tx.$queryRaw`
    SELECT id, user_id, revoked_at, expires_at
    FROM user_sessions
    WHERE id = ${sessionId}::uuid
    FOR UPDATE
  `
  const session = sessionRows[0]
  if (!session) {
    throw authError('This session no longer exists.', REAUTH_FAILURE_CODES.SESSION_MISSING)
  }
  if (session.user_id !== userId) {
    throw authError('This session does not belong to the acting account.', REAUTH_FAILURE_CODES.SESSION_OWNER_MISMATCH)
  }
  if (session.revoked_at) {
    throw authError(
      'This session was revoked before the action could be completed; nothing was changed.',
      REAUTH_FAILURE_CODES.SESSION_REVOKED,
    )
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw authError(
      'This session expired before the action could be completed; nothing was changed.',
      REAUTH_FAILURE_CODES.SESSION_EXPIRED,
    )
  }

  // Lock 2: the account row. Blocks the session_epoch bump every account-wide revocation performs,
  // and the status write in setAccountStatus().
  const userRows = await tx.$queryRaw`
    SELECT id, status, session_epoch
    FROM users
    WHERE id = ${userId}::uuid
    FOR UPDATE
  `
  const user = userRows[0]
  if (!user) {
    throw authError('This account no longer exists.', REAUTH_FAILURE_CODES.USER_MISSING)
  }
  if (user.status !== 'ACTIVE') {
    throw authError(
      `This account is ${String(user.status).toLowerCase()} and can no longer complete this action; nothing was changed.`,
      REAUTH_FAILURE_CODES.USER_NOT_ACTIVE,
    )
  }
  if (user.session_epoch !== epoch) {
    throw authError(
      "This account's credentials were invalidated before the action could be completed; nothing was changed.",
      REAUTH_FAILURE_CODES.EPOCH_STALE,
    )
  }

  // Live roles, read (not locked -- see module header) inside the same transaction and the same
  // lock window, so the answer is the account's real current authority, never the token's claim or
  // the roles snapshotted when the request was admitted.
  const roleRows = await tx.userRole.findMany({ where: { userId }, select: { role: true } })
  const roles = roleRows.map((row) => row.role)
  if (requiredRoles.length > 0 && !requiredRoles.some((role) => roles.includes(role))) {
    throw forbiddenError(
      'This account no longer holds the role required for this action; nothing was changed.',
      REAUTH_FAILURE_CODES.ROLE_LOST,
    )
  }

  // Self-dealing, re-asserted here so a Class A handler has exactly one place that answers "is this
  // actor still allowed to do this". Callers pass ids resolved from a read taken INSIDE this same
  // transaction wherever such a read exists (see the payout-release call site), so this is a genuine
  // commit-boundary check and not a replay of the admission-time comparison.
  if (interestedPartyIds.filter(Boolean).includes(userId)) {
    throw forbiddenError(
      selfDealingError?.message || 'An admin cannot approve or reject their own submission.',
      selfDealingError?.code || REAUTH_FAILURE_CODES.SELF_DEALING,
    )
  }

  return { userId, sessionId, roles, status: user.status, epoch: user.session_epoch }
}
