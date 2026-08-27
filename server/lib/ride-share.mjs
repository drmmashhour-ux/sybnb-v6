import { createHmac, timingSafeEqual } from 'crypto'

// SR Ride vs. Uber gap-closure (P0 #3): a trusted contact opens this link with no account and no
// login -- matches how Uber's own trip-sharing links work. 6 hours is generous enough to cover a
// long ride plus a comfortable buffer, short enough that a link left in an old chat thread doesn't
// stay valid indefinitely.
const RIDE_SHARE_MAX_TTL_SEC = 6 * 60 * 60

function signature(rideId, exp) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is required for ride share links.')
  return createHmac('sha256', secret).update(`ride-share:${rideId}:${exp}`).digest('base64url')
}

export function signRideShareToken(rideId, expiresInSec = RIDE_SHARE_MAX_TTL_SEC) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(expiresInSec, RIDE_SHARE_MAX_TTL_SEC))
  return { exp, sig: signature(rideId, exp) }
}

export function verifyRideShareToken(rideId, exp, sig) {
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(signature(rideId, expNum))
  const candidate = Buffer.from(String(sig || ''))
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}
