// SYBNB — Stripe-for-SR Option B: auto-charge a completed ride's fare to the rider's saved card,
// off-session (no rider tap), the moment the driver marks the trip COMPLETED. Mirrors Uber's model.
//
// Safety posture:
//  - No-op unless Stripe is configured AND (for a live key) payments are explicitly enabled.
//  - Fails OPEN: any decline, SCA requirement, or error leaves NO payment proof, so the rider still
//    has every other rail (cash, wallet, hosted Checkout "Pay by card") -- nothing is blocked and no
//    money moves on failure.
//  - Idempotent: settlement is keyed by the PaymentIntent id (provider 'stripe', providerRef), and a
//    ride that already has a live fare proof is never charged again.
//  - On success it settles exactly like the hosted-Checkout ride path: a 'stripe' card proof that the
//    ledger splits into the driver's net + the platform commission.
import Stripe from 'stripe'
import { db } from './prisma.mjs'
import { approvePaymentProof, firstAdminId } from './finance-ledger.mjs'
import { withTx } from './tx-scope.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from './payment-policy.mjs'
import { log } from './logger.mjs'
import { cardPaymentsOff } from './card-payments.mjs'

const chargeCurrencyForHold = () => (process.env.STRIPE_CURRENCY || 'usd').toLowerCase()
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

