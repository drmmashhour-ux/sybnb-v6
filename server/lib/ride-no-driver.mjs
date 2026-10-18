// "No driver in your category" helper. When a ride has waited past the match timeout with nobody
// taking it, find the OTHER car categories that DO have an eligible, online driver near the pickup,
// price each one for the same trip, and tell the rider once (push + email) so they can switch.
// Same driver-eligibility gates as ride-dispatch.findNextDriverForRide (approved ID + vehicle,
// registration/inspection valid, GPS fresh, not on another trip), minus the category match.
import { Prisma } from '@prisma/client'
import { db } from './prisma.mjs'
import { notifyUserMulti } from './notifications.mjs'

const VEHICLE_TO_RIDE_CATEGORY = { BIKE: 'SR Bike', ECONOMY: 'SR Economy', COMFORT: 'SR Comfort', SUV: 'SR SUV', VAN: 'SR Van', VIP: 'SR VIP' }
const num = (name, def, min, max) => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : def
}
const RADIUS_M = num('SR_ALT_RADIUS_KM', 15, 1, 100) * 1000
const ONLINE_WINDOW_SECONDS = num('SR_DISPATCH_ONLINE_WINDOW_SECONDS', 120, 30, 600)

// -> [{ category: 'SR Economy', drivers: 2, nearestM: 1800 }] excluding the ride's own category.
export async function categoriesWithDriversNear(rideId, ownCategory) {
  const inspectionRequired = !['false', '0'].includes(String(process.env.SR_REQUIRE_VEHICLE_INSPECTION ?? '').trim().toLowerCase())
  const inspectionSql = inspectionRequired
    ? Prisma.sql`AND dp.inspection_status = 'PASSED' AND (dp.inspection_expires_at IS NULL OR dp.inspection_expires_at > now())`
    : Prisma.empty
  const rows = await db().$queryRaw(Prisma.sql`
    SELECT dp.vehicle_category::text AS "vehicle", COUNT(*)::int AS "drivers",
           MIN(dp.last_location_geo::geography <-> rr.pickup_geo::geography) AS "nearestM"
    FROM ride_requests rr
    JOIN driver_profiles dp ON dp.last_location_geo IS NOT NULL
    JOIN users u ON u.id = dp.user_id
    WHERE rr.id = ${rideId}::uuid
      AND rr.pickup_geo IS NOT NULL
      AND u.id_document_status = 'APPROVED'
      AND dp.vehicle_plate IS NOT NULL
      AND dp.vehicle_status = 'APPROVED'
      AND dp.vehicle_category IS NOT NULL
      AND (dp.registration_expires_at IS NULL OR dp.registration_expires_at > now())
      ${inspectionSql}
      AND dp.last_location_updated_at >= now() - (interval '1 second' * ${ONLINE_WINDOW_SECONDS})
      AND dp.user_id <> rr.rider_id
      AND (dp.last_location_geo::geography <-> rr.pickup_geo::geography) <= ${RADIUS_M}
      AND NOT EXISTS (
        SELECT 1 FROM ride_requests ar
        WHERE ar.driver_id = dp.user_id AND ar.status IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS')
      )
    GROUP BY dp.vehicle_category
  `)
  return rows
    .map((row) => ({ category: VEHICLE_TO_RIDE_CATEGORY[row.vehicle], drivers: Number(row.drivers), nearestM: row.nearestM == null ? null : Math.round(Number(row.nearestM)) }))
    .filter((row) => row.category && row.category !== ownCategory)
}

// Prices each available alternative with the caller's quote function (same engine as /quote).
// quoteFn(category) -> quote | null. Cheapest first.
export async function buildAlternatives(rideId, ownCategory, quoteFn) {
  const available = await categoriesWithDriversNear(rideId, ownCategory)
  const out = []
  for (const item of available) {
    const quote = await quoteFn(item.category).catch(() => null)
    out.push({ ...item, fareMinor: quote?.fareMinor ?? null, currency: quote?.currency ?? null })
  }
  return out.sort((a, b) => (a.fareMinor ?? 1e9) - (b.fareMinor ?? 1e9))
}

// Notify the rider ONCE per ride (ride.metadata.noDriverNotifiedAt marks it done).
export async function notifyRiderNoDriverOnce(ride, alternatives) {
  const meta = ride.metadata && typeof ride.metadata === 'object' ? ride.metadata : {}
  if (meta.noDriverNotifiedAt) return false
  const claimed = await db().rideRequest.updateMany({
    where: { id: ride.id, driverId: null },
    data: { metadata: { ...meta, noDriverNotifiedAt: new Date().toISOString() } },
  })
  if (claimed.count !== 1) return false
  const names = alternatives.map((a) => `${a.category.replace('SR ', '')}${a.fareMinor != null ? ` ($${a.fareMinor})` : ''}`).join(', ')
  notifyUserMulti('ride_no_driver', ride.riderId, {
    category: String(meta.category || '').replace('SR ', ''),
    alternatives: names,
    hasAlternatives: alternatives.length > 0,
    url: '/ride',
  }, `ride-no-driver:${ride.id}`)
  return true
}
