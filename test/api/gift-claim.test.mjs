import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { giftClaimCode, hashPhone } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Regression coverage for the fix in server/routes/wallet.mjs: a gift's expiresAt was always shown
// to the sender/admin and the frontend even has a dedicated "expired" error state, but the claim
// endpoint never checked it -- a gift could be claimed indefinitely past its displayed expiration
// date. Same failure shape as the cancellation-fee and ID-verification bugs.
describe('POST /api/wallet/gifts/:id/claim rejects an expired gift (bug fix)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerRecipient() {
    const email = uniqueTestEmail('gift-claim-recipient')
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
    })
    trackTestUser(res.body.user.id)
    return res.body.token
  }

  async function createGift({ expiresAt }) {
    const senderEmail = uniqueTestEmail('gift-claim-sender')
    await verifyEmailForTest(app, senderEmail)
    const senderRes = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: senderEmail,
      password: 'correct-horse-battery',
    })
    trackTestUser(senderRes.body.user.id)

    const phone = '+963900000123'
    const gift = await db().walletGift.create({
      data: {
        senderUserId: senderRes.body.user.id,
        recipientPhoneHash: hashPhone(phone),
        amountMinor: 1000,
        currency: 'USD',
        status: 'SENT',
        expiresAt,
      },
    })
    return { gift, phone }
  }

  it('rejects claiming a gift past its expiresAt, and marks it EXPIRED', async () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60)
    const { gift, phone } = await createGift({ expiresAt: pastDate })
    const recipientToken = await registerRecipient()

    const res = await request(app)
      .post(`/api/wallet/gifts/${gift.id}/claim`)
      .set('authorization', `Bearer ${recipientToken}`)
      .send({ phone, code: giftClaimCode(gift) })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('GIFT_EXPIRED')

    const updated = await db().walletGift.findUnique({ where: { id: gift.id } })
    expect(updated.status).toBe('EXPIRED')
  })

  it('accepts claiming a gift before its expiresAt', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24)
    const { gift, phone } = await createGift({ expiresAt: futureDate })
    const recipientToken = await registerRecipient()

    const res = await request(app)
      .post(`/api/wallet/gifts/${gift.id}/claim`)
      .set('authorization', `Bearer ${recipientToken}`)
      .send({ phone, code: giftClaimCode(gift) })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})
