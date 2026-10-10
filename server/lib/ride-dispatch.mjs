// Full auto-dispatch (2026-10-10): a ride is auto-offered to the NEAREST eligible online driver with
// a short expiry. The offered driver can Accept (the normal /claim path, gated to the offer holder)
// or Decline; on decline OR expiry the ride escalates to the next-nearest eligible driver, skipping
// anyone who already declined/lapsed, until a cap is hit. Manual claim remains a fallback for any
// open ride.
//
// There is no background daemon in this deployment, so escalation is driven from read paths the same
// way activateScheduledRides() is -- runDispatchSweep() runs on the driver pending-list read. The
// sweep both expires stale offers (re-offering to the next driver) and makes an initial offer on any
// still-unoffered open ride, so a ride never sits unoffered just because its creation-time best-effort
// offer found nobody online.
import { Prisma } from '@prisma/client'
import { db } from './prisma.mjs'
import { sendPushNotification } from './push-notifications.mjs'

// Env knobs, clamped to sane bounds so a bad deploy value can't disable dispatch or offer forever.
function envInt(name, def, min, max) {
  const raw = Number(process.env[name])
  const val = Number.isFinite(raw) ? Math.trunc(raw) : def
  return Math.min(max, Math.max(min, val))
}

// How long a single offer stays outstanding before it lapses and escalates.
const OFFER_TTL_SECONDS = envInt('SR_OFFER_TTL_SECONDS', 30, 10, 300)
// Hard cap on escalation rounds, so a ride nobody takes can't be offered endlessly.
const MAX_OFFER_ROUNDS = envInt('SR_MAX_OFFER_ROUNDS', 10, 1, 50)
// "Online" = a driver whose last GPS report is within this many seconds (mirrors live-map's
// LOCATION_FRESHNESS_MS default of 120s).
const ONLINE_WINDOW_SECONDS = envInt('SR_DISPATCH_ONLINE_WINDOW_SECONDS', 120, 30, 600)

const ACTIVE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const OPEN_RIDE_STATUSES = ['REQUESTED', 'MATCHING']

// Find the single nearest eligible online driver for a ride, excluding a set of driver user-ids
// (drivers who already declined or let an offer lapse). Eligibility mirrors the manual /claim gates
// EXACTLY: an approved ID document, a registered + approved vehicle, accessibility capability when the
// ride requires it, not the rider themselves, and no other active ride in hand. Returns
// { userId, distanceM } for the nearest, or null when nobody qualifies.
export async function findNextDriverForRide(ride, excludeIds = []) {
  if (!ride?.id) return null
  // Prisma binds a JS array as a parameter; cast it to uuid[] so the <> ALL comparison is type-correct.
  // An empty exclude list must still produce a valid uuid[] literal (not an empty text[] parameter).
  const excludeSql = excludeIds.length ? Prisma.sql`${excludeIds}::uuid[]` : Prisma.sql`ARRAY[]::uuid[]`
  const accessibilitySql = ride.accessibilityRequired
    ? Prisma.sql`AND dp.accessibility_capable = true`
    : Prisma.empty
  const rows = await db().$queryRaw(Prisma.sql`
    SELECT dp.user_id AS "userId",
           (dp.last_location_geo::geography <-> rr.pickup_geo::geography) AS "distanceM"
    FROM ride_requests rr
    JOIN driver_profiles dp ON dp.last_location_geo IS NOT NULL
    JOIN users u ON u.id = dp.user_id
    WHERE rr.id = ${ride.id}::uuid
      AND rr.pickup_geo IS NOT NULL
      AND u.id_document_status = 'APPROVED'
      AND dp.vehicle_plate IS NOT NULL
      AND dp.vehicle_status = 'APPROVED'
      AND dp.last_location_updated_at >= now() - (interval '1 second' * ${ONLINE_WINDOW_SECONDS})
      AND dp.user_id <> rr.rider_id
      AND dp.user_id <> ALL(${excludeSql})
      ${accessibilitySql}
      AND NOT EXISTS (
        SELECT 1 FROM ride_requests ar
        WHERE ar.driver_id = dp.user_id
          AND ar.status IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS')
      )
    ORDER BY dp.last_location_geo::geography <-> rr.pickup_geo::geography
    LIMIT 1
  `)
  const row = rows[0]
  if (!row) return null
  return { userId: row.userId, distanceM: row.distanceM == null ? null : Number(row.distanceM) }
}

