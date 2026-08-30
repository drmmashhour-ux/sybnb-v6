// SYBNB — the Stripe Checkout rail's "apply this session's real-world effect" logic. Relocated
// verbatim from server/routes/payments.mjs (pure move, no behavior change) so BOTH the live webhook
// handler in payments.mjs AND the admin replay endpoint in payment-intents.mjs (a cross-rail replay
// path — see that route's handling of a stripe_checkout-rail PaymentEvent) can call it, and so the
// webhook path can wrap it with the same attempts/dead-letter bookkeeping the payment_intent rail
// already has (see payment-event-pipeline.mjs).
import { db } from './prisma.mjs'
import { approvePaymentProof, firstAdminId, isProviderRefUniqueViolation } from './finance-ledger.mjs'
import { verifyAndLockClaim, ClaimLostError } from './payment-event-pipeline.mjs'

// `verifyOwnership` and `markSettled`, if supplied, both run INSIDE this function's own transaction —
// see applyStripeCheckoutEvent below, the ONLY caller that ever supplies either (bound to a webhook
// claim's token). `verifyOwnership` runs first, before any effect-producing write; `markSettled` runs
// as the LAST statement on every exit path from inside the transaction, so the PaymentEvent row's
// final APPLIED/IGNORED transition commits ATOMICALLY with whatever effect (or lack of one) this
// invocation produced — never as a separate statement after the fact (round 8: independent review
// found the round-7 version still committed PaymentProof/wallet/booking effects in this function's
// own transaction, then marked the event row APPLIED as a SEPARATE statement afterward -- a crash in
// that narrow window could leave real financial effects committed while the event stayed stuck at
// APPLYING forever, and the round-7 code didn't even check whether that separate write succeeded).
// The `/api/payments/stripe/confirm` route calls this function directly with no options object at
// all: that path has no claim concept (it is driven by user action, not a webhook claim), so neither
// hook runs there — both parameters are entirely absent for that call site, not merely no-ops.
export async function finalizeStripeSession(session, { verifyOwnership, markSettled } = {}) {
  try {
   return await db().$transaction(async (tx) => {
    if (verifyOwnership) await verifyOwnership(tx)

    const bookingId = session.metadata?.bookingId
    if (!bookingId || session.payment_status !== 'paid') {
      if (markSettled) await markSettled(tx, { applied: false })
      return null
    }

    const existingProof = await tx.paymentProof.findFirst({
      where: { provider: 'stripe', providerRef: session.id },
    })
    if (existingProof) {
      if (markSettled) await markSettled(tx, { applied: true })
      return existingProof
    }

    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking || booking.status !== 'PAYMENT_PENDING') {
      if (markSettled) await markSettled(tx, { applied: false })
      return null
    }

    const created = await tx.paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: booking.guestId,
        provider: 'stripe',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: Number(session.metadata?.sypTotalMinor || booking.amountMinor),
        currency: booking.currency,
        providerRef: session.id,
        proofAssetUrl: session.payment_intent ? `stripe://payment_intents/${session.payment_intent}` : undefined,
      },
    })

    const proof = await approvePaymentProof(tx, {
      proofId: created.id,
      actorUserId: await firstAdminId(tx),
      note: 'Auto-approved: Stripe confirmed the card charge was captured.',
    })
    if (markSettled) await markSettled(tx, { applied: true })
    return proof
   })
  } catch (err) {
    // Concurrent webhook delivery may have finalized first — the unique constraint rejects the
    // second insert; return the already-created proof so finalization stays idempotent. This is the
    // ONE exit path that never runs markSettled (it is outside the transaction that just rolled
    // back) -- correct, because nothing NEW was written by THIS attempt to make atomic with anything:
    // the real effect was already fully committed by whichever transaction won the race. See
    // applyStripeCheckoutEvent, which resolves the event row's own marking for exactly this case.
    if (isProviderRefUniqueViolation(err)) {
      return db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: session.id } })
    }
    throw err
  }
}

// Wraps finalizeStripeSession for the durable webhook-apply seam: marks the PaymentEvent row APPLIED
// (session finalized, or already had been — both resolve to the same settled proof) or IGNORED (a
// structural no-op: unpaid session, or the booking is no longer in a state this can apply to) via the
// markSettled hook above, INSIDE finalizeStripeSession's own transaction — atomic with whatever
// effect that invocation produced. Requires a real claimToken -- verifyAndLockClaim() (called via
// verifyOwnership below) now fails closed on a missing one (round 8), so this needs no separate check
// of its own; production code always supplies a real token, and direct idempotency tests now seed and
// acquire a genuine claim first instead of omitting it (see
// tests/e2e/payment-event-claim-recovery.e2e.mjs).
// SEC-002R: `beforeEffects` is forwarded into the existing `verifyOwnership` hook, so it runs inside
// finalizeStripeSession's own transaction, after claim ownership is proven and before any
// effect-producing write. Supplied ONLY by the admin replay route (to re-authorize the acting admin
// at the commit boundary); the live webhook path never supplies it -- a provider delivery is
// authenticated by its signature, not by a session, and has no actor to re-authorize.
export async function applyStripeCheckoutEvent({ eventId, session, claimToken, beforeEffects }) {
  let settledInsideTransaction = false
  let appliedOutcome = false

  const proof = await finalizeStripeSession(session, {
    verifyOwnership: async (tx) => {
      await verifyAndLockClaim(tx, { eventId, claimToken })
      if (beforeEffects) await beforeEffects(tx)
    },
    markSettled: async (tx, { applied }) => {
      const marked = await tx.paymentEvent.updateMany({
        where: { id: eventId, claimToken },
        data: { processingStatus: applied ? 'APPLIED' : 'IGNORED', appliedAt: new Date(), lastError: applied ? null : undefined, claimToken: null, claimExpiresAt: null },
      })
      // Guarded even though verifyAndLockClaim() already holds this row's lock for the whole
      // transaction (so this can only fail if something is deeply wrong) -- throws rather than
      // silently ignoring a mismatch, same as every other claim-bound write in this codebase.
      if (marked.count === 0) throw new ClaimLostError(eventId)
      settledInsideTransaction = true
      appliedOutcome = applied
    },
  })

  if (!settledInsideTransaction) {
    // Reached only via finalizeStripeSession's own isProviderRefUniqueViolation catch (every other
    // exit path calls markSettled inside its own transaction, above): a DIFFERENT, already-fully-
    // committed transaction produced this exact PaymentProof first. Nothing new was written by THIS
    // attempt to roll back; mark this row APPLIED too, matching the effect that already, safely,
    // settled elsewhere. Required to succeed -- a lost claim here still throws, never silently
    // reports success.
    const marked = await db().paymentEvent.updateMany({
      where: { id: eventId, claimToken, processingStatus: { not: 'APPLIED' } },
      data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null, claimToken: null, claimExpiresAt: null },
    })
    if (marked.count === 0) {
      const current = await db().paymentEvent.findUnique({ where: { id: eventId } })
      if (current?.processingStatus !== 'APPLIED') throw new ClaimLostError(eventId)
    }
    appliedOutcome = true
  }

  return { applied: appliedOutcome, illegal: !appliedOutcome, status: proof?.status }
}
