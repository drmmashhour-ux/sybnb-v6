import { db } from '../lib/prisma.mjs'
import { hashPhone, hashEmail, generateOtpCode, hashOtpCode, verifyOtpCode } from '../lib/security.mjs'
import { sendSms } from '../lib/sms.mjs'
import { sendEmail } from '../lib/email.mjs'
import { channelEnabled } from '../lib/country.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { isRateLimited, clientIp } from '../lib/rateLimit.mjs'

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const RESEND_INTERVAL_MS = 30 * 1000
const LOCK_MS = 15 * 60 * 1000
const IP_WINDOW_MS = 60 * 1000
const IP_MAX = 30

const ALLOWED_PURPOSES = new Set([
  'guest-login', 'staff-login', 'seller-login', 'host-login',
  'account-verify', 'payment-proof', 'wallet-claim',
])

// The plaintext code is exposed back to the caller ONLY in explicit test mode. In production this
// env is unset, so the code is never returned — it must arrive via SMS.
const EXPOSE_CODE = process.env.OTP_EXPOSE_FOR_TEST === 'true'

async function ipLimited(req) {
  // Bypass only in explicit test mode (OTP_EXPOSE_FOR_TEST, never set in production) so the
  // governed E2E is deterministic; the per-identifier resend throttle + attempt lock remain
  // active and tested in all modes.
  if (EXPOSE_CODE) return false
  return isRateLimited(`otp:${clientIp(req)}`, IP_WINDOW_MS, IP_MAX)
}

