import nodemailer from 'nodemailer'

const RESEND_API_URL = 'https://api.resend.com/emails'

// EMAIL_PROVIDER picks the transport explicitly; if unset, infer from whichever credential is
// actually present so existing SMTP deployments keep working without touching their config.
const provider = (process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'smtp')).toLowerCase()

const smtpTransporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null

function isResendConfigured() {
  return provider === 'resend' && Boolean(process.env.RESEND_API_KEY)
}

export function isMailerConfigured() {
  return isResendConfigured() || Boolean(smtpTransporter)
}

export function requireMailer() {
  if (!isMailerConfigured()) {
    const error = new Error('Email delivery is not configured on this server yet.')
    error.statusCode = 503
    error.code = 'EMAIL_NOT_CONFIGURED'
    error.expose = true
    throw error
  }
}

function fromAddress() {
  const name = process.env.EMAIL_FROM_NAME || 'SYBNB'
  const address = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'no-reply@sybnb.local'
  return address.includes('<') ? address : `${name} <${address}>`
}

// Single send path shared by both providers -- callers never touch nodemailer/Resend directly,
// so isMailerConfigured()/requireMailer() stay the only two things they need to know about.
async function deliver({ to, subject, text }) {
  requireMailer()
  if (isResendConfigured()) {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        reply_to: process.env.EMAIL_REPLY_TO || undefined,
        subject,
        text,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(body.message || `Resend request failed (${response.status})`)
      error.statusCode = 502
      throw error
    }
    return body
  }
  return smtpTransporter.sendMail({ from: fromAddress(), to, subject, text })
}

// Best-effort — the caller decides what to do on failure (record emailError, never fabricate
// emailSentAt unless this actually resolves).
export async function sendHostInsightEmail(user, insight) {
  const subject = insight.messageEn ? 'SYBNB pricing insight' : 'توصية تسعير من SYBNB'
  const text = [insight.messageAr, insight.messageEn].filter(Boolean).join('\n\n')
  return deliver({ to: user.email, subject, text })
}

// Real email delivery for guest-signup verification codes. Chosen over SMS: no per-message
// carrier cost and no international-SMS-gateway account needed for the Syria market this stage
// targets. Throws EMAIL_NOT_CONFIGURED (503) when neither provider is set up -- the caller
// (email-verification.mjs) still creates and stores the real code either way, and surfaces a
// dev-only fallback so local/QA testing keeps working without a real mailbox.
export async function sendVerificationCodeEmail(email, code) {
  return deliver({
    to: email,
    subject: `SYBNB — رمز التحقق ${code}`,
    text: `رمز التحقق الخاص بك: ${code}\nSYBNB verification code: ${code}\n\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.\nValid for 10 minutes. Do not share this code with anyone.`,
  })
}
