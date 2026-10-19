// SMS provider adapter. One backend seam so the OTP engine can send codes without knowing the
// provider, and providers can be swapped without touching routes or the frontend.
//
// Selection via env SMS_PROVIDER:
//   'sandbox' (default) — does NOT send anything. Returns a synthetic message id. Never logs the
//                         message body (which contains the OTP). Used for local/dev/staging.
//   'twilio'            — Twilio Messages API. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
//                         TWILIO_FROM (a Twilio number or messaging service SID, MG...).
//   'http'              — POSTs to a generic provider endpoint. Requires SMS_HTTP_ENDPOINT and
//                         SMS_API_KEY; throws SMS_PROVIDER_NOT_CONFIGURED if missing (prepared but
//                         inert until real credentials are supplied — a reserved owner action).
//
// The production SMS provider for Syria must be verified before launch; wiring a new provider is a
// new branch here plus its env, with no frontend change.

function providerName() {
  return (process.env.SMS_PROVIDER || 'sandbox').toLowerCase()
}

export function smsProviderStatus() {
  const provider = providerName()
  if (provider === 'sandbox') return { provider, configured: true, live: false }
  if (provider === 'twilio') {
    return { provider, configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM), live: true }
  }
  if (provider === 'http') {
    return { provider, configured: Boolean(process.env.SMS_HTTP_ENDPOINT && process.env.SMS_API_KEY), live: true }
  }
  return { provider, configured: false, live: true }
}

// sendSms({ to, body, purpose }) -> { provider, messageId, delivered }
export async function sendSms({ to, body, purpose }) {
  const provider = providerName()

  if (provider === 'sandbox') {
    // No real delivery. Do NOT log `body` — it contains the plaintext OTP.
    return { provider: 'sandbox', messageId: `sandbox-${Date.now()}`, delivered: true }
  }

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_FROM
    if (!sid || !token || !from) {
      const error = new Error('SMS provider is not configured for live delivery.')
      error.statusCode = 503
      error.code = 'SMS_PROVIDER_NOT_CONFIGURED'
      error.expose = true
      throw error
    }
    const form = new URLSearchParams({ To: to, Body: body })
    form.set(/^MG/i.test(from) ? 'MessagingServiceSid' : 'From', from)
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
      body: form,
    })
    if (!res.ok) {
      let detail = ''
      try { const e = await res.json(); detail = `twilio ${e.code || ''} ${e.message || ''}`.trim() } catch { /* ignore */ }
      const error = new Error('SMS provider rejected the message.')
      error.statusCode = 502
      error.code = 'SMS_SEND_FAILED'
      error.detail = detail
      error.expose = true
      throw error
    }
    let data = {}
    try { data = await res.json() } catch { /* empty body */ }
    return { provider: 'twilio', messageId: data.sid || `twilio-${Date.now()}`, delivered: true }
  }

  if (provider === 'http') {
    const endpoint = process.env.SMS_HTTP_ENDPOINT
    const apiKey = process.env.SMS_API_KEY
    if (!endpoint || !apiKey) {
      const error = new Error('SMS provider is not configured for live delivery.')
      error.statusCode = 503
      error.code = 'SMS_PROVIDER_NOT_CONFIGURED'
      error.expose = true
      throw error
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ to, body, purpose, sender: process.env.SMS_SENDER_ID || 'SYBNB' }),
    })
    if (!res.ok) {
      const error = new Error('SMS provider rejected the message.')
      error.statusCode = 502
      error.code = 'SMS_SEND_FAILED'
      error.expose = true
      throw error
    }
    let data = {}
    try { data = await res.json() } catch { /* provider may return empty body */ }
    return { provider: 'http', messageId: data.messageId || data.id || `http-${Date.now()}`, delivered: true }
  }

  const error = new Error(`Unknown SMS provider "${provider}".`)
  error.statusCode = 500
  error.code = 'SMS_PROVIDER_UNKNOWN'
  error.expose = true
  throw error
}
