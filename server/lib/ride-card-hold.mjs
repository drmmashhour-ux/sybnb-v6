// Rezekme Payment Standard -- card authorization hold at ride request (Uber model).
// The fare is AUTHORISED (not charged) on the rider's saved card when the ride is requested, so a ride
// is never dispatched without secured money. On completion the hold is CAPTURED for the actual fare
// (ride-auto-charge.mjs); on cancel it is released. SR fares are whole USD units -> x100 for Stripe.
import Stripe from 'stripe'
import { db } from './prisma.mjs'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
const currency = () => (process.env.STRIPE_CURRENCY || 'usd').toLowerCase()
const cents = (minor) => Math.max(50, Math.round(minor) * 100)

function fail(statusCode, code, message, details) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  if (details) error.details = details
  return error
}

export function cardHoldAvailable() {
  if (!stripe) return false
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && process.env.PAYMENTS_ENABLED !== 'true') return false
  return true
}

export async function riderHasSavedCard(riderId) {
  const rider = await db().user.findUnique({ where: { id: riderId }, select: { stripeCustomerId: true, defaultCardPmId: true } })
  return Boolean(rider?.stripeCustomerId && rider?.defaultCardPmId)
}

// Place a manual-capture hold. Throws 402 RIDE_PAYMENT_FAILED if the card cannot cover it.
export async function placeCardHold({ riderId, rideId, amountMinor, key }) {
  if (!cardHoldAvailable()) throw fail(402, 'RIDE_PAYMENT_FAILED', 'Card payments are not available right now.')
  const rider = await db().user.findUnique({ where: { id: riderId }, select: { stripeCustomerId: true, defaultCardPmId: true } })
  if (!rider?.stripeCustomerId || !rider?.defaultCardPmId) throw fail(402, 'RIDE_PREPAY_REQUIRED', 'Add a card or fund your wallet to request this ride.')
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: cents(amountMinor),
        currency: currency(),
        customer: rider.stripeCustomerId,
        payment_method: rider.defaultCardPmId,
        capture_method: 'manual',
        off_session: true,
        confirm: true,
        metadata: { rideId, userId: riderId, kind: 'sr_ride_hold' },
      },
      { idempotencyKey: `sr-ride-hold-${rideId}-${key || amountMinor}` },
    )
    if (intent.status !== 'requires_capture') {
      try { await stripe.paymentIntents.cancel(intent.id) } catch { /* best effort */ }
      throw fail(402, 'RIDE_PAYMENT_FAILED', 'Your card needs verification. Open Payment and re-save your card.')
    }
    return { intentId: intent.id, amountMinor: Math.round(amountMinor) }
  } catch (err) {
    if (err?.expose) throw err
    throw fail(402, 'RIDE_PAYMENT_FAILED', 'Your card was declined. Use another card or fund your wallet.', { stripeCode: err?.code || null })
  }
}

export async function releaseCardHold(intentId) {
  if (!stripe || !intentId) return false
  try {
    await stripe.paymentIntents.cancel(intentId)
    return true
  } catch {
    return false // already captured/cancelled
  }
}

// New hold first, old one released only after the new one succeeds (never leaves the ride unsecured).
export async function replaceCardHold({ riderId, rideId, oldIntentId, newAmountMinor }) {
  const next = await placeCardHold({ riderId, rideId, amountMinor: newAmountMinor, key: `r${Date.now()}` })
  await releaseCardHold(oldIntentId)
  return next
}
