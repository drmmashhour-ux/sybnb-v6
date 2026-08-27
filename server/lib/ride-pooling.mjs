import { db } from './prisma.mjs'
import { getRideCoords } from './live-map.mjs'

// SR Ride vs. Uber gap-closure (last item, previously assessed out of scope): ride-pooling. A real
// MVP: a rider opts in for a flat discount and accepts a driver may pick up a second, genuinely
// nearby shareable rider along the way -- not a decorative "Share" label nobody has to honor.
//
// Placeholder rate, disclosed like every other money-adjacent default this arc (0%-commission,
// 20%-cancellation-fee): a real business decision from the owner, not invented as "the" number.
export const SHARE_DISCOUNT_PERCENT = 15

// How close a second shareable ride's pickup must be to the driver's other active ride's pickup to
// count as "along the way". Plain haversine -- pure geometry, not a per-country gazetteer/fare
// capability, so this doesn't go through the country-neutral geo-adapter seam (see
// server/lib/geo-adapter.mjs's own header comment on what IS a country capability).
const POOL_MAX_DISTANCE_KM = 3
const EARTH_RADIUS_KM = 6371

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export function applyShareDiscount(fareMinor) {
  return Math.max(0, fareMinor - Math.round((fareMinor * SHARE_DISCOUNT_PERCENT) / 100))
}

// Checked before a claim is allowed to proceed. A normal (non-shareable) ride keeps the pre-
// existing one-active-ride-per-driver expectation, now actually enforced instead of silently
// unbounded -- a driver could previously claim any number of unrelated active rides at once with
// nothing stopping them; a genuine, if narrow, correctness gap surfaced while building this
// capsule and closed here rather than left as-is.
export async function assertPoolClaimEligible(driverId, candidateRide) {
  const driverActiveRides = await db().rideRequest.findMany({
    where: { driverId, status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'] } },
  })

  if (driverActiveRides.length === 0) return

  if (!candidateRide.shareable || driverActiveRides.some((ride) => !ride.shareable)) {
    const error = new Error('You already have an active ride and cannot claim another right now.')
    error.statusCode = 409
    error.code = 'DRIVER_ALREADY_ON_A_RIDE'
    error.expose = true
    throw error
  }

  if (driverActiveRides.length >= 2) {
    const error = new Error('You already have two pooled rides in progress.')
    error.statusCode = 409
    error.code = 'DRIVER_POOL_FULL'
    error.expose = true
    throw error
  }

  const [otherRide] = driverActiveRides
  const [otherCoords, candidateCoords] = await Promise.all([getRideCoords(otherRide.id), getRideCoords(candidateRide.id)])
  if (!otherCoords.pickup || !candidateCoords.pickup) {
    const error = new Error('This ride cannot be pooled -- pickup location could not be confirmed.')
    error.statusCode = 400
    error.code = 'RIDE_POOL_LOCATION_UNKNOWN'
    error.expose = true
    throw error
  }

  const distanceKm = haversineKm(otherCoords.pickup, candidateCoords.pickup)
  if (distanceKm > POOL_MAX_DISTANCE_KM) {
    const error = new Error(`This ride's pickup is too far from your current pooled ride (${distanceKm.toFixed(1)}km away).`)
    error.statusCode = 400
    error.code = 'RIDE_POOL_TOO_FAR'
    error.expose = true
    throw error
  }
}
