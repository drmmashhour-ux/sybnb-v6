import { idempotencyKey } from './security.mjs'
import { isPayoutEligible, payoutEligibleAt } from './booking-lifecycle.mjs'
import {
  PROTECTION_RATE,
  STR_COMMISSION_RATE,
  SR_RIDE_COMMISSION_RATE,
  STR_CLEANING_RATE as POLICY_STR_CLEANING_RATE,
  STR_TAX_RATE as POLICY_STR_TAX_RATE,
  cancellationLedgerDeltas,
  computeGuestTotals,
  payoutAvailability,
} from './booking-policy.mjs'

// The cancellation admin fee is charged against a guest/host wallet, and every wallet in this
// platform is created SYP-denominated (single-currency-per-country; see server/lib/country.mjs) —
// nothing ever funds a USD wallet. A USD-denominated fee here meant this DEBIT always targeted a
// fresh, always-zero USD wallet and (once the negative-balance guard was added) hard-failed every
// cancellation's refund transaction. Express the fee in SYP, converted from the original $10 intent
// via the same placeholder FX rate used for Stripe (SYP_PER_USD) so the real-money value is unchanged
// once a live rate is configured.
const CANCELLATION_ADMIN_FEE_USD_MINOR = 1000

// Owner-set starting rate (2026-08-29), deliberately a variable/updatable value, not a fixed fact:
// read fresh from env everywhere a conversion is needed, never baked into a module-load-time
// constant, so changing SYP_PER_USD takes effect without a code change. Falls back to this default
// only when the env var is unset or not a valid positive number.
export function sypPerUsd(env = process.env) {
  const value = Number(env.SYP_PER_USD)
  return Number.isFinite(value) && value > 0 ? value : 130
}

export const CANCELLATION_ADMIN_FEE_CURRENCY = 'SYP'
export function cancellationAdminFeeMinor(env = process.env) {
  return Math.round((CANCELLATION_ADMIN_FEE_USD_MINOR / 100) * sypPerUsd(env))
}

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
  return { amountMinor: cancellationAdminFeeMinor(), currency: CANCELLATION_ADMIN_FEE_CURRENCY }
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
    return Math.round((GIFT_REVIEW_THRESHOLD_SYP_MINOR / sypPerUsd()) * 100)
  }
  return GIFT_REVIEW_THRESHOLD_SYP_MINOR
}

// Single source of truth for these rates is server/lib/booking-policy.mjs (pure, unit-tested);
// re-exported here under their historical names so existing importers keep working unchanged.
export const CANCELLATION_PROTECTION_RATE = PROTECTION_RATE
// Contractual STR (STAYS/short-term-rental) platform commission — owner-confirmed at 12%.
export const STR_ADMIN_COMMISSION_RATE = STR_COMMISSION_RATE
export const STR_CLEANING_RATE = POLICY_STR_CLEANING_RATE
export const STR_TAX_RATE = POLICY_STR_TAX_RATE

