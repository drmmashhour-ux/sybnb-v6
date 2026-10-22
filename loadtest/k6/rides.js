// Rezekme Rides — realistic k6 load test (staging or local ONLY; see lib/safety.js and README.md).
//
// Scenarios (all synthetic accounts from scripts/ride-loadtest-seed.mjs; payments come from the
// synthetic wallet credits that seed writes, so no card, Stripe call or real person is involved):
//   drivers  one VU = one driver phone: location every 8 s, pending-offers poll every 4 s, accepts its
//            offer, then follows the ride (status poll every 4 s) until it is completed or cancelled.
//   browse   riders on the home screen: driver availability + fare estimate (quote).
//   rides    ride requests per minute. Each one: fare estimate -> request -> wait for a driver
//            (poll every 4 s). Outcomes: ~CANCEL_BEFORE_MATCH_PCT cancelled while waiting,
//            ~CANCEL_AFTER_MATCH_PCT cancelled after a driver accepts, the rest COMPLETED: driver
//            arriving -> pickup code -> trip -> completed (fare settles to the driver's synthetic wallet).
//            The trip steps are sent with the matched driver's token (the rider reads the pickup code
//            and "tells" the driver, as in real life; k6 VUs cannot share memory).
//   monitor  every 10 s reads /api/metrics (METRICS_TOKEN) for database and dispatch health.
//
// Run:  see loadtest/k6/README.md. Never point this at production; it refuses to.
import http from 'k6/http'
import exec from 'k6/execution'
import { sleep, check } from 'k6'
import { SharedArray } from 'k6/data'
import { Counter, Rate, Trend } from 'k6/metrics'
import { checkTargetUrl, assertLoadTestTarget } from './lib/safety.js'
import { PROFILES, profileDurationS, peak, driverStages, browseStages, rideStages } from './lib/profiles.js'

const BASE = checkTargetUrl(__ENV) // throws before anything else if the target is not allowed
const PROFILE = __ENV.PROFILE || (__ENV.LOADTEST_ENV === 'local' ? 'smoke' : 'staging-launch')
const TIERS = PROFILES[PROFILE]
if (!TIERS) throw new Error(`unknown PROFILE ${PROFILE}; one of ${Object.keys(PROFILES).join(', ')}`)
const TOKENS_FILE = __ENV.TOKENS_FILE || '/tmp/ride-loadtest-tokens.json'
const CANCEL_BEFORE_MATCH_PCT = Number(__ENV.CANCEL_BEFORE_MATCH_PCT ?? 10)
const CANCEL_AFTER_MATCH_PCT = Number(__ENV.CANCEL_AFTER_MATCH_PCT ?? 20)
const MATCH_TIMEOUT_S = Number(__ENV.MATCH_TIMEOUT_S ?? 90)
const PICKUP_S = Number(__ENV.PICKUP_S ?? 10)
const TRIP_S = Number(__ENV.TRIP_S ?? 20)
const DB_CONN_LIMIT = Number(__ENV.DB_CONN_LIMIT ?? 80)

const DRIVERS = new SharedArray('drivers', () => JSON.parse(open(TOKENS_FILE)).drivers)
const RIDERS = new SharedArray('riders', () => JSON.parse(open(TOKENS_FILE)).riders)
const BOX = JSON.parse(open(TOKENS_FILE)).box
const PEAK = peak(TIERS)
if (DRIVERS.length < PEAK.drivers * 1.5) throw new Error(`tokens file has ${DRIVERS.length} drivers; profile ${PROFILE} needs at least ${Math.ceil(PEAK.drivers * 1.5)} (seed DRIVERS=...)`)
// a rider can only hold one open ride at a time; keep the pool comfortably larger than concurrent rides
// half the pool requests rides (each ride lives up to ~2.5 min), the other half browses
const MIN_RIDERS = PEAK.ridesPerMin * 6 + 20
if (RIDERS.length < MIN_RIDERS) throw new Error(`tokens file has ${RIDERS.length} riders; profile ${PROFILE} needs at least ${MIN_RIDERS} (seed RIDERS=...)`)

