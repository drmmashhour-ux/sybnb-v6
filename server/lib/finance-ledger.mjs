import { idempotencyKey } from './security.mjs'
import { isPayoutEligible, payoutEligibleAt } from './booking-lifecycle.mjs'
import { rewardReferralIfQualifying } from './referrals.mjs'

export const CANCELLATION_ADMIN_FEE_MINOR = 1000
export const CANCELLATION_ADMIN_FEE_CURRENCY = 'USD'
export const CANCELLATION_PROTECTION_RATE = 0.03
export const STR_ADMIN_COMMISSION_RATE = 0.1
export const STR_CLEANING_RATE = 0.05
export const STR_TAX_RATE = 0.02

function metadataNumber(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// Mirrors the split the admin finance panel has always displayed (rentMinor / cleaningFeeMinor /
// taxesMinor / adminCommissionMinor / hostPayoutMinor) so the real wallet ledger finally matches
// what admin sees, instead of only pulling out taxes and an opt-in protection fee.
export function bookingFinanceSplit(booking, paidAmountMinor = booking?.amountMinor || 0) {
  const paidTotalMinor = Math.max(0, Math.round(paidAmountMinor || 0))
  const listing = booking?.listing
  const listingMetadata = listing?.metadata || {}
  const bookingMetadata = booking?.metadata || {}
  const isShortStay = !listing || listing.division === 'STAYS'

  const cancellationProtectionPurchased = bookingMetadata.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(Math.round(booking?.amountMinor || 0) * CANCELLATION_PROTECTION_RATE)
    : 0

  // The protection fee (if purchased) is a separate add-on charge, not part of the rent/cleaning/tax/commission split.
  const staySplitBaseMinor = Math.max(0, paidTotalMinor - cancellationProtectionFeeMinor)

  if (!isShortStay) {
    const stayAmountMinor = Math.max(0, Math.round(booking?.amountMinor || 0))
    const expectedExtraFeesMinor = metadataNumber(listingMetadata, 'extraFeesMinor')
    const extraFeesMinor = expectedExtraFeesMinor || Math.max(0, staySplitBaseMinor - stayAmountMinor)
    const hostGrossMinor = Math.min(staySplitBaseMinor, stayAmountMinor + extraFeesMinor)
    const adminShareMinor = Math.max(0, staySplitBaseMinor - hostGrossMinor)
    return {
      stayAmountMinor,
      cleaningFeeMinor: 0,
      taxesMinor: 0,
      adminCommissionMinor: 0,
      extraFeesMinor,
      cancellationProtectionFeeMinor,
      cancellationProtectionPurchased,
      hostGrossMinor,
      adminShareMinor,
      paidTotalMinor,
    }
  }

  const divisor = 1 + STR_CLEANING_RATE + STR_TAX_RATE
  const rentMinor = metadataNumber(listingMetadata, 'rentMinor') || Math.round(staySplitBaseMinor / divisor)
  const cleaningFeeMinor = metadataNumber(listingMetadata, 'cleaningFeeMinor') || Math.round(rentMinor * STR_CLEANING_RATE)
  const taxesMinor = metadataNumber(listingMetadata, 'taxesMinor') || Math.max(0, staySplitBaseMinor - rentMinor - cleaningFeeMinor)
  const adminCommissionMinor = Math.round(rentMinor * STR_ADMIN_COMMISSION_RATE)
  const hostGrossMinor = Math.max(0, rentMinor + cleaningFeeMinor - adminCommissionMinor)
  const adminShareMinor = Math.max(0, staySplitBaseMinor - hostGrossMinor)

  return {
    stayAmountMinor: rentMinor,
    cleaningFeeMinor,
    taxesMinor,
    adminCommissionMinor,
    extraFeesMinor: 0,
    cancellationProtectionFeeMinor,
    cancellationProtectionPurchased,
    hostGrossMinor,
    adminShareMinor,
    paidTotalMinor,
  }
}

export async function recordWalletEntry(tx, {
  userId,
  type,
  amountMinor,
  currency,
  referenceType,
  referenceId,
  keyParts,
  note,
}) {
  const normalizedAmount = Math.max(0, Math.round(amountMinor || 0))
  if (!userId || !normalizedAmount) return null

  const key = idempotencyKey(keyParts)
  const existing = await tx.walletEntry.findUnique({ where: { idempotencyKey: key } })
  if (existing) return existing

  const wallet = await tx.wallet.upsert({
    where: { userId_currency: { userId, currency } },
    create: { userId, currency, cachedBalanceMinor: 0 },
    update: {},
  })

  const entry = await tx.walletEntry.create({
    data: {
      walletId: wallet.id,
      type,
      amountMinor: normalizedAmount,
      currency,
      referenceType,
      referenceId,
      idempotencyKey: key,
      note,
    },
  })

  const balanceDelta =
    type === 'CREDIT' || type === 'RELEASE' || type === 'REFUND'
      ? normalizedAmount
      : type === 'DEBIT'
        ? -normalizedAmount
        : 0

  if (balanceDelta) {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { cachedBalanceMinor: { increment: balanceDelta } },
    })
  }

  return entry
}

