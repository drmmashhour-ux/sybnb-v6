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
      -- index-assisted bounding box, then the exact metre radius (the bare geography <-> filter could not use any index)
      AND dp.last_location_geo && ST_Expand(rr.pickup_geo, ${RADIUS_M / 80000})
      AND ST_DWithin(dp.last_location_geo::geography, rr.pickup_geo::geography, ${RADIUS_M})
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

// Availability at a pickup point (before any ride exists): per category the number of eligible online
// drivers within the radius and a rough ETA in minutes (straight-line distance at city speed + a
// 2-minute dispatch buffer). Same gates as above.
// Availability (scale, 2026-10-22). Every browsing rider polls this every 20 s, and the answer only
// depends on where the eligible online drivers are -- the same for everyone. Instead of one spatial
// aggregate query per call (measured 5 ms avg at 500 drivers, 18 ms at 1,000, linear in fleet size and
// the top DB consumer under load), each API process keeps a snapshot of eligible online drivers
// (category + position), refreshed at most every SR_AVAILABILITY_SNAPSHOT_MS (single-flight), and
// answers from memory. Cost: one query per replica per refresh, independent of rider traffic.
// Availability is an estimate shown to riders (counts, rough ETA); dispatch never uses this snapshot --
// the driver actually offered a ride is always chosen from live database state.
const SNAPSHOT_MS = num('SR_AVAILABILITY_SNAPSHOT_MS', 3000, 0, 60000)
let snapshot = { at: 0, drivers: [] }
let snapshotLoading = null
export const availabilitySnapshotStats = { refreshes: 0, served: 0, drivers: 0, lastRefreshMs: 0 }

async function loadDriverSnapshot() {
  const inspectionRequired = !['false', '0'].includes(String(process.env.SR_REQUIRE_VEHICLE_INSPECTION ?? '').trim().toLowerCase())
  const inspectionSql = inspectionRequired
    ? Prisma.sql`AND dp.inspection_status = 'PASSED' AND (dp.inspection_expires_at IS NULL OR dp.inspection_expires_at > now())`
    : Prisma.empty
  const t0 = Date.now()
  const rows = await db().$queryRaw(Prisma.sql`
    SELECT dp.vehicle_category::text AS "vehicle", ST_Y(dp.last_location_geo) AS lat, ST_X(dp.last_location_geo) AS lng
    FROM driver_profiles dp
    JOIN users u ON u.id = dp.user_id
    WHERE dp.last_location_geo IS NOT NULL
      AND u.id_document_status = 'APPROVED'
      AND dp.vehicle_plate IS NOT NULL
      AND dp.vehicle_status = 'APPROVED'
      AND dp.vehicle_category IS NOT NULL
      AND (dp.registration_expires_at IS NULL OR dp.registration_expires_at > now())
      ${inspectionSql}
      AND dp.last_location_updated_at >= now() - (interval '1 second' * ${ONLINE_WINDOW_SECONDS})
      AND NOT EXISTS (
        SELECT 1 FROM ride_requests ar
        WHERE ar.driver_id = dp.user_id AND ar.status IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS')
      )
  `)
  snapshot = { at: Date.now(), drivers: rows.map((r) => ({ vehicle: r.vehicle, lat: Number(r.lat), lng: Number(r.lng) })) }
  availabilitySnapshotStats.refreshes += 1
  availabilitySnapshotStats.drivers = snapshot.drivers.length
  availabilitySnapshotStats.lastRefreshMs = Date.now() - t0
  return snapshot
}

async function driverSnapshot() {
  if (SNAPSHOT_MS > 0 && Date.now() - snapshot.at < SNAPSHOT_MS) return snapshot
  if (!snapshotLoading) snapshotLoading = loadDriverSnapshot().finally(() => { snapshotLoading = null })
  // a stale-but-recent snapshot is served while the refresh runs, instead of making riders wait on it
  if (snapshot.at && Date.now() - snapshot.at < SNAPSHOT_MS * 5) return snapshot
  return snapshotLoading
}

// Great-circle distance in metres (haversine); the same order of accuracy as the geography distance
// the old query used, which is far finer than the 2-minute rounding of the ETA shown.
function metres(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export async function categoryAvailabilityAt(point) {
  const snap = await driverSnapshot()
  availabilitySnapshotStats.served += 1
  const byVehicle = {}
  for (const d of snap.drivers) {
    // cheap degree pre-filter before the trig (1 degree latitude ~ 111 km)
    if (Math.abs(d.lat - point.lat) > RADIUS_M / 100000 || Math.abs(d.lng - point.lng) > RADIUS_M / 80000) continue
    const m = metres(point, d)
    if (m > RADIUS_M) continue
    const slot = byVehicle[d.vehicle] || (byVehicle[d.vehicle] = { drivers: 0, nearestM: Infinity })
    slot.drivers += 1
    if (m < slot.nearestM) slot.nearestM = m
  }
  const byCategory = {}
  for (const [vehicle, row] of Object.entries(byVehicle)) {
    const category = VEHICLE_TO_RIDE_CATEGORY[vehicle]
    if (!category) continue
    byCategory[category] = { drivers: row.drivers, etaMinutes: Math.max(2, Math.round((row.nearestM / 1000 / 28) * 60) + 2) }
  }
  return Object.values(VEHICLE_TO_RIDE_CATEGORY).map((category) => ({ category, drivers: byCategory[category]?.drivers ?? 0, etaMinutes: byCategory[category]?.etaMinutes ?? null }))
}
