// Rezekme Rides — SYNTHETIC load-test seed. ISOLATED databases only; refuses anything that looks like
// production. Creates, in bulk:
//   - REGISTERED  plain accounts (default 1,000,000) to size the users table like a 1M-user platform
//   - DRIVERS     fully approved, on-duty drivers spread over Damascus with fresh locations
//   - RIDERS      riders with a funded wallet
// and writes their bearer tokens to OUT (JSON) for scripts/ride-loadtest-run.mjs.
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/rezekme_load AUTH_SECRET=... \
//   REGISTERED=1000000 DRIVERS=2000 RIDERS=5000 node scripts/ride-loadtest-seed.mjs
//
// All synthetic emails end in @load.rezekme.test so the data is easy to recognise and delete.
import { writeFileSync } from 'node:fs'
import { db } from '../server/lib/prisma.mjs'
import { issueUserSession } from '../server/lib/session-store.mjs'

const url = String(process.env.DATABASE_URL || '')
if (!/127\.0\.0\.1|localhost/.test(url) || /neon\.tech|onrender|amazonaws/.test(url)) {
  console.error('refusing: ride-loadtest-seed only runs against a local, isolated database')
  process.exit(2)
}
const REGISTERED = Number(process.env.REGISTERED ?? 1_000_000)
const DRIVERS = Number(process.env.DRIVERS ?? 2000)
const RIDERS = Number(process.env.RIDERS ?? 5000)
const OUT = process.env.OUT || '/tmp/ride-loadtest-tokens.json'
const prisma = db()

// Damascus urban box (approx.): lat 33.47..33.56, lng 36.22..36.34
const BOX = { lat0: 33.47, lat1: 33.56, lng0: 36.22, lng1: 36.34 }
const CATS = ['ECONOMY', 'ECONOMY', 'ECONOMY', 'COMFORT', 'SUV', 'VAN', 'VIP', 'BIKE']
const DOCS = ['LICENCE', 'CRIMINAL_RECORD', 'REGISTRATION', 'INSURANCE', 'MECHANIC_REPORT', 'CAR_PHOTO_FRONT', 'CAR_PHOTO_BACK', 'CAR_PHOTO_LEFT', 'CAR_PHOTO_RIGHT', 'CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT']

