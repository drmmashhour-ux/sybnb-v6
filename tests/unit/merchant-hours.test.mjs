import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOpeningHours, isOpenNow } from '../../server/lib/merchant-hours.mjs'

// Damascus is UTC+3 all year. Saturday 2026-10-17 12:00 UTC = 15:00 Damascus.
const sat15 = new Date('2026-10-17T12:00:00Z')
const all = [0, 1, 2, 3, 4, 5, 6]

test('no hours means always open', () => assert.equal(isOpenNow(null, sat15), true))

test('daytime window', () => {
  const h = validateOpeningHours({ days: all, open: '09:00', close: '23:00' })
  assert.equal(isOpenNow(h, sat15), true)
  assert.equal(isOpenNow(h, new Date('2026-10-17T03:00:00Z')), false) // 06:00 Damascus
  assert.equal(isOpenNow(h, new Date('2026-10-17T20:30:00Z')), false) // 23:30 Damascus
})

test('closed on a day that is not an open day', () => {
  const h = validateOpeningHours({ days: [0, 1, 2, 3, 4], open: '09:00', close: '23:00' }) // closed Fri/Sat
  assert.equal(isOpenNow(h, sat15), false)
})

test('overnight window belongs to the previous day after midnight', () => {
  const h = validateOpeningHours({ days: [5], open: '18:00', close: '02:00' }) // Fridays only, until 02:00 Saturday
  assert.equal(isOpenNow(h, new Date('2026-10-16T16:00:00Z')), true)  // Fri 19:00
  assert.equal(isOpenNow(h, new Date('2026-10-16T22:30:00Z')), true)  // Sat 01:30 Damascus (still Friday's shift)
  assert.equal(isOpenNow(h, new Date('2026-10-16T23:30:00Z')), false) // Sat 02:30
  assert.equal(isOpenNow(h, new Date('2026-10-17T16:00:00Z')), false)  // Sat 19:00, Saturday not an open day
})

test('validation', () => {
  assert.equal(validateOpeningHours(null), null)
  assert.throws(() => validateOpeningHours({ days: [], open: '09:00', close: '10:00' }), { code: 'MERCHANT_HOURS_INVALID' })
  assert.throws(() => validateOpeningHours({ days: [1], open: '9am', close: '10:00' }), { code: 'MERCHANT_HOURS_INVALID' })
  assert.throws(() => validateOpeningHours({ days: [1], open: '09:00', close: '09:00' }), { code: 'MERCHANT_HOURS_INVALID' })
  assert.throws(() => validateOpeningHours({ days: [9], open: '09:00', close: '10:00' }), { code: 'MERCHANT_HOURS_INVALID' })
  assert.throws(() => validateOpeningHours({ days: [1], open: '09:00', close: '10:00', tz: 'Mars/Base' }), { code: 'MERCHANT_HOURS_INVALID' })
})
