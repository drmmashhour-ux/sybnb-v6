// Rezekme Rides — LOAD-TEST runner. Hits an ISOLATED local API only (refuses production hosts).
// Simulates the real app's polling behaviour as an OPEN-LOOP schedule (requests fire on the app's
// own timers whether or not earlier ones finished), so latency and backlog show up honestly:
//
//   online driver (idle)    : PATCH /api/driver/location every 8 s, GET /api/driver/rides/pending every 4 s
//   rider with a live ride  : GET /api/sr/rides/:id every 4 s
//   browsing rider          : GET /api/sr/availability every 20 s, POST /api/sr/quote every 20 s
//   ride requests           : POST /api/sr/rides at RIDE_RATE per minute; the offered driver accepts
//                             through PATCH /accept-offer when it sees the offer; the rider cancels
//                             HOLD_S seconds after acceptance (frees the driver, exercises refund)
//
//   BASE=http://127.0.0.1:3061 TOKENS=/tmp/ride-loadtest-tokens.json \
//   DRIVERS=200 BROWSERS=300 RIDE_RATE=60 DURATION=60 node scripts/ride-loadtest-run.mjs
//
// Prints one JSON summary (per-endpoint p50/p95/p99, throughput, errors, matching time, backlog).
import { readFileSync } from 'node:fs'

const BASE = (process.env.BASE || 'http://127.0.0.1:3061').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error('refusing: ride-loadtest-run only targets a local isolated API (http://127.0.0.1:PORT)')
  process.exit(2)
}
const T = JSON.parse(readFileSync(process.env.TOKENS || '/tmp/ride-loadtest-tokens.json', 'utf8'))
const DRIVERS = Math.min(Number(process.env.DRIVERS || 100), T.drivers.length)
const BROWSERS = Number(process.env.BROWSERS || 100)
const RIDE_RATE = Number(process.env.RIDE_RATE || 30) // per minute
const DURATION = Number(process.env.DURATION || 60) * 1000
const HOLD_S = Number(process.env.HOLD_S || 15)
const LOC_MS = Number(process.env.LOC_MS || 8000)
const PENDING_MS = Number(process.env.PENDING_MS || 4000)
const RIDE_POLL_MS = Number(process.env.RIDE_POLL_MS || 4000)
const BROWSE_MS = Number(process.env.BROWSE_MS || 20000)

const stats = new Map()
let inFlight = 0
let maxInFlight = 0
const rec = (name, ms, ok, status) => {
  let s = stats.get(name)
  if (!s) stats.set(name, (s = { lat: [], errors: 0, count: 0, statuses: {} }))
  s.count++
  s.statuses[status] = (s.statuses[status] || 0) + 1
  if (ok) s.lat.push(ms)
  else s.errors++
}
async function call(name, method, path, token, body) {
  inFlight++
  maxInFlight = Math.max(maxInFlight, inFlight)
  const t0 = performance.now()
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    rec(name, performance.now() - t0, res.status < 500, res.status)
    let data = null
    try { data = JSON.parse(text) } catch {}
    return { status: res.status, data }
  } catch {
    rec(name, performance.now() - t0, false, 'net')
    return { status: 0, data: null }
  } finally {
    inFlight--
  }
}

const deadline = Date.now() + DURATION
const timers = []
const every = (ms, fn) => {
  const start = Math.random() * ms // de-synchronise clients like real phones
  const t = setTimeout(() => {
    fn()
    timers.push(setInterval(() => { if (Date.now() < deadline) fn() }, ms))
  }, start)
  timers.push(t)
}
const box = T.box
const rnd = (a, b) => a + Math.random() * (b - a)
const point = () => ({ lat: rnd(box.lat0, box.lat1), lng: rnd(box.lng0, box.lng1) })

// ride bookkeeping for matching-time and correctness
const rides = new Map() // id -> { createdAt, acceptedAt, driverId, rider }
const busyDrivers = new Set()
const freeRiders = T.riders.slice()
let acceptConflicts = 0
let created = 0
let createFailed = 0

