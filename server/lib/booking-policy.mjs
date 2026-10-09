// SYBNB — pure booking money policy (owner decisions of 2026-10-08, see MONEY_SPEC decisions 3-6).
//
// PURE MODULE: no Prisma, no I/O, no process.env reads except through the explicit `env` argument of
// resolveBookingPolicy(). Every money figure a guest is quoted, charged, refunded, or that the ledger
// splits on cancellation is computed here, so the quote endpoint, booking creation, payment rails,
// cancel-quote, cancel, and admin finalize all read ONE implementation (tests/unit/
// booking-policy.test.mjs pins it down without a database).
//
// All amounts are integer MINOR units. Every split function returns parts that sum exactly to the
// whole they split (no money created or lost to rounding): the remainder of any rounded share is
// always assigned to the complementary share by subtraction, never rounded twice.
//
// Country-neutral: the check-in timezone, the 72h full-refund cutoff and the 48h unpaid-expiry
// window are NOT hardcoded here -- they come from the active country profile's `bookingPolicy`
// block (countries/<country>/profile.mjs, read via server/lib/country.mjs) and can be overridden by
// env (BOOKING_FULL_REFUND_CUTOFF_HOURS, BOOKING_UNPAID_EXPIRY_HOURS). The neutral defaults below
// (UTC, 72h, 48h) apply only when a profile defines nothing.

// Contractual STR (STAYS) platform commission -- owner-confirmed 12% of the WHOLE amount paid
// excluding the protection fee (rent + cleaning + taxes + other fees). Unchanged from before.
export const STR_COMMISSION_RATE = 0.12
// SR Ride platform commission -- owner decision 2026-10-09: match Uber's standard driver service
// fee of 25% (riders pay the full fare; the driver keeps 75%). Applies to the ride fare only; a
// cancellation fee stays 100% with the driver (it compensates the driver for a committed trip).
// Overridable via env (SR_RIDE_COMMISSION_RATE, a 0..1 fraction) for operational tuning without a
// code change -- e.g. a lower launch rate to help driver acquisition.
export const SR_RIDE_COMMISSION_RATE = (() => {
  const raw = Number(process.env.SR_RIDE_COMMISSION_RATE)
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : 0.25
})()
// Cancellation protection add-on: 3% of the FULL stay amount (all nights, before cleaning/taxes).
export const PROTECTION_RATE = 0.03
// Fallback fee percentages for a STAYS listing with no explicit itemized fee set (pre-existing).
export const STR_CLEANING_RATE = 0.05
export const STR_TAX_RATE = 0.02

export const DEFAULT_BOOKING_POLICY = Object.freeze({
  timezoneOffsetMinutes: 0,
  fullRefundCutoffHours: 72,
  unpaidExpiryHours: 48,
})

const HOUR_MS = 60 * 60 * 1000

function positiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function finiteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// profilePolicy: the active country profile's `bookingPolicy` object (may be undefined).
export function resolveBookingPolicy(profilePolicy = {}, env = {}) {
  const base = { ...DEFAULT_BOOKING_POLICY }
  const tz = finiteNumber(profilePolicy?.timezoneOffsetMinutes)
  if (tz !== null) base.timezoneOffsetMinutes = tz
  const cutoff = positiveNumber(profilePolicy?.fullRefundCutoffHours)
  if (cutoff !== null) base.fullRefundCutoffHours = cutoff
  const expiry = positiveNumber(profilePolicy?.unpaidExpiryHours)
  if (expiry !== null) base.unpaidExpiryHours = expiry
  const envCutoff = positiveNumber(env?.BOOKING_FULL_REFUND_CUTOFF_HOURS)
  if (envCutoff !== null) base.fullRefundCutoffHours = envCutoff
  const envExpiry = positiveNumber(env?.BOOKING_UNPAID_EXPIRY_HOURS)
  if (envExpiry !== null) base.unpaidExpiryHours = envExpiry
  return base
}

