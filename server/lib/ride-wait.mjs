// Pickup waiting + no-show policy (owner decision 2026-10-17, Uber-aligned).
//
// When the driver reaches the pickup point they tap "I've arrived": the rider is notified and has
// RIDE_WAIT_MINUTES (default 10) to board. If the rider has not boarded when the wait ends, the
// driver may mark a no-show: the ride is cancelled and the rider is charged RIDE_NO_SHOW_FEE_PERCENT
// of the locked fare (default 100 = no refund) which goes to the driver. A rider who cancels AFTER
// the driver has arrived pays the same fee. All values are env-tunable.
import { haversineKm } from './live-map.mjs'

function envNumber(name, fallback, min, max, env = process.env) {
  const raw = Number(env[name])
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback
}

export function rideWaitMs(env = process.env) {
  return envNumber('RIDE_WAIT_MINUTES', 10, 1, 60, env) * 60_000
}
export function noShowFeePercent(env = process.env) {
  return envNumber('RIDE_NO_SHOW_FEE_PERCENT', 100, 0, 100, env)
}
// How close the driver must be to the pickup point to tap "arrived" / "no-show" (metres).
export function arrivalRadiusMeters(env = process.env) {
  return envNumber('RIDE_ARRIVAL_RADIUS_METERS', 300, 50, 2000, env)
}

export function noShowFeeMinor(fareMinor, env = process.env) {
  if (!fareMinor || fareMinor <= 0) return null
  return Math.round((fareMinor * noShowFeePercent(env)) / 100)
}

export function isNearPickup(driverLocation, pickup, env = process.env) {
  if (!driverLocation || !pickup) return false
  return haversineKm(driverLocation, pickup) * 1000 <= arrivalRadiusMeters(env)
}

// State the clients render: null until the driver has arrived.
export function waitState(metadata, now = Date.now(), env = process.env) {
  const arrivedAt = metadata && typeof metadata === 'object' ? metadata.arrivedAt : null
  const arrivedMs = arrivedAt ? Date.parse(arrivedAt) : NaN
  if (!Number.isFinite(arrivedMs)) return null
  const waitEndsMs = arrivedMs + rideWaitMs(env)
  return {
    arrivedAt: new Date(arrivedMs).toISOString(),
    waitEndsAt: new Date(waitEndsMs).toISOString(),
    waitExpired: now >= waitEndsMs,
    secondsLeft: Math.max(0, Math.ceil((waitEndsMs - now) / 1000)),
  }
}
