import crypto from 'node:crypto'
import { json, methodNotAllowed } from '../lib/responses.mjs'
import { log } from '../lib/logger.mjs'
import { suppressEmail } from '../lib/email.mjs'
import { isRateLimited, clientIp } from '../lib/rateLimit.mjs'

// Amazon SES -> SNS receiver: POST /api/webhooks/ses.
// SES bounce/complaint events arrive as SNS notifications. We verify the SNS signature before
// trusting anything, confirm the subscription once, and suppress permanent bounces and complaints
// (transient bounces are ignored). Fails closed when SES_SNS_TOPIC_ARN is unset.

const MAX_BODY_BYTES = 64 * 1024
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 240
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/
const certCache = new Map()

function snsUrlOk(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && SNS_HOST.test(u.hostname)
  } catch {
    return false
  }
}

function signingString(msg) {
  const fields = msg.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  let out = ''
  for (const f of fields) {
    if (msg[f] === undefined) continue
    out += `${f}\n${msg[f]}\n`
  }
  return out
}

async function signingCert(url) {
  if (certCache.has(url)) return certCache.get(url)
  const res = await fetch(url, { redirect: 'error' })
  if (!res.ok) throw new Error('signing cert fetch failed')
  const pem = await res.text()
  certCache.set(url, pem)
  return pem
}

async function verifySns(msg) {
  if (!snsUrlOk(msg.SigningCertURL || '')) return false
  const alg = msg.SignatureVersion === '2' ? 'RSA-SHA256' : msg.SignatureVersion === '1' ? 'RSA-SHA1' : null
  if (!alg || !msg.Signature) return false
  const cert = await signingCert(msg.SigningCertURL)
  const verifier = crypto.createVerify(alg)
  verifier.update(signingString(msg), 'utf8')
  return verifier.verify(cert, msg.Signature, 'base64')
}

function bouncedAddresses(event) {
  if (event.notificationType === 'Bounce' && event.bounce?.bounceType === 'Permanent') {
    return (event.bounce.bouncedRecipients || []).map((r) => r.emailAddress)
  }
  if (event.notificationType === 'Complaint') {
    return (event.complaint?.complainedRecipients || []).map((r) => r.emailAddress)
  }
  return []
}

export async function handleSesWebhooks(req, res, url) {
  if (url.pathname !== '/api/webhooks/ses') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const topicArn = process.env.SES_SNS_TOPIC_ARN
  if (!topicArn) {
    return json(res, 503, { ok: false, error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'SES webhook is not configured.' } })
  }
  if (await isRateLimited(`webhook:ses:${clientIp(req)}`, RATE_WINDOW_MS, RATE_MAX)) {
    return json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many webhook requests.' } })
  }

  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      return json(res, 413, { ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Webhook payload too large.' } })
    }
    chunks.push(chunk)
  }

  let msg
  try {
    msg = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return json(res, 400, { ok: false, error: { code: 'BAD_JSON', message: 'Invalid payload.' } })
  }

  let valid = false
  try {
    valid = msg.TopicArn === topicArn && (await verifySns(msg))
  } catch {
    valid = false
  }
  if (!valid) {
    log.warn?.({ event: 'ses_webhook_rejected' })
    return json(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Signature check failed.' } })
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!snsUrlOk(msg.SubscribeURL || '')) return json(res, 400, { ok: false, error: { code: 'BAD_URL', message: 'Bad subscribe URL.' } })
    await fetch(msg.SubscribeURL, { redirect: 'error' })
    log.info?.({ event: 'ses_subscription_confirmed' })
    return json(res, 200, { ok: true })
  }

  if (msg.Type === 'Notification') {
    let event
    try {
      event = JSON.parse(msg.Message)
    } catch {
      return json(res, 200, { ok: true, ignored: true })
    }
    const addresses = bouncedAddresses(event)
    for (const address of addresses) {
      await suppressEmail(address, event.notificationType === 'Complaint' ? 'complaint' : 'bounce')
    }
    log.info?.({ event: 'ses_event', type: event.notificationType, suppressed: addresses.length })
    return json(res, 200, { ok: true, suppressed: addresses.length })
  }

  return json(res, 200, { ok: true, ignored: true })
}
