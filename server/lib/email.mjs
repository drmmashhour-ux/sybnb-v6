// Email provider adapter. One backend seam so the OTP/notification engine can send email without
// knowing the provider, and providers can be swapped without touching routes or the frontend.
//
// Resend is an EMAIL API (not SMS). Selection via env EMAIL_PROVIDER:
//   'sandbox' (default) — does NOT send anything. Returns a synthetic id. Never logs the email body
//                         (which may contain an OTP). Used for local/dev/staging + governed tests.
//   'ses'               — Amazon SES v2 via SigV4 (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM).
//   'brevo'             — POSTs to https://api.brevo.com/v3/smtp/email. Requires BREVO_API_KEY and
//                         EMAIL_FROM ("Name <addr@domain>" or a bare address).
//   'resend'            — POSTs to https://api.resend.com/emails. Requires RESEND_API_KEY and
//                         EMAIL_FROM; throws EMAIL_PROVIDER_NOT_CONFIGURED if missing (prepared but
//                         inert until real credentials are supplied — a reserved owner action).
//
// The API key is NEVER logged, returned, or committed. The sending domain + SPF/DKIM/DMARC must be
// verified before launch (see docs/launch/RESEND_CERTIFICATION.md).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { db } from './prisma.mjs'

function providerName() {
  return (process.env.EMAIL_PROVIDER || 'sandbox').toLowerCase()
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase()
}

// "SYBNB <no-reply@x.app>" or "no-reply@x.app" -> { name?, email }
export function parseFromAddress(from) {
  const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return m[1].trim() ? { name: m[1].trim(), email: m[2].trim() } : { email: m[2].trim() }
  return { email: String(from || '').trim() }
}

export function emailProviderStatus() {
  const provider = providerName()
  if (provider === 'sandbox') return { provider, configured: true, live: false }
  if (provider === 'resend') {
    // Report configuration WITHOUT exposing the key (boolean only).
    return { provider, configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), live: true }
  }
  if (provider === 'brevo') {
    return { provider, configured: Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_FROM), live: true }
  }
  if (provider === 'ses') {
    // Boolean only: never expose key material.
    return { provider, configured: Boolean(sesConfig()), live: true }
  }
  return { provider, configured: false, live: true }
}


// Amazon SES (API v2) over HTTPS with AWS Signature V4, implemented with node:crypto so no SDK
// dependency is added. Env: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM.
// Credentials are never logged, returned, or included in errors.
function sesConfig() {
  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const from = process.env.EMAIL_FROM
  if (!region || !accessKeyId || !secretAccessKey || !from) return null
  return { region, accessKeyId, secretAccessKey, from }
}

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest()
}

async function sesRequest(cfg, body) {
  const host = `email.${cfg.region}.amazonaws.com`
  const path = '/v2/email/outbound-emails'
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const contentType = 'application/json'
  const payloadHash = sha256Hex(body)
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${cfg.region}/ses/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, cfg.region)
  const kService = hmac(kRegion, 'ses')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-amz-date': amzDate, authorization },
    body,
  })
}

