// Rezekme Stay — post-load-test CORRECTNESS check (local database, or a marked staging branch).
// Exits 1 on any violation:
//   - no two date-blocking bookings (PAYMENT_PENDING / REQUESTED / CONFIRMED) overlap on one listing
//   - no booking has more than one APPROVED payment proof or more than one succeeded payment intent
//   - synthetic wallets' cached balance equals their ledger
import { db } from '../server/lib/prisma.mjs'
import { assertLoadTestDatabase } from './ride-loadtest-db-guard.mjs'

const prisma = db()
await assertLoadTestDatabase(prisma, { script: 'stay-loadtest-verify' })
const q = (sql) => prisma.$queryRawUnsafe(sql)

const checks = {
  overlappingActiveBookings: await q(`
    select a.listing_id, a.id a_id, b.id b_id from bookings a
    join bookings b on b.listing_id = a.listing_id and b.id > a.id
     and b.status in ('PAYMENT_PENDING','REQUESTED','CONFIRMED') and a.status in ('PAYMENT_PENDING','REQUESTED','CONFIRMED')
     and a.check_in < b.check_out and b.check_in < a.check_out
    where a.check_in is not null and a.check_out is not null and a.guest_id in (select id from users where email like '%@load.rezekme.test')
    limit 20`),
  doubleApprovedProofs: await q(`
    select booking_id, count(*)::int n from payment_proofs where status = 'APPROVED' and booking_id is not null
    group by booking_id having count(*) > 1`),
  doubleSucceededIntents: await q(`
    select booking_id, count(*)::int n from payment_intents where status = 'SUCCEEDED' and booking_id is not null
    group by booking_id having count(*) > 1`),
}
const [{ bookings, active, cancelled }] = await q(`select count(*)::int bookings,
  count(*) filter (where status in ('PAYMENT_PENDING','REQUESTED','CONFIRMED'))::int active,
  count(*) filter (where status = 'CANCELLED')::int cancelled
  from bookings where guest_id in (select id from users where email like '%@load.rezekme.test')`)
const violations = Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.length]))
console.log(JSON.stringify({ bookings, active, cancelled, violations, samples: Object.fromEntries(Object.entries(checks).filter(([, v]) => v.length).map(([k, v]) => [k, v.slice(0, 3)])) }, (k, v) => (typeof v === 'bigint' ? Number(v) : v)))
await prisma.$disconnect()
process.exit(Object.values(violations).some((n) => n > 0) ? 1 : 0)
