// STEP 5F -- the two small read-only additions the console needed on GET /api/admin2/work/items:
//   * view=priority  (open HIGH/URGENT items)      * assignedUserName (display name only, never an email)
// Both must stay inside the caller's scope.   DATABASE_URL=<TEST db> node tests/e2e/admin-ui-5f.e2e.mjs
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const rest = await p.platform.findUnique({ where: { code: 'sr_restaurants' } })
const ride = await p.platform.findUnique({ where: { code: 'sr_ride' } })
const tag = `5f-${run}`

const owner = await createStaffUser('owner', run)
await assignRole(owner, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
const colleague = await createStaffUser('colleague', run)
await p.user.update({ where: { id: colleague.id }, data: { displayName: 'Nadia Khoury' } })
const mk = (title, over) => p.workItem.create({ data: { type: 'DOCUMENT_REVIEW', title: `${tag} ${title}`, ...over } })
const hiRest = await mk('urgent restaurants', { platformId: rest.id, priority: 'URGENT', assignedUserId: colleague.id })
const hiRide = await mk('high ride', { platformId: ride.id, priority: 'HIGH' })
await mk('normal restaurants', { platformId: rest.id, priority: 'NORMAL' })
await mk('done high', { platformId: rest.id, priority: 'HIGH', status: 'DONE' })
await mk('blocked high', { platformId: rest.id, priority: 'HIGH', status: 'BLOCKED' })
const ownerS = await loginAsStaff(api, owner)
const mine = (items) => items.filter((x) => x.title.startsWith(tag)).map((x) => x.title.slice(tag.length + 1)).sort()

await t('view=priority returns only OPEN/IN_PROGRESS/BLOCKED items that are HIGH or URGENT', async () => {
  const r = await ownerS.http.get('/api/admin2/work/items?view=priority&pageSize=100')
  assert.equal(r.status, 200)
  assert.deepEqual(mine(r.json.items), ['blocked high', 'high ride', 'urgent restaurants'])
})

await t('a platform-scoped user sees priority items for THEIR platform only', async () => {
  const u = await createStaffUser('rest-ops', run)
  await assignRole(u, 'RESTAURANT_OPS', [{ kind: 'PLATFORM', platformId: rest.id }])
  const s = await loginAsStaff(api, u)
  const r = await s.http.get('/api/admin2/work/items?view=priority&pageSize=100')
  assert.equal(r.status, 200)
  assert.deepEqual(mine(r.json.items), ['blocked high', 'urgent restaurants'])
  assert.ok(!mine(r.json.items).includes('high ride'))
})

await t('assignedUserName is the display name only: no email, phone or other user fields leak', async () => {
  const r = await ownerS.http.get('/api/admin2/work/items?view=all&pageSize=100')
  const row = r.json.items.find((x) => x.id === hiRest.id)
  assert.equal(row.assignedUserName, 'Nadia Khoury')
  assert.equal(row.assignedUserId, colleague.id)
  assert.equal(r.json.items.find((x) => x.id === hiRide.id).assignedUserName, null)
  assert.ok(!r.text.includes(colleague.email), 'colleague email must not appear in the list payload')
  assert.deepEqual(Object.keys(row).filter((k) => /email|phone|password/i.test(k)), [])
})

await t('unknown views are still rejected; existing views are unchanged', async () => {
  assert.equal((await ownerS.http.get('/api/admin2/work/items?view=nope')).status, 400)
  const mineView = await ownerS.http.get('/api/admin2/work/items?view=unassigned&pageSize=100')
  assert.ok(mine(mineView.json.items).includes('high ride') && !mine(mineView.json.items).includes('urgent restaurants'))
})

api.stop()
await p.workItem.deleteMany({ where: { title: { startsWith: tag } } })
await p.$disconnect()
process.exit(summary() ? 1 : 0)
