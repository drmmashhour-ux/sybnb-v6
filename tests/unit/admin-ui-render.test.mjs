// STEP 5F -- server-render the shared components and assert the accessibility / real-data contract in the HTML.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadTs } from '../support/ts-load.mjs'

const ui = await loadTs('src/admin/components/ui.tsx')
const dt = await loadTs('src/admin/components/DataTable.tsx')
const html = (el) => renderToStaticMarkup(el)

test('StatusBadge: every tone carries a text label AND a shape, never colour alone', () => {
  for (const tone of ['pos', 'info', 'warn', 'crit', 'neu']) {
    const out = html(h(ui.StatusBadge, { tone }, 'Label'))
    assert.match(out, /Label/); assert.match(out, /<svg[^>]*aria-hidden="true"/); assert.match(out, new RegExp(`adm-t-${tone}`))
  }
  const shapes = new Set(['pos', 'info', 'warn', 'crit', 'neu'].map((t) => html(h(ui.StatusBadge, { tone: t }, 'x')).match(/<svg.*<\/svg>/)[0]))
  assert.equal(shapes.size, 5, 'each tone has its own shape')
})

test('RiskBadge: no risk is a dash with a label, a risk is spelled out', () => {
  assert.match(html(h(ui.RiskBadge, { risk: 'NONE' })), /aria-label="No risk flagged"/)
  assert.match(html(h(ui.RiskBadge, { risk: 'HIGH' })), /High risk/)
})

test('MetricCard never invents a number: missing data says "Not available"', () => {
  assert.match(html(h(ui.MetricCard, { label: 'Live orders', value: null })), /Not available/)
  assert.doesNotMatch(html(h(ui.MetricCard, { label: 'Live orders', value: null })), />0</)
  assert.match(html(h(ui.MetricCard, { label: 'Support', value: 7 })), />7</)
})

test('PlatformCard without a built screen says so and has no link', () => {
  const out = html(h(ui.PlatformCard, { name: 'Cars', status: 'SETUP', statusLabel: 'Setup', attention: null }))
  assert.match(out, /Module coming soon/); assert.doesNotMatch(out, /<a /); assert.match(out, /No attention data reported/)
  assert.match(html(h(ui.PlatformCard, { name: 'SR Restaurants', status: 'SETUP', statusLabel: 'Setup', attention: 3, href: '/admin/sr/restaurants' })), /href="#\/admin\/sr\/restaurants"/)
})

test('Tabs: tablist semantics, one tab in the tab order, selection exposed', () => {
  const out = html(h(ui.Tabs, { tabs: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', count: 3 }, { key: 'c', label: 'C', hidden: true }], value: 'b', onChange() {}, label: 'Sections', idPrefix: 'x' }))
  assert.match(out, /role="tablist"[^>]*aria-label="Sections"/)
  assert.equal((out.match(/role="tab"/g) ?? []).length, 2, 'hidden tab is not rendered')
  assert.match(out, /aria-selected="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-selected="true"/)
  assert.equal((out.match(/tabindex="-1"/g) ?? []).length, 1)
})

test('DataTable: caption, scoped headers, aria-sort, labelled region and pagination', () => {
  const cols = [{ key: 'n', header: 'Name', sortKey: 'name', primary: true, render: (r) => r.n }, { key: 's', header: 'Status', render: (r) => r.s }]
  const out = html(h(dt.DataTable, { caption: 'People', columns: cols, rows: [{ id: '1', n: 'Ann', s: 'Active' }], rowKey: (r) => r.id, empty: h('p', null, 'none'), sort: { key: 'name', dir: 'asc' }, onSort() {}, page: 1, totalPages: 3, total: 61, onPage() {} }))
  assert.match(out, /<caption[^>]*>People<\/caption>/); assert.match(out, /scope="col"/); assert.match(out, /aria-sort="ascending"/)
  assert.match(out, /role="region"[^>]*aria-label="People table"|aria-label="People table"[^>]*role="region"/)
  assert.match(out, /aria-label="People pagination"/); assert.match(out, /61 results · page 1 of 3/)
  assert.match(out, /data-label="Name"/); assert.match(out, /disabled=""[^>]*>Previous/)
})

test('DataTable: empty and error states replace the table (no ghost rows)', () => {
  const cols = [{ key: 'n', header: 'Name', render: (r) => r.n }]
  assert.match(html(h(dt.DataTable, { caption: 'X', columns: cols, rows: [], rowKey: (r) => r.id, empty: h('p', null, 'Nothing here') })), /Nothing here/)
  const err = Object.assign(new Error('Forbidden'), { status: 403, code: 'PERMISSION_DENIED' })
  const out = html(h(dt.DataTable, { caption: 'X', columns: cols, rows: [], rowKey: (r) => r.id, empty: null, error: err }))
  assert.match(out, /role="alert"/); assert.match(out, /do not have access/); assert.doesNotMatch(out, /<table/)
})

test('ErrorState: 403 offers no retry loop, 500 does', () => {
  assert.doesNotMatch(html(h(ui.ErrorState, { error: Object.assign(new Error('x'), { status: 403 }), onRetry() {} })), /Try again/)
  assert.match(html(h(ui.ErrorState, { error: Object.assign(new Error('boom'), { status: 500 }), onRetry() {} })), /Try again/)
})

test('SidePanel: a modal dialog with an accessible name and a labelled close button', () => {
  const out = html(h(ui.SidePanel, { open: true, onClose() {}, title: 'Task', children: 'body' }))
  assert.match(out, /role="dialog"/); assert.match(out, /aria-modal="true"/); assert.match(out, /aria-labelledby=/); assert.match(out, /aria-label="Close panel"/)
  assert.equal(html(h(ui.SidePanel, { open: false, onClose() {}, title: 'Task', children: 'x' })), '')
})

test('ActionMenu: disabled actions state why instead of silently doing nothing', async () => {
  const out = html(h(ui.ActionMenu, { label: 'Actions', actions: [{ key: 'a', label: 'Cancel order', disabledReason: 'Coming soon' }] }))
  assert.match(out, /aria-haspopup="menu"/); assert.match(out, /aria-expanded="false"/)
})

test('fixtures are unreachable unless the dev server opts in', async () => {
  const off = await loadTs('src/admin/fixtures.ts', { dev: false })
  assert.equal(off.FIXTURES_ENABLED, false); assert.equal(await off.loadFixtures(), null)
  const on = await loadTs('src/admin/fixtures.ts', { dev: true })
  assert.equal(on.FIXTURES_ENABLED, true)
  const f = await on.loadFixtures()
  assert.ok(f && /fixture/i.test(f.order('fx-1001').restaurant), 'fixture data is labelled as fixture')
  assert.equal(f.order('anything-else'), null)
})
