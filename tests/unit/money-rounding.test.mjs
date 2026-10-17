// Google plan #2, "Calculations": money must reconcile to the exact lowest denomination with no
// floating-point leaks. Property-style check over thousands of awkward stays, no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeGuestTotals, splitCommission, protectionFeeMinor } from '../../server/lib/booking-policy.mjs'

// Deterministic PRNG so a failure is reproducible.
let seed = 20261017
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

test('every guest-total component is an integer and the parts add up exactly', () => {
  for (let i = 0; i < 5000; i++) {
    const nights = int(1, 365)
    const nightly = int(1, 9_999_999)           // awkward, non-round nightly rates
    const stayMinor = nights * nightly
    for (const protection of [false, true]) {
      const t = computeGuestTotals({ stayMinor, protection, extraFeesMinor: int(0, 5000) })
      for (const [k, v] of Object.entries(t)) assert.ok(Number.isSafeInteger(v), `${k}=${v} (stay ${stayMinor})`)
      assert.equal(t.totalMinor, t.stayMinor + t.cleaningMinor + t.taxesMinor + t.otherFeesMinor + t.protectionMinor)
      assert.equal(t.commissionMinor + t.hostShareMinor, t.totalMinor - t.protectionMinor)
      assert.ok(t.hostShareMinor >= 0 && t.commissionMinor >= 0)
    }
  }
})

test('commission + host share always equals the amount, for any amount', () => {
  for (let i = 0; i < 5000; i++) {
    const amount = int(0, 2_000_000_000)
    const { commissionMinor, hostShareMinor } = splitCommission(amount)
    assert.equal(commissionMinor + hostShareMinor, amount)
    assert.ok(Number.isInteger(commissionMinor))
  }
})

test('fractional weekday-markdown style rates never leak a fraction', () => {
  // A 7-night stay with 3 weekday nights discounted 12.5% and 4 at full rate, summed in minor units.
  for (let i = 0; i < 2000; i++) {
    const rate = int(1, 5_000_000)
    const discounted = Math.round(rate * 0.875)
    const stay = 3 * discounted + 4 * rate
    const t = computeGuestTotals({ stayMinor: stay })
    assert.ok(Number.isInteger(t.totalMinor))
    assert.equal(protectionFeeMinor(stay), Math.round(stay * 0.03))
  }
})
