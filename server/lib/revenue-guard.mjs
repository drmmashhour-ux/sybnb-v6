// ============================================================================
// REVENUE GUARD CAPSULE (2026-10-11)
// ----------------------------------------------------------------------------
// A portable revenue-assurance / off-platform-leakage detector. It watches
// transactions where two parties are matched by the platform and could collude
// to complete the deal OFF-platform (so the platform collects no commission) by
// cancelling the on-platform order.
//
// Design as a CAPSULE: the detection RULES below are pure, dependency-free, and
// speak a generic vocabulary (provider / consumer / transaction), so they lift
// unchanged into any future platform. Only `runRevenueGuard()` at the bottom is
// SYBNB-specific (Prisma + incidents + admin notify). To reuse elsewhere: copy
// the "Portable detection core", write a new adapter that maps that platform's
// orders to { id, providerId, consumerId, status, reachedFulfillment }.
//
// Everything here is BEST-EFFORT and MUST NEVER THROW — a detection failure can
// never break the tick that runs it.
// ============================================================================
import { db } from './prisma.mjs'
import { log } from './logger.mjs'
import { notifyAdmin } from './notifications.mjs'

function cfgNum(key, def) {
  const r = Number(process.env[key])
  return Number.isFinite(r) && r > 0 ? r : def
}
// Tunable thresholds (env-overridable).
export const REVENUE_GUARD_CONFIG = {
  windowDays: () => cfgNum('REVENUE_GUARD_WINDOW_DAYS', 30),
  pairCancelThreshold: () => cfgNum('REVENUE_GUARD_PAIR_CANCELS', 3),   // same pair cancels N+ with 0 completions
  providerMinTxns: () => cfgNum('REVENUE_GUARD_PROVIDER_MIN', 8),       // ignore providers with too few orders
  providerCancelRate: () => cfgNum('REVENUE_GUARD_PROVIDER_RATE', 0.4), // provider cancels >= 40% of orders
  maxScan: () => cfgNum('REVENUE_GUARD_MAX_SCAN', 5000),
}

// ---------------------------------------------------------------------------
// Portable detection core — PURE. Input: txns = [{ id, providerId, consumerId,
// status: 'CANCELLED'|'COMPLETED'|..., reachedFulfillment?: boolean }].
// ---------------------------------------------------------------------------

// Smoking gun: the order reached fulfillment (goods/service actually delivered —
// e.g. rider verified in the car) and was then CANCELLED. Near-certain off-platform close.
export function detectReachedThenCancelled(txns) {
  return txns.filter((t) => t.status === 'CANCELLED' && t.reachedFulfillment)
}

// Collusion: the SAME provider+consumer pair cancels repeatedly and NEVER completes.
export function detectCollusionPairs(txns, { threshold } = {}) {
  const min = threshold || REVENUE_GUARD_CONFIG.pairCancelThreshold()
  const m = new Map()
  for (const t of txns) {
    if (!t.providerId || !t.consumerId) continue
    const k = `${t.providerId}|${t.consumerId}`
    const e = m.get(k) || { providerId: t.providerId, consumerId: t.consumerId, cancels: 0, completions: 0 }
    if (t.status === 'CANCELLED') e.cancels += 1
    else if (t.status === 'COMPLETED') e.completions += 1
    m.set(k, e)
  }
  return [...m.values()].filter((e) => e.cancels >= min && e.completions === 0)
}

// A provider (driver / host) whose cancel rate is abnormally high across enough orders.
export function detectHighCancelProviders(txns, { minCount, rate } = {}) {
  const min = minCount || REVENUE_GUARD_CONFIG.providerMinTxns()
  const rt = rate || REVENUE_GUARD_CONFIG.providerCancelRate()
  const m = new Map()
  for (const t of txns) {
    if (!t.providerId) continue
    const e = m.get(t.providerId) || { providerId: t.providerId, total: 0, cancels: 0 }
    e.total += 1
    if (t.status === 'CANCELLED') e.cancels += 1
    m.set(t.providerId, e)
  }
  return [...m.values()]
    .filter((e) => e.total >= min && e.cancels / e.total >= rt)
    .map((e) => ({ ...e, cancelRate: Math.round((e.cancels / e.total) * 100) / 100 }))
}

// ---------------------------------------------------------------------------
// SYBNB adapter
// ---------------------------------------------------------------------------

async function openRevenueFlagExists(rideId, flag) {
  const rows = await db().incident.findMany({ where: { rideId, status: 'OPEN', type: 'REPORT' }, select: { meta: true } })
  return rows.some((r) => r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) && r.meta.revenueFlag === flag)
}

