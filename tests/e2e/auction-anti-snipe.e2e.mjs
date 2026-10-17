// SYBNB — auction anti-sniping E2E (supplier report: a late bid must extend the clock).
// Self-contained. Run: node tests/e2e/auction-anti-snipe.e2e.mjs
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
async function bid(token, auctionId, amountMinor) {
  const res = await fetch(`${API}/api/auctions/${auctionId}/bids`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ amountMinor }) })
  return { status: res.status, j: await res.json().catch(() => ({})) }
}
async function seedUser(label) {
  const u = await db().user.create({ data: { email: `as-${label}-${RUN}@example.test`, displayName: `AS ${label}`, locale: 'en', hostVerifiedAt: new Date(), roles: { create: [{ role: 'GUEST' }, { role: 'SELLER' }] } } })
  return { ...u, token: await createSessionToken({ id: u.id, roles: [{ role: 'GUEST' }, { role: 'SELLER' }] }) }
}
async function seedAuction(seller, endsInMs) {
  const listing = await db().listing.create({ data: { ownerId: seller.id, division: 'CARS', titleAr: `سيارة ${RUN}`, titleEn: `Car ${RUN}`, status: 'APPROVED', priceMinor: 1_000_000, currency: 'USD', metadata: {} } })
  return db().auction.create({ data: { listingId: listing.id, sellerId: seller.id, currency: 'USD', startMinor: 100_000, minIncrementMinor: 5000, antiSnipeSeconds: 120, endsAt: new Date(Date.now() + endsInMs), status: 'LIVE' } })
}

async function main() {
  console.log('=== AUCTION ANTI-SNIPE E2E ===')
  const seller = await seedUser('seller')
  const bidder = await seedUser('bidder')

  // Late bid: 30 s left, 120 s window -> clock pushed to ~now+120 s.
  const late = await seedAuction(seller, 30_000)
  const before = late.endsAt.getTime()
  const r1 = await bid(bidder.token, late.id, 100_000)
  check('late bid accepted', r1.status === 200 || r1.status === 201, r1)
  const afterLate = await db().auction.findUnique({ where: { id: late.id } })
  const extendedBy = afterLate.endsAt.getTime() - before
  check('late bid extends the clock by at least 60 s', extendedBy >= 60_000, { extendedBy })
  check('new close time is about 2 minutes from the bid', Math.abs(afterLate.endsAt.getTime() - (Date.now() + 120_000)) < 20_000, afterLate.endsAt)

  // Early bid: an hour left -> clock untouched.
  const early = await seedAuction(seller, 60 * 60_000)
  const r2 = await bid(bidder.token, early.id, 100_000)
  const afterEarly = await db().auction.findUnique({ where: { id: early.id } })
  check('early bid accepted', r2.status === 200 || r2.status === 201, r2)
  check('early bid does not move the clock', afterEarly.endsAt.getTime() === early.endsAt.getTime(), { was: early.endsAt, now: afterEarly.endsAt })

  // The seller cannot bid, and a too-low bid is refused.
  const own = await bid(seller.token, late.id, 500_000)
  check('seller cannot bid on own auction', own.status === 400, own)
  const low = await bid(bidder.token, late.id, 100_001)
  check('bid below the minimum increment is refused', low.status === 400, low)

  console.log(`\n==== AUCTION ANTI-SNIPE E2E: ${pass} passed, ${fail} failed ====`)
}
try { await main() } catch (e) { fail++; console.error('UNCAUGHT', e) } finally { await disconnectDb() }
process.exit(fail ? 1 : 0)
