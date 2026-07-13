import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Regression coverage for the fix in server/routes/payments.mjs: BookingDetailPage.tsx has always
// hidden the payment buttons behind `hasIdDocument = Boolean(booking?.guest?.idDocumentRef)`, but
// neither payment endpoint actually checked that server-side -- any authenticated guest could pay
// for a booking via a direct API call without ever uploading an ID document. Same failure shape as
// the cancellation-fee bug: a client-only gate with no server enforcement.
describe('Payment endpoints enforce the ID-verification gate (bug fix)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function setUpUnpaidBooking() {
    const hostEmail = uniqueTestEmail('id-gate-host')
    await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostRes = await request(app).post('/api/auth/register').send({
      role: 'HOST',
      email: hostEmail,
      password: 'correct-horse-battery',
    })
    trackTestUser(hostRes.body.user.id)

    const guestEmail = uniqueTestEmail('id-gate-guest')
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
        ownerId: hostRes.body.user.id,
        division: 'STAYS',
        titleAr: 'اختبار التحقق من الهوية',
        priceMinor: 50_00,
        currency: 'USD',
        status: 'APPROVED',
      },
    })

    const booking = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId,
        status: 'PAYMENT_PENDING',
        amountMinor: 50_00,
        currency: 'USD',
      },
    })

    return { bookingId: booking.id, guestId, guestToken }
  }

  it('rejects a Stripe checkout session when the guest has no ID document on file', async () => {
    const { bookingId, guestToken } = await setUpUnpaidBooking()

    const res = await request(app)
      .post('/api/payments/stripe/create-checkout-session')
      .set('authorization', `Bearer ${guestToken}`)
      .send({ bookingId, origin: 'https://sybnb.app' })

    // Stripe is not configured in the test environment either, but the ID check runs first --
    // either a 503 STRIPE_NOT_CONFIGURED (if this environment somehow has Stripe keys set) or the
    // expected 403 would both prove the code path was reached; assert the specific gate we added.
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ID_VERIFICATION_REQUIRED')
  })

  it('rejects a local-wallet payment proof tied to a booking when the guest has no ID document on file', async () => {
    const { bookingId, guestToken } = await setUpUnpaidBooking()

    const res = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guestToken}`)
      .send({ bookingId, providerRef: `test-ref-${bookingId}` })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ID_VERIFICATION_REQUIRED')
  })

  it('accepts a local-wallet payment proof once the guest has an ID document on file', async () => {
    const { bookingId, guestId, guestToken } = await setUpUnpaidBooking()
    await db().user.update({ where: { id: guestId }, data: { idDocumentRef: 'test-id-doc-ref' } })

    const res = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guestToken}`)
      .send({ bookingId, providerRef: `test-ref-${bookingId}` })

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
  })
})
