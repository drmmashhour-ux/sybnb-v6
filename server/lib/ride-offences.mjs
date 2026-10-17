// Late-cancellation control (owner decision 2026-10-17), same ladder for riders and drivers.
//
// An "offence" is a late cancel: a rider who cancels (or never shows) after the driver reached the
// pickup point, or a driver who cancels a ride after the grace window / after arriving.
//   1st offence in the window -> $1   (minimum; goes to the driver, or is debited from the driver)
//   2nd offence               -> $5
//   3rd offence               -> $5 and the account is blocked from requesting / accepting rides
// Offences are counted over a rolling window (default 30 days) and are never stored as a flag: the
// block is simply "3 or more un-voided offences in the window", so it expires on its own and an admin
// lifts it by voiding an offence (waiving the fee). Amounts are USD whole dollars (1 minor unit = $1).

export function offenceFeesMinor(env = process.env) {
  const parsed = String(env.RIDE_OFFENCE_FEES_MINOR || '1,5')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v >= 0)
  return parsed.length ? parsed : [1, 5]
}
export function offenceBlockThreshold(env = process.env) {
  const raw = Number(env.RIDE_OFFENCE_BLOCK_AT)
  return Number.isInteger(raw) && raw >= 2 && raw <= 20 ? raw : 3
}
export function offenceWindowMs(env = process.env) {
  const raw = Number(env.RIDE_OFFENCE_WINDOW_DAYS)
  return (Number.isFinite(raw) && raw >= 1 && raw <= 365 ? raw : 30) * 86_400_000
}

// Fee for the Nth offence (1-based). Beyond the end of the ladder the last amount repeats.
export function offenceFeeMinor(offenceNumber, env = process.env) {
  const fees = offenceFeesMinor(env)
  const n = Math.max(1, Math.floor(offenceNumber || 1))
  return fees[Math.min(n, fees.length) - 1]
}

// Final fee for a rider's late cancel / no-show: the existing percent-based fee, but never below the
// ladder amount, and never above the fare itself. Only USD rides use the ladder.
export function riderOffenceFeeMinor({ baseFeeMinor, fareMinor, currency, offenceNumber }, env = process.env) {
  if (!fareMinor || fareMinor <= 0) return baseFeeMinor ?? null
  if (currency && currency !== 'USD') return baseFeeMinor ?? null
  const floor = offenceFeeMinor(offenceNumber, env)
  return Math.min(Math.max(baseFeeMinor || 0, floor), fareMinor)
}

export function isOffenceBlocked(count, env = process.env) {
  return count >= offenceBlockThreshold(env)
}

// Un-voided offences by this user in the role window.
export async function countOffences(client, { userId, role }, now = Date.now(), env = process.env) {
  const since = new Date(now - offenceWindowMs(env))
  const where = {
    updatedAt: { gte: since },
    AND: [
      { metadata: { path: ['lateCancel', 'by'], equals: role } },
      { NOT: { metadata: { path: ['lateCancel', 'voided'], equals: true } } },
    ],
    ...(role === 'RIDER' ? { riderId: userId } : { driverId: userId }),
  }
  return client.rideRequest.count({ where })
}

export function restrictedError(role) {
  const error = new Error(
    role === 'RIDER'
      ? 'Your account is temporarily blocked from requesting rides because of repeated late cancellations. Contact support if you think this is a mistake.'
      : 'Your account is temporarily blocked from accepting rides because of repeated late cancellations. Contact support if you think this is a mistake.',
  )
  error.statusCode = 403
  error.code = role === 'RIDER' ? 'RIDER_RESTRICTED' : 'DRIVER_RESTRICTED'
  error.expose = true
  return error
}
