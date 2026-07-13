import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { REFEREE_SIGNUP_BONUS_MINOR, REFERRAL_REWARD_CURRENCY, REFERRER_REWARD_MINOR } from '../../server/lib/referrals.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// Double-sided referral program: the referee gets a signup bonus immediately at registration; the
// referrer only gets rewarded once the referee's first paid STR booking is approved, so a referral
// can't be farmed with a throwaway signup that never generates real revenue.
describe('Referral program', () => {
  let app
  let adminId

  beforeAll(async () => {
    app = testApp()
    const admin = await db().user.create({
      data: {
        email: uniqueTestEmail('referral-admin'),
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

  async function registerGuest(label, referralCode) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
      ...(referralCode ? { referralCode } : {}),
    })
    trackTestUser(res.body.user.id)
    return res.body
  }

  it('every new user gets a unique referral code at registration', async () => {
    const a = await registerGuest('referral-code-a')
    const b = await registerGuest('referral-code-b')
    expect(typeof a.user.referralCode).toBe('string')
    expect(a.user.referralCode.length).toBeGreaterThan(0)
    expect(a.user.referralCode).not.toBe(b.user.referralCode)
  })

  it('credits the referee a signup bonus immediately when registering with a valid referral code', async () => {
    const referrer = await registerGuest('referral-referrer-1')
    const referee = await registerGuest('referral-referee-1', referrer.user.referralCode)

    const wallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: referee.user.id, currency: REFERRAL_REWARD_CURRENCY } },
    })
    expect(wallet).not.toBeNull()
    expect(wallet.cachedBalanceMinor).toBe(REFEREE_SIGNUP_BONUS_MINOR)

    const referral = await db().referral.findUnique({ where: { refereeUserId: referee.user.id } })
    expect(referral).not.toBeNull()
    expect(referral.referrerUserId).toBe(referrer.user.id)
    expect(referral.status).toBe('PENDING')
  })

  it('silently ignores an unknown referral code (registration still succeeds, no bonus)', async () => {
    const referee = await registerGuest('referral-unknown-code', 'NOTAREALCODE99')

    const wallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: referee.user.id, currency: REFERRAL_REWARD_CURRENCY } },
    })
    expect(wallet).toBeNull()

    const referral = await db().referral.findUnique({ where: { refereeUserId: referee.user.id } })
    expect(referral).toBeNull()
  })

  it('ignores a self-referral (registering with your own code)', async () => {
    const user = await registerGuest('referral-self')
    // Can't reuse the code at register time for the same user (it's already their own account),
    // but attachReferralOnRegister's self-referral guard is exercised directly here since the only
    // way to hit "own code" in practice is a coding error, not a real registration request.
    const { attachReferralOnRegister } = await import('../../server/lib/referrals.mjs')
    const result = await db().$transaction((tx) =>
      attachReferralOnRegister(tx, { newUserId: user.user.id, referralCode: user.user.referralCode }),
    )
    expect(result).toBeNull()
  })

  it('rewards the referrer once the referee\'s first booking payment is approved, not before', async () => {
    const referrer = await registerGuest('referral-referrer-2')
    const referee = await registerGuest('referral-referee-2', referrer.user.referralCode)

    const hostEmail = uniqueTestEmail('referral-host')
    await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostRes = await request(app).post('/api/auth/register').send({
      role: 'HOST',
      email: hostEmail,
      password: 'correct-horse-battery',
    })
    trackTestUser(hostRes.body.user.id)

    const listing = await db().listing.create({
      data: {
        ownerId: hostRes.body.user.id,
        division: 'STAYS',
        titleAr: 'اختبار الإحالة',
        priceMinor: 40_00,
        currency: 'USD',
        status: 'APPROVED',
      },
    })

    const booking = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId: referee.user.id,
        status: 'PAYMENT_PENDING',
        amountMinor: 40_00,
        currency: 'USD',
      },
    })

    const proof = await db().paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: referee.user.id,
        provider: 'sham_cash',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: 40_00,
        currency: 'USD',
      },
    })

    // Before approval: referrer has no reward yet.
    const referralBefore = await db().referral.findUnique({ where: { refereeUserId: referee.user.id } })
    expect(referralBefore.status).toBe('PENDING')

    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: adminId }))

    const referralAfter = await db().referral.findUnique({ where: { refereeUserId: referee.user.id } })
    expect(referralAfter.status).toBe('REWARDED')
    expect(referralAfter.qualifyingBookingId).toBe(booking.id)

    const referrerWallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: referrer.user.id, currency: REFERRAL_REWARD_CURRENCY } },
    })
    expect(referrerWallet.cachedBalanceMinor).toBe(REFERRER_REWARD_MINOR)
  })

  it('rewards the referrer when the referee converts as a paying seller instead of a paying guest', async () => {
    const referrer = await registerGuest('referral-referrer-seller')
    const referee = await registerGuest('referral-referee-seller', referrer.user.referralCode)

    await db().sellerProfile.create({
      data: {
        userId: referee.user.id,
        legalName: 'Test Seller',
        sellerType: 'owner',
        documentStatus: 'PENDING_REVIEW',
        planCode: 'plus',
      },
    })

    const proof = await db().paymentProof.create({
      data: {
        userId: referee.user.id,
        provider: 'seller_plan',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: 50_00,
        currency: 'USD',
        providerRef: 'test-seller-plan-ref',
      },
    })

    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: adminId }))

    const referral = await db().referral.findUnique({ where: { refereeUserId: referee.user.id } })
    expect(referral.status).toBe('REWARDED')
    expect(referral.qualifyingBookingId).toBe(proof.id)

    const referrerWallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: referrer.user.id, currency: REFERRAL_REWARD_CURRENCY } },
    })
    expect(referrerWallet.cachedBalanceMinor).toBe(REFERRER_REWARD_MINOR)
  })

  it('does not reward the referrer twice for two separate approved bookings from the same referee', async () => {
    const referrer = await registerGuest('referral-referrer-3')
    const referee = await registerGuest('referral-referee-3', referrer.user.referralCode)

    const hostEmail = uniqueTestEmail('referral-host-2')
    await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostRes = await request(app).post('/api/auth/register').send({
      role: 'HOST',
      email: hostEmail,
      password: 'correct-horse-battery',
    })
    trackTestUser(hostRes.body.user.id)

    const listing = await db().listing.create({
      data: {
        ownerId: hostRes.body.user.id,
        division: 'STAYS',
        titleAr: 'اختبار الإحالة 2',
        priceMinor: 30_00,
        currency: 'USD',
        status: 'APPROVED',
      },
    })

    async function payAndApprove() {
      const booking = await db().booking.create({
        data: {
          listingId: listing.id,
          guestId: referee.user.id,
          status: 'PAYMENT_PENDING',
          amountMinor: 30_00,
          currency: 'USD',
        },
      })
      const proof = await db().paymentProof.create({
        data: {
          bookingId: booking.id,
          userId: referee.user.id,
          provider: 'sham_cash',
          status: 'PENDING_ADMIN_REVIEW',
          amountMinor: 30_00,
          currency: 'USD',
        },
      })
      await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: adminId }))
    }

    await payAndApprove()
    await payAndApprove()

    const referrerWallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: referrer.user.id, currency: REFERRAL_REWARD_CURRENCY } },
    })
    // Rewarded once, not twice, despite two separate approved booking payments.
    expect(referrerWallet.cachedBalanceMinor).toBe(REFERRER_REWARD_MINOR)
  })
})
