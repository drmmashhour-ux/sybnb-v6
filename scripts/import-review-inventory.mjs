// SYBNB — import the AUTHORITY-REVIEW SYNTHETIC inventory into the connected database.
// Safe by default: DRY-RUN unless you pass --commit. Never prints secrets.
//   node scripts/import-review-inventory.mjs                 # dry-run (no writes)
//   node scripts/import-review-inventory.mjs --commit        # actually import
// Requires DATABASE_URL in the environment (source .env.production.local for the private prod DB).
// Every row is validated first; only APPROVED synthetic records are written; a full ID manifest is
// emitted to docs/launch/authority-review-manifest.json so the set can be removed cleanly later.
import { readFileSync, writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const MARKER = 'authority_review_synthetic'
const DATA = 'docs/launch/authority-review-inventory.json'
const MANIFEST = 'docs/launch/authority-review-manifest.json'
const COMMIT = process.argv.includes('--commit')

// English city name used for location.city so the UI city filter matches (mock convention).
const CITY_EN = { damascus: 'Damascus', aleppo: 'Aleppo', latakia: 'Latakia', homs: 'Homs', tartus: 'Tartus' }

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required (source .env.production.local)'); process.exit(2) }

const dataset = JSON.parse(readFileSync(DATA, 'utf8'))
const rows = dataset.listings || []
if (!rows.length) { console.error('no listings in', DATA); process.exit(2) }

// Guard: division counts must be non-trivial and every row must carry the synthetic marker.
const bad = rows.find((r) => r.metadata?.inventory_source !== MARKER)
if (bad) { console.error('refusing: a row is missing the synthetic marker:', bad.title_en); process.exit(2) }

const db = new PrismaClient()
const manifest = { marker: MARKER, committedAt: null, dryRun: !COMMIT, ownerIds: [], locationIds: [], listingIds: [], byDivision: {} }

try {
  const existing = await db.listing.count({ where: { metadata: { path: ['inventory_source'], equals: MARKER } } })
  if (existing > 0 && COMMIT && !process.argv.includes('--force')) {
    console.error(`refusing: ${existing} synthetic review listings already present. Run remove-review-inventory.mjs first, or pass --force.`)
    process.exit(2)
  }

  const ownerCache = new Map() // email -> id
  const locCache = new Map()   // gov|city|area -> id

  for (const r of rows) {
    const cityEn = CITY_EN[r.city] || r.city
    // owner (synthetic, .invalid, deduped by email)
    let ownerId = ownerCache.get(r.ownerEmail)
    if (!ownerId) {
      if (COMMIT) {
        const u = await db.user.upsert({
          where: { email: r.ownerEmail },
          update: {},
          create: { email: r.ownerEmail, displayName: r.ownerName, locale: 'ar-SY', status: 'ACTIVE' },
        })
        ownerId = u.id
      } else ownerId = `dry-owner-${ownerCache.size + 1}`
      ownerCache.set(r.ownerEmail, ownerId)
      manifest.ownerIds.push(ownerId)
    }
    // location (deduped by governorate|city|area)
    const locKey = `${r.governorate}|${cityEn}|${r.area}`
    let locationId = locCache.get(locKey)
    if (!locationId) {
      if (COMMIT) {
        const loc = await db.location.create({ data: { country: 'SY', governorate: r.governorate, city: cityEn, area: r.area } })
        locationId = loc.id
      } else locationId = `dry-loc-${locCache.size + 1}`
      locCache.set(locKey, locationId)
      manifest.locationIds.push(locationId)
    }
    // listing (APPROVED so it shows in browse; bilingual title; Arabic-primary description; marker + attrs in metadata)
    const metadata = { ...r.metadata, descriptionEn: r.description_en, area: r.area, areaEn: r.areaEn }
    let listingId = `dry-listing-${manifest.listingIds.length + 1}`
    if (COMMIT) {
      const l = await db.listing.create({
        data: {
          ownerId, locationId, division: r.division,
          titleAr: r.title_ar, titleEn: r.title_en,
          description: r.description_ar, status: 'APPROVED',
          priceMinor: r.price_minor, currency: r.currency || 'SYP',
          metadata,
        },
      })
      listingId = l.id
    }
    manifest.listingIds.push(listingId)
    manifest.byDivision[r.division] = (manifest.byDivision[r.division] || 0) + 1
  }

  if (COMMIT) { manifest.committedAt = new Date().toISOString() }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))

  console.log(`=== REVIEW INVENTORY IMPORT ${COMMIT ? '(COMMITTED)' : '(DRY-RUN — no writes)'} ===`)
  console.log(`  owners: ${manifest.ownerIds.length}  locations: ${manifest.locationIds.length}  listings: ${manifest.listingIds.length}`)
  console.log(`  byDivision:`, manifest.byDivision)
  console.log(`  manifest -> ${MANIFEST}`)
  if (!COMMIT) console.log(`  (re-run with --commit to write)`)
} finally {
  await db.$disconnect()
}
