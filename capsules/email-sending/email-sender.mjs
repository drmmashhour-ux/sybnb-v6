// SYBNB capsule: portable email sender (Amazon SES, Resend, or sandbox).
// No framework or database dependency. Copy this folder into any Node 18+ platform.
//
// Usage:
//   import { createEmailSender } from './email-sender.mjs'
//   const mailer = createEmailSender()           // reads process.env
//   await mailer.send({ to, subject, text, html })
//
// Env:
//   EMAIL_PROVIDER   sandbox (default, sends nothing) | ses | resend
//   EMAIL_FROM       verified sender, e.g. no-reply@notifications.example.com
//   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   (ses)
//   RESEND_API_KEY                                          (resend)
// Secrets are never logged or included in errors.

import { createHash, createHmac } from 'node:crypto'

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

function sesConfig(env) {
  const { AWS_REGION: region, AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey, EMAIL_FROM: from } = env
  return region && accessKeyId && secretAccessKey && from ? { region, accessKeyId, secretAccessKey, from } : null
}

// AWS Signature V4 for SES API v2 (POST /v2/email/outbound-emails).
async function sesRequest(cfg, body) {
  const host = `email.${cfg.region}.amazonaws.com`
  const path = '/v2/email/outbound-emails'
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const contentType = 'application/json'
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n')
  const scope = `${dateStamp}/${cfg.region}/ses/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, dateStamp), cfg.region), 'ses'), 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-amz-date': amzDate, authorization },
    body,
  })
}

function fail(code, message, status = 502) {
  const error = new Error(message)
  error.code = code
  error.statusCode = status
  return error
}

// isSuppressed(address) -> Promise<boolean>. Optional hook for bounce/complaint lists.
export function createEmailSender({ env = process.env, isSuppressed = async () => false } = {}) {
  const provider = String(env.EMAIL_PROVIDER || 'sandbox').toLowerCase()

  return {
    provider,
    status() {
      if (provider === 'sandbox') return { provider, configured: true, live: false }
      if (provider === 'ses') return { provider, configured: Boolean(sesConfig(env)), live: true }
      if (provider === 'resend') return { provider, configured: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM), live: true }
      return { provider, configured: false, live: true }
    },

    async send({ to, subject, text, html, idempotencyKey }) {
      const recipients = Array.isArray(to) ? to : [to]
      for (const r of recipients) {
        if (await isSuppressed(String(r).trim().toLowerCase())) throw fail('EMAIL_SUPPRESSED', 'Address is suppressed.', 422)
      }

      if (provider === 'sandbox') {
        // Never log text/html: they may contain one-time codes.
        return { provider, messageId: `sandbox-${Date.now()}`, delivered: true }
      }

      if (provider === 'ses') {
        const cfg = sesConfig(env)
        if (!cfg) throw fail('EMAIL_PROVIDER_NOT_CONFIGURED', 'SES is not configured.', 503)
        const content = { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } }
        if (html) content.Body.Html = { Data: html, Charset: 'UTF-8' }
        const body = JSON.stringify({ FromEmailAddress: cfg.from, Destination: { ToAddresses: recipients }, Content: { Simple: content } })
        const res = await sesRequest(cfg, body)
        if (!res.ok) throw fail('EMAIL_SEND_FAILED', 'Email provider rejected the message.')
        const data = await res.json().catch(() => ({}))
        return { provider, messageId: data.MessageId || `ses-${Date.now()}`, delivered: true }
      }

      if (provider === 'resend') {
        if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw fail('EMAIL_PROVIDER_NOT_CONFIGURED', 'Resend is not configured.', 503)
        const headers = { 'content-type': 'application/json', authorization: `Bearer ${env.RESEND_API_KEY}` }
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers,
          body: JSON.stringify({ from: env.EMAIL_FROM, to: recipients, subject, text, ...(html ? { html } : {}) }),
        })
        if (!res.ok) throw fail('EMAIL_SEND_FAILED', 'Email provider rejected the message.')
        const data = await res.json().catch(() => ({}))
        return { provider, messageId: data.id || `resend-${Date.now()}`, delivered: true }
      }

      throw fail('EMAIL_PROVIDER_UNKNOWN', `Unknown email provider "${provider}".`, 500)
    },
  }
}
