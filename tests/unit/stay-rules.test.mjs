import test from 'node:test'
import assert from 'node:assert/strict'
import { assertNotInPast, parseGuests } from '../../server/lib/stay-rules.mjs'

const now = new Date('2026-10-17T15:00:00Z')
test('past check-in rejected, today and future fine', () => {
  assert.throws(() => assertNotInPast(new Date('2026-10-10T00:00:00Z'), now), { code: 'BOOKING_DATES_IN_PAST' })
  assertNotInPast(new Date('2026-10-17T00:00:00Z'), now)
  assertNotInPast(new Date('2026-11-01T00:00:00Z'), now)
  assertNotInPast(undefined, now)
})
test('guests: optional, validated, capped by maxGuests', () => {
  assert.equal(parseGuests(undefined, {}), null)
  assert.equal(parseGuests(3, { maxGuests: 4 }), 3)
  assert.throws(() => parseGuests(5, { maxGuests: 4 }), { code: 'BOOKING_TOO_MANY_GUESTS' })
  assert.throws(() => parseGuests(0, {}), { code: 'BOOKING_GUESTS_INVALID' })
  assert.throws(() => parseGuests(1.5, {}), { code: 'BOOKING_GUESTS_INVALID' })
  assert.throws(() => parseGuests('abc', {}), { code: 'BOOKING_GUESTS_INVALID' })
})
