// SEC-F1 — revocation under lock contention: bounded wait, honest explicit failure.
//
// WHAT WENT WRONG
//
// SEC-002R made every Class A (irreversible) mutation re-assert its actor's authority inside its own
// transaction, holding `SELECT ... FOR UPDATE` locks on that actor's `user_sessions` row and then
// their `users` row until commit (server/lib/commit-authorization.mjs). Round 5 then widened the
// payment-event pipeline's transaction bounds to `MERGED_TX_OPTIONS` (maxWait 20s / timeout 60s,
// server/lib/tx-scope.mjs), so those locks can now legitimately be held for up to a minute.
//
// Revocation writes the SAME two rows, in the same order (session-store.mjs: revokeUserAccess sweeps
// user_sessions, then bumps users.session_epoch). So while a Class A transaction for actor X is
// in flight, ANY attempt to revoke X's authority blocks on X's own row locks. Before this module,
// that block was unbounded and the enclosing transaction carried Prisma's DEFAULT interactive
// bounds (maxWait 2s / timeout 5s), so the outcome was:
//
//   - the revoking request hung for the FULL duration of the Class A transaction (Prisma only
//     notices its own timeout when a query RETURNS, so the 5s bound did not cap the wait at all --
//     measured 12.0s against a 12s holder, and it would be ~60s against a round-5 payment-event
//     transaction), and then
//   - failed with PrismaClientKnownRequestError P2028 ("Transaction already closed"), which has no
//     `statusCode`, so handleRouteError() (server/lib/responses.mjs) emitted a generic HTTP 500, and
//   - revoked NOTHING. Verified by direct DB read: session revoked_at still null, session_epoch
//     unchanged, status unchanged.
//
// The security property SEC-002R protects still held (the unauthorized mutation still could not
// commit) -- but the CONTAINMENT TOOL failed silently. An operator suspending a compromised account
// during a busy payment window saw a 500 and had no way to tell "the suspension failed" from "the
// suspension worked and the response broke". The token stayed live and usable.
//
// WHY THIS DESIGN AND NOT A BIGGER ONE
//
// Three options were considered against the acceptance criteria:
//
//   1. Just raise the transaction timeout ("always succeed by waiting"). REJECTED. To guarantee
//      success it would have to exceed the longest legitimate Class A hold, which round 5 set at 60s.
//      A containment button that hangs for a minute is not a usable containment tool, and it would
//      STILL fail ambiguously past that bound -- the silent-500 problem would remain, just rarer and
//      harder to reproduce. It satisfies neither (a) reliably nor (b) at all.
//
//   2. A queue / outbox / asynchronous containment mechanism. REJECTED as unnecessary AND as worse
//      for this specific requirement. Accepting a revocation into a queue returns "accepted" to the
//      operator while containment has demonstrably NOT happened yet -- which is precisely the
//      false-confidence failure mode F-1 is about, re-introduced with better paperwork. It would also
//      add durable state, a worker, and its own failure modes to a problem a lock bound solves.
//
//   3. THIS: bound the lock wait in Postgres itself (`SET LOCAL lock_timeout`), retry within a small
//      total budget, and translate an exhausted budget into an explicit, distinguishable refusal.
//      Chosen. It is the smallest change that satisfies BOTH outcomes the spec allows:
//
//        (a) whenever the Class A transaction finishes inside the budget, the revocation genuinely
//            acquires the locks and commits -- measured succeeding at 809ms against an 800ms holder;
//        (b) otherwise the operator gets HTTP 503 REVOCATION_CONTENDED with `containmentApplied:
//            false` and `retryable: true`, and -- because a lock_timeout aborts the statement and the
//            whole transaction rolls back -- the target's session/account state is provably UNTOUCHED.
//
// WHY `lock_timeout` RATHER THAN A JS TIMER
//
// A JS-side race/abort cannot un-issue a statement that is already parked in Postgres' lock queue; the
// query keeps waiting on the connection and the transaction stays open. `lock_timeout` is enforced by
// the server: the blocked statement is cancelled at the bound, the transaction aborts, and every write
// it had made is rolled back. That server-side abort is what makes the "nothing was changed" claim in
// the failure response true by construction rather than by hope.
//
// ERROR SHAPES, VERIFIED NOT ASSUMED (probe against this repo's Prisma + local sybnb_v6, 2026-08-31)
//
//   - lock_timeout hit inside a Prisma MODEL operation (`updateMany`) surfaces as
//     PrismaClientUnknownRequestError with NO `.code`; the PostgresError `55P03` /
//     "canceling statement due to lock timeout" appears only in the message text.
//   - lock_timeout hit inside `$queryRaw` surfaces as PrismaClientKnownRequestError P2010 with
//     `meta.code === '55P03'`.
//   - `SET LOCAL lock_timeout = <n>` applies for the rest of the transaction and is discarded at
//     COMMIT/ROLLBACK (`SHOW lock_timeout` returns to `0` afterwards).
//
// Both shapes are matched below. P2028 is matched too, defensively: if some future path still manages
// to hit the Prisma transaction bound while contending, the operator gets the honest, explicit
// REVOCATION_CONTENDED refusal rather than the generic 500 this item exists to eliminate.

import { db } from './prisma.mjs'

