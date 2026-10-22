// Rezekme Stay (STR) — SYNTHETIC load-test seed. Local databases, or a marked staging branch (see
// scripts/ride-loadtest-db-guard.mjs); refuses everything else. Creates in bulk:
//   - HOSTS     verified hosts (host_verified_at set, so their stays are public and bookable)
//   - LISTINGS  approved STAYS listings spread over Syrian cities (weighted like real demand), each
//               with a location, MEDIA photos, bedrooms/guests/amenities metadata, and for a share of
//               them blocked dates, price overrides and a past booking (so calendars are not empty)
//   - GUESTS    guests with session tokens
// and writes tokens + listing ids to OUT (JSON) for scripts/stay-loadtest-run.mjs.
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/rezekme_load AUTH_SECRET=... \
//   LISTINGS=20000 HOSTS=4000 GUESTS=3000 node scripts/stay-loadtest-seed.mjs
//
// Synthetic emails: h<n>@load.rezekme.test (hosts), g<n>@load.rezekme.test (guests).
import { writeFileSync } from 'node:fs'
import { db } from '../server/lib/prisma.mjs'
import { issueUserSession } from '../server/lib/session-store.mjs'
import { assertLoadTestDatabase } from './ride-loadtest-db-guard.mjs'

const prisma = db()
await assertLoadTestDatabase(prisma, { script: 'stay-loadtest-seed' })
const LISTINGS = Number(process.env.LISTINGS ?? 20000)
const HOSTS = Number(process.env.HOSTS ?? Math.max(1, Math.round(LISTINGS / 5)))
const GUESTS = Number(process.env.GUESTS ?? 3000)
const MEDIA = Number(process.env.MEDIA ?? 5)
const OUT = process.env.OUT || '/tmp/stay-loadtest-tokens.json'

// city, governorate, weight, lat, lng (approximate centres)
const CITIES = [
  ['Damascus', 'Damascus', 35, 33.513, 36.292],
  ['Rif Dimashq', 'Rif Dimashq', 8, 33.57, 36.4],
  ['Aleppo', 'Aleppo', 14, 36.202, 37.134],
  ['Latakia', 'Latakia', 14, 35.523, 35.791],
  ['Tartus', 'Tartus', 10, 34.889, 35.886],
  ['Homs', 'Homs', 8, 34.732, 36.713],
  ['Hama', 'Hama', 5, 35.131, 36.757],
  ['As-Suwayda', 'Sweida', 3, 32.709, 36.566],
  ['Daraa', 'Daraa', 3, 32.625, 36.106],
]
const AMENITIES = ['wifi', 'parking', 'ac', 'kitchen', 'washer', 'pool', 'generator', 'balcony', 'tv', 'heating']
const TYPES = ['apartment', 'house', 'villa', 'studio', 'chalet']

