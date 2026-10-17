import test from 'node:test'
import assert from 'node:assert/strict'
import { vendorModeFromPath, VENDOR_MODE_HOME } from '../../src/shared/lib/vendor-mode.ts'
test('routes map to modes', () => {
  assert.equal(vendorModeFromPath('/host/stays'), 'property')
  assert.equal(vendorModeFromPath('/host/new-construction'), 'property')
  assert.equal(vendorModeFromPath('/host/cars'), 'fleet')
  assert.equal(vendorModeFromPath('/driver'), 'ondemand')
  assert.equal(vendorModeFromPath('/merchant'), 'ondemand')
  assert.equal(vendorModeFromPath('/search'), null)
})
test('every mode has a home that maps back to itself', () => {
  for (const [m, h] of Object.entries(VENDOR_MODE_HOME)) assert.equal(vendorModeFromPath(h), m)
})