const DRIVER_TOKEN = {}
for (let i = 0; i < DRIVERS.length; i++) DRIVER_TOKEN[DRIVERS[i].id] = DRIVERS[i].token

// ---- custom metrics ----
const ridesRequested = new Counter('rides_requested')
const rideCreateFailed = new Rate('ride_create_failed')
const ridesMatched = new Counter('rides_matched')
const ridesUnmatched = new Counter('rides_unmatched_timeout')
const ridesCompleted = new Counter('rides_completed')
const ridesCancelled = new Counter('rides_cancelled')
const rideMatched = new Rate('ride_matched_rate')
const rideMatchSeconds = new Trend('ride_match_seconds')
const tripStepFailed = new Rate('trip_step_failed')
const acceptConflicts = new Counter('driver_accept_conflicts')
const dbUp = new Trend('db_up')
const dbConnections = new Trend('db_connections')
const dbLongestQuery = new Trend('db_longest_query_s')
const dbActiveQueries = new Trend('db_active_queries')
const loopDelay = new Trend('api_event_loop_p99_ms')
const waitingOver2m = new Trend('open_rides_waiting_over_2m')
const paymentFailuresDuring = new Counter('payment_failures_during_test')

// 409 is an expected answer (two drivers racing for a ride, cancel vs accept); it is not an error.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409))

