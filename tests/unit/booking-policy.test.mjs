// Unit tests for the pure booking money policy (server/lib/booking-policy.mjs) -- owner decisions of
// 2026-10-08. No database, no server: `node --test tests/unit/`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cancellationLedgerDeltas,
  checkInStartMs,
  computeCancellation,
  computeGuestTotals,
  dateBlockingBookingWhere,
  expiredUnpaidBookingWhere,
  isExpiredUnpaid,
  bookingExpiresAt,
  payoutAvailability,
  protectionFeeMinor,
  resolveBookingPolicy,
  splitCommission,
} from '../../server/lib/booking-policy.mjs'

// Syria profile values (countries/syria/profile.mjs): UTC+3, 72h cutoff, 48h unpaid expiry.
const SYRIA = resolveBookingPolicy({ timezoneOffsetMinutes: 180, fullRefundCutoffHours: 72, unpaidExpiryHours: 48 })
const CHECK_IN = '2026-11-10T00:00:00.000Z' // calendar date 2026-11-10
// Check-in 00:00 Syria time = 2026-11-09T21:00Z; 72h before = 2026-11-06T21:00Z.
const CHECK_IN_START = Date.parse('2026-11-09T21:00:00.000Z')
const CUTOFF = Date.parse('2026-11-06T21:00:00.000Z')
const at = (ms) => new Date(ms)
const H = 60 * 60 * 1000

function assertConserved(c, paid) {
  assert.equal(c.refundMinor + c.retainedMinor, paid, 'refund + retained must equal paid')
  assert.equal(c.retainedProtectionMinor + c.retainedCommissionMinor + c.retainedHostShareMinor, c.retainedMinor, 'retained parts must add up')
  for (const k of ['refundMinor', 'retainedMinor', 'retainedCommissionMinor', 'retainedHostShareMinor', 'retainedProtectionMinor']) {
    assert.ok(Number.isInteger(c[k]) && c[k] >= 0, `${k} must be a non-negative integer, got ${c[k]}`)
  }
}

test('policy resolution: profile values, env overrides, neutral defaults', () => {
  assert.deepEqual(resolveBookingPolicy(), { timezoneOffsetMinutes: 0, fullRefundCutoffHours: 72, unpaidExpiryHours: 48 })
  assert.equal(SYRIA.timezoneOffsetMinutes, 180)
  const overridden = resolveBookingPolicy({ timezoneOffsetMinutes: 180 }, { BOOKING_UNPAID_EXPIRY_HOURS: '24', BOOKING_FULL_REFUND_CUTOFF_HOURS: 'junk' })
  assert.equal(overridden.unpaidExpiryHours, 24)
  assert.equal(overridden.fullRefundCutoffHours, 72)
  assert.equal(checkInStartMs(CHECK_IN, SYRIA), CHECK_IN_START)
})

test('regular price, cancelled >= 72h before check-in 00:00 (Syria time) -> 100% refund', () => {
  const paid = 117_700
  for (const now of [CUTOFF - 24 * H, CUTOFF]) {
    const c = computeCancellation({ paidMinor: paid, checkIn: CHECK_IN, now: at(now), policy: SYRIA })
    assert.equal(c.rule, 'FULL')
    assert.equal(c.refundMinor, paid)
    assert.equal(c.retainedMinor, 0)
    assert.equal(c.deadline, new Date(CUTOFF).toISOString())
    assertConserved(c, paid)
  }
})

test('regular price, cancelled < 72h before check-in -> 50% refund', () => {
  const paid = 117_700
  const c = computeCancellation({ paidMinor: paid, checkIn: CHECK_IN, now: at(CUTOFF + 1), policy: SYRIA })
  assert.equal(c.rule, 'HALF')
  assert.equal(c.refundMinor, 58_850)
  assert.equal(c.retainedMinor, 58_850)
  // Retained part split like a normal booking: 12% SYBNB / 88% host.
  assert.equal(c.retainedCommissionMinor, Math.round(58_850 * 0.12))
  assert.equal(c.retainedHostShareMinor, 58_850 - Math.round(58_850 * 0.12))
  assertConserved(c, paid)
})

test('regular price, cancelled after check-in -> 50% refund', () => {
  const paid = 200_000
  const c = computeCancellation({ paidMinor: paid, checkIn: CHECK_IN, now: at(CHECK_IN_START + 30 * H), policy: SYRIA })
  assert.equal(c.rule, 'HALF')
  assert.equal(c.refundMinor, 100_000)
  assertConserved(c, paid)
})

