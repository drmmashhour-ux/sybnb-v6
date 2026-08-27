import { db } from './prisma.mjs'

// SR Ride vs. Uber gap-closure (P1 #6): scheduled rides. Same opportunistic-activation pattern as
// booking-lifecycle.mjs's completeExpiredBookings() -- called from read paths instead of a cron
// job, since there is no scheduler in this deployment.
//
// A scheduled ride is created dormant (RideStatus.DRAFT -- confirmed unused elsewhere for rides;
// reused here rather than adding a new enum value) and only becomes visible/dispatchable to
// drivers once its scheduledFor time falls within DRIVER_VISIBILITY_LEAD_MS, mirroring how Uber
// only surfaces a scheduled trip to nearby drivers shortly before pickup, not the moment it's booked.
export const MIN_SCHEDULE_LEAD_MS = 30 * 60 * 1000 // rider must schedule at least 30 minutes ahead
const DRIVER_VISIBILITY_LEAD_MS = 15 * 60 * 1000 // ride activates (becomes REQUESTED) 15 min before pickup

export async function activateScheduledRides(where = {}) {
  const cutoff = new Date(Date.now() + DRIVER_VISIBILITY_LEAD_MS)
  const result = await db().rideRequest.updateMany({
    where: {
      status: 'DRAFT',
      scheduledFor: { not: null, lte: cutoff },
      ...where,
    },
    data: { status: 'REQUESTED' },
  })
  return result.count
}
