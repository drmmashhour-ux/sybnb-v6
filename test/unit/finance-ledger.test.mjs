import { describe, expect, it } from 'vitest'
import {
  STR_ADMIN_COMMISSION_RATE,
  bookingFinanceSplit,
  buildPayoutRow,
} from '../../server/lib/finance-ledger.mjs'
import { isPayoutEligible, payoutEligibleAt } from '../../server/lib/booking-lifecycle.mjs'

function strBooking(overrides = {}) {
  return {
    amountMinor: 100000,
    currency: 'USD',
    status: 'COMPLETED',
    checkOut: new Date('2026-01-01T00:00:00Z'),
    metadata: {},
    listing: { division: 'STAYS', metadata: {} },
    ...overrides,
  }
}

describe('bookingFinanceSplit: STAYS division invariant (rent + cleaning + tax reconstructs the paid amount)', () => {
  it('rent + cleaning + taxes equals the paid amount for a short-stay booking with no protection add-on', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    expect(split.stayAmountMinor + split.cleaningFeeMinor + split.taxesMinor).toBe(split.paidTotalMinor)
    expect(split.paidTotalMinor).toBe(100000)
  })

  it('host gross + admin share reconstructs the paid amount (nothing silently vanishes)', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    expect(split.hostGrossMinor + split.adminShareMinor).toBe(split.paidTotalMinor)
  })

  it('admin commission is exactly STR_ADMIN_COMMISSION_RATE of the rent component', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    expect(split.adminCommissionMinor).toBe(Math.round(split.stayAmountMinor * STR_ADMIN_COMMISSION_RATE))
  })

  it('excludes a purchased cancellation-protection fee from the rent/cleaning/tax split, tracking it separately', () => {
    const protectionFeeMinor = Math.round(100000 * 0.03)
    const booking = strBooking({
      amountMinor: 100000,
      metadata: { cancellationProtectionPurchased: true, cancellationProtectionFeeMinor: protectionFeeMinor },
    })
    const paid = 100000 + protectionFeeMinor
    const split = bookingFinanceSplit(booking, paid)

    expect(split.cancellationProtectionPurchased).toBe(true)
    expect(split.cancellationProtectionFeeMinor).toBe(protectionFeeMinor)
    expect(split.stayAmountMinor + split.cleaningFeeMinor + split.taxesMinor).toBe(paid - protectionFeeMinor)
  })

  it('never produces a negative host gross or admin share regardless of a tiny paid amount', () => {
    const booking = strBooking({ amountMinor: 1 })
    const split = bookingFinanceSplit(booking, 1)

    expect(split.hostGrossMinor).toBeGreaterThanOrEqual(0)
    expect(split.adminShareMinor).toBeGreaterThanOrEqual(0)
  })
})

describe('bookingFinanceSplit: non-STAYS divisions (e.g. RENTALS) use the direct-passthrough split', () => {
  it('host gross plus admin share still reconstructs the paid amount', () => {
    const booking = {
      amountMinor: 50000,
      metadata: {},
      listing: { division: 'RENTALS', metadata: {} },
    }
    const split = bookingFinanceSplit(booking, 50000)

    expect(split.hostGrossMinor + split.adminShareMinor).toBe(split.paidTotalMinor)
    expect(split.cleaningFeeMinor).toBe(0)
    expect(split.taxesMinor).toBe(0)
  })
})

describe('payout eligibility (14-day hold)', () => {
  it('is not eligible before the booking is COMPLETED, regardless of checkout date', () => {
    const booking = { status: 'CONFIRMED', checkOut: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    expect(isPayoutEligible(booking)).toBe(false)
  })

  it('is not eligible immediately after checkout, before the 14-day hold elapses', () => {
    const booking = { status: 'COMPLETED', checkOut: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    expect(isPayoutEligible(booking)).toBe(false)
  })

  it('is eligible once 14+ days have passed since checkout', () => {
    const booking = { status: 'COMPLETED', checkOut: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) }
    expect(isPayoutEligible(booking)).toBe(true)
  })

  it('payoutEligibleAt is exactly checkOut + 14 days', () => {
    const checkOut = new Date('2026-01-01T00:00:00Z')
    const eligibleAt = payoutEligibleAt(checkOut)
    expect(eligibleAt.toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })
})

describe('buildPayoutRow: payout status derivation', () => {
  it('reports PENDING_HOLD for a COMPLETED booking still inside the 14-day hold', () => {
    const booking = strBooking({ status: 'COMPLETED', checkOut: new Date(), payments: [] })
    const row = buildPayoutRow(booking, new Set())
    expect(row.payoutStatus).toBe('PENDING_HOLD')
  })

  it('reports ELIGIBLE once the hold has elapsed and no release entry exists yet', () => {
    const booking = strBooking({
      status: 'COMPLETED',
      checkOut: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      payments: [],
    })
    const row = buildPayoutRow(booking, new Set())
    expect(row.payoutStatus).toBe('ELIGIBLE')
  })

  it('reports RELEASED when the booking id is present in the released set, overriding eligibility math', () => {
    const booking = strBooking({ id: 'released-id', status: 'COMPLETED', checkOut: new Date(), payments: [] })
    const row = buildPayoutRow(booking, new Set(['released-id']))
    expect(row.payoutStatus).toBe('RELEASED')
  })
})
