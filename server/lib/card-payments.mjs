// Card payments (Stripe) on/off switch for this server.
//
// CARD_PAYMENTS=off hides card payment in the apps (GET /api/payments/stripe/status reports
// cardEnabled: false) and refuses to START any new card payment: no new Checkout session, no new
// saved card, no off-session charge or card hold. Finishing payments that already started
// (confirm, webhook, refunds) keeps working, so nobody is left with a paid but unrecorded booking.
// Any other value, or unset, leaves card payments as they were (still subject to PAYMENTS_ENABLED
// for live keys and the payment policy).
export function cardPaymentsOff() {
  return String(process.env.CARD_PAYMENTS || '').trim().toLowerCase() === 'off'
}

export function requireCardPaymentsOn() {
  if (!cardPaymentsOff()) return
  const error = new Error('Card payment is not available. Please pay with Sham Cash, your wallet or bank transfer.')
  error.statusCode = 503
  error.code = 'CARD_PAYMENTS_OFF'
  error.expose = true
  throw error
}
