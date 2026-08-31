// SYBNB — the SHARED "attempts, dead-lettering, duplicate-collision handling" machinery for every
// durable webhook rail. Extracted from payment-intents.mjs (which was the only rail with a durable
// PaymentEvent inbox) so the older Stripe Checkout rail can get the exact same guarantees — a
// bounded automatic-retry ceiling before a human is needed, and safe handling of a concurrent
// duplicate application — without a second, drifting copy of this bookkeeping.
//
// Each rail supplies its own `apply()` closure: self-contained business logic, responsible for
// marking the PaymentEvent row APPLIED/IGNORED itself, atomically with its own business-state write.
// This module owns: bumping attempts before the attempt, and recording FAILED/DEAD_LETTERED/a benign
// duplicate collision after — the part that must behave identically regardless of rail. Each rail's
// apply MUST call verifyAndLockClaim() (below) as its own first statement, before any business-effect
// write — see that function's comment for why (round 7: a worker whose claim has already been
// reclaimed must never be able to execute, let alone commit, a real financial effect).
//
// SEC-002R ROUND 5 CHANGED THE TRANSACTION BOUNDARY. Until round 4 this module deliberately imposed
// NO outer transaction: it committed the claim on its own, and each rail's apply() then opened its
// own separate transaction. That split is what left A8 at "bounded race remains" -- see
// applyPaymentEvent() below for the full account. There is now ONE transaction spanning the claim,
// the commit-boundary re-authorization and the rail's effects, and each rail's apply logic enlists in
// it via withTx()/the ambient scope in tx-scope.mjs rather than opening a second one. Both rails'
// apply functions keep their existing shape and signature; what changed is only which transaction
// they run in. finalizeStripeSession is still separately callable from the non-webhook
// `/api/payments/stripe/confirm` route, where it opens a real transaction of its own exactly as
// before.
import { randomUUID } from 'node:crypto'
import { db } from './prisma.mjs'
import { log, errorSummary } from './logger.mjs'
import { isProviderRefUniqueViolation } from './finance-ledger.mjs'
import { MERGED_TX_OPTIONS, runInTxScope, savepoint, rollbackToSavepoint } from './tx-scope.mjs'

// After this many failed apply attempts on the same event, stop retrying automatically and mark it
// DEAD_LETTERED — it needs a human via the admin replay endpoint instead of an unbounded retry loop.
export const DEAD_LETTER_THRESHOLD = 5

// The canonical event-identity unique constraint (migration 018) — mirrors the shape of
// isProviderRefUniqueViolation in finance-ledger.mjs (same P2002-recognition pattern), scoped to
// PaymentEvent's own composite key instead of PaymentProof's (provider, providerRef).
export function isPaymentEventIdentityConflict(err) {
  const target = err?.meta?.target
  return err?.code === 'P2002' && (target === 'payment_events_identity_key' ||
    (Array.isArray(target) && target.includes('provider_event_id')) || String(target || '').includes('provider_event_id'))
}