function toMinor(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

export function protectionFeeMinor(stayMinor) {
  return Math.round(toMinor(stayMinor) * PROTECTION_RATE)
}

// Splits an amount that the platform keeps into commission + host share. commission is rounded,
// host share is the exact remainder, so commission + hostShare === amount always.
export function splitCommission(amountMinor, { isShortStay = true } = {}) {
  const amount = toMinor(amountMinor)
  const commissionMinor = isShortStay ? Math.round(amount * STR_COMMISSION_RATE) : 0
  return { commissionMinor, hostShareMinor: amount - commissionMinor }
}

// The full guest total for a booking -- the single formula behind both the public quote endpoint and
// finance-ledger.mjs's expectedTotalMinor() (what every payment rail charges). Mirrors the
// pre-existing expectedTotalMinor() arithmetic exactly (including its `explicit || fallback`
// quirk: an explicit fee of 0 falls back to the percentage default, unchanged on purpose).
//   fees: { cleaningFeeMinor, taxesMinor, serviceFeeMinor, parkingFeeMinor } (listing or snapshot)
//   protectionFeeOverrideMinor: a fee already snapshotted on the booking (wins when > 0)
export function computeGuestTotals({
  stayMinor,
  fees = {},
  extraFeesMinor = 0,
  isShortStay = true,
  protection = false,
  protectionFeeOverrideMinor = 0,
}) {
  const stay = toMinor(stayMinor)
  const cleaningMinor = toMinor(fees.cleaningFeeMinor) || (isShortStay ? Math.round(stay * STR_CLEANING_RATE) : 0)
  const taxesMinor = toMinor(fees.taxesMinor) || (isShortStay ? Math.round(stay * STR_TAX_RATE) : 0)
  const otherFeesMinor = toMinor(fees.serviceFeeMinor) + toMinor(fees.parkingFeeMinor) + toMinor(extraFeesMinor)
  const protectionMinor = protection ? (toMinor(protectionFeeOverrideMinor) || protectionFeeMinor(stay)) : 0
  const totalMinor = stay + cleaningMinor + taxesMinor + otherFeesMinor + protectionMinor
  const { commissionMinor, hostShareMinor } = splitCommission(totalMinor - protectionMinor, { isShortStay })
  return {
    stayMinor: stay,
    cleaningMinor,
    taxesMinor,
    otherFeesMinor,
    protectionMinor,
    totalMinor,
    commissionMinor,
    hostShareMinor,
  }
}

// 00:00 local time (per the policy's fixed UTC offset) on the calendar day of check-in, as epoch ms.
// Booking dates are calendar dates carried on a UTC Date (see server/lib/pricing.mjs), so the
// calendar day is read from the UTC components.
export function checkInStartMs(checkIn, policy = DEFAULT_BOOKING_POLICY) {
  if (!checkIn) return null
  const d = new Date(checkIn)
  if (Number.isNaN(d.getTime())) return null
  const midnightUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return midnightUtc - Number(policy.timezoneOffsetMinutes || 0) * 60 * 1000
}

// Who cancels + the payment facts -> which rule applies and how much goes back.
//   paidMinor: the amount actually paid (the approved proof's amount); 0/absent = unpaid.
//   protectionPurchased / protectionMinor: the booking's protection add-on (part of paidMinor).
//   cancelledBy: 'GUEST' | 'HOST'
// Returns { rule, refundMinor, retainedMinor, retainedProtectionMinor, retainedStayMinor,
//           retainedCommissionMinor, retainedHostShareMinor, deadline (ISO|null) }
// with refundMinor + retainedMinor === paidMinor, and
//      retainedProtectionMinor + retainedCommissionMinor + retainedHostShareMinor === retainedMinor.
export function computeCancellation({
  paidMinor,
  protectionPurchased = false,
  protectionMinor = 0,
  checkIn,
  now = new Date(),
  cancelledBy = 'GUEST',
  isShortStay = true,
  policy = DEFAULT_BOOKING_POLICY,
}) {
  const paid = toMinor(paidMinor)
  const protection = protectionPurchased ? Math.min(toMinor(protectionMinor), paid) : 0
  const startMs = checkInStartMs(checkIn, policy)
  const nowMs = new Date(now).getTime()
  // The deadline a guest must beat for the better rule: check-in 00:00 minus the cutoff for a
  // regular price; check-in 00:00 itself for a protected price.
  const deadlineMs = startMs === null
    ? null
    : protectionPurchased
      ? startMs
      : startMs - Number(policy.fullRefundCutoffHours) * HOUR_MS
  const deadline = deadlineMs === null ? null : new Date(deadlineMs).toISOString()

  const result = (rule, refundMinor, retainedProtectionMinor) => {
    const refund = Math.min(paid, Math.max(0, refundMinor))
    const retained = paid - refund
    const keptProtection = Math.min(retained, retainedProtectionMinor)
    const retainedStayMinor = retained - keptProtection
    const { commissionMinor, hostShareMinor } = splitCommission(retainedStayMinor, { isShortStay })
    return {
      rule,
      refundMinor: refund,
      retainedMinor: retained,
      retainedProtectionMinor: keptProtection,
      retainedStayMinor,
      retainedCommissionMinor: commissionMinor,
      retainedHostShareMinor: hostShareMinor,
      deadline,
    }
  }

  if (!paid) return result('UNPAID', 0, 0)
  // Host cancels or declines: everything back, protection fee included.
  if (cancelledBy === 'HOST') return result('FULL', paid, 0)
  // No usable check-in date (non-dated division): treat as before the deadline.
  // Regular price: "cancel >= 72h before check-in 00:00" -> exactly at the deadline still qualifies.
  // Protected price: "until check-in 00:00" -> from 00:00 on it no longer does.
  if (protectionPurchased) {
    const beforeDeadline = deadlineMs === null || nowMs < deadlineMs
    const base = paid - protection
    return beforeDeadline
      ? result('FULL_MINUS_PROTECTION', base, protection)
      : result('HALF_MINUS_PROTECTION', Math.round(base / 2), protection)
  }
  const beforeCutoff = deadlineMs === null || nowMs <= deadlineMs
  return beforeCutoff ? result('FULL', paid, 0) : result('HALF', Math.round(paid / 2), 0)
}

// Ledger deltas finalize-cancellation posts for a rule-based cancellation, given the split that was
// posted at payment approval (admin share A credited; host share Hg held; protection F credited).
//   - commissionReversalMinor: DEBIT from the commission recipient = A - commission on retained stay
//   - hostShareReversalMinor: the part of Hg attributable to the refunded amount (clawed back only
//     if the host payout was already RELEASED; otherwise the HOLD simply never releases that part)
//   - hostRetainedReleaseMinor: the host's share of the retained amount, released to the host
//   - protectionReversalMinor: DEBIT of the protection-fee credit (host cancellations only -- the
//     guest gets the protection fee back in that case)
export function cancellationLedgerDeltas({ originalAdminShareMinor, originalHostGrossMinor, originalProtectionMinor = 0, cancellation }) {
  const A = toMinor(originalAdminShareMinor)
  const Hg = toMinor(originalHostGrossMinor)
  const F = toMinor(originalProtectionMinor)
  const commissionReversalMinor = Math.max(0, A - cancellation.retainedCommissionMinor)
  const hostRetainedReleaseMinor = Math.min(Hg, cancellation.retainedHostShareMinor)
  const hostShareReversalMinor = Math.max(0, Hg - hostRetainedReleaseMinor)
  const protectionReversalMinor = Math.max(0, F - cancellation.retainedProtectionMinor)
  return { commissionReversalMinor, hostShareReversalMinor, hostRetainedReleaseMinor, protectionReversalMinor }
}

// Unpaid-request expiry (decision 6): a PAYMENT_PENDING booking older than the window with no
// pending/approved proof is dead -- it must not block dates even before the sweep marks it.
export const LIVE_PROOF_STATUSES = Object.freeze(['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'])
// A PaymentIntent mid-capture also keeps the booking alive (funds may be in flight).
export const LIVE_INTENT_STATUSES = Object.freeze(['PROCESSING'])

export function unpaidExpiryCutoff(now = new Date(), policy = DEFAULT_BOOKING_POLICY) {
  return new Date(new Date(now).getTime() - Number(policy.unpaidExpiryHours) * HOUR_MS)
}

export function bookingExpiresAt(booking, policy = DEFAULT_BOOKING_POLICY) {
  if (!booking || booking.status !== 'PAYMENT_PENDING' || !booking.createdAt) return null
  return new Date(new Date(booking.createdAt).getTime() + Number(policy.unpaidExpiryHours) * HOUR_MS).toISOString()
}

// Prisma `where` fragment (a plain object -- no Prisma import needed) matching bookings that still
// hold their dates: REQUESTED/CONFIRMED always; PAYMENT_PENDING only while inside the expiry window
// or while a live proof / in-flight payment intent exists.
export function dateBlockingBookingWhere(now = new Date(), policy = DEFAULT_BOOKING_POLICY) {
  const cutoff = unpaidExpiryCutoff(now, policy)
  return {
    OR: [
      { status: { in: ['REQUESTED', 'CONFIRMED'] } },
      {
        status: 'PAYMENT_PENDING',
        OR: [
          { createdAt: { gte: cutoff } },
          { payments: { some: { status: { in: [...LIVE_PROOF_STATUSES] } } } },
          { paymentIntents: { some: { status: { in: [...LIVE_INTENT_STATUSES] } } } },
        ],
      },
    ],
  }
}

// The complementary `where` the expiry sweep uses: stale PAYMENT_PENDING with nothing live.
export function expiredUnpaidBookingWhere(now = new Date(), policy = DEFAULT_BOOKING_POLICY) {
  return {
    status: 'PAYMENT_PENDING',
    createdAt: { lt: unpaidExpiryCutoff(now, policy) },
    payments: { none: { status: { in: [...LIVE_PROOF_STATUSES] } } },
    paymentIntents: { none: { status: { in: [...LIVE_INTENT_STATUSES] } } },
  }
}

export function isExpiredUnpaid(booking, { now = new Date(), policy = DEFAULT_BOOKING_POLICY } = {}) {
  if (!booking || booking.status !== 'PAYMENT_PENDING' || !booking.createdAt) return false
  if (new Date(booking.createdAt).getTime() >= unpaidExpiryCutoff(now, policy).getTime()) return false
  const proofs = booking.payments || []
  if (proofs.some((p) => LIVE_PROOF_STATUSES.includes(p.status))) return false
  const intents = booking.paymentIntents || []
  if (intents.some((i) => LIVE_INTENT_STATUSES.includes(i.status))) return false
  return true
}

// Host withdrawal availability (decision 2). Withdrawable = released booking earnings minus
// clawbacks, host cancellation fees and prior withdrawals, capped at the wallet's real balance (so
// promotional/refund credit in the same wallet is never withdrawable as cash). A new request may be
// at most available - pending.
export function payoutAvailability({
  releasedMinor = 0,
  clawbackMinor = 0,
  hostFeesMinor = 0,
  withdrawnMinor = 0,
  walletBalanceMinor = 0,
  pendingMinor = 0,
} = {}) {
  const earningsMinor = toMinor(releasedMinor) - toMinor(clawbackMinor) - toMinor(hostFeesMinor) - toMinor(withdrawnMinor)
  const availableMinor = Math.max(0, Math.min(earningsMinor, Math.round(Number(walletBalanceMinor) || 0)))
  const pending = toMinor(pendingMinor)
  return { availableMinor, pendingMinor: pending, requestableMinor: Math.max(0, availableMinor - pending) }
}

// A stay has ended once its check-out date has begun in the country's time (00:00 local on the
// check-out date -- the same day boundary the cancellation cutoffs use). From then on nothing is
// left to cancel: the guest has used every night. Cancel / cancel-quote refuse with
// BOOKING_STAY_ENDED instead of applying the post-check-in 50% rule (COMPLETED is only set lazily).
export function stayEndMs(checkOut, policy = DEFAULT_BOOKING_POLICY) {
  return checkInStartMs(checkOut, policy)
}

export function hasStayEnded(booking, { now = new Date(), policy = DEFAULT_BOOKING_POLICY } = {}) {
  if (!booking?.checkOut) return false
  const end = stayEndMs(booking.checkOut, policy)
  return end !== null && new Date(now).getTime() >= end
}

// Latest Stripe Checkout session expiry for an unpaid booking (decision 6 + review fix): never past
// the booking's own unpaid-expiry deadline, never more than Stripe's 24h maximum (1 minute safety
// margin). Returns null when less than Stripe's 30-minute minimum (+1 minute margin) remains --
// the caller refuses with BOOKING_NOT_PAYABLE.
export function checkoutSessionExpiresAtSeconds(booking, { now = new Date(), policy = DEFAULT_BOOKING_POLICY } = {}) {
  const nowMs = new Date(now).getTime()
  const bookingDeadline = bookingExpiresAt(booking, policy)
  const stripeMaxMs = nowMs + 24 * HOUR_MS - 60 * 1000
  const deadlineMs = bookingDeadline ? Math.min(Date.parse(bookingDeadline), stripeMaxMs) : stripeMaxMs
  if (deadlineMs - nowMs < 31 * 60 * 1000) return null
  return Math.floor(deadlineMs / 1000)
}

// Expiry-sweep interval (minutes) from env: 15 unless a positive finite number, never below 1.
export function sweepIntervalMinutes(raw) {
  const n = Number(raw)
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n) || n <= 0) return 15
  return Math.max(1, n)
}
