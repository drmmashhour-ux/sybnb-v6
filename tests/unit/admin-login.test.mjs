// Unit tests for the pure admin sign-in policy (server/lib/admin-login.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ADMIN_LOGIN_OTP_PURPOSE,
  ADMIN_LOGIN_OTP_WINDOW_MS,
  adminSessionTtlSeconds,
  isUsableAdminLoginCode,
  requiresAdminLoginCode,
  sessionTtlSecondsForRoles,
} from '../../server/lib/admin-login.mjs'
import { SESSION_TTL_SECONDS } from '../../server/lib/security.mjs'

test('only accounts holding ADMIN need the admin code (strings or role rows)', () => {
  assert.equal(requiresAdminLoginCode(['ADMIN']), true)
  assert.equal(requiresAdminLoginCode([{ role: 'GUEST' }, { role: 'ADMIN' }]), true)
  assert.equal(requiresAdminLoginCode(['GUEST', 'HOST', 'SELLER', 'SUPPORT']), false)
  assert.equal(requiresAdminLoginCode([]), false)
  assert.equal(requiresAdminLoginCode(undefined), false)
})

test('admin sessions default to 12h, configurable 1..168h; others keep 7 days', () => {
  assert.equal(adminSessionTtlSeconds({}), 12 * 3600)
  assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_HOURS: '4' }), 4 * 3600)
  assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_HOURS: '0' }), 12 * 3600)
  assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_HOURS: 'x' }), 12 * 3600)
  assert.equal(sessionTtlSecondsForRoles([{ role: 'ADMIN' }], {}), 12 * 3600)
  assert.equal(sessionTtlSecondsForRoles(['GUEST', 'HOST'], {}), SESSION_TTL_SECONDS)
})

test('admin login code: VERIFIED, admin-login purpose, verified within the window', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  const ok = { purpose: ADMIN_LOGIN_OTP_PURPOSE, status: 'VERIFIED', verifiedAt: new Date(now - 60_000) }
  assert.equal(isUsableAdminLoginCode(ok, now), true)
  assert.equal(isUsableAdminLoginCode({ ...ok, verifiedAt: new Date(now - ADMIN_LOGIN_OTP_WINDOW_MS) }, now), false)
  assert.equal(isUsableAdminLoginCode({ ...ok, purpose: 'staff-login' }, now), false)
  assert.equal(isUsableAdminLoginCode({ ...ok, purpose: 'guest-login' }, now), false)
  assert.equal(isUsableAdminLoginCode({ ...ok, status: 'PENDING' }, now), false)
  assert.equal(isUsableAdminLoginCode({ ...ok, status: 'CANCELLED' }, now), false)
  assert.equal(isUsableAdminLoginCode(null, now), false)
})
