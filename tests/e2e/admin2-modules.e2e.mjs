// STEP 5 -- module APIs over real HTTP (test DB only): work, approvals, parties, documents, support,
// config, search, security/audit, shells, command center.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const le = await p.legalEntity.findFirst({ where: { code: 'LE-9375-7649' } })
const ORG = [{ kind: 'ORGANIZATION', organizationId: org.id }]
const LE = [{ kind: 'LEGAL_ENTITY', legalEntityId: le.id }]
const plat = Object.fromEntries((await p.platform.findMany()).map((x) => [x.code, x]))
const mk = async (label, role, scopes = ORG) => { const u = await createStaffUser(label, run); await assignRole(u, role, scopes); return { u, s: await loginAsStaff(api, u) } }

const [o1, o2, str, sup, acct, rest, secu, fin] = await Promise.all([
  mk('o1', 'OWNER'), mk('o2', 'OWNER'), mk('str', 'STR_MANAGER', LE), mk('sup', 'SUPPORT_AGENT'), mk('acct', 'EXTERNAL_ACCOUNTANT'),
  mk('rest', 'RESTAURANT_OPS', LE), mk('secu', 'SECURITY_ADMIN'), mk('fin', 'FINANCE_VIEWER'),
])
const H = (x) => x.s.http
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

await t('work items are platform-scoped: STR manager sees STR items, never SR items; direct PATCH is denied', async () => {
  const a = await H(o1).post('/api/admin2/work/items', { type: 'PLATFORM_SETUP', title: `STR setup ${run}`, platformId: plat.str.id, priority: 'HIGH' })
  const b = await H(o1).post('/api/admin2/work/items', { type: 'PLATFORM_SETUP', title: `SR setup ${run}`, platformId: plat.sr_ride.id })
  assert.equal(a.status, 201); assert.equal(b.status, 201)
  const list = await H(str).get(`/api/admin2/work/items?view=all&pageSize=100`)
  assert.equal(list.status, 200)
  const titles = list.json.items.map((x) => x.title)
  assert.ok(titles.includes(`STR setup ${run}`)); assert.equal(titles.includes(`SR setup ${run}`), false)
  assert.equal((await H(str).patch(`/api/admin2/work/items/${b.json.item.id}`, { status: 'DONE' })).status, 403)
  assert.equal((await H(str).patch(`/api/admin2/work/items/${a.json.item.id}`, { status: 'IN_PROGRESS' })).status, 200)
  assert.equal((await H(acct).get('/api/admin2/work/items')).status, 403)
})

await t('work: validation, assignment notifies, saved views are per user', async () => {
  assert.equal((await H(o1).post('/api/admin2/work/items', { type: 'BOGUS', title: 'x' })).status, 400)
  const w = await H(o1).post('/api/admin2/work/items', { type: 'APPROVAL', title: `assign ${run}` })
  const asg = await H(o1).patch(`/api/admin2/work/items/${w.json.item.id}`, { assignedUserId: o2.u.id })
  assert.equal(asg.status, 200)
  const n = await H(o2).get('/api/admin2/notifications?unread=true')
  assert.ok(n.json.unread >= 1)
  const mine = await H(o2).get('/api/admin2/work/items?view=mine')
  assert.ok(mine.json.items.some((x) => x.id === w.json.item.id))
  await H(o2).post('/api/admin2/work/views', { name: 'My urgent', filters: { view: 'mine', priority: 'URGENT' } })
  assert.equal((await H(o2).get('/api/admin2/work/views')).json.views.length, 1)
  assert.equal((await H(o1).get('/api/admin2/work/views')).json.views.length, 0)
  const nid = n.json.items[0].id
  assert.equal((await H(o1).post(`/api/admin2/notifications/${nid}/read`)).json.updated, 0, 'cannot read someone else\'s notification')
  assert.equal((await H(o2).post(`/api/admin2/notifications/${nid}/read`)).json.updated, 1)
})

