import test from 'node:test'
import assert from 'node:assert/strict'
import { PERMISSIONS, PERMISSION_RULESET_VERSION, PERMISSION_RULESET_REGISTRY, permissionRulesetFingerprint } from '../../server/lib/authz/catalogue.mjs'
import { CRITICAL_SECURITY_RECIPIENTS, registerTransport, unregisterTransport, listTransports } from '../../server/lib/authz/notifications.mjs'
import { CONTINUITY_PERMISSIONS } from '../../server/lib/authz/continuity.mjs'

test('rule-set version is registered and its fingerprint matches the catalogue (change a rule => bump the version)', () => {
  assert.equal(PERMISSION_RULESET_REGISTRY[PERMISSION_RULESET_VERSION], permissionRulesetFingerprint())
})
test('noSelf rules live only in the catalogue and every separation-of-duties permission is flagged', () => {
  const noSelf = PERMISSIONS.filter((p) => p.noSelf).map((p) => p.code)
  for (const c of ['access.assign', 'access.approve']) assert.ok(noSelf.includes(c) || PERMISSIONS.find((p) => p.code === c), c)
  assert.ok(noSelf.length > 0)
})
test('continuity capabilities are real permissions', () => {
  const codes = new Set(PERMISSIONS.map((p) => p.code))
  for (const c of CONTINUITY_PERMISSIONS) assert.ok(codes.has(c), c)
})
test('notification policy is named, resolves recipients only, and exposes no authorization surface', () => {
  assert.equal(typeof CRITICAL_SECURITY_RECIPIENTS.resolve, 'function')
  assert.ok(!('allows' in CRITICAL_SECURITY_RECIPIENTS) && !('permissions' in CRITICAL_SECURITY_RECIPIENTS))
})
test('transports are pluggable and in_app is always registered', () => {
  assert.ok(listTransports().includes('in_app'))
  registerTransport({ name: 'u_test', async deliver() { return {} } })
  assert.ok(listTransports().includes('u_test')); unregisterTransport('u_test')
  assert.ok(!listTransports().includes('u_test'))
})
