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
import { logRideEventSafe } from './ride-events.mjs'
import { dutyBlockers } from '../routes/driver-base.mjs'
import { isRateLimited } from './rateLimit.mjs'

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
// Only drivers within this straight-line radius of the pickup are considered (metres).
const DISPATCH_RADIUS_M = envInt('SR_DISPATCH_RADIUS_M', 15000, 1000, 100000)
// The sweep (lapsed-offer escalation + offering still-unoffered rides) runs at most once per this
// window ACROSS ALL REPLICAS (shared Postgres lease), no matter how many drivers poll.
const SWEEP_MIN_INTERVAL_MS = envInt('SR_DISPATCH_SWEEP_MIN_MS', 2000, 250, 60000)

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
  // Safety gates mirror the manual /claim path: registration expiry is ALWAYS enforced (added
  // unconditionally below); the mechanical-inspection requirement is gated by the same env flag
  // SR_REQUIRE_VEHICLE_INSPECTION (default on -- only an explicit 'false'/'0' skips it).
  const inspectionRequired = !['false', '0'].includes(String(process.env.SR_REQUIRE_VEHICLE_INSPECTION ?? '').trim().toLowerCase())
  // Default on; SR_DISPATCH_REQUIRE_DUTY=false only for local tests that do not seed duty/documents.
  const requireDuty = !['false', '0'].includes(String(process.env.SR_DISPATCH_REQUIRE_DUTY ?? '').trim().toLowerCase())
  const dutySql = requireDuty ? Prisma.sql`AND dp.on_duty_at IS NOT NULL` : Prisma.empty
  const inspectionSql = inspectionRequired
    ? Prisma.sql`AND dp.inspection_status = 'PASSED' AND (dp.inspection_expires_at IS NULL OR dp.inspection_expires_at > now())`
    : Prisma.empty
  // Candidate lookup (scale, 2026-10-22). The KNN ORDER BY is on the raw geometry column against a
  // scalar pickup point, so the GIST index driver_profiles_location_gix serves it (an index-ordered scan
  // that stops after the first matches). The old form cast both sides to ::geography, which no index
  // covers, so every dispatch read and sorted EVERY driver row (measured: seq scan, 22 ms at 2,000
  // drivers, linear in fleet size). Degree distance is only used to pick the nearest ~30 candidates
  // inside the radius; the final order and the distance reported are true metres (geography).
  const rows = await db().$queryRaw(Prisma.sql`
    WITH ride AS (
      SELECT id, rider_id, pickup_geo, metadata FROM ride_requests WHERE id = ${ride.id}::uuid AND pickup_geo IS NOT NULL
    ),
    candidates AS (
      SELECT dp.user_id, dp.last_location_geo
      FROM driver_profiles dp
      JOIN users u ON u.id = dp.user_id
      WHERE dp.last_location_geo IS NOT NULL
        -- index-assisted bounding box first (degrees; generous so it never cuts inside the radius), then the exact metre test
        AND dp.last_location_geo && ST_Expand((SELECT pickup_geo FROM ride), ${DISPATCH_RADIUS_M / 80000})
        AND ST_DWithin(dp.last_location_geo::geography, (SELECT pickup_geo FROM ride)::geography, ${DISPATCH_RADIUS_M})
        AND u.id_document_status = 'APPROVED'
        AND dp.vehicle_plate IS NOT NULL
        AND dp.vehicle_status = 'APPROVED'
        AND dp.vehicle_category IS NOT NULL
        AND dp.vehicle_category::text = CASE (SELECT metadata->>'category' FROM ride)
            WHEN 'SR Bike' THEN 'BIKE'
            WHEN 'SR Economy' THEN 'ECONOMY'
            WHEN 'SR Comfort' THEN 'COMFORT'
            WHEN 'SR SUV' THEN 'SUV'
            WHEN 'SR Van' THEN 'VAN'
            ELSE NULL END
        AND (dp.registration_expires_at IS NULL OR dp.registration_expires_at > now())
        ${inspectionSql}
        AND dp.last_location_updated_at >= now() - (interval '1 second' * ${ONLINE_WINDOW_SECONDS})
        AND dp.user_id <> (SELECT rider_id FROM ride)
        AND dp.user_id <> ALL(${excludeSql})
        ${accessibilitySql}
        AND NOT EXISTS (
          SELECT 1 FROM ride_requests ar
          WHERE ar.driver_id = dp.user_id
            AND ar.status IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS')
        )
        -- one live offer per driver: never hand a driver a second ride while another offer is pending
        AND NOT EXISTS (
          SELECT 1 FROM ride_requests oo
          WHERE oo.offered_driver_id = dp.user_id
            AND oo.id <> ${ride.id}::uuid
            AND oo.driver_id IS NULL
            AND oo.status IN ('REQUESTED', 'MATCHING')
            AND oo.offer_expires_at > now()
        )
        ${dutySql}
      ORDER BY dp.last_location_geo <-> (SELECT pickup_geo FROM ride)
      LIMIT 30
    )
    SELECT c.user_id AS "userId",
           ST_Distance(c.last_location_geo::geography, (SELECT pickup_geo FROM ride)::geography) AS "distanceM"
    FROM candidates c
    ORDER BY 2
    LIMIT 8
  `)
  // Offer only to a driver who could actually ACCEPT: the claim path (assertDriverOnDuty) refuses a
  // driver who is off duty or has a missing/rejected/expired document, so offering to them just made
  // the rider wait out the offer window for nothing. Same rule, checked here before offering.
  for (const row of rows) {
    if (requireDuty) {
      const profile = await db().driverProfile.findUnique({ where: { userId: row.userId }, select: { vehicleCategory: true } })
      const { blockers } = await dutyBlockers(row.userId, profile)
      if (blockers.length) continue
    }
    return { userId: row.userId, distanceM: row.distanceM == null ? null : Number(row.distanceM) }
  }
  return null
}