// Durable intake with atomic, race-safe conflict detection — the single entry point BOTH webhook
// rails use to persist an authenticated event before any local interpretation is attempted. A real
// INSERT is tried first (not upsert+compare, which has a TOCTOU gap under concurrency): the unique
// constraint itself is what makes N concurrent identical deliveries resolve to exactly one row.
//
// On a genuine identity collision (a redelivery, or — the defect this closes — two DIFFERENT events
// that happen to share a raw provider_event_id string across providers/endpoints, which can no longer
// collide at all since the constraint is now scoped by both), the existing row's IMMUTABLE fields are
// compared against this freshly-authenticated delivery:
//   - a match is an ordinary duplicate — the existing row is returned unchanged, `conflict: false`;
//   - a mismatch is a genuine conflict. The ORIGINAL EVENT ROW IS NEVER WRITTEN TO, in ANY field,
//     for ANY reason — independent review correctly found an earlier version of this function
//     overwriting processingStatus/lastError here, which could silently destroy a legitimate
//     APPLIED/FAILED/DEAD_LETTERED row's true, authoritative outcome. Instead, the conflicting
//     delivery's safe, non-sensitive metadata (a digest + the immutable-field snapshot — never the
//     raw payload) is recorded in a SEPARATE, append-only PaymentEventConflict row referencing the
//     original by id, and the ORIGINAL, UNCHANGED row is returned.
//
// `fields` must include every column in the eventIdentity key (provider, providerEndpointKey,
// providerEventId) plus every other immutable column this function compares. `environment` is still
// accepted and stored (informational metadata only, since migration 020) but is deliberately never
// part of the identity lookup or the match comparison below -- see the field's own schema comment.
export async function intakeEvent(fields) {
  try {
    return { eventRow: await db().paymentEvent.create({ data: fields }), conflict: false }
  } catch (err) {
    if (!isPaymentEventIdentityConflict(err)) throw err
    // findFirst, not findUnique: since migration 021, uniqueness is scoped to CANONICAL rows only (a
    // superseded historical duplicate can legitimately share this exact triple with its survivor), so
    // Prisma can no longer type this as a compound-unique lookup. supersededByEventId: null is what
    // actually narrows this to at most one row -- the same guarantee the partial index enforces.
    const eventRow = await db().paymentEvent.findFirstOrThrow({
      where: {
        provider: fields.provider,
        providerEndpointKey: fields.providerEndpointKey,
        providerEventId: fields.providerEventId,
        supersededByEventId: null,
      },
    })
    const matches = eventRow.payloadDigest === fields.payloadDigest &&
      eventRow.type === fields.type &&
      eventRow.providerReference === fields.providerReference &&
      eventRow.subjectType === fields.subjectType &&
      eventRow.providerObjectId === fields.providerObjectId &&
      eventRow.amountMinor === fields.amountMinor &&
      eventRow.currency === fields.currency
    if (matches) return { eventRow, conflict: false }
    log.error('payment_event_identity_conflict', { eventId: eventRow.id, providerEventId: fields.providerEventId, rail: fields.rail, originalStatus: eventRow.processingStatus })
    await db().paymentEventConflict.create({
      data: {
        paymentEventId: eventRow.id,
        payloadDigest: fields.payloadDigest,
        type: fields.type,
        providerReference: fields.providerReference,
        subjectType: fields.subjectType,
        providerObjectId: fields.providerObjectId,
        amountMinor: fields.amountMinor,
        currency: fields.currency,
      },
    })
    return { eventRow, conflict: true }
  }
}

// Thrown when a rail's own apply() transaction discovers -- having verified AND LOCKED ownership as
// the FIRST statement inside its own transaction, via verifyAndLockClaim() below -- that claim
// ownership has already moved on to a newer claimant. This is NOT a processing failure: it must never
// increment toward the dead-letter threshold, write a lastError, or touch the row in any way -- the
// newer claimant is the one that owns settling this event, and this attempt did (and commits) nothing.
export class ClaimLostError extends Error {
  constructor(eventId) {
    super(`Claim ownership for payment event ${eventId} was lost before this attempt could safely act.`)
    this.name = 'ClaimLostError'
    this.claimLost = true
  }
}

