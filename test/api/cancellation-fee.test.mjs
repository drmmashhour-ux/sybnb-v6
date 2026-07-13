import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// Regression coverage for the fix in server/routes/bookings.mjs: the guest-facing copy
// (src/shared/booking/cancellationPolicy.ts) has always promised "free cancellation until 3 days
// before check-in," but the cancel endpoint used to charge the flat $10 admin fee unconditionally,
// regardless of how far out the guest cancelled. This proves the fee now actually depends on
// timing, matching what guests are told.
describe('PATCH /api/bookings/:id/cancel — cancellation fee depends on timing (bug fix)', () => {
  let app
  let adminId

  beforeAll(async () => {
    app = testApp()
    // ADMIN cannot self-register (PUBLIC_REGISTER_ROLES in server/routes/auth.mjs) -- create it
    // directly instead, same as approvePaymentProof's actorUserId needs any real admin user id.
    const admin = await db().user.create({
      data: {
        email: uniqueTestEmail('cancel-fee-admin-direct'),
        displayName: 'Test Admin',
        referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'ADMIN' } },
      },
    })
    adminId = admin.id
    trackTestUser(adminId)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function setUpPaidBooking({ checkInDaysFromNow }) {
    const hostEmail = uniqueTestEmail('cancel-fee-host')
    await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostRes = await request(app).post('/api/auth/register').send({
      role: 'HOST',
      email: hostEmail,
      password: 'correct-horse-battery',
    })
    const hostId = hostRes.body.user.id
    trackTestUser(hostId)

    const guestEmail = uniqueTestEmail('cancel-fee-guest')
    await verifyEmailForTest(app, guestEmail)
    const guestRes = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: guestEmail,
      password: 'correct-horse-battery',
    })
    const guestId = guestRes.body.user.id
    const guestToken = guestRes.body.token
    trackTestUser(guestId)

    const listing = await db().listing.create({
      data: {
        ownerId: hostId,
        division: 'STAYS',
        titleAr: 'اختبار الإلغاء',
        priceMinor: 100_00,
        currency: 'USD',
        status: 'APPROVED',
      },
    })

    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + checkInDaysFromNow)

    const booking = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId,
        status: 'REQUESTED',
        checkIn,
        checkOut: new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000),
        amountMinor: 100_00,
        currency: 'USD',
      },
    })

    const proof = await db().paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: guestId,
        provider: 'sham_cash',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: 100_00,
        currency: 'USD',
      },
    })

    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: adminId }))

    return { bookingId: booking.id, guestId, guestToken }
  }

  it('charges no cancellation fee when cancelling well before the 3-day cutoff', async () => {
    const { bookingId, guestToken } = await setUpPaidBooking({ checkInDaysFromNow: 30 })

    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set('authorization', `Bearer ${guestToken}`)
      .send({})

    expect(res.status).toBe(200)

    const feeEntry = await db().walletEntry.findFirst({
      where: { referenceType: 'booking_guest_cancel_fee', referenceId: bookingId },
    })
    expect(feeEntry).toBeNull()
  })

  it('charges the flat $10 cancellation fee when cancelling within 3 days of check-in', async () => {
    const { bookingId, guestToken } = await setUpPaidBooking({ checkInDaysFromNow: 1 })

    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set('authorization', `Bearer ${guestToken}`)
      .send({})

    expect(res.status).toBe(200)

    const feeEntry = await db().walletEntry.findFirst({
      where: { referenceType: 'booking_guest_cancel_fee', referenceId: bookingId, type: 'DEBIT' },
    })
    expect(feeEntry).not.toBeNull()
    expect(feeEntry.amountMinor).toBe(1000)
  })
})