// Shared by the admin manual-review path and any automatic payment confirmation (e.g. Stripe)
// so both move a payment proof to APPROVED and progress the booking the exact same way.
export async function approvePaymentProof(tx, { proofId, actorUserId, note }) {
  const existing = await tx.paymentProof.findUnique({
    where: { id: proofId },
    include: { booking: { include: { listing: true } } },
  })
  if (!existing || existing.status !== 'PENDING_ADMIN_REVIEW') {
    const error = new Error('This payment proof is not awaiting review.')
    error.statusCode = 409
    error.code = 'PAYMENT_NOT_REVIEWABLE'
    error.expose = true
    throw error
  }

  // Re-check status in the WHERE clause: two concurrent approvals of the same proof (two admin
  // tabs, or an admin racing Stripe's own auto-approval) would otherwise both pass the read-check
  // above under READ COMMITTED and both apply their side effects (duplicate wallet HOLD/CREDIT
  // entries, a booking confirmed twice). The second transaction's updateMany blocks on the row
  // lock until the first commits, then matches zero rows here instead.
  const claimResult = await tx.paymentProof.updateMany({
    where: { id: proofId, status: 'PENDING_ADMIN_REVIEW' },
    data: {
      status: 'APPROVED',
      reviewedById: actorUserId || undefined,
      reviewedAt: new Date(),
      adminNote: note || undefined,
    },
  })
  if (claimResult.count === 0) {
    const error = new Error('This payment proof was already reviewed by another action.')
    error.statusCode = 409
    error.code = 'PAYMENT_REVIEW_CONFLICT'
    error.expose = true
    throw error
  }

  const proof = await tx.paymentProof.findUnique({ where: { id: proofId } })

  if (proof.bookingId) {
    // Instant Book listings skip the manual host-confirmation step: payment approval
    // is enough to confirm the stay outright, same as Airbnb's Instant Book.
    const nextStatus = existing.booking?.listing?.instantBookEnabled ? 'CONFIRMED' : 'REQUESTED'
    await tx.booking.update({
      where: { id: proof.bookingId },
      data: { status: nextStatus },
    })

    const split = bookingFinanceSplit(existing.booking, proof.amountMinor)
    await recordWalletEntry(tx, {
      userId: existing.booking?.listing?.ownerId,
      type: 'HOLD',
      amountMinor: split.hostGrossMinor,
      currency: proof.currency,
      referenceType: 'booking_payout',
      referenceId: proof.bookingId,
      keyParts: ['booking-host-hold', proof.bookingId, proof.id],
      note: 'Host payout is protected until booking confirmation and completion.',
    })
    if (actorUserId) {
      await recordWalletEntry(tx, {
        userId: actorUserId,
        type: 'CREDIT',
        amountMinor: split.adminShareMinor,
        currency: proof.currency,
        referenceType: 'booking_admin_share',
        referenceId: proof.bookingId,
        keyParts: ['booking-admin-share', proof.bookingId, proof.id, actorUserId],
        note: 'SYBNB/admin share collected after verified guest payment.',
      })
      // The cancellation-protection fee (if purchased) is excluded from staySplitBaseMinor above,
      // so it never flows into adminShareMinor — record it as its own revenue entry here instead of
      // letting it silently vanish from the ledger. It's a non-refundable protection premium, so
      // unlike adminShareMinor it is never reversed on cancellation (see bookings.mjs/host.mjs).
      if (split.cancellationProtectionPurchased && split.cancellationProtectionFeeMinor > 0) {
        await recordWalletEntry(tx, {
          userId: actorUserId,
          type: 'CREDIT',
          amountMinor: split.cancellationProtectionFeeMinor,
          currency: proof.currency,
          referenceType: 'booking_protection_fee',
          referenceId: proof.bookingId,
          keyParts: ['booking-protection-fee', proof.bookingId, proof.id, actorUserId],
          note: 'SYBNB/admin collected the non-refundable cancellation-protection fee.',
        })
      }
    }

    // Referral reward (double-sided referral program, server/lib/referrals.mjs): only pays the
    // referrer once this guest's first-ever approved payment lands, so a referral can't be
    // farmed with a signup that never generates real revenue. No-ops instantly if this guest was
    // never referred, already rewarded their referrer, or this isn't their first approved payment.
    await rewardReferralIfQualifying(tx, { guestUserId: proof.userId, qualifyingReferenceId: proof.bookingId })
  } else if (proof.provider === 'seller_plan') {
    // No booking involved: this is a seller/dealer/developer plan payment. Approving it is
    // what actually unlocks paid-plan listing creation (CARS/MARKETPLACE/NEW_CONSTRUCTION),
    // replacing the old client-only "admin lane" buttons that never touched the database.
    await tx.sellerProfile.update({
      where: { userId: proof.userId },
      data: { documentStatus: 'APPROVED' },
    })
    // The full plan fee is 100% platform revenue (there's no host/counterparty to split with,
    // unlike a booking) — previously this approval never recorded any wallet entry at all, so
    // real, collected seller-plan revenue was invisible everywhere: admin finance totals, the
    // income projection, all of it. Recorded the same way booking commission is: a CREDIT to the
    // approving admin's own wallet, which is what the revenue-summary rollup reads from.
    if (actorUserId) {
      await recordWalletEntry(tx, {
        userId: actorUserId,
        type: 'CREDIT',
        amountMinor: proof.amountMinor,
        currency: proof.currency,
        referenceType: 'seller_plan_fee',
        referenceId: proof.id,
        keyParts: ['seller-plan-fee', proof.id, actorUserId],
        note: 'SYBNB/admin collected a seller/dealer/developer plan fee.',
      })
    }

    // A referee who converts as a paying seller/dealer/developer is exactly as real a referral
    // outcome as one who converts as a paying guest -- see the booking branch above for the full
    // farming-prevention rationale, identical here.
    await rewardReferralIfQualifying(tx, { guestUserId: proof.userId, qualifyingReferenceId: proof.id })
  }

  return proof
}

