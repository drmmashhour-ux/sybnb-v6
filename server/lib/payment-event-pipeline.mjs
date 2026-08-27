// SYBNB — the SHARED "attempts, dead-lettering, duplicate-collision handling" machinery for every
// durable webhook rail. Extracted from payment-intents.mjs (which was the only rail with a durable
// PaymentEvent inbox) so the older Stripe Checkout rail can get the exact same guarantees — a
// bounded automatic-retry ceiling before a human is needed, and safe handling of a concurrent
// duplicate application — without a second, drifting copy of this bookkeeping.
//
// Each rail supplies its own `apply()` closure: fully self-contained business logic (it manages its
// own DB transaction and is responsible for marking the PaymentEvent row APPLIED/IGNORED itself,
// atomically with its own business-state write — this module does not impose an outer transaction
// boundary, since the two rails' own apply logic already differs in shape: the payment_intent rail's
// apply is one transaction; the stripe_checkout rail's apply delegates to finalizeStripeSession,
// which manages its own transaction and is also called synchronously from a non-webhook route). This
// module only owns: bumping attempts before the attempt, and recording FAILED/DEAD_LETTERED/a benign
// duplicate collision after — the part that must behave identically regardless of rail. Each rail's
// apply() transaction MUST call verifyAndLockClaim() (below) as its own first statement, before any
// business-effect write — see that function's comment for why (round 7: a worker whose claim has
// already been reclaimed must never be able to execute, let alone commit, a real financial effect).
import { randomUUID } from 'node:crypto'
import { db } from './prisma.mjs'
import { log, errorSummary } from './logger.mjs'
import { isProviderRefUniqueViolation } from './finance-ledger.mjs'

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
export async function applyPaymentEvent({ eventId, rail, apply }) {
  const token = randomUUID()
  const now = new Date()
  const claimExpiresAt = new Date(now.getTime() + CLAIM_DURATION_MS)
  const claim = await db().paymentEvent.updateMany({
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
    const current = await db().paymentEvent.findUnique({ where: { id: eventId } })
    if (current?.processingStatus === 'APPLIED') return { applied: false, duplicate: true, claimed: false }
    return { applied: false, duplicate: false, claimed: false, retryable: true, status: current?.processingStatus ?? null }
  }
  try {
    // apply() is trusted to mark the row APPLIED or IGNORED itself on success, bound to `token` -- see
    // module comment and each rail's own apply function (applyPaymentIntentEvent /
    // applyStripeCheckoutEvent).
    return await apply(token)
  } catch (err) {
    if (err?.claimLost) {
      // verifyAndLockClaim() (called first, inside apply()'s own transaction, before any business
      // effect) found this claim already reclaimed -- the transaction rolled back on its own, nothing
      // committed. Never touch attempts/lastError/processingStatus here: whatever the newer claimant
      // has established (or is still establishing) is authoritative, and this attempt genuinely did
      // nothing to it.
      return { applied: false, duplicate: false, claimLost: true, retryable: true }
    }
    if (isProviderRefUniqueViolation(err)) {
      // A SEPARATE claim round (a genuinely later redelivery or replay, not a concurrent one — those
      // are impossible per the comment above) already applied this exact event and committed first —
      // this attempt collided with that and rolled back, but the underlying payment WAS genuinely
      // applied by the sibling round. Mark this delivery APPLIED too (a benign duplicate), not FAILED
      // — otherwise a normal, harmless race would dead-letter a payment that already settled
      // correctly. Bound to `token`: if a newer claimant has since taken over (this worker's own claim
      // expired while it was mid-flight), this write correctly becomes a no-op instead of stomping on
      // whatever the newer claimant established.
      await db().paymentEvent.updateMany({
        where: { id: eventId, claimToken: token, processingStatus: { not: 'APPLIED' } },
        data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null, claimToken: null, claimExpiresAt: null },
      })
      return { applied: false, duplicate: true }
    }
    // Re-read this claim's own freshly-incremented attempts value rather than trusting a stale local
    // variable — with the CAS claim above, `claim` doesn't carry the row's new field values (updateMany
    // only returns a count), so the post-claim attempts figure must be read back explicitly.
    const claimed = await db().paymentEvent.findUnique({ where: { id: eventId } })
    const dead = (claimed?.attempts ?? 0) >= DEAD_LETTER_THRESHOLD
    // Bound to `token`, same reasoning as the benign-duplicate write above: a stale worker's own
    // failure-handling must never downgrade whatever a newer claimant has already established.
    await db()
      .paymentEvent.updateMany({
        where: { id: eventId, claimToken: token, processingStatus: 'APPLYING' },
        data: {
          processingStatus: dead ? 'DEAD_LETTERED' : 'FAILED',
          // Pre-sanitized at write time (never the raw error) — a DB column is a permanent record,
          // stronger guarantee needed than key-based log redaction alone.
          lastError: JSON.stringify(errorSummary(err)).slice(0, 2000),
          lastAttemptAt: new Date(),
          claimToken: null,
          claimExpiresAt: null,
        },
      })
      .catch((e2) => log.error('payment_event_failure_record_failed', { eventId, err: errorSummary(e2) }))
    log.error('payment_webhook_apply_failed', { eventId, rail, attempts: claimed?.attempts, dead, err: errorSummary(err) })
    // Never re-annotate err with a bare statusCode here — handleRouteError (responses.mjs) exposes
    // .message whenever .statusCode is set even without .expose. Re-throwing unannotated lets a
    // genuine infra failure fall through to the safe generic 500.
    throw err
  }
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