// Verifies -- and, being a real UPDATE inside the CALLER's own open transaction, LOCKS via Postgres's
// row lock -- that `claimToken` is still this event's current claim. Throws ClaimLostError (rolling
// back the ENTIRE enclosing transaction, since this must be the FIRST statement in a rail's apply()
// transaction, before any business-effect write) if it is not.
//
// Independent review found a real defect here: the round-6 version bound the pipeline's OWN
// bookkeeping writes to the claim token, but each rail's actual business effect (PaymentProof
// creation, wallet/ledger entries, the booking/intent status transition) ran BEFORE that check, inside
// the same transaction -- so a worker whose claim had already been reclaimed by someone else could
// still execute AND COMMIT a real financial effect; only its own final bookkeeping write silently
// no-op'd afterward. Calling this FIRST, inside the SAME transaction as every effect that follows,
// makes that structurally impossible: if ownership is gone, nothing after this line ever runs, and
// Postgres rolls back anything this statement itself touched (nothing, since it only ever WRITES
// meaningful new data as a SIDE EFFECT of the caller's later statements) the moment the thrown error
// propagates out of the transaction callback.
// Fails CLOSED on a missing token -- round 8: independent review found the previous version treated a
// nullish `claimToken` as "no check needed" (a deliberate carve-out for direct test calls that bypass
// the claim layer entirely). That is a real security defect, not a harmless test convenience: it means
// ownership verification could be silently skipped by ANY caller simply by omitting the argument,
// production code included, with nothing enforcing that only tests take that path. There is no
// legitimate reason for a caller with a real event ID to lack a real token — every production call
// site (both webhook routes, admin replay) always supplies one, minted by applyPaymentEvent's own
// claim. A missing token is now always refused; direct idempotency tests seed and acquire a genuine
// claim first instead (see tests/e2e/payment-event-claim-recovery.e2e.mjs).
export async function verifyAndLockClaim(tx, { eventId, claimToken }) {
  if (claimToken == null) {
    const err = new Error(`verifyAndLockClaim requires a real claimToken for event ${eventId} -- a missing token is refused, never treated as "no check needed".`)
    err.code = 'CLAIM_TOKEN_REQUIRED'
    throw err
  }
  const locked = await tx.paymentEvent.updateMany({
    where: { id: eventId, claimToken, processingStatus: 'APPLYING' },
    data: { lastAttemptAt: new Date() },
  })
  if (locked.count === 0) throw new ClaimLostError(eventId)
}

// A row may only be CLAIMED for an apply attempt from one of these statuses (with no active,
// unexpired claim already held — see the claim query below). RECEIVED and FAILED are the ordinary
// "not yet applied / a previous attempt failed, retryable" states; DEAD_LETTERED is claimable too
// because admin replay is explicitly allowed to retry a dead-lettered event (the live webhook path
// never reaches applyPaymentEvent for a DEAD_LETTERED row at all -- both routes check and
// short-circuit before calling this function).
//
// POLICY_DEFERRED is claimable too (round 8) -- independent review found it had NO recovery path at
// all: excluded from this list, a later redelivery whose OWN policy check now passes still lost the
// claim (nothing here matched it) and got 409 forever; admin replay only accepted FAILED/
// DEAD_LETTERED/expired-APPLYING. An authenticated payment received while the rail was disabled could
// stay permanently unprocessed even after the rail was re-enabled. It is safe to add unconditionally
// (no "was a crash mid-effect possible" ambiguity the way an expired APPLYING claim has -- reaching
// POLICY_DEFERRED means interpretation already completed cleanly and durably, including, for
// stripe_checkout, its own stored payment_status; no apply attempt was ever made). Both callers only
// ever reach applyPaymentEvent for a POLICY_DEFERRED row AFTER re-checking authorizePaymentOperation('
// webhook_apply', ...) themselves, so a claim only succeeds once policy genuinely allows it again --
// this list controls whether a row CAN be reclaimed, not whether a specific attempt is authorized to.
//
// APPLIED/IGNORED/QUARANTINED (terminal or not-this-function's-job states) are always excluded.
// APPLYING is claimable ONLY when its existing claim has expired -- see CLAIM_DURATION_MS below.
const CLAIMABLE_STATUSES = ['RECEIVED', 'FAILED', 'DEAD_LETTERED', 'POLICY_DEFERRED']

// How long a claim is honored before it is considered abandoned and safe to reclaim. Generously long
// relative to any real apply() (a single DB transaction, well under a second normally) so a claim
// never expires out from under genuinely in-flight work, while still bounding how long a crashed,
// killed, or disconnected worker can leave an event stuck.
export const CLAIM_DURATION_MS = 120_000

