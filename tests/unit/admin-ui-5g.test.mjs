// STEP 5G -- UX polish contracts: honest context switcher, business-language timeline, distinct error states,
// role history vs active roles, work-item guidance, button hierarchy and the confirm dialog.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadTs } from '../support/ts-load.mjs'

const ev = await loadTs('src/admin/events.ts')
const ctx = await loadTs('src/admin/context.ts')
const st = await loadTs('src/admin/states.ts')
const roles = await loadTs('src/admin/roles.ts')
const work = await loadTs('src/admin/work.ts')
const ui = await loadTs('src/admin/components/ui.tsx')
const cp = await loadTs('src/admin/components/ContextPanel.tsx')
const html = (el) => renderToStaticMarkup(el)
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// ---------- 1. context switcher honesty ----------
test('page scope: the platform choice is real only on pages that send it with their requests', () => {
  assert.equal(ctx.pageScope('/admin').kind, 'platform-filter')
  assert.equal(ctx.pageScope('/admin/work').kind, 'platform-filter')
  assert.deepEqual(ctx.pageScope('/admin/sr/restaurants'), { kind: 'fixed-platform', label: 'SR Restaurants', platformCode: 'sr_restaurants' })
  assert.equal(ctx.pageScope('/admin/sr/restaurants/orders/abc').kind, 'fixed-platform')
  assert.equal(ctx.pageScope('/admin/parties').kind, 'organization')
  assert.equal(ctx.pageScope('/admin/parties/xyz').kind, 'organization')
})
test('legal entity: one entity is shown plainly; several are never presented as a selection', () => {
  const one = ctx.legalEntityView({ organizations: [{ id: 'o', code: 'o', name: 'Org' }], legalEntities: [{ id: 'l', code: 'l', name: '9375-7649 Québec inc.', organizationId: 'o' }] })
  assert.equal(one.label, '9375-7649 Québec inc.'); assert.match(one.note, /one legal entity/)
  const many = ctx.legalEntityView({ organizations: [{ id: 'o', code: 'o', name: 'Org' }], legalEntities: [{ id: 'a', code: 'a', name: 'Alpha Inc', organizationId: 'o' }, { id: 'b', code: 'b', name: 'Beta Inc', organizationId: 'o' }] })
  assert.match(many.label, /Org · all legal entities/, 'must not pretend the first entity is the scope')
  assert.match(many.note, /not available yet/)
  assert.equal(ctx.legalEntityView(null).label, 'Organization')
})
const legal = { label: 'Co', names: ['Co'], note: 'This organization has one legal entity.' }
const plats = [{ code: 'sr_restaurants', displayName: 'SR Restaurants' }, { code: 'sr_ride', displayName: 'SR Ride' }]
test('ContextPanel on Command Center / My Work: platform radios are enabled, legal entity is plain text', () => {
  const out = html(h(cp.ContextPanel, { legal, scope: ctx.pageScope('/admin/work'), platform: 'sr_ride', platforms: plats, onPick() {} }))
  assert.doesNotMatch(out, /aria-disabled="true"/)
  assert.match(out, /role="radio"[^>]*aria-checked="true"[^>]*>(?:(?!<\/button>).)*SR Ride/s)
  assert.match(out, /Applies to Command Center and My Work/)
  assert.doesNotMatch(out, /<button[^>]*>[^<]*Co</, 'legal entity is not a button')
})
test('ContextPanel on a fixed-platform page: radios are disabled, the page coverage is shown, and the note says why', () => {
  const out = html(h(cp.ContextPanel, { legal, scope: ctx.pageScope('/admin/sr/restaurants'), platform: 'sr_ride', platforms: plats, onPick() {} }))
  const radios = out.match(/<button[^>]*role="radio"[^>]*>/g)
  assert.equal(radios.length, 3)
  for (const r of radios) assert.match(r, /aria-disabled="true"/)
  // the stored scope (SR Ride) must NOT be displayed as if it applied: the checked radio is the page's own platform
  const checked = out.match(/<button[^>]*aria-checked="true"[^>]*>.*?<\/button>/s)[0]
  assert.match(checked, /SR Restaurants/); assert.doesNotMatch(checked, /SR Ride/)
  assert.match(out, /switched off here/)
})
test('ContextPanel on an organization-wide page: radios disabled, "All platforms" shown as the real coverage', () => {
  const out = html(h(cp.ContextPanel, { legal, scope: ctx.pageScope('/admin/parties/x'), platform: 'sr_ride', platforms: plats, onPick() {} }))
  for (const r of out.match(/<button[^>]*role="radio"[^>]*>/g)) assert.match(r, /aria-disabled="true"/)
  assert.match(out.match(/<button[^>]*aria-checked="true"[^>]*>.*?<\/button>/s)[0], /All platforms/)
  assert.match(out, /whole organization/)
})
test('ContextPanel never calls onPick when the choice is switched off', () => {
  // The handler guard is in the component; verify via the rendered element's behaviour contract: disabled radios are marked.
  let picked = 0
  const el = cp.ContextPanel({ legal, scope: ctx.pageScope('/admin/parties'), platform: 'ALL', platforms: plats, onPick: () => { picked++ } })
  const radios = []
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.props?.role === 'radio') radios.push(n); walk(n.props?.children) }
  walk(el)
  assert.equal(radios.length, 3)
  radios.forEach((r) => r.props.onClick())
  assert.equal(picked, 0)
})

