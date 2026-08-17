// SYBNB — LOAD-TEST harness (read/write journeys). Hits an ISOLATED local API only.
// Measures p50/p95/p99 latency, throughput (req/s), error rate per journey, at a given concurrency.
//   BASE=http://127.0.0.1:3061 CONC=50 DURATION=10 node scripts/loadtest-run.mjs
// Never point BASE at production.
const BASE = (process.env.BASE || 'http://127.0.0.1:3061').replace(/\/$/, '')
const CONC = Number(process.env.CONC || 50)
const DURATION = Number(process.env.DURATION || 10) * 1000
if (BASE.includes('onrender.com') || BASE.includes('sybnb.app')) { console.error('refusing: never load-test production'); process.exit(2) }

const DIVS = ['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION']
let listingIds = []

// Weighted journey mix (read-heavy, realistic marketplace).
function nextRequest() {
  const r = Math.random()
  if (r < 0.40) { const d = DIVS[(Math.random() * DIVS.length) | 0]; return { name: 'search_division', path: `/api/listings?division=${d}` } }
  if (r < 0.55) { const d = DIVS[(Math.random() * DIVS.length) | 0]; return { name: 'search_filtered', path: `/api/listings?division=${d}&priceMin=100000&priceMax=50000000` } }
  if (r < 0.75 && listingIds.length) { const id = listingIds[(Math.random() * listingIds.length) | 0]; return { name: 'listing_detail', path: `/api/listings/${id}` } }
  if (r < 0.92 && listingIds.length) { const id = listingIds[(Math.random() * listingIds.length) | 0]; return { name: 'availability', path: `/api/listings/${id}/availability` } }
  return { name: 'health_ready', path: '/api/health/ready' }
}

const stats = {} // name -> {lat:[], errors, count}
function rec(name, ms, ok) { const s = stats[name] || (stats[name] = { lat: [], errors: 0, count: 0 }); s.count++; if (ok) s.lat.push(ms); else s.errors++ }
const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))] }

async function worker(deadline) {
  while (Date.now() < deadline) {
    const req = nextRequest()
    const t0 = performance.now()
    try {
      const res = await fetch(`${BASE}${req.path}`)
      await res.text()
      rec(req.name, performance.now() - t0, res.status < 500)
    } catch { rec(req.name, performance.now() - t0, false) }
  }
}

async function main() {
  // warm listing id pool
  const r = await fetch(`${BASE}/api/listings?division=STAYS`); const j = await r.json()
  listingIds = (j.listings || []).map((l) => l.id)
  console.log(`=== LOAD TEST @ ${BASE}  conc=${CONC}  duration=${DURATION / 1000}s  idPool=${listingIds.length} ===`)
  const t0 = Date.now(); const deadline = t0 + DURATION
  await Promise.all(Array.from({ length: CONC }, () => worker(deadline)))
  const wall = (Date.now() - t0) / 1000
  let total = 0, totalErr = 0
  console.log(`\n  journey            count    rps    p50    p95    p99   errors`)
  for (const [name, s] of Object.entries(stats)) {
    total += s.count; totalErr += s.errors
    console.log(`  ${name.padEnd(18)} ${String(s.count).padStart(5)}  ${(s.count / wall).toFixed(0).padStart(5)}  ${pct(s.lat, 0.5).toFixed(0).padStart(4)}ms ${pct(s.lat, 0.95).toFixed(0).padStart(4)}ms ${pct(s.lat, 0.99).toFixed(0).padStart(4)}ms  ${s.errors}`)
  }
  console.log(`\n  TOTAL: ${total} reqs  ${(total / wall).toFixed(0)} rps  errorRate=${((totalErr / total) * 100).toFixed(2)}%  wall=${wall.toFixed(1)}s`)
}
main()
