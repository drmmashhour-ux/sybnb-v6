// Safety Phase 2 (2026-10-10): time / signal anomaly detection for active SR rides. Runs off the
// public /internal/tick timer (server/index.mjs) alongside the dispatch sweep. It scans IN_PROGRESS
// rides and opens an Incident (type REPORT) when a ride runs far over its estimate (OVERTIME) or the
// driver's live GPS has gone stale mid-trip (DRIVER_SIGNAL_LOST). Everything here is BEST-EFFORT and
// MUST NEVER THROW -- a detection failure can never break a ride or the tick.
//
// Idempotency: one OPEN REPORT incident per ride+anomaly. A later sweep that re-detects the same
// still-open anomaly is a no-op (openAnomalyExists), so admins get exactly one incident + one email
// per anomaly until they resolve it. NO new RideEvent enum value is introduced (that would need a
// migration) -- the anomaly is recorded on the Incident and emailed to admins; no black-box event
// type fits an automated anomaly, so none is written (the task explicitly permits this).
import { db } from './prisma.mjs'
import { log } from './logger.mjs'
import { getDriverLocation } from './live-map.mjs'
import { notifyAdmin } from './notifications.mjs'
import { analyzeRide } from './ai-ride-analyst.mjs'

// elapsed > estimatedMinutes * this factor => OVERTIME. Env-tunable; conservative default.
function overtimeFactor() {
  const raw = Number(process.env.SR_ANOMALY_OVERTIME_FACTOR)
  return Number.isFinite(raw) && raw > 0 ? raw : 2.5
}

// A ride must have been IN_PROGRESS longer than this (minutes) before a stale GPS counts as a lost
// signal -- avoids flagging a trip that has only just begun. Env-tunable.
function signalLostMinutes() {
  const raw = Number(process.env.SR_ANOMALY_SIGNAL_LOST_MIN)
  return Number.isFinite(raw) && raw > 0 ? raw : 5
}

// When the ride went IN_PROGRESS: prefer the first IN_PROGRESS black-box event, else fall back to
// the ride's updatedAt (good enough -- an active ride's last write is usually the status change).
async function inProgressSince(ride) {
  try {
    const ev = await db().rideEvent.findFirst({
      where: { rideId: ride.id, type: 'IN_PROGRESS' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })
    if (ev?.createdAt) return new Date(ev.createdAt)
  } catch {
    // fall through to updatedAt
  }
  return ride.updatedAt ? new Date(ride.updatedAt) : null
}

// True if an OPEN REPORT incident for this ride already carries this anomaly (idempotency guard).
async function openAnomalyExists(rideId, anomaly) {
  const rows = await db().incident.findMany({
    where: { rideId, status: 'OPEN', type: 'REPORT' },
    select: { meta: true },
  })
  return rows.some((r) => r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) && r.meta.anomaly === anomaly)
}

async function flagAnomaly(ride, anomaly, detail) {
  try {
    if (await openAnomalyExists(ride.id, anomaly)) return false
    // reporterId is required; an automated detection has no human reporter, so attribute it to a
    // real party on the ride (driver preferred, rider as fallback) and mark the role SYSTEM.
    const reporterId = ride.driverId || ride.riderId
    if (!reporterId) return false
    const incident = await db().incident.create({
      data: {
        rideId: ride.id,
        reporterId,
        reporterRole: 'SYSTEM',
        type: 'REPORT',
        status: 'OPEN',
        note: null,
        meta: { anomaly, rideId: ride.id, ...detail },
      },
    })
    notifyAdmin(
      'admin_ride_anomaly',
      { rideId: ride.id, anomaly, incidentId: incident.id, ...detail },
      `anomaly:${ride.id}:${anomaly}`,
    )
    // Safety Phase 3 (2026-10-10): give the new anomaly incident an instant AI read. Fire-and-forget
    // and best-effort -- analyzeRide never throws and is key-gated; a failure can never break the
    // sweep. On success the advisory read is merged onto incident.meta.ai.
    void (async () => {
      try {
        const [events, incidents] = await Promise.all([
          db().rideEvent.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: 'asc' } }),
          db().incident.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: 'desc' } }),
        ])
        const analysis = await analyzeRide({ ride, events, incidents })
        if (analysis.configured && !analysis.error) {
          const fresh = await db().incident.findUnique({ where: { id: incident.id }, select: { meta: true } })
          const baseMeta = fresh?.meta && typeof fresh.meta === 'object' && !Array.isArray(fresh.meta) ? fresh.meta : {}
          await db().incident.update({ where: { id: incident.id }, data: { meta: { ...baseMeta, ai: analysis } } })
        }
      } catch {
        // best-effort: an AI attach failure must never affect anomaly detection
      }
    })().catch(() => {})
    return true
  } catch (error) {
    log.warn('ride_anomaly_flag_failed', {
      rideId: ride.id,
      anomaly,
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function detectRideAnomalies() {
  try {
    const rides = await db().rideRequest.findMany({
      where: { status: 'IN_PROGRESS' },
      take: 100,
      select: { id: true, driverId: true, riderId: true, updatedAt: true, metadata: true },
    })
    const now = Date.now()
    const factor = overtimeFactor()
    const signalLostMin = signalLostMinutes()
    let flagged = 0

    for (const ride of rides) {
      try {
        const since = await inProgressSince(ride)
        if (!since) continue
        const elapsedMinutes = (now - since.getTime()) / 60000
        if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) continue

        const meta = ride.metadata && typeof ride.metadata === 'object' && !Array.isArray(ride.metadata) ? ride.metadata : {}
        const estimatedMinutes = Number(meta.estimatedMinutes)

        // OVERTIME: ran far past the estimate (only when an estimate is known).
        if (Number.isFinite(estimatedMinutes) && estimatedMinutes > 0 && elapsedMinutes > estimatedMinutes * factor) {
          if (await flagAnomaly(ride, 'OVERTIME', { elapsedMinutes: Math.round(elapsedMinutes), estimatedMinutes, overtimeFactor: factor })) flagged++
        }

        // DRIVER_SIGNAL_LOST: live GPS gone stale (getDriverLocation returns null past the freshness
        // window) while the trip has been running longer than the grace period.
        if (ride.driverId && elapsedMinutes > signalLostMin) {
          const loc = await getDriverLocation(ride.driverId).catch(() => null)
          if (!loc) {
            if (await flagAnomaly(ride, 'DRIVER_SIGNAL_LOST', { elapsedMinutes: Math.round(elapsedMinutes), signalLostMin })) flagged++
          }
        }
      } catch (error) {
        log.warn('ride_anomaly_ride_failed', {
          rideId: ride.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { scanned: rides.length, flagged }
  } catch (error) {
    log.warn('ride_anomaly_scan_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return { scanned: 0, flagged: 0 }
  }
}
