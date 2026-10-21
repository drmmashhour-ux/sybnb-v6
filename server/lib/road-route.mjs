// Road-following route lookup for the Rezekme maps (so the line on the map follows streets, not a straight line).
//
// The browser asks OUR API (GET /api/sr/route) instead of calling a router directly: no key ever ships in the app,
// results are cached, the provider can be swapped without a new app build, and one failing public router can't
// break the map. Provider order:
//   1. Google Routes API      when GOOGLE_ROUTES_API_KEY is set (server-side key; billed per route by Google)
//   2. OSRM-compatible router at ROUTING_OSRM_URL (default: the public OSRM demo server -- fine for testing, NOT a
//      production SLA; point ROUTING_OSRM_URL at your own OSRM/Valhalla-compatible service before real traffic)
// Never throws: returns null when no road route is available (the app then keeps the plain line).
export const ROUTE_MAX_POINTS = 8
export const ROUTE_MAX_OUT_POINTS = 700
const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 500
const cache = new Map()

export function parseRoutePoints(raw) {
  const parts = String(raw ?? '').split(';').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > ROUTE_MAX_POINTS) return null
  const points = []
  for (const part of parts) {
    const m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(part)
    if (!m) return null
    const lat = Number(m[1]); const lng = Number(m[2])
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null
    points.push({ lat, lng })
  }
  return points
}

function decodePolyline(encoded) {
  const out = []
  let i = 0; let lat = 0; let lng = 0
  while (i < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0; let shift = 0; let byte
      do { byte = encoded.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += d; else lng += d
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

function thin(coords) {
  if (coords.length <= ROUTE_MAX_OUT_POINTS) return coords
  const step = coords.length / ROUTE_MAX_OUT_POINTS
  const out = []
  for (let k = 0; k < ROUTE_MAX_OUT_POINTS; k++) out.push(coords[Math.floor(k * step)])
  out.push(coords[coords.length - 1])
  return out
}

async function viaGoogle(points, { key, fetchImpl, signal }) {
  const wp = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })
  const r = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration' },
    body: JSON.stringify({ origin: wp(points[0]), destination: wp(points.at(-1)), intermediates: points.slice(1, -1).map(wp), travelMode: 'DRIVE' }),
  })
  if (!r.ok) return null
  const route = (await r.json())?.routes?.[0]
  if (!route?.polyline?.encodedPolyline) return null
  return { provider: 'google', coords: decodePolyline(route.polyline.encodedPolyline), distanceM: Number(route.distanceMeters) || null, durationS: parseInt(String(route.duration ?? ''), 10) || null }
}

async function viaOsrm(points, { base, fetchImpl, signal }) {
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const r = await fetchImpl(`${base.replace(/\/+$/, '')}/route/v1/driving/${coords}?overview=full&geometries=geojson`, { signal })
  if (!r.ok) return null
  const route = (await r.json())?.routes?.[0]
  const line = route?.geometry?.coordinates
  if (!Array.isArray(line) || line.length < 2) return null
  return { provider: 'osrm', coords: line.map(([lng, lat]) => [lat, lng]), distanceM: Number(route.distance) || null, durationS: Number(route.duration) || null }
}

export async function lookupRoadRoute(points, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 7000, now = Date.now } = {}) {
  try {
    const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
    const hit = cache.get(key)
    if (hit && hit.until > now()) return hit.value
    const googleKey = String(env.GOOGLE_ROUTES_API_KEY || '').trim()
    const base = String(env.ROUTING_OSRM_URL || 'https://router.project-osrm.org').trim()
    const attempts = []
    if (googleKey) attempts.push((o) => viaGoogle(points, { key: googleKey, ...o }))
    if (base) attempts.push((o) => viaOsrm(points, { base, ...o }))
    let found = null
    for (const attempt of attempts) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try { found = await attempt({ fetchImpl, signal: controller.signal }) } catch { found = null } finally { clearTimeout(timer) }
      if (found) break
    }
    const value = found ? { provider: found.provider, points: thin(found.coords), distanceM: found.distanceM, durationS: found.durationS } : null
    if (value) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
      cache.set(key, { value, until: now() + CACHE_TTL_MS })
    }
    return value
  } catch {
    return null
  }
}

export function clearRoadRouteCache() { cache.clear() }