// ---------- 2. timeline formatter ----------
const E = (over) => ({ eventType: 'updated', summary: '', actorName: 'Mohamed Almashhour', change: null, ...over })
test('timeline: priority, status and assignment read as business sentences', () => {
  assert.equal(ev.formatEvent(E({ change: { priority: { from: 'NORMAL', to: 'HIGH' } } }), 'work_item').title, 'Priority changed from Normal to High.')
  assert.equal(ev.formatEvent(E({ change: { status: { from: 'OPEN', to: 'IN_PROGRESS' } } }), 'work_item').title, 'Status changed from Open to In progress.')
  assert.equal(ev.formatEvent(E({ change: { assigned: { fromName: null, toName: 'Sarah Mansour', unassigned: false } } }), 'work_item').title, 'Assigned to Sarah M.')
  assert.equal(ev.formatEvent(E({ change: { assigned: { fromName: 'Sarah Mansour', toName: null, unassigned: true } } }), 'work_item').title, 'Unassigned.')
  assert.equal(ev.formatEvent(E({ change: { priority: { from: 'NORMAL', to: 'HIGH' } } }), 'work_item').detail, 'by Mohamed A.')
  assert.equal(ev.formatEvent(E({ change: { status: { from: 'OPEN', to: 'DONE' }, assigned: { fromName: null, toName: 'Sarah Mansour', unassigned: false } } }), 'work_item').title, 'Status changed from Open to Done. Assigned to Sarah M.')
})
test('timeline: documents, comments, approvals, roles', () => {
  assert.equal(ev.formatEvent(E({ eventType: 'uploaded', summary: 'Uploaded Invoice.pdf' }), 'admin_document').title, 'Invoice.pdf uploaded by Mohamed A.')
  assert.equal(ev.formatEvent(E({ eventType: 'comment', summary: 'Internal comment added', actorName: 'Sarah Mansour' }), 'work_item').title, 'Sarah M. added an internal comment.')
  assert.equal(ev.formatEvent(E({ eventType: 'approved', summary: 'Approved: looks right to me', actorName: 'Finance Manager' }), 'approval_request').title, 'Finance M. approved the request.')
  assert.equal(ev.formatEvent(E({ eventType: 'approved', summary: 'Approved: looks right to me' }), 'approval_request').detail, 'Reason: looks right to me')
  assert.equal(ev.formatEvent(E({ eventType: 'status', summary: 'NEEDS_REVIEW -> VERIFIED' }), 'admin_document').title, 'Document status changed from Needs review to Verified.')
  assert.equal(ev.formatEvent(E({ eventType: 'role_added', summary: 'Role added: SR_COURIER' }), 'party').title, 'Mohamed A. added the role SR courier.')
  assert.equal(ev.formatEvent(E({ eventType: 'created', summary: 'Party created' }), 'party').title, 'Mohamed A. created this party.')
  assert.equal(ev.formatEvent(E({ eventType: 'verified', summary: 'Document verified' }), 'admin_document').title, 'Mohamed A. verified the document.')
})
test('timeline: a plain "Updated: columns" summary never exposes column names', () => {
  const f = ev.formatEvent(E({ summary: 'Updated: assignedUserId' }), 'work_item')
  assert.equal(f.title, 'Mohamed A. updated the assignee.')
  assert.doesNotMatch(JSON.stringify(f), /assignedUserId/)
  assert.equal(ev.formatEvent(E({ summary: 'Updated: secret_internal_col, weirdCol' }), 'party').title, 'Mohamed A. updated this party.')
  assert.equal(ev.formatEvent(E({ summary: 'Updated: displayName, legalName, status' }), 'party').title, 'Mohamed A. updated the name, legal name and status.')
})
test('timeline: unknown events fall back to a neutral sentence, never raw JSON, UUIDs or the stored summary', () => {
  const f = ev.formatEvent(E({ eventType: 'frobnicated', summary: '{"id":"3f2b8c1e-1111-4222-8333-444455556666","col":"x"}' }), 'work_item')
  assert.equal(f.title, 'Frobnicated recorded by Mohamed A.')
  assert.doesNotMatch(`${f.title} ${f.detail ?? ''}`, /[{}"]|3f2b8c1e|col/)
  assert.equal(ev.formatEvent(E({ eventType: 'WEIRD {x}', summary: 'whatever' })).title, 'An update was recorded.')
  assert.equal(ev.formatEvent({ eventType: 'comment', actorName: null }).title, 'A team member added an internal comment.')
})
test('timeline: no UUID can survive in any output, even from user-typed text', () => {
  const id = '3f2b8c1e-1111-4222-8333-444455556666'
  for (const e of [E({ eventType: 'uploaded', summary: `Uploaded ${id}.pdf` }), E({ eventType: 'approved', summary: `Approved: see ${id}` }), E({ eventType: 'new_version', summary: `New version 2: replaces ${id}` })]) {
    assert.doesNotMatch(JSON.stringify(ev.formatEvent(e, 'admin_document')), UUID)
  }
})
test('shortName', () => {
  assert.equal(ev.shortName('Sarah Mansour'), 'Sarah M.'); assert.equal(ev.shortName('Cher'), 'Cher'); assert.equal(ev.shortName('  '), null); assert.equal(ev.shortName(null), null)
  assert.equal(ev.shortName('Jean Luc Picard'), 'Jean P.')
})

// ---------- 12. distinct error / empty states ----------
test('error classification: six situations are never confused', () => {
  const kinds = [st.classifyError(403, 'FORBIDDEN'), st.classifyError(404, 'NOT_FOUND'), st.classifyError(0, 'NETWORK'), st.classifyError(502, ''), st.classifyError(501, ''), st.classifyError(401, ''), st.classifyError(400, 'X')]
  assert.deepEqual(kinds, ['no-permission', 'not-found', 'api-unavailable', 'api-unavailable', 'not-implemented', 'session-ended', 'error'])
  const titles = new Set(['no-permission', 'not-found', 'api-unavailable', 'not-implemented', 'session-ended'].map((k) => st.describeError({ 'no-permission': 403, 'not-found': 404, 'api-unavailable': 0, 'not-implemented': 501, 'session-ended': 401 }[k], undefined, 'm').title))
  assert.equal(titles.size, 5)
  assert.equal(st.describeError(403, '', 'm').retry, false); assert.equal(st.describeError(0, 'NETWORK', 'm').retry, true)
})
test('ErrorState / EmptyState render the state label and the right kind', () => {
  const e403 = html(h(ui.ErrorState, { error: Object.assign(new Error('x'), { status: 403, code: 'FORBIDDEN' }), onRetry() {} }))
  assert.match(e403, /data-state-kind="no-permission"/); assert.match(e403, /No permission/); assert.doesNotMatch(e403, /Try again/)
  const down = html(h(ui.ErrorState, { error: Object.assign(new Error('x'), { status: 0, code: 'NETWORK' }), onRetry() {} }))
  assert.match(down, /data-state-kind="api-unavailable"/); assert.match(down, /Try again/)
  assert.match(html(h(ui.ErrorState, { error: Object.assign(new Error('x'), { status: 404 }) })), /Record not found/)
  assert.match(html(h(ui.EmptyState, { kind: 'not-implemented', title: 'T' })), /Not implemented yet/)
  assert.match(html(h(ui.EmptyState, { kind: 'not-configured', title: 'T' })), /Platform not configured/)
  assert.match(html(h(ui.EmptyState, { kind: 'no-data', title: 'T' })), /No data yet/)
})

// ---------- 7. unconnected state / planned actions ----------
test('PlannedActions are not buttons and carry their reason; ConnectionTag has text for every state', () => {
  const out = html(h(ui.PlannedActions, { label: 'Planned', actions: [{ key: 'a', label: 'Reassign delivery', reason: 'Requires delivery module' }, { key: 'b', label: 'Request cancellation', reason: 'Requires ordering module', danger: true }] }))
  assert.doesNotMatch(out, /<button/); assert.match(out, /Requires delivery module/); assert.match(out, /is-danger/)
  assert.match(html(h(ui.ConnectionTag, { state: 'connected' })), /Connected/)
  assert.match(html(h(ui.ConnectionTag, { state: 'pending' })), /Not yet connected/)
  assert.match(html(h(ui.ConnectionTag, { state: 'fixture' })), /Fixture data/)
})

// ---------- 8. role history vs active ----------
test('role state: active, pending and historical are never mixed up', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  assert.equal(roles.roleState({ status: 'ACTIVE', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null }, now), 'ACTIVE')
  assert.equal(roles.roleState({ status: 'ACTIVE', effectiveFrom: '2026-12-01T00:00:00Z', effectiveTo: null }, now), 'PENDING')
  assert.equal(roles.roleState({ status: 'ACTIVE', effectiveFrom: '2025-01-01T00:00:00Z', effectiveTo: '2026-06-01T00:00:00Z' }, now), 'HISTORICAL')
  assert.equal(roles.roleState({ status: 'RETIRED', effectiveFrom: '2025-01-01T00:00:00Z', effectiveTo: null }, now), 'HISTORICAL')
  assert.equal(roles.roleState({ status: 'PENDING', effectiveFrom: null, effectiveTo: null }, now), 'PENDING')
  const g = roles.groupRoles([{ id: 1, status: 'ACTIVE', effectiveFrom: null, effectiveTo: null }, { id: 2, status: 'RETIRED', effectiveFrom: null, effectiveTo: null }], now)
  assert.deepEqual([g.ACTIVE.length, g.PENDING.length, g.HISTORICAL.length], [1, 0, 1])
})

// ---------- 4. work-item guidance ----------
const W = (o) => ({ type: 'DOCUMENT_REVIEW', status: 'OPEN', priority: 'NORMAL', risk: 'NONE', dueAt: null, assignedUserId: 'u1', assignedTeam: null, linkedEntityType: null, ...o })
test('work guidance explains the situation from real fields and does not just repeat the type', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const g = work.workGuidance(W({ priority: 'URGENT', status: 'BLOCKED', dueAt: '2026-10-10T00:00:00Z', risk: 'HIGH', assignedUserId: null }), 'me', now)
  assert.ok(g.why.length >= 5); assert.ok(g.why.some((x) => /Blocked/.test(x)) && g.why.some((x) => /overdue/.test(x)) && g.why.some((x) => /urgent priority/.test(x)) && g.why.some((x) => /high risk/.test(x)) && g.why.some((x) => /Nobody is assigned/.test(x)))
  assert.match(g.todo[0], /Assign it to yourself/)
  assert.deepEqual(work.workGuidance(W({ status: 'DONE' }), 'me', now).todo, ['Nothing further is needed.'])
  assert.match(work.workGuidance(W({ assignedUserId: 'other' }), 'me', now).todo[0], /assigned to someone else/)
  assert.match(work.BASIS_NOTE, /No item-specific reason is recorded/)
})

