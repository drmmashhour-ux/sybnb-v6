// SEC-002R round 5 (A8) — the transaction scope that lets the payment-event CLAIM and the payment
// event's own FINANCIAL EFFECTS commit as ONE atomic unit, using Postgres SAVEPOINTs.
//
// WHY THIS EXISTS
//
// Through round 4 the payment-event pipeline ran two separate transactions: a CLAIM transaction
// (attempts++ / processingStatus -> APPLYING / claimToken, which COMMITTED), and then, afterwards, a
// wholly separate APPLY transaction owned by each rail (verifyAndLockClaim -> the commit-boundary
// re-authorization -> the money-moving effects). When the apply phase's re-authorization refused a
// revoked actor, the apply transaction rolled back correctly -- but the claim was already durable, so
// a THIRD, compensating transaction had to run afterwards to decrement attempts and restore the prior
// status. Between the claim's commit and that compensation's commit there was a real window in which
// the row was durably APPLYING with an inflated attempts count, visible to any concurrent reader and
// permanent across a crash. That is the residual A8 carried as "bounded race remains".
//
// The window exists ONLY because the claim and the effects were two transactions. Merge them and it
// is gone: a single transaction either commits (claim + effects together) or commits nothing at all.
// The reason they were two transactions in the first place is that they need DIFFERENT rollback
// scopes -- a business failure must roll back the effects while KEEPING the attempts increment
// durable (otherwise DEAD_LETTER_THRESHOLD is unreachable and the bounded retry ceiling silently
// becomes an infinite loop), whereas a re-authorization failure must roll back BOTH.
//
// Postgres gives exactly that: nested rollback scopes inside one transaction, via SAVEPOINT /
// ROLLBACK TO SAVEPOINT. One transaction, two savepoints, two independently-reachable rollback
// depths. See applyPaymentEvent() in payment-event-pipeline.mjs for the actual boundary.
//
// VERIFIED, NOT ASSUMED
//
// Four properties this module depends on were verified empirically against this repo's own Prisma
// version and local Postgres before any of it was written (probe under sybnb_v6, 2026-08-30):
//
//   1. `tx.$executeRawUnsafe('SAVEPOINT x' | 'ROLLBACK TO SAVEPOINT x' | 'RELEASE SAVEPOINT x')`
//      works inside a Prisma interactive transaction. Prisma has no savepoint API of its own, but it
//      does not intercept these statements either -- they reach Postgres verbatim on the
//      transaction's own dedicated connection.
//   2. A FAILED statement does NOT permanently poison a Prisma interactive transaction. Postgres puts
//      the transaction in the aborted state, and `ROLLBACK TO SAVEPOINT` recovers it: subsequent
//      queries succeed and the transaction commits normally. Verified for a raw SQL error, for a
//      Prisma P2010, and specifically for the P2002 unique violation the benign-duplicate path
//      depends on.
//   3. Row locks acquired BEFORE a savepoint SURVIVE `ROLLBACK TO SAVEPOINT`. Verified directly: with
//      `SELECT ... FOR UPDATE` taken before the savepoint and a write rolled back to it, a second
//      connection's `FOR UPDATE NOWAIT` on the same row still failed with lock_not_available. This is
//      why payment-event-pipeline.mjs takes the event row's lock BEFORE establishing
//      sp_before_claim -- so that rolling the claim back cannot possibly drop the lock that is
//      serializing every other claimant.
//   4. `ROLLBACK TO SAVEPOINT` genuinely undoes the writes made after it, and the enclosing
//      transaction then commits the net-zero result.
//
// HOW A RAIL'S APPLY LOGIC JOINS THE MERGED TRANSACTION
//
// Both rails' apply functions (applyPaymentIntentEvent in routes/payment-intents.mjs, and
// finalizeStripeSession in lib/stripe-checkout-apply.mjs) previously opened `db().$transaction(...)`
// themselves. Under the merge they must run inside the pipeline's transaction instead -- opening
// their own would take a SECOND connection which would then block forever on the event-row lock the
// pipeline's own transaction is holding.
//
// They join it through `withTx()` plus an AsyncLocalStorage-carried scope rather than through a new
// explicit `tx` parameter, for one deciding reason: the pipeline receives each rail's apply logic as
// an opaque `apply(claimToken)` CLOSURE, and closures of exactly that arity are constructed at ~10
// call sites including four FROZEN round-1..4 regression suites that must not be edited. An ambient
// scope propagates the transaction through those closures untouched. AsyncLocalStorage is the
// supported Node mechanism for this and propagates correctly across `await` boundaries.
//
// The scope is DELIBERATELY narrow. It is read by exactly three functions -- withTx(), dbOrTx() and
// currentTx() -- and those are used only by the payment-event apply path. `db()` itself is
// deliberately NOT made scope-aware: that would silently enlist unrelated code (session revocation,
// audit logging, anything a rail happens to call) into the payment transaction, where a
// `ROLLBACK TO SAVEPOINT` could then un-do a genuine, unrelated write. Ambient enlistment is opt-in
// here, never automatic.
import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from './prisma.mjs'

