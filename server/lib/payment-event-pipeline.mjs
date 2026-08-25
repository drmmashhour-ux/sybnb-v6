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

export async function applyPaymentEvent({ eventId, rail, apply }) {
  const bumped = await db().paymentEvent.update({
    where: { id: eventId },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), processingStatus: 'APPLYING' },
  })
  try {
    // apply() is trusted to mark the row APPLIED or IGNORED itself on success — see module comment.
    return await apply()
  } catch (err) {
    if (isProviderRefUniqueViolation(err)) {
      // A concurrent delivery (redelivery racing itself, or an admin replay overlapping a live
      // redelivery) already applied this exact event and committed first — this attempt collided
      // with that and rolled back, but the underlying payment WAS genuinely applied by the sibling.
      // Mark this delivery APPLIED too (a benign duplicate), not FAILED — otherwise a normal,
      // harmless race would dead-letter a payment that already settled correctly.
      await db().paymentEvent.update({ where: { id: eventId }, data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null } })
      return { applied: false, duplicate: true }
    }
    const dead = bumped.attempts >= DEAD_LETTER_THRESHOLD
    await db()
      .paymentEvent.update({
        where: { id: eventId },
        data: {
          processingStatus: dead ? 'DEAD_LETTERED' : 'FAILED',
          // Pre-sanitized at write time (never the raw error) — a DB column is a permanent record,
          // stronger guarantee needed than key-based log redaction alone.
          lastError: JSON.stringify(errorSummary(err)).slice(0, 2000),
          lastAttemptAt: new Date(),
        },
      })
      .catch((e2) => log.error('payment_event_failure_record_failed', { eventId, err: errorSummary(e2) }))
    log.error('payment_webhook_apply_failed', { eventId, rail, attempts: bumped.attempts, dead, err: errorSummary(err) })
    // Never re-annotate err with a bare statusCode here — handleRouteError (responses.mjs) exposes
    // .message whenever .statusCode is set even without .expose. Re-throwing unannotated lets a
    // genuine infra failure fall through to the safe generic 500.
    throw err
  }
}
