// Rezekme Stay (STR) — k6 load test (staging or local ONLY; same safety layers as rides.js, see
// lib/safety.js and README.md). Synthetic guests/listings from scripts/stay-loadtest-seed.mjs.
//   browse    guests searching (city weighted by demand, filters, sorts, page 2) and opening listings
//             (detail; half of them also calendar + price quote)
//   bookings  booking requests per minute: calendar -> quote -> POST /api/bookings -> view -> cancel.
//             HOT_PCT % aim at 10 "hot" listings/dates so concurrent requests collide (409 expected).
//             Bookings stay unpaid (PAYMENT_PENDING) and are cancelled: no payment of any kind.
//   monitor   /api/metrics every 10 s (database health), when METRICS_TOKEN is set.
import http from 'k6/http'
import exec from 'k6/execution'
import { sleep } from 'k6'
import { SharedArray } from 'k6/data'
import { Counter, Rate, Trend } from 'k6/metrics'
import { checkTargetUrl, assertLoadTestTarget } from './lib/safety.js'

const BASE = checkTargetUrl(__ENV)
const TOKENS_FILE = __ENV.TOKENS_FILE || '/tmp/stay-loadtest-tokens.json'
const HOT_PCT = Number(__ENV.HOT_PCT ?? 20)
const HOLD_S = Number(__ENV.HOLD_S ?? 10)
const DB_CONN_LIMIT = Number(__ENV.DB_CONN_LIMIT ?? 80)
// tiers: [browsing guests, bookings/min, ramp s, hold s]
const PROFILES = {
  smoke: [[10, 2, 30, 120]],
  'staging-launch': [[50, 5, 60, 240], [150, 15, 60, 240], [300, 30, 60, 300]],
  'staging-step': [[300, 30, 60, 300], [600, 60, 120, 300], [1000, 100, 120, 300], [1500, 150, 120, 300], [2000, 200, 120, 300]],
  'staging-soak': [[300, 30, 120, 1800]],
}
const PROFILE = __ENV.PROFILE || (__ENV.LOADTEST_ENV === 'local' ? 'smoke' : 'staging-launch')
const TIERS = PROFILES[PROFILE]
if (!TIERS) throw new Error(`unknown PROFILE ${PROFILE}; one of ${Object.keys(PROFILES).join(', ')}`)
const totalS = TIERS.reduce((s, t) => s + t[2] + t[3], 0)
const peakBrowsers = Math.max(...TIERS.map((t) => t[0]))
const peakBookings = Math.max(...TIERS.map((t) => t[1]))

const GUESTS = new SharedArray('guests', () => JSON.parse(open(TOKENS_FILE)).guests)
const LISTINGS = new SharedArray('listings', () => JSON.parse(open(TOKENS_FILE)).listings)
const CITIES = JSON.parse(open(TOKENS_FILE)).cities
if (GUESTS.length < peakBookings * 2 + 20) throw new Error(`tokens file has ${GUESTS.length} guests; ${PROFILE} needs ${peakBookings * 2 + 20} (seed GUESTS=...)`)

const bookingsRequested = new Counter('bookings_requested')
const bookingsCreated = new Counter('bookings_created')
const bookingConflicts = new Counter('booking_conflicts_409')
const bookingFailed = new Rate('booking_create_failed')
const dbConnections = new Trend('db_connections')
const dbLongestQuery = new Trend('db_longest_query_s')
const dbUp = new Trend('db_up')
const loopDelay = new Trend('api_event_loop_p99_ms')

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409))

