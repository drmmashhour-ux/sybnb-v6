// DEV-ONLY mock API for previewing the light SR/STR pages without Postgres/secrets.
// Usage: node scripts/lite-mock-api.mjs   (listens on 127.0.0.1:3051, the dev default API)
// Fake data, no database, no real accounts, no money. Never deploy this.
import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT || 3051)
const rides = new Map()
const listings = ['Damascus', 'Aleppo', 'Latakia', 'Tartus', 'Homs'].flatMap((city, ci) =>
  Array.from({ length: 6 }, (_, i) => ({
    id: `mock-${ci}-${i}`, ownerId: 'o1', division: 'STAYS',
    titleAr: `شقة مريحة رقم ${i + 1} في ${city}`, titleEn: `Cozy flat ${i + 1} in ${city}`,
    description: `Mock listing ${i + 1} in ${city}.\nTwo rooms, Wi-Fi, near the centre.`, status: 'APPROVED',
    priceMinor: 2500 + i * 700, currency: 'USD', metadata: {}, media: [],
    location: { country: 'SY', governorate: city, city, area: `Area ${i + 1}`, lat: null, lng: null }, owner: { id: 'o1', displayName: 'Mock Host' },
  })))

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' })
  res.end(JSON.stringify(body))
}
const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(JSON.parse(d || '{}')) } catch { ok({}) } }) })
const session = (email) => ({ ok: true, token: 'mock-token', user: { id: 'u1', email, displayName: email || 'Mock Rider', roles: ['GUEST'] } })
const STEPS = [[0, 'REQUESTED'], [6, 'MATCHING'], [14, 'DRIVER_ASSIGNED'], [24, 'DRIVER_ARRIVING'], [34, 'IN_PROGRESS'], [50, 'COMPLETED']]
const PICKUP = { lat: 33.5138, lng: 36.2765 }
const DROPOFF = { lat: 33.5020, lng: 36.2400 }
const START = { lat: 33.5300, lng: 36.3050 }
const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t })
const clamp = (x) => Math.max(0, Math.min(1, x))
const view = (r) => {
  const coords = { pickupCoords: PICKUP, dropoffCoords: DROPOFF }
  if (r.cancelled) return { ...r.base, ...coords, status: 'CANCELLED' }
  const age = (Date.now() - r.t0) / 1000
  const status = STEPS.filter(([s]) => age >= s).pop()[1]
  const assigned = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED'].includes(status)
  // Driver drives START -> PICKUP while assigned/arriving (14s..34s), then PICKUP -> DROPOFF (34s..50s).
  const location = status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVING' ? lerp(START, PICKUP, clamp((age - 14) / 20))
    : status === 'IN_PROGRESS' ? lerp(PICKUP, DROPOFF, clamp((age - 34) / 16)) : null
  const eta = status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVING' ? Math.max(1, Math.round((1 - clamp((age - 14) / 20)) * 6)) : null
  return {
    ...r.base, ...coords, status, etaToPickupMinutes: eta, pickupVerifiedAt: null,
    driver: assigned ? {
      id: 'd1', displayName: 'Mock Driver', isVerified: true, averageRating: 4.9, ratingCount: 128,
      driverProfile: { vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: '123456', vehicleColor: 'White', vehicleYear: 2020, photoUrl: null },
      location,
    } : null,
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const p = url.pathname
  if (p === '/api/listings') {
    const city = url.searchParams.get('city')
    return send(res, 200, { ok: true, listings: listings.filter((l) => !city || l.location.city === city), nextCursor: null })
  }
  if (p === '/api/auth/login') { const b = await readBody(req); return send(res, 200, session(b.email)) }
  if (p === '/api/auth/register') { const b = await readBody(req); return send(res, 201, session(b.email)) }
  if (p === '/api/otp/send') return send(res, 201, { ok: true, sent: true })
  if (p === '/api/otp/verify') return send(res, 200, { ok: true, verified: true })
  if (p === '/api/sr/quote') return send(res, 200, { ok: true, quote: { fareMinor: 450, currency: 'USD', distanceKm: 3.2, estimated: false, estimatedMinutes: 11, pickupCoords: PICKUP, dropoffCoords: DROPOFF } })
  if (p === '/api/sr/rides' && req.method === 'POST') {
    const id = `ride-${Date.now()}`
    rides.set(id, { t0: Date.now(), cancelled: false, base: { id, riderId: 'u1', fareMinor: 450, currency: 'USD', metadata: { pickupCode: '4821' } } })
    return send(res, 201, { ok: true, ride: view(rides.get(id)) })
  }
  const m = p.match(/^\/api\/sr\/rides\/([^/]+)(\/cancel)?$/)
  if (m) {
    const r = rides.get(m[1])
    if (!r) return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Ride not found' } })
    if (m[2]) r.cancelled = true
    return send(res, 200, { ok: true, ride: view(r) })
  }
  send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not in mock' } })
}).listen(PORT, '127.0.0.1', () => console.log(`lite mock API on http://127.0.0.1:${PORT} (fake data)`))
