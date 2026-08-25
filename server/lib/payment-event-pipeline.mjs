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
// that happen to share a raw provider_event_id string across providers/accounts/environments, which
// can no longer collide at all since the constraint is now scoped by all four), the existing row's
// IMMUTABLE fields are compared against this freshly-authenticated delivery:
//   - a match is an ordinary duplicate — the existing row is returned unchanged, `conflict: false`;
//   - a mismatch is a genuine conflict — never applied, the ORIGINAL row is never overwritten, it is
//     marked QUARANTINED with a typed reason, and this is logged for operational visibility.
//
// `fields` must include every column in the eventIdentity key (provider, providerAccount,
// environment, providerEventId) plus every other immutable column this function compares.
export async function intakeEvent(fields) {
  try {
    return { eventRow: await db().paymentEvent.create({ data: fields }), conflict: false }
  } catch (err) {
    if (!isPaymentEventIdentityConflict(err)) throw err
    const eventRow = await db().paymentEvent.findUniqueOrThrow({
      where: {
        eventIdentity: {
          provider: fields.provider,
          providerAccount: fields.providerAccount,
          environment: fields.environment,
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
    log.error('payment_event_identity_conflict', { eventId: eventRow.id, providerEventId: fields.providerEventId, rail: fields.rail })
    const quarantined = await db().paymentEvent.update({
      where: { id: eventRow.id },
      data: { processingStatus: 'QUARANTINED', lastError: 'IDENTITY_CONFLICT: redelivered event with the same identity but different immutable fields' },
    })
    return { eventRow: quarantined, conflict: true }
  }
}

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
