import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Exercises the idempotency guarantee recordWalletEntry() relies on to survive concurrent/retried
// approvals (see finance-ledger.mjs's approvePaymentProof race-condition comment) — a deterministic
// idempotencyKey means calling it twice with the same keyParts must not double-credit the wallet.
describe('recordWalletEntry idempotency', () => {
  let app
  let userId

  beforeAll(async () => {
    app = testApp()
    const email = uniqueTestEmail('wallet-idempotency')
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({
      role: 'HOST',
      email,
      password: 'correct-horse-battery',
    })
    userId = res.body.user.id
    trackTestUser(userId)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('recording the same wallet entry twice with identical keyParts only credits the balance once', async () => {
    const keyParts = ['test-idempotency', userId, 'fixed-reference']

    const first = await db().$transaction((tx) =>
      recordWalletEntry(tx, {
        userId,
        type: 'CREDIT',
        amountMinor: 5000,
        currency: 'USD',
        referenceType: 'test_reference',
        referenceId: 'fixed-reference',
        keyParts,
        note: 'first attempt',
      }),
    )

    const second = await db().$transaction((tx) =>
      recordWalletEntry(tx, {
        userId,
        type: 'CREDIT',
        amountMinor: 5000,
        currency: 'USD',
        referenceType: 'test_reference',
        referenceId: 'fixed-reference',
        keyParts,
        note: 'retried attempt (e.g. a second admin tab, or a retried webhook)',
      }),
    )

    expect(second.id).toBe(first.id)

    const wallet = await db().wallet.findUnique({ where: { userId_currency: { userId, currency: 'USD' } } })
    expect(wallet.cachedBalanceMinor).toBe(5000)

    const entries = await db().walletEntry.findMany({ where: { walletId: wallet.id, referenceId: 'fixed-reference' } })
    expect(entries).toHaveLength(1)
  })

  it('a different referenceId with otherwise-identical amount produces an independent entry', async () => {
    const before = await db().wallet.findUnique({ where: { userId_currency: { userId, currency: 'USD' } } })

    await db().$transaction((tx) =>
      recordWalletEntry(tx, {
        userId,
        type: 'CREDIT',
        amountMinor: 2500,
        currency: 'USD',
        referenceType: 'test_reference',
        referenceId: 'a-different-reference',
        keyParts: ['test-idempotency', userId, 'a-different-reference'],
        note: 'independent entry',
      }),
    )

    const after = await db().wallet.findUnique({ where: { userId_currency: { userId, currency: 'USD' } } })
    expect(after.cachedBalanceMinor).toBe(before.cachedBalanceMinor + 2500)
  })
})