function metadataNumber(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// STAYS itemized fees a host can set on a listing (server/routes/host.mjs's PATCH already merges
// listing.metadata safely; this just gives 4 named keys real meaning instead of only cleaning/tax).
// Each is read independently via metadataNumber, so a bad/missing value drops to 0 rather than
// corrupting the total -- never a source of the actual charge, only informational line items (see
// the anti-fraud comment on adminCommissionMinor below for why the real split never reads these).
export function readListingFees(listingMetadata) {
  return {
    cleaningFeeMinor: metadataNumber(listingMetadata, 'cleaningFeeMinor'),
    taxesMinor: metadataNumber(listingMetadata, 'taxesMinor'),
    serviceFeeMinor: metadataNumber(listingMetadata, 'serviceFeeMinor'),
    parkingFeeMinor: metadataNumber(listingMetadata, 'parkingFeeMinor'),
  }
}

function hasExplicitListingFees(listingMetadata) {
  return Boolean(
    listingMetadata &&
      ('cleaningFeeMinor' in listingMetadata ||
        'taxesMinor' in listingMetadata ||
        'serviceFeeMinor' in listingMetadata ||
        'parkingFeeMinor' in listingMetadata),
  )
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
      serviceFeeMinor: 0,
      parkingFeeMinor: 0,
      adminCommissionMinor: 0,
      extraFeesMinor,
      cancellationProtectionFeeMinor,
      cancellationProtectionPurchased,
      hostGrossMinor,
      adminShareMinor,
      paidTotalMinor,
    }
  }

  // A snapshot taken at booking-creation time (see buildBookingMetadata in bookings.mjs) always
  // wins over the listing's CURRENT metadata: without this, a host or admin editing a listing's
  // fees after a booking already exists would silently change what that older booking's breakdown
  // displays (payout screens, refund/cancellation views, admin ledger) even though the actual
  // dollar split stays safe either way (adminCommissionMinor is anchored to staySplitBaseMinor,
  // never to these labels). Pre-snapshot bookings (created before this existed) have no
  // bookingMetadata.feeSnapshot and fall through to reading the listing's live metadata, same as
  // before.
  const feeSnapshot = bookingMetadata.feeSnapshot
  const explicitFees = feeSnapshot || (hasExplicitListingFees(listingMetadata) ? readListingFees(listingMetadata) : null)

  let rentMinor, cleaningFeeMinor, taxesMinor, serviceFeeMinor, parkingFeeMinor
  if (explicitFees) {
    // Host/admin set at least one explicit fee: rent is whatever's left of the real paid amount
    // after those fees, matching the additive total expectedTotalMinor charged the guest in the
    // first place (stay + cleaning + tax + service + parking), never re-derived from a percentage.
    cleaningFeeMinor = metadataNumber(explicitFees, 'cleaningFeeMinor')
    taxesMinor = metadataNumber(explicitFees, 'taxesMinor')
    serviceFeeMinor = metadataNumber(explicitFees, 'serviceFeeMinor')
    parkingFeeMinor = metadataNumber(explicitFees, 'parkingFeeMinor')
    const explicitFeesTotalMinor = cleaningFeeMinor + taxesMinor + serviceFeeMinor + parkingFeeMinor
    rentMinor = Math.max(0, staySplitBaseMinor - explicitFeesTotalMinor)
  } else {
    // No explicit fees ever set on this listing -- original fixed-percentage decomposition,
    // unchanged, so every pre-existing listing behaves exactly as it did before this feature.
    const divisor = 1 + STR_CLEANING_RATE + STR_TAX_RATE
    rentMinor = metadataNumber(listingMetadata, 'rentMinor') || Math.round(staySplitBaseMinor / divisor)
    cleaningFeeMinor = Math.round(rentMinor * STR_CLEANING_RATE)
    taxesMinor = Math.max(0, staySplitBaseMinor - rentMinor - cleaningFeeMinor)
    serviceFeeMinor = 0
    parkingFeeMinor = 0
  }
  // rentMinor/cleaningFeeMinor/taxesMinor/serviceFeeMinor/parkingFeeMinor are informational only
  // (the itemized breakdown shown to admin/host/guest). The actual money split is always computed
  // from staySplitBaseMinor — the real, server-trusted paid amount — never from these labels.
  // Deriving the commission from the itemized rent let a host inflate non-rent line items to drive
  // hostGrossMinor toward the paid-amount cap while adminShareMinor (the platform's cut) collapsed
  // toward zero; anchoring both to staySplitBaseMinor makes the commission unconditional, no matter
  // how a host chooses to itemize fees.
  const adminCommissionMinor = Math.round(staySplitBaseMinor * STR_ADMIN_COMMISSION_RATE)
  const hostGrossMinor = Math.max(0, staySplitBaseMinor - adminCommissionMinor)
  const adminShareMinor = Math.max(0, staySplitBaseMinor - hostGrossMinor)

  return {
    stayAmountMinor: rentMinor,
    cleaningFeeMinor,
    taxesMinor,
    serviceFeeMinor,
    parkingFeeMinor,
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
  // #191 (2026-10-10): opt-in, default false — every existing caller keeps the strict no-overdraw
  // guarantee untouched. Only the CASH ride-commission debit (approvePaymentProof's cash branch)
  // passes true: a driver who collected the full fare in cash owes the platform its commission, and
  // that debt is represented as a negative driver-wallet balance (cleared by future card-ride net
  // credits or a top-up). A pure-cash driver legitimately has nothing to debit against, so the
  // strict guard would otherwise make the commission uncollectable. No other flow may go negative.
  allowNegative = false,
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

  if (balanceDelta < 0 && allowNegative) {
    // #191: the cash ride-commission debt. Intentionally NOT balance-guarded: the driver's wallet is
    // allowed to go negative because the negative balance IS the commission they owe on cash they
    // already collected. Still idempotent (the walletEntry idempotencyKey below is the real guard
    // against a double debit), so a re-approval can't double the debt.
    await tx.wallet.update({ where: { id: wallet.id }, data: { cachedBalanceMinor: { decrement: normalizedAmount } } })
  } else if (balanceDelta < 0) {
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

  try {
    return await tx.walletEntry.create({
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
  } catch (err) {
    if (isWalletEntryIdempotencyViolation(err)) {
      // Item 2 Phase 2b round 3: the findUnique check above is NOT atomic with this create -- two
      // genuinely concurrent callers with the SAME idempotencyKey (e.g. two simultaneous admin
      // finalize-cancellation calls for the same booking) can both pass it before either commits,
      // then race here. Re-throwing a well-typed, recognizable error (rather than letting the raw
      // P2002 propagate as an unhandled 500) lets a caller treat the loser exactly like a genuine
      // idempotent retry -- the balance mutation this losing transaction made above is safely
      // rolled back with the rest of it, since throwing here aborts the whole $transaction; the
      // winner's already-committed entry is the only one that ever takes effect.
      const error = new Error('This wallet entry was already recorded by a concurrent request.')
      error.statusCode = 409
      error.code = 'WALLET_ENTRY_RACE_LOST'
      error.idempotencyKey = key
      error.expose = true
      throw error
    }
    throw err
  }
}

// Same P2002-recognition pattern as isProviderRefUniqueViolation/isActiveRefundUniqueViolation,
// for wallet_entries_idempotency_key_key.
function isWalletEntryIdempotencyViolation(err) {
  const target = err?.meta?.target
  return err?.code === 'P2002' && (target === 'wallet_entries_idempotency_key_key' ||
    (Array.isArray(target) && target.includes('idempotency_key')) || String(target || '').includes('idempotency_key'))
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

  // Money-flow decision 6 (2026-10-08): an unpaid request can now be CANCELLED by the expiry sweep
  // (EXPIRED_UNPAID) or by the guest while unpaid, releasing its dates to other guests. Approving a
  // proof that reached such a booking (submitted in the instant before the sweep, or by a stale tab)
  // would silently resurrect it to REQUESTED/CONFIRMED over dates that may already be re-booked.
  // Refuse instead; the admin rejects the proof and settles the guest's transfer manually.
  if (existing.booking && existing.booking.status === 'CANCELLED') {
    const error = new Error('This payment proof belongs to a cancelled booking and cannot be approved; reject it and settle the transfer manually.')
    error.statusCode = 409
    error.code = 'BOOKING_CANCELLED'
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
    // Review fix (LOW): only an unpaid booking can be moved forward by a payment. Conditional on
    // PAYMENT_PENDING in the UPDATE itself, so a guest cancel / expiry sweep / second proof that
    // landed after the read above cannot be overwritten (and no second HOLD/commission is posted);
    // the throw rolls the proof approval back with it.
    const advanced = await tx.booking.updateMany({
      where: { id: proof.bookingId, status: 'PAYMENT_PENDING' },
      data: { status: nextStatus },
    })
    if (advanced.count !== 1) {
      const error = new Error('This booking is no longer awaiting payment (it was cancelled, expired, or already paid).')
      error.statusCode = 409
      error.code = 'BOOKING_STATE_CHANGED'
      error.expose = true
      throw error
    }

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
    //
    // SEC-002 exception, deliberate: this is the ONE role mutation in the codebase that does NOT go
    // through applyRoleChange() in server/lib/session-store.mjs, so it does not revoke the seller's
    // sessions. Two reasons. It is grant-only, so the security invariant SEC-002 exists to protect
    // ("removing a role takes effect immediately") is untouched -- authority is being added to an
    // account that just paid for it and was approved by an admin, not silently escalated. And
    // revoking here would sign the seller out at the exact moment their payment is approved, mid
    // listing flow, which would be a real product regression introduced as a side effect of a
    // security patch. The new role is picked up by their existing session on its very next request,
    // because getAuthContext() reads roles live from the DB per request and no longer caches them.
    // Any future path that REMOVES a role must use applyRoleChange().
    await tx.userRole.upsert({
      where: { userId_role: { userId: proof.userId, role: 'SELLER' } },
      update: {},
      create: { userId: proof.userId, role: 'SELLER' },
    })
    // The full plan fee is 100% platform revenue (there's no host/counterparty to split with,
    // unlike a booking) -- this approval previously recorded no wallet entry at all, so real,
    // already-collected seller-plan revenue -- the entire monetization model for the 0%-commission
    // divisions (CARS/MARKETPLACE/NEW_CONSTRUCTION) -- was invisible everywhere a WalletEntry is
    // the source of truth: admin finance totals, income projections, payout rows. Recorded the
    // same way booking commission is. This is 100% platform revenue, so it routes to the fixed
    // house account (PLATFORM_ACCOUNT_ID) exactly like the booking admin-share above — otherwise the
    // entire monetization of the 0%-commission divisions (CARS/MARKETPLACE/NEW_CONSTRUCTION) would
    // fragment across individual operators' personal wallets. Falls back to the actor only when no
    // house account is configured (dev/e2e).
    if (actorUserId) {
      await recordWalletEntry(tx, {
        userId: process.env.PLATFORM_ACCOUNT_ID || actorUserId,
        type: 'CREDIT',
        amountMinor: proof.amountMinor,
        currency: proof.currency,
        referenceType: 'seller_plan_fee',
        referenceId: proof.id,
        keyParts: ['seller-plan-fee', proof.id, actorUserId],
        note: 'SYBNB/admin collected a seller/dealer/developer plan fee.',
      })
    }
  } else if (proof.rideId) {
    // SR Ride vs. Uber gap-closure: no booking-style HOLD/release two-step -- a ride completes in
    // one continuous session (unlike a multi-day stay), so there's no equivalent dispute window to
    // hold funds against. The fare is split at approval time, mirroring Uber's standard model:
    // SYBNB keeps SR_RIDE_COMMISSION_RATE (owner decision 2026-10-10: 15%, matching Syrian ride
    // fee) and the driver receives the rest. A CANCELLED-with-a-fee ride takes NO commission -- the
    // cancellation fee compensates the driver for a committed trip, so it stays 100% with them.
    const ride = await tx.rideRequest.findUnique({ where: { id: proof.rideId }, select: { driverId: true, status: true } })
    const isTipProof = String(proof.provider || '').startsWith('tip')
    if (isTipProof) {
      // Tipping (SR vs. Uber parity, 2026-10-10): a tip is 100% the driver's, with NO commission.
      // A CASH tip ('tip_cash') is already physically in the driver's hand (off-ledger), so nothing
      // is booked for it; a wallet/card tip is credited to the driver in full here. The idempotency
      // key is pinned to the proof, so re-approving the same tip proof never double-credits.
      if (ride?.driverId && proof.provider !== 'tip_cash') {
        await recordWalletEntry(tx, {
          userId: ride.driverId,
          type: 'CREDIT',
          amountMinor: Math.round(proof.amountMinor || 0),
          currency: proof.currency,
          referenceType: 'ride_tip',
          referenceId: proof.rideId,
          keyParts: ['ride-tip', proof.rideId, proof.id],
          note: 'Rider tip, paid in full to the driver (no commission).',
        })
      }
    } else if (ride?.driverId) {
      // A ride is either COMPLETED (this is the fare) or CANCELLED-with-a-fee (this is the
      // cancellation fee, capsule 20) -- never both, so the ride's own status at approval time is
      // enough to label the ledger entry correctly for finance reconciliation.
      const isCancellationFee = ride.status === 'CANCELLED'
      const fareMinor = Math.round(proof.amountMinor || 0)
      // Commission applies to fares only, never to a cancellation fee.
      const commissionMinor = isCancellationFee
        ? 0
        : Math.round(fareMinor * SR_RIDE_COMMISSION_RATE)

      if (proof.provider === 'cash') {
        // #191 (2026-10-10): CASH / paid-to-driver. The rider handed the driver the full fare in cash
        // (off-ledger), so the driver is NEVER credited the fare here — that would double-pay them.
        // The platform is owed only its commission, so we DEBIT it from the driver (their wallet may
        // go negative: that negative balance IS the driver's commission debt, cleared by future
        // card-ride net credits or a top-up) and CREDIT the same amount to the house account. A cash
        // cancellation fee carries no commission, so nothing moves and the driver keeps the whole fee.
        // Net economics match a card ride exactly: card -> wallet +(fare-commission); cash -> wallet
        // -commission while holding `fare` in cash -> both leave the driver with fare-commission.
        const commissionRecipient = process.env.PLATFORM_ACCOUNT_ID || null
        if (commissionMinor > 0) {
          await recordWalletEntry(tx, {
            userId: ride.driverId,
            type: 'DEBIT',
            amountMinor: commissionMinor,
            currency: proof.currency,
            referenceType: 'ride_commission',
            referenceId: proof.rideId,
            keyParts: ['ride-commission-cash-driver', proof.rideId, proof.id],
            note: `SYBNB ride commission (${Math.round(SR_RIDE_COMMISSION_RATE * 100)}%) owed on a cash ride, debited from the driver who collected the full fare in cash.`,
            allowNegative: true,
          })
          // Counterpart credit to the house account, so platform revenue still pools in one place.
          // Skipped only when no house account is configured (dev/e2e) or it would be the driver.
          if (commissionRecipient && commissionRecipient !== ride.driverId) {
            await recordWalletEntry(tx, {
              userId: commissionRecipient,
              type: 'CREDIT',
              amountMinor: commissionMinor,
              currency: proof.currency,
              referenceType: 'ride_commission',
              referenceId: proof.rideId,
              keyParts: ['ride-commission-cash-platform', proof.rideId, proof.id],
              note: 'SYBNB ride commission collected on a cash ride (counterpart to the driver debit).',
            })
          }
        }
      } else {
        const driverMinor = fareMinor - commissionMinor
        await recordWalletEntry(tx, {
          userId: ride.driverId,
          type: 'CREDIT',
          amountMinor: driverMinor,
          currency: proof.currency,
          referenceType: isCancellationFee ? 'ride_cancellation_fee' : 'ride_fare',
          referenceId: proof.rideId,
          keyParts: [isCancellationFee ? 'ride-cancellation-fee' : 'ride-fare', proof.rideId, proof.id],
          note: isCancellationFee
            ? 'Driver cancellation fee collected after verified rider payment proof (no commission).'
            : `Driver fare net of the ${Math.round(SR_RIDE_COMMISSION_RATE * 100)}% SYBNB ride commission, collected after verified rider payment proof.`,
        })
        // The platform's ride commission -- routed to the fixed house account (PLATFORM_ACCOUNT_ID),
        // exactly like the booking admin-share and seller-plan fee above, so all platform revenue
        // pools in one place rather than fragmenting across operators' personal wallets. Falls back
        // to the approving admin ONLY when no house account is configured (dev/e2e). Revenue-integrity
        // fix (2026-10-09): recording no longer depends on `actorUserId` being truthy -- the commission
        // is recorded whenever there is any recipient to credit, so a future system/automated approval
        // (no actor) with PLATFORM_ACCOUNT_ID set still books the revenue instead of silently paying
        // the driver the net and losing the commission off-ledger. The idempotency key is pinned by proof.id
        // alone (not the actor), so the same proof can never be credited twice by a different actor.
        const commissionRecipient = process.env.PLATFORM_ACCOUNT_ID || actorUserId
        if (commissionMinor > 0 && commissionRecipient) {
          await recordWalletEntry(tx, {
            userId: commissionRecipient,
            type: 'CREDIT',
            amountMinor: commissionMinor,
            currency: proof.currency,
            referenceType: 'ride_commission',
            referenceId: proof.rideId,
            keyParts: ['ride-commission', proof.rideId, proof.id],
            note: 'SYBNB ride commission collected after verified rider payment.',
          })
        }
      }
    }
  } else if (proof.planCode === 'wallet_topup') {
    // Rider wallet top-up (2026-10-09): approving a top-up proof credits the rider's own SYBNB
    // wallet, so they can pre-fund rides (SR prepayment). 100% to the rider — no counterparty,
    // no commission. Idempotent by proof id.
    await recordWalletEntry(tx, {
      userId: proof.userId,
      type: 'CREDIT',
      amountMinor: proof.amountMinor,
      currency: proof.currency,
      referenceType: 'wallet_topup',
      referenceId: proof.id,
      keyParts: ['wallet-topup', proof.id],
      note: 'Rider wallet top-up credited after verified payment.',
    })
  }

  return proof
}

// SR prepaid-ride settlement (2026-10-09). A prepaid ride already DEBITed the rider's wallet at
// request time (referenceType 'ride_prepayment'), so the platform holds the fare. On completion this
// pays it out: the driver receives the fare net of the SR commission, and the platform keeps the
// commission — the exact same split as a proof-approved ride, just funded from the prepayment
// instead of a post-ride proof. Idempotent by ride id, so a re-run of the completion sweep is safe.
export async function settlePrepaidRide(tx, { ride }) {
  const fareMinor = Math.round(ride.fareMinor || 0)
  if (!ride.driverId || fareMinor <= 0) return { settled: false }
  const commissionMinor = Math.round(fareMinor * SR_RIDE_COMMISSION_RATE)
  const driverMinor = fareMinor - commissionMinor
  await recordWalletEntry(tx, {
    userId: ride.driverId,
    type: 'CREDIT',
    amountMinor: driverMinor,
    currency: ride.currency,
    referenceType: 'ride_fare',
    referenceId: ride.id,
    keyParts: ['ride-fare-prepaid', ride.id],
    note: `Driver fare net of the ${Math.round(SR_RIDE_COMMISSION_RATE * 100)}% SYBNB ride commission, settled from the rider's prepayment.`,
  })
  // The commission goes to the house account ONLY. Unlike the proof-approval path (where the actor
  // is an admin, a safe third-party fallback), a prepaid ride is completed by the DRIVER, so there
  // is no safe actor fallback — crediting the actor would pay the commission to the counterparty.
  // If PLATFORM_ACCOUNT_ID is unset (dev/e2e), the commission is simply not booked to anyone and the
  // driver still receives only their net; it is never paid to the driver. Production sets the var
  // (see the boot guard in server/index.mjs), where it is captured correctly.
  const commissionRecipient = process.env.PLATFORM_ACCOUNT_ID || null
  if (commissionMinor > 0 && commissionRecipient && commissionRecipient !== ride.driverId) {
    await recordWalletEntry(tx, {
      userId: commissionRecipient,
      type: 'CREDIT',
      amountMinor: commissionMinor,
      currency: ride.currency,
      referenceType: 'ride_commission',
      referenceId: ride.id,
      keyParts: ['ride-commission-prepaid', ride.id],
      note: 'SYBNB ride commission settled from the rider prepayment.',
    })
  }
  return { settled: true, driverMinor, commissionMinor }
}

// Refund a prepaid ride that was cancelled before completion. The rider gets their prepayment back,
// minus any cancellation fee that was assessed; if a fee was assessed it goes to the driver (who
// committed to the trip). Idempotent by ride id.
export async function refundPrepaidRide(tx, { ride }) {
  const prepaidMinor = Math.round((ride.metadata && ride.metadata.prepaidAmountMinor) || 0)
  if (prepaidMinor <= 0) return { refunded: false }
  const feeMinor = Math.min(prepaidMinor, Math.max(0, Math.round(ride.cancellationFeeMinor || 0)))
  const riderRefundMinor = prepaidMinor - feeMinor
  if (riderRefundMinor > 0) {
    await recordWalletEntry(tx, {
      userId: ride.riderId,
      type: 'REFUND',
      amountMinor: riderRefundMinor,
      currency: ride.currency,
      referenceType: 'ride_prepayment_refund',
      referenceId: ride.id,
      keyParts: ['ride-prepayment-refund', ride.id],
      note: 'Rider prepayment refunded after ride cancellation.',
    })
  }
  if (feeMinor > 0 && ride.driverId) {
    await recordWalletEntry(tx, {
      userId: ride.driverId,
      type: 'CREDIT',
      amountMinor: feeMinor,
      currency: ride.currency,
      referenceType: 'ride_cancellation_fee',
      referenceId: ride.id,
      keyParts: ['ride-cancellation-fee-prepaid', ride.id],
      note: 'Driver cancellation fee, settled from the rider prepayment (no commission).',
    })
  }
  return { refunded: true, riderRefundMinor, feeMinor }
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

// Ride payment reversal (2026-10-09). Rides have no booking-style HOLD/dispute window, so until now
// there was NO correction path at all: a ride fare approved in error, fraudulently, or at the wrong
// amount could not be undone, and both the driver's share and the platform's commission stayed
// permanently credited. This reverses an approved ride payment by DEBITing the ACTUAL recipients of
// the credits approvePaymentProof() created -- the driver's fare (or cancellation-fee) credit and
// the platform's commission credit -- resolved from their real wallet entries (same discipline as
// originalAdminShareRecipient), never re-derived from a rate. Idempotent by key: a second call for
// the same ride is a no-op. Returns a summary of what was reversed.
export async function reverseRidePayment(tx, { rideId, reason = 'Ride payment reversed by admin.' }) {
  // Reverse BOTH directions of a ride's settlement so every party is made whole:
  //  * Settlement CREDITs (driver fare / cancellation fee, platform commission) are DEBITed back out
  //    of their recipients.
  //  * Settlement DEBITs are CREDITed back: the RIDER's prepayment (prepaid rides — this is the
  //    actual rider refund that was previously missing, defect #1), and the cash-ride driver
  //    commission debt (cash rides — undo the debt).
  // Idempotent: every reversal entry's idempotency key is pinned to its SOURCE entry id, so a second
  // call re-derives the same keys and is a no-op. The queries match only the ORIGINAL referenceTypes,
  // never the `…_reversal` entries this function writes, so a reversal is never itself reversed.
  const credits = await tx.walletEntry.findMany({
    where: {
      referenceId: rideId,
      type: 'CREDIT',
      referenceType: { in: ['ride_fare', 'ride_cancellation_fee', 'ride_commission'] },
    },
    include: { wallet: true },
  })
  const debits = await tx.walletEntry.findMany({
    where: {
      referenceId: rideId,
      type: 'DEBIT',
      // ride_prepayment = the rider's prepaid funds (refund them); ride_commission = the cash-ride
      // driver commission debt (undo it). `…_reversal` DEBITs are excluded by this explicit list.
      referenceType: { in: ['ride_prepayment', 'ride_commission'] },
    },
    include: { wallet: true },
  })
  // #201 (2026-10-10) double-refund guard: if the cancellation flow already returned the rider's
  // prepayment (a `ride_prepayment_refund` entry exists), do NOT credit the prepayment back again
  // here — that would refund the rider twice (money from nothing). We only reverse a prepayment that
  // was actually settled out to the driver/platform (a COMPLETED prepaid ride), i.e. when no refund
  // exists. The cash commission debt (ride_commission) is still reversed in all cases.
  const priorPrepaymentRefund = await tx.walletEntry.findFirst({
    where: { referenceId: rideId, referenceType: 'ride_prepayment_refund' },
    select: { id: true },
  })
  const effectiveDebits = priorPrepaymentRefund
    ? debits.filter((debit) => debit.referenceType !== 'ride_prepayment')
    : debits
  let reversedMinor = 0
  const reversed = []
  for (const credit of credits) {
    const recipientUserId = credit.wallet?.userId
    if (!recipientUserId) continue
    await recordWalletEntry(tx, {
      userId: recipientUserId,
      type: 'DEBIT',
      amountMinor: credit.amountMinor,
      currency: credit.currency,
      referenceType: `${credit.referenceType}_reversal`,
      referenceId: rideId,
      keyParts: [`${credit.referenceType}-reversal`, rideId, credit.id],
      note: reason,
      // The recipient may already have withdrawn or spent this credit (drivers can now withdraw ride
      // earnings, #192), so the claw-back must be allowed to push the wallet negative — that negative
      // is a genuine receivable the platform collects from future earnings, exactly like the cash
      // commission debt. Without this a reversal of an already-withdrawn ride would throw and roll back.
      allowNegative: true,
    })
    reversedMinor += credit.amountMinor
    reversed.push({ referenceType: credit.referenceType, amountMinor: credit.amountMinor, userId: recipientUserId, direction: 'debit' })
  }
  for (const debit of effectiveDebits) {
    const partyUserId = debit.wallet?.userId
    if (!partyUserId) continue
    await recordWalletEntry(tx, {
      userId: partyUserId,
      type: 'CREDIT',
      amountMinor: debit.amountMinor,
      currency: debit.currency,
      referenceType: `${debit.referenceType}_reversal`,
      referenceId: rideId,
      keyParts: [`${debit.referenceType}-reversal`, rideId, debit.id],
      note: reason,
    })
    reversed.push({ referenceType: debit.referenceType, amountMinor: debit.amountMinor, userId: partyUserId, direction: 'credit' })
  }
  return { reversedEntries: reversed.length, reversedMinor, reversed }
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

// Item 2 Phase 2b round 3: the commission-reversal + cancellation-fee side effects a guest/host
// cancellation used to post inline, atomically, in the SAME actor-triggered transaction that also
// created the refund request. Splitting them out is what makes the actor-policy split possible:
// createRefundRequest() is genuinely money-safe for the booking's own guest/host to trigger
// directly (zero wallet entries, zero provider calls -- proven since Phase 2b round 2), but
// reversing the platform's commission and charging/crediting a cancellation fee IS real wallet
// money movement, so it now happens only via a separate, ADMIN-only finalize action (see
// POST/PATCH /api/admin/bookings/:id/finalize-cancellation in admin.mjs), after the cancellation
// itself has already happened. Reuses reverseBookingPlatformShare (the same admin-share-reversal +
// payout-clawback-if-released logic the admin dispute-rejection path already relies on) rather than
// re-deriving it a third time -- this is the "reusable service function" this round asked for, not
// a fresh implementation. recordWalletEntry's own idempotency-by-key means calling this function
// twice for the same booking is always safe (a no-op second time), so no separate "already
// finalized" guard is needed here.
export async function finalizeCancellationLedgerEffects(tx, {
  booking, // must include `listing` (for listing.ownerId / listing.division)
  approvedPayment,
  cancelledBy, // 'GUEST' | 'HOST' -- who initiated the original cancellation
}) {
  const keyPrefix = cancelledBy === 'GUEST' ? 'booking-guest-cancel' : 'booking-host-cancel'
  // Money-flow decision 3 (2026-10-08): cancellations made since then carry the rule they were
  // decided under on booking.metadata.cancellation (written server-side by the cancel handlers).
  // Those finalize by the rule-based split below. Cancellations recorded before this change have no
  // such snapshot and keep the exact legacy behaviour that follows it (full reversal + legacy fee).
  if (booking.metadata?.cancellation?.policyVersion) {
    return finalizeRuleBasedCancellation(tx, { booking, approvedPayment, cancelledBy, keyPrefix })
  }
  const { split, adminRecipientId, hostClawedBack } = await reverseBookingPlatformShare(tx, {
    booking,
    approvedPayment,
    keyPrefix,
    adminShareReversalNote: `Admin/SYBNB share reversed because the ${cancelledBy.toLowerCase()}-cancelled booking was refunded.`,
    payoutClawbackNote: `Host payout clawed back after the ${cancelledBy.toLowerCase()}-cancelled booking was refunded.`,
  })

  let feeCharged = false
  if (cancelledBy === 'GUEST') {
    // Mirrors the guest-cancel path's own original rule exactly: no fee when the guest purchased
    // cancellation protection.
    if (!split.cancellationProtectionPurchased) {
      const fee = cancellationAdminFee(booking.currency)
      await recordWalletEntry(tx, {
        userId: booking.guestId,
        type: 'DEBIT',
        amountMinor: fee.amountMinor,
        currency: fee.currency,
        referenceType: 'booking_guest_cancel_fee',
        referenceId: booking.id,
        keyParts: ['booking-guest-cancel-fee-guest', booking.id, approvedPayment.id],
        note: 'Guest cancellation admin fee after cancelling a paid booking without cancellation protection.',
      })
      await recordWalletEntry(tx, {
        userId: adminRecipientId,
        type: 'CREDIT',
        amountMinor: fee.amountMinor,
        currency: fee.currency,
        referenceType: 'booking_guest_cancel_fee',
        referenceId: booking.id,
        keyParts: ['booking-guest-cancel-fee-admin', booking.id, approvedPayment.id],
        note: 'Admin received guest cancellation fee for paid booking without cancellation protection.',
      })
      feeCharged = true
    }
  } else {
    // host.mjs's original fee charge was unconditional (no protection-status check, unlike the
    // guest-cancel path) -- preserved exactly as-is here, not silently changed by this
    // restructuring. This asymmetry was already flagged as a separate, out-of-scope finding in the
    // Phase 2b round 2 report; still not this round's to fix.
    const fee = cancellationAdminFee(booking.currency)
    await recordWalletEntry(tx, {
      userId: booking.listing.ownerId,
      type: 'DEBIT',
      amountMinor: fee.amountMinor,
      currency: fee.currency,
      referenceType: 'booking_host_cancel_fee',
      referenceId: booking.id,
      keyParts: ['booking-host-cancel-fee-host', booking.id, approvedPayment.id],
      note: 'Host cancellation admin fee after cancelling a protected paid booking.',
    })
    await recordWalletEntry(tx, {
      userId: adminRecipientId,
      type: 'CREDIT',
      amountMinor: fee.amountMinor,
      currency: fee.currency,
      referenceType: 'booking_host_cancel_fee',
      referenceId: booking.id,
      keyParts: ['booking-host-cancel-fee-admin', booking.id, approvedPayment.id],
      note: 'Admin received host cancellation fee for protected paid booking.',
    })
    feeCharged = true
  }

  return { split, adminRecipientId, hostClawedBack, feeCharged }
}

export const CANCELLATION_POLICY_VERSION = 'SYBNB_CANCELLATION_RULES_2026_10_08'

// Rule-based finalize (decision 3). Given the split posted at approval -- admin share A CREDITed to
// the commission recipient, host share Hg HELD (or RELEASEd), protection fee F CREDITed -- and the
// cancellation snapshot (refund R to the guest, retained T = paid - R), this posts:
//   1. DEBIT  commission recipient: A - commission(retained stay)   [commission on the REFUNDED part
//      is reversed; 12% of the retained stay part stays with SYBNB]
//   2. host:  if the payout was already RELEASED -> DEBIT clawback of Hg - hostShare(retained stay);
//             otherwise                           -> RELEASE hostShare(retained stay) to the host now
//             (the stay will not happen, so there is no completion/hold window left to wait for;
//             this admin-only finalize IS the human release gate)
//   3. HOST cancellations only: DEBIT the protection-fee credit F back (the guest's refund includes
//      it). Guest cancellations keep F (non-refundable premium, unchanged).
//   4. Fees: HOST cancellations keep the legacy host cancellation fee (unchanged). GUEST
//      cancellations under the new rule are charged NO separate cancellation fee: the owner's rule
//      defines the guest's refund exactly (100% / 50% / minus protection), and an extra wallet fee
//      would make the quoted refund untrue.
// Idempotency keys for (1) and the clawback in (2) are identical to the legacy path's, so a booking
// can never be finalized under both paths.
async function finalizeRuleBasedCancellation(tx, { booking, approvedPayment, cancelledBy, keyPrefix }) {
  const cancellation = booking.metadata.cancellation
  if (Math.round(cancellation.refundMinor) + Math.round(cancellation.retainedMinor) !== approvedPayment.amountMinor) {
    const error = new Error('Anomaly: the recorded cancellation split does not add up to the approved payment.')
    error.statusCode = 500
    error.code = 'CANCELLATION_SPLIT_ANOMALY'
    throw error
  }
  const split = bookingFinanceSplit(booking, approvedPayment.amountMinor)
  const adminRecipientId = await originalAdminShareRecipient(tx, booking.id)
  const deltas = cancellationLedgerDeltas({
    originalAdminShareMinor: split.adminShareMinor,
    originalHostGrossMinor: split.hostGrossMinor,
    originalProtectionMinor: split.cancellationProtectionFeeMinor,
    cancellation,
  })
  const who = cancelledBy.toLowerCase()

  await recordWalletEntry(tx, {
    userId: adminRecipientId,
    type: 'DEBIT',
    amountMinor: deltas.commissionReversalMinor,
    currency: booking.currency,
    referenceType: 'booking_admin_share_reversal',
    referenceId: booking.id,
    keyParts: [`${keyPrefix}-admin-share-reversal`, booking.id, approvedPayment.id],
    note: `Commission on the refunded part reversed (${cancellation.rule}, ${who}-cancelled); commission on the retained ${cancellation.retainedStayMinor} kept.`,
  })

  const priorRelease = await tx.walletEntry.findFirst({
    where: { referenceType: 'booking_payout', type: 'RELEASE', referenceId: booking.id },
  })
  let hostClawedBack = false
  let hostReleasedMinor = 0
  if (priorRelease) {
    await recordWalletEntry(tx, {
      userId: booking.listing.ownerId,
      type: 'DEBIT',
      amountMinor: deltas.hostShareReversalMinor,
      currency: booking.currency,
      referenceType: 'booking_payout_clawback',
      referenceId: booking.id,
      keyParts: [`${keyPrefix}-payout-clawback`, booking.id, approvedPayment.id],
      note: `Host payout clawed back for the refunded part (${cancellation.rule}, ${who}-cancelled).`,
    })
    hostClawedBack = deltas.hostShareReversalMinor > 0
  } else if (deltas.hostRetainedReleaseMinor > 0) {
    await recordWalletEntry(tx, {
      userId: booking.listing.ownerId,
      type: 'RELEASE',
      amountMinor: deltas.hostRetainedReleaseMinor,
      currency: booking.currency,
      referenceType: 'booking_payout',
      referenceId: booking.id,
      keyParts: ['booking-host-cancel-retained-release', booking.id, approvedPayment.id],
      note: `Host share of the amount retained after a ${who}-cancelled booking (${cancellation.rule}).`,
    })
    hostReleasedMinor = deltas.hostRetainedReleaseMinor
  }

  let protectionReversedMinor = 0
  if (deltas.protectionReversalMinor > 0) {
    const protectionCredit = await tx.walletEntry.findFirst({
      where: { referenceType: 'booking_protection_fee', referenceId: booking.id, type: 'CREDIT' },
      include: { wallet: true },
    })
    if (protectionCredit?.wallet?.userId) {
      await recordWalletEntry(tx, {
        userId: protectionCredit.wallet.userId,
        type: 'DEBIT',
        amountMinor: Math.min(deltas.protectionReversalMinor, protectionCredit.amountMinor),
        currency: protectionCredit.currency,
        referenceType: 'booking_protection_fee_reversal',
        referenceId: booking.id,
        keyParts: ['booking-protection-fee-reversal', booking.id, approvedPayment.id],
        note: 'Protection fee reversed: the host cancelled/declined, so the guest is refunded everything incl. the protection fee.',
      })
      protectionReversedMinor = Math.min(deltas.protectionReversalMinor, protectionCredit.amountMinor)
    }
  }

  let feeCharged = false
  if (cancelledBy !== 'GUEST') {
    const fee = cancellationAdminFee(booking.currency)
    await recordWalletEntry(tx, {
      userId: booking.listing.ownerId,
      type: 'DEBIT',
      amountMinor: fee.amountMinor,
      currency: fee.currency,
      referenceType: 'booking_host_cancel_fee',
      referenceId: booking.id,
      keyParts: ['booking-host-cancel-fee-host', booking.id, approvedPayment.id],
      note: 'Host cancellation admin fee after cancelling a paid booking.',
    })
    await recordWalletEntry(tx, {
      userId: adminRecipientId,
      type: 'CREDIT',
      amountMinor: fee.amountMinor,
      currency: fee.currency,
      referenceType: 'booking_host_cancel_fee',
      referenceId: booking.id,
      keyParts: ['booking-host-cancel-fee-admin', booking.id, approvedPayment.id],
      note: 'Admin received host cancellation fee for a paid booking.',
    })
    feeCharged = true
  }

  return {
    split,
    adminRecipientId,
    hostClawedBack,
    feeCharged,
    rule: cancellation.rule,
    refundMinor: cancellation.refundMinor,
    retainedMinor: cancellation.retainedMinor,
    ledger: { ...deltas, hostReleasedMinor, protectionReversedMinor },
  }
}

// --- Card money arriving for a booking that can no longer take it (review fix, MEDIUM) ----------
//
// A card rail (Stripe Checkout session / PaymentIntent) can capture funds AFTER the booking stopped
// awaiting payment -- expired unpaid (48h), cancelled by the guest, or already paid another way.
// Before this fix the webhook settled the event and dropped the money silently. Now the payment is
// RECORDED and made REFUNDABLE in the same transaction as the event settlement:
//   - a PaymentProof row (status REFUNDED: money in, owed back; no booking/ledger effect at all --
//     no HOLD, no commission, the booking is not touched), carrying the provider payment object id
//     a real provider refund needs;
//   - a Refund (rail = the card rail, reasonCode PAYMENT_AFTER_BOOKING_CLOSED, IN_PROGRESS, its
//     amount reserved against the proof) + its CLAIMED attempt, so it shows in GET
//     /api/admin/refunds and in the payment-intent reconciliation view. The refund itself must be
//     issued in the provider dashboard (no provider refund call exists in this codebase);
//   - an audit row (PAYMENT_RECEIVED_FOR_CLOSED_BOOKING). The caller sends the admin alert email.
// Idempotent through the proof's (provider, providerRef) uniqueness: a redelivery finds the proof.
export const CLOSED_BOOKING_REFUND_REASON = 'PAYMENT_AFTER_BOOKING_CLOSED'
export async function recordCardPaymentForClosedBooking(tx, {
  booking, // may be null (booking gone)
  bookingId,
  payerUserId,
  provider, // 'stripe' | 'payment_intent'
  rail, // 'stripe_checkout' | 'payment_intent'
  providerRef,
  amountMinor,
  currency,
  providerPaymentObjectType,
  providerPaymentObjectId,
  proofAssetUrl,
}) {
  const amount = Math.max(0, Math.round(Number(amountMinor) || 0))
  const proof = await tx.paymentProof.create({
    data: {
      bookingId: booking?.id || undefined,
      userId: payerUserId,
      provider,
      status: 'REFUNDED',
      amountMinor: amount,
      currency,
      providerRef,
      proofAssetUrl,
      providerPaymentObjectType: providerPaymentObjectType || null,
      providerPaymentObjectId: providerPaymentObjectId || null,
      adminNote: `Card payment captured after the booking stopped awaiting payment (booking status ${booking?.status || 'MISSING'}). Not applied to the booking; refund owed through the provider.`,
    },
  })
  let refund = null
  if (amount > 0) {
    await tx.$executeRaw`
      UPDATE payment_proofs SET reserved_refund_minor = reserved_refund_minor + ${amount}
      WHERE id = ${proof.id}::uuid AND reserved_refund_minor + succeeded_refund_minor + accepted_refund_minor + ${amount} <= amount_minor
    `
    refund = await tx.refund.create({
      data: {
        paymentProofId: proof.id, bookingId: bookingId || null, requestedByUserId: null,
        amountMinor: amount, currency,
        reason: 'Card payment captured after the booking was cancelled/expired/already paid -- refund through the provider.',
        reasonCode: CLOSED_BOOKING_REFUND_REASON, rail, status: 'IN_PROGRESS', reservationHeld: true,
        migratedFromLegacy: false,
      },
    })
    const objectType = providerPaymentObjectType || 'provider_ref'
    const objectId = providerPaymentObjectId || providerRef
    await tx.refundAttempt.create({
      data: {
        refundId: refund.id, status: 'CLAIMED', migratedFromLegacy: false,
        canonicalRequestVersion: 1, provider, providerPaymentObjectType: objectType, providerPaymentObjectId: objectId,
        providerEndpointKey: `${provider}-refund`, amountMinor: amount, currency,
        idempotencyKey: idempotencyKey(['closed-booking-card-refund', proof.id]),
        requestFingerprint: idempotencyKey([provider, objectType, objectId, `${provider}-refund`, String(amount), currency, '1']),
      },
    })
  }
  await tx.adminAuditLog.create({
    data: {
      actorUserId: null,
      action: 'PAYMENT_RECEIVED_FOR_CLOSED_BOOKING',
      entityType: 'payment_proofs',
      entityId: proof.id,
      before: { bookingId: bookingId || null, bookingStatus: booking?.status || null },
      after: { proofId: proof.id, refundId: refund?.id || null, amountMinor: amount, currency, provider, providerRef },
    },
  })
  return { proof, refund }
}

// The provider reported the card refund for such a payment (e.g. PaymentIntent charge.refunded):
// close the open PAYMENT_AFTER_BOOKING_CLOSED refund -- attempt SUCCEEDED, proof counters
// reserved -> succeeded, refund SUCCEEDED. No wallet entry: the card network returned the money.
// Returns the closed refund, or null when there is nothing open to close (idempotent).
export async function settleClosedBookingCardRefund(tx, { paymentProofId }) {
  const refund = await tx.refund.findFirst({
    where: { paymentProofId, reasonCode: CLOSED_BOOKING_REFUND_REASON, status: 'IN_PROGRESS', reservationHeld: true },
    include: { attempts: true },
  })
  if (!refund) return null
  const attempt = refund.attempts.find((a) => a.status === 'CLAIMED' && !a.migratedFromLegacy)
  if (attempt) {
    await tx.refundAttempt.updateMany({
      where: { id: attempt.id, status: 'CLAIMED' },
      data: { status: 'SUCCEEDED', completedAt: new Date(), providerStatus: 'provider_reported_refunded' },
    })
  }
  await tx.paymentProof.updateMany({
    where: { id: paymentProofId, reservedRefundMinor: { gte: refund.amountMinor } },
    data: { reservedRefundMinor: { decrement: refund.amountMinor }, succeededRefundMinor: { increment: refund.amountMinor } },
  })
  await tx.refund.updateMany({
    where: { id: refund.id, status: 'IN_PROGRESS' },
    data: { status: 'SUCCEEDED', reservationHeld: false, succeededAt: new Date() },
  })
  return refund
}

// --- Host withdrawals (decision 2) ---------------------------------------------------------------

async function sumEntries(tx, walletId, type, referenceType) {
  const result = await tx.walletEntry.aggregate({
    where: { walletId, type, referenceType },
    _sum: { amountMinor: true },
  })
  return result._sum.amountMinor || 0
}

// What a host may withdraw: released booking earnings net of clawbacks, host cancellation fees and
// prior withdrawals, never more than the wallet's actual balance (so promotional gift credit or
// refund credit sitting in the same wallet is never withdrawable as cash). pendingMinor = open
// (REQUESTED) payout requests. Pass excludeRequestId to leave one request out of the pending sum.
export async function hostPayoutBalances(tx, { userId, currency, excludeRequestId }) {
  const wallet = await tx.wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  const pending = await tx.payoutRequest.aggregate({
    where: { hostId: userId, currency, status: 'REQUESTED', ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) },
    _sum: { amountMinor: true },
  })
  const pendingMinor = pending._sum.amountMinor || 0
  if (!wallet) return { ...payoutAvailability({ pendingMinor }), currency }
  const [releasedMinor, clawbackMinor, hostFeesMinor, withdrawnMinor] = await Promise.all([
    sumEntries(tx, wallet.id, 'RELEASE', 'booking_payout'),
    sumEntries(tx, wallet.id, 'DEBIT', 'booking_payout_clawback'),
    sumEntries(tx, wallet.id, 'DEBIT', 'booking_host_cancel_fee'),
    sumEntries(tx, wallet.id, 'DEBIT', 'host_payout_withdrawal'),
  ])
  return {
    ...payoutAvailability({
      releasedMinor, clawbackMinor, hostFeesMinor, withdrawnMinor,
      walletBalanceMinor: wallet.cachedBalanceMinor, pendingMinor,
    }),
    currency,
  }
}

// #192 (2026-10-10): what a DRIVER may withdraw. Their ride earnings — fare + cancellation-fee
// CREDITs — net of any cash-ride commission debits and prior driver withdrawals, and never more than
// the wallet's ACTUAL balance (so a reversal, a cash commission debt, or any negative balance can
// never be withdrawn, and rider top-ups / gifts / refunds sitting in the same wallet — a user can be
// both rider and driver — are never withdrawable as driver cash). Mirrors hostPayoutBalances but over
// the ride ledger instead of the booking ledger. Uses the same payoutRequest table; a driver request
// is tagged method.kind === 'driver' and its withdrawal DEBIT uses referenceType
// 'driver_payout_withdrawal' so the two ledgers never cross-count.
export async function driverPayoutBalances(tx, { userId, currency, excludeRequestId }) {
  const wallet = await tx.wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  const pending = await tx.payoutRequest.aggregate({
    where: { hostId: userId, currency, status: 'REQUESTED', ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) },
    _sum: { amountMinor: true },
  })
  const pendingMinor = pending._sum.amountMinor || 0
  if (!wallet) return { ...payoutAvailability({ pendingMinor }), currency }
  const [fareMinor, cancelFeeMinor, cashCommissionDebtMinor, withdrawnMinor] = await Promise.all([
    sumEntries(tx, wallet.id, 'CREDIT', 'ride_fare'),
    sumEntries(tx, wallet.id, 'CREDIT', 'ride_cancellation_fee'),
    sumEntries(tx, wallet.id, 'DEBIT', 'ride_commission'), // cash-ride commission the driver owes
    sumEntries(tx, wallet.id, 'DEBIT', 'driver_payout_withdrawal'),
  ])
  return {
    ...payoutAvailability({
      releasedMinor: fareMinor + cancelFeeMinor,
      clawbackMinor: cashCommissionDebtMinor,
      hostFeesMinor: 0,
      withdrawnMinor,
      walletBalanceMinor: wallet.cachedBalanceMinor,
      pendingMinor,
    }),
    currency,
  }
}

// A driver files a withdrawal request. Like createPayoutRequest, moves NO money — it only reserves
// the amount against future requests via pendingMinor and records the payout method. Tagged
// method.kind='driver' so markPayoutRequestPaid re-checks driver (not host) balances and books the
// driver withdrawal referenceType.
export async function createDriverPayoutRequest(tx, { driverId, amountMinor, currency, method }) {
  await lockHostPayouts(tx, driverId)
  const balances = await driverPayoutBalances(tx, { userId: driverId, currency })
  if (amountMinor > balances.requestableMinor) {
    throw payoutError(409, 'PAYOUT_AMOUNT_EXCEEDS_AVAILABLE', 'The requested amount is more than your available ride earnings minus pending requests.')
  }
  return tx.payoutRequest.create({
    data: { hostId: driverId, amountMinor, currency, status: 'REQUESTED', method: { ...(method && typeof method === 'object' ? method : {}), kind: 'driver' } },
  })
}

function payoutError(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

// Serializes every withdrawal decision for one host (request creation and admin PAID) so two
// concurrent requests cannot both pass the available-minus-pending check.
export async function lockHostPayouts(tx, hostId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`host-payout:${hostId}`}))`
}

// Host files a withdrawal request. Moves NO money (no wallet entry): it only reserves the amount
// against future requests via pendingMinor.
export async function createPayoutRequest(tx, { hostId, amountMinor, currency, method }) {
  await lockHostPayouts(tx, hostId)
  const balances = await hostPayoutBalances(tx, { userId: hostId, currency })
  if (amountMinor > balances.requestableMinor) {
    throw payoutError(409, 'PAYOUT_AMOUNT_EXCEEDS_AVAILABLE', 'The requested amount is more than your available balance minus pending requests.')
  }
  return tx.payoutRequest.create({
    data: { hostId, amountMinor, currency, status: 'REQUESTED', method },
  })
}

// Admin marks a request PAID after paying the host OUTSIDE the platform. This is the only place a
// withdrawal touches the ledger: one DEBIT of exactly the request amount on the host's wallet
// (balance decreases), guarded by recordWalletEntry's no-overdraw check and a re-check of the
// withdrawable amount inside the same serialized transaction.
export async function markPayoutRequestPaid(tx, { requestId, actorUserId, reference, note }) {
  const request = await tx.payoutRequest.findUnique({ where: { id: requestId } })
  if (!request) throw payoutError(404, 'PAYOUT_REQUEST_NOT_FOUND', 'Payout request not found.')
  // #192: a driver withdrawal (tagged method.kind==='driver') is re-checked against the DRIVER's ride
  // earnings and booked as 'driver_payout_withdrawal', so it never cross-counts with host booking
  // earnings. Everything else is the host path, unchanged.
  const isDriver = Boolean(request.method && typeof request.method === 'object' && !Array.isArray(request.method) && request.method.kind === 'driver')
  await lockHostPayouts(tx, request.hostId)
  const balances = isDriver
    ? await driverPayoutBalances(tx, { userId: request.hostId, currency: request.currency, excludeRequestId: request.id })
    : await hostPayoutBalances(tx, { userId: request.hostId, currency: request.currency, excludeRequestId: request.id })
  if (request.amountMinor > balances.availableMinor) {
    throw payoutError(409, 'PAYOUT_AMOUNT_EXCEEDS_AVAILABLE', isDriver
      ? 'The driver no longer has enough available ride earnings for this payout.'
      : 'The host no longer has enough available balance for this payout.')
  }
  const claimed = await tx.payoutRequest.updateMany({
    where: { id: request.id, status: 'REQUESTED' },
    data: { status: 'PAID', reference, note: note || null, decidedById: actorUserId, decidedAt: new Date() },
  })
  if (claimed.count !== 1) {
    throw payoutError(409, 'PAYOUT_REQUEST_NOT_PENDING', 'This payout request was already decided.')
  }
  const walletEntry = await recordWalletEntry(tx, {
    userId: request.hostId,
    type: 'DEBIT',
    amountMinor: request.amountMinor,
    currency: request.currency,
    referenceType: isDriver ? 'driver_payout_withdrawal' : 'host_payout_withdrawal',
    referenceId: request.id,
    keyParts: [isDriver ? 'driver-payout-withdrawal' : 'host-payout-withdrawal', request.id],
    note: isDriver
      ? `Driver withdrawal paid outside the platform (reference ${reference}).`
      : `Host withdrawal paid outside the platform (reference ${reference}).`,
  })
  return tx.payoutRequest.update({ where: { id: request.id }, data: { walletEntryId: walletEntry?.id || null } })
}

export async function rejectPayoutRequest(tx, { requestId, actorUserId, note }) {
  const claimed = await tx.payoutRequest.updateMany({
    where: { id: requestId, status: 'REQUESTED' },
    data: { status: 'REJECTED', note, decidedById: actorUserId, decidedAt: new Date() },
  })
  if (claimed.count !== 1) {
    const exists = await tx.payoutRequest.findUnique({ where: { id: requestId }, select: { id: true } })
    if (!exists) throw payoutError(404, 'PAYOUT_REQUEST_NOT_FOUND', 'Payout request not found.')
    throw payoutError(409, 'PAYOUT_REQUEST_NOT_PENDING', 'This payout request was already decided.')
  }
  return tx.payoutRequest.findUnique({ where: { id: requestId } })
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

// Item 2 Phase 2b round 3 (guest-refund gap closure): executes a real, non-legacy manual-rail
// Refund by crediting the original payer's SYBNB wallet -- the same internal ledger mechanism this
// platform already uses for host payouts and admin commission, not an external provider call.
// There is no real payment provider connected or approved anywhere in this codebase (Stripe/
// PaymentIntent are both unapproved); the manual/local-wallet rail's actual operating model has
// always been human-reviewed money moving through the internal wallet ledger, so "executing" a
// refund on this rail means the platform recognizes its own debt to the guest as fulfilled the
// same way it already recognizes a host's payout as fulfilled -- via a wallet credit, not a
// reversal of the original external (Sham Cash / bank transfer) payment method.
//
// Mirrors legacy_refund_accept's exact discipline (claim -> exact-amount counter transfer ->
// finalize), adapted for a genuine SUCCEEDED outcome rather than an accounting reclassification:
// the primary serializer is the RefundAttempt's own CLAIMED->SUCCEEDED transition (a conditional
// updateMany, matching the CAS-claim pattern used throughout this codebase) rather than the
// Refund's own status (which has no distinct "about to execute" value to transition through, since
// createRefundRequest() already leaves it at IN_PROGRESS). A concurrent second call loses at this
// step -- 0 rows matched -- and is refused before touching any counter or wallet balance.
export async function executeManualRailRefund(tx, { refundId, actorUserId }) {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    include: { paymentProof: true, attempts: true },
  })
  if (!refund) {
    const error = new Error('Refund not found.')
    error.statusCode = 404
    error.code = 'REFUND_NOT_FOUND'
    error.expose = true
    throw error
  }
  // Legacy refunds have their own, materially different acceptance path (legacy_refund_accept,
  // round 1) -- an owner's acknowledgement of incomplete historical evidence, never a genuine
  // wallet credit. Keeping them structurally separate here, the same way createRefundRequest()
  // structurally cannot produce a LEGACY_UNKNOWN reasonCode, so the two paths can never collide.
  if (refund.migratedFromLegacy) {
    const error = new Error('This is a migrated legacy refund -- use legacy_refund_accept, not execute.')
    error.statusCode = 400
    error.code = 'REFUND_IS_LEGACY'
    error.expose = true
    throw error
  }
  if (!MANUAL_REFUND_PROVIDER_FAMILY.has(refund.paymentProof?.provider)) {
    const error = new Error(`executeManualRailRefund does not support provider '${refund.paymentProof?.provider}' -- this refund needs a real provider-issued refund, not a wallet-rail execution.`)
    error.statusCode = 400
    error.code = 'REFUND_PROVIDER_NOT_SUPPORTED'
    error.expose = true
    throw error
  }
  const claimableAttempt = refund.attempts.find((a) => a.status === 'CLAIMED' && a.supersededByAttemptId === null && !a.migratedFromLegacy)
  if (!claimableAttempt) {
    const error = new Error('No claimable (non-legacy, CLAIMED) refund attempt exists for this refund.')
    error.statusCode = 409
    error.code = 'NO_CLAIMABLE_ATTEMPT'
    error.expose = true
    throw error
  }

  // Step 1: claim the attempt -- the primary serializer.
  const claimed = await tx.refundAttempt.updateMany({
    where: { id: claimableAttempt.id, status: 'CLAIMED' },
    data: { status: 'SUCCEEDED', completedAt: new Date(), providerStatus: 'wallet_credited' },
  })
  if (claimed.count !== 1) {
    const error = new Error('This refund attempt is not currently executable (already executed or claimed by a concurrent request).')
    error.statusCode = 409
    error.code = 'REFUND_NOT_EXECUTABLE'
    error.expose = true
    throw error
  }

  // Step 2: transfer reserved -> succeeded on the proof. Exact-amount guard, same reasoning as
  // legacy_refund_accept's Step 5: refunds_one_active_per_payment_proof guarantees at most one
  // active refund per proof, so once Step 1 has claimed THIS refund's only attempt,
  // reservedRefundMinor must equal exactly refund.amountMinor -- a `gte` guard would mask a real
  // data inconsistency as a normal transfer.
  const transferred = await tx.paymentProof.updateMany({
    where: { id: refund.paymentProofId, reservedRefundMinor: refund.amountMinor },
    data: {
      reservedRefundMinor: { decrement: refund.amountMinor },
      succeededRefundMinor: { increment: refund.amountMinor },
    },
  })
  if (transferred.count !== 1) {
    const error = new Error('Anomaly: payment proof counter transfer did not affect exactly one row.')
    error.statusCode = 500
    error.code = 'COUNTER_TRANSFER_ANOMALY'
    throw error
  }

  // Step 3: finalize the refund. succeededAt IS set here (unlike legacy_refund_accept's
  // ACCOUNTING_ACCEPTED) -- this is a genuine, ledger-confirmed success, not an accounting
  // reclassification of incomplete evidence.
  const finalized = await tx.refund.updateMany({
    where: { id: refund.id, status: 'IN_PROGRESS', reservationHeld: true },
    data: { status: 'SUCCEEDED', reservationHeld: false, succeededAt: new Date() },
  })
  if (finalized.count !== 1) {
    const error = new Error('Anomaly: refund finalize did not affect exactly one row.')
    error.statusCode = 500
    error.code = 'REFUND_FINALIZE_ANOMALY'
    throw error
  }

  // Step 4: the actual money movement -- credit the original payer's wallet. By this point the
  // attempt claim above has already made this call the sole owner of this refund's execution, so
  // this recordWalletEntry call cannot race with another executeManualRailRefund call for the same
  // refund; its own idempotency-by-key still protects against any other coincidental replay.
  const walletEntry = await recordWalletEntry(tx, {
    userId: refund.paymentProof.userId,
    type: 'REFUND',
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    referenceType: 'booking_refund',
    referenceId: refund.bookingId || refund.paymentProofId,
    keyParts: ['refund-execution-wallet-credit', refund.id],
    note: 'Refund executed as an internal SYBNB wallet credit (manual/local-wallet rail -- no external provider call).',
  })

  return {
    refund: { ...refund, status: 'SUCCEEDED', reservationHeld: false },
    attempt: { ...claimableAttempt, status: 'SUCCEEDED' },
    walletEntry,
  }
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
  const listingMetadata = booking.listing?.metadata || {}
  const bookingMetadata = booking.metadata || {}
  const isShortStay = !booking.listing || booking.listing.division === 'STAYS'

  // Prefer the fee breakdown snapshotted at booking-creation time over the listing's current
  // metadata — see the matching comment in bookingFinanceSplit for why (a later fee edit must
  // never change what an already-created booking charges). The arithmetic itself lives in
  // booking-policy.mjs's computeGuestTotals() -- the same function the public quote endpoint uses,
  // so the figure a guest is quoted and the figure every rail charges cannot drift apart.
  const fees = bookingMetadata.feeSnapshot || readListingFees(listingMetadata)
  return computeGuestTotals({
    stayMinor: booking.amountMinor,
    fees,
    extraFeesMinor: metadataNumber(listingMetadata, 'extraFeesMinor'),
    isShortStay,
    protection: bookingMetadata.cancellationProtectionPurchased === true,
    protectionFeeOverrideMinor: metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor'),
  }).totalMinor
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
