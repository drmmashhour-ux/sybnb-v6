import { db } from '../lib/prisma.mjs'
import { hashPhone, generateOtpCode, hashOtpCode, verifyOtpCode } from '../lib/security.mjs'
import { sendSms } from '../lib/sms.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

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

const ipBuckets = new Map()
function ipLimited(req) {
  const ipRaw = req.headers['x-forwarded-for']
  const ip = (Array.isArray(ipRaw) ? ipRaw[0] : ipRaw || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const e = ipBuckets.get(ip)
  if (!e || now - e.start >= IP_WINDOW_MS) { ipBuckets.set(ip, { start: now, count: 1 }); return false }
  e.count += 1
  return e.count > IP_MAX
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

async function currentLock(purpose, subjectHash) {
  return db().otpAttemptLock.findUnique({ where: { purpose_subjectHash: { purpose, subjectHash } } })
}

export async function handleOtp(req, res, url) {
  if (url.pathname === '/api/otp/send') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (ipLimited(req)) throw fail(429, 'RATE_LIMITED', 'Too many verification requests. Please wait a minute.')
    const body = await readJson(req)
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const purpose = String(body.purpose || '')
    const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'sms'
    if (!phone) throw fail(400, 'OTP_PHONE_REQUIRED', 'A phone number is required.')
    if (!ALLOWED_PURPOSES.has(purpose)) throw fail(400, 'OTP_PURPOSE_INVALID', 'Unsupported verification purpose.')

    const identifierHash = hashPhone(phone)

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

    const delivery = await sendSms({ to: phone, body: otpMessage(code), purpose })

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
      maskedPhone: maskPhone(phone),
      expiresAt,
      provider: delivery.provider,
      ...(EXPOSE_CODE ? { devCode: code } : {}),
    })
  }

  if (url.pathname === '/api/otp/verify') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (ipLimited(req)) throw fail(429, 'RATE_LIMITED', 'Too many verification requests. Please wait a minute.')
    const body = await readJson(req)
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const purpose = String(body.purpose || '')
    const code = String(body.code || '').trim()
    if (!phone || !code) throw fail(400, 'OTP_INPUT_REQUIRED', 'Phone and code are required.')
    if (!ALLOWED_PURPOSES.has(purpose)) throw fail(400, 'OTP_PURPOSE_INVALID', 'Unsupported verification purpose.')

    const identifierHash = hashPhone(phone)

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
