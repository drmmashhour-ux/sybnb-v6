import test from 'node:test'
import assert from 'node:assert/strict'
import { computeLanding } from '../../server/lib/authz/landing.mjs'

const P = (...c) => new Set(c)
const plat = (code, route) => ({ code, route })

test('org-level operator lands on the Command Center', () => {
  assert.equal(computeLanding({ permissions: P('admin.console.access', 'iam.role.manage', 'sec.event.read'), authorizedPlatforms: [] }).route, '/admin')
})
test('accountant-only lands on the Accountant Center', () => {
  assert.equal(computeLanding({ permissions: P('admin.console.access', 'acct.center.read'), authorizedPlatforms: [] }).route, '/admin/accountant')
})
test('single-platform manager lands on that platform', () => {
  assert.equal(computeLanding({ permissions: P('admin.console.access', 'platform.shell.read'), authorizedPlatforms: [plat('str', '/admin/str')] }).route, '/admin/str')
})
test('support-only lands on Support', () => {
  assert.equal(computeLanding({ permissions: P('admin.console.access', 'support.case.read'), authorizedPlatforms: [] }).route, '/admin/support')
})
test('no usable permission falls back to /admin (never a route the user cannot open)', () => {
  assert.equal(computeLanding({ permissions: P(), authorizedPlatforms: [] }).route, '/admin')
})
