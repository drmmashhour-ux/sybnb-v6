// Live road distance + traffic-aware duration via the Google Maps Distance Matrix API. OPTIONAL and
// fail-open: with no GOOGLE_MAPS_API_KEY, or on any error/timeout, this returns null and the caller
// falls back to the local gazetteer distance + the rush-hour traffic proxy (see
// countries/syria/geo/geocoding.mjs). Country-neutral: it only takes coordinates.
//
// To ACTIVATE live Google distance + traffic: set GOOGLE_MAPS_API_KEY on the backend service to a key
// with the Distance Matrix API enabled and billing on. It is a paid Google service (billed per
// element); without it the platform still prices rides, just from the gazetteer + time-of-day proxy.

const GOOGLE_DM_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json'

function num(name, def) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : def
}

// points: ordered [{lat,lng}, ...] of pickup, stops..., dropoff. Returns null unless EVERY leg
// resolves, so the fare never mixes a partial live distance with a gazetteer guess.
export async function resolveTrafficDistance({ points, apiKey = process.env.GOOGLE_MAPS_API_KEY } = {}) {
  if (!apiKey) return null
  if (!Array.isArray(points) || points.length < 2) return null
  if (points.some((p) => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) return null

  const timeoutMs = num('GOOGLE_MAPS_TIMEOUT_MS', 2500)
  try {
    let distanceKm = 0
    let durationMin = 0
    let durationInTrafficMin = 0
    for (let i = 0; i < points.length - 1; i += 1) {
      const o = points[i]
      const d = points[i + 1]
      const url = `${GOOGLE_DM_URL}?origins=${o.lat},${o.lng}&destinations=${d.lat},${d.lng}`
        + `&mode=driving&departure_time=now&traffic_model=best_guess&key=${encodeURIComponent(apiKey)}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res
      try {
        res = await fetch(url, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res || !res.ok) return null
      const body = await res.json()
      const el = body && body.rows && body.rows[0] && body.rows[0].elements && body.rows[0].elements[0]
      if (!el || el.status !== 'OK' || !el.distance || !el.duration) return null
      distanceKm += (el.distance.value || 0) / 1000
      durationMin += (el.duration.value || 0) / 60
      durationInTrafficMin += ((el.duration_in_traffic && el.duration_in_traffic.value) || el.duration.value || 0) / 60
    }
    if (!(distanceKm > 0)) return null
    return {
      distanceKm,
      durationMin,
      durationInTrafficMin,
      // Congestion ratio, >= 1. The fare engine clamps it to SR_TRAFFIC_MAX.
      trafficMultiplier: durationMin > 0 ? Math.max(1, durationInTrafficMin / durationMin) : 1,
      source: 'google',
    }
  } catch {
    return null
  }
}
