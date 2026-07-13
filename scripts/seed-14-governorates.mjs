// One-off seed script: creates one simple APPROVED STAYS listing per Syrian governorate (all 14),
// tagged with metadata.seedBatch so they can be identified/removed later. Used to verify that
// per-governorate search filtering stays correctly isolated across the whole country, not just Homs.
import { db, disconnectDb } from '../server/lib/prisma.mjs'

const GOVERNORATES = [
  { gov: 'damascus', govAr: 'دمشق', city: 'damascus-city', area: 'old-city' },
  { gov: 'rif-dimashq', govAr: 'ريف دمشق', city: 'jaramana', area: 'city-center' },
  { gov: 'aleppo', govAr: 'حلب', city: 'aleppo-city', area: 'city-center' },
  { gov: 'homs', govAr: 'حمص', city: 'homs-city', area: 'city-center' },
  { gov: 'hama', govAr: 'حماة', city: 'hama-city', area: 'city-center' },
  { gov: 'latakia', govAr: 'اللاذقية', city: 'latakia-city', area: 'city-center' },
  { gov: 'tartus', govAr: 'طرطوس', city: 'tartus-city', area: 'city-center' },
  { gov: 'idlib', govAr: 'إدلب', city: 'idlib-city', area: 'city-center' },
  { gov: 'daraa', govAr: 'درعا', city: 'daraa-city', area: 'daraa-balad' },
  { gov: 'sweida', govAr: 'السويداء', city: 'sweida-city', area: 'city-center' },
  { gov: 'deir-ezzor', govAr: 'دير الزور', city: 'deir-ezzor-city', area: 'city-center' },
  { gov: 'raqqa', govAr: 'الرقة', city: 'raqqa-city', area: 'city-center' },
  { gov: 'hasakah', govAr: 'الحسكة', city: 'hasakah-city', area: 'city-center' },
  { gov: 'quneitra', govAr: 'القنيطرة', city: 'quneitra-city', area: 'city-center' },
]

const SEED_TAG = 'seed-14-governorates-2026-07'

async function main() {
  const host = await db().user.findFirst({ where: { roles: { some: { role: 'HOST' } } } })
  if (!host) {
    console.error('No host user found in DB — cannot create seed listings.')
    process.exit(1)
  }

  const created = []
  for (const entry of GOVERNORATES) {
    const listing = await db().listing.create({
      data: {
        ownerId: host.id,
        division: 'STAYS',
        titleAr: `استضافة بسيطة في ${entry.govAr}`,
        titleEn: `Simple hosting in ${entry.gov}`,
        description: 'Seed listing created to verify per-governorate search isolation across all 14 Syrian governorates.',
        status: 'APPROVED',
        priceMinor: 150000,
        currency: 'SYP',
        metadata: {
          governorate: entry.gov,
          city: entry.city,
          area: entry.area,
          bedrooms: 1,
          bathrooms: 1,
          propertyType: 'apartment',
          seedBatch: SEED_TAG,
        },
      },
    })
    created.push({ gov: entry.gov, id: listing.id, title: listing.titleAr })
  }

  console.log(JSON.stringify({ createdCount: created.length, created }, null, 2))
  await disconnectDb()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
