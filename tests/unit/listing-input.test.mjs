import test from 'node:test'
import assert from 'node:assert/strict'
import { assertListingPrice, assertListingText, clampPlaceText } from '../../server/lib/listing-input.mjs'

test('price must be a positive whole number within int4', () => {
  assertListingPrice(15000)
  for (const v of [0, -5, NaN]) assert.throws(() => assertListingPrice(v), { code: 'LISTING_PRICE_INVALID' })
  assert.throws(() => assertListingPrice(1.5), { code: 'LISTING_PRICE_INVALID' })
  assert.throws(() => assertListingPrice(3_000_000_000), { code: 'LISTING_PRICE_TOO_LARGE' })
})
test('text length limits', () => {
  assertListingText({ titleAr: 'عنوان', description: 'x' })
  assert.throws(() => assertListingText({ titleAr: 'x'.repeat(201) }), { code: 'LISTING_TITLE_TOO_LONG' })
  assert.throws(() => assertListingText({ titleAr: 'abc', description: 'x'.repeat(10001) }), { code: 'LISTING_DESCRIPTION_TOO_LONG' })
})
test('clampPlaceText', () => {
  assert.equal(clampPlaceText('  Damascus  '), 'Damascus')
  assert.equal(clampPlaceText('x'.repeat(500)).length, 80)
  assert.equal(clampPlaceText(''), undefined)
  assert.equal(clampPlaceText(undefined), undefined)
})
