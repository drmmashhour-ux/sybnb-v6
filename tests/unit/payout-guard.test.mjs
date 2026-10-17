import test from 'node:test'
import assert from 'node:assert/strict'
import { payoutBlockReason, MAX_PER_DAY } from '../../server/lib/payout-guard.mjs'
const now = Date.parse('2026-10-17T12:00:00Z'), ago = (h) => new Date(now - h * 3600e3).toISOString()
test('no history is fine', () => assert.equal(payoutBlockReason([], now), null))
test('an open request blocks another', () => assert.equal(payoutBlockReason([{ status: 'REQUESTED', createdAt: ago(30) }], now).code, 'PAYOUT_ALREADY_PENDING'))
test('daily limit counts paid requests in 24h only', () => {
  const paid = (h) => ({ status: 'PAID', createdAt: ago(h) })
  assert.equal(payoutBlockReason([paid(1), paid(2)], now).code, 'PAYOUT_DAILY_LIMIT')
  assert.equal(payoutBlockReason([paid(1), paid(30)], now), null)
  assert.equal(MAX_PER_DAY, 2)
})
test('rejected requests do not count', () => assert.equal(payoutBlockReason([{ status: 'REJECTED', createdAt: ago(1) }, { status: 'REJECTED', createdAt: ago(2) }], now), null))
