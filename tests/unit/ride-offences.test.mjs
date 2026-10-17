import test from 'node:test'
import assert from 'node:assert/strict'
import { offenceFeeMinor, riderOffenceFeeMinor, isOffenceBlocked, offenceBlockThreshold, countOffences } from '../../server/lib/ride-offences.mjs'

test('ladder: $1, then $5, then $5 again', () => {
  assert.equal(offenceFeeMinor(1, {}), 1)
  assert.equal(offenceFeeMinor(2, {}), 5)
  assert.equal(offenceFeeMinor(3, {}), 5)
  assert.equal(offenceFeeMinor(9, {}), 5)
  assert.equal(offenceFeeMinor(2, { RIDE_OFFENCE_FEES_MINOR: '2,10' }), 10)
})

test('block at the third offence by default', () => {
  assert.equal(offenceBlockThreshold({}), 3)
  assert.equal(isOffenceBlocked(2, {}), false)
  assert.equal(isOffenceBlocked(3, {}), true)
})

test('rider fee: ladder is a floor, percent fee can be higher, never above fare', () => {
  const base = { currency: 'USD' }
  assert.equal(riderOffenceFeeMinor({ ...base, baseFeeMinor: 0, fareMinor: 20, offenceNumber: 1 }, {}), 1)
  assert.equal(riderOffenceFeeMinor({ ...base, baseFeeMinor: 0, fareMinor: 20, offenceNumber: 2 }, {}), 5)
  assert.equal(riderOffenceFeeMinor({ ...base, baseFeeMinor: 12, fareMinor: 20, offenceNumber: 1 }, {}), 12)
  assert.equal(riderOffenceFeeMinor({ ...base, baseFeeMinor: 0, fareMinor: 3, offenceNumber: 2 }, {}), 3)
  assert.equal(riderOffenceFeeMinor({ currency: 'SYP', baseFeeMinor: 700, fareMinor: 9000, offenceNumber: 1 }, {}), 700)
})

test('countOffences filters by role, window and voided strikes', async () => {
  let seen
  const client = { rideRequest: { count: async (q) => { seen = q; return 2 } } }
  const n = await countOffences(client, { userId: 'u1', role: 'RIDER' }, Date.parse('2026-10-17T00:00:00Z'), {})
  assert.equal(n, 2)
  assert.equal(seen.where.riderId, 'u1')
  assert.equal(seen.where.updatedAt.gte.toISOString(), '2026-09-17T00:00:00.000Z')
  await countOffences(client, { userId: 'd1', role: 'DRIVER' }, Date.now(), {})
  assert.equal(seen.where.driverId, 'd1')
})
