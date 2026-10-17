import test from 'node:test'
import assert from 'node:assert/strict'
import { solarApplies, parseSolarNumber, solarDetails } from '../../src/shared/listing/solarSpec.ts'
test('only solar and mixed power sources take solar details', () => {
  assert.equal(solarApplies('solar'), true); assert.equal(solarApplies('mixed'), true)
  assert.equal(solarApplies('grid'), false); assert.equal(solarApplies(undefined), false)
})
test('numbers are cleaned, rounded to 1 decimal, and bad values rejected', () => {
  assert.equal(parseSolarNumber('12'), 12); assert.equal(parseSolarNumber('12,55'), 12.6); assert.equal(parseSolarNumber(5), 5)
  for (const bad of ['', null, undefined, 'abc', '0', '-3', 20000, NaN]) assert.equal(parseSolarNumber(bad), null)
})
test('details show only when power is solar and values are valid', () => {
  assert.deepEqual(solarDetails({ powerSource: 'solar', solarBatteryKwh: '10', inverterKw: '5' }), { batteryKwh: 10, inverterKw: 5 })
  assert.deepEqual(solarDetails({ powerSource: 'grid', solarBatteryKwh: '10' }), {})
  assert.deepEqual(solarDetails({ powerSource: 'mixed', solarBatteryKwh: 'x', inverterKw: '4' }), { inverterKw: 4 })
  assert.deepEqual(solarDetails(null), {})
})
