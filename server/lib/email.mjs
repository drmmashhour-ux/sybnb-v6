// Email provider adapter. One backend seam so the OTP/notification engine can send email without
// knowing the provider, and providers can be swapped without touching routes or the frontend.
//
// Resend is an EMAIL API (not SMS). Selection via env EMAIL_PROVIDER:
//   'sandbox' (default) — does NOT send anything. Returns a synthetic id. Never logs the email body
//                         (which may contain an OTP). Used for local/dev/staging + governed tests.
//   'resend'            — POSTs to https://api.resend.com/emails. Requires RESEND_API_KEY and
//                         EMAIL_FROM; throws EMAIL_PROVIDER_NOT_CONFIGURED if missing (prepared but
//                         inert until real credentials are supplied — a reserved owner action).
//
// The API key is NEVER logged, returned, or committed. The sending domain + SPF/DKIM/DMARC must be
// verified before launch (see docs/launch/RESEND_CERTIFICATION.md).

import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from './prisma.mjs'

function providerName() {
  return (process.env.EMAIL_PROVIDER || 'sandbox').toLowerCase()
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase()
}

export function emailProviderStatus() {
  const provider = providerName()
  if (provider === 'sandbox') return { provider, configured: true, live: false }
  if (provider === 'resend') {
    // Report configuration WITHOUT exposing the key (boolean only).
    return { provider, configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), live: true }
  }
  return { provider, configured: false, live: true }
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