// Cancellation/refund reversals used to re-derive "which admin to reverse" from
// PaymentProof.reviewedById, which can be null or simply not the account that was actually
// credited (e.g. it's set independently of the wallet entry). That let a refund silently skip
// reversing the platform's commission share. This looks up the real 'booking_admin_share' CREDIT
// entry that approvePaymentProof() created and reverses against its actual wallet owner — if no
// such entry exists, there's genuinely nothing to reverse (no admin existed at approval time).
export async function originalAdminShareRecipient(tx, bookingId) {
  const entry = await tx.walletEntry.findFirst({
    where: { referenceType: 'booking_admin_share', referenceId: bookingId, type: 'CREDIT' },
    include: { wallet: true },
  })
  return entry?.wallet?.userId
}

// Shared by admin's payout queue and the host earnings report so both read the same numbers
// instead of two independent computations that could silently drift apart.
export function buildPayoutRow(booking, releasedBookingIds) {
  const approvedPayment = booking.payments?.find((payment) => payment.status === 'APPROVED')
  const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)
  const released = releasedBookingIds.has(booking.id)

  return {
    bookingId: booking.id,
    listingTitle: booking.listing?.titleAr,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    status: booking.status,
    hostGrossMinor: split.hostGrossMinor,
    adminCommissionMinor: split.adminCommissionMinor,
    cleaningFeeMinor: split.cleaningFeeMinor,
    taxesMinor: split.taxesMinor,
    currency: booking.currency,
    payoutStatus: released ? 'RELEASED' : isPayoutEligible(booking) ? 'ELIGIBLE' : 'PENDING_HOLD',
    eligibleAt: booking.status === 'COMPLETED' ? payoutEligibleAt(booking.checkOut) : null,
  }
}
