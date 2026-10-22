import { db } from './prisma.mjs'

// No plan-duration numbers existed anywhere in the product before this — divisions.ts claimed
// "listings expire by plan duration" with nothing backing it. These are reasonable marketplace
// defaults (basic vs premium listing lifespan), not a value specified elsewhere in the app.
export const PLAN_DURATION_DAYS = {
  plus: 30,
  premium: 60,
}

export function listingExpiryDate(planCode) {
  const days = PLAN_DURATION_DAYS[planCode] ?? PLAN_DURATION_DAYS.plus
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

// Same opportunistic-expiry pattern as completeExpiredBookings(): run on read instead of a cron,
// so a lapsed paid-plan listing stops appearing in browse/host views without needing a scheduler.
export async function expireOldListings(where = {}) {
  await db().listing.updateMany({
    where: { ...where, status: 'APPROVED', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
}

// Search-path variant (scale, 2026-10-22): the whole-table sweep at most once per EXPIRY_SWEEP_MS
// per process, single-flight. Callers that need exactness filter on expiresAt themselves (search
// does). Never throws: a failed sweep only delays the status change, it never hides or shows a row.
const EXPIRY_SWEEP_MS = Math.max(0, Number(process.env.LISTING_EXPIRY_SWEEP_MS ?? 60_000))
let lastExpirySweepAt = 0
let expirySweepInFlight = null
export async function expireOldListingsThrottled() {
  if (expirySweepInFlight) return expirySweepInFlight
  if (Date.now() - lastExpirySweepAt < EXPIRY_SWEEP_MS) return undefined
  lastExpirySweepAt = Date.now()
  expirySweepInFlight = expireOldListings()
    .catch(() => undefined)
    .finally(() => { expirySweepInFlight = null })
  return expirySweepInFlight
}