const scope = new AsyncLocalStorage()

// The merged transaction now spans the claim CAS, the commit-boundary re-authorization AND the
// rail's money-moving effects, and -- because it holds the event row's lock for that whole span --
// concurrent claimants for the SAME event now genuinely queue behind it instead of failing their CAS
// immediately. Prisma's defaults (maxWait 2s / timeout 5s) were sized for the old, shorter apply
// transaction and are too tight for that queue: the identity suite alone fires 20 simultaneous
// claims against one event row, which must serialize cleanly rather than time out. These bounds are
// still far below CLAIM_DURATION_MS (120s), so a claim can never outlive its own expiry window.
export const MERGED_TX_OPTIONS = { maxWait: 20_000, timeout: 60_000 }

/** The merged transaction currently in scope, or null when there is none. */
export function currentTx() {
  return scope.getStore()?.tx ?? null
}

/**
 * The client a payment-apply statement must use: the merged transaction when one is in scope,
 * otherwise the ordinary pooled client. Used by the few statements on the apply path that
 * deliberately ran OUTSIDE the rail's own transaction before the merge -- those must now run inside
 * it, because they touch the very row the merged transaction has locked and would otherwise
 * self-deadlock on a second connection.
 */
export function dbOrTx() {
  return currentTx() ?? db()
}

/** Runs `fn` with `tx` installed as the ambient merged transaction. */
export function runInTxScope(tx, fn) {
  return scope.run({ tx }, fn)
}

let savepointSeq = 0

// Savepoint names are identifiers, not values -- they cannot be parameterized, so they are built
// exclusively from this module's own constants and an internal counter and validated anyway. No
// caller-supplied string ever reaches these.
function assertSavepointName(name) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Refusing to emit a savepoint statement for an unsafe identifier: ${String(name)}`)
  }
  return name
}

export async function savepoint(tx, name) {
  await tx.$executeRawUnsafe(`SAVEPOINT ${assertSavepointName(name)}`)
}

export async function rollbackToSavepoint(tx, name) {
  await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${assertSavepointName(name)}`)
}

export async function releaseSavepoint(tx, name) {
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${assertSavepointName(name)}`)
}

/**
 * Run `fn` as its own atomic unit: a real transaction when none is in scope, or a SAVEPOINT-delimited
 * subtransaction of the merged transaction when one is.
 *
 * The two modes are semantically equivalent from `fn`'s point of view, which is the whole point --
 * this is what lets each rail's apply logic keep its existing shape (it still receives a `tx`, still
 * gets everything-or-nothing rollback on a throw, and still leaves its caller able to continue)
 * whether it is invoked standalone (the live Stripe confirm route, the direct-call regression suites)
 * or as part of the merged claim+effects transaction.
 *
 * On a throw the savepoint is rolled back and the original error is re-thrown UNCHANGED -- the
 * enclosing transaction is then usable again, exactly as it would be if `fn` had run in a separate
 * transaction that rolled back. A failure of the rollback statement itself (a genuinely dead
 * connection) is logged into the re-thrown error rather than replacing it: the caller must see why
 * `fn` failed, not why the cleanup did.
 */
export async function withTx(fn) {
  const outer = currentTx()
  if (!outer) return db().$transaction(fn, MERGED_TX_OPTIONS)

  const name = `sp_nested_${++savepointSeq}`
  await savepoint(outer, name)
  let result
  try {
    result = await fn(outer)
  } catch (err) {
    try {
      await rollbackToSavepoint(outer, name)
    } catch (rollbackErr) {
      err.savepointRollbackFailed = rollbackErr
    }
    throw err
  }
  await releaseSavepoint(outer, name)
  return result
}
