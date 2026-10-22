// Rezekme Rides — post-load-test CORRECTNESS check on the isolated database. Exits 1 on any violation.
//   - no driver holds two live rides at once
//   - no ride was debited (prepaid) or refunded more than once, and no driver was paid twice for one ride
//   - every synthetic wallet's cached balance equals the sum of its ledger entries
//   - no ride is both cancelled and still holding a driver offer
import { db } from '../server/lib/prisma.mjs'
import { assertLoadTestDatabase } from './ride-loadtest-db-guard.mjs'

const prisma = db()
await assertLoadTestDatabase(prisma, { script: 'ride-loadtest-verify' })
const q = (sql) => prisma.$queryRawUnsafe(sql)

const checks = {
  driversWithTwoLiveRides: await q(`
    select driver_id, count(*)::int n from ride_requests
    where driver_id is not null and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS')
    group by driver_id having count(*) > 1`),
  doublePrepayDebits: await q(`
    select reference_id, count(*)::int n from wallet_entries
    where reference_type = 'ride_prepayment' group by reference_id having count(*) > 1`),
  doubleRefunds: await q(`
    select reference_id, count(*)::int n from wallet_entries
    where reference_type = 'ride_prepayment_refund' group by reference_id having count(*) > 1`),
  doubleDriverFareCredits: await q(`
    select e.reference_id, e.wallet_id, count(*)::int n from wallet_entries e
    where e.reference_type = 'ride_fare' and e.type = 'CREDIT' group by e.reference_id, e.wallet_id having count(*) > 1`),
  walletDrift: await q(`
    select w.id, w.cached_balance_minor, coalesce(sum(case when e.type in ('CREDIT','REFUND','RELEASE') then e.amount_minor
      when e.type = 'DEBIT' then -e.amount_minor else 0 end), 0)::int as ledger
    from wallets w join users u on u.id = w.user_id left join wallet_entries e on e.wallet_id = w.id
    where u.email like '%@load.rezekme.test'
    group by w.id, w.cached_balance_minor
    having w.cached_balance_minor <> coalesce(sum(case when e.type in ('CREDIT','REFUND','RELEASE') then e.amount_minor
      when e.type = 'DEBIT' then -e.amount_minor else 0 end), 0)`),
  cancelledWithOffer: await q(`select id from ride_requests where status = 'CANCELLED' and offered_driver_id is not null and offer_expires_at > now()`),
}
const [{ rides, live, cancelled, completed }] = await q(`select count(*)::int rides,
  count(*) filter (where status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS'))::int live,
  count(*) filter (where status = 'CANCELLED')::int cancelled,
  count(*) filter (where status = 'COMPLETED')::int completed from ride_requests`)
const violations = Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.length]))
console.log(JSON.stringify({ rides, live, cancelled, completed, violations, samples: Object.fromEntries(Object.entries(checks).filter(([, v]) => v.length).map(([k, v]) => [k, v.slice(0, 3)])) }, (k, v) => (typeof v === 'bigint' ? Number(v) : v)))
await prisma.$disconnect()
process.exit(Object.values(violations).some((n) => n > 0) ? 1 : 0)
