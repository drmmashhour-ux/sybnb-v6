import test from 'node:test'
import assert from 'node:assert/strict'
import { syncClock, trustedNow, clockStatus, _resetClockForTests } from '../../server/lib/authz/clock.mjs'
import { resolveActivationMode } from '../../server/lib/authz/activation-worker.mjs'
import { isAssignmentActiveAt } from '../../server/lib/authz/evaluate.mjs'

test('trustedNow follows the database clock, not the host clock', async () => {
  _resetClockForTests()
  await syncClock(null, { sample: async () => new Date(Date.now() + 9_000) })
  const d = trustedNow().getTime() - Date.now()
  assert.ok(Math.abs(d - 9_000) < 50, `offset ${d}`)
  await syncClock(null, { sample: async () => new Date(Date.now() - 4_000) })
  assert.ok(clockStatus().offsetMs !== 0)
  _resetClockForTests()
  assert.equal(clockStatus().offsetMs, 0)
})
test('the lowest round-trip sample wins, so one slow query cannot skew the offset', async () => {
  _resetClockForTests()
  await syncClock(null, { sample: async () => new Date(Date.now() + 1_000) }) // fast, accurate
  await syncClock(null, { sample: async () => { await new Promise((r) => setTimeout(r, 120)); return new Date(Date.now() + 1_000 + 60) } }) // slow, biased
  assert.ok(Math.abs(clockStatus().offsetMs - 1_000) < 30, `offset ${clockStatus().offsetMs}`)
  _resetClockForTests()
})
test('activation scheduler mode resolution', () => {
  assert.deepEqual(resolveActivationMode({}).mode, 'IN_PROCESS')
  assert.equal(resolveActivationMode({}).warning, null)
  assert.match(resolveActivationMode({ NODE_ENV: 'production' }).warning, /EXTERNAL/)
  assert.equal(resolveActivationMode({ ADMIN_ACTIVATION_MODE: 'external' }).mode, 'EXTERNAL')
  assert.equal(resolveActivationMode({ ADMIN_ACTIVATION_MODE: 'EXTERNAL', NODE_ENV: 'production' }).warning, null)
  assert.equal(resolveActivationMode({ ADMIN_ACTIVATION_MODE: 'DISABLED' }).mode, 'DISABLED')
  assert.equal(resolveActivationMode({ ADMIN_ACTIVATION_JOB: 'off' }).mode, 'DISABLED')
  assert.equal(resolveActivationMode({ ADMIN_ACTIVATION_MODE: 'IN_PROCESS', ADMIN_ACTIVATION_JOB: 'off' }).mode, 'IN_PROCESS', 'explicit mode wins over the legacy switch')
  const bad = resolveActivationMode({ ADMIN_ACTIVATION_MODE: 'sometimes' })
  assert.equal(bad.mode, 'DISABLED'); assert.ok(bad.warning)
})
test('boundary: activation_at is compared strictly (>= allows, 1 ms earlier denies); effective_from and effective_to likewise', () => {
  const T = Date.parse('2026-10-19T12:00:00.000Z')
  const a = { status: 'PENDING_ACTIVATION', approvedAt: new Date(T - 48 * 3_600_000), activationAt: new Date(T), effectiveFrom: new Date(T - 48 * 3_600_000), effectiveTo: null, revokedAt: null }
  assert.equal(isAssignmentActiveAt(a, T - 1), false)
  assert.equal(isAssignmentActiveAt(a, T), true)
  const b = { status: 'ACTIVE', activationAt: null, approvedAt: null, effectiveFrom: new Date(T), effectiveTo: new Date(T + 1000), revokedAt: null }
  assert.equal(isAssignmentActiveAt(b, T - 1), false); assert.equal(isAssignmentActiveAt(b, T), true)
  assert.equal(isAssignmentActiveAt(b, T + 999), true); assert.equal(isAssignmentActiveAt(b, T + 1000), false, 'effective_to is exclusive')
  const c = { ...b, effectiveFrom: new Date(T - 1000), effectiveTo: null, revokedAt: new Date(T) }
  assert.equal(isAssignmentActiveAt(c, T - 1), true); assert.equal(isAssignmentActiveAt(c, T), false, 'revoked_at is effective from that instant')
})
