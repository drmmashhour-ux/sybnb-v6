// SYBNB — CLEAN REMOVAL of the authority-review synthetic dataset.
// Deletes only records carrying the synthetic marker + their synthetic .invalid owners/locations.
// Safe by default: DRY-RUN unless --commit.
//   node scripts/remove-review-inventory.mjs            # count what would be removed
//   node scripts/remove-review-inventory.mjs --commit   # remove it
import { PrismaClient } from '@prisma/client'
const MARKER = 'authority_review_synthetic'
const COMMIT = process.argv.includes('--commit')
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2) }
const db = new PrismaClient()
try {
  const where = { metadata: { path: ['inventory_source'], equals: MARKER } }
  const listings = await db.listing.findMany({ where, select: { id: true, ownerId: true, locationId: true } })
  const ownerIds = [...new Set(listings.map((l) => l.ownerId))]
  const locationIds = [...new Set(listings.map((l) => l.locationId).filter(Boolean))]
  // only delete owners that are synthetic (.invalid) AND have no non-synthetic listings
  const owners = await db.user.findMany({ where: { id: { in: ownerIds }, email: { endsWith: '.invalid' } }, select: { id: true } })
  const safeOwnerIds = owners.map((o) => o.id)
  console.log(`=== REVIEW INVENTORY REMOVAL ${COMMIT ? '(COMMITTING)' : '(DRY-RUN)'} ===`)
  console.log(`  listings: ${listings.length}  synthetic owners: ${safeOwnerIds.length}  locations: ${locationIds.length}`)
  if (COMMIT) {
    const dl = await db.listing.deleteMany({ where })
    const dloc = locationIds.length ? await db.location.deleteMany({ where: { id: { in: locationIds } } }) : { count: 0 }
    const du = safeOwnerIds.length ? await db.user.deleteMany({ where: { id: { in: safeOwnerIds } } }) : { count: 0 }
    console.log(`  removed -> listings:${dl.count} locations:${dloc.count} owners:${du.count}`)
  } else console.log(`  (re-run with --commit to remove)`)
} finally { await db.$disconnect() }