await t('approvals: self-decision refused, decision recorded, financial refused', async () => {
  const req = await H(o1).post('/api/admin2/approvals', { subjectType: 'platform', subjectId: plat.cars.id, title: `Enable Cars ${run}` })
  assert.equal(req.status, 201, req.text)
  assert.equal((await H(o1).post(`/api/admin2/approvals/${req.json.id}/decide`, { decision: 'APPROVE', reason: 'approving my own' })).status, 400)
  assert.equal((await H(o2).post(`/api/admin2/approvals/${req.json.id}/decide`, { decision: 'APPROVE', reason: 'reviewed and fine' })).status, 200)
  const d = await H(o2).get(`/api/admin2/approvals/${req.json.id}`)
  assert.equal(d.json.approval.status, 'APPROVED')
  assert.equal((await H(o1).post('/api/admin2/approvals', { kind: 'FINANCIAL', subjectType: 'payout', subjectId: randomUUID(), title: 'x' })).status, 400)
  assert.equal((await H(o2).post(`/api/admin2/approvals/${req.json.id}/decide`, { decision: 'REJECT', reason: 'changing my mind' })).status, 409)
})

await t('approvals: material change after request INVALIDATES instead of approving', async () => {
  const req = await H(o1).post('/api/admin2/approvals', { subjectType: 'platform', subjectId: plat.jobloop.id, title: `Enable Jobloop ${run}` })
  const before = await p.platform.findUnique({ where: { id: plat.jobloop.id } })
  await p.platform.update({ where: { id: plat.jobloop.id }, data: { status: before.status === 'SETUP' ? 'NO_DATA' : 'SETUP' } })
  const view = await H(o2).get(`/api/admin2/approvals/${req.json.id}`)
  assert.equal(view.json.materialChange.changed, true)
  const dec = await H(o2).post(`/api/admin2/approvals/${req.json.id}/decide`, { decision: 'APPROVE', reason: 'looks good to me' })
  assert.equal(dec.status, 409); assert.equal(dec.json.error.code, 'MATERIAL_CHANGE')
  assert.equal((await p.approvalRequest.findUnique({ where: { id: req.json.id } })).status, 'INVALIDATED')
  await p.platform.update({ where: { id: plat.jobloop.id }, data: { status: before.status } })
})

await t('parties: multiple roles shown together; list masks contacts; sensitive detail needs tier-3 permission; scoped visibility', async () => {
  const c = await H(o1).post('/api/admin2/parties', { kind: 'PERSON', displayName: `Multi Role ${run}`, email: 'multi.role@example.invalid', phone: '+15145550123', roles: ['HOST', 'DRIVER'] })
  assert.equal(c.status, 201, c.text)
  await H(o1).post(`/api/admin2/parties/${c.json.id}/roles`, { roleType: 'HOST', platformId: plat.str.id })
  await H(o1).post(`/api/admin2/parties/${c.json.id}/roles`, { roleType: 'DRIVER', platformId: plat.sr_ride.id })
  assert.equal((await H(o1).post(`/api/admin2/parties/${c.json.id}/roles`, { roleType: 'HOST', platformId: plat.str.id })).status, 409)
  const list = await H(o1).get(`/api/admin2/parties?q=${encodeURIComponent('Multi Role ' + run)}`)
  assert.equal(list.json.items[0].email.includes('multi.role'), false, 'list is masked')
  const detail = await H(o1).get(`/api/admin2/parties/${c.json.id}`)
  assert.equal(detail.json.party.email, 'multi.role@example.invalid')
  assert.ok(detail.json.roles.length >= 4)
  const strView = await H(str).get(`/api/admin2/parties/${c.json.id}`)
  assert.equal(strView.status, 200); assert.equal(strView.json.party.contactMasked, true); assert.equal(strView.json.party.email.includes('multi.role'), false)
  const only = await H(o1).post('/api/admin2/parties', { kind: 'ORGANIZATION', displayName: `SR Only ${run}`, roles: [] })
  await H(o1).post(`/api/admin2/parties/${only.json.id}/roles`, { roleType: 'VENDOR', platformId: plat.sr_restaurants.id })
  assert.equal((await H(str).get(`/api/admin2/parties/${only.json.id}`)).status, 403, 'STR manager cannot open a party with no STR role')
  assert.equal((await H(str).get(`/api/admin2/parties?q=${encodeURIComponent('SR Only ' + run)}`)).json.items.length, 0)
})

