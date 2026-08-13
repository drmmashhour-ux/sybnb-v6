import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

const PASSWORD_PREFIX = 'scrypt:v1'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

function requiredSecret(name) {
  const value = process.env[name]
  if (!value) {
    const error = new Error(`${name} is required for this operation.`)
    error.statusCode = 500
    error.code = 'MISSING_SECRET'
    error.expose = true
    throw error
  }
  return value
}

export function hashPhone(phone) {
  const normalized = String(phone || '').replace(/[^\d+]/g, '')
  if (!normalized) {
    const error = new Error('phone is required.')
    error.statusCode = 400
    error.code = 'PHONE_REQUIRED'
    error.expose = true
    throw error
  }
  return createHmac('sha256', requiredSecret('PHONE_HASH_SECRET')).update(normalized).digest('hex')
}

export function hashPassword(password) {
  if (!password || String(password).length < 8) {
    const error = new Error('password must be at least 8 characters.')
    error.statusCode = 400
    error.code = 'WEAK_PASSWORD'
    error.expose = true
    throw error
  }

  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(String(password), salt, 64).toString('hex')
  return `${PASSWORD_PREFIX}:${salt}:${key}`
}

export function verifyPassword(password, storedHash) {
  const [prefix, version, salt, key] = String(storedHash || '').split(':')
  if (`${prefix}:${version}` !== PASSWORD_PREFIX || !salt || !key) return false

  const candidate = scryptSync(String(password || ''), salt, 64)
  const expected = Buffer.from(key, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function giftClaimCode(gift) {
  const secret = requiredSecret('AUTH_SECRET')
  const digest = createHmac('sha256', secret)
    .update(`${gift.id}:${gift.recipientPhoneHash}`)
    .digest('hex')
  return String(Number.parseInt(digest.slice(0, 8), 16) % 1000000).padStart(6, '0')
}

export function verifyGiftClaimCode(gift, code) {
  const expected = Buffer.from(giftClaimCode(gift))
  const candidate = Buffer.from(String(code || ''))
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function createSessionToken(user) {
  const secret = requiredSecret('AUTH_SECRET')
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = {
    sub: user.id,
    roles: user.roles?.map((role) => role.role) || [],
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifySessionToken(token) {
  const secret = requiredSecret('AUTH_SECRET')
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null

  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function idempotencyKey(parts) {
  return createHash('sha256').update(parts.filter(Boolean).join(':')).digest('hex')
}

// --- OTP (server-side one-time verification codes) ---
// Codes are crypto-random and never stored in plaintext; only an HMAC of the code is persisted.
export function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashOtpCode(identifierHash, purpose, code) {
  return createHmac('sha256', requiredSecret('AUTH_SECRET'))
    .update(`otp:${identifierHash}:${purpose}:${String(code)}`)
    .digest('hex')
}

export function verifyOtpCode(identifierHash, purpose, code, expectedHash) {
  const candidate = Buffer.from(hashOtpCode(identifierHash, purpose, code))
  const expected = Buffer.from(String(expectedHash || ''))
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}