test('protected price, cancelled before check-in 00:00 -> 100% minus the protection fee', () => {
  const stay = 300_000
  const fee = protectionFeeMinor(stay) // 9_000
  const paid = computeGuestTotals({ stayMinor: stay, protection: true }).totalMinor
  for (const now of [CUTOFF + 10 * H, CHECK_IN_START - 1]) {
    const c = computeCancellation({ paidMinor: paid, protectionPurchased: true, protectionMinor: fee, checkIn: CHECK_IN, now: at(now), policy: SYRIA })
    assert.equal(c.rule, 'FULL_MINUS_PROTECTION')
    assert.equal(c.refundMinor, paid - fee)
    assert.equal(c.retainedProtectionMinor, fee)
    assert.equal(c.retainedCommissionMinor, 0)
    assert.equal(c.retainedHostShareMinor, 0)
    assert.equal(c.deadline, new Date(CHECK_IN_START).toISOString())
    assertConserved(c, paid)
  }
})

test('protected price, cancelled from check-in 00:00 on -> 50% of (paid minus protection)', () => {
  const stay = 300_000
  const fee = protectionFeeMinor(stay)
  const paid = computeGuestTotals({ stayMinor: stay, protection: true }).totalMinor
  const c = computeCancellation({ paidMinor: paid, protectionPurchased: true, protectionMinor: fee, checkIn: CHECK_IN, now: at(CHECK_IN_START), policy: SYRIA })
  assert.equal(c.rule, 'HALF_MINUS_PROTECTION')
  assert.equal(c.refundMinor, Math.round((paid - fee) / 2))
  assert.equal(c.retainedProtectionMinor, fee)
  const retainedStay = paid - fee - c.refundMinor
  assert.equal(c.retainedStayMinor, retainedStay)
  assert.equal(c.retainedCommissionMinor, Math.round(retainedStay * 0.12))
  assertConserved(c, paid)
})

test('host cancels or declines -> 100% refund including the protection fee', () => {
  const paid = 330_000
  for (const now of [CUTOFF - 100 * H, CHECK_IN_START + 5 * H]) {
    const c = computeCancellation({ paidMinor: paid, protectionPurchased: true, protectionMinor: 9_000, checkIn: CHECK_IN, now: at(now), cancelledBy: 'HOST', policy: SYRIA })
    assert.equal(c.rule, 'FULL')
    assert.equal(c.refundMinor, paid)
    assert.equal(c.retainedMinor, 0)
    assert.equal(c.retainedProtectionMinor, 0)
    assertConserved(c, paid)
  }
})

test('not yet paid -> UNPAID, nothing to refund', () => {
  const c = computeCancellation({ paidMinor: 0, checkIn: CHECK_IN, now: at(CHECK_IN_START + 1), policy: SYRIA })
  assert.equal(c.rule, 'UNPAID')
  assert.equal(c.refundMinor, 0)
  assert.equal(c.retainedMinor, 0)
})

test('protection fee = 3% of the FULL stay (all nights, before cleaning/taxes)', () => {
  // 3 nights at 100,000 (one with a 120,000 override) -> stay 320,000 -> fee 9,600 (not 3% of one night).
  const stay = 100_000 + 120_000 + 100_000
  assert.equal(protectionFeeMinor(stay), 9_600)
  const t = computeGuestTotals({ stayMinor: stay, protection: true })
  assert.equal(t.protectionMinor, 9_600)
  assert.notEqual(t.protectionMinor, Math.round(100_000 * 0.03))
  // Cleaning/taxes do not enter the protection base.
  const withFees = computeGuestTotals({ stayMinor: stay, fees: { cleaningFeeMinor: 50_000, taxesMinor: 7_000 }, protection: true })
  assert.equal(withFees.protectionMinor, 9_600)
  // A snapshotted fee on the booking wins.
  assert.equal(computeGuestTotals({ stayMinor: stay, protection: true, protectionFeeOverrideMinor: 1_234 }).protectionMinor, 1_234)
})

test('commission = 12% of total minus protection; host share is the exact remainder', () => {
  const t = computeGuestTotals({ stayMinor: 250_000, fees: { cleaningFeeMinor: 20_000, taxesMinor: 5_000, serviceFeeMinor: 3_000, parkingFeeMinor: 1_000 }, extraFeesMinor: 500, protection: true })
  assert.equal(t.otherFeesMinor, 4_500)
  assert.equal(t.totalMinor, 250_000 + 20_000 + 5_000 + 4_500 + 7_500)
  const base = t.totalMinor - t.protectionMinor
  assert.equal(t.commissionMinor, Math.round(base * 0.12))
  assert.equal(t.commissionMinor + t.hostShareMinor, base)
  // Fallback percentages for a STAYS listing with no explicit fees (pre-existing behaviour).
  const f = computeGuestTotals({ stayMinor: 100_000 })
  assert.equal(f.cleaningMinor, 5_000)
  assert.equal(f.taxesMinor, 2_000)
  assert.equal(f.totalMinor, 107_000)
  // Non-STAYS divisions carry no per-booking commission.
  assert.equal(computeGuestTotals({ stayMinor: 100_000, isShortStay: false }).commissionMinor, 0)
})

