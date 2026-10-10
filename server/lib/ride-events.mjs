// Safety Phase 1 (2026-10-10): the writer for the immutable trip "black box" (see
// prisma/schema.prisma model RideEvent). Every meaningful moment of a ride -- created, offered,
// accepted, each driver status change, an SOS -- is appended here with who/when/where so a trip can
// be reconstructed exactly after the fact.
//
// CONTRACT: best-effort audit. Writing an event must NEVER break (or roll back) the ride action it
// records. logRideEvent takes an explicit Prisma client so a caller can either (a) pass a live
// `tx` to make the event part of a surrounding transaction, or (b) pass `db()` to write it
// standalone/out-of-band. It catches and logs its own errors and returns the created row or null;
// it never throws. logRideEventSafe is the same thing with an even louder "cannot throw" guarantee
// for fire-and-forget call sites (`void logRideEventSafe(...)`).
import { log } from './logger.mjs'

// Keep metadata to plain JSON and bounded -- this is an audit sink, not a blob store. A non-object
// meta is coerced to {} rather than rejected, because a logging call must never be the thing that
// throws.
function safeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  return meta
}

export async function logRideEvent(client, { rideId, type, actorId = null, actorRole = null, lat = null, lng = null, meta = {} } = {}) {
  try {
    if (!client || !rideId || !type) return null
    return await client.rideEvent.create({
      data: {
        rideId,
        type,
        actorId: actorId ?? null,
        actorRole: actorRole ?? null,
        lat: typeof lat === 'number' && Number.isFinite(lat) ? lat : null,
        lng: typeof lng === 'number' && Number.isFinite(lng) ? lng : null,
        meta: safeMeta(meta),
      },
    })
  } catch (error) {
    // Swallow: a failed audit write must not break the ride flow that triggered it.
    log.warn('ride_event_log_failed', {
      rideId,
      type,
      code: error?.code,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// Convenience wrapper for fire-and-forget call sites. Identical behaviour (logRideEvent already
// swallows), kept as a named export so intent reads clearly at the call site and any future
// pre/post handling has one home.
export async function logRideEventSafe(client, payload) {
  try {
    return await logRideEvent(client, payload)
  } catch {
    return null
  }
}
