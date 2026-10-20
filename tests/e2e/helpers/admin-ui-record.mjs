// STEP 5F review tooling (NOT part of the regression suite).
// Seeds clearly synthetic demo data into a SCRATCH TEST database through the REAL admin2 API, then records
// the real JSON responses the five admin screens read, so screenshots can be rendered without exposing the DB.
//   DATABASE_URL=<scratch TEST db> RECORD_OUT=/path/recording.json node tests/e2e/helpers/admin-ui-record.mjs
import fs from 'node:fs'
import { db } from '../../../server/lib/prisma.mjs'
import { startApi, client, createStaffUser, loginAsStaff, assignRole, randomUUID } from './admin2-harness.mjs'

const out = process.env.RECORD_OUT
if (!out) throw new Error('RECORD_OUT is required')
const run = randomUUID().slice(0, 8)
const api = await startApi()
const p = db()
try {
  const org = await p.organization.findFirst()
  const owner = await createStaffUser('owner', run)
  await p.user.update({ where: { id: owner.id }, data: { displayName: 'Sam Rivera' } })
  await assignRole(owner, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const colleague = await createStaffUser('colleague', run)
  await p.user.update({ where: { id: colleague.id }, data: { displayName: 'Nadia Khoury' } })
  const s = await loginAsStaff(api, owner)
  // Wait for trusted security time (privileged reads are denied until the first DB clock sample).
  for (let i = 0; i < 40; i += 1) { const h = await client(api.base).get('/api/health'); if (h.json?.securityTimeReady) break; await new Promise((r) => setTimeout(r, 500)) }
  const A = (path) => `/api/admin2${path}`
  const ctx = (await s.http.get(A('/context'))).json
  const pid = Object.fromEntries(ctx.platforms.map((x) => [x.code, x.id]))

  const day = 86400_000
  const items = [
    ['DOCUMENT_REVIEW', 'Review business licence — onboarding restaurant', 'sr_restaurants', 'HIGH', 'MEDIUM', -1, owner.id],
    ['DOCUMENT_REVIEW', 'Verify courier identity document', 'sr_ride', 'URGENT', 'HIGH', -2, owner.id],
    ['ACCESS_REQUEST', 'Approve elevated access request for support lead', null, 'NORMAL', 'LOW', 2, owner.id],
    ['SUPPORT_ESCALATION', 'Escalated complaint: delayed host payout question', 'str', 'HIGH', 'NONE', 1, owner.id],
    ['PLATFORM_SETUP', 'Finish Marketplace platform setup checklist', 'marketplace', 'NORMAL', 'NONE', 7, owner.id],
    ['SECURITY_REVIEW', 'Review repeated failed step-up attempts', null, 'URGENT', 'HIGH', 0, null],
    ['DOCUMENT_REVIEW', 'Review vehicle registration — Cars listing', 'cars', 'NORMAL', 'LOW', 3, null],
    ['APPROVAL', 'Approve new Jobloop employer account', 'jobloop', 'NORMAL', 'NONE', 5, colleague.id],
    ['SUPPORT_ESCALATION', 'Customer reported wrong item — restaurant order', 'sr_restaurants', 'HIGH', 'MEDIUM', -1, colleague.id],
    ['PLATFORM_SETUP', 'Confirm Radio Mailo station onboarding steps', 'radio_mailo', 'LOW', 'NONE', 10, null],
    ['DOCUMENT_REVIEW', 'Review tax registration document', null, 'NORMAL', 'LOW', 4, owner.id],
    ['ACCESS_REQUEST', 'Review contractor access expiry', null, 'LOW', 'NONE', -3, owner.id],
    // 5G: a deliberately long title to exercise the two-line clamp on phones
    ['DOCUMENT_REVIEW', 'Review the renewed commercial kitchen inspection certificate and the insurance documents submitted by the restaurant owner during onboarding', 'sr_restaurants', 'NORMAL', 'LOW', 2, owner.id],
  ]
  const created = []
  for (const [type, title, plat, priority, risk, dueDays, assigned] of items) {
    const r = await s.http.post(A('/work/items'), { type, title, platformId: plat ? pid[plat] : undefined, priority, risk, dueAt: new Date(Date.now() + dueDays * day).toISOString(), assignedUserId: assigned ?? undefined })
    if (r.status !== 201) throw new Error(`work create ${r.status} ${r.text.slice(0, 200)}`)
    created.push(r.json.item)
  }
  // One completed item.
  const done = created[4]
  await s.http.patch(A(`/work/items/${done.id}`), { status: 'DONE' })
  // Back-date creation times so "age" is meaningful.
  const ageHours = [3, 30, 52, 6, 120, 1, 26, 70, 9, 200, 15, 80, 5]
  for (let i = 0; i < created.length; i += 1) await p.workItem.update({ where: { id: created[i].id }, data: { createdAt: new Date(Date.now() - ageHours[i] * 3600_000) } })
  await s.http.post(A('/comments'), { entityType: 'work_item', entityId: created[0].id, body: 'Licence number matches the registry extract. Waiting on the second page of the scan.' })
  await s.http.patch(A(`/work/items/${created[0].id}`), { status: 'IN_PROGRESS' })
  await s.http.patch(A(`/work/items/${created[0].id}`), { priority: 'HIGH', assignedUserId: owner.id })
  await s.http.patch(A(`/work/items/${created[5].id}`), { status: 'BLOCKED' })

  // Parties: one person holding several roles on different platforms, plus a company.
  const mk = async (body) => (await s.http.post(A('/parties'), body)).json.id
  const layla = await mk({ kind: 'PERSON', displayName: 'Layla Haddad', email: 'layla.haddad@example.invalid', phone: '+10005550142', roles: [] })
  for (const [rt, plat] of [['RESTAURANT_OWNER', 'sr_restaurants'], ['SR_COURIER', 'sr_ride'], ['MARKETPLACE_SELLER', 'marketplace']]) await s.http.post(A(`/parties/${layla}/roles`), { roleType: rt, platformId: pid[plat] })
  await mk({ kind: 'ORGANIZATION', displayName: 'Haddad Foods Inc.', legalName: 'Haddad Foods Incorporated', email: 'accounts@haddad-foods.example.invalid', roles: ['VENDOR'] })
  await mk({ kind: 'PERSON', displayName: 'Omar Sayegh', email: 'omar.sayegh@example.invalid', roles: ['HOST'] })
  await mk({ kind: 'PERSON', displayName: 'Rima Tannous', email: 'rima.tannous@example.invalid', roles: ['CUSTOMER'] })
  await s.http.post(A(`/support/cases`), { partyId: layla, platformId: pid.sr_restaurants, type: 'ONBOARDING', summary: 'Menu photos rejected during onboarding', priority: 'NORMAL' })
  await s.http.post(A('/comments'), { entityType: 'party', entityId: layla, body: 'Prefers contact by phone in the mornings.' })
  await s.http.patch(A(`/work/items/${created[0].id}`), { assignedUserId: owner.id })
  await p.adminNotification.createMany({ data: [
    { userId: owner.id, type: 'TASK', title: 'A work item was assigned to you', body: created[0].title, link: '/admin/work', priority: 'HIGH' },
    { userId: owner.id, type: 'TASK', title: 'Document waiting for review', body: created[1].title, link: '/admin/work', priority: 'URGENT' },
  ] }).catch(() => {})

  // ---- record the exact reads the screens make ----
  const rec = {}
  const grab = async (path) => { const r = await s.http.get(A(path)); rec[path] = { status: r.status, body: r.json }; return r.json }
  const platCodes = ctx.platforms.map((x) => x.code)
  for (const path of ['/me', '/context', '/command-center', '/health', '/work/summary', '/notifications?pageSize=8']) await grab(path)
  for (const c of platCodes) await grab(`/platforms/${c}`)
  for (const v of ['mine', 'team', 'unassigned', 'priority', 'overdue', 'blocked', 'done']) await grab(`/work/items?view=${v}&page=1&pageSize=25`)
  await grab('/work/items?view=all&pageSize=100')
  await grab('/audit/events?pageSize=8')
  await grab('/parties?page=1&pageSize=25')
  const detail = await grab(`/parties/${layla}`)
  await grab(`/comments?entityType=party&entityId=${layla}`)
  await grab(`/timeline?entityType=party&entityId=${layla}`)
  await grab(`/audit/events?entityType=party&entityId=${layla}&pageSize=20`)
  await grab(`/comments?entityType=work_item&entityId=${created[0].id}`)
  await grab(`/timeline?entityType=work_item&entityId=${created[0].id}`)
  await grab('/search?q=layla')
  // 5G: the order page reads the real audit trail for the order id; record the two ids the review screens use
  for (const oid of ['00000000-0000-4000-8000-000000000001', 'fx-1001']) await grab(`/audit/events?entityType=restaurant_order&entityId=${oid}&pageSize=10`)
  await grab('/work/items?view=mine&q=licence&page=1&pageSize=25')
  fs.writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), ids: { layla, firstWork: created[0].id, owner: owner.id }, rec }, null, 1))
  console.log('recorded', Object.keys(rec).length, 'responses; party roles:', detail.roles?.length)
  const bad = Object.entries(rec).filter(([, v]) => v.status !== 200).map(([k, v]) => `${k}=${v.status}`)
  if (bad.length) console.log('NON-200:', bad.join(' '))
} finally {
  api.stop()
  await p.$disconnect()
}
