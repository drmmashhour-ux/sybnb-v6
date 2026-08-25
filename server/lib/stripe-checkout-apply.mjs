// SYBNB — the Stripe Checkout rail's "apply this session's real-world effect" logic. Relocated
// verbatim from server/routes/payments.mjs (pure move, no behavior change) so BOTH the live webhook
// handler in payments.mjs AND the admin replay endpoint in payment-intents.mjs (a cross-rail replay
// path — see that route's handling of a stripe_checkout-rail PaymentEvent) can call it, and so the
// webhook path can wrap it with the same attempts/dead-letter bookkeeping the payment_intent rail
// already has (see payment-event-pipeline.mjs).
import { db } from './prisma.mjs'
import { approvePaymentProof, firstAdminId, isProviderRefUniqueViolation } from './finance-ledger.mjs'

export async function finalizeStripeSession(session) {
  const bookingId = session.metadata?.bookingId
  if (!bookingId || session.payment_status !== 'paid') return null

  try {
   return await db().$transaction(async (tx) => {
    const existingProof = await tx.paymentProof.findFirst({
      where: { provider: 'stripe', providerRef: session.id },
    })
    if (existingProof) return existingProof

    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking || booking.status !== 'PAYMENT_PENDING') return null

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

    return approvePaymentProof(tx, {
      proofId: created.id,
      actorUserId: await firstAdminId(tx),
      note: 'Auto-approved: Stripe confirmed the card charge was captured.',
    })
   })
  } catch (err) {
    // Concurrent webhook delivery may have finalized first — the unique constraint rejects the
    // second insert; return the already-created proof so finalization stays idempotent.
    if (isProviderRefUniqueViolation(err)) {
      return db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: session.id } })
    }
    throw err
  }
}

// Wraps finalizeStripeSession for the durable webhook-apply seam: on top of the idempotent business
// logic above, marks the PaymentEvent row APPLIED (session finalized, or already had been — both
// resolve to the same settled proof) or IGNORED (a structural no-op: unpaid session, or the booking
// is no longer in a state this can apply to — e.g. already confirmed via a sibling delivery that lost
// no race, or cancelled). This marking is a separate statement from finalizeStripeSession's own
// transaction (that function is also called synchronously outside any webhook, from the
// stripe/confirm route, so it cannot itself own an outer event-row update) — a crash in the narrow
// window between the two is self-healing: a later redelivery finds the already-created PaymentProof
// via finalizeStripeSession's own idempotent existingProof check and simply re-marks APPLIED, so
// nothing is silently lost, only (at worst) briefly stuck at APPLYING until redelivered or replayed.
export async function applyStripeCheckoutEvent({ eventId, session }) {
  const proof = await finalizeStripeSession(session)
  if (!proof) {
    await db().paymentEvent.update({ where: { id: eventId }, data: { processingStatus: 'IGNORED', appliedAt: new Date() } })
    return { applied: false, illegal: true }
  }
  await db().paymentEvent.update({ where: { id: eventId }, data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null } })
  return { applied: true, status: proof.status }
}
