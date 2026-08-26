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

// Cancellation/refund reversal of the platform's own position on a booking: the admin-share
// CREDIT taken at approval time, plus a host payout clawback if it was already released. Does NOT
// touch the guest's wallet — callers that also owe the guest a refund (e.g. the admin
// dispute-rejection path) record that separately, since not every reversal implies a wallet refund
// (a card refund via a payment-provider webhook already returned the guest's money through the
// card network; crediting the wallet too would create money from nothing).
export async function reverseBookingPlatformShare(tx, {
  booking,
  approvedPayment,
  keyPrefix,
  adminShareReversalNote,
  payoutClawbackNote,
}) {
  const split = bookingFinanceSplit(booking, approvedPayment.amountMinor)
  const adminRecipientId = await originalAdminShareRecipient(tx, booking.id)

  await recordWalletEntry(tx, {
    userId: adminRecipientId,
    type: 'DEBIT',
    amountMinor: split.adminShareMinor,
    currency: booking.currency,
    referenceType: 'booking_admin_share_reversal',
    referenceId: booking.id,
    keyParts: [`${keyPrefix}-admin-share-reversal`, booking.id, approvedPayment.id],
    note: adminShareReversalNote,
  })

  // A HOLD entry never touches cachedBalanceMinor, so there's nothing to claw back from the host
  // if the payout was only held. But if it was already RELEASED, the host's wallet genuinely
  // holds that money now — without this, the host keeps the full payout while the platform's
  // share and (at the call site) the guest's money are both reversed, creating money out of nothing.
  const priorRelease = await tx.walletEntry.findFirst({
    where: { referenceType: 'booking_payout', type: 'RELEASE', referenceId: booking.id },
  })
  let hostClawedBack = false
  if (priorRelease) {
    await recordWalletEntry(tx, {
      userId: booking.listing.ownerId,
      type: 'DEBIT',
      amountMinor: split.hostGrossMinor,
      currency: booking.currency,
      referenceType: 'booking_payout_clawback',
      referenceId: booking.id,
      keyParts: [`${keyPrefix}-payout-clawback`, booking.id, approvedPayment.id],
      note: payoutClawbackNote,
    })
    hostClawedBack = true
  }

  return { split, adminRecipientId, hostClawedBack }
}

// Translates a DB unique-constraint violation on (provider, provider_ref) into a recognizable
// signal. This is what closes the TOCTOU race on payment-proof creation: even if two concurrent
// deliveries both pass an app-level "does a proof already exist" check, only one insert can win —
// the other raises P2002 here, which callers use to gracefully recover (re-fetch the winner)
// instead of surfacing a raw DB error. Shared by every payment rail that creates a PaymentProof
// (Stripe, local wallet, PaymentIntent) so they all recognize this race the same way.
export function isProviderRefUniqueViolation(err) {
  const target = err?.meta?.target
  return err?.code === 'P2002' && (target === 'payment_proofs_provider_provider_ref_key' ||
    (Array.isArray(target) && target.includes('provider_ref')) || String(target || '').includes('provider_ref'))
}

// Same P2002-recognition pattern, for the refunds_one_active_per_payment_proof partial unique
// index (Item 2 Phase 2a) -- a second, genuinely different refund request against a payment proof
// that already has an active (REQUESTED/IN_PROGRESS/ACTION_REQUIRED) refund hits this.
function isActiveRefundUniqueViolation(err) {
  const target = err?.meta?.target
  return err?.code === 'P2002' && (target === 'refunds_one_active_per_payment_proof' ||
    (Array.isArray(target) && target.includes('payment_proof_id')) || String(target || '').includes('payment_proof_id'))
}

// Mirrors the manual-family allowlist scripts/migrate-legacy-refunds-2a.mjs already uses for the
// exact same reasoning: these are the only providers with no external processor to canonicalize
// against, so the PaymentProof itself can stand in as the refunded object's identity.
const MANUAL_REFUND_PROVIDER_FAMILY = new Set(['manual', 'syrian_local_wallet', 'sham_cash'])

