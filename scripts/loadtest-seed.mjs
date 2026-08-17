// SYBNB — LOAD-TEST seeder. Bulk-inserts a large synthetic dataset into an ISOLATED database only.
// NEVER run against production. Requires DATABASE_URL pointing at a throwaway load-test DB.
//   COUNT=25000 DATABASE_URL=postgresql://.../sybnb_load node scripts/loadtest-seed.mjs
// Data is clearly marked metadata.load_test=true and lives only in the isolated DB.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const COUNT = Number(process.env.COUNT || 25000)
const url = process.env.DATABASE_URL || ''
if (!url.includes('sybnb_load')) { console.error('refusing: DATABASE_URL must point at a *sybnb_load* isolated DB'); process.exit(2) }

const DIVS = ['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION']
const CITIES = ['Damascus', 'Aleppo', 'Latakia', 'Homs', 'Tartus']
const GOV = { Damascus: 'دمشق', Aleppo: 'حلب', Latakia: 'اللاذقية', Homs: 'حمص', Tartus: 'طرطوس' }
const BRANDS = ['toyota', 'hyundai', 'kia', 'mercedes', 'bmw', 'nissan']
const PTYPE = ['apartment', 'villa', 'studio']

async function main() {
  console.time('seed')
  // owners (200) + locations (5 cities x 20 areas = 100)
  const owners = Array.from({ length: 200 }, (_, i) => ({ email: `load-owner-${i}@load.invalid`, displayName: `Load Host ${i}`, locale: 'ar-SY', status: 'ACTIVE' }))
  await db.user.createMany({ data: owners, skipDuplicates: true })
  const ownerRows = await db.user.findMany({ where: { email: { endsWith: '@load.invalid' } }, select: { id: true } })
  const ownerIds = ownerRows.map((o) => o.id)

  const locs = []
  for (const c of CITIES) for (let a = 0; a < 20; a++) locs.push({ country: 'SY', governorate: GOV[c], city: c, area: `Area-${a}` })
  await db.location.createMany({ data: locs, skipDuplicates: true })
  const locRows = await db.location.findMany({ where: { country: 'SY' }, select: { id: true } })
  const locIds = locRows.map((l) => l.id)

  // listings in batches of 2000
  let made = 0
  const BATCH = 2000
  while (made < COUNT) {
    const n = Math.min(BATCH, COUNT - made)
    const rows = []
    for (let i = 0; i < n; i++) {
      const idx = made + i
      const div = DIVS[idx % DIVS.length]
      const city = CITIES[idx % CITIES.length]
      const vf = div === 'CARS' ? { carBrand: BRANDS[idx % BRANDS.length] } : { propertyType: PTYPE[idx % PTYPE.length] }
      rows.push({
        ownerId: ownerIds[idx % ownerIds.length],
        locationId: locIds[idx % locIds.length],
        division: div,
        titleAr: `عقار تجريبي ${idx} - ${GOV[city]}`,
        titleEn: `Load listing ${idx} - ${city}`,
        description: `وصف تجريبي للحمل رقم ${idx}`,
        status: 'APPROVED',
        priceMinor: 20000 + (idx % 1000) * 50000,
        currency: 'SYP',
        metadata: { load_test: true, visualFilters: vf, descriptionEn: `Load-test listing ${idx}` },
      })
    }
    await db.listing.createMany({ data: rows })
    made += n
    if (made % 5000 === 0) console.log(`  seeded ${made}/${COUNT}`)
  }
  const total = await db.listing.count()
  console.log(`DONE. listings total=${total} owners=${ownerIds.length} locations=${locIds.length}`)
  console.timeEnd('seed')
}
main().finally(() => db.$disconnect())