const totalS = profileDurationS(TIERS)
// drivers stay online after the last ride request until every ride in flight can finish
const DRAIN_S = MATCH_TIMEOUT_S + PICKUP_S + TRIP_S + 20
export const options = {
  discardResponseBodies: false,
  setupTimeout: '60s',
  scenarios: {
    drivers: {
      executor: 'ramping-vus', exec: 'driverPhone', startVUs: 0,
      stages: [...driverStages(TIERS), { duration: `${DRAIN_S}s`, target: TIERS[TIERS.length - 1].drivers }, { duration: '10s', target: 0 }],
      gracefulRampDown: '0s', gracefulStop: '5s',
    },
    browse: {
      executor: 'ramping-arrival-rate', exec: 'browse', startRate: 0, timeUnit: '1m',
      preAllocatedVUs: Math.max(5, Math.ceil(PEAK.browsers / 10)), maxVUs: Math.max(20, PEAK.browsers),
      stages: browseStages(TIERS),
    },
    rides: {
      executor: 'ramping-arrival-rate', exec: 'rideLifecycle', startRate: 0, timeUnit: '1m',
      // each ride lives up to ~MATCH_TIMEOUT_S + PICKUP_S + TRIP_S seconds
      preAllocatedVUs: Math.max(5, Math.ceil(PEAK.ridesPerMin * 2)), maxVUs: Math.max(20, PEAK.ridesPerMin * 4),
      stages: rideStages(TIERS), gracefulStop: `${MATCH_TIMEOUT_S + PICKUP_S + TRIP_S + 30}s`,
    },
    ...(__ENV.METRICS_TOKEN ? {
      monitor: { executor: 'constant-vus', exec: 'monitor', vus: 1, duration: `${totalS + DRAIN_S + 10}s` },
    } : {}),
  },
  thresholds: {
    // errors (5xx, 4xx other than 409, timeouts); aborts the run early if it goes bad
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '1m' }],
    // response times per endpoint (p95), in ms
    'http_req_duration{name:driver_location}': ['p(95)<500'],
    'http_req_duration{name:driver_pending}': ['p(95)<500'],
    'http_req_duration{name:ride_poll}': ['p(95)<500'],
    'http_req_duration{name:availability}': ['p(95)<600'],
    'http_req_duration{name:fare_estimate}': ['p(95)<800'],
    'http_req_duration{name:ride_request}': ['p(95)<1000'],
    'http_req_duration{name:driver_accept}': ['p(95)<1000'],
    'http_req_duration{name:ride_cancel}': ['p(95)<1000'],
    'http_req_duration{name:trip_status}': ['p(95)<1000'],
    // ride matching
    ride_create_failed: ['rate<0.01'],
    ride_matched_rate: ['rate>0.90'],
    ride_match_seconds: ['p(50)<10', 'p(95)<30'],
    trip_step_failed: ['rate<0.01'],
    // database / server health (from /api/metrics; empty without METRICS_TOKEN)
    db_up: ['min>=1'],
    db_longest_query_s: ['max<5'],
    db_connections: [`max<${DB_CONN_LIMIT}`],
    api_event_loop_p99_ms: ['p(95)<200'],
    open_rides_waiting_over_2m: ['max<5'],
    payment_failures_during_test: ['count<1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const H = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` })
const rnd = (a, b) => a + Math.random() * (b - a)
const point = () => ({ lat: +rnd(BOX.lat0, BOX.lat1).toFixed(5), lng: +rnd(BOX.lng0, BOX.lng1).toFixed(5) })
function req(method, path, token, body, name) {
  return http.request(method, `${BASE}${path}`, body === undefined ? null : JSON.stringify(body), { headers: H(token), tags: { name }, timeout: '30s' })
}
function json(res) { try { return res.json() } catch { return null } }

export function setup() {
  const health = assertLoadTestTarget(BASE)
  console.log(`target ${BASE} confirmed as a load-test environment; profile ${PROFILE}, ${totalS}s, peak ${JSON.stringify(PEAK)}`)
  return { startedAt: Date.now(), securityTimeReady: health.securityTimeReady }
}

// ---------------- driver phone ----------------
export function driverPhone() {
  // a VU is one driver for its lifetime (one long iteration); new VUs on later tiers are new drivers
  const d = DRIVERS[exec.scenario.iterationInTest % DRIVERS.length]
  const pos = { lat: d.lat, lng: d.lng }
  let tick = 0
  let rideId = null
  sleep(rnd(0, 4)) // phones are not synchronised
  for (;;) {
    if (tick % 2 === 0) {
      pos.lat += rnd(-0.0005, 0.0005)
      pos.lng += rnd(-0.0005, 0.0005)
      req('PATCH', '/api/driver/location', d.token, pos, 'driver_location')
    }
    if (rideId) {
      const r = json(req('GET', `/api/sr/rides/${rideId}`, d.token, undefined, 'ride_poll'))
      const s = r?.ride?.status
      if (!s || s === 'COMPLETED' || s === 'CANCELLED' || s === 'EXPIRED') rideId = null
    } else {
      const p = json(req('GET', '/api/driver/rides/pending', d.token, undefined, 'driver_pending'))
      const offer = p?.rides?.find((x) => x.offeredToYou)
      if (offer) {
        const a = req('PATCH', `/api/sr/rides/${offer.id}/accept-offer`, d.token, {}, 'driver_accept')
        if (a.status === 200) rideId = offer.id
        else if (a.status === 409) acceptConflicts.add(1)
      }
    }
    tick++
    sleep(4)
  }
}

// ---------------- rider on the home screen ----------------
export function browse() {
  const rider = RIDERS[RIDERS.length - 1 - (exec.scenario.iterationInTest % Math.floor(RIDERS.length / 2))]
  const p = point()
  req('GET', `/api/sr/availability?lat=${p.lat}&lng=${p.lng}`, rider.token, undefined, 'availability')
  req('POST', '/api/sr/quote', rider.token, { pickup: 'Load pickup', dropoff: 'Load dropoff', category: 'SR Economy', pickupCoords: p, dropoffCoords: point() }, 'fare_estimate')
}

// ---------------- one ride, end to end ----------------
export function rideLifecycle() {
  // first half of the rider pool requests rides; browse uses the second half
  const rider = RIDERS[exec.scenario.iterationInTest % Math.floor(RIDERS.length / 2)]
  const a = point()
  const b = point()
  const body = { pickup: 'Load pickup', dropoff: 'Load dropoff', category: 'SR Economy', pickupCoords: a, dropoffCoords: b }
  req('POST', '/api/sr/quote', rider.token, body, 'fare_estimate')
  sleep(rnd(2, 5)) // rider reads the price
  const created = req('POST', '/api/sr/rides', rider.token, body, 'ride_request')
  const id = json(created)?.ride?.id
  ridesRequested.add(1)
  rideCreateFailed.add(!id)
  if (!id) return
  const t0 = Date.now()
  const roll = Math.random() * 100

  // wait for a driver
  let ride = null
  const giveUpAt = t0 + (roll < CANCEL_BEFORE_MATCH_PCT ? rnd(5, 20) * 1000 : MATCH_TIMEOUT_S * 1000)
  while (Date.now() < giveUpAt) {
    sleep(4)
    ride = json(req('GET', `/api/sr/rides/${id}`, rider.token, undefined, 'ride_poll'))?.ride
    if (ride?.driverId) break
    if (ride && ['CANCELLED', 'EXPIRED'].includes(ride.status)) break
  }
  if (!ride?.driverId) {
    if (roll >= CANCEL_BEFORE_MATCH_PCT) { ridesUnmatched.add(1); rideMatched.add(false) }
    req('PATCH', `/api/sr/rides/${id}/cancel`, rider.token, { reason: roll < CANCEL_BEFORE_MATCH_PCT ? 'changed my mind' : 'no driver found' }, 'ride_cancel')
    ridesCancelled.add(1)
    return
  }
  ridesMatched.add(1)
  rideMatched.add(true)
  rideMatchSeconds.add((Date.now() - t0) / 1000)

  if (roll < CANCEL_BEFORE_MATCH_PCT + CANCEL_AFTER_MATCH_PCT) {
    sleep(rnd(5, 15))
    req('PATCH', `/api/sr/rides/${id}/cancel`, rider.token, { reason: 'load test cancel after match' }, 'ride_cancel')
    ridesCancelled.add(1)
    return
  }

  // completed trip: the matched driver's phone drives the status changes
  const dToken = DRIVER_TOKEN[ride.driverId]
  if (!dToken) { tripStepFailed.add(true); return }
  const step = (res) => { const ok = res.status === 200; tripStepFailed.add(!ok); return ok }
  if (!step(req('PATCH', `/api/driver/rides/${id}/status`, dToken, { status: 'DRIVER_ARRIVING' }, 'trip_status'))) return
  sleep(PICKUP_S)
  const code = json(req('GET', `/api/sr/rides/${id}`, rider.token, undefined, 'ride_poll'))?.ride?.metadata?.pickupCode
  if (!step(req('POST', `/api/sr/rides/${id}/verify-pickup`, dToken, { code }, 'trip_status'))) return
  if (!step(req('PATCH', `/api/driver/rides/${id}/status`, dToken, { status: 'IN_PROGRESS' }, 'trip_status'))) return
  for (let s = 0; s < TRIP_S; s += 4) {
    sleep(4)
    req('GET', `/api/sr/rides/${id}`, rider.token, undefined, 'ride_poll')
  }
  const done = req('PATCH', `/api/driver/rides/${id}/status`, dToken, { status: 'COMPLETED' }, 'trip_status')
  if (step(done)) ridesCompleted.add(1)
  check(done, { 'ride completed': (r) => r.status === 200 })
}

// ---------------- server / database health ----------------
let lastPaymentFailures = null
export function monitor() {
  const res = http.get(`${BASE}/api/metrics`, { headers: { authorization: `Bearer ${__ENV.METRICS_TOKEN}` }, tags: { name: 'metrics' }, timeout: '10s' })
  if (res.status === 200) {
    const text = String(res.body || '')
    const g = (name) => {
      const m = new RegExp(`^${name} ([0-9.eE+-]+)$`, 'm').exec(text)
      return m ? Number(m[1]) : null
    }
    const sum = (name) => {
      let total = 0
      for (const m of text.matchAll(new RegExp(`^${name}(?:\\{[^}]*\\})? ([0-9.eE+-]+)$`, 'gm'))) total += Number(m[1])
      return total
    }
    const add = (trend, v) => { if (v !== null && Number.isFinite(v)) trend.add(v) }
    add(dbUp, g('db_up'))
    add(dbConnections, g('db_connections'))
    add(dbLongestQuery, g('db_longest_active_query_seconds'))
    add(dbActiveQueries, g('db_active_queries'))
    add(loopDelay, g('event_loop_delay_p99_ms'))
    add(waitingOver2m, g('sr_open_rides_waiting_over_2m'))
    const pf = sum('payment_failures_total')
    if (lastPaymentFailures !== null && pf > lastPaymentFailures) paymentFailuresDuring.add(pf - lastPaymentFailures)
    lastPaymentFailures = pf
  } else {
    dbUp.add(0)
  }
  sleep(10)
}

// ---------------- report: HTTP req/s and ride requests/min, separately ----------------
export function handleSummary(data) {
  const m = data.metrics
  const durS = (data.state?.testRunDurationMs || totalS * 1000) / 1000
  // ride requests are only generated during the profile itself (not the drain), so rate them over that
  const rideWindowS = Math.min(durS, totalS)
  const val = (name, key) => m[name]?.values?.[key]
  const httpReqs = val('http_reqs', 'count') || 0
  const report = {
    target: BASE,
    profile: PROFILE,
    tiers: TIERS,
    durationS: +durS.toFixed(0),
    http: {
      totalRequests: httpReqs,
      requestsPerSecond: +(val('http_reqs', 'rate') || 0).toFixed(1),
      failedRate: +(val('http_req_failed', 'rate') || 0).toFixed(4),
      p95ms: +(val('http_req_duration', 'p(95)') || 0).toFixed(0),
    },
    rides: {
      requested: val('rides_requested', 'count') || 0,
      requestsPerMinute: +(((val('rides_requested', 'count') || 0) / rideWindowS) * 60).toFixed(1),
      matched: val('rides_matched', 'count') || 0,
      unmatchedTimeout: val('rides_unmatched_timeout', 'count') || 0,
      completed: val('rides_completed', 'count') || 0,
      cancelled: val('rides_cancelled', 'count') || 0,
      matchSeconds: { p50: val('ride_match_seconds', 'med'), p95: val('ride_match_seconds', 'p(95)') },
      createFailedRate: val('ride_create_failed', 'rate'),
    },
    database: {
      maxConnections: val('db_connections', 'max'),
      longestQueryS: val('db_longest_query_s', 'max'),
      apiEventLoopP95ms: val('api_event_loop_p99_ms', 'p(95)'),
    },
    thresholdsFailed: Object.entries(m).filter(([, v]) => v.thresholds && Object.values(v.thresholds).some((t) => !t.ok)).map(([k]) => k),
  }
  const lines = [
    `Rezekme Rides k6 — ${PROFILE} against ${BASE} (${report.durationS}s)`,
    `  HTTP: ${report.http.totalRequests} requests, ${report.http.requestsPerSecond} req/s overall, failed ${(report.http.failedRate * 100).toFixed(2)}%, p95 ${report.http.p95ms} ms`,
    `  Rides: ${report.rides.requested} requested = ${report.rides.requestsPerMinute} ride requests/min; matched ${report.rides.matched}, completed ${report.rides.completed}, cancelled ${report.rides.cancelled}, unmatched ${report.rides.unmatchedTimeout}`,
    `  Matching: p50 ${fmt(report.rides.matchSeconds.p50)} s, p95 ${fmt(report.rides.matchSeconds.p95)} s`,
    `  Database: max connections ${fmt(report.database.maxConnections)}, longest query ${fmt(report.database.longestQueryS)} s`,
    `  Thresholds failed: ${report.thresholdsFailed.length ? report.thresholdsFailed.join(', ') : 'none'}`,
  ]
  const out = __ENV.SUMMARY_FILE || `k6-rides-${PROFILE}-summary.json`
  return { stdout: `${lines.join('\n')}\n`, [out]: JSON.stringify({ report, k6: data }, null, 1) }
}
function fmt(v) { return v === undefined || v === null ? 'n/a' : (+v).toFixed(2) }