// drivers
for (const d of T.drivers.slice(0, DRIVERS)) {
  const pos = { lat: d.lat, lng: d.lng }
  every(LOC_MS, () => {
    pos.lat += rnd(-0.0005, 0.0005)
    pos.lng += rnd(-0.0005, 0.0005)
    void call('driver_location', 'PATCH', '/api/driver/location', d.token, pos)
  })
  every(PENDING_MS, async () => {
    if (busyDrivers.has(d.id)) return
    const r = await call('driver_pending', 'GET', '/api/driver/rides/pending', d.token)
    const offer = r.data?.rides?.find((x) => x.offeredToYou)
    if (!offer || busyDrivers.has(d.id)) return
    busyDrivers.add(d.id)
    const a = await call('driver_accept', 'PATCH', `/api/sr/rides/${offer.id}/accept-offer`, d.token, {})
    const info = rides.get(offer.id)
    if (a.status === 200 && info) {
      info.acceptedAt = Date.now()
      info.driverId = d.id
      setTimeout(async () => {
        await call('rider_cancel', 'PATCH', `/api/sr/rides/${offer.id}/cancel`, info.rider.token, { reason: 'load test' })
        info.done = true
        busyDrivers.delete(d.id)
        freeRiders.push(info.rider)
      }, HOLD_S * 1000)
    } else {
      if (a.status === 409) acceptConflicts++
      busyDrivers.delete(d.id)
    }
  })
}

// browsing riders (anonymous-capable reads, sent signed-in like the app after sign-in)
for (let i = 0; i < BROWSERS; i++) {
  const rider = T.riders[i % T.riders.length]
  every(BROWSE_MS, () => {
    const p = point()
    void call('rider_availability', 'GET', `/api/sr/availability?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}`, rider.token)
  })
  every(BROWSE_MS, () => {
    const a = point()
    const b = point()
    void call('rider_quote', 'POST', '/api/sr/quote', rider.token, { pickup: 'Load pickup', dropoff: 'Load dropoff', category: 'SR Economy', pickupCoords: a, dropoffCoords: b })
  })
}

// ride requests
if (RIDE_RATE > 0) {
  const gap = 60_000 / RIDE_RATE
  const tick = setInterval(async () => {
    if (Date.now() >= deadline) return
    const rider = freeRiders.shift()
    if (!rider) return
    const a = point()
    const b = point()
    const r = await call('ride_create', 'POST', '/api/sr/rides', rider.token, {
      pickup: 'Load pickup', dropoff: 'Load dropoff', category: 'SR Economy', pickupCoords: a, dropoffCoords: b,
    })
    const id = r.data?.ride?.id
    if (!id) { createFailed++; freeRiders.push(rider); return }
    created++
    const info = { createdAt: Date.now(), rider }
    rides.set(id, info)
    const poll = setInterval(() => {
      if (info.done || Date.now() >= deadline) return clearInterval(poll)
      void call('rider_ride_poll', 'GET', `/api/sr/rides/${id}`, rider.token)
    }, RIDE_POLL_MS)
    timers.push(poll)
  }, gap)
  timers.push(tick)
}

setTimeout(() => {
  for (const t of timers) { clearTimeout(t); clearInterval(t) }
  // let in-flight requests drain (bounded)
  const drainStart = Date.now()
  const wait = setInterval(() => {
    if (inFlight > 0 && Date.now() - drainStart < 30_000) return
    clearInterval(wait)
    const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0)
    const out = {}
    let total = 0
    let errors = 0
    for (const [name, s] of stats) {
      s.lat.sort((x, y) => x - y)
      total += s.count
      errors += s.errors
      out[name] = { count: s.count, rps: +(s.count / (DURATION / 1000)).toFixed(1), errors: s.errors, p50: +pct(s.lat, 0.5).toFixed(1), p95: +pct(s.lat, 0.95).toFixed(1), p99: +pct(s.lat, 0.99).toFixed(1), statuses: s.statuses }
    }
    const matched = [...rides.values()].filter((r) => r.acceptedAt).map((r) => r.acceptedAt - r.createdAt).sort((a, b) => a - b)
    console.log(JSON.stringify({
      tier: { DRIVERS, BROWSERS, RIDE_RATE, DURATION_S: DURATION / 1000 },
      totals: { requests: total, rps: +(total / (DURATION / 1000)).toFixed(1), errors, errorRate: +(errors / Math.max(1, total)).toFixed(4), maxInFlight, unfinishedAtEnd: inFlight },
      rides: { created, createFailed, matched: matched.length, acceptConflicts, matchMs_p50: pct(matched, 0.5), matchMs_p95: pct(matched, 0.95) },
      endpoints: out,
    }, null, 1))
    process.exit(0)
  }, 250)
}, DURATION)