// Offer the ride to the next eligible driver. No-op (returns {offered:false}) if the ride is already
// claimed or no longer open; {offered:false, exhausted:true} once the escalation cap is hit. On a
// successful offer, records the outstanding offer + expiry, bumps the round counter, and fires a
// fire-and-forget push to the offered driver.
export async function offerRideToNextDriver(rideId) {
  const ride = await db().rideRequest.findUnique({
    where: { id: rideId },
    select: { id: true, driverId: true, status: true, accessibilityRequired: true, riderId: true, offerSeq: true, declinedByIds: true, offeredDriverId: true, offerExpiresAt: true },
  })
  if (!ride) return { offered: false }
  if (ride.driverId || !OPEN_RIDE_STATUSES.includes(ride.status)) return { offered: false }
  // A live offer is already out (e.g. ride-create and a sweep raced): never overwrite it.
  if (ride.offeredDriverId && ride.offerExpiresAt && ride.offerExpiresAt > new Date()) return { offered: false, alreadyOffered: true }
  if (ride.offerSeq >= MAX_OFFER_ROUNDS) {
    if (ride.offeredDriverId || ride.offerExpiresAt) {
      await db().rideRequest.updateMany({ where: { id: ride.id, driverId: null, offerSeq: ride.offerSeq }, data: { offeredDriverId: null, offerExpiresAt: null } })
    }
    return { offered: false, exhausted: true }
  }
  const next = await findNextDriverForRide(ride, ride.declinedByIds || [])
  if (!next) {
    // Nobody eligible right now. Only write when there is something to clear: the old unconditional
    // update fired on every sweep for every unmatched ride (thousands of no-op writes per minute).
    if (ride.offeredDriverId || ride.offerExpiresAt) {
      await db().rideRequest.updateMany({ where: { id: ride.id, driverId: null, offerSeq: ride.offerSeq }, data: { offeredDriverId: null, offerExpiresAt: null } })
    }
    return { offered: false }
  }
  // Compare-and-set on the round counter: if another dispatcher (a concurrent sweep, a decline, the
  // create path, another replica) offered this ride since we read it, our write matches 0 rows and we
  // back off instead of clobbering their offer -- previously two sweeps could overwrite each other's
  // offers, so the driver who saw the first offer got "not offered to you" when accepting.
  const won = await db().rideRequest.updateMany({
    where: { id: ride.id, driverId: null, status: { in: OPEN_RIDE_STATUSES }, offerSeq: ride.offerSeq },
    data: {
      offeredDriverId: next.userId,
      offerExpiresAt: new Date(Date.now() + OFFER_TTL_SECONDS * 1000),
      offerSeq: { increment: 1 },
    },
  })
  if (won.count !== 1) return { offered: false, raced: true }
  sendPushNotification(next.userId, {
    title: 'New ride nearby',
    body: 'A rider needs a driver — open Rezekme to accept.',
    url: '/driver',
  }).catch(() => {})
  // Safety Phase 1 (2026-10-10): record the auto-dispatch offer in the ride's black box. No human
  // actor (system dispatch), so actorId/actorRole stay null; the offered driver is in meta. Best-
  // effort and fire-and-forget -- dispatch must never be delayed or broken by audit logging.
  void logRideEventSafe(db(), { rideId: ride.id, type: 'OFFERED', meta: { offeredDriverId: next.userId, offerSeq: (ride.offerSeq ?? 0) + 1, distanceM: next.distanceM ?? null } })
  dispatchStats.offers += 1
  return { offered: true, driverId: next.userId }
}

