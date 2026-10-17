import test from 'node:test'
import assert from 'node:assert/strict'
import { priceFreshness } from '../../src/shared/listing/priceFreshness.ts'

const NOW = Date.parse('2026-10-17T12:00:00Z')
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

test('stays and marketplace listings are not subject to price-freshness', () => {
  assert.equal(priceFreshness({ division: 'STAYS', createdAt: daysAgo(90) }, NOW).applies, false)
  assert.equal(priceFreshness({ division: 'MARKETPLACE', createdAt: daysAgo(90) }, NOW).applies, false)
})

test('a recent owner confirmation is fresh and counts days', () => {
  const f = priceFreshness({ division: 'BUY', createdAt: daysAgo(100), metadata: { priceConfirmedAt: daysAgo(2) } }, NOW)
  assert.deepEqual(f, { applies: true, confirmed: true, days: 2, stale: false })
})

test('14 days or more without confirmation is stale', () => {
  assert.equal(priceFreshness({ division: 'CARS', createdAt: daysAgo(100), metadata: { priceConfirmedAt: daysAgo(13) } }, NOW).stale, false)
  assert.equal(priceFreshness({ division: 'CARS', createdAt: daysAgo(100), metadata: { priceConfirmedAt: daysAgo(14) } }, NOW).stale, true)
})

test('old listings with no stamp fall back to listing date and are never called "confirmed"', () => {
  const f = priceFreshness({ division: 'RENTALS', createdAt: daysAgo(30), metadata: {} }, NOW)
  assert.equal(f.confirmed, false)
  assert.equal(f.stale, true)
  assert.equal(f.days, 30)
})
