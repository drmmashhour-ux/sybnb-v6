// SYBNB — production DB PRE-FLIGHT (read-only, never prints secrets).
// Resolves DATABASE_URL from env or from a postgres URL anywhere in .env.production.local (incl. a
// commented line), normalizes Render INTERNAL host -> EXTERNAL (adds region domain) so it is reachable
// off-Render, connects, and asserts: correct schema (expected tables), migrations applied, and NO
// unexpected real customer/listing data. On success it persists the normalized URL back to the
// DATABASE_URL= line so the import can source it. Prints only host (no creds), counts, verdicts.
import { readFileSync, writeFileSync } from 'node:fs'

const ENV = '.env.production.local'
const REGION_SUFFIX = process.env.RENDER_PG_REGION_SUFFIX || '.frankfurt-postgres.render.com'
const MARKER = 'authority_review_synthetic'

function resolveUrl() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) return process.env.DATABASE_URL.trim()
  const txt = readFileSync(ENV, 'utf8')
  const m = txt.match(/postgres(?:ql)?:\/\/\S+/)
  if (!m) return null
  return m[0].trim()
}
function normalize(url) {
  const u = new URL(url)
  // Render internal host is a single label (no dot); external adds the region domain + explicit port.
  if (!u.hostname.includes('.')) { u.hostname = u.hostname + REGION_SUFFIX; if (!u.port) u.port = '5432' }
  if (!u.searchParams.get('sslmode')) u.searchParams.set('sslmode', 'require')
  return u.toString()
}
const raw = resolveUrl()
if (!raw) { console.error('no DATABASE_URL found in env or', ENV); process.exit(2) }
let url
try { url = normalize(raw) } catch (e) { console.error('cannot parse DATABASE_URL:', e.message); process.exit(2) }
const safeHost = (() => { const u = new URL(url); return `${u.hostname}:${u.port || '5432'}${u.pathname}` })()
process.env.DATABASE_URL = url

const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()
try {
  console.log('=== SYBNB PROD DB PRE-FLIGHT ===')
  console.log(`  endpoint: ${safeHost}   (credentials hidden)`)
  await db.$queryRaw`SELECT 1`
  console.log('  connectivity: OK')

  const migs = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`)
  const applied = migs[0]?.n ?? 0
  console.log(`  migrations applied: ${applied} (local has 11)`)
  if (applied < 11) { console.error('  STOP: fewer migrations than local — wrong/incomplete DB'); process.exit(3) }

  // schema sanity: expected core tables exist
  const tables = await db.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
  const names = new Set(tables.map((t) => t.table_name))
  const need = ['listings', 'users', 'locations']
  const missing = need.filter((t) => !names.has(t))
  if (missing.length) { console.error('  STOP: missing expected tables:', missing.join(',')); process.exit(3) }
  console.log('  schema: core tables present (listings, users, locations)')

  // REAL-DATA guard — no non-synthetic listings may exist before import
  const totalListings = await db.listing.count()
  const synthetic = await db.listing.count({ where: { metadata: { path: ['inventory_source'], equals: MARKER } } })
  const realListings = totalListings - synthetic
  const totalUsers = await db.user.count()
  const invalidOwners = await db.user.count({ where: { email: { endsWith: '.invalid' } } })
  console.log(`  listings: total=${totalListings} synthetic=${synthetic} REAL(non-synthetic)=${realListings}`)
  console.log(`  users: total=${totalUsers} synthetic(.invalid)=${invalidOwners} other=${totalUsers - invalidOwners}`)
  if (realListings > 0) { console.error(`  STOP: ${realListings} unexpected non-synthetic listing(s) present — refusing to import into a DB with real data`); process.exit(4) }

  // persist normalized URL into the DATABASE_URL= line so import/remove can source it (no printing)
  const txt = readFileSync(ENV, 'utf8')
  const next = txt.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`)
  if (next !== txt) { writeFileSync(ENV, next); console.log('  DATABASE_URL line: normalized + saved to .env.production.local') }

  console.log('\n==== PRE-FLIGHT PASS — correct production DB, no real data, safe to import ====')
} catch (e) {
  console.error('  PRE-FLIGHT FAILED:', e.message?.split('\n')[0])
  process.exit(1)
} finally { await db.$disconnect() }