// The closed, code-level catalogue this refund-request layer accepts -- matches the approved
// design's REFUND_ELIGIBILITY_POLICY reason codes exactly. 'LEGACY_UNKNOWN' is deliberately absent:
// it is a migration-only historical value written once by the Phase 2a backfill for rows with no
// recoverable source route, and must never be reachable from a NEW refund request (Item 2 Phase 2b
// round 2, explicit owner instruction).
const NEW_REFUND_REASON_CODES = new Set(['GUEST_CANCELLED', 'HOST_CANCELLED', 'ADMIN_REJECTED_BOOKING', 'DISPUTE_RULING'])

// Item 2 Phase 2b round 2: creates a Refund + initial (non-legacy) RefundAttempt for a live
// host/guest/admin refund-triggering action, REPLACING the immediate wallet credit these three
// flows previously issued directly (owner-confirmed: fulfillment is deferred to a later phase that
// adds real outbound execution -- this function makes zero wallet entries and zero provider calls).
//
// Every field the caller supplies is what that flow ALREADY computed for its own refund amount
// (unchanged from before this round) -- this function does not re-derive eligibility, it only
// atomically reserves the given amount against the hard, unconditional payment_proofs.amount_minor
// cap (never a policy-dependent ceiling) and records the request.
//
// Idempotent by (proofId, reasonCode, amountMinor, currency): a genuine retry of the exact same
// logical request (e.g. a double-submit) returns the existing attempt, no new writes. A genuinely
// DIFFERENT request against a proof that already has an active refund is refused with
// DUPLICATE_REFUND_REQUEST -- refunds_one_active_per_payment_proof is the real, database-enforced
// authority; this function's own idempotency check is a convenience layer in front of it, not a
// substitute.
//
// The manual-rail canonical-request shape (provider='manual', providerPaymentObjectType=
// 'payment_proof', providerPaymentObjectId=paymentProofId) is deliberate: this codebase's manual/
// wallet rail has no external processor object to reference (no Stripe charge id, nothing) -- the
// PaymentProof record itself is the real, stable, always-present identity being refunded against.
// Card-rail proofs are NOT supported by this function -- PaymentProof.providerPaymentObjectType/Id
// are still null on every existing proof (no live code populates them yet; that is a distinct,
// separate change to finalizeStripeSession, out of this round's scope) -- callers must not invoke
// this for a card-family proof.
export async function createRefundRequest(tx, {
  paymentProofId,
  bookingId,
  requestedByUserId,
  amountMinor,
  currency,
  reason,
  reasonCode,
}) {
  if (!NEW_REFUND_REASON_CODES.has(reasonCode)) {
    throw new Error(`createRefundRequest: reasonCode '${reasonCode}' is not in the closed catalogue for new refund requests.`)
  }
  const normalizedAmount = Math.round(amountMinor || 0)
  if (!paymentProofId || !normalizedAmount || normalizedAmount <= 0) {
    throw new Error('createRefundRequest: paymentProofId and a positive amountMinor are required.')
  }

  // Defense in depth, not just caller convention: this function's canonical-request shape claims
  // provider='manual' -- refuse rather than silently mislabel a card-family proof (mirrors the
  // manual-family allowlist the Phase 2a classification script already uses, same reasoning: a
  // wrongly-typed match here would be worse than the pre-existing, already-flagged gap where
  // host.mjs/bookings.mjs credit the wallet for a card payment with no isCardPayment guard).
  const targetProof = await tx.paymentProof.findUnique({ where: { id: paymentProofId }, select: { provider: true } })
  if (!targetProof) {
    const error = new Error('Payment proof not found.')
    error.statusCode = 404
    error.code = 'PAYMENT_PROOF_NOT_FOUND'
    error.expose = true
    throw error
  }
  if (!MANUAL_REFUND_PROVIDER_FAMILY.has(targetProof.provider)) {
    const error = new Error(`createRefundRequest does not support provider '${targetProof.provider}' -- this refund needs a real provider-issued refund, not a wallet-rail request.`)
    error.statusCode = 400
    error.code = 'REFUND_PROVIDER_NOT_SUPPORTED'
    error.expose = true
    throw error
  }

  const provider = 'manual'
  const providerEndpointKey = 'sybnb-manual-review'
  const providerPaymentObjectType = 'payment_proof'
  const providerPaymentObjectId = paymentProofId
  const canonicalRequestVersion = 1

  const key = idempotencyKey(['refund-request', paymentProofId, reasonCode, String(normalizedAmount), currency])
  const existingAttempt = await tx.refundAttempt.findUnique({ where: { idempotencyKey: key }, include: { refund: true } })
  if (existingAttempt) {
    return { refund: existingAttempt.refund, attempt: existingAttempt, idempotent: true }
  }

  // Atomic, cumulative, database-enforced reservation -- checked in THIS single guarded statement,
  // never a separate pre-check: reserved + succeeded + accepted (the two other terminal buckets, so
  // a proof partially consumed by an earlier, now-terminal refund correctly has less headroom) plus
  // this new request must not exceed the proof's own amount_minor. 0 rows means insufficient
  // capacity -- refused before any Refund/RefundAttempt row is ever created.
  const reserved = await tx.$executeRaw`
    UPDATE payment_proofs
    SET reserved_refund_minor = reserved_refund_minor + ${normalizedAmount}
    WHERE id = ${paymentProofId}::uuid
      AND reserved_refund_minor + succeeded_refund_minor + accepted_refund_minor + ${normalizedAmount} <= amount_minor
  `
  if (reserved !== 1) {
    const error = new Error('This payment proof does not have enough remaining refundable capacity for this request.')
    error.statusCode = 409
    error.code = 'INSUFFICIENT_REFUND_CAPACITY'
    error.expose = true
    throw error
  }

  let refund
  try {
    refund = await tx.refund.create({
      data: {
        paymentProofId, bookingId, requestedByUserId, amountMinor: normalizedAmount, currency,
        reason, reasonCode, rail: 'manual_proof', status: 'IN_PROGRESS', reservationHeld: true,
        migratedFromLegacy: false,
      },
    })
  } catch (err) {
    if (isActiveRefundUniqueViolation(err)) {
      const error = new Error('A refund is already active for this payment proof.')
      error.statusCode = 409
      error.code = 'DUPLICATE_REFUND_REQUEST'
      error.expose = true
      throw error
    }
    throw err
  }

  const requestFingerprint = idempotencyKey([
    provider, providerPaymentObjectType, providerPaymentObjectId, providerEndpointKey,
    String(normalizedAmount), currency, String(canonicalRequestVersion),
  ])

  const attempt = await tx.refundAttempt.create({
    data: {
      refundId: refund.id, status: 'CLAIMED', migratedFromLegacy: false,
      canonicalRequestVersion, provider, providerPaymentObjectType, providerPaymentObjectId,
      providerEndpointKey, amountMinor: normalizedAmount, currency,
      idempotencyKey: key, requestFingerprint,
    },
  })

  return { refund, attempt, idempotent: false }
}

