import { createTransport } from 'nodemailer'

// Pluggable email sender.
//  - EMAIL_PROVIDER=log (default): writes the code to the server log, sends NO real
//    email. Safe for staging/local.
//  - EMAIL_PROVIDER=smtp: sends via SMTP using SMTP_HOST / SMTP_PORT / SMTP_USER /
//    SMTP_PASS, from EMAIL_FROM (e.g. info@sybnb.app). Set these secrets in the
//    deploy environment to send real mail.

let cachedTransport = null

function smtpTransport() {
  if (cachedTransport) return cachedTransport
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) {
    const error = new Error('SMTP_HOST, SMTP_USER and SMTP_PASS are required for EMAIL_PROVIDER=smtp.')
    error.statusCode = 500
    error.code = 'SMTP_CONFIG_MISSING'
    error.expose = true
    throw error
  }
  cachedTransport = createTransport({
    host,
    port,
    secure: port === 465, // implicit TLS on 465; STARTTLS on 587
    auth: { user, pass },
  })
  return cachedTransport
}

export async function sendEmail({ to, subject, text }) {
  if (!to || !subject || !text) {
    const error = new Error('sendEmail requires to, subject, and text.')
    error.statusCode = 500
    error.code = 'EMAIL_PAYLOAD_INVALID'
    error.expose = false
    throw error
  }

  const provider = (process.env.EMAIL_PROVIDER || 'log').toLowerCase()
  const from = process.env.EMAIL_FROM || 'info@sybnb.app'

  if (provider === 'log') {
    // Staging/local: the code is visible in the server log only, never in the API response.
    console.log(`[email:log] from=${from} to=${to} subject="${subject}"\n${text}`)
    return { provider: 'log', from, delivered: false }
  }

  if (provider === 'smtp') {
    await smtpTransport().sendMail({ from, to, subject, text })
    return { provider: 'smtp', from, delivered: true }
  }

  // Unknown provider: fail loudly rather than silently dropping mail.
  const error = new Error(
    `EMAIL_PROVIDER '${provider}' is not implemented. Use 'log' (staging) or 'smtp'.`,
  )
  error.statusCode = 500
  error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED'
  error.expose = true
  throw error
}
