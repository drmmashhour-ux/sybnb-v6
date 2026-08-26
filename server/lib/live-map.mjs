import { db } from './prisma.mjs'

// SR Ride vs. Uber gap-closure (P0 #1): older than this is treated as no live location at all,
// never a stale fake dot on the rider's map -- matches a realistic GPS-report cadence (the driver
// client reports roughly every 8-10s while sharing), so a genuinely live driver never falls out of
// this window between two reports.
const LOCATION_FRESHNESS_MS = 120_000

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
}

export async function getDriverLocation(driverId) {
  if (!driverId) return null
  const rows = await db().$queryRaw`
    SELECT ST_X(last_location_geo) AS lng, ST_Y(last_location_geo) AS lat, last_location_updated_at AS "updatedAt"
    FROM driver_profiles
    WHERE user_id = ${driverId}::uuid AND last_location_geo IS NOT NULL
  `
  const row = rows[0]
  if (!row || !row.updatedAt) return null
  const ageMs = Date.now() - new Date(row.updatedAt).getTime()
  if (ageMs > LOCATION_FRESHNESS_MS) return null
  return { lat: row.lat, lng: row.lng, updatedAt: row.updatedAt }
}

// Only ever populated when the ride's own address was actually geocoded to real coordinates
// (see sr-rides.mjs's ride-creation route) -- an unrecognized address has no pickup_geo/dropoff_geo
// row to read back, and this correctly returns null rather than a fabricated position.
export async function getRideCoords(rideId) {
  const rows = await db().$queryRaw`
    SELECT ST_X(pickup_geo) AS "pickupLng", ST_Y(pickup_geo) AS "pickupLat",
           ST_X(dropoff_geo) AS "dropoffLng", ST_Y(dropoff_geo) AS "dropoffLat"
    FROM ride_requests
    WHERE id = ${rideId}::uuid
  `
  const row = rows[0]
  if (!row) return { pickup: null, dropoff: null }
  return {
    pickup: row.pickupLat != null ? { lat: row.pickupLat, lng: row.pickupLng } : null,
    dropoff: row.dropoffLat != null ? { lat: row.dropoffLat, lng: row.dropoffLng } : null,
  }
}