// ---------- 10. button hierarchy + confirmation ----------
test('buttons: four distinct variants, danger never looks like a routine button', () => {
  const classes = ['primary', 'secondary', 'tertiary', 'danger'].map((v) => html(h(ui.Button, { variant: v }, 'x')).match(/class="([^"]+)"/)[1])
  assert.equal(new Set(classes).size, 4)
  assert.match(classes[3], /adm-btn-danger/); assert.doesNotMatch(classes[3], /primary|secondary/)
  assert.match(html(h(ui.Button, {}, 'x')), /type="button"/)
})
test('ConfirmDialog: alertdialog semantics, consequence text, Cancel is the default focus, danger confirm is distinct', () => {
  const out = html(h(ui.ConfirmDialog, { open: true, title: 'Cancel this order?', confirmLabel: 'Cancel order', onConfirm() {}, onCancel() {} }, 'The customer will be refunded.'))
  assert.match(out, /role="alertdialog"/); assert.match(out, /aria-modal="true"/); assert.match(out, /aria-labelledby=/); assert.match(out, /aria-describedby=/)
  assert.match(out, /data-autofocus[^>]*>Cancel</); assert.match(out, /adm-btn-danger is-solid/); assert.match(out, /The customer will be refunded/)
  assert.equal(html(h(ui.ConfirmDialog, { open: false, title: 't', confirmLabel: 'c', onConfirm() {}, onCancel() {} }, 'x')), '')
})

