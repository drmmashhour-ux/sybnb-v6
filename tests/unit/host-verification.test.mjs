// Unit tests for the pure host-verification policy (server/lib/host-verification.mjs) -- owner
// decision of 2026-10-08 (activation code). No database, no server: `node --test tests/unit/`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_ACTIVATION_MAX_ATTEMPTS,
  activationAttemptOutcome,
  activationCodeExpiresAt,
  activationCodeState,
  activationCodeTtlDays,
  generateActivationCode,
  hostListStatusWhere,
  isListingPubliclyVisible,
  normalizeActivationCode,
  publicListingVisibilityWhere,
  requiresHostVerification,
} from '../../server/lib/host-verification.mjs'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

test('generated codes are exactly 6 digits, leading zeros kept', () => {
  assert.equal(generateActivationCode(() => 0), '000000')
  assert.equal(generateActivationCode(() => 42), '000042')
  assert.equal(generateActivationCode(() => 999_999), '999999')
  for (let i = 0; i < 200; i++) assert.match(generateActivationCode(), /^\d{6}$/)
})

test('a broken random source is refused, never padded into a fake code', () => {
  assert.throws(() => generateActivationCode(() => 1_000_000))
  assert.throws(() => generateActivationCode(() => -1))
  assert.throws(() => generateActivationCode(() => 1.5))
})

test('input normalization: spaces, dashes, Arabic-Indic and Persian digits', () => {
  assert.equal(normalizeActivationCode('123456'), '123456')
  assert.equal(normalizeActivationCode(' 123 456 '), '123456')
  assert.equal(normalizeActivationCode('123-456'), '123456')
  assert.equal(normalizeActivationCode('١٢٣٤٥٦'), '123456')
  assert.equal(normalizeActivationCode('۰۱۲۳۴۵'), '012345')
  assert.equal(normalizeActivationCode('12345'), null)
  assert.equal(normalizeActivationCode('1234567'), null)
  assert.equal(normalizeActivationCode('12a456'), null)
  assert.equal(normalizeActivationCode(undefined), null)
  assert.equal(normalizeActivationCode({}), null)
})

test('TTL: default 7 days, configurable 1..30, junk falls back to default', () => {
  assert.equal(activationCodeTtlDays({}), 7)
  assert.equal(activationCodeTtlDays({ HOST_ACTIVATION_CODE_TTL_DAYS: '3' }), 3)
  assert.equal(activationCodeTtlDays({ HOST_ACTIVATION_CODE_TTL_DAYS: '0' }), 7)
  assert.equal(activationCodeTtlDays({ HOST_ACTIVATION_CODE_TTL_DAYS: '31' }), 7)
  assert.equal(activationCodeTtlDays({ HOST_ACTIVATION_CODE_TTL_DAYS: 'abc' }), 7)
  assert.equal(activationCodeExpiresAt(NOW, {}).getTime(), NOW.getTime() + 7 * DAY)
  assert.equal(activationCodeExpiresAt(NOW, { HOST_ACTIVATION_CODE_TTL_DAYS: '2' }).getTime(), NOW.getTime() + 2 * DAY)
})

test('code state: ACTIVE / EXPIRED / LOCKED / USED / NONE', () => {
  const future = new Date(NOW.getTime() + DAY)
  assert.equal(activationCodeState(null, NOW), 'NONE')
  assert.equal(activationCodeState({ usedAt: null, expiresAt: future, attempts: 0 }, NOW), 'ACTIVE')
  assert.equal(activationCodeState({ usedAt: null, expiresAt: future, attempts: 4 }, NOW), 'ACTIVE')
  assert.equal(activationCodeState({ usedAt: null, expiresAt: future, attempts: 5 }, NOW), 'LOCKED')
  assert.equal(activationCodeState({ usedAt: null, expiresAt: NOW, attempts: 0 }, NOW), 'EXPIRED')
  // A used code stays USED even after it would have expired or been locked.
  assert.equal(activationCodeState({ usedAt: NOW, expiresAt: NOW, attempts: 5 }, NOW), 'USED')
})

test('attempt lock: wrong guesses 1-4 leave tries, the 5th locks, a match verifies', () => {
  assert.equal(HOST_ACTIVATION_MAX_ATTEMPTS, 5)
  for (let a = 1; a <= 4; a++) {
    assert.deepEqual(activationAttemptOutcome({ matched: false, attemptsAfter: a }), { result: 'INVALID', attemptsRemaining: 5 - a })
  }
  assert.deepEqual(activationAttemptOutcome({ matched: false, attemptsAfter: 5 }), { result: 'LOCKED', attemptsRemaining: 0 })
  assert.deepEqual(activationAttemptOutcome({ matched: false, attemptsAfter: 9 }), { result: 'LOCKED', attemptsRemaining: 0 })
  assert.equal(activationAttemptOutcome({ matched: true, attemptsAfter: 5 }).result, 'VERIFIED')
})

test('admin host list filter', () => {
  assert.deepEqual(hostListStatusWhere('unverified'), { hostVerifiedAt: null })
  assert.deepEqual(hostListStatusWhere('VERIFIED'), { hostVerifiedAt: { not: null } })
  assert.deepEqual(hostListStatusWhere(undefined), {})
  assert.deepEqual(hostListStatusWhere('all'), {})
  assert.equal(hostListStatusWhere('bogus'), null)
})

test('visibility: stays need a verified owner, other divisions unchanged', () => {
  assert.equal(requiresHostVerification('STAYS'), true)
  assert.equal(requiresHostVerification('stays'), true)
  assert.equal(requiresHostVerification('CARS'), false)
  assert.deepEqual(publicListingVisibilityWhere('STAYS'), { owner: { hostVerifiedAt: { not: null } } })
  assert.deepEqual(publicListingVisibilityWhere('CARS'), {})
  assert.deepEqual(publicListingVisibilityWhere(undefined), {
    OR: [{ division: { notIn: ['STAYS'] } }, { owner: { hostVerifiedAt: { not: null } } }],
  })
  const stay = { status: 'APPROVED', division: 'STAYS' }
  assert.equal(isListingPubliclyVisible(stay, { hostVerifiedAt: null }), false)
  assert.equal(isListingPubliclyVisible(stay, { hostVerifiedAt: NOW }), true)
  assert.equal(isListingPubliclyVisible({ ...stay, status: 'PENDING_REVIEW' }, { hostVerifiedAt: NOW }), false)
  assert.equal(isListingPubliclyVisible({ status: 'APPROVED', division: 'CARS' }, { hostVerifiedAt: null }), true)
})
