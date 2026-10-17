// SYBNB — split-stay suggestions E2E. Self-contained (seeds its own host, listings, bookings).
// Needs the API running with DATABASE_URL + SYBNB_COUNTRY in this process's env.
// Run: node tests/e2e/split-stay.e2e.mjs
import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RUN = randomUUID().slice(0, 8)
const CITY = `SplitTown${RUN}`
const DAY = 86_400_000
let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
}
const day = (n) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + n * DAY) }
const iso = (n) => day(n).toISOString().slice(0, 10)
const get = async (qs) => { const r = await fetch(`${API}/api/split-stay?${qs}`); return { status: r.status, j: await r.json().catch(() => ({})) } }

async function main() {
  console.log('=== SPLIT-STAY E2E ===')
  const host = await db().user.create({ data: { email: `split-host-${RUN}@example.test`, displayName: `Split host ${RUN}`, locale: 'en', hostVerifiedAt: new Date(), roles: { create: [{ role: 'HOST' }, { role: 'GUEST' }] } } })
  await createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
  const loc = await db().location.create({ data: { governorate: 'Test', city: CITY } })
  const mk = (title, price, metadata = {}) => db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: title, titleEn: title, status: 'APPROVED', priceMinor: price, currency: 'SYP', metadata, locationId: loc.id } })
  const A = await mk(`A ${RUN}`, 100_000, { visualFilters: { powerSource: 'solar', waterSystem: 'tank' } })
  const B = await mk(`B ${RUN}`, 120_000)
  // Trip: nights day(50)..day(58) = 8 nights. A is booked from night 5 on; B is booked for the first 3 nights.
  await db().booking.create({ data: { listingId: A.id, guestId: host.id, status: 'CONFIRMED', checkIn: day(55), checkOut: day(58), amountMinor: 1, currency: 'SYP' } })
  await db().booking.create({ data: { listingId: B.id, guestId: host.id, status: 'CONFIRMED', checkIn: day(50), checkOut: day(53), amountMinor: 1, currency: 'SYP' } })
  const qs = `city=${encodeURIComponent(CITY)}&checkIn=${iso(50)}&checkOut=${iso(58)}`

  const r = await get(qs)
  check('200 with no single stay free for the whole trip', r.status === 200 && r.j.singles?.length === 0, r)
  const p = r.j.pairs?.[0]
  check('one pair offered: A first, then B', r.j.pairs?.length === 1 && p?.first?.id === A.id && p?.second?.id === B.id, r.j)
  check('legs are back to back and cover the trip', p && p.first.checkIn === iso(50) && p.first.checkOut === p.second.checkIn && p.second.checkOut === iso(58), p)
  check('nights add up to 8', p && p.first.nights + p.second.nights === 8, p)
  check('A leg ends no later than A is booked, B leg starts no earlier than B is free', p && p.first.checkOut <= iso(55) && p.second.checkIn >= iso(53), p)

  const shortQs = `city=${encodeURIComponent(CITY)}&checkIn=${iso(60)}&checkOut=${iso(62)}`
  const free = await get(shortQs)
  check('free dates: both stays are single matches, no split needed', free.j.singles?.length === 2 && free.j.pairs?.length === 0, free.j)

  // Power / water / internet search filters (grid-spec).
  const ids = async (q) => ((await (await fetch(`${API}/api/listings?division=STAYS&city=${encodeURIComponent(CITY)}&${q}`)).json()).listings || []).map((x) => x.id)
  const solar = await ids('powerSource=solar')
  check('powerSource=solar returns only the solar stay', solar.includes(A.id) && !solar.includes(B.id), solar)
  const grid = await ids('powerSource=grid')
  check('powerSource=grid excludes it', !grid.includes(A.id), grid)
  const both = await ids('powerSource=solar&waterSystem=tank')
  check('combined power + water filter matches', both.includes(A.id), both)

  check('missing city -> 400', (await get(`checkIn=${iso(50)}&checkOut=${iso(52)}`)).status === 400, 'no 400')
  check('bad dates -> 400', (await get(`city=x&checkIn=${iso(52)}&checkOut=${iso(50)}`)).status === 400, 'no 400')
  check('over 60 nights -> 400', (await get(`city=x&checkIn=${iso(1)}&checkOut=${iso(80)}`)).status === 400, 'no 400')
  const none = await get(`city=NoSuchTown${RUN}&checkIn=${iso(50)}&checkOut=${iso(52)}`)
  check('unknown city -> empty result, not an error', none.status === 200 && none.j.pairs?.length === 0, none)

  console.log(`\n==== SPLIT-STAY E2E: ${pass} passed, ${fail} failed ====`)
}
try { await main() } catch (e) { fail++; console.error('UNCAUGHT', e); console.log(`\n==== SPLIT-STAY E2E: ${pass} passed, ${fail} failed ====`) } finally { await disconnectDb() }
process.exit(fail ? 1 : 0)
