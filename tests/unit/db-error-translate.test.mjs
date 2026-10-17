import test from 'node:test'
import assert from 'node:assert/strict'
import { translateDbError } from '../../server/lib/responses.mjs'
test('overlap constraint violation becomes a 409', () => {
  const e = translateDbError(new Error('conflicting key value violates exclusion constraint "bookings_no_overlapping_confirmed"'))
  assert.equal(e.statusCode, 409); assert.equal(e.code, 'BOOKING_DATES_UNAVAILABLE'); assert.equal(e.expose, true)
})
test('Postgres exclusion code 23P01 in meta is recognised', () => {
  const e = new Error('raw query failed'); e.meta = { code: '23P01' }
  assert.equal(translateDbError(e).statusCode, 409)
})
test('other errors and already-coded errors are untouched', () => {
  const plain = new Error('boom'); assert.equal(translateDbError(plain).statusCode, undefined)
  const coded = new Error('x'); coded.statusCode = 404; assert.equal(translateDbError(coded).statusCode, 404)
  assert.equal(translateDbError(null), null)
})
