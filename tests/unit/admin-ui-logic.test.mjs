// STEP 5F -- pure logic behind the admin console: formatting, navigation visibility, route ownership.
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from '../support/ts-load.mjs'
import { PERMISSIONS, REGISTRY_SEED } from '../../server/lib/authz/catalogue.mjs'

const fmt = await loadTs('src/admin/format.ts')
const nav = await loadTs('src/admin/nav.ts')
const permCodes = new Set(PERMISSIONS.map((p) => p.code))

test('ageLabel / elapsedLabel / dueLabel are honest about missing and bad input', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  assert.equal(fmt.ageLabel(null, now), '—')
  assert.equal(fmt.ageLabel('not a date', now), '—')
  assert.equal(fmt.ageLabel('2026-10-20T11:59:30Z', now), 'just now')
  assert.equal(fmt.ageLabel('2026-10-20T09:00:00Z', now), '3h')
  assert.equal(fmt.ageLabel('2026-10-17T12:00:00Z', now), '3d')
  assert.equal(fmt.elapsedLabel('2026-10-20T11:21:00Z', now), '39m 00s')
  assert.equal(fmt.elapsedLabel('2026-10-20T10:00:00Z', now), '2h 00m')
  assert.deepEqual(fmt.dueLabel(null, now), { text: 'No due date', overdue: false })
  assert.equal(fmt.dueLabel('2026-10-19T00:00:00Z', now).overdue, true)
  assert.equal(fmt.dueLabel('2026-10-25T00:00:00Z', now).overdue, false)
})

test('initials ignore punctuation-led words; humanize and splitPath behave', () => {
  assert.equal(fmt.initials('Layla Haddad'), 'LH')
  assert.equal(fmt.initials('Demo Pizzeria (fixture)'), 'DP')
  assert.equal(fmt.initials('   '), '?')
  assert.equal(fmt.humanize('DOCUMENT_REVIEW'), 'Document review')
  assert.equal(fmt.humanize(null), '—')
  assert.equal(fmt.humanize('SR_COURIER'), 'SR courier')
  assert.equal(fmt.humanize('MARKETPLACE_SELLER'), 'Marketplace seller')
  const s = fmt.splitPath('/admin/work?open=abc&x=1')
  assert.equal(s.pathname, '/admin/work')
  assert.equal(s.query.get('open'), 'abc')
})

test('every permission and platform the sidebar references really exists (no invented codes)', () => {
  const platforms = new Set(REGISTRY_SEED.platforms.map((p) => p.code))
  const walk = (items) => items.flatMap((i) => [i, ...(i.children ? walk(i.children) : [])])
  for (const g of nav.NAV) for (const i of walk(g.items)) {
    if (i.perm) assert.ok(permCodes.has(i.perm), `unknown permission ${i.perm} on ${i.label}`)
    for (const p of i.anyPerm ?? []) assert.ok(permCodes.has(p), `unknown permission ${p} on ${i.label}`)
    if (i.platform) assert.ok(platforms.has(i.platform), `unknown platform ${i.platform} on ${i.label}`)
  }
})

test('sidebar has the five required groups in order and every required entry', () => {
  assert.deepEqual(nav.NAV.map((g) => g.label), ['Command Center', 'Operations', 'Company', 'Finance', 'Administration'])
  const labels = nav.NAV.flatMap((g) => g.items.flatMap((i) => [i.label, ...(i.children ?? []).map((c) => c.label)]))
  for (const need of ['My Work', 'Approvals', 'SYBNB STR', 'SR', 'Ride', 'Restaurants', 'Drivers & Couriers', 'Vehicles', 'Syntrise', 'Marketplace', 'Cars', 'Jobloop', 'Radio Mailo', 'Parties', 'Documents', 'Support', 'AI Controller', 'Reports', 'Finance', 'Tax', 'Accountant Center', 'Users & Access', 'Security', 'Audit', 'Platform Health', 'Configuration']) assert.ok(labels.includes(need), `missing nav entry ${need}`)
})

test('navigation shows nothing the user has no permission or platform authorization for', () => {
  const none = nav.visibleNav({ permissions: new Set(), authorizedPlatforms: new Set() })
  assert.deepEqual(none, [], 'a user with no permissions sees an empty sidebar')
  const support = nav.visibleNav({ permissions: new Set(['console.access', 'work.view', 'support.view']), authorizedPlatforms: new Set(['sr_ride']) })
  const labels = support.flatMap((g) => g.items.flatMap((i) => [i.label, ...(i.children ?? []).map((c) => c.label)]))
  assert.ok(labels.includes('My Work') && labels.includes('Support') && labels.includes('Ride'))
  for (const hidden of ['Finance', 'Tax', 'Audit', 'Security', 'Configuration', 'Restaurants', 'Parties', 'Syntrise']) assert.ok(!labels.includes(hidden), `${hidden} must be hidden`)
})

test('hiding is cosmetic: the console path list is explicit and leaves every legacy admin page alone', () => {
  for (const ok of ['/admin', '/admin/work', '/admin/parties', '/admin/parties/abc', '/admin/sr/restaurants', '/admin/sr/restaurants/orders/123']) assert.equal(nav.isConsolePath(ok), true, ok)
  for (const legacy of ['/admin/ops', '/admin/drivers', '/admin/sr/rides', '/admin/food', '/admin/money', '/admin/customers/1', '/admin/sr/promo-codes', '/admin/parties/a/b', '/admin/work/x', '/administrator', '/admin/']) assert.equal(nav.isConsolePath(legacy), false, legacy)
})