// Per-attempt Postgres-side lock wait. Deliberately short: a containment control must answer fast,
// and a Class A transaction that is going to finish quickly usually finishes well inside this.
export const REVOCATION_LOCK_WAIT_MS = 1_500
// Pause between attempts, so a burst of retries does not simply re-queue instantly behind the same
// holder and burn the budget on lock-queue churn.
export const REVOCATION_RETRY_DELAY_MS = 250
// Total wall-clock ceiling for the whole revocation attempt, retries included. This is the number an
// operator experiences as "how long the suspend button can take before it tells me it failed".
export const REVOCATION_TOTAL_BUDGET_MS = 6_000
// Transaction bounds for revocation work. Both are set FAR above REVOCATION_LOCK_WAIT_MS on purpose:
// the wait must be bounded by Postgres' lock_timeout (which rolls back cleanly and is detectable),
// never by Prisma's own transaction timeout (which produces the ambiguous P2028 this item is about).
export const REVOCATION_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 }

export const REVOCATION_CONTENDED_CODE = 'REVOCATION_CONTENDED'

const LOCK_CONTENTION_PATTERNS = [
  '55p03', // lock_timeout: canceling statement due to lock timeout
  '40p01', // deadlock_detected
  'canceling statement due to lock timeout',
  'deadlock detected',
]

/**
 * True when `err` is "someone else is holding the rows we need", rather than a genuine application
 * refusal. Only these are retried, and only these are translated into REVOCATION_CONTENDED -- a 401
 * from reauthorizeAtCommit(), a 404 for an unknown account, or any other real error still propagates
 * exactly as it did before.
 */
export function isLockContentionError(err) {
  if (!err) return false
  if (err.code === 'P2010' && String(err.meta?.code || '').toLowerCase() === '55p03') return true
  // P2034 is Prisma's own "write conflict or deadlock, please retry".
  if (err.code === 'P2034') return true
  // P2028 = the interactive transaction expired. Under contention this is exactly the ambiguous
  // failure F-1 reported; treating it as contention converts it into the explicit refusal.
  if (err.code === 'P2028') return true
  const text = `${err.message || ''} ${JSON.stringify(err.meta || {})}`.toLowerCase()
  return LOCK_CONTENTION_PATTERNS.some((pattern) => text.includes(pattern))
}

/**
 * The explicit failure state required by SEC-F1 acceptance criterion (b). 503 rather than 500: this
 * is a temporary, retryable unavailability of a specific operation, and it must be distinguishable
 * at a glance -- by a human operator, by a client, and by a test -- from both "it worked" and "the
 * server broke". The body carries `containmentApplied: false` explicitly so no caller has to infer
 * containment status from a status code.
 */
export function revocationContendedError(action, { attempts, waitedMs, cause = null } = {}) {
  const error = new Error(
    'Containment was NOT applied. This account could not be revoked because another in-flight '
    + 'transaction is currently holding its session and account rows. Nothing was changed -- the '
    + "target's sessions are still live. Retry in a moment; if this keeps failing, escalate.",
  )
  error.statusCode = 503
  error.code = REVOCATION_CONTENDED_CODE
  error.expose = true
  error.revocationContended = true
  // Surfaced verbatim in the HTTP error body by handleRouteError(); see server/lib/responses.mjs.
  error.details = {
    containmentApplied: false,
    retryable: true,
    action: action || null,
    attempts: attempts ?? null,
    waitedMs: waitedMs ?? null,
  }
  if (cause) error.cause = cause
  return error
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run revocation work as a bounded, all-or-nothing transaction.
 *
 * `fn(tx)` receives an open transaction whose lock waits are capped by Postgres. It is re-invoked
 * from scratch on each attempt -- which is safe precisely because a lock_timeout aborts and rolls
 * back the ENTIRE transaction, so an attempt that failed left nothing behind to reconcile. Any
 * non-contention error propagates immediately and unchanged, on the first attempt.
 *
 * Resolves with `fn`'s value (criterion (a): containment genuinely committed), or throws
 * revocationContendedError() (criterion (b): containment explicitly did not happen, and provably
 * nothing was written).
 */
export async function runBoundedRevocation(fn, { action = null, client = null } = {}) {
  const startedAt = Date.now()
  const deadline = startedAt + REVOCATION_TOTAL_BUDGET_MS
  const prisma = client || db()
  let attempts = 0
  let lastError = null

  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    // Never wait past the overall budget, and never wait so briefly that the attempt is meaningless.
    const lockWaitMs = Math.max(100, Math.min(REVOCATION_LOCK_WAIT_MS, remaining))
    attempts += 1
    try {
      return await prisma.$transaction(async (tx) => {
        // Integer literal built from this module's own constants -- no caller-supplied value ever
        // reaches this statement, and `lock_timeout` cannot be parameterized.
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${Math.round(lockWaitMs)}`)
        return fn(tx)
      }, REVOCATION_TX_OPTIONS)
    } catch (err) {
      if (!isLockContentionError(err)) throw err
      lastError = err
      if (Date.now() + REVOCATION_RETRY_DELAY_MS >= deadline) break
      await sleep(REVOCATION_RETRY_DELAY_MS)
    }
  }

  throw revocationContendedError(action, {
    attempts,
    waitedMs: Date.now() - startedAt,
    cause: lastError,
  })
}