test('rounding never creates or loses money (integer minor units)', () => {
  for (let paid = 1; paid < 2_000; paid += 7) {
    for (const protectionPurchased of [false, true]) {
      const fee = protectionPurchased ? Math.floor(paid / 35) : 0
      for (const now of [CUTOFF - H, CUTOFF + H, CHECK_IN_START + H]) {
        for (const cancelledBy of ['GUEST', 'HOST']) {
          const c = computeCancellation({ paidMinor: paid, protectionPurchased, protectionMinor: fee, checkIn: CHECK_IN, now: at(now), cancelledBy, policy: SYRIA })
          assertConserved(c, paid)
          // Ledger deltas against the split posted at approval conserve the original split too.
          const A = Math.round((paid - fee) * 0.12)
          const Hg = paid - fee - A
          const d = cancellationLedgerDeltas({ originalAdminShareMinor: A, originalHostGrossMinor: Hg, originalProtectionMinor: fee, cancellation: c })
          assert.equal(d.commissionReversalMinor + c.retainedCommissionMinor, A)
          assert.equal(d.hostShareReversalMinor + d.hostRetainedReleaseMinor, Hg)
          assert.equal(d.protectionReversalMinor + c.retainedProtectionMinor, fee)
          // Guest refund + what the platform keeps + what the host keeps == paid.
          const platformKeeps = (A - d.commissionReversalMinor) + (fee - d.protectionReversalMinor)
          assert.equal(c.refundMinor + platformKeeps + d.hostRetainedReleaseMinor, paid)
        }
      }
    }
  }
  const odd = computeCancellation({ paidMinor: 1_001, checkIn: CHECK_IN, now: at(CHECK_IN_START), policy: SYRIA })
  assert.equal(odd.refundMinor, 501)
  assert.equal(odd.retainedMinor, 500)
  const { commissionMinor, hostShareMinor } = splitCommission(999)
  assert.equal(commissionMinor + hostShareMinor, 999)
})

test('unpaid expiry: 48h window, live proofs/intents keep a request alive', () => {
  const now = new Date('2026-10-08T12:00:00.000Z')
  const old = { status: 'PAYMENT_PENDING', createdAt: new Date(now.getTime() - 49 * H), payments: [], paymentIntents: [] }
  assert.equal(isExpiredUnpaid(old, { now, policy: SYRIA }), true)
  assert.equal(isExpiredUnpaid({ ...old, createdAt: new Date(now.getTime() - 47 * H) }, { now, policy: SYRIA }), false)
  assert.equal(isExpiredUnpaid({ ...old, payments: [{ status: 'PENDING_ADMIN_REVIEW' }] }, { now, policy: SYRIA }), false)
  assert.equal(isExpiredUnpaid({ ...old, payments: [{ status: 'REJECTED' }] }, { now, policy: SYRIA }), true)
  assert.equal(isExpiredUnpaid({ ...old, paymentIntents: [{ status: 'PROCESSING' }] }, { now, policy: SYRIA }), false)
  assert.equal(isExpiredUnpaid({ ...old, status: 'REQUESTED' }, { now, policy: SYRIA }), false)
  assert.equal(bookingExpiresAt({ status: 'PAYMENT_PENDING', createdAt: now }, SYRIA), new Date(now.getTime() + 48 * H).toISOString())
  assert.equal(bookingExpiresAt({ status: 'REQUESTED', createdAt: now }, SYRIA), null)
  const where = expiredUnpaidBookingWhere(now, SYRIA)
  assert.equal(where.createdAt.lt.toISOString(), new Date(now.getTime() - 48 * H).toISOString())
  const blocking = dateBlockingBookingWhere(now, SYRIA)
  assert.deepEqual(blocking.OR[0], { status: { in: ['REQUESTED', 'CONFIRMED'] } })
})

test('host withdrawal availability: released earnings net of debits, capped by wallet balance', () => {
  assert.deepEqual(payoutAvailability({}), { availableMinor: 0, pendingMinor: 0, requestableMinor: 0 })
  const a = payoutAvailability({ releasedMinor: 100_000, clawbackMinor: 10_000, hostFeesMinor: 1_300, withdrawnMinor: 20_000, walletBalanceMinor: 500_000, pendingMinor: 30_000 })
  assert.equal(a.availableMinor, 68_700)
  assert.equal(a.requestableMinor, 38_700)
  // Gift/promotional credit in the same wallet is never withdrawable: capped by earnings.
  assert.equal(payoutAvailability({ releasedMinor: 0, walletBalanceMinor: 1_000_000 }).availableMinor, 0)
  // Never more than the real wallet balance.
  assert.equal(payoutAvailability({ releasedMinor: 100_000, walletBalanceMinor: 40_000 }).availableMinor, 40_000)
  assert.equal(payoutAvailability({ releasedMinor: 100_000, walletBalanceMinor: 100_000, pendingMinor: 150_000 }).requestableMinor, 0)
})