// Atomically claims eventId for an apply attempt, then runs it, binding every write this claim makes
// to a fresh, random ownership token. Independent review found two successive real defects here:
//
// (round 5) the previous version bumped attempts/wrote APPLYING with a blind, unconditional `update`
// -- every one of N concurrent deliveries for the same event would win that write, all N would
// increment attempts and call apply(), and a late-failing worker could downgrade a row a sibling had
// already committed to APPLIED. Fixed with a compare-and-swap `updateMany` scoped to
// CLAIMABLE_STATUSES: Postgres serializes concurrent UPDATEs against the same row via its row lock, so
// at most one caller can be inside apply() for a given event at any time.
//
// (round 6, THIS fix) that CAS claim had no ownership token or expiry: a crashed, killed, or
// disconnected worker leaves the row at APPLYING forever, since APPLYING was excluded from
// CLAIMABLE_STATUSES with no path back out -- a payment-loss condition, because the provider may have
// already received the durable-intake HTTP 200 and stopped retrying. Fixed by minting a fresh
// `claimToken` on every successful claim (fresh OR reclaimed) and a bounded `claimExpiresAt`. A claim
// is now acquirable when the row is CLAIMABLE with no active claim, OR when it's APPLYING but the
// existing claim has expired -- the SAME atomic `updateMany`, so a stale worker waking up late can
// never win a race against a legitimate reclaim: by the time it tries to write anything, the token it
// holds is no longer the row's current token, so every one of its own writes (below, and inside the
// rail-specific apply() closures, which now thread `token` through to their own conditional writes)
// matches zero rows instead of corrupting the newer claimant's state.
//
// Recovery is intentionally lazy, not a background sweeper: this codebase has no job runner, and the
// existing admin replay endpoint (extended alongside this fix to accept an APPLYING row once its claim
// has expired, not just FAILED/DEAD_LETTERED) is already the established human-triggered recovery path
// for a stuck event -- the same mechanism that already exists for FAILED/DEAD_LETTERED events, just now
// reachable for an abandoned claim too. A losing claim attempt against a row with an ACTIVE (unexpired)
// claim never reports a false success -- it sets `retryable: true`, explicitly not a final outcome.
//
// (round 7) Independent review correctly found that `retryable: true` alone was not enough: both
// webhook routes still returned a bare HTTP 200 regardless, and a payment provider acts on the HTTP
// status, not on a private JSON field it never inspects -- an active-claim loser's 200 could make a
// provider stop retrying a webhook whose original claimant then genuinely never finishes, with no
// automatic path back. See webhookAcknowledgeStatus() below, which BOTH webhook routes now call to
// decide their actual HTTP status: `retryable: true` becomes a real non-2xx response, so the provider
// keeps redelivering (its own retry schedule is what makes recovery automatic once the abandoned
// claim's expiry passes -- no new background worker needed) instead of ever being told this delivery
// is done when it might not be.
//
// (SEC-002R round 2, finding A8) `authorizeClaim` closes the gap independent review found in round 1.
// Round 1 protected only the rail's own apply() transaction, via each rail's beforeEffects hook. The
// CLAIM below -- `attempts: { increment: 1 }` plus the move to APPLYING -- and the failure-path write
// further down were BOTH outside that boundary and BEFORE it, so a revoked admin's replay still
// committed a real attempts increment, and on the 5th such attempt pushed a genuine event into
// DEAD_LETTERED, which removes it from CLAIMABLE_STATUSES... no: DEAD_LETTERED IS claimable, but it
// is the state that takes an event off the automatic webhook-retry path and makes it depend on a
// human. Either way it is durable, adversary-controlled state change by an actor with no session.
//
// Two changes make that structurally impossible:
//
//   1. `authorizeClaim` (when the caller supplies one -- only the admin replay route does; a provider
//      webhook has no actor to re-authorize) runs inside the SAME transaction as the claim CAS, so a
//      throw takes the increment with it and the row is left untouched. Rounds 2-4 ran it
//      immediately after the CAS; round 5 moved it to the last statement before the single commit --
//      see THE COMMIT GATE in applyPaymentEvent below for why that is equivalent-or-stronger once
//      the claim and the effects share one transaction, and why the earlier position became an
//      active lock-window hazard.
//   2. A re-authorization failure thrown from anywhere INSIDE apply() is not treated as a processing
//      failure at all (see the catch below). Rounds 2-4 compensated for it with a later reversal
//      transaction; round 5 rolls the claim back to a SAVEPOINT inside the one transaction instead,
//      so there is no reversal to compensate with, and nothing durable to compensate FOR.
//
// SEC-002R round 5. The two savepoints that give ONE transaction the two independent rollback depths
// the claim/effects merge needs. Fixed literals, never interpolated from anything caller-supplied.
//
//   sp_before_claim   -- established AFTER the event row's FOR UPDATE lock is taken and BEFORE the
//                        claim CAS. Rolling back to it undoes the attempts increment, the APPLYING
//                        transition and the claim token, leaving the transaction net-zero, WITHOUT
//                        dropping the row lock (locks taken before a savepoint survive a rollback to
//                        it -- empirically verified, see tx-scope.mjs). This is the depth a
//                        RE-AUTHORIZATION failure rolls back to.
//   sp_before_effects -- established after the claim is established and authorized, immediately
//                        before the rail's own effect logic runs. Rolling back to it undoes every
//                        financial effect while KEEPING the claim durable, and simultaneously
//                        recovers the transaction from Postgres's aborted state so the failure
//                        bookkeeping below can still be written and committed. This is the depth
//                        every OTHER failure class rolls back to -- exactly reproducing what the old
//                        separate apply transaction's rollback did, without being a separate
//                        transaction.
const SP_BEFORE_CLAIM = 'sp_before_claim'
const SP_BEFORE_EFFECTS = 'sp_before_effects'

