import { db } from './prisma.mjs'
import { log } from './logger.mjs'
import { bookingPolicySettings } from './country.mjs'
import { expiredUnpaidBookingWhere } from './booking-policy.mjs'
import { notifyBooking } from './notifications.mjs'

export const PAYOUT_HOLD_DAYS = 14

// A confirmed stay has no natural "it's over" signal in this system (no cleaning-crew check-out
// scan, no guest confirmation step) — checkout date passing is the only real signal available.
// Called opportunistically from read paths (host/admin/guest overviews) instead of a cron job,
// since there is no scheduler in this deployment.
//
// Money-flow decisions 6 + 8 (2026-10-08): this same hook now also expires stale unpaid requests
// (expireUnpaidBookings, below) and emails "stay completed -- leave a review" to each guest whose
// booking it completes. The completion itself is unchanged: CONFIRMED + checkOut in the past ->
// COMPLETED, guarded on CONFIRMED in the UPDATE's WHERE so a concurrent change is never overwritten.
export async function completeExpiredBookings(where = {}) {
  await expireUnpaidBookings(where).catch((error) => {
    // The expiry sweep must never break the read path that piggybacks it.
    log.warn('booking_unpaid_expiry_failed', { message: error instanceof Error ? error.message : String(error) })
  })
  const now = new Date()
  const due = await db().booking.findMany({
    where: {
      status: 'CONFIRMED',
      checkOut: { not: null, lt: now },
      ...where,
    },
    select: { id: true },
    take: 500,
  })
  if (!due.length) return 0
  const result = await db().booking.updateMany({
    where: { id: { in: due.map((b) => b.id) }, status: 'CONFIRMED' },
    data: { status: 'COMPLETED' },
  })
  const completed = await db().booking.findMany({
    where: { id: { in: due.map((b) => b.id) }, status: 'COMPLETED' },
    select: { id: true, guestId: true, amountMinor: true, currency: true, listing: { select: { ownerId: true } } },
  })
  // Loaded dynamically to avoid a static import cycle (loyalty -> finance-ledger -> booking-lifecycle).
  // Loyalty awarding is idempotent per booking+role, so a re-run of this sweep never double-awards,
  // and a failure here must never break the read path that piggybacks completion.
  let awardBookingCompletion = null
  try {
    ;({ awardBookingCompletion } = await import('./loyalty.mjs'))
  } catch (error) {
    log.warn('loyalty_module_load_failed', { message: error instanceof Error ? error.message : String(error) })
  }
  for (const booking of completed) {
    notifyBooking('guest_stay_completed', booking.id)
    if (awardBookingCompletion) {
      try {
        await db().$transaction((tx) => awardBookingCompletion(tx, booking))
      } catch (error) {
        log.warn('loyalty_award_failed', { bookingId: booking.id, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return result.count
}

// Decision 6: a PAYMENT_PENDING request older than the country's unpaid-expiry window (Syria: 48h)
// with no pending/approved payment proof and no in-flight payment intent becomes CANCELLED with
// metadata.cancellationReason = 'EXPIRED_UNPAID'. Its dates stop blocking immediately (the overlap
// checks already ignore such bookings before this sweep runs -- see dateBlockingBookingWhere).
// Each row is cancelled by its own conditional update that re-checks the whole condition (status,
// age, no live proof/intent) inside the UPDATE, so a proof submitted between the scan and the update
// keeps the booking alive. Writes an audit row (actor = system) and emails the guest.
export async function expireUnpaidBookings(where = {}, { now = new Date(), limit = 200 } = {}) {
  const policy = bookingPolicySettings()
  const condition = expiredUnpaidBookingWhere(now, policy)
  const stale = await db().booking.findMany({
    where: { ...where, ...condition },
    select: { id: true, metadata: true, status: true, createdAt: true },
    take: limit,
  })
  let expired = 0
  for (const booking of stale) {
    const metadata = {
      ...(booking.metadata && typeof booking.metadata === 'object' ? booking.metadata : {}),
      cancellationReason: 'EXPIRED_UNPAID',
      expiredAt: now.toISOString(),
    }
    const updated = await db().booking.updateMany({
      where: { id: booking.id, ...condition },
      data: { status: 'CANCELLED', metadata },
    })
    if (updated.count !== 1) continue
    expired += 1
    await db().adminAuditLog.create({
      data: {
        actorUserId: null,
        action: 'BOOKING_EXPIRED_UNPAID',
        entityType: 'bookings',
        entityId: booking.id,
        before: booking,
        after: { status: 'CANCELLED', cancellationReason: 'EXPIRED_UNPAID', unpaidExpiryHours: policy.unpaidExpiryHours },
      },
    }).catch((error) => log.warn('booking_expiry_audit_failed', { bookingId: booking.id, message: error?.message }))
    notifyBooking('guest_request_expired', booking.id, { expiryHours: policy.unpaidExpiryHours })
  }
  if (expired) log.info('booking_unpaid_expired', { count: expired })
  return expired
}

export function payoutEligibleAt(checkOut) {
  if (!checkOut) return null
  return new Date(new Date(checkOut).getTime() + PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000)
}

export function isPayoutEligible(booking) {
  if (booking.status !== 'COMPLETED') return false
  const eligibleAt = payoutEligibleAt(booking.checkOut)
  if (!eligibleAt) return false
  return eligibleAt.getTime() <= Date.now()
}