async function flagRideIncident(ride, flag, detail) {
  try {
    if (await openRevenueFlagExists(ride.id, flag)) return false
    const reporterId = ride.driverId || ride.riderId
    if (!reporterId) return false
    const incident = await db().incident.create({
      data: { rideId: ride.id, reporterId, reporterRole: 'SYSTEM', type: 'REPORT', status: 'OPEN', note: null, meta: { revenueFlag: flag, rideId: ride.id, ...detail } },
    })
    notifyAdmin('admin_revenue_flag', { kind: flag, rideId: ride.id, driverId: ride.driverId, riderId: ride.riderId, incidentId: incident.id, ...detail }, `rev:${ride.id}:${flag}`)
    return true
  } catch (error) {
    log.warn('revenue_guard_flag_failed', { rideId: ride.id, flag, message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

const dayKey = () => new Date().toISOString().slice(0, 10)

export async function runRevenueGuard() {
  const out = { ridesScanned: 0, offPlatformFlagged: 0, collusionPairs: 0, highCancelProviders: 0, hostCancelFlagged: 0 }
  const since = new Date(Date.now() - REVENUE_GUARD_CONFIG.windowDays() * 86400000)
  const scan = REVENUE_GUARD_CONFIG.maxScan()

  // ---- SR rides ----
  try {
    const rides = await db().rideRequest.findMany({
      where: { status: { in: ['CANCELLED', 'COMPLETED'] }, updatedAt: { gte: since }, driverId: { not: null } },
      take: scan,
      select: { id: true, driverId: true, riderId: true, status: true },
    })
    out.ridesScanned = rides.length

    // Which cancelled rides actually reached the car (PICKUP_VERIFIED / IN_PROGRESS)?
    const cancelledIds = rides.filter((r) => r.status === 'CANCELLED').map((r) => r.id)
    let reached = new Set()
    if (cancelledIds.length) {
      const evs = await db().rideEvent.findMany({
        where: { rideId: { in: cancelledIds }, type: { in: ['IN_PROGRESS', 'PICKUP_VERIFIED'] } },
        select: { rideId: true },
      })
      reached = new Set(evs.map((e) => e.rideId))
    }
    const txns = rides.map((r) => ({ id: r.id, providerId: r.driverId, consumerId: r.riderId, status: r.status, reachedFulfillment: reached.has(r.id) }))

    // Detector 1 — reached-then-cancelled (ride-scoped incident, idempotent).
    for (const t of detectReachedThenCancelled(txns)) {
      const ride = rides.find((r) => r.id === t.id)
      if (ride && (await flagRideIncident(ride, 'OFFPLATFORM_SUSPECTED', { reason: 'ride reached pickup/in-progress then was cancelled — possible off-platform cash completion' }))) out.offPlatformFlagged += 1
    }
    // Detector 2 — collusion pairs (admin alert, one/day/pair).
    for (const p of detectCollusionPairs(txns)) {
      notifyAdmin('admin_revenue_flag', { kind: 'COLLUSION_PAIR', domain: 'SR', driverId: p.providerId, riderId: p.consumerId, cancels: p.cancels }, `rev-pair:${p.providerId}:${p.consumerId}:${dayKey()}`)
      out.collusionPairs += 1
    }
    // Detector 3 — high-cancel drivers (admin alert, one/day/driver).
    for (const d of detectHighCancelProviders(txns)) {
      notifyAdmin('admin_revenue_flag', { kind: 'HIGH_CANCEL_PROVIDER', domain: 'SR', driverId: d.providerId, cancelRate: d.cancelRate, cancels: d.cancels, total: d.total }, `rev-drv:${d.providerId}:${dayKey()}`)
      out.highCancelProviders += 1
    }
  } catch (error) {
    log.warn('revenue_guard_sr_failed', { message: error instanceof Error ? error.message : String(error) })
  }

  // ---- Stays / bookings (host plays the "provider") ----
  try {
    const bookings = await db().booking.findMany({
      where: { status: { in: ['CANCELLED', 'COMPLETED'] }, updatedAt: { gte: since } },
      take: scan,
      select: { id: true, guestId: true, status: true, listing: { select: { ownerId: true } } },
    })
    const txns = bookings.map((b) => ({ id: b.id, providerId: b.listing?.ownerId || null, consumerId: b.guestId, status: b.status }))
    for (const p of detectCollusionPairs(txns)) {
      notifyAdmin('admin_revenue_flag', { kind: 'COLLUSION_PAIR', domain: 'STAYS', hostId: p.providerId, guestId: p.consumerId, cancels: p.cancels }, `rev-bk-pair:${p.providerId}:${p.consumerId}:${dayKey()}`)
      out.hostCancelFlagged += 1
    }
    for (const d of detectHighCancelProviders(txns)) {
      notifyAdmin('admin_revenue_flag', { kind: 'HIGH_CANCEL_PROVIDER', domain: 'STAYS', hostId: d.providerId, cancelRate: d.cancelRate, cancels: d.cancels, total: d.total }, `rev-host:${d.providerId}:${dayKey()}`)
      out.hostCancelFlagged += 1
    }
  } catch (error) {
    log.warn('revenue_guard_stays_failed', { message: error instanceof Error ? error.message : String(error) })
  }

  return out
}
