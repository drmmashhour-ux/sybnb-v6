import test from 'node:test'
import assert from 'node:assert/strict'
import { loginPausedFor } from '../../server/lib/login-pause.mjs'

test('off by default', () => { assert.equal(loginPausedFor('a@b.c', {}), false) })
test('on blocks everyone', () => { assert.equal(loginPausedFor('a@b.c', { LOGIN_DISABLED: '1' }), true) })
test('phone login (no email) blocked', () => { assert.equal(loginPausedFor(undefined, { LOGIN_DISABLED: '1' }), true) })
test('allow-list bypass is case-insensitive', () => {
  const env = { LOGIN_DISABLED: '1', LOGIN_DISABLED_ALLOW: 'Owner@x.com, other@x.com' }
  assert.equal(loginPausedFor('owner@X.com', env), false)
  assert.equal(loginPausedFor('someone@x.com', env), true)
})
test('only exactly 1 enables it', () => { assert.equal(loginPausedFor('a@b.c', { LOGIN_DISABLED: '0' }), false) })