async function main() {
  const t0 = Date.now()
  await prisma.$executeRawUnsafe(`delete from users where email like '%@load.rezekme.test'`)

  // 1) registered accounts, in one set-based insert (fast; no per-row round trips)
  if (REGISTERED > 0) {
    await prisma.$executeRawUnsafe(`
      insert into users (id, email, display_name, status, created_at, updated_at)
      select gen_random_uuid(), 'u' || g || '@load.rezekme.test', 'Load user ' || g, 'ACTIVE', now(), now()
      from generate_series(1, ${REGISTERED}) g`)
    await prisma.$executeRawUnsafe(`
      insert into user_roles (user_id, role) select id, 'GUEST' from users where email like 'u%@load.rezekme.test'`)
    console.log(`registered: ${REGISTERED} accounts in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }

  // 2) drivers
  const drivers = []
  for (let i = 0; i < DRIVERS; i++) {
    const lat = BOX.lat0 + Math.random() * (BOX.lat1 - BOX.lat0)
    const lng = BOX.lng0 + Math.random() * (BOX.lng1 - BOX.lng0)
    drivers.push({ i, lat, lng, cat: CATS[i % CATS.length] })
  }
  await prisma.$executeRawUnsafe(`
    insert into users (id, email, display_name, status, id_document_status, created_at, updated_at)
    select gen_random_uuid(), 'd' || g || '@load.rezekme.test', 'Load driver ' || g, 'ACTIVE', 'APPROVED', now(), now()
    from generate_series(0, ${DRIVERS - 1}) g`)
  await prisma.$executeRawUnsafe(`insert into user_roles (user_id, role) select id, 'DRIVER' from users where email like 'd%@load.rezekme.test'`)
  const dRows = await prisma.$queryRawUnsafe(`select id, email from users where email like 'd%@load.rezekme.test'`)
  const byIndex = new Map(dRows.map((r) => [Number(r.email.slice(1).split('@')[0]), r.id]))
  const values = drivers.map((d) => `('${byIndex.get(d.i)}'::uuid, ${d.lng}, ${d.lat}, '${d.cat}')`).join(',')
  await prisma.$executeRawUnsafe(`
    insert into driver_profiles (id, user_id, vehicle_plate, vehicle_status, vehicle_category, inspection_status,
      inspection_expires_at, registration_expires_at, large_bag_capacity, hand_bag_capacity, seat_count,
      on_duty_at, last_location_geo, last_location_updated_at, created_at, updated_at)
    select gen_random_uuid(), v.uid, 'LT-' || substr(v.uid::text, 1, 6), 'APPROVED', v.cat::"VehicleCategory", 'PASSED',
      now() + interval '1 year', now() + interval '1 year', 3, 3, 4,
      now(), ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326), now(), now(), now()
    from (values ${values}) as v(uid, lng, lat, cat)`).catch(async (e) => {
    // enum type names differ between databases created by Prisma; fall back to text casts
    if (!String(e.message).includes('does not exist')) throw e
    await prisma.$executeRawUnsafe(`
      insert into driver_profiles (id, user_id, vehicle_plate, vehicle_status, vehicle_category, inspection_status,
        inspection_expires_at, registration_expires_at, large_bag_capacity, hand_bag_capacity, seat_count,
        on_duty_at, last_location_geo, last_location_updated_at, created_at, updated_at)
      select gen_random_uuid(), v.uid, 'LT-' || substr(v.uid::text, 1, 6), 'APPROVED', v.cat, 'PASSED',
        now() + interval '1 year', now() + interval '1 year', 3, 3, 4,
        now(), ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326), now(), now(), now()
      from (values ${values}) as v(uid, lng, lat, cat)`)
  })
  await prisma.$executeRawUnsafe(`
    insert into driver_documents (id, user_id, kind, storage_key, mime_type, status, expires_at, created_at, updated_at)
    select gen_random_uuid(), u.id, k::driver_document_kind, 'load/' || k, 'image/png', 'APPROVED', now() + interval '1 year', now(), now()
    from users u cross join unnest(array[${DOCS.map((k) => `'${k}'`).join(',')}]) k
    where u.email like 'd%@load.rezekme.test'`)
  console.log(`drivers: ${DRIVERS} approved + on duty`)

  // 3) riders with funded wallets (USD minor units)
  await prisma.$executeRawUnsafe(`
    insert into users (id, email, display_name, status, created_at, updated_at)
    select gen_random_uuid(), 'r' || g || '@load.rezekme.test', 'Load rider ' || g, 'ACTIVE', now(), now()
    from generate_series(0, ${RIDERS - 1}) g`)
  await prisma.$executeRawUnsafe(`insert into user_roles (user_id, role) select id, 'GUEST' from users where email like 'r%@load.rezekme.test'`)
  await prisma.$executeRawUnsafe(`
    insert into wallets (id, user_id, currency, cached_balance_minor, created_at, updated_at)
    select gen_random_uuid(), id, 'USD', 100000, now(), now() from users where email like 'r%@load.rezekme.test'`)
  await prisma.$executeRawUnsafe(`
    insert into wallet_entries (id, wallet_id, type, amount_minor, currency, reference_type, reference_id, idempotency_key, note, created_at)
    select gen_random_uuid(), w.id, 'CREDIT', 100000, 'USD', 'load_seed', w.user_id::text, 'load-seed:' || w.user_id, 'synthetic load-test funds', now()
    from wallets w join users u on u.id = w.user_id where u.email like 'r%@load.rezekme.test'`)
  console.log(`riders: ${RIDERS} with funded wallets`)

  // 4) tokens (real sessions, issued by the server's own session code)
  const rRows = await prisma.$queryRawUnsafe(`select id from users where email like 'r%@load.rezekme.test' order by email`)
  const tokens = { drivers: [], riders: [], box: BOX }
  const issue = async (rows, role, out, extra) => {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const issued = await Promise.all(chunk.map((r) => issueUserSession({ id: r.id, roles: [{ role }] })))
      issued.forEach((s, j) => out.push({ id: chunk[j].id, token: s.token, ...(extra ? extra(chunk[j]) : {}) }))
    }
  }
  const dInfo = new Map(drivers.map((d) => [byIndex.get(d.i), d]))
  await issue(dRows, 'DRIVER', tokens.drivers, (r) => ({ lat: dInfo.get(r.id).lat, lng: dInfo.get(r.id).lng, cat: dInfo.get(r.id).cat }))
  await issue(rRows, 'GUEST', tokens.riders)
  writeFileSync(OUT, JSON.stringify(tokens))
  await prisma.$executeRawUnsafe('analyze')
  const [{ users }] = await prisma.$queryRawUnsafe(`select count(*)::int as users from users`)
  console.log(`tokens -> ${OUT}; users table now ${users} rows; total ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