let docId, v1
await t('documents: upload stores hash, rejects bad content, self-review forbidden, verified by another person', async () => {
  const bad = await H(o1).post('/api/admin2/documents', { title: 'bad', documentType: 'ID', file: { base64: Buffer.from('not a png').toString('base64'), contentType: 'image/png', filename: 'x.png' } })
  assert.equal(bad.status, 400)
  const up = await H(o1).post('/api/admin2/documents', { title: `ID ${run}`, documentType: 'IDENTITY', platformId: plat.str.id, file: { base64: PNG.toString('base64'), contentType: 'image/png', filename: 'id.png' } })
  assert.equal(up.status, 201, up.text)
  docId = up.json.id; v1 = up.json.versionId
  assert.equal(up.json.sha256, createHash('sha256').update(PNG).digest('hex'))
  assert.equal((await H(o1).post(`/api/admin2/documents/${docId}/review`, { decision: 'VERIFIED' })).status, 400)
  assert.equal((await H(o2).post(`/api/admin2/documents/${docId}/review`, { decision: 'REJECTED' })).status, 400, 'reject needs a reason')
  assert.equal((await H(o2).post(`/api/admin2/documents/${docId}/review`, { decision: 'VERIFIED' })).status, 200)
  assert.equal((await H(o1).get(`/api/admin2/documents/${docId}`)).json.document.status, 'VERIFIED')
})