// Offer the ride to the next eligible driver. No-op (returns {offered:false}) if the ride is already
// claimed or no longer open; {offered:false, exhausted:true} once the escalation cap is hit. On a
// successful offer, records the outstanding offer + expiry, bumps the round counter, and fires a
// fire-and-forget push to the offered driver.
export async function offerRideToNextDriver(rideId) {
  const ride = await db().rideRequest.findUnique({
    where: { id: rideId },
    select: { id: true, driverId: true, status: true, accessibilityRequired: true, riderId: true, offerSeq: true, declinedByIds: true },
  })
  if (!ride) return { offered: false }
  if (ride.driverId || !OPEN_RIDE_STATUSES.includes(ride.status)) return { offered: false }
  if (ride.offerSeq >= MAX_OFFER_ROUNDS) {
    await db().rideRequest.update({ where: { id: ride.id }, data: { offeredDriverId: null, offerExpiresAt: null } })
    return { offered: false, exhausted: true }
  }
  const next = await findNextDriverForRide(ride, ride.declinedByIds || [])
  if (!next) {
    await db().rideRequest.update({ where: { id: ride.id }, data: { offeredDriverId: null, offerExpiresAt: null } })
    return { offered: false }
  }
  await db().rideRequest.update({
    where: { id: ride.id },
    data: {
      offeredDriverId: next.userId,
      offerExpiresAt: new Date(Date.now() + OFFER_TTL_SECONDS * 1000),
      offerSeq: { increment: 1 },
    },
  })
  sendPushNotification(next.userId, {
    title: 'New ride nearby',
    body: 'A rider needs a driver — open SR to accept.',
    url: '/driver',
  }).catch(() => {})
  return { offered: true, driverId: next.userId }
}

// Escalation driver, run on the driver pending-list read path (no daemon here). (a) Expire lapsed
// offers: mark the lapsed driver declined and re-offer to the next nearest. (b) Seed offers on any
// still-unoffered open ride under the round cap. Each ride is isolated in its own try/catch so one
// bad ride never aborts the whole sweep, and the whole thing is best-effort (never throws into the
// read path it runs on).
export async function runDispatchSweep() {
  let expired = 0
  let opened = 0
  try {
    const now = new Date()
    const lapsed = await db().rideRequest.findMany({
      where: { driverId: null, status: { in: OPEN_RIDE_STATUSES }, offeredDriverId: { not: null }, offerExpiresAt: { lt: now } },
      select: { id: true, offeredDriverId: true, declinedByIds: true },
      take: 50,
    })
    for (const r of lapsed) {
      try {
        const declined = Array.from(new Set([...(r.declinedByIds || []), r.offeredDriverId].filter(Boolean)))
        await db().rideRequest.update({ where: { id: r.id }, data: { declinedByIds: declined, offeredDriverId: null, offerExpiresAt: null } })
        await offerRideToNextDriver(r.id)
        expired += 1
      } catch {
        // one lapsed ride failing to re-offer must not abort the sweep
      }
    }
    const open = await db().rideRequest.findMany({
      where: { driverId: null, status: { in: OPEN_RIDE_STATUSES }, offeredDriverId: null, offerSeq: { lt: MAX_OFFER_ROUNDS } },
      select: { id: true },
      take: 50,
    })
    for (const r of open) {
      try {
        await offerRideToNextDriver(r.id)
        opened += 1
      } catch {
        // one open ride failing to offer must not abort the sweep
      }
    }
  } catch {
    // whole-sweep guard: dispatch is best-effort and never breaks the read path it runs on
  }
  return { expired, opened }
}
