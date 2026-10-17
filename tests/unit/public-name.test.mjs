import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publicDisplayName } from '../../server/lib/public-name.mjs'

test('email-shaped names are masked to first letter + ***', () => {
  assert.equal(publicDisplayName('mohamed@example.com'), 'm***')
  assert.equal(publicDisplayName('  Guest.One+tag@mail.co  '), 'G***')
})
test('real names pass through (trimmed)', () => {
  assert.equal(publicDisplayName('  Sara Haddad '), 'Sara Haddad')
  assert.equal(publicDisplayName('سارة الحداد'), 'سارة الحداد')
})
test('null, undefined and blank give null', () => {
  assert.equal(publicDisplayName(null), null)
  assert.equal(publicDisplayName(undefined), null)
  assert.equal(publicDisplayName('   '), null)
})