async function main() {
  const t0 = Date.now()
  // Retire earlier synthetic hosts/guests (bookings, ledgers and audit rows reference them) and
  // remove their listings from search.
  await prisma.$executeRawUnsafe(`update listings set status = 'REMOVED' where owner_id in (select id from users where email like 'h%@load.rezekme.test')`)
  await prisma.$executeRawUnsafe(`update users set email = 'x-retired-' || id || '@load.rezekme.test'
    where email like 'h%@load.rezekme.test' or email like 'g%@load.rezekme.test'`)

  // hosts (verified) and guests
  await prisma.$executeRawUnsafe(`
    insert into users (id, email, display_name, status, host_verified_at, created_at, updated_at)
    select gen_random_uuid(), 'h' || g || '@load.rezekme.test', 'Load host ' || g, 'ACTIVE', now(), now(), now()
    from generate_series(0, ${HOSTS - 1}) g`)
  await prisma.$executeRawUnsafe(`insert into user_roles (user_id, role) select id, 'HOST' from users where email like 'h%@load.rezekme.test'`)
  await prisma.$executeRawUnsafe(`insert into user_roles (user_id, role) select id, 'GUEST' from users where email like 'h%@load.rezekme.test'`)
  await prisma.$executeRawUnsafe(`
    insert into users (id, email, display_name, status, created_at, updated_at)
    select gen_random_uuid(), 'g' || g || '@load.rezekme.test', 'Load guest ' || g, 'ACTIVE', now(), now()
    from generate_series(0, ${GUESTS - 1}) g`)
  await prisma.$executeRawUnsafe(`insert into user_roles (user_id, role) select id, 'GUEST' from users where email like 'g%@load.rezekme.test'`)
  console.log(`hosts: ${HOSTS} verified, guests: ${GUESTS}`)

  // cities as a weighted lookup table, listings spread over them. Plain (unlogged) helper tables, not
  // temporary ones: Prisma may run each statement on a different pooled connection.
  await prisma.$executeRawUnsafe('drop table if exists load_cities, load_hosts, load_listings')
  const cityValues = CITIES.map(([c, gov, w, lat, lng]) => `('${c}', '${gov}', ${w}, ${lat}, ${lng})`).join(',')
  await prisma.$executeRawUnsafe(`create unlogged table load_cities as
    select c.*, sum(w) over (order by c.city) - w as lo, sum(w) over (order by c.city) as hi, sum(w) over () as total
    from (values ${cityValues}) as c(city, gov, w, lat, lng)`)
  await prisma.$executeRawUnsafe(`create unlogged table load_hosts as
    select id, row_number() over (order by email) - 1 as n from users where email like 'h%@load.rezekme.test'`)
  await prisma.$executeRawUnsafe(`create unlogged table load_listings as
    select gen_random_uuid() as id, gen_random_uuid() as location_id, g as n, random() as r1, random() as r2, random() as r3, random() as r4
    from generate_series(0, ${LISTINGS - 1}) g`)

  await prisma.$executeRawUnsafe(`
    insert into locations (id, country, governorate, city, area, lat, lng, geo, created_at)
    select l.id_loc, 'SY', c.gov, c.city, 'Area ' || (l.n % 20), c.lat + (l.r1 - 0.5) * 0.08, c.lng + (l.r2 - 0.5) * 0.08,
      ST_SetSRID(ST_MakePoint(c.lng + (l.r2 - 0.5) * 0.08, c.lat + (l.r1 - 0.5) * 0.08), 4326), now()
    from (select location_id as id_loc, n, r1, r2, r3 from load_listings) l
    join load_cities c on (l.r3 * c.total) >= c.lo and (l.r3 * c.total) < c.hi`)

  const amen = `array[${AMENITIES.map((a) => `'${a}'`).join(',')}]`
  const types = `array[${TYPES.map((a) => `'${a}'`).join(',')}]`
  await prisma.$executeRawUnsafe(`
    insert into listings (id, owner_id, location_id, division, title_ar, title_en, description, status, price_minor, currency,
      instant_book_enabled, approved_at, metadata, created_at, updated_at)
    select l.id, h.id, l.location_id, 'STAYS', 'إقامة تجريبية ' || l.n, 'Load stay ' || l.n, 'Synthetic load-test listing',
      'APPROVED', (2000 + floor(l.r4 * 18000))::int, 'USD', (l.n % 3 = 0),
      now() - (l.n % 365) * interval '1 day',
      jsonb_build_object(
        'bedrooms', 1 + (l.n % 4), 'bathrooms', 1 + (l.n % 2), 'maxGuests', 2 + (l.n % 7),
        'loadTest', true,
        'visualFilters', jsonb_build_object(
          'propertyType', (${types})[1 + (l.n % ${TYPES.length})],
          'amenities', to_jsonb(array(select a from unnest(${amen}) with ordinality as t(a, i) where (l.n + i) % 3 <> 0)))),
      now() - (l.n % 365) * interval '1 day', now()
    from load_listings l join load_hosts h on h.n = l.n % ${HOSTS}`)

  if (MEDIA > 0) {
    await prisma.$executeRawUnsafe(`
      insert into listing_media (id, listing_id, url, kind, sort_order, created_at)
      select gen_random_uuid(), l.id, 'https://example.invalid/load/' || l.n || '-' || k || '.jpg', 'image', k, now()
      from load_listings l cross join generate_series(0, ${MEDIA - 1}) k`)
  }

  // calendars: 30% of listings have 5 blocked days and 10 price overrides in the next 60 days
  await prisma.$executeRawUnsafe(`
    insert into listing_availability (id, listing_id, date, status, price_override_minor, created_at, updated_at)
    select gen_random_uuid(), l.id, current_date + (d * 4 + (l.n % 4)), 'BLOCKED', null, now(), now()
    from load_listings l cross join generate_series(1, 5) d where l.r1 < 0.3`)
  await prisma.$executeRawUnsafe(`
    insert into listing_availability (id, listing_id, date, status, price_override_minor, created_at, updated_at)
    select gen_random_uuid(), l.id, current_date + 30 + d, 'AVAILABLE', 25000, now(), now()
    from load_listings l cross join generate_series(1, 10) d where l.r1 < 0.3`)

  // history: half the listings have a completed past stay by a guest
  await prisma.$executeRawUnsafe(`
    insert into bookings (id, listing_id, guest_id, status, check_in, check_out, amount_minor, currency, metadata, created_at, updated_at)
    select gen_random_uuid(), l.id, g.id, 'COMPLETED', current_date - 40 + (l.n % 20), current_date - 37 + (l.n % 20), 9000, 'USD', '{"loadTest":true}', now(), now()
    from load_listings l join (select id, row_number() over (order by email) - 1 as n from users where email like 'g%@load.rezekme.test') g
      on g.n = l.n % ${GUESTS}
    where l.r2 < 0.5`)
  console.log(`listings: ${LISTINGS} approved stays (${MEDIA} photos each) with calendars and history`)

  // tokens + listing ids (with city for realistic searches)
  const gRows = await prisma.$queryRawUnsafe(`select id from users where email like 'g%@load.rezekme.test' order by email`)
  const lRows = await prisma.$queryRawUnsafe(`select l.id, loc.city, (l.metadata->>'maxGuests')::int as max_guests from load_listings x join listings l on l.id = x.id join locations loc on loc.id = l.location_id`)
  const out = { guests: [], listings: lRows.map((r) => ({ id: r.id, city: r.city, maxGuests: r.max_guests })), cities: CITIES.map((c) => ({ city: c[0], weight: c[2] })) }
  for (let i = 0; i < gRows.length; i += 200) {
    const chunk = gRows.slice(i, i + 200)
    const issued = await Promise.all(chunk.map((r) => issueUserSession({ id: r.id, roles: [{ role: 'GUEST' }] })))
    issued.forEach((s, j) => out.guests.push({ id: chunk[j].id, token: s.token }))
  }
  writeFileSync(OUT, JSON.stringify(out))
  await prisma.$executeRawUnsafe('drop table if exists load_cities, load_hosts, load_listings')
  await prisma.$executeRawUnsafe('analyze')
  const [{ listings, users }] = await prisma.$queryRawUnsafe(`select (select count(*)::int from listings where status = 'APPROVED') listings, (select count(*)::int from users) users`)
  console.log(`tokens -> ${OUT}; approved listings ${listings}; users ${users}; ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