// Picks the actor for a system/webhook-driven auto-approval that has no human context.user — e.g.
// a Stripe or PaymentIntent webhook confirming a charge with nobody reviewing it in an admin tab.
export async function firstAdminId(tx) {
  const admin = await tx.userRole.findFirst({ where: { role: 'ADMIN' }, select: { userId: true } })
  return admin?.userId
}

// The full amount a guest owes for a booking: rent/stay plus cleaning fee, tax, extra fees, and
// the cancellation-protection add-on if purchased. Mirrors src/modules/bookings/guestFeeSummary.ts
// so every payment rail (Stripe, local wallet, PaymentIntent) charges the same figure the guest saw,
// and never trusts a client-supplied amount for a booking-linked payment.
export function expectedTotalMinor(booking) {
  const stayAmountMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const listingMetadata = booking.listing?.metadata || {}
  const bookingMetadata = booking.metadata || {}
  const isShortStay = !booking.listing || booking.listing.division === 'STAYS'

  const cleaningFeeMinor = metadataNumber(listingMetadata, 'cleaningFeeMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_CLEANING_RATE) : 0)
  const taxesMinor = metadataNumber(listingMetadata, 'taxesMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_TAX_RATE) : 0)
  const extraFeesMinor = metadataNumber(listingMetadata, 'extraFeesMinor')
  const cancellationProtectionPurchased = bookingMetadata.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(stayAmountMinor * CANCELLATION_PROTECTION_RATE)
    : 0

  return stayAmountMinor + cleaningFeeMinor + taxesMinor + extraFeesMinor + cancellationProtectionFeeMinor
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
