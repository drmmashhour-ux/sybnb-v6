import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { db } from './prisma.mjs'

// Email OTP engine. Codes are 6 digits, hashed with an HMAC keyed by AUTH_SECRET
// (so a database leak alone cannot brute-force them offline), single-use, and
// expiring. Abuse is bounded per-email by OtpAttemptLock (verify lockout) plus a
// resend cooldown + per-window cap. The plaintext code is never returned by the
// API or logged in plaintext except by the staging 'log' email adapter.

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_VERIFY_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000
const RESEND_COOLDOWN_MS = 30 * 1000
const MAX_ACTIVE_SENDS = 5 // sends allowed within one TTL window per email+purpose

export const OTP_PURPOSES = new Set(['LOGIN', 'EMAIL_VERIFICATION'])

function authSecret() {
  const value = process.env.AUTH_SECRET
  if (!value) {
    const error = new Error('AUTH_SECRET is required for OTP operations.')
    error.statusCode = 500
    error.code = 'MISSING_SECRET'
    error.expose = true
    throw error
  }
  return value
}

export function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    const error = new Error('A valid email is required.')
    error.statusCode = 400
    error.code = 'EMAIL_INVALID'
    error.expose = true
    throw error
  }
  return normalized
}

export function normalizePurpose(purpose) {
  const value = String(purpose || 'EMAIL_VERIFICATION').toUpperCase()
  if (!OTP_PURPOSES.has(value)) {
    const error = new Error('Unsupported OTP purpose.')
    error.statusCode = 400
    error.code = 'OTP_PURPOSE_INVALID'
    error.expose = true
    throw error
  }
  return value
}

function subjectHash(email) {
  return createHmac('sha256', authSecret()).update(`otp-subject:${email}`).digest('hex')
}

function hashCode(email, purpose, code) {
  return createHmac('sha256', authSecret()).update(`${email}:${purpose}:${code}`).digest('hex')
}

function equalHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8')
  const bufB = Buffer.from(String(b), 'utf8')
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

function lockedError() {
  const error = new Error('Too many attempts. Please wait and try again.')
  error.statusCode = 429
  error.code = 'OTP_LOCKED'
  error.expose = true
  return error
}

async function readLock(purpose, hash) {
  return db().otpAttemptLock.findUnique({
    where: { purpose_subjectHash: { purpose, subjectHash: hash } },
  })
}

async function assertNotLocked(purpose, hash, now) {
  const lock = await readLock(purpose, hash)
  if (lock?.lockedUntil && lock.lockedUntil.getTime() > now.getTime()) throw lockedError()
  return lock
}

// Requests (or resends) a code. Anti-enumeration: always resolves the same shape
// whether or not the address is registered; delivery just no-ops for LOGIN when the
// user does not exist. Returns { expiresAt } — never the code.
export async function requestEmailOtp({ email, purpose, sendEmail }) {
  const normalized = normalizeEmail(email)
  const kind = normalizePurpose(purpose)
  const now = new Date()
  const hash = subjectHash(normalized)

  await assertNotLocked(kind, hash, now)

  const windowStart = new Date(now.getTime() - CODE_TTL_MS)
  const recent = await db().emailOtpCode.findMany({
    where: { emailNormalized: normalized, purpose: kind, createdAt: { gte: windowStart } },
    orderBy: { createdAt: 'desc' },
  })
  if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const error = new Error('Please wait before requesting another code.')
    error.statusCode = 429
    error.code = 'OTP_RESEND_COOLDOWN'
    error.expose = true
    throw error
  }
  if (recent.length >= MAX_ACTIVE_SENDS) {
    const error = new Error('Too many codes requested. Please wait and try again.')
    error.statusCode = 429
    error.code = 'OTP_RESEND_LIMIT'
    error.expose = true
    throw error
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS)

  // Invalidate prior unconsumed codes so only the newest is valid, then store the new one.
  await db().$transaction([
    db().emailOtpCode.updateMany({
      where: { emailNormalized: normalized, purpose: kind, consumedAt: null },
      data: { consumedAt: now },
    }),
    db().emailOtpCode.create({
      data: {
        emailNormalized: normalized,
        purpose: kind,
        codeHash: hashCode(normalized, kind, code),
        expiresAt,
      },
    }),
  ])

  const deliver = sendEmail
  if (deliver) {
    await deliver({
      to: normalized,
      subject: 'Your SYBNB verification code',
      text: `Your SYBNB verification code is ${code}. It is valid for 10 minutes. Do not share this code with anyone.`,
    })
  }

  return { expiresAt, resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS) }
}

async function registerFailedAttempt(purpose, hash, now) {
  const lock = await db().otpAttemptLock.upsert({
    where: { purpose_subjectHash: { purpose, subjectHash: hash } },
    create: { purpose, subjectHash: hash, attemptCount: 1, lastAttemptAt: now },
    update: { attemptCount: { increment: 1 }, lastAttemptAt: now },
  })
  if (lock.attemptCount >= MAX_VERIFY_ATTEMPTS) {
    await db().otpAttemptLock.update({
      where: { purpose_subjectHash: { purpose, subjectHash: hash } },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS), attemptCount: 0 },
    })
  }
}

async function clearLock(purpose, hash) {
  await db().otpAttemptLock.updateMany({
    where: { purpose, subjectHash: hash },
    data: { attemptCount: 0, lockedUntil: null },
  })
}

// Verifies a code. On success marks it consumed and clears the lock. Throws 400 on
// an invalid/expired code (recording a failed attempt) and 429 when locked out.
export async function verifyEmailOtp({ email, purpose, code }) {
  const normalized = normalizeEmail(email)
  const kind = normalizePurpose(purpose)
  const now = new Date()
  const hash = subjectHash(normalized)

  await assertNotLocked(kind, hash, now)

  const candidate = await db().emailOtpCode.findFirst({
    where: {
      emailNormalized: normalized,
      purpose: kind,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  })

  const suppliedHash = /^\d{6}$/.test(String(code || ''))
    ? hashCode(normalized, kind, String(code))
    : null

  if (!candidate || !suppliedHash || !equalHex(candidate.codeHash, suppliedHash)) {
    await registerFailedAttempt(kind, hash, now)
    const error = new Error('Invalid or expired code.')
    error.statusCode = 400
    error.code = 'OTP_INVALID'
    error.expose = true
    throw error
  }

  await db().emailOtpCode.update({ where: { id: candidate.id }, data: { consumedAt: now } })
  await clearLock(kind, hash)
  return { verified: true, email: normalized, purpose: kind }
}
