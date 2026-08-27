import { json, methodNotAllowed } from '../lib/responses.mjs'
import { log } from '../lib/logger.mjs'
import { verifyResendWebhook, createWebhookReplayGuard, suppressEmail } from '../lib/email.mjs'
import { isRateLimited, clientIp } from '../lib/rateLimit.mjs'

// Resend (Svix) webhook receiver: POST /api/webhooks/resend.
// Trust nothing until the signature verifies. Order: size cap -> rate cap -> raw body -> signature +
// timestamp/replay -> duplicate-event guard -> parse -> act (bounce/complaint suppression). The
// signing secret and payload are never logged. Fails closed if RESEND_WEBHOOK_SECRET is unset.
// The rate cap is Postgres-backed (rateLimit.mjs) so it holds across multiple server instances.
//
// NOTE: the replay guard is in-memory (per process) -- correct and tested for a single instance; a
// multi-instance / restart-durable deployment should back it with a shared store (documented
// follow-up). The suppression list itself is Postgres-backed (see suppressEmail in lib/email.mjs) so
// it survives restarts and is shared across instances -- it is consulted by sendEmail() on every send.

const MAX_BODY_BYTES = 64 * 1024 // webhook events are small; reject anything larger
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 240

// Process-lifetime singleton (tested component).
const replayGuard = createWebhookReplayGuard()

function rateLimited(req) {
  return isRateLimited(`webhook:resend:${clientIp(req)}`, RATE_WINDOW_MS, RATE_MAX)
}

export async function handleWebhooks(req, res, url) {
  if (url.pathname !== '/api/webhooks/resend') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed: never process an unauthenticated webhook.
    return json(res, 503, { ok: false, error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Resend webhook is not configured.' } })
  }

  if (await rateLimited(req)) {
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
    await suppressEmail(address, type === 'email.complained' ? 'complaint' : 'bounce')
  }
  // Log event TYPE + id only — never the secret or full payload.
  log.info('resend_webhook', { type, id: svixId })

  return json(res, 200, { ok: true })
}
