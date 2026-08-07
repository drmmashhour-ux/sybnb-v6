// Pluggable email sender. The default 'log' adapter writes to the server log and
// does NOT send real email — safe for staging. Set EMAIL_PROVIDER (and provider
// credentials) to wire a real provider before production. A verification email is
// low-stakes text; add SMTP/SendGrid/SES here behind the same sendEmail() contract.

export async function sendEmail({ to, subject, text }) {
  if (!to || !subject || !text) {
    const error = new Error('sendEmail requires to, subject, and text.')
    error.statusCode = 500
    error.code = 'EMAIL_PAYLOAD_INVALID'
    error.expose = false
    throw error
  }

  const provider = (process.env.EMAIL_PROVIDER || 'log').toLowerCase()

  if (provider === 'log') {
    // Staging/local: the code is visible in the server log only, never in the API response.
    console.log(`[email:log] to=${to} subject="${subject}"\n${text}`)
    return { provider: 'log', delivered: false }
  }

  // Real providers plug in here (e.g. smtp/sendgrid/ses). Intentionally unimplemented
  // so a misconfigured production deploy fails loudly instead of silently dropping mail.
  const error = new Error(
    `EMAIL_PROVIDER '${provider}' is not implemented. Add an adapter in server/lib/email.mjs or use 'log' for staging.`,
  )
  error.statusCode = 500
  error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED'
  error.expose = true
  throw error
}