// sendEmail({ to, subject, text, html?, purpose, idempotencyKey? }) -> { provider, messageId, delivered }
export async function sendEmail({ to, subject, text, html, purpose, idempotencyKey }) {
  const provider = providerName()

  const recipients = Array.isArray(to) ? to : [to]
  for (const recipient of recipients) {
    if (await isEmailSuppressed(recipient)) {
      const error = new Error('This address is suppressed after a prior bounce or complaint and will not be emailed.')
      error.statusCode = 422
      error.code = 'EMAIL_SUPPRESSED'
      error.expose = true
      throw error
    }
  }

  if (provider === 'sandbox') {
    // No real delivery. Do NOT log `text`/`html` — they may contain the plaintext OTP.
    return { provider: 'sandbox', messageId: `sandbox-${Date.now()}`, delivered: true }
  }

  if (provider === 'resend') {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM
    if (!apiKey || !from) {
      const error = new Error('Email provider is not configured for live delivery.')
      error.statusCode = 503
      error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED'
      error.expose = true
      throw error
    }
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
    // Resend idempotency: identical (Idempotency-Key + payload) is de-duplicated by the API.
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, text, ...(html ? { html } : {}) }),
    })
    if (!res.ok) {
      // Never include the request headers/body (they carry the key/OTP) in the error.
      // Log only the provider's own status + error name/message (no secrets) so ops can diagnose.
      let detail = ''
      try { const j = await res.json(); detail = `${j?.name || ''}: ${j?.message || ''}`.slice(0, 300) } catch { /* ignore */ }
      console.error(JSON.stringify({ event: 'email_provider_rejected', provider: 'resend', providerStatus: res.status, detail }))
      const error = new Error('Email provider rejected the message.')
      error.statusCode = 502
      error.code = 'EMAIL_SEND_FAILED'
      error.expose = true
      throw error
    }
    let data = {}
    try { data = await res.json() } catch { /* provider may return empty body */ }
    return { provider: 'resend', messageId: data.id || `resend-${Date.now()}`, delivered: true }
  }

  if (provider === 'brevo') {
    const apiKey = process.env.BREVO_API_KEY
    const from = process.env.EMAIL_FROM
    if (!apiKey || !from) {
      const error = new Error('Email provider is not configured for live delivery.')
      error.statusCode = 503
      error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED'
      error.expose = true
      throw error
    }
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: parseFromAddress(from),
        to: recipients.map((email) => ({ email })),
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
      }),
    })
    if (!res.ok) {
      let detail = ''
      try { const j = await res.json(); detail = `${j?.code || ''}: ${j?.message || ''}`.slice(0, 300) } catch { /* ignore */ }
      console.error(JSON.stringify({ event: 'email_provider_rejected', provider: 'brevo', providerStatus: res.status, detail }))
      const error = new Error('Email provider rejected the message.')
      error.statusCode = 502
      error.code = 'EMAIL_SEND_FAILED'
      error.expose = true
      throw error
    }
    let data = {}
    try { data = await res.json() } catch { /* empty body */ }
    return { provider: 'brevo', messageId: data.messageId || `brevo-${Date.now()}`, delivered: true }
  }

  if (provider === 'ses') {
    const cfg = sesConfig()
    if (!cfg) {
      const error = new Error('Email provider is not configured for live delivery.')
      error.statusCode = 503
      error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED'
      error.expose = true
      throw error
    }
    const recipients = Array.isArray(to) ? to : [to]
    const content = { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } }
    if (html) content.Body.Html = { Data: html, Charset: 'UTF-8' }
    const payload = {
      FromEmailAddress: cfg.from,
      Destination: { ToAddresses: recipients },
      Content: { Simple: content },
    }
    // Bounce/complaint events are published to SNS through this configuration set (see ses-webhooks.mjs).
    if (process.env.SES_CONFIGURATION_SET) payload.ConfigurationSetName = process.env.SES_CONFIGURATION_SET
    const body = JSON.stringify(payload)
    const res = await sesRequest(cfg, body)
    if (!res.ok) {
      // Never include the request body (it carries the OTP) or credentials in the error.
      // Log only SES's own error type + message so ops can diagnose (no secrets, no OTP).
      let detail = ''
      try { const j = await res.json(); detail = `${res.headers.get('x-amzn-errortype') || j?.__type || ''}: ${j?.message || j?.Message || ''}`.slice(0, 300) } catch { /* ignore */ }
      console.error(JSON.stringify({ event: 'email_provider_rejected', provider: 'ses', providerStatus: res.status, detail }))
      const error = new Error('Email provider rejected the message.')
      error.statusCode = 502
      error.code = 'EMAIL_SEND_FAILED'
      error.expose = true
      throw error
    }
    let data = {}
    try { data = await res.json() } catch { /* empty body */ }
    return { provider: 'ses', messageId: data.MessageId || `ses-${Date.now()}`, delivered: true }
  }

  const error = new Error(`Unknown email provider "${provider}".`)
  error.statusCode = 500
  error.code = 'EMAIL_PROVIDER_UNKNOWN'
  error.expose = true
  throw error
}

// Verify a Resend (Svix) webhook signature WITHOUT exposing the secret. Resend signs webhooks with a
// secret (whsec_...) over `${id}.${timestamp}.${payload}`; the header carries space-separated
// `v1,<base64sig>` values. Also enforces a TIMESTAMP tolerance (replay window) — a stale/future
// timestamp is rejected even with a valid signature. Returns true only on a constant-time signature
// match AND a fresh timestamp.
export function verifyResendWebhook({ payload, svixId, svixTimestamp, svixSignature, secret, toleranceSec = 300, nowSec }) {
  if (!secret || !svixId || !svixTimestamp || !svixSignature || payload == null) return false
  // Replay window: reject timestamps outside ±tolerance. (nowSec injectable for deterministic tests.)
  const ts = Number(svixTimestamp)
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSec) return false
  const secretBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64')
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64')
  const expectedBuf = Buffer.from(expected)
  return String(svixSignature).split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part
    const sigBuf = Buffer.from(sig || '')
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)
  })
}

// Duplicate-event guard: Resend/Svix may deliver the same event more than once. `seen(id)` returns
// true the FIRST time an event id is presented and false on repeats, so handlers process each once.
// Store is injectable (a Set here; a persistent store in production). Bounded to avoid unbounded growth.
export function createWebhookReplayGuard({ store = new Set(), max = 10000 } = {}) {
  return {
    seen(eventId) {
      if (!eventId) return false
      if (store.has(eventId)) return false
      if (store.size >= max) { const first = store.values().next().value; store.delete(first) }
      store.add(eventId)
      return true
    },
  }
}

// Bounce/complaint suppression: once an address hard-bounces or complains, further delivery attempts
// to it are unsafe (hurts sender reputation) and must be blocked. Persisted in Postgres (not an
// in-process Map) so suppression survives restarts and is shared across every server instance --
// a bounce recorded by the instance that received the Resend webhook must also block sends from
// every other instance. Addresses are normalized (trimmed, lowercased) before storage/lookup.
export async function suppressEmail(address, reason) {
  const email = normalizeAddress(address)
  if (!email) return
  await db().suppressedEmail.upsert({
    where: { email },
    create: { email, reason: reason || 'bounce' },
    update: { reason: reason || 'bounce' },
  })
}

export async function isEmailSuppressed(address) {
  const email = normalizeAddress(address)
  if (!email) return false
  const row = await db().suppressedEmail.findUnique({ where: { email } })
  return Boolean(row)
}
