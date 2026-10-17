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

test('malformed UUID (Prisma P2023) becomes a clean 400, not a 500', () => {
  const e = new Error('Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix of `urn:uuid:`'); e.code = 'P2023'
  const r = translateDbError(e)
  assert.equal(r.statusCode, 400); assert.equal(r.code, 'INVALID_ID'); assert.equal(r.expose, true)
})
test('P2023 that is not about a UUID is left alone', () => {
  const e = new Error('Inconsistent column data: something else'); e.code = 'P2023'
  assert.equal(translateDbError(e).statusCode, undefined)
})
