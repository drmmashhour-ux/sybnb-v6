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
// duplicate collision after — the part that must behave identically regardless of rail.
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
    const eventRow = await db().paymentEvent.findUniqueOrThrow({
      where: {
        eventIdentity: {
          provider: fields.provider,
          providerEndpointKey: fields.providerEndpointKey,
          providerEventId: fields.providerEventId,
        },
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

// A row may only be CLAIMED for an apply attempt from one of these statuses. RECEIVED and FAILED are
// the ordinary "not yet applied / a previous attempt failed, retryable" states; DEAD_LETTERED is
// claimable too because admin replay is explicitly allowed to retry a dead-lettered event (the live
// webhook path never reaches applyPaymentEvent for a DEAD_LETTERED row at all -- both routes check
// and short-circuit before calling this function). APPLYING (a sibling delivery currently holds the
// claim) and APPLIED/IGNORED/QUARANTINED/POLICY_DEFERRED (terminal or not-this-function's-job states)
// are deliberately excluded -- there is no status a second concurrent delivery can observe that lets
// it also enter apply().
const CLAIMABLE_STATUSES = ['RECEIVED', 'FAILED', 'DEAD_LETTERED']

// Atomically claims eventId for an apply attempt, then runs it. Independent review found the previous
// version bumped attempts/wrote APPLYING with a blind, unconditional `update` -- every one of N
// concurrent deliveries for the same event would win that write, so all N incremented attempts and
// all N called apply(), relying entirely on a downstream DB unique constraint (which only some
// effects have) to avoid double-applying, and leaving open a real race: a LATE-failing worker could
// overwrite a row a sibling had already, correctly, moved to APPLIED, silently downgrading a
// genuinely successful payment back to FAILED/DEAD_LETTERED.
//
// Fixed with a real compare-and-swap: the claim is a single conditional `updateMany` scoped to
// CLAIMABLE_STATUSES. Postgres serializes concurrent UPDATEs against the same row via its row lock —
// the first to commit flips the row to APPLYING; every other concurrent claim attempt then evaluates
// its WHERE clause against that already-committed APPLYING status, matches zero rows, and returns
// immediately WITHOUT EVER CALLING apply() at all. This makes the old bug structurally impossible
// rather than merely less likely: at most one caller can be inside apply() for a given eventId at any
// time, so attempts increments exactly once per genuine claim (never once per concurrent deliverer),
// and there is no window in which a second, later-failing worker could run at all, let alone downgrade
// a state a sibling already committed.
export async function applyPaymentEvent({ eventId, rail, apply }) {
  const claim = await db().paymentEvent.updateMany({
    where: { id: eventId, processingStatus: { in: CLAIMABLE_STATUSES } },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), processingStatus: 'APPLYING' },
  })
  if (claim.count === 0) {
    // Lost the claim race (or arrived after the winner already finished) — acknowledge without ever
    // running apply(). Report duplicate:true only once we can actually see the terminal APPLIED
    // outcome; a sibling that's still mid-flight (APPLYING) reports its current status instead of
    // guessing at an outcome that hasn't happened yet — callers already treat any non-error result as
    // a safe 200 acknowledgement (see both webhook routes and the admin replay endpoint).
    const current = await db().paymentEvent.findUnique({ where: { id: eventId } })
    if (current?.processingStatus === 'APPLIED') return { applied: false, duplicate: true, claimed: false }
    return { applied: false, duplicate: false, claimed: false, status: current?.processingStatus ?? null }
  }
  try {
    // apply() is trusted to mark the row APPLIED or IGNORED itself on success — see module comment.
    return await apply()
  } catch (err) {
    if (isProviderRefUniqueViolation(err)) {
      // A SEPARATE claim round (a genuinely later redelivery or replay, not a concurrent one — those
      // are now impossible per the comment above) already applied this exact event and committed
      // first — this attempt collided with that and rolled back, but the underlying payment WAS
      // genuinely applied by the sibling round. Mark this delivery APPLIED too (a benign duplicate),
      // not FAILED — otherwise a normal, harmless race would dead-letter a payment that already
      // settled correctly. Guarded (`not: 'APPLIED'`) so this can only ever set the row TO applied,
      // never touch it if it's already there — belt-and-braces on top of a race that CAS has already
      // made structurally impossible to concurrently double-execute.
      await db().paymentEvent.updateMany({ where: { id: eventId, processingStatus: { not: 'APPLIED' } }, data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null } })
      return { applied: false, duplicate: true }
    }
    // Re-read this claim's own freshly-incremented attempts value rather than trusting a stale local
    // variable — with the CAS claim above, `claim` doesn't carry the row's new field values (updateMany
    // only returns a count), so the post-claim attempts figure must be read back explicitly.
    const claimed = await db().paymentEvent.findUnique({ where: { id: eventId } })
    const dead = (claimed?.attempts ?? 0) >= DEAD_LETTER_THRESHOLD
    // Guarded to only affect the row while it's still in the APPLYING state THIS call put it in — if
    // it somehow moved on already (e.g. an out-of-band admin action), a stale failure must never
    // downgrade whatever it moved to.
    await db()
      .paymentEvent.updateMany({
        where: { id: eventId, processingStatus: 'APPLYING' },
        data: {
          processingStatus: dead ? 'DEAD_LETTERED' : 'FAILED',
          // Pre-sanitized at write time (never the raw error) — a DB column is a permanent record,
          // stronger guarantee needed than key-based log redaction alone.
          lastError: JSON.stringify(errorSummary(err)).slice(0, 2000),
          lastAttemptAt: new Date(),
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
