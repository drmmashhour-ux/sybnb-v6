import test from 'node:test'
import assert from 'node:assert/strict'
import { isKnownRideCategory, rideCategoryToVehicle } from '../../server/lib/vehicle-category.mjs'

test('app category names are known and map to a vehicle', () => {
  for (const c of ['SR Bike', 'SR Economy', 'SR Comfort', 'SR SUV', 'SR Van', 'SR VIP']) {
    assert.equal(isKnownRideCategory(c), true)
    assert.ok(rideCategoryToVehicle(c))
  }
})
test('unknown or malformed names are rejected', () => {
  for (const c of ['BIKE', 'ECONOMY', 'sr bike', '', undefined, null, 5, '__proto__', 'toString']) {
    assert.equal(isKnownRideCategory(c), false)
  }
})
