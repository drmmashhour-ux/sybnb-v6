// Stays search after the scale rework (2026-10-22): the scan walks candidates in index order and
// applies host verification, expiry and the JSON attribute filters outside the ordered scan. This
// proves the RESULT SET did not change:
//   1. paging through every page (with and without attribute filters, for each sort) returns
//      exactly the listings a direct computation says should match, in the right order, no dupes;
//   2. a stay whose host is NOT verified never appears;
//   3. a stay whose expiresAt has passed never appears, even while its status is still APPROVED
//      (the expiry sweep is now throttled, so search must not depend on it).
// Self-contained: its own hosts, a unique city, ~140 listings. Run against the e2e API.
import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const prisma = db()
let pass = 0
let fail = 0
const check = (label, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const tag = randomUUID().slice(0, 8)
const CITY = `ScaleCity${tag}`

const verified = await prisma.user.create({ data: { email: `scale-host-${tag}@e2e.test`, displayName: 'Scale host', hostVerifiedAt: new Date() } })
const unverified = await prisma.user.create({ data: { email: `scale-host-u-${tag}@e2e.test`, displayName: 'Unverified host' } })
const AMEN = ['wifi', 'parking', 'pool', 'ac']
const rows = []
for (let i = 0; i < 140; i++) {
  const owner = i % 9 === 4 ? unverified : verified
  const expired = i % 11 === 7
  const loc = await prisma.location.create({ data: { governorate: 'Damascus', city: CITY } })
  const amenities = AMEN.filter((_, k) => (i + k) % 3 !== 0)
  const l = await prisma.listing.create({
    data: {
      ownerId: owner.id, locationId: loc.id, division: 'STAYS', titleAr: `scale ${tag} ${i}`, titleEn: `scale ${tag} ${i}`,
      status: 'APPROVED', priceMinor: 1000 + ((i * 37) % 500), currency: 'USD',
      expiresAt: expired ? new Date(Date.now() - 3600_000) : null,
      createdAt: new Date(Date.now() - i * 60_000),
      metadata: { bedrooms: 1 + (i % 4), visualFilters: { amenities } },
    },
  })
  rows.push({ id: l.id, i, verified: owner === verified, expired, bedrooms: 1 + (i % 4), amenities, priceMinor: l.priceMinor, createdAt: l.createdAt })
}

async function allPages(query) {
  const ids = []
  let cursor = null
  for (let n = 0; n < 50; n++) {
    const res = await fetch(`${API}/api/listings?division=STAYS&city=${encodeURIComponent(CITY)}${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    const j = await res.json()
    if (res.status !== 200) throw new Error(`search ${res.status} ${JSON.stringify(j).slice(0, 200)}`)
    ids.push(...j.listings.map((l) => l.id))
    cursor = j.nextCursor
    if (!cursor) break
  }
  return ids
}
const sorters = {
  '': (a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : -1),
  '&sort=priceLow': (a, b) => a.priceMinor - b.priceMinor || (a.id > b.id ? 1 : -1),
  '&sort=priceHigh': (a, b) => b.priceMinor - a.priceMinor || (b.id > a.id ? 1 : -1),
}
const filters = {
  '': () => true,
  '&bedroomsMin=3': (r) => r.bedrooms >= 3,
  '&amenities=pool': (r) => r.amenities.includes('pool'),
  '&amenities=wifi,pool&bedroomsMin=2': (r) => r.amenities.includes('wifi') && r.amenities.includes('pool') && r.bedrooms >= 2,
}

console.log('=== STAYS SEARCH: same results after the scale rework ===')
for (const [sq, sorter] of Object.entries(sorters)) {
  for (const [fq, pred] of Object.entries(filters)) {
    const expected = rows.filter((r) => r.verified && !r.expired && pred(r)).sort(sorter).map((r) => r.id)
    const got = await allPages(`${fq}${sq}`)
    const same = got.length === expected.length && got.every((id, k) => id === expected[k])
    check(`sort "${sq || 'newest'}" filter "${fq || 'none'}": ${expected.length} listings, exact order, all pages`, same, `got ${got.length}, expected ${expected.length}`)
    check(`  ... no duplicates across pages`, new Set(got).size === got.length)
  }
}
const all = await allPages('')
check('a stay of an unverified host never appears', !rows.filter((r) => !r.verified).some((r) => all.includes(r.id)))
check('an expired stay (still APPROVED, sweep not run) never appears', !rows.filter((r) => r.expired).some((r) => all.includes(r.id)))

await prisma.listing.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
await prisma.location.deleteMany({ where: { city: CITY } })
await disconnectDb()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
