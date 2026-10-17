import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUnits, childMetadata, MAX_UNITS_PER_CALL } from '../../server/routes/project-units.mjs'

const code = (fn) => { try { fn(); return null } catch (e) { return e.code } }

test('valid units are normalised', () => {
  const out = normalizeUnits([{ label: ' 3A ', priceMinor: '150000', floor: '3', view: 'Sea', bedrooms: 2, sizeSqm: 95.55 }])
  assert.deepEqual(out, [{ label: '3A', priceMinor: 150000, floor: 3, view: 'Sea', bedrooms: 2, sizeSqm: 95.6 }])
})

test('bad input is rejected with a specific code', () => {
  assert.equal(code(() => normalizeUnits([])), 'UNITS_REQUIRED')
  assert.equal(code(() => normalizeUnits('x')), 'UNITS_REQUIRED')
  assert.equal(code(() => normalizeUnits([{ label: '', priceMinor: 1 }])), 'UNIT_LABEL_REQUIRED')
  assert.equal(code(() => normalizeUnits([{ label: 'A', priceMinor: 1 }, { label: 'a', priceMinor: 2 }])), 'UNIT_LABEL_DUPLICATE')
  assert.equal(code(() => normalizeUnits([{ label: 'A', priceMinor: 0 }])), 'UNIT_PRICE_INVALID')
  assert.equal(code(() => normalizeUnits([{ label: 'A', priceMinor: 1.5 }])), 'UNIT_PRICE_INVALID')
  assert.equal(code(() => normalizeUnits([{ label: 'A', priceMinor: 1, floor: 999 }])), 'UNIT_FLOOR_INVALID')
  assert.equal(code(() => normalizeUnits([{ label: 'A', priceMinor: 1, bedrooms: -1 }])), 'UNIT_BEDROOMS_INVALID')
  assert.equal(code(() => normalizeUnits([{ label: 'A', priceMinor: 1, sizeSqm: 2 }])), 'UNIT_SIZE_INVALID')
})

test('more than the per-request cap is refused', () => {
  const many = Array.from({ length: MAX_UNITS_PER_CALL + 1 }, (_, i) => ({ label: `U${i}`, priceMinor: 1 }))
  assert.equal(code(() => normalizeUnits(many)), 'UNITS_TOO_MANY')
})

test('child metadata inherits the project but drops advertising/auction flags and links to the parent', () => {
  const md = childMetadata({ governorate: 'damascus', advertising: true, adPlan: 'premium', auction: { x: 1 }, priceConfirmedAt: 'old', visualFilters: { propertyType: 'apartment' } },
    { label: '5B', floor: 5, view: 'Park', bedrooms: 3, sizeSqm: 120 }, 'parent-1', '2026-10-17T00:00:00Z')
  assert.equal(md.governorate, 'damascus')
  assert.deepEqual(md.visualFilters, { propertyType: 'apartment' })
  assert.equal(md.advertising, undefined)
  assert.equal(md.adPlan, undefined)
  assert.equal(md.auction, undefined)
  assert.equal(md.parentListingId, 'parent-1')
  assert.deepEqual(md.unit, { label: '5B', floor: 5, view: 'Park' })
  assert.equal(md.bedrooms, 3)
  assert.equal(md.sizeSqm, 120)
  assert.equal(md.priceConfirmedAt, '2026-10-17T00:00:00Z')
})