// Escalation driver, run on the driver pending-list read path (no daemon here). (a) Expire lapsed
// offers: mark the lapsed driver declined and re-offer to the next nearest. (b) Seed offers on any
// still-unoffered open ride under the round cap. Each ride is isolated in its own try/catch so one
// bad ride never aborts the whole sweep, and the whole thing is best-effort (never throws into the
// read path it runs on).
// Unmatched requests used to stay open forever (matchTimedOut was only a UI flag), so a rider whose
// request nobody took found the app reopening that old ride instead of the home page, with their
// prepayment still held. After SR_MATCH_EXPIRE_MINUTES (default 30) a request that still has no driver
// is cancelled with a full refund -- the same refund path as a rider cancel, idempotent by ride id.
// The guarded write (driverId null + the status we read) means a driver claiming at the same moment
// always wins and the expiry simply does not apply.
const MATCH_EXPIRE_MINUTES = envInt('SR_MATCH_EXPIRE_MINUTES', 30, 5, 1440)

export async function expireUnmatchedRides() {
  let expired = 0
  try {
    const { refundPrepaidRide } = await import('./finance-ledger.mjs')
    const { releaseCardHold } = await import('./ride-card-hold.mjs')
    const cutoff = new Date(Date.now() - MATCH_EXPIRE_MINUTES * 60 * 1000)
    const stale = await db().rideRequest.findMany({
      where: {
        driverId: null,
        status: { in: ['REQUESTED', 'MATCHING'] },
        requestedAt: { lt: cutoff },
        OR: [{ scheduledFor: null }, { scheduledFor: { lt: cutoff } }],
      },
      take: 50,
    })
    for (const ride of stale) {
      try {
        const done = await db().$transaction(async (tx) => {
          const result = await tx.rideRequest.updateMany({
            where: { id: ride.id, status: ride.status, driverId: null },
            data: { status: 'CANCELLED', cancellationFeeMinor: null, metadata: { ...(ride.metadata || {}), expiredNoDriver: { at: new Date().toISOString(), afterMinutes: MATCH_EXPIRE_MINUTES } } },
          })
          if (result.count === 1 && ride.metadata?.prepaid) await refundPrepaidRide(tx, { ride: { ...ride, cancellationFeeMinor: null } })
          if (result.count === 1) {
            await tx.adminAuditLog.create({
              data: { actorUserId: null, action: 'SR_RIDE_EXPIRED_NO_DRIVER', entityType: 'ride_requests', entityId: ride.id, before: { status: ride.status }, after: { status: 'CANCELLED' }, reason: `No driver within ${MATCH_EXPIRE_MINUTES} minutes; prepayment refunded.` },
            })
          }
          return result.count === 1
        })
        if (done) {
          if (ride.metadata?.cardHoldIntentId) await releaseCardHold(ride.metadata.cardHoldIntentId).catch(() => false)
          expired += 1
        }
      } catch {
        // one ride failing must not stop the rest
      }
    }
  } catch {
    // best-effort, never breaks the read path the sweep runs on
  }
  return expired
}

