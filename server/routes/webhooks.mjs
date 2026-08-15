import { json, methodNotAllowed } from '../lib/responses.mjs'
import { log } from '../lib/logger.mjs'
import { verifyResendWebhook, createWebhookReplayGuard, createSuppressionList } from '../lib/email.mjs'

// Resend (Svix) webhook receiver: POST /api/webhooks/resend.
// Trust nothing until the signature verifies. Order: size cap -> rate cap -> raw body -> signature +
// timestamp/replay -> duplicate-event guard -> parse -> act (bounce/complaint suppression). The
// signing secret and payload are never logged. Fails closed if RESEND_WEBHOOK_SECRET is unset.
//
// NOTE: the replay guard + suppression store are in-memory (per process). That is correct and tested
// for a single instance; a multi-instance / restart-durable deployment should back these with a shared
// store (documented follow-up). The verifier/suppression COMPONENTS are the already-tested ones.

const MAX_BODY_BYTES = 64 * 1024 // webhook events are small; reject anything larger
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 240
const rateBuckets = new Map()

// Process-lifetime singletons (tested components).
const replayGuard = createWebhookReplayGuard()
const suppression = createSuppressionList()

export function isEmailSuppressed(address) { return suppression.isSuppressed(address) }

function rateLimited(req) {
  const ipRaw = req.headers['x-forwarded-for']
  const ip = (Array.isArray(ipRaw) ? ipRaw[0] : ipRaw || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const e = rateBuckets.get(ip)
  if (!e || now - e.start >= RATE_WINDOW_MS) { rateBuckets.set(ip, { start: now, count: 1 }); return false }
  e.count += 1
  return e.count > RATE_MAX
}

export async function handleWebhooks(req, res, url) {
  if (url.pathname !== '/api/webhooks/resend') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed: never process an unauthenticated webhook.
    return json(res, 503, { ok: false, error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Resend webhook is not configured.' } })
  }

  if (rateLimited(req)) {
    return json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many webhook requests.' } })
  }

  // Read the raw body with a hard size cap (signature must be over the exact bytes).
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      return json(res, 413, { ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Webhook payload too large.' } })
    }
    chunks.push(chunk)
  }
  const payload = Buffer.concat(chunks).toString('utf8')

  const svixId = req.headers['svix-id']
  const svixTimestamp = req.headers['svix-timestamp']
  const svixSignature = req.headers['svix-signature']

  // Signature + timestamp/replay window BEFORE trusting anything.
  const ok = verifyResendWebhook({ payload, svixId, svixTimestamp, svixSignature, secret })
  if (!ok) {
    return json(res, 400, { ok: false, error: { code: 'WEBHOOK_INVALID_SIGNATURE', message: 'Invalid or stale webhook signature.' } })
  }

  // Duplicate-event: Svix may redeliver. Ack repeats as success without reprocessing (idempotent).
  if (!replayGuard.seen(svixId)) {
    return json(res, 200, { ok: true, deduplicated: true })
  }

  let event
  try { event = JSON.parse(payload) } catch {
    return json(res, 400, { ok: false, error: { code: 'WEBHOOK_INVALID_JSON', message: 'Malformed webhook body.' } })
  }

  // Act on delivery-health events. Bounce/complaint → suppress the address (block repeat unsafe sends).
  const type = String(event?.type || '')
  const to = event?.data?.to
  const address = Array.isArray(to) ? to[0] : to
  if ((type === 'email.bounced' || type === 'email.complained') && address) {
    suppression.suppress(address, type === 'email.complained' ? 'complaint' : 'bounce')
  }
  // Log event TYPE + id only — never the secret or full payload.
  log.info('resend_webhook', { type, id: svixId })

  return json(res, 200, { ok: true })
}
