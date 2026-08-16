// SYBNB — curated production-inventory VALIDATOR (pure; no DB writes).
// Reads a curated listings JSON and reports ACCEPT/REJECT per row against the production data rules,
// so no test/demo/synthetic/placeholder data can enter production. Run BEFORE any import:
//   node scripts/validate-inventory.mjs docs/launch/inventory-template.json
// Exit 0 only if every row is accepted. Produces an accept/rejection summary (no secrets).
import { readFileSync } from 'node:fs'

const path = process.argv[2] || 'docs/launch/inventory-template.json'
const DIVISIONS = new Set(['STAYS', 'RENTALS', 'BUY', 'NEW_CONSTRUCTION', 'CARS', 'MARKETPLACE'])
const TEST_TITLE = /\b(isolation|test|buy-?test|reject|sample|demo|placeholder|xxx|foo|bar|lorem)\b/i
const TEST_OWNER = /(@sybnb\.local|@example\.com|\.local$)/i
// Minimum plausible price (SYP minor units) per division — anything below is a placeholder.
const MIN_PRICE = { STAYS: 20000, RENTALS: 500000, BUY: 10000000, NEW_CONSTRUCTION: 10000000, CARS: 2000000, MARKETPLACE: 5000 }

let data
try { data = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { console.error('cannot read/parse', path, e.message); process.exit(2) }
const rows = Array.isArray(data) ? data : (data.listings || [])
if (!rows.length) { console.error('no listings found in', path); process.exit(2) }

const seen = new Map()
const accepted = [], rejected = []
for (const [i, r] of rows.entries()) {
  const reasons = []
  const title = (r.title_en || r.title_ar || '').trim()
  const div = String(r.division || '').toUpperCase()
  const price = Number(r.price_minor || 0)
  if (!DIVISIONS.has(div)) reasons.push(`invalid division "${r.division}"`)
  if (title.length < 3) reasons.push('missing/short title')
  if (TEST_TITLE.test(title)) reasons.push('test/demo title pattern')
  if (r.ownerEmail && TEST_OWNER.test(r.ownerEmail)) reasons.push('test owner (*.local/example.com)')
  if (!(price > 0)) reasons.push('missing price')
  else if (MIN_PRICE[div] && price < MIN_PRICE[div]) reasons.push(`placeholder price (${price} < ${MIN_PRICE[div]} min for ${div})`)
  const dupKey = `${div}|${title.toLowerCase()}|${price}`
  seen.set(dupKey, (seen.get(dupKey) || 0) + 1)
  if (seen.get(dupKey) > 1) reasons.push('duplicate (division+title+price)')
  if (reasons.length) rejected.push({ i, title, div, reasons })
  else accepted.push({ i, title, div, price })
}

console.log(`=== INVENTORY VALIDATION: ${path} ===`)
console.log(`  total: ${rows.length}  accepted: ${accepted.length}  rejected: ${rejected.length}`)
if (rejected.length) {
  console.log('\n  REJECTED:')
  for (const r of rejected) console.log(`   [row ${r.i}] ${r.div} "${r.title}" -> ${r.reasons.join('; ')}`)
}
console.log(`\n==== ${rejected.length === 0 ? 'ALL ACCEPTED — safe to import' : 'FIX/REMOVE REJECTED ROWS BEFORE IMPORT'} ====`)
process.exit(rejected.length === 0 ? 0 : 1)