export async function applyPaymentEvent({ eventId, rail, apply, authorizeClaim = null }) {
  const token = randomUUID()
  const now = new Date()
  const claimExpiresAt = new Date(now.getTime() + CLAIM_DURATION_MS)

  // SEC-002R ROUND 5 -- THE MERGED CLAIM+EFFECTS TRANSACTION.
  //
  // Through round 4 this function opened a CLAIM transaction that COMMITTED, then called apply(),
  // which opened its OWN, separate transaction for the re-authorization and the money-moving
  // effects. A re-authorization refusal rolled that second transaction back with nothing committed
  // (correct), but the claim was by then already durable, so a THIRD compensating transaction had to
  // decrement attempts and restore the prior status afterwards. Between commit #1 and commit #3 the
  // row was durably APPLYING with an inflated attempts count -- observable by any concurrent reader,
  // and permanent if the process died in between. That window is the whole of what A8 still carried
  // as "bounded race remains"; no amount of retrying or marker-writing around the third transaction
  // could close it, because the window is created by there BEING a third transaction.
  //
  // There is now ONE transaction. The claim CAS, the claim's re-authorization, the effects'
  // re-authorization and the effects themselves all live inside it, and it commits once. A concurrent
  // reader sees either the pre-claim row (before this commits) or the fully-resolved outcome (after)
  // -- there is no third, intermediate durable state to observe, and a crash at any point simply
  // leaves the pre-claim row, since an uncommitted transaction leaves nothing behind.
  //
  // The two rollback depths the old two-transaction split provided are preserved exactly, as
  // SAVEPOINTs rather than as transaction boundaries:
  //
  //   * a RE-AUTHORIZATION failure rolls back to sp_before_claim  -> the claim itself is undone, so a
  //     revoked actor leaves no mark whatsoever. This replaces the old compensating transaction, and
  //     is strictly stronger than it: it is not a compensating WRITE that guesses at a prior status
  //     and could fail or be interrupted, it is Postgres restoring the row byte-for-byte to what it
  //     actually was. There is no reversal that can fail, so there is nothing left to strand, retry
  //     or record a reconciliation marker for -- reverseRefusedClaim()/recordStrandedClaim() and the
  //     PAYMENT_EVENT_REAUTH_REVERSAL_FAILED error class are deleted rather than improved, because
  //     the condition they existed to report can no longer arise.
  //
  //   * EVERY OTHER failure (unknown reference, amount/currency mismatch, unsupported type, any
  //     genuine business or data error) rolls back only to sp_before_effects -> the effects are
  //     undone but the claim's attempts increment SURVIVES and is committed along with the
  //     FAILED/DEAD_LETTERED bookkeeping below. That is byte-for-byte the old behavior and it is
  //     load-bearing: if the increment rolled back with the effects, DEAD_LETTER_THRESHOLD would
  //     never be reached and the bounded retry ceiling would silently become an infinite retry loop.
  //     The dead-letter decision logic itself is unchanged, and still reads the post-claim attempts
  //     value back from the row rather than trusting a local.
  //
  // LOCK ORDER is unchanged: payment_events (this row, below) -> user_sessions -> users (taken by
  // reauthorizeAtCommit, whether via authorizeClaim here or via the rail's beforeEffects) -> then the
  // effect tables. It is now held on ONE connection for the whole span instead of being taken, split
  // and retaken across two, which removes a lock gap rather than adding one. No new lock class and no
  // new ordering is introduced.
  const outcome = await db().$transaction(async (tx) => {
    // Lock BEFORE the savepoint, deliberately. Row locks acquired before a savepoint survive
    // ROLLBACK TO that savepoint (verified -- see tx-scope.mjs), so taking it here guarantees the
    // event-row lock is held for the ENTIRE transaction even on the path that rolls the claim all the
    // way back. Taking it after sp_before_claim would put the lock inside the rolled-back scope,
    // which is exactly the thing that must not happen: this lock is what serializes every other
    // claimant for the whole claim+effects span.
    //
    // (Round 3, item 6a, preserved verbatim in intent: reading priorStatus FOR UPDATE rather than
    // with a plain findUnique is what closed the stale-read race in which a concurrent
    // DEAD_LETTERED commit could be silently un-dead-lettered by a reversal writing back a status
    // that was never this attempt's true prior state. Under the merge the restore is done by
    // Postgres itself rather than by writing priorStatus back, so that race is closed twice over --
    // but the locking read stays, because it is also what makes the CAS below operate on a row no
    // one else can be moving underneath us.)
    const beforeRows = await tx.$queryRaw`
      SELECT processing_status FROM payment_events WHERE id = ${eventId}::uuid FOR UPDATE
    `
    const priorStatus = beforeRows[0]?.processing_status ?? null

    await savepoint(tx, SP_BEFORE_CLAIM)

    const claim = await tx.paymentEvent.updateMany({
      where: {
        id: eventId,
        OR: [
          { processingStatus: { in: CLAIMABLE_STATUSES } },
          { processingStatus: 'APPLYING', claimExpiresAt: { lt: now } },
        ],
      },
      data: { attempts: { increment: 1 }, lastAttemptAt: now, processingStatus: 'APPLYING', claimToken: token, claimExpiresAt },
    })

    if (claim.count === 0) {
      // Lost the claim race. Report duplicate:true only once we can actually see the terminal APPLIED
      // outcome; a row currently held by an ACTIVE (unexpired) claim reports retryable:true instead of
      // guessing at an outcome that hasn't happened yet -- this is NEVER acknowledged as a final
      // success. Callers still return HTTP 200 (the event IS durably stored and genuinely owned by
      // someone), but the response body itself makes no false completion claim.
      //
      // Read inside this transaction, under the lock we already hold, rather than from a separate
      // connection after a commit: whoever beat us to the row necessarily committed before our lock
      // was granted, so this observes their settled state and cannot catch them mid-flight.
      const current = await tx.paymentEvent.findUnique({ where: { id: eventId } })
      if (current?.processingStatus === 'APPLIED') return { result: { applied: false, duplicate: true, claimed: false } }
      return { result: { applied: false, duplicate: false, claimed: false, retryable: true, status: current?.processingStatus ?? null } }
    }

    await savepoint(tx, SP_BEFORE_EFFECTS)

    let pending
    try {
      // apply() is trusted to mark the row APPLIED or IGNORED itself on success, bound to `token` --
      // see module comment and each rail's own apply function (applyPaymentIntentEvent /
      // applyStripeCheckoutEvent). It now runs INSIDE this transaction: the ambient scope is what
      // carries `tx` into it, so the ~10 existing `apply: (claimToken) => ...` closures (four of them
      // in frozen round-1..4 suites) keep working untouched while their rail logic enlists in this
      // transaction instead of opening a second one. `tx` is also passed explicitly as a second
      // argument for any future call site that prefers to thread it by hand.
      const result = await runInTxScope(tx, () => apply(token, tx))
      pending = { result }
    } catch (err) {
      // Recover the transaction from Postgres's aborted state and undo every effect this attempt
      // made, while keeping the claim. Both rails' apply logic already rolled its own savepoint back
      // on the way out (withTx), so in the ordinary case this is a no-op re-assertion -- it is done
      // unconditionally anyway because `apply` is an arbitrary caller-supplied closure and this
      // function must be able to keep writing regardless of how far it got.
      await rollbackToSavepoint(tx, SP_BEFORE_EFFECTS)

      if (err?.reauthorizationFailure) {
        // The acting actor's authority was revoked between admission and this commit boundary;
        // reauthorizeAtCommit() threw. Undo the CLAIM too. After this statement the transaction has
        // made no net change at all -- attempts, processingStatus, claimToken, claimExpiresAt and
        // lastAttemptAt are all exactly the values the FOR UPDATE read above saw, restored by
        // Postgres rather than re-written by us. The transaction then commits that net-zero result
        // and the refusal is re-thrown to the caller BELOW, outside the transaction, so the caller
        // (and, on the admin replay route, its own audit row) still records a real, refused attempt.
        await rollbackToSavepoint(tx, SP_BEFORE_CLAIM)
        return { rethrow: err, reauthRolledBack: true, priorStatus }
      }

      if (err?.claimLost) {
        // verifyAndLockClaim() found this claim already reclaimed. Under the merge this is
        // structurally unreachable for a claim minted by THIS function -- the event row's lock is
        // held continuously from before the CAS until commit, so no one can take the row over in
        // between -- but the branch is kept for callers that hand apply() a foreign token. Semantics
        // are unchanged from round 4: never touch attempts/lastError/processingStatus, because
        // whatever the newer claimant has established is authoritative.
        pending = { result: { applied: false, duplicate: false, claimLost: true, retryable: true } }
      } else if (isProviderRefUniqueViolation(err)) {

        // A SEPARATE claim round (a genuinely later redelivery or replay, or a different event row
        // for the same underlying object) already applied this exact effect and committed first --
        // this attempt's effects have just been rolled back to sp_before_effects, but the underlying
        // payment WAS genuinely applied. Mark this delivery APPLIED too (a benign duplicate), not
        // FAILED -- otherwise a normal, harmless race would dead-letter a payment that already
        // settled correctly.
        pending = { duplicateSettlement: true }
      } else {
        // Every other failure class: a genuine business/data error. The claim STAYS (we rolled back
        // only to sp_before_effects), so this attempt durably consumes one attempt and the dead-letter
        // ceiling keeps counting exactly as it did before the merge.
        pending = { failure: err }
      }
    }

    // ---------------------------------------------------------------------------------------------
    // THE COMMIT GATE. `authorizeClaim` -- the acting actor's live authority, re-checked against
    // authoritative DB state with user_sessions/users LOCKED until this transaction commits.
    //
    // SEC-002R round 5 moved this from "immediately after the CAS, before apply()" to here, the last
    // statement before the single commit. In the two-transaction design the position mattered: the
    // claim transaction committed on its own, so the check HAD to precede it or the claim escaped
    // ungated. Under the merge there is exactly one commit, so what matters is only that no path
    // reaching it can bypass this check and that the lock is still held when it happens -- both of
    // which are true here, for the success path, the benign-duplicate path, the claim-lost path and
    // the FAILED/DEAD_LETTERED path alike. This is also the more literal reading of what
    // commit-authorization.mjs exists to do ("authorization that is still true at the moment an
    // irreversible mutation commits").
    //
    // Nothing runs unauthorized as a result: in production `authorizeClaim` is only ever supplied by
    // the admin replay route, which passes the SAME reauthorizeAtCommit hook as the rail's
    // `beforeEffects` -- and that one still runs inside apply(), before the first effect-producing
    // statement, exactly as rounds 1-4 established. This is the second, unbypassable gate behind it,
    // not a replacement for it.
    //
    // Moving it here also removes a real lock-window hazard the merge would otherwise have
    // introduced: held from before apply(), the user_sessions/users locks would have spanned the
    // whole effects phase, so any concurrent revocation of that actor would block for the duration of
    // a payment application rather than merely being ordered against it.
    if (authorizeClaim) {
      try {
        await authorizeClaim(tx)
      } catch (authErr) {
        if (!authErr?.reauthorizationFailure) throw authErr
        await rollbackToSavepoint(tx, SP_BEFORE_CLAIM)
        return { rethrow: authErr, reauthRolledBack: true, priorStatus }
      }
    }

    if (pending.duplicateSettlement) {
      // Bound to `token`, which we still hold.
      await tx.paymentEvent.updateMany({
        where: { id: eventId, claimToken: token, processingStatus: { not: 'APPLIED' } },
        data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null, claimToken: null, claimExpiresAt: null },
      })
      return { result: { applied: false, duplicate: true } }
    }

    if (pending.failure) {
      // Re-read this claim's own freshly-incremented attempts value rather than trusting a stale
      // local variable -- the CAS above returns only a count. Read through `tx` so it sees this
      // transaction's own uncommitted increment, which is precisely the value that is about to be
      // committed.
      const claimed = await tx.paymentEvent.findUnique({ where: { id: eventId } })
      const dead = (claimed?.attempts ?? 0) >= DEAD_LETTER_THRESHOLD
      try {
        await tx.paymentEvent.updateMany({
          where: { id: eventId, claimToken: token, processingStatus: 'APPLYING' },
          data: {
            processingStatus: dead ? 'DEAD_LETTERED' : 'FAILED',
            // Pre-sanitized at write time (never the raw error) — a DB column is a permanent record,
            // stronger guarantee needed than key-based log redaction alone.
            lastError: JSON.stringify(errorSummary(pending.failure)).slice(0, 2000),
            lastAttemptAt: new Date(),
            claimToken: null,
            claimExpiresAt: null,
          },
        })
      } catch (e2) {
        // Preserves round 4's contract that a failure of the BOOKKEEPING write must never mask the
        // real error the caller needs to see. Recovering to sp_before_effects first is what makes
        // that possible inside a single transaction: without it the aborted transaction could not
        // commit at all and Prisma would surface this secondary error in place of the real one.
        await rollbackToSavepoint(tx, SP_BEFORE_EFFECTS).catch(() => {})
        log.error('payment_event_failure_record_failed', { eventId, err: errorSummary(e2) })
      }
      return { rethrow: pending.failure, failure: { attempts: claimed?.attempts, dead } }
    }

    return { result: pending.result }
  }, MERGED_TX_OPTIONS)

  // Everything below runs after the single transaction has COMMITTED. Re-throwing here rather than
  // from inside the callback is what lets a refusal both (a) leave the database in the fully-resolved
  // state the branch above decided on, and (b) still reach the caller as a thrown error.
  if (outcome.reauthRolledBack) {
    log.error('payment_event_reauth_claim_rolled_back', {
      eventId, rail, restoredTo: outcome.priorStatus, code: outcome.rethrow?.code ?? null,
    })
    throw outcome.rethrow
  }
  if (outcome.failure) {
    log.error('payment_webhook_apply_failed', {
      eventId, rail, attempts: outcome.failure.attempts, dead: outcome.failure.dead, err: errorSummary(outcome.rethrow),
    })
    // Never re-annotate err with a bare statusCode here — handleRouteError (responses.mjs) exposes
    // .message whenever .statusCode is set even without .expose. Re-throwing unannotated lets a
    // genuine infra failure fall through to the safe generic 500.
    throw outcome.rethrow
  }
  return outcome.result
}

// Both webhook routes call this to decide their ACTUAL HTTP status from an applyPaymentEvent() result
// — a bare 200 regardless of outcome (round 6's behavior) is exactly what independent review flagged
// as unsafe: a payment provider decides whether to keep retrying based on the HTTP status, never on a
// private JSON field. `retryable: true` (an active, unexpired claim held by someone else, or this
// specific attempt's own claim having been lost mid-transaction) becomes a real non-2xx, so the
// provider's own retry schedule keeps delivering until the event reaches a genuinely settled outcome
// (APPLIED/IGNORED/a terminal duplicate) or the abandoned claim expires and a later retry reclaims it
// — this is what makes recovery automatic without a new background worker. 409 (not 503): this is not
// the SERVER being unavailable, it's a specific, expected, temporary ownership conflict on this one
// event — semantically the same "come back later, someone else has this" signal 409 already carries
// elsewhere in this codebase (e.g. PAYMENT_EVENT_NOT_REPLAYABLE).
export function webhookAcknowledgeStatus(result) {
  return result?.retryable ? 409 : 200
}
