import { db } from './prisma.mjs'

// SR Ride vs. Uber gap-closure (P0 #1): older than this is treated as no live location at all,
// never a stale fake dot on the rider's map -- matches a realistic GPS-report cadence (the driver
// client reports roughly every 8-10s while sharing), so a genuinely live driver never falls out of
// this window between two reports.
const LOCATION_FRESHNESS_MS = 120_000

// Architecture audit follow-up: SrRidePage.tsx polls GET /api/sr/rides/:id every 4-5s, and a ride
// can have more than one concurrent poller once it's shareable (the rider's own tab, the driver
// dashboard, and anyone with the public trip-share link from ride-share.mjs) -- each poll used to
// hit Postgres directly for both of these reads even when nothing had changed since the last one a
// few hundred ms earlier. A tiny short-TTL in-process cache collapses near-simultaneous pollers of
// the same ride/driver into one DB read, without ever serving data staler than a real poll would.
// Deliberately NOT Redis/an external cache: this is a single persistent process (see
// server/lib/prisma.mjs), so a plain in-memory Map is the right-sized tool -- reach for a shared
// cache only once there's a second process for it to be shared *with*.
function ttlCache(ttlMs) {
  const entries = new Map()
  return {
    get(key) {
      const hit = entries.get(key)
      if (!hit) return undefined
      if (Date.now() - hit.at > ttlMs) {
        entries.delete(key)
        return undefined
      }
      return hit.value
    },
    set(key, value) {
      entries.set(key, { value, at: Date.now() })
    },
    invalidate(key) {
      entries.delete(key)
    },
  }
}

// Driver location changes roughly every 8-10s in reality (see LOCATION_FRESHNESS_MS above), so a
// 3s cache never serves data staler than the next real GPS report would already make it.
const driverLocationCache = ttlCache(3_000)
// Ride pickup/dropoff coordinates are geocoded once at ride creation and never change afterward
// (see getRideCoords's own doc comment below), so this can safely cache far longer.
const rideCoordsCache = ttlCache(30_000)

export async function updateDriverLocation(driverId, lat, lng) {
  await db().driverProfile.upsert({
    where: { userId: driverId },
    create: { userId: driverId },
    update: {},
  })
  const point = `SRID=4326;POINT(${lng} ${lat})`
  await db().$executeRaw`
    UPDATE driver_profiles
    SET last_location_geo = ${point}::geometry, last_location_updated_at = now()
    WHERE user_id = ${driverId}::uuid
  `
  driverLocationCache.invalidate(driverId)
}

export async function getDriverLocation(driverId) {
  if (!driverId) return null
  const cached = driverLocationCache.get(driverId)
  if (cached !== undefined) return cached
  const rows = await db().$queryRaw`
    SELECT ST_X(last_location_geo) AS lng, ST_Y(last_location_geo) AS lat, last_location_updated_at AS "updatedAt"
    FROM driver_profiles
    WHERE user_id = ${driverId}::uuid AND last_location_geo IS NOT NULL
  `
  const row = rows[0]
  let result = null
  if (row && row.updatedAt) {
    const ageMs = Date.now() - new Date(row.updatedAt).getTime()
    if (ageMs <= LOCATION_FRESHNESS_MS) result = { lat: row.lat, lng: row.lng, updatedAt: row.updatedAt }
  }
  driverLocationCache.set(driverId, result)
  return result
}

// Only ever populated when the ride's own address was actually geocoded to real coordinates
// (see sr-rides.mjs's ride-creation route) -- an unrecognized address has no pickup_geo/dropoff_geo
// row to read back, and this correctly returns null rather than a fabricated position.
export async function getRideCoords(rideId) {
  const cached = rideCoordsCache.get(rideId)
  if (cached !== undefined) return cached
  const rows = await db().$queryRaw`
    SELECT ST_X(pickup_geo) AS "pickupLng", ST_Y(pickup_geo) AS "pickupLat",
           ST_X(dropoff_geo) AS "dropoffLng", ST_Y(dropoff_geo) AS "dropoffLat"
    FROM ride_requests
    WHERE id = ${rideId}::uuid
  `
  const row = rows[0]
  const result = !row
    ? { pickup: null, dropoff: null }
    : {
        pickup: row.pickupLat != null ? { lat: row.pickupLat, lng: row.pickupLng } : null,
        dropoff: row.dropoffLat != null ? { lat: row.dropoffLat, lng: row.dropoffLng } : null,
      }
  rideCoordsCache.set(rideId, result)
  return result
}

// --- Dispatch helpers (2026-10-09): proximity + ETA for matching and rider tracking ---------------
// Average SR city speed used to turn a straight-line distance into a rough minutes ETA. Deliberately
// conservative and env-tunable; this is an estimate for UX (how far / how long), never a billing input.
const SR_AVG_SPEED_KMH = (() => {
  const raw = Number(process.env.SR_AVG_SPEED_KMH)
  return Number.isFinite(raw) && raw > 0 ? raw : 28
})()

// Great-circle distance in km between two {lat,lng} points. Returns null if either is missing.
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Rough minutes to cover a distance at the city average speed (floor of 1 minute). null if unknown.
export function etaMinutesForKm(km) {
  if (km == null || !Number.isFinite(km)) return null
  return Math.max(1, Math.round((km / SR_AVG_SPEED_KMH) * 60))
}

// ETA in minutes between two coordinate points (e.g. driver -> pickup). null if either is missing.
export function etaMinutesBetween(from, to) {
  return etaMinutesForKm(haversineKm(from, to))
}
