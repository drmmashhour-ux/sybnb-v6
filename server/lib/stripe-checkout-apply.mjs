// SYBNB — the Stripe Checkout rail's "apply this session's real-world effect" logic. Relocated
// verbatim from server/routes/payments.mjs (pure move, no behavior change) so BOTH the live webhook
// handler in payments.mjs AND the admin replay endpoint in payment-intents.mjs (a cross-rail replay
// path — see that route's handling of a stripe_checkout-rail PaymentEvent) can call it, and so the
// webhook path can wrap it with the same attempts/dead-letter bookkeeping the payment_intent rail
// already has (see payment-event-pipeline.mjs).
import { approvePaymentProof, firstAdminId, isProviderRefUniqueViolation } from './finance-ledger.mjs'
import { verifyAndLockClaim, ClaimLostError } from './payment-event-pipeline.mjs'
import { reauthorizeAtCommit } from './commit-authorization.mjs'
import { withTx, dbOrTx } from './tx-scope.mjs'

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
// The `/api/payments/stripe/confirm` route has no claim concept (it is driven by user action, not a
// webhook claim), so neither of those two hooks runs there. It DOES supply `beforeEffects` — see
// below and confirmStripeCheckoutSessionForActor().
//
// SEC-002R round 2 (GAP-1). `beforeEffects` is now a first-class parameter of THIS function rather
// than something only applyStripeCheckoutEvent knew how to inject. Independent review found the
// round-1 fix left `/api/payments/stripe/confirm` calling this function with no options object at
// all -- so the PaymentProof create + approvePaymentProof below (the same money-moving primitive the
// review-queue payment-approve path protects) ran with NO commit-boundary re-authorization
// whatsoever. That path was unreachable in practice only because 'stripe' is absent from
// APPROVED_PROVIDER_CONFIGS; a configuration gate is not an authorization boundary, and the owner
// explicitly refused it as the fix. It runs INSIDE this function's own transaction, after ownership
// (webhook rail) is proven and before ANY effect-producing read or write, so a throw from it rolls
// the entire transaction back with nothing committed.
// SEC-002R round 5: `withTx` instead of `db().$transaction` directly -- see the identical note on
// applyPaymentIntentEvent in routes/payment-intents.mjs. Invoked from the merged claim+effects
// pipeline this body becomes a SAVEPOINT-delimited subtransaction of the pipeline's single
// transaction (so the claim and these effects commit atomically together, and a throw here rolls
// these effects back while leaving that transaction usable); invoked standalone -- the
// `/api/payments/stripe/confirm` route, which has no claim concept at all, and the direct-call
// regression suites -- it opens a real transaction exactly as before. This function's own logic is
// unchanged in either mode.
export async function finalizeStripeSession(session, { verifyOwnership, beforeEffects, markSettled } = {}) {
  try {
   return await withTx(async (tx) => {
    if (verifyOwnership) await verifyOwnership(tx)
    if (beforeEffects) await beforeEffects(tx)

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
    // SEC-002R round 5: `dbOrTx()`, not `db()`. Under the merged pipeline transaction withTx has just
    // rolled this attempt's savepoint back, so the transaction is usable again and this read must run
    // ON it -- a read from a separate pooled connection would be correct here too (the winning proof
    // is committed by definition), but keeping every statement of the apply path on the one
    // transaction is what guarantees no statement can ever contend with the locks that transaction
    // itself is holding.
    if (isProviderRefUniqueViolation(err)) {
      return dbOrTx().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: session.id } })
    }
    throw err
  }
}

// SEC-002R round 2 (GAP-1) — the confirm rail's Class A seam.
//
// `/api/payments/stripe/confirm` is a GUEST-authenticated request that finalizes a real card charge:
// it creates a PaymentProof and immediately auto-approves it via approvePaymentProof(), which posts
// the host HOLD, the platform-share CREDIT and the protection fee, and confirms the booking. That is
// the SAME irreversible money-moving primitive the review-queue payment-approve path (admin.mjs's
// Class A dispatcher) is protected for, so it gets the same commit-boundary guarantee.
//
// Defined HERE rather than inline in the route so there is exactly one definition of "what this rail
// re-authorizes", callable by both the route and the regression suite -- the suite cannot drive the
// route end-to-end (that requires a live Stripe account to answer
// stripe.checkout.sessions.retrieve), so it races THIS function, which is the entire body of the
// route's effect.
//
// requiredRoles is ['GUEST'] to mirror the route's own requireAuth(context, ['GUEST']): if the actor
// loses GUEST between admission and commit, the finalization must not land either. Ownership of the
// checkout session (session.metadata.guestId === actor) is checked by the route against Stripe's own
// authenticated response and is not re-derivable inside the transaction, so it stays where it is;
// what this adds is the account/session/role authority half, which IS re-derivable and IS lockable.
export async function confirmStripeCheckoutSessionForActor({ session, context }) {
  return finalizeStripeSession(session, {
    beforeEffects: (tx) => reauthorizeAtCommit(tx, context, {
      action: 'STRIPE_CHECKOUT_CONFIRMED',
      requiredRoles: ['GUEST'],
    }),
  })
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
    },
    // Forwarded to finalizeStripeSession's own `beforeEffects` slot, which runs immediately after
    // verifyOwnership above and before any effect-producing statement -- identical ordering to the
    // round-1 version that nested it inside verifyOwnership, now expressed through the shared
    // parameter so the confirm route and the replay route use ONE mechanism, not two.
    beforeEffects,
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
    // SEC-002R round 5: `dbOrTx()`, not `db()`. This one is not a preference, it is REQUIRED. Under
    // the merged pipeline transaction the payment_events row is FOR UPDATE-locked by that very
    // transaction; issuing this UPDATE on a second pooled connection would block on a lock that can
    // only be released by the transaction that is synchronously awaiting this call -- a guaranteed
    // self-deadlock, resolvable only by the transaction timeout.
    const marked = await dbOrTx().paymentEvent.updateMany({
      where: { id: eventId, claimToken, processingStatus: { not: 'APPLIED' } },
      data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null, claimToken: null, claimExpiresAt: null },
    })
    if (marked.count === 0) {
      const current = await dbOrTx().paymentEvent.findUnique({ where: { id: eventId } })
      if (current?.processingStatus !== 'APPLIED') throw new ClaimLostError(eventId)
    }
    appliedOutcome = true
  }

  return { applied: appliedOutcome, illegal: !appliedOutcome, status: proof?.status }
}
