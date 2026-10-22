// Rezekme Stay (STR) — LOAD-TEST runner against an ISOLATED local API only (refuses anything else).
// Open-loop schedule that follows the guest app's real pattern (requests fire on their own timers
// whether or not earlier ones finished, so latency and backlog show up honestly):
//
//   browsing guest     : search (division=STAYS, a city weighted by demand, sometimes filters or a
//                        price sort, sometimes page 2 via the cursor) every SEARCH_MS (30 s);
//                        open a listing every DETAIL_MS (20 s), and for half of those also read the
//                        calendar (availability) and a price quote for random dates
//   booking guests     : BOOK_RATE per minute: availability -> quote -> POST /api/bookings ->
//                        GET booking -> guest cancels after HOLD_S (frees the dates). HOT_PCT % of
//                        bookings aim at a small set of "hot" listings and dates so concurrent
//                        requests collide; the loser must get 409 BOOKING_DATES_UNAVAILABLE.
//
//   BASE=http://127.0.0.1:3061 TOKENS=/tmp/stay-loadtest-tokens.json \
//   BROWSERS=500 BOOK_RATE=60 DURATION=60 node scripts/stay-loadtest-run.mjs
//
// Prints one JSON summary: per-endpoint p50/p95/p99, total req/s, bookings/min, conflicts, errors.
import { readFileSync } from 'node:fs'

const BASE = (process.env.BASE || 'http://127.0.0.1:3061').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error('refusing: stay-loadtest-run only targets a local isolated API (http://127.0.0.1:PORT)')
  process.exit(2)
}
const T = JSON.parse(readFileSync(process.env.TOKENS || '/tmp/stay-loadtest-tokens.json', 'utf8'))
const BROWSERS = Number(process.env.BROWSERS || 100)
const BOOK_RATE = Number(process.env.BOOK_RATE || 20)
const DURATION = Number(process.env.DURATION || 60) * 1000
const HOLD_S = Number(process.env.HOLD_S || 10)
const HOT_PCT = Number(process.env.HOT_PCT || 20)
const SEARCH_MS = Number(process.env.SEARCH_MS || 30000)
const DETAIL_MS = Number(process.env.DETAIL_MS || 20000)

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
async function call(name, method, path, token, body, okStatuses = []) {
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
    rec(name, performance.now() - t0, res.status < 400 || okStatuses.includes(res.status), res.status)
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
  const start = Math.random() * ms
  timers.push(setTimeout(() => {
    fn()
    timers.push(setInterval(() => { if (Date.now() < deadline) fn() }, ms))
  }, start))
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const cityWeights = T.cities
const totalW = cityWeights.reduce((s, c) => s + c.weight, 0)
const pickCity = () => {
  let r = Math.random() * totalW
  for (const c of cityWeights) { if ((r -= c.weight) < 0) return c.city }
  return cityWeights[0].city
}
const iso = (d) => d.toISOString().slice(0, 10)
const randomDates = (minAhead = 3, span = 120) => {
  const start = new Date(Date.now() + (minAhead + Math.floor(Math.random() * span)) * 864e5)
  const nights = 1 + Math.floor(Math.random() * 5)
  return { checkIn: iso(start), checkOut: iso(new Date(start.getTime() + nights * 864e5)) }
}
const FILTERS = ['', '', '', '&sort=priceLow', '&bedroomsMin=2', '&amenities=wifi', '&amenities=wifi,parking', '&priceMax=8000', '&sort=priceHigh']

// browsing guests
for (let i = 0; i < BROWSERS; i++) {
  const guest = T.guests[(T.guests.length - 1 - i) % T.guests.length]
  every(SEARCH_MS, async () => {
    const q = `/api/listings?division=STAYS&city=${encodeURIComponent(pickCity())}${pick(FILTERS)}`
    const r = await call('search', 'GET', q, guest.token)
    if (r.data?.nextCursor && Math.random() < 0.3) {
      void call('search_page2', 'GET', `${q}&cursor=${encodeURIComponent(r.data.nextCursor)}`, guest.token)
    }
  })
  every(DETAIL_MS, async () => {
    const l = pick(T.listings)
    void call('listing_detail', 'GET', `/api/listings/${l.id}`, guest.token)
    if (Math.random() < 0.5) {
      const d = randomDates()
      void call('availability', 'GET', `/api/listings/${l.id}/availability`, guest.token)
      void call('stay_quote', 'GET', `/api/listings/${l.id}/quote?checkIn=${d.checkIn}&checkOut=${d.checkOut}`, guest.token)
    }
  })
}

// bookings
const HOT = T.listings.slice(0, 10)
const HOT_DATES = Array.from({ length: 4 }, (_, k) => ({ checkIn: iso(new Date(Date.now() + (200 + k * 3) * 864e5)), checkOut: iso(new Date(Date.now() + (202 + k * 3) * 864e5)) }))
const bookers = T.guests.slice(0, Math.max(1, Math.floor(T.guests.length / 2)))
let bi = 0
let created = 0
let conflicts = 0
let createFailed = 0
let cancelled = 0
if (BOOK_RATE > 0) {
  const gap = 60_000 / BOOK_RATE
  timers.push(setInterval(async () => {
    if (Date.now() >= deadline) return
    const guest = bookers[bi++ % bookers.length]
    const hot = Math.random() * 100 < HOT_PCT
    const l = hot ? pick(HOT) : pick(T.listings)
    const d = hot ? pick(HOT_DATES) : randomDates(10, 300)
    await call('availability', 'GET', `/api/listings/${l.id}/availability`, guest.token)
    await call('stay_quote', 'GET', `/api/listings/${l.id}/quote?checkIn=${d.checkIn}&checkOut=${d.checkOut}`, guest.token)
    const r = await call('booking_create', 'POST', '/api/bookings', guest.token, { listingId: l.id, checkIn: d.checkIn, checkOut: d.checkOut, guests: 1 }, [409])
    const id = r.data?.booking?.id
    if (!id) {
      if (r.status === 409) conflicts++
      else createFailed++
      return
    }
    created++
    await call('booking_view', 'GET', `/api/bookings/${id}`, guest.token)
    timers.push(setTimeout(async () => {
      const c = await call('booking_cancel', 'PATCH', `/api/bookings/${id}/cancel`, guest.token, { reason: 'load test' })
      if (c.status === 200) cancelled++
    }, HOLD_S * 1000))
  }, gap))
}

setTimeout(() => {
  for (const t of timers) { clearTimeout(t); clearInterval(t) }
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
    console.log(JSON.stringify({
      tier: { BROWSERS, BOOK_RATE, DURATION_S: DURATION / 1000 },
      totals: { requests: total, rps: +(total / (DURATION / 1000)).toFixed(1), errors, errorRate: +(errors / Math.max(1, total)).toFixed(4), maxInFlight, unfinishedAtEnd: inFlight },
      bookings: { perMinute: +((created + conflicts + createFailed) / (DURATION / 60000)).toFixed(1), created, conflicts409: conflicts, createFailed, cancelled },
      endpoints: out,
    }, null, 1))
    process.exit(0)
  }, 250)
}, DURATION + HOLD_S * 1000)
