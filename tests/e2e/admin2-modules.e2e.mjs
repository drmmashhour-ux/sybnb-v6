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

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