// Counters read by the /api/metrics endpoint (process-local; each replica reports its own).
export const dispatchStats = { sweeps: 0, sweepsSkipped: 0, offers: 0, lastSweepMs: 0, openUnmatched: 0 }

let sweepInFlight = null
let lastLocalSweepAt = 0

// Run the sweep at most once per SWEEP_MIN_INTERVAL_MS across ALL replicas. Before this, every driver
// pending-list poll (each idle driver, every 4 s) ran a full sweep, so N online drivers meant N
// concurrent sweeps re-offering the same rides: measured at 500 simulated drivers it produced ~7,400
// offer writes per minute for ~100 rides, exhausted the DB pool and broke matching. Callers that hit
// the window just skip; the next poll after it opens runs it.
export async function runDispatchSweep({ force = false } = {}) {
  const now = Date.now()
  if (sweepInFlight) { dispatchStats.sweepsSkipped += 1; return { skipped: true } }
  if (!force && now - lastLocalSweepAt < SWEEP_MIN_INTERVAL_MS) { dispatchStats.sweepsSkipped += 1; return { skipped: true } }
  lastLocalSweepAt = now
  sweepInFlight = (async () => {
    try {
      // shared lease (one row in rate_limit_buckets): the first replica in each window wins
      if (!force && (await isRateLimited('sr-dispatch-sweep', SWEEP_MIN_INTERVAL_MS, 1))) { dispatchStats.sweepsSkipped += 1; return { skipped: true } }
      const t0 = Date.now()
      const { activateScheduledRides } = await import('./ride-schedule.mjs')
      await activateScheduledRides().catch(() => 0)
      const result = await sweepOnce()
      dispatchStats.sweeps += 1
      dispatchStats.lastSweepMs = Date.now() - t0
      return result
    } catch {
      return { skipped: true }
    } finally {
      sweepInFlight = null
    }
  })()
  return sweepInFlight
}

async function sweepOnce() {
  let expired = 0
  let opened = 0
  try {
    const now = new Date()
    const lapsed = await db().rideRequest.findMany({
      where: { driverId: null, status: { in: OPEN_RIDE_STATUSES }, offeredDriverId: { not: null }, offerExpiresAt: { lt: now } },
      select: { id: true, offeredDriverId: true, declinedByIds: true },
      orderBy: { offerExpiresAt: 'asc' },
      take: 50,
    })
    for (const r of lapsed) {
      try {
        const declined = Array.from(new Set([...(r.declinedByIds || []), r.offeredDriverId].filter(Boolean)))
        // guarded: only clear THIS lapsed offer (a fresh offer made meanwhile is left alone)
        const cleared = await db().rideRequest.updateMany({
          where: { id: r.id, driverId: null, offeredDriverId: r.offeredDriverId, offerExpiresAt: { lt: now } },
          data: { declinedByIds: declined, offeredDriverId: null, offerExpiresAt: null },
        })
        if (cleared.count === 1) await offerRideToNextDriver(r.id)
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
    dispatchStats.openUnmatched = open.length
    for (const r of open) {
      try {
        const res = await offerRideToNextDriver(r.id)
        if (res.offered) opened += 1
      } catch {
        // one open ride failing to offer must not abort the sweep
      }
    }
    await expireUnmatchedRides()
  } catch {
    // whole-sweep guard: dispatch is best-effort and never breaks the read path it runs on
  }
  return { expired, opened }
}
