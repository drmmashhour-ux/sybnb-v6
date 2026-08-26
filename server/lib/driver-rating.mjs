import { db } from './prisma.mjs'

// SR Ride vs. Uber gap-closure: ratings were collected (RideReview) but never aggregated or shown
// back to anyone -- a rider had no way to see a driver's real rating before or during a ride, and a
// driver had no way to see their own. hiddenAt-excluded, matching the same admin-hide discipline
// ListingReview already uses.
export async function getDriverRatingSummary(driverId) {
  if (!driverId) return { averageRating: null, ratingCount: 0 }
  const result = await db().rideReview.aggregate({
    where: { hiddenAt: null, ride: { driverId } },
    _avg: { rating: true },
    _count: true,
  })
  return {
    averageRating: result._avg.rating !== null ? Math.round(result._avg.rating * 10) / 10 : null,
    ratingCount: result._count,
  }
}
