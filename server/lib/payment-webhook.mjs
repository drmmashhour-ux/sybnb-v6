import { createHmac, timingSafeEqual } from 'node:crypto'

// Provider webhook verification + payment state machine. Stripe-compatible signature scheme
// (Stripe-Signature: t=<unix>,v1=<hex hmac of `${t}.${payload}`>), so this verifies real Stripe
// webhooks when a webhook secret is configured — and is fully testable in sandbox with a test
// secret, with NO live keys and NO real money.

const DEFAULT_TOLERANCE_SEC = 300

export function paymentWebhookSecret() {
  // Prefer a dedicated sandbox/test secret; fall back to the Stripe webhook secret.
  return process.env.PAYMENT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || null
}

export function signWebhook(payload, secret, timestamp) {
  const t = timestamp ?? Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  return `t=${t},v1=${v1}`
}

// Verify signature + timestamp tolerance (replay window). Returns the parsed event, or throws a
// governed error. The client can never forge this without the secret.
export function verifyWebhook(payload, sigHeader, secret, now = Math.floor(Date.now() / 1000), toleranceSec = DEFAULT_TOLERANCE_SEC) {
  if (!secret) throw webhookError(503, 'PAYMENT_WEBHOOK_NOT_CONFIGURED', 'Payment webhook secret is not configured.')
  const parts = Object.fromEntries(String(sigHeader || '').split(',').map((kv) => kv.split('=')))
  const t = Number(parts.t)
  const provided = parts.v1
  if (!Number.isFinite(t) || !provided) throw webhookError(400, 'PAYMENT_SIGNATURE_MALFORMED', 'Malformed signature header.')
  if (Math.abs(now - t) > toleranceSec) throw webhookError(400, 'PAYMENT_SIGNATURE_EXPIRED', 'Signature timestamp outside tolerance (possible replay).')
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw webhookError(400, 'PAYMENT_SIGNATURE_INVALID', 'Signature verification failed.')
  let event
  try { event = JSON.parse(payload) } catch { throw webhookError(400, 'PAYMENT_EVENT_INVALID', 'Event body is not valid JSON.') }
  if (!event.id || !event.type) throw webhookError(400, 'PAYMENT_EVENT_INVALID', 'Event is missing id/type.')
  return event
}

function webhookError(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

// Map provider event type -> target intent status.
export function targetStatusFor(type) {
  switch (type) {
    case 'payment_intent.processing': return 'PROCESSING'
    case 'payment_intent.succeeded': return 'SUCCEEDED'
    case 'payment_intent.payment_failed': return 'FAILED'
    case 'payment_intent.canceled': return 'CANCELED'
    case 'charge.refunded': return 'REFUNDED'
    default: return null
  }
}

const TRANSITIONS = {
  REQUIRES_PAYMENT: ['PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'CANCELED'],
  SUCCEEDED: ['REFUNDED'],
  FAILED: [],
  CANCELED: [],
  REFUNDED: [],
}

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to))
}