// ---------- mobile My Work: badge order and card model ----------
const CI = (o) => ({ id: 'w1', title: 'T', platformId: null, createdAt: '2026-10-20T09:00:00Z', overdue: false, assignedUserName: null, type: 'DOCUMENT_REVIEW', status: 'OPEN', priority: 'NORMAL', risk: 'NONE', dueAt: null, assignedUserId: 'me', assignedTeam: null, linkedEntityType: null, ...o })
test('card badges always follow the same order: priority, status, risk, overdue', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const keys = (o) => work.cardModel(CI(o), 'me', now).badges.map((b) => b.key)
  assert.deepEqual(keys({}), ['priority', 'status'])
  assert.deepEqual(keys({ priority: 'URGENT', risk: 'HIGH', overdue: true, dueAt: '2026-10-18T00:00:00Z' }), ['priority', 'status', 'risk', 'overdue'])
  assert.deepEqual(keys({ status: 'IN_PROGRESS', risk: 'HIGH' }), ['priority', 'status', 'risk'])
  assert.deepEqual(keys({ overdue: true }), ['priority', 'status', 'overdue'])
  for (const st of ['OPEN', 'IN_PROGRESS', 'BLOCKED']) for (const rk of ['NONE', 'LOW', 'MEDIUM', 'HIGH']) for (const od of [true, false]) {
    const k = keys({ status: st, risk: rk, overdue: od })
    const order = ['priority', 'status', 'risk', 'overdue']
    assert.deepEqual(k, [...k].sort((a, b) => order.indexOf(a) - order.indexOf(b)), 'never out of order')
    assert.ok(k.length <= 4)
  }
})
test('card: lower risk and the due date live in the quiet metadata line, not in extra chips', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const m = work.cardModel(CI({ risk: 'MEDIUM', dueAt: '2026-10-25T12:00:00Z', createdAt: '2026-10-20T09:00:00Z' }), 'me', now)
  assert.deepEqual(m.badges.map((b) => b.key), ['priority', 'status'])
  assert.deepEqual(m.meta, ['Medium risk', 'Assigned to you', '3h old', `Due ${new Date('2026-10-25T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`])
  assert.ok(work.cardModel(CI({ risk: 'HIGH' }), 'me', now).badges.some((b) => b.key === 'risk'))
  assert.ok(!work.cardModel(CI({ risk: 'HIGH' }), 'me', now).meta.some((x) => /risk/.test(x)), 'high risk is a badge, not repeated in the metadata')
  assert.ok(!work.cardModel(CI({ status: 'DONE', overdue: true }), 'me', now).badges.some((b) => b.key === 'overdue'), 'closed items are never "overdue"')
})
test('card badges carry text, a shape (from StatusBadge) and screen-reader context: never colour alone', () => {
  const b = work.cardModel(CI({ priority: 'HIGH' }), 'me').badges[0]
  assert.equal(b.label, 'High'); assert.equal(b.srSuffix, ' priority')
})
test('assignee wording', () => {
  assert.equal(work.assigneeLabel({ assignedUserId: 'me', assignedUserName: null, assignedTeam: null }, 'me'), 'Assigned to you')
  assert.equal(work.assigneeLabel({ assignedUserId: 'x', assignedUserName: 'Nadia Khoury', assignedTeam: null }, 'me'), 'Assigned to Nadia Khoury')
  assert.equal(work.assigneeLabel({ assignedUserId: null, assignedUserName: null, assignedTeam: null }, 'me'), 'Unassigned')
})
test('TaskCard reads title, platform, badges, then metadata; the platform is its own element', () => {
  const out = html(h(ui.TaskCard, { title: 'Review licence', platform: 'SR Restaurants', badges: 'B', meta: 'M', onOpen() {} }))
  const order = ['adm-task-title', 'adm-task-plat', 'adm-task-badges', 'adm-task-meta'].map((c) => out.indexOf(c))
  assert.deepEqual(order, [...order].sort((a, b) => a - b)); assert.ok(order.every((i) => i > 0))
  assert.doesNotMatch(html(h(ui.TaskCard, { title: 'x', meta: 'm', badges: 'b', onOpen() {} })), /adm-task-plat/)
})
test('Tabs: a scrollable strip that exposes the overflow cue and keeps every label in full', () => {
  const out = html(h(ui.Tabs, { tabs: [{ key: 'a', label: 'My Tasks' }, { key: 'b', label: 'High Priority', count: 3 }], value: 'a', onChange() {}, label: 'Work views', idPrefix: 'w' }))
  assert.match(out, /adm-tabs-wrap/); assert.match(out, /data-more-right="false"/); assert.match(out, /High Priority/); assert.match(out, /role="tablist"/)
})
test('PageHeader can hide breadcrumbs on phones only', () => {
  assert.match(html(h(ui.PageHeader, { title: 'My Work', crumbs: [{ label: 'A', to: '/a' }, { label: 'B' }], hideCrumbsOnPhone: true })), /adm-crumbs hide-phone/)
  assert.doesNotMatch(html(h(ui.PageHeader, { title: 'X', crumbs: [{ label: 'A' }] })), /hide-phone/)
})
test('SidePanel sheet variant exposes a footer and dialog semantics', () => {
  const out = html(h(ui.SidePanel, { open: true, onClose() {}, title: 'Filters and sort', variant: 'sheet', footer: h('button', null, 'Apply') }, 'body'))
  assert.match(out, /adm-panel is-sheet/); assert.match(out, /role="dialog"/); assert.match(out, /adm-panel-f/); assert.match(out, /Apply/)
})
