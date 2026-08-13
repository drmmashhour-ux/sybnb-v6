// SMS provider adapter. One backend seam so the OTP engine can send codes without knowing the
// provider, and providers can be swapped without touching routes or the frontend.
//
// Selection via env SMS_PROVIDER:
//   'sandbox' (default) — does NOT send anything. Returns a synthetic message id. Never logs the
//                         message body (which contains the OTP). Used for local/dev/staging.
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
