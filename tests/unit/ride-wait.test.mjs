import test from 'node:test'
import assert from 'node:assert/strict'
import { rideWaitMs, noShowFeePercent, noShowFeeMinor, isNearPickup, waitState } from '../../server/lib/ride-wait.mjs'

test('defaults: 10 minute wait, 100% no-show fee', () => {
  assert.equal(rideWaitMs({}), 600_000)
  assert.equal(noShowFeePercent({}), 100)
  assert.equal(noShowFeeMinor(12345, {}), 12345)
  assert.equal(noShowFeeMinor(0, {}), null)
})

test('env overrides are honoured and bad values fall back', () => {
  assert.equal(rideWaitMs({ RIDE_WAIT_MINUTES: '5' }), 300_000)
  assert.equal(rideWaitMs({ RIDE_WAIT_MINUTES: '-1' }), 600_000)
  assert.equal(noShowFeeMinor(1000, { RIDE_NO_SHOW_FEE_PERCENT: '50' }), 500)
})

test('waitState is null before arrival and counts down after', () => {
  assert.equal(waitState({}), null)
  const at = new Date('2026-10-17T12:00:00Z')
  const meta = { arrivedAt: at.toISOString() }
  const mid = waitState(meta, at.getTime() + 4 * 60_000, {})
  assert.equal(mid.waitExpired, false)
  assert.equal(mid.secondsLeft, 360)
  assert.equal(waitState(meta, at.getTime() + 10 * 60_000, {}).waitExpired, true)
})

test('isNearPickup uses a distance radius', () => {
  const p = { lat: 33.5138, lng: 36.2765 }
  assert.equal(isNearPickup({ lat: 33.5139, lng: 36.2766 }, p, {}), true)
  assert.equal(isNearPickup({ lat: 33.53, lng: 36.30 }, p, {}), false)
  assert.equal(isNearPickup(null, p, {}), false)
})
