import { db } from './prisma.mjs'
import { generateEmailVerificationCode, hashEmailVerificationCode, verifyEmailVerificationCodeHash } from './security.mjs'
import { isMailerConfigured, sendVerificationCodeEmail } from './mailer.mjs'

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
// A successful verify() must be recent to count toward register() -- otherwise a code verified
// once, long ago, for a since-abandoned signup attempt would stay valid forever.
const CONSUMED_TRUST_WINDOW_MINUTES = 30

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// Creates and stores a real, random, hashed code, then attempts real delivery. Always returns the
// stored-row truth (`emailSent`) rather than assuming success -- the caller must not claim the
// email was sent unless sendVerificationCodeEmail actually resolved. In non-production, also
// returns the raw code so local/QA testing works without a real mailbox (SMTP is rarely configured
// in dev) -- this is never included when NODE_ENV === 'production'.
export async function sendEmailVerificationCode(email, purpose = 'guest-signup') {
  const normalized = normalizeEmail(email)
  if (!normalized) {
    const error = new Error('email is required.')
    error.statusCode = 400
    error.code = 'EMAIL_REQUIRED'
    error.expose = true
    throw error
  }

  const code = generateEmailVerificationCode()
  const codeHash = hashEmailVerificationCode(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)

  await db().emailVerificationCode.create({
    data: { email: normalized, codeHash, purpose, expiresAt },
  })

  const isProduction = process.env.NODE_ENV === 'production'
  let emailSent = false
  let emailError
  // Outside production the code is returned directly as `devCode` below, so there is nothing a
  // real email would add -- skip sending even if SMTP happens to be configured, to avoid burning
  // real email sends during dev/staging testing.
  if (isProduction && isMailerConfigured()) {
    try {
      await sendVerificationCodeEmail(normalized, code)
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Unknown email error'
    }
  }

  const devCode = isProduction ? undefined : code
  return { ok: true, emailSent, emailError, devCode }
}

// Verifies + immediately consumes (single-use) the most recent, non-expired, non-consumed code
// for this email+purpose. Fails closed: wrong code, expired code, already-consumed code, or too
// many attempts on the same row all deny.
export async function consumeEmailVerificationCode(email, code, purpose = 'guest-signup') {
  const normalized = normalizeEmail(email)
  const candidate = await db().emailVerificationCode.findFirst({
    where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!candidate || candidate.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  const matches = verifyEmailVerificationCodeHash(code, candidate.codeHash)
  if (!matches) {
    await db().emailVerificationCode.update({
      where: { id: candidate.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  await db().emailVerificationCode.update({
    where: { id: candidate.id },
    data: { consumedAt: new Date() },
  })
  return { ok: true }
}

// Server-side proof, at register() time, that this exact email really was verified recently --
// never trusts a client-supplied "I verified it" boolean.
export async function hasRecentlyVerifiedEmail(email, purpose = 'guest-signup') {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  const since = new Date(Date.now() - CONSUMED_TRUST_WINDOW_MINUTES * 60 * 1000)
  const verified = await db().emailVerificationCode.findFirst({
    where: { email: normalized, purpose, consumedAt: { gt: since } },
    orderBy: { consumedAt: 'desc' },
  })
  return Boolean(verified)
}
