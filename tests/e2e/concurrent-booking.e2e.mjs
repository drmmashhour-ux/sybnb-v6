// SYBNB — double-booking race E2E (Google test plan #2, "Concurrency").
//
// 10 different guests send POST /api/bookings for the SAME listing and the SAME dates at the same
// instant. The per-listing Postgres advisory lock in server/routes/bookings.mjs must serialize them:
// exactly one 201, nine 409, and exactly one booking row in the database for those dates.
//
// SELF-CONTAINED (seeds its own users/listing via Prisma). Needs the API running with DATABASE_URL
// and SYBNB_COUNTRY in this process's env. Run: node tests/e2e/concurrent-booking.e2e.mjs

import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RUN = randomUUID().slice(0, 8)
const DAY = 24 * 60 * 60 * 1000
const N = 10

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
}
function dayFromToday(days) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY).toISOString().slice(0, 10)
}
async function seedUser(label, roles) {
  const user = await db().user.create({
    data: {
      email: `race-${label}-${RUN}@example.test`,
      displayName: `Race ${label} ${RUN}`,
      locale: 'en',
      hostVerifiedAt: roles.includes('HOST') ? new Date() : undefined,
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
  const token = await createSessionToken({ id: user.id, roles: roles.map((role) => ({ role })) })
  return { ...user, token }
}

async function main() {
  console.log('=== CONCURRENT BOOKING E2E ===')
  const host = await seedUser('host', ['HOST', 'GUEST'])
  const listing = await db().listing.create({
    data: {
      ownerId: host.id, division: 'STAYS', titleAr: `سباق ${RUN}`, titleEn: `Race flat ${RUN}`,
      status: 'APPROVED', priceMinor: 100_000, currency: 'SYP', instantBookEnabled: false, metadata: {},
    },
  })
  const guests = await Promise.all(Array.from({ length: N }, (_, i) => seedUser(`g${i}`, ['GUEST'])))
  const body = { listingId: listing.id, checkIn: dayFromToday(40), checkOut: dayFromToday(42) }

  const results = await Promise.all(guests.map(async (g) => {
    const res = await fetch(`${API}/api/bookings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${g.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.status
  }))
  const created = results.filter((s) => s === 201).length
  const conflicts = results.filter((s) => s === 409).length
  check(`exactly 1 of ${N} simultaneous requests is created (201)`, created === 1, results)
  check(`the other ${N - 1} are refused with 409`, conflicts === N - 1, results)
  const rows = await db().booking.count({
    where: { listingId: listing.id, status: { notIn: ['CANCELLED'] } },
  })
  check('exactly one active booking row exists for the listing', rows === 1, { rows })

  console.log(`\n==== CONCURRENT BOOKING E2E: ${pass} passed, ${fail} failed ====`)
}

try {
  await main()
} catch (error) {
  fail++
  console.error('UNCAUGHT', error)
} finally {
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