await t('documents: download is a separate permission, integrity-checked and audited; STR manager reads metadata only', async () => {
  assert.equal((await H(str).get(`/api/admin2/documents/${docId}`)).status, 200)
  assert.equal((await H(str).get(`/api/admin2/documents/${docId}/download`)).status, 403)
  const res = await fetch(`${api.base}/api/admin2/documents/${docId}/download`, { headers: { authorization: `Bearer ${o1.s.token}` } })
  assert.equal(res.status, 200)
  assert.equal(createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex'), createHash('sha256').update(PNG).digest('hex'))
  assert.ok(await p.adminAuditLog.findFirst({ where: { entityId: docId, action: 'document.downloaded' } }))
  assert.equal(JSON.stringify((await H(o1).get(`/api/admin2/documents/${docId}`)).json).includes('storageKey'), false, 'storage key never exposed')
})

await t('documents: a correction is a NEW version; the original stays downloadable; status resets for review', async () => {
  const nv = await H(o1).post(`/api/admin2/documents/${docId}/versions`, { reason: 'sharper scan', file: { base64: PNG.toString('base64'), contentType: 'image/png', filename: 'id2.png' } })
  assert.equal(nv.status, 201); assert.equal(nv.json.versionNumber, 2)
  const d = (await H(o1).get(`/api/admin2/documents/${docId}`)).json
  assert.equal(d.document.status, 'UPLOADED'); assert.equal(d.versions.length, 2)
  const old = await fetch(`${api.base}/api/admin2/documents/${docId}/download?versionId=${v1}`, { headers: { authorization: `Bearer ${o1.s.token}` } })
  assert.equal(old.status, 200)
  assert.equal((await H(o1).post(`/api/admin2/documents/${docId}/status`, { to: 'VERIFIED', reason: 'skip review please' })).status, 409, 'cannot jump to VERIFIED by status edit')
})

await t('support: customer messages and internal notes are separate; notes hidden without the permission', async () => {
  const c = await H(o1).post('/api/admin2/support/cases', { type: 'ORDER_ISSUE', summary: `Late order ${run}`, platformId: plat.sr_restaurants.id, priority: 'HIGH' })
  assert.equal(c.status, 201, c.text)
  const id = c.json.id
  assert.equal((await H(o1).post(`/api/admin2/support/cases/${id}/messages`, { direction: 'OUTBOUND', body: 'We are looking into it.' })).json.delivered, false)
  assert.equal((await H(o1).post(`/api/admin2/support/cases/${id}/notes`, { body: 'Customer has complained twice before.' })).status, 201)
  const full = (await H(sup).get(`/api/admin2/support/cases/${id}`)).json
  assert.equal(full.internalNotesVisible, true); assert.equal(full.messages.length, 1); assert.equal(JSON.stringify(full.messages).includes('complained'), false)
  const limited = await H(rest).get(`/api/admin2/support/cases/${id}`)
  assert.equal(limited.status, 200); assert.equal(limited.json.internalNotesVisible, false); assert.equal(limited.text.includes('complained'), false)
  assert.equal((await H(rest).post(`/api/admin2/support/cases/${id}/notes`, { body: 'sneaky' })).status, 403)
  assert.equal((await H(rest).post(`/api/admin2/support/cases/${id}/messages`, { body: 'sneaky reply' })).status, 403)
  assert.equal((await H(rest).get(`/api/admin2/comments?entityType=support_case&entityId=${id}`)).status, 403)
})

await t('comments + timeline are separate from audit; whitelist of entity types', async () => {
  const w = await H(o1).post('/api/admin2/work/items', { type: 'SECURITY_REVIEW', title: `c ${run}` })
  const id = w.json.item.id
  assert.equal((await H(o1).post('/api/admin2/comments', { entityType: 'work_item', entityId: id, body: 'First comment' })).status, 201)
  assert.equal((await H(o1).get(`/api/admin2/comments?entityType=work_item&entityId=${id}`)).json.comments.length, 1)
  assert.ok((await H(o1).get(`/api/admin2/timeline?entityType=work_item&entityId=${id}`)).json.events.length >= 2)
  assert.equal((await H(o1).get(`/api/admin2/comments?entityType=users&entityId=${id}`)).status, 400)
})

await t('search is authorization-filtered per section', async () => {
  const o = (await H(o1).get(`/api/admin2/search?q=${encodeURIComponent('Multi Role ' + run)}`)).json.results
  assert.ok(o.parties.length >= 1)
  const s = (await H(rest).get(`/api/admin2/search?q=${encodeURIComponent('Late order ' + run)}`)).json.results
  assert.ok(s.supportCases.length >= 1); assert.equal('users' in s, false); assert.equal('documents' in s, false)
  assert.equal((await H(acct).get('/api/admin2/search?q=anything')).status, 403)
  assert.equal((await H(o1).get('/api/admin2/search?q=a')).status, 400)
})

await t('security + audit: overview for security admin; denied for support; export is audited and formula-safe', async () => {
  assert.equal((await H(secu).get('/api/admin2/security/overview')).status, 200)
  assert.equal((await H(sup).get('/api/admin2/security/overview')).status, 403)
  assert.equal((await H(secu).get('/api/admin2/audit/export')).status, 403, 'read is not export')
  await H(o1).put(`/api/admin2/config/settings/general/export_probe`, { value: { a: 1 }, reason: '=1+1 formula probe' })
  const res = await fetch(`${api.base}/api/admin2/audit/export?action=config.setting_changed`, { headers: { authorization: `Bearer ${o1.s.token}` } })
  assert.equal(res.status, 200)
  const csv = await res.text()
  assert.ok(csv.includes(`"'=1+1 formula probe"`), 'formula-looking cell is neutralised')
  assert.ok(await p.adminAuditLog.findFirst({ where: { action: 'audit.export', actorUserId: o1.u.id } }))
  const ev = (await H(o1).get('/api/admin2/audit/evidence/verify')).json
  assert.equal(ev.result.ok, true, JSON.stringify(ev))
})

await t('configuration continued: optimistic version check and unknown category', async () => {
  const a = await H(o1).put('/api/admin2/config/settings/general/probe2', { value: { n: 1 }, reason: 'first value set' })
  assert.equal(a.status, 200); assert.equal(a.json.version, 1)
  const b = await H(o1).put('/api/admin2/config/settings/general/probe2', { value: { n: 2 }, reason: 'second value set', expectedVersion: 1 })
  assert.equal(b.json.version, 2)
  assert.equal((await H(o1).put('/api/admin2/config/settings/general/probe2', { value: { n: 3 }, reason: 'stale write try', expectedVersion: 1 })).status, 409)
  assert.equal((await H(o1).put('/api/admin2/config/settings/nope/probe2', { value: 1, reason: 'unknown category' })).status, 400)
  assert.equal((await H(o1).put('/api/admin2/config/settings/general/probe2', { value: 1, reason: 'x' })).status, 400, 'reason required')
  assert.equal((await H(sup).put('/api/admin2/config/settings/general/probe2', { value: 1, reason: 'support tries it' })).status, 403)
  const f = await H(o1).put('/api/admin2/config/feature-flags', { key: 'str.enabled', scopeKind: 'ORGANIZATION', enabled: true, reason: 'enable flag for test' })
  assert.equal(f.status, 200)
  // A flag cannot open a door: the accountant still cannot open the STR shell.
  assert.equal((await H(acct).get('/api/admin2/platforms/str')).status, 403)
})

await t('platform shells, health and registry: scoped, honest, audited', async () => {
  assert.equal((await H(str).get('/api/admin2/platforms/str')).status, 200)
  assert.equal((await H(str).get('/api/admin2/platforms/sr_ride')).status, 403)
  assert.equal((await H(str).get('/api/admin2/platforms/does_not_exist')).status, 404)
  const h = (await H(o1).get('/api/admin2/health')).json
  assert.equal(h.system.database.status, 'UP')
  assert.ok(h.platforms.every((x) => x.health === 'NOT_CONFIGURED' && x.dataSource === null))
  assert.equal((await H(str).patch('/api/admin2/platforms/str', { status: 'ACTIVE', reason: 'trying to self-activate' })).status, 403)
  assert.equal((await H(o1).patch('/api/admin2/platforms/cars', { status: 'NO_DATA', reason: 'no data source yet' })).status, 200)
  await H(o1).patch('/api/admin2/platforms/cars', { status: 'SETUP', reason: 'restore test state' })
})

await t('finance / tax / accountant / reports / AI shells honour their permissions and show no data', async () => {
  assert.equal((await H(fin).get('/api/admin2/finance')).json.status, 'NOT_CONFIGURED')
  assert.equal((await H(acct).get('/api/admin2/finance')).status, 403)
  assert.equal((await H(acct).get('/api/admin2/accountant')).status, 200)
  assert.equal((await H(sup).get('/api/admin2/accountant')).status, 403)
  assert.equal((await H(o1).get('/api/admin2/reports')).json.status, 'COMING_LATER')
  assert.equal((await H(sup).get('/api/admin2/ai')).status, 403)
  assert.match((await H(o1).get('/api/admin2/ai')).json.label, /HUMAN REVIEW REQUIRED/)
})

await t('command center: real counts only, tiles follow permissions, finance is NOT_AVAILABLE', async () => {
  const o = (await H(o1).get('/api/admin2/command-center')).json
  assert.ok(Number.isInteger(o.tiles.myOpenWork) && Number.isInteger(o.tiles.pendingApprovals) && Number.isInteger(o.tiles.openSupportCases))
  assert.equal(o.finance.status, 'NOT_AVAILABLE')
  const a = (await H(acct).get('/api/admin2/command-center')).json
  assert.deepEqual(Object.keys(a.tiles), [], 'accountant sees no operational tiles')
  const s = (await H(str).get('/api/admin2/command-center')).json
  assert.equal('pendingAccessApprovals' in s.tiles, false); assert.deepEqual(s.platforms.map((x) => x.code), ['str'])
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
