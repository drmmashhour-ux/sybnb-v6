// SYBNB — parent-child new-construction units E2E. Self-contained. Run: node tests/e2e/project-units.e2e.mjs
import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RUN = randomUUID().slice(0, 8)
let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
}
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: await res.json().catch(() => ({})) }
}
async function seed(label) {
  const roles = [{ role: 'SELLER' }, { role: 'HOST' }, { role: 'GUEST' }]
  const u = await db().user.create({ data: { email: `pu-${label}-${RUN}@example.test`, displayName: `PU ${label}`, locale: 'en', hostVerifiedAt: new Date(), roles: { create: roles } } })
  return { ...u, token: await createSessionToken({ id: u.id, roles }) }
}

async function main() {
  console.log('=== PROJECT UNITS E2E ===')
  const dev = await seed('dev')
  const other = await seed('other')
  const parent = await db().listing.create({
    data: {
      ownerId: dev.id, division: 'NEW_CONSTRUCTION', titleAr: `برج ${RUN}`, titleEn: `Tower ${RUN}`, description: 'Project', status: 'PENDING_REVIEW',
      priceMinor: 900_000_000, currency: 'SYP', metadata: { governorate: 'damascus' },
      media: { create: [{ url: '/a.jpg', kind: 'PHOTO', sortOrder: 0 }, { url: '/b.jpg', kind: 'PHOTO', sortOrder: 1 }] },
    },
  })
  const draft = await db().listing.create({ data: { ownerId: dev.id, division: 'NEW_CONSTRUCTION', titleAr: `مسودة ${RUN}`, status: 'DRAFT', priceMinor: 1, currency: 'SYP', metadata: {} } })
  const path = `/api/host/listings/${parent.id}/units`
  const units = [
    { label: '1A', floor: 1, view: 'Street', bedrooms: 2, sizeSqm: 90, priceMinor: 800_000_000 },
    { label: '2A', floor: 2, view: 'Park', bedrooms: 2, sizeSqm: 90, priceMinor: 820_000_000 },
    { label: '3A', floor: 3, view: 'Sea', bedrooms: 3, sizeSqm: 120, priceMinor: 1_000_000_000 },
  ]

  check('anonymous -> 401', (await call('POST', path, null, { units })).status === 401, 'not 401')
  check('another account -> 404', (await call('POST', path, other.token, { units })).status === 404, 'not 404')
  check('project still in draft -> 409', (await call('POST', `/api/host/listings/${draft.id}/units`, dev.token, { units })).status === 409, 'not 409')
  check('empty list -> 400', (await call('POST', path, dev.token, { units: [] })).status === 400, 'not 400')
  check('duplicate labels in one request -> 400', (await call('POST', path, dev.token, { units: [units[0], units[0]] })).status === 400, 'not 400')

  const r = await call('POST', path, dev.token, { units })
  check('owner creates 3 units -> 201', r.status === 201 && r.j.created === 3, r)
  const kids = await db().listing.findMany({ where: { metadata: { path: ['parentListingId'], equals: parent.id } }, include: { media: true }, orderBy: { priceMinor: 'asc' } })
  check('3 child listings linked to the project', kids.length === 3, kids.length)
  check('children are PENDING_REVIEW (SYBNB still approves each)', kids.every((k) => k.status === 'PENDING_REVIEW'), kids.map((k) => k.status))
  check('children inherit location/currency/photos', kids.every((k) => k.currency === 'SYP' && k.media.length === 2), kids.map((k) => k.media.length))
  check('each child has its own price, floor, view, bedrooms, size', kids[0].priceMinor === 800_000_000 && kids[2].metadata.unit.floor === 3 && kids[2].metadata.unit.view === 'Sea' && kids[2].metadata.bedrooms === 3 && kids[2].metadata.sizeSqm === 120, kids.map((k) => k.metadata))
  check('child titles carry the unit label', kids[0].titleEn.endsWith('— 1A'), kids[0].titleEn)
  check('audit row written', Boolean(await db().adminAuditLog.findFirst({ where: { entityId: parent.id, action: 'PROJECT_UNITS_CREATED' } })), 'no audit')

  check('re-using an existing label -> 409', (await call('POST', path, dev.token, { units: [{ label: '1a', priceMinor: 5 }] })).status === 409, 'not 409')

  const before = await call('GET', `/api/listings/${parent.id}/units`, null)
  check('public list is empty until units are approved', before.status === 200 && before.j.units.length === 0, before)
  await db().listing.update({ where: { id: kids[0].id }, data: { status: 'APPROVED' } })
  const after = await call('GET', `/api/listings/${parent.id}/units`, null)
  check('approved unit appears in the public list', after.j.units.length === 1 && after.j.units[0].label === '1A' && after.j.units[0].priceMinor === 800_000_000, after.j)

  console.log(`\n==== PROJECT UNITS E2E: ${pass} passed, ${fail} failed ====`)
}
try { await main() } catch (e) { fail++; console.error('UNCAUGHT', e) } finally { await disconnectDb() }
process.exit(fail ? 1 : 0)