function fail(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

function otpMessage(code) {
  return `SYBNB verification code: ${code}. Valid for 10 minutes. Do not share this code with anyone. | رمز التحقق الخاص بك من SYBNB هو ${code}. صالح لمدة 10 دقائق. لا تشاركه مع أحد.`
}

function maskPhone(phone) {
  const p = String(phone).trim()
  return p.length <= 5 ? p : `${p.slice(0, 4)}••••${p.slice(-3)}`
}

function maskEmail(email) {
  const [u, d] = String(email).split('@')
  if (!d) return maskPhone(email)
  const uu = u.length <= 2 ? `${u[0]}•` : `${u.slice(0, 2)}••${u.slice(-1)}`
  return `${uu}@${d}`
}

// Resolve the verification identifier: EMAIL is the primary channel (email-only communications).
// PHONE stays supported/optional (legacy + any documented country requirement). Exactly one is used.
function resolveIdentifier(body) {
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (email) return { kind: 'email', value: email, identifierHash: hashEmail(email), masked: maskEmail(email), channel: 'email' }
  if (phone) return { kind: 'phone', value: phone, identifierHash: hashPhone(phone), masked: maskPhone(phone), channel: 'sms' }
  return null
}

async function deliverCode(id, code, purpose, idempotencyKey) {
  if (id.kind === 'email') {
    return sendEmail({ to: id.value, subject: 'SYBNB verification code', text: otpMessage(code), purpose, idempotencyKey })
  }
  // SMS delivery is reachable ONLY if the active country profile enables it (fail-closed). Under an
  // email-only country (Syria: communications.sms=false) this throws BEFORE sendSms is ever called,
  // so no Syria route can invoke the SMS adapter.
  if (!channelEnabled('sms')) {
    throw fail(400, 'OTP_CHANNEL_NOT_ENABLED', 'SMS verification is not enabled for this country.')
  }
  return sendSms({ to: id.value, body: otpMessage(code), purpose })
}

async function currentLock(purpose, subjectHash) {
  return db().otpAttemptLock.findUnique({ where: { purpose_subjectHash: { purpose, subjectHash } } })
}

export async function handleOtp(req, res, url) {
  if (url.pathname === '/api/otp/send') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (await ipLimited(req)) throw fail(429, 'RATE_LIMITED', 'Too many verification requests. Please wait a minute.')
    const body = await readJson(req)
    const purpose = String(body.purpose || '')
    const id = resolveIdentifier(body)
    if (!id) throw fail(400, 'OTP_IDENTIFIER_REQUIRED', 'An email (or phone) is required.')
    // Email uses the 'email' channel; phone keeps sms/whatsapp selection.
    const channel = id.kind === 'email' ? 'email' : (body.channel === 'whatsapp' ? 'whatsapp' : 'sms')
    if (!ALLOWED_PURPOSES.has(purpose)) throw fail(400, 'OTP_PURPOSE_INVALID', 'Unsupported verification purpose.')

    const identifierHash = id.identifierHash

    const lock = await currentLock(purpose, identifierHash)
    if (lock?.lockedUntil && lock.lockedUntil > new Date()) {
      throw fail(429, 'OTP_LOCKED', 'Verification is temporarily locked after repeated attempts.')
    }

    // Resend throttle: reject if a still-valid PENDING code was issued very recently.
    const recent = await db().verificationCode.findFirst({
      where: { identifierHash, purpose, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })
    if (recent && Date.now() - new Date(recent.createdAt).getTime() < RESEND_INTERVAL_MS) {
      throw fail(429, 'OTP_RESEND_TOO_SOON', 'Please wait before requesting another code.')
    }

    // Only one active code per (identifier, purpose): cancel prior PENDING ones.
    await db().verificationCode.updateMany({
      where: { identifierHash, purpose, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })

    const code = generateOtpCode()
    const codeHash = hashOtpCode(identifierHash, purpose, code)
    const expiresAt = new Date(Date.now() + CODE_TTL_MS)

    // Idempotency key (email provider): identical retried send de-duplicates; a new code differs.
    const idempotencyKey = `otp:${identifierHash}:${purpose}:${codeHash.slice(0, 16)}`
    const delivery = await deliverCode(id, code, purpose, idempotencyKey)

    const record = await db().verificationCode.create({
      data: {
        identifierHash, purpose, codeHash, channel,
        status: 'PENDING', attempts: 0, maxAttempts: MAX_ATTEMPTS, expiresAt,
        sentProvider: delivery.provider, providerMessageId: delivery.messageId,
      },
    })

    return json(res, 201, {
      ok: true,
      sent: true,
      verificationId: record.id,
      channel: id.channel,
      masked: id.masked,
      ...(id.kind === 'phone' ? { maskedPhone: id.masked } : { maskedEmail: id.masked }),
      expiresAt,
      provider: delivery.provider,
      ...(EXPOSE_CODE ? { devCode: code } : {}),
    })
  }

  if (url.pathname === '/api/otp/verify') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (await ipLimited(req)) throw fail(429, 'RATE_LIMITED', 'Too many verification requests. Please wait a minute.')
    const body = await readJson(req)
    const purpose = String(body.purpose || '')
    const code = String(body.code || '').trim()
    const id = resolveIdentifier(body)
    if (!id || !code) throw fail(400, 'OTP_INPUT_REQUIRED', 'Email (or phone) and code are required.')
    if (!ALLOWED_PURPOSES.has(purpose)) throw fail(400, 'OTP_PURPOSE_INVALID', 'Unsupported verification purpose.')

    const identifierHash = id.identifierHash

    const lock = await currentLock(purpose, identifierHash)
    if (lock?.lockedUntil && lock.lockedUntil > new Date()) {
      throw fail(429, 'OTP_LOCKED', 'Verification is temporarily locked after repeated attempts.')
    }

    const record = await db().verificationCode.findFirst({
      where: { identifierHash, purpose, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })
    if (!record) throw fail(404, 'OTP_NOT_FOUND', 'No active verification code. Request a new one.')

    if (new Date(record.expiresAt) <= new Date()) {
      await db().verificationCode.update({ where: { id: record.id }, data: { status: 'EXPIRED' } })
      throw fail(400, 'OTP_EXPIRED', 'This code has expired. Request a new one.')
    }

    const ok = verifyOtpCode(identifierHash, purpose, code, record.codeHash)
    if (!ok) {
      const attempts = record.attempts + 1
      const exhausted = attempts >= record.maxAttempts
      await db().verificationCode.update({
        where: { id: record.id },
        data: { attempts, ...(exhausted ? { status: 'LOCKED' } : {}) },
      })
      // Track cross-code abuse per (purpose, identifier); lock after exhausting attempts.
      await db().otpAttemptLock.upsert({
        where: { purpose_subjectHash: { purpose, subjectHash: identifierHash } },
        create: {
          purpose, subjectHash: identifierHash, attemptCount: 1, lastAttemptAt: new Date(),
          lockedUntil: exhausted ? new Date(Date.now() + LOCK_MS) : null,
        },
        update: {
          attemptCount: { increment: 1 }, lastAttemptAt: new Date(),
          ...(exhausted ? { lockedUntil: new Date(Date.now() + LOCK_MS) } : {}),
        },
      })
      if (exhausted) throw fail(429, 'OTP_LOCKED', 'Too many incorrect attempts. Verification is temporarily locked.')
      throw fail(400, 'OTP_CODE_INVALID', 'Verification code is not correct.')
    }

    // Single-use: only a PENDING row flips to VERIFIED; a replayed verify finds no PENDING row.
    const claimed = await db().verificationCode.updateMany({
      where: { id: record.id, status: 'PENDING' },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    })
    if (claimed.count === 0) throw fail(409, 'OTP_ALREADY_USED', 'This code was already used.')

    // Clear the abuse lock on success.
    await db().otpAttemptLock.updateMany({
      where: { purpose, subjectHash: identifierHash },
      data: { attemptCount: 0, lockedUntil: null },
    })

    return json(res, 200, { ok: true, verified: true, verificationId: record.id, purpose })
  }

  return false
}
