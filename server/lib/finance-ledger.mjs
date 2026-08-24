import { idempotencyKey } from './security.mjs'
import { isPayoutEligible, payoutEligibleAt } from './booking-lifecycle.mjs'

// The cancellation admin fee is charged against a guest/host wallet, and every wallet in this
// platform is created SYP-denominated (single-currency-per-country; see server/lib/country.mjs) —
// nothing ever funds a USD wallet. A USD-denominated fee here meant this DEBIT always targeted a
// fresh, always-zero USD wallet and (once the negative-balance guard was added) hard-failed every
// cancellation's refund transaction. Express the fee in SYP, converted from the original $10 intent
// via the same placeholder FX rate used for Stripe (SYP_PER_USD) so the real-money value is unchanged
// once a live rate is configured.
const CANCELLATION_ADMIN_FEE_USD_MINOR = 1000
export const CANCELLATION_ADMIN_FEE_CURRENCY = 'SYP'
export const CANCELLATION_ADMIN_FEE_MINOR = Math.round(
  (CANCELLATION_ADMIN_FEE_USD_MINOR / 100) * Number(process.env.SYP_PER_USD || 15000),
)

// A booking's currency is whatever its listing was priced in (SYP or USD, the only two the Syria
// country profile allows), and every wallet entry for that booking — refund, HOLD/RELEASE, admin
// share reversal — is denominated in it. The cancellation fee must match, or it targets a wallet
// the booking never touched: a USD-priced booking's guest has no SYP wallet activity, so debiting
// the always-hardcoded SYP fee there fails the negative-balance guard and rolls back the guest's
// entire (legitimate) refund along with it.
export function cancellationAdminFee(currency) {
  const normalized = String(currency || CANCELLATION_ADMIN_FEE_CURRENCY).toUpperCase()
  if (normalized === 'USD') {
    return { amountMinor: CANCELLATION_ADMIN_FEE_USD_MINOR, currency: 'USD' }
  }
  return { amountMinor: CANCELLATION_ADMIN_FEE_MINOR, currency: CANCELLATION_ADMIN_FEE_CURRENCY }
}
// Gifts at/above this real value require admin review before they can be claimed (server/routes/
// wallet.mjs). The threshold has to be expressed in whatever currency the gift was actually sent
// in — a flat "100000 minor units" cutoff meant a ~$1,000 USD gift auto-sent with no review while
// a few-dollar SYP gift already needed one, since SYP minor units are 1:1 (not cents) and USD
// minor units are cents.
const GIFT_REVIEW_THRESHOLD_SYP_MINOR = 100000
export function giftReviewThresholdMinor(currency) {
  const normalized = String(currency || CANCELLATION_ADMIN_FEE_CURRENCY).toUpperCase()
  if (normalized === 'USD') {
    return Math.round((GIFT_REVIEW_THRESHOLD_SYP_MINOR / Number(process.env.SYP_PER_USD || 15000)) * 100)
  }
  return GIFT_REVIEW_THRESHOLD_SYP_MINOR
}

export const CANCELLATION_PROTECTION_RATE = 0.03
// Contractual STR (STAYS/short-term-rental) platform commission — owner-confirmed at 12%.
export const STR_ADMIN_COMMISSION_RATE = 0.12
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
    // Owner-confirmed: RENTALS/BUY/CARS/MARKETPLACE/NEW_CONSTRUCTION intentionally charge 0%
    // booking commission — these divisions monetize via the separate seller-plan subscription fee
    // instead (server/routes/payments.mjs's 'seller_plan' provider), not a per-booking cut. Only
    // STR (STAYS) has a contractual per-booking commission (STR_ADMIN_COMMISSION_RATE, see below).
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
  // rentMinor/cleaningFeeMinor/taxesMinor come from seller-controlled listing.metadata (unvalidated)
  // and are informational only (the rent/cleaning/tax breakdown shown to admin/host). The actual
  // money split is always computed from staySplitBaseMinor — the real, server-trusted paid amount —
  // never from rentMinor. Deriving the commission from rentMinor let a host inflate it to drive
  // hostGrossMinor toward the paid-amount cap while adminShareMinor (the platform's cut) collapsed
  // toward zero; anchoring both to staySplitBaseMinor makes the commission unconditional.
  const adminCommissionMinor = Math.round(staySplitBaseMinor * STR_ADMIN_COMMISSION_RATE)
  const hostGrossMinor = Math.max(0, staySplitBaseMinor - adminCommissionMinor)
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

  const balanceDelta =
    type === 'CREDIT' || type === 'RELEASE' || type === 'REFUND'
      ? normalizedAmount
      : type === 'DEBIT'
        ? -normalizedAmount
        : 0

  if (balanceDelta < 0) {
    // Atomic, race-safe guard: the WHERE clause re-checks the balance at update time (not from a
    // stale read), so two concurrent debits against the same wallet can't both pass and jointly
    // overdraw it — mirrors the updateMany-guard pattern used elsewhere (e.g. approvePaymentProof).
    const guarded = await tx.wallet.updateMany({
      where: { id: wallet.id, cachedBalanceMinor: { gte: normalizedAmount } },
      data: { cachedBalanceMinor: { decrement: normalizedAmount } },
    })
    if (guarded.count === 0) {
      const error = new Error('Insufficient wallet balance for this debit.')
      error.statusCode = 409
      error.code = 'WALLET_INSUFFICIENT_FUNDS'
      error.expose = true
      throw error
    }
  } else if (balanceDelta > 0) {
    await tx.wallet.update({ where: { id: wallet.id }, data: { cachedBalanceMinor: { increment: balanceDelta } } })
  }

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
    // Platform revenue goes to a fixed house account (PLATFORM_ACCOUNT_ID) rather than the individual
    // admin who happened to approve — otherwise revenue fragments across operators' personal wallets.
    // Falls back to the actor only when no house account is configured (dev/e2e).
    const revenueAccount = process.env.PLATFORM_ACCOUNT_ID || actorUserId
    if (actorUserId) {
      await recordWalletEntry(tx, {
        userId: revenueAccount,
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
          userId: revenueAccount,
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
  } else if (proof.provider === 'seller_plan') {
    // No booking involved: this is a seller/dealer/developer plan payment. Approving it is
    // what actually unlocks paid-plan listing creation (CARS/MARKETPLACE/NEW_CONSTRUCTION),
    // replacing the old client-only "admin lane" buttons that never touched the database.
    await tx.sellerProfile.update({
      where: { userId: proof.userId },
      data: { documentStatus: 'APPROVED' },
    })
    // Grant the SELLER role here (authoritatively) rather than trusting the client to have set it at
    // registration — approving the plan is what actually entitles paid-plan listing.
    await tx.userRole.upsert({
      where: { userId_role: { userId: proof.userId, role: 'SELLER' } },
      update: {},
      create: { userId: proof.userId, role: 'SELLER' },
    })
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
