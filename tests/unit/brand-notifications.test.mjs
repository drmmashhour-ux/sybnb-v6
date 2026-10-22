// White-label email/push text: with BRAND_NAME=Rezekme on the API, no "SYBNB" reaches a Rezekme user.
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderNotification, withBrand } from '../../server/lib/notifications.mjs'

test('withBrand swaps the platform name only when BRAND_NAME is set to another brand', () => {
  assert.equal(withBrand('SYBNB: your code', {}), 'SYBNB: your code')
  assert.equal(withBrand('SYBNB: your code', { BRAND_NAME: 'SYBNB' }), 'SYBNB: your code')
  assert.equal(withBrand('Your SYBNB host code (SYBNB team)', { BRAND_NAME: 'Rezekme' }), 'Your Rezekme host code (Rezekme team)')
})

test('the host activation email carries the deployment brand', () => {
  const before = process.env.BRAND_NAME
  process.env.BRAND_NAME = 'Rezekme'
  try {
    const { subject, text } = renderNotification('host_activation_code', 'en', { code: '123456', expiresAt: 'tomorrow' })
    assert.ok(!/SYBNB/.test(subject + text), subject + text)
    assert.match(text, /Rezekme/)
  } finally {
    if (before === undefined) delete process.env.BRAND_NAME
    else process.env.BRAND_NAME = before
  }
})