// a browsing guest does a search every 30 s and opens a listing every 20 s -> per guest per minute:
// 2 searches + 3 detail visits; one browse iteration below = 1 search + 1.5 detail visits
const browseStages = TIERS.flatMap(([b, , r, h]) => [{ duration: `${r}s`, target: b * 2 }, { duration: `${h}s`, target: b * 2 }])
const bookStages = TIERS.flatMap(([, k, r, h]) => [{ duration: `${r}s`, target: k }, { duration: `${h}s`, target: k }])
export const options = {
  setupTimeout: '60s',
  scenarios: {
    browse: { executor: 'ramping-arrival-rate', exec: 'browse', startRate: 0, timeUnit: '1m', preAllocatedVUs: Math.max(5, Math.ceil(peakBrowsers / 15)), maxVUs: Math.max(30, peakBrowsers), stages: browseStages },
    bookings: { executor: 'ramping-arrival-rate', exec: 'book', startRate: 0, timeUnit: '1m', preAllocatedVUs: Math.max(5, Math.ceil(peakBookings / 2)), maxVUs: Math.max(20, peakBookings * 2), stages: bookStages, gracefulStop: `${HOLD_S + 30}s` },
    ...(__ENV.METRICS_TOKEN ? { monitor: { executor: 'constant-vus', exec: 'monitor', vus: 1, duration: `${totalS + HOLD_S + 20}s` } } : {}),
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '1m' }],
    'http_req_duration{name:search}': ['p(95)<800'],
    'http_req_duration{name:listing_detail}': ['p(95)<500'],
    'http_req_duration{name:availability}': ['p(95)<500'],
    'http_req_duration{name:stay_quote}': ['p(95)<500'],
    'http_req_duration{name:booking_create}': ['p(95)<1000'],
    'http_req_duration{name:booking_cancel}': ['p(95)<1000'],
    booking_create_failed: ['rate<0.01'],
    db_up: ['min>=1'],
    db_longest_query_s: ['max<5'],
    db_connections: [`max<${DB_CONN_LIMIT}`],
    api_event_loop_p99_ms: ['p(95)<200'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const H = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` })
const get = (path, token, name) => http.get(`${BASE}${path}`, { headers: H(token), tags: { name }, timeout: '30s' })
const send = (method, path, token, body, name) => http.request(method, `${BASE}${path}`, JSON.stringify(body), { headers: H(token), tags: { name }, timeout: '30s' })
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const totalW = CITIES.reduce((s, c) => s + c.weight, 0)
function pickCity() { let r = Math.random() * totalW; for (const c of CITIES) { if ((r -= c.weight) < 0) return c.city } return CITIES[0].city }
const iso = (d) => d.toISOString().slice(0, 10)
function dates(minAhead = 3, span = 120) {
  const start = new Date(Date.now() + (minAhead + Math.floor(Math.random() * span)) * 864e5)
  return { checkIn: iso(start), checkOut: iso(new Date(start.getTime() + (1 + Math.floor(Math.random() * 5)) * 864e5)) }
}
const FILTERS = ['', '', '', '&sort=priceLow', '&bedroomsMin=2', '&amenities=wifi', '&amenities=wifi,parking', '&priceMax=8000', '&sort=priceHigh']

export function setup() {
  assertLoadTestTarget(BASE)
  return {}
}

export function browse() {
  const guest = GUESTS[GUESTS.length - 1 - (exec.scenario.iterationInTest % Math.floor(GUESTS.length / 2))]
  const q = `/api/listings?division=STAYS&city=${encodeURIComponent(pickCity())}${pick(FILTERS)}`
  const r = get(q, guest.token, 'search')
  let next = null
  try { next = r.json('nextCursor') } catch { next = null }
  if (next && Math.random() < 0.3) get(`${q}&cursor=${encodeURIComponent(next)}`, guest.token, 'search')
  const visits = Math.random() < 0.5 ? 1 : 2
  for (let v = 0; v < visits; v++) {
    const l = pick(LISTINGS)
    get(`/api/listings/${l.id}`, guest.token, 'listing_detail')
    if (Math.random() < 0.5) {
      const d = dates()
      get(`/api/listings/${l.id}/availability`, guest.token, 'availability')
      get(`/api/listings/${l.id}/quote?checkIn=${d.checkIn}&checkOut=${d.checkOut}`, guest.token, 'stay_quote')
    }
  }
}

const HOT = LISTINGS.slice(0, 10)
const HOT_DATES = [0, 1, 2, 3].map((k) => ({ checkIn: iso(new Date(Date.now() + (200 + k * 3) * 864e5)), checkOut: iso(new Date(Date.now() + (202 + k * 3) * 864e5)) }))
export function book() {
  const guest = GUESTS[exec.scenario.iterationInTest % Math.floor(GUESTS.length / 2)]
  const hot = Math.random() * 100 < HOT_PCT
  const l = hot ? pick(HOT) : pick(LISTINGS)
  const d = hot ? pick(HOT_DATES) : dates(10, 300)
  get(`/api/listings/${l.id}/availability`, guest.token, 'availability')
  get(`/api/listings/${l.id}/quote?checkIn=${d.checkIn}&checkOut=${d.checkOut}`, guest.token, 'stay_quote')
  sleep(Math.random() * 3)
  const r = send('POST', '/api/bookings', guest.token, { listingId: l.id, checkIn: d.checkIn, checkOut: d.checkOut, guests: 1 }, 'booking_create')
  bookingsRequested.add(1)
  let id = null
  try { id = r.json('booking.id') } catch { id = null }
  if (r.status === 409) { bookingConflicts.add(1); bookingFailed.add(false); return }
  bookingFailed.add(!id)
  if (!id) return
  bookingsCreated.add(1)
  get(`/api/bookings/${id}`, guest.token, 'booking_view')
  sleep(HOLD_S)
  send('PATCH', `/api/bookings/${id}/cancel`, guest.token, { reason: 'load test' }, 'booking_cancel')
}

export function monitor() {
  const res = http.get(`${BASE}/api/metrics`, { headers: { authorization: `Bearer ${__ENV.METRICS_TOKEN}` }, tags: { name: 'metrics' }, timeout: '10s' })
  if (res.status === 200) {
    const text = String(res.body || '')
    const g = (n) => { const m = new RegExp(`^${n} ([0-9.eE+-]+)$`, 'm').exec(text); return m ? Number(m[1]) : null }
    for (const [trend, n] of [[dbUp, 'db_up'], [dbConnections, 'db_connections'], [dbLongestQuery, 'db_longest_active_query_seconds'], [loopDelay, 'event_loop_delay_p99_ms']]) {
      const v = g(n)
      if (v !== null) trend.add(v)
    }
  } else dbUp.add(0)
  sleep(10)
}

export function handleSummary(data) {
  const m = data.metrics
  const val = (n, k) => m[n]?.values?.[k]
  const durS = (data.state?.testRunDurationMs || totalS * 1000) / 1000
  const report = {
    target: BASE, profile: PROFILE, durationS: Math.round(durS),
    http: { totalRequests: val('http_reqs', 'count') || 0, requestsPerSecond: +(val('http_reqs', 'rate') || 0).toFixed(1), failedRate: val('http_req_failed', 'rate') || 0 },
    bookings: {
      requested: val('bookings_requested', 'count') || 0,
      requestsPerMinute: +(((val('bookings_requested', 'count') || 0) / Math.min(durS, totalS)) * 60).toFixed(1),
      created: val('bookings_created', 'count') || 0, conflicts409: val('booking_conflicts_409', 'count') || 0,
    },
    p95ms: Object.fromEntries(['search', 'listing_detail', 'availability', 'stay_quote', 'booking_create', 'booking_cancel'].map((n) => [n, val(`http_req_duration{name:${n}}`, 'p(95)')])),
    thresholdsFailed: Object.entries(m).filter(([, v]) => v.thresholds && Object.values(v.thresholds).some((t) => !t.ok)).map(([k]) => k),
  }
  const fmt = (v) => (v === undefined || v === null ? 'n/a' : (+v).toFixed(0))
  const lines = [
    `Rezekme Stay k6 — ${PROFILE} against ${BASE} (${report.durationS}s)`,
    `  HTTP: ${report.http.totalRequests} requests, ${report.http.requestsPerSecond} req/s overall, failed ${(report.http.failedRate * 100).toFixed(2)}%`,
    `  Bookings: ${report.bookings.requested} requested = ${report.bookings.requestsPerMinute} booking requests/min; created ${report.bookings.created}, date conflicts (409) ${report.bookings.conflicts409}`,
    `  p95 ms: ${Object.entries(report.p95ms).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}`,
    `  Thresholds failed: ${report.thresholdsFailed.length ? report.thresholdsFailed.join(', ') : 'none'}`,
  ]
  return { stdout: `${lines.join('\n')}\n`, [__ENV.SUMMARY_FILE || `k6-stays-${PROFILE}-summary.json`]: JSON.stringify({ report, k6: data }, null, 1) }
}