export async function maybeAutoChargeRideCard({ rideId }) {
  if (!stripe) return { attempted: false, reason: 'stripe_not_configured' }
  try { authorizePaymentOperation({
      operation: 'capture',
      rail: 'stripe_checkout',
      provider: 'stripe',
      division: 'SR',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: [] },
    }) } catch { return { attempted: false, reason: 'payment_policy_denied' } }
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && process.env.PAYMENTS_ENABLED !== 'true') {
    return { attempted: false, reason: 'payments_disabled' }
  }

  const ride = await db().rideRequest.findUnique({
    where: { id: rideId },
    select: { id: true, riderId: true, status: true, fareMinor: true, currency: true, metadata: true },
  })
  if (!ride || ride.status !== 'COMPLETED') return { attempted: false, reason: 'not_completed' }
  if (ride.metadata?.prepaid) return { attempted: false, reason: 'prepaid' }
  const amountMinor = Math.round(ride.fareMinor || 0)
  if (amountMinor <= 0) return { attempted: false, reason: 'no_fare' }
  // CARD_PAYMENTS=off: no new card charges. A hold authorised before the switch is still captured.
  if (cardPaymentsOff() && !ride.metadata?.cardHoldIntentId) return { attempted: false, reason: 'card_payments_off' }

  // Hold-and-capture (Rezekme Payment Standard): capture the authorised hold for the actual fare.
  const holdId = ride.metadata?.cardHoldIntentId
  if (holdId) {
    let intent
    try {
      const held = await stripe.paymentIntents.retrieve(holdId)
      const heldCents = held.amount
      const wantCents = Math.max(50, amountMinor * 100)
      intent = await stripe.paymentIntents.capture(holdId, { amount_to_capture: Math.min(heldCents, wantCents) }, { idempotencyKey: `sr-ride-capture-${ride.id}` })
      // Fare grew past the hold (e.g. route change): charge the difference off-session on the same card.
      if (wantCents > heldCents) {
        const rider = await db().user.findUnique({ where: { id: ride.riderId }, select: { stripeCustomerId: true, defaultCardPmId: true } })
        if (rider?.stripeCustomerId && rider?.defaultCardPmId) {
          await stripe.paymentIntents.create(
            { amount: wantCents - heldCents, currency: chargeCurrencyForHold(), customer: rider.stripeCustomerId, payment_method: rider.defaultCardPmId, off_session: true, confirm: true, metadata: { rideId: ride.id, kind: 'sr_ride_fare_diff' } },
            { idempotencyKey: `sr-ride-diff-${ride.id}` },
          ).catch((err) => log.warn('sr_ride_diff_charge_failed', { rideId: ride.id, code: err?.code }))
        }
      }
    } catch (err) {
      log.error('sr_ride_capture_failed', { rideId: ride.id, holdId, code: err?.code, message: err?.message })
      return { attempted: true, charged: false, code: err?.code || 'capture_failed' }
    }
    if (intent.status !== 'succeeded') return { attempted: true, charged: false, status: intent.status }
    try {
      await withTx(async (tx) => {
        const dup = await tx.paymentProof.findFirst({ where: { provider: 'stripe', providerRef: intent.id } })
        if (dup) return
        const created = await tx.paymentProof.create({
          data: { rideId: ride.id, userId: ride.riderId, provider: 'stripe', status: 'PENDING_ADMIN_REVIEW', amountMinor, currency: ride.currency || 'USD', providerRef: intent.id, proofAssetUrl: `stripe://payment_intents/${intent.id}` },
        })
        await approvePaymentProof(tx, { proofId: created.id, actorUserId: await firstAdminId(tx), note: 'Auto-approved: SR ride card hold captured at completion.' })
      })
    } catch (err) {
      log.error('sr_ride_capture_settle_failed', { rideId: ride.id, intentId: intent.id, message: err?.message })
      return { attempted: true, charged: true, settled: false }
    }
    return { attempted: true, charged: true, settled: true, captured: true }
  }

  // Already paid (cash/wallet/card) or a prior attempt settled -- never double-charge.
  const existing = await db().paymentProof.findFirst({
    where: { rideId: ride.id, status: { in: ['PENDING_ADMIN_REVIEW', 'APPROVED'] }, NOT: { provider: { startsWith: 'tip' } } },
  })
  if (existing) return { attempted: false, reason: 'already_paid' }

  const rider = await db().user.findUnique({
    where: { id: ride.riderId },
    select: { stripeCustomerId: true, defaultCardPmId: true },
  })
  if (!rider?.defaultCardPmId || !rider?.stripeCustomerId) return { attempted: false, reason: 'no_saved_card' }

  // SR fares are WHOLE USD units (e.g. 4 = $4), so convert to cents for Stripe (x100). Stripe's
  // minimum chargeable amount is $0.50, so floor at 50 cents.
  const chargeCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase()
  const unitAmount = Math.max(50, amountMinor * 100)

  let intent
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: unitAmount,
        currency: chargeCurrency,
        customer: rider.stripeCustomerId,
        payment_method: rider.defaultCardPmId,
        off_session: true,
        confirm: true,
        metadata: { rideId: ride.id, userId: ride.riderId, kind: 'sr_ride_fare' },
      },
      // A deterministic idempotency key so a retry of THIS completion never creates a second charge.
      { idempotencyKey: `sr-ride-fare-${ride.id}` },
    )
  } catch (err) {
    // authentication_required (SCA) or a decline -- fall back to the rider's other rails. No proof,
    // no money moved.
    log.warn('sr_ride_auto_charge_failed', { rideId: ride.id, code: err?.code, declineCode: err?.decline_code })
    return { attempted: true, charged: false, requiresAction: err?.code === 'authentication_required', code: err?.code || 'charge_failed' }
  }

  if (intent.status !== 'succeeded') {
    return { attempted: true, charged: false, requiresAction: intent.status === 'requires_action', status: intent.status }
  }

  try {
    await withTx(async (tx) => {
      const dup = await tx.paymentProof.findFirst({ where: { provider: 'stripe', providerRef: intent.id } })
      if (dup) return
      const created = await tx.paymentProof.create({
        data: {
          rideId: ride.id,
          userId: ride.riderId,
          provider: 'stripe',
          status: 'PENDING_ADMIN_REVIEW',
          amountMinor,
          currency: ride.currency || 'USD',
          providerRef: intent.id,
          proofAssetUrl: `stripe://payment_intents/${intent.id}`,
        },
      })
      await approvePaymentProof(tx, {
        proofId: created.id,
        actorUserId: await firstAdminId(tx),
        note: 'Auto-approved: SR ride fare auto-charged to the saved card (off-session).',
      })
    })
  } catch (err) {
    // The charge DID succeed at Stripe but local settlement failed -- the webhook (payment_intent
    // .succeeded) is the backup that will settle it on redelivery. Logged for reconciliation.
    log.error('sr_ride_auto_charge_settle_failed', { rideId: ride.id, intentId: intent.id, message: err?.message })
    return { attempted: true, charged: true, settled: false }
  }
  return { attempted: true, charged: true, settled: true }
}
