// SYBNB — host verification (activation code) policy. Owner decision of 2026-10-08:
// like Booking.com's partner PIN, a host is verified by the SYBNB team before their stays are
// publicly visible or bookable. An admin issues a random 6-digit code (shown once, optionally
// emailed); the host types it into their dashboard; a match marks users.host_verified_at.
//
// PURE module: no database, no clock of its own, no secrets. Everything time-dependent takes `now`,
// everything random takes an injectable source, so it is unit-tested in
// tests/unit/host-verification.test.mjs. The routes (server/routes/host-verification.mjs) own I/O,
// hashing (same HMAC as OTP codes) and transactions.

import { randomInt } from 'node:crypto'

export const HOST_ACTIVATION_PURPOSE = 'host-activation'
// Wrong guesses allowed per code. The 5th wrong guess locks the code; only a re-issue unlocks.
// 5 guesses against a 10^6 space = a 0.0005% chance per issued code.
export const HOST_ACTIVATION_MAX_ATTEMPTS = 5
export const HOST_ACTIVATION_DEFAULT_TTL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

// Divisions whose public visibility/bookability depends on the OWNER's host verification. Stays are
// the hosted, bookable product the owner's decision is about; seller divisions (cars, marketplace,
// buy, rentals, new construction) keep their own paid-plan + admin-approval gate and are untouched.
export const HOST_VERIFIED_DIVISIONS = Object.freeze(['STAYS'])

export function requiresHostVerification(division) {
  return HOST_VERIFIED_DIVISIONS.includes(String(division || '').toUpperCase())
}

// A uniformly random 6-digit code ('000000'..'999999'), leading zeros kept.
export function generateActivationCode(random = randomInt) {
  const n = random(0, 1_000_000)
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) throw new Error('activation code source out of range')
  return String(n).padStart(6, '0')
}

// Accept what a person actually types: spaces/dashes ("123 456", "123-456") and Arabic-Indic or
// Persian digits. Returns the canonical 6 ASCII digits, or null when it cannot be a code.
export function normalizeActivationCode(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null
  const ascii = String(input)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-–—_.]/g, '')
  return /^\d{6}$/.test(ascii) ? ascii : null
}

// HOST_ACTIVATION_CODE_TTL_DAYS (optional) -- an integer 1..30, default 7. Anything else falls back
// to the default rather than producing a never-expiring or already-expired code.
export function activationCodeTtlDays(env = process.env) {
  const raw = Number(env?.HOST_ACTIVATION_CODE_TTL_DAYS)
  return Number.isInteger(raw) && raw >= 1 && raw <= 30 ? raw : HOST_ACTIVATION_DEFAULT_TTL_DAYS
}

export function activationCodeExpiresAt(now = new Date(), env = process.env) {
  return new Date(new Date(now).getTime() + activationCodeTtlDays(env) * DAY_MS)
}

// State of one code row { usedAt, expiresAt, attempts } at `now`.
//   USED    -- already redeemed
//   EXPIRED -- past expires_at (also how a superseded code is retired: its expires_at is set to the
//              re-issue time)
//   LOCKED  -- attempts exhausted
//   ACTIVE  -- may be tried
export function activationCodeState(code, now = new Date(), maxAttempts = HOST_ACTIVATION_MAX_ATTEMPTS) {
  if (!code) return 'NONE'
  if (code.usedAt) return 'USED'
  if (new Date(code.expiresAt).getTime() <= new Date(now).getTime()) return 'EXPIRED'
  if ((Number(code.attempts) || 0) >= maxAttempts) return 'LOCKED'
  return 'ACTIVE'
}

// Decision after a guess. `attemptsAfter` is the attempt counter INCLUDING this guess (the route
// reserves the attempt atomically before comparing, so concurrent guesses can never exceed the cap).
export function activationAttemptOutcome({ matched, attemptsAfter, maxAttempts = HOST_ACTIVATION_MAX_ATTEMPTS }) {
  if (matched) return { result: 'VERIFIED', attemptsRemaining: Math.max(0, maxAttempts - attemptsAfter) }
  const remaining = Math.max(0, maxAttempts - attemptsAfter)
  return remaining === 0 ? { result: 'LOCKED', attemptsRemaining: 0 } : { result: 'INVALID', attemptsRemaining: remaining }
}

// GET /api/admin/hosts?status=... -> Prisma `where` on users. Unknown values are rejected by the
// caller (null here) so a typo is a 400, not silently "all".
export function hostListStatusWhere(status) {
  const s = String(status || 'all').toLowerCase()
  if (s === 'unverified') return { hostVerifiedAt: null }
  if (s === 'verified') return { hostVerifiedAt: { not: null } }
  if (s === 'all') return {}
  return null
}

// Prisma `where` fragment that hides stays whose owner is not verified. Combined with the existing
// status/division filters. With a known division it is either nothing or a single to-one relation
// filter on the owner (an indexed users primary-key probe per candidate row); without a division
// it keeps every non-gated division as is.
export function publicListingVisibilityWhere(division) {
  const verifiedOwner = { owner: { hostVerifiedAt: { not: null } } }
  if (division) return requiresHostVerification(division) ? verifiedOwner : {}
  return { OR: [{ division: { notIn: [...HOST_VERIFIED_DIVISIONS] } }, verifiedOwner] }
}

// Same rule on an already-loaded listing + owner.
export function isListingPubliclyVisible(listing, owner) {
  if (!listing || listing.status !== 'APPROVED') return false
  if (!requiresHostVerification(listing.division)) return true
  return Boolean(owner?.hostVerifiedAt)
}

// ---- Host onboarding tracker (owner decision of 2026-10-09) ----------------------------------------
// Order for a NEW host: ① add a listing -> ② review (automatic AI check + SYBNB team) -> ③ activation
// code by email (issued automatically when the team approves the stay) -> ④ listing live for guests.
// Pure: computes where an account is from counts the route already has.
//   counts: listing counts by status { total, draft, pending, approved, rejected } (any division the
//           host owns; only stays need the code, but a host's first listing is the trigger either way)
//   verification: { verified, hasPendingCode, codeLocked }
// Returns { step: 1..4, needsFixes, codeExpectedSoon }.
//   step 4  verified (the dashboard hides the tracker)
//   step 3  a code is out (or locked), or a stay is already approved and only the code is missing
//   step 2  something is waiting for review, or was sent back for fixes (needsFixes)
//   step 1  nothing submitted yet (no listing, or drafts only)
export function hostOnboardingProgress(counts = {}, verification = {}) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)
  const pending = n(counts.pending)
  const approved = n(counts.approved)
  const rejected = n(counts.rejected)
  if (verification.verified) return { step: 4, needsFixes: false, codeExpectedSoon: false }
  if (verification.hasPendingCode || verification.codeLocked || approved > 0) {
    return { step: 3, needsFixes: false, codeExpectedSoon: !verification.hasPendingCode && !verification.codeLocked }
  }
  if (pending > 0) return { step: 2, needsFixes: false, codeExpectedSoon: false }
  if (rejected > 0) return { step: 2, needsFixes: true, codeExpectedSoon: false }
  return { step: 1, needsFixes: false, codeExpectedSoon: false }
}
