import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, bookingFinanceSplit, createRefundRequest, executeManualRailRefund, finalizeCancellationLedgerEffects, recordWalletEntry, reverseBookingPlatformShare } from '../lib/finance-ledger.mjs'
import { completeExpiredBookings, isPayoutEligible, payoutEligibleAt, PAYOUT_HOLD_DAYS } from '../lib/booking-lifecycle.mjs'
import { expireStaleWalletGifts } from '../lib/gift-lifecycle.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'
import { idempotencyKey } from '../lib/security.mjs'
import { applyRoleChange, setAccountStatus, REVOCATION_REASONS } from '../lib/session-store.mjs'
// SEC-002R (finding N4): getAuthContext() runs ONCE, in server/index.mjs, before the route handler
// has even read the request body, and its result is trusted for the rest of the request. Every
// Class A (irreversible money-moving or privilege-changing) handler in this file re-asserts that
// authority against locked, authoritative DB rows inside the SAME transaction as its own
// state-changing write -- see server/lib/commit-authorization.mjs for the full reasoning.
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'

// Mirrors prisma/schema.prisma's RoleName enum. Validated here so an unknown role is a clean 400
// rather than a Prisma enum error surfacing as a 500.
const VALID_ROLES = new Set(['GUEST', 'HOST', 'SELLER', 'DRIVER', 'ADMIN', 'SUPPORT'])

export async function handleAdmin(req, res, url, context) {
  const hideReviewMatch = url.pathname.match(/^\/api\/admin\/reviews\/([^/]+)\/hide$/)
  if (hideReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const existing = await db().listingReview.findUnique({ where: { id: hideReviewMatch[1] } })
    if (!existing) {
      const error = new Error('Review not found.')
      error.statusCode = 404
      error.code = 'REVIEW_NOT_FOUND'
      error.expose = true
      throw error
    }

    const review = await db().listingReview.update({
      where: { id: existing.id },
      data: { hiddenAt: new Date(), hiddenByAdminId: context.user.id },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_REVIEW_HIDDEN',
        entityType: 'listing_reviews',
        entityId: review.id,
        before: existing,
        after: review,
      },
    })

    return json(res, 200, { ok: true, review })
  }

  if (url.pathname === '/api/admin/payouts') {
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()

    if (req.method === 'GET') {
      const completedBookings = await db().booking.findMany({
        where: { status: 'COMPLETED' },
        include: {
          listing: { include: { owner: { select: { id: true, displayName: true } } } },
          payments: true,
        },
        orderBy: { checkOut: 'asc' },
        take: 100,
      })

      const releasedBookingIds = new Set(
        (
          await db().walletEntry.findMany({
            where: {
              referenceType: 'booking_payout',
              type: 'RELEASE',
              referenceId: { in: completedBookings.map((b) => b.id) },
            },
            select: { referenceId: true },
          })
        ).map((entry) => entry.referenceId),
      )

      const payouts = completedBookings
        .filter((booking) => !releasedBookingIds.has(booking.id))
        .map((booking) => {
          const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
          const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)
          return {
            bookingId: booking.id,
            listingTitle: booking.listing?.titleAr,
            hostId: booking.listing?.ownerId,
            hostName: booking.listing?.owner?.displayName,
            checkOut: booking.checkOut,
            eligibleAt: payoutEligibleAt(booking.checkOut),
            eligibleNow: isPayoutEligible(booking),
            hostPayoutMinor: split.hostGrossMinor,
            currency: booking.currency,
          }
        })

      return json(res, 200, { ok: true, payouts, holdDays: PAYOUT_HOLD_DAYS })
    }

    return methodNotAllowed(res, ['GET'])
  }

  const payoutReleaseMatch = url.pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/release$/)
  if (payoutReleaseMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const booking = await db().booking.findUnique({
      where: { id: payoutReleaseMatch[1] },
      include: { listing: true, payments: true },
    })

    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    // An admin who also holds the HOST role for this listing must not release their own payout.
    assertNotInterestedParty([booking.listing.ownerId], context.user.id)

    // Paying the host out is its own operation (payout_release), distinct from capturing or
    // refunding the guest's payment — no third-party disbursement processor is called anywhere in
    // this codebase, so it's classified under the same 'manual'/internal-ledger provider as the
    // other admin-driven wallet operations.
    authorizePaymentOperation({
      operation: 'payout_release',
      rail: 'manual_proof',
      provider: 'manual',
      division: booking.listing.division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    if (!isPayoutEligible(booking)) {
      const error = new Error(
        `Payout is not eligible for release yet. It must be COMPLETED and past the ${PAYOUT_HOLD_DAYS}-day hold, with no open dispute.`,
      )
      error.statusCode = 400
      error.code = 'PAYOUT_NOT_ELIGIBLE'
      error.expose = true
      throw error
    }

    const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
    const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)

    const entry = await db().$transaction(async (tx) => {
      // Re-check eligibility inside the transaction against a fresh read: the outer check above ran
      // before this transaction opened, so a dispute filed in that window (or any other status
      // change) would otherwise still get released. This closes that race with no added cost — the
      // idempotencyKey on recordWalletEntry already prevents an actual double-release.
      const freshBooking = await tx.booking.findUnique({
        where: { id: booking.id },
        // SEC-002R: the listing is included so the self-dealing re-check below runs against the
        // ownerId as it stands INSIDE this transaction, not the copy read before the body was
        // parsed -- a genuine commit-boundary comparison rather than a replay of the admission one.
        include: { listing: { select: { ownerId: true } } },
      })
      if (!freshBooking || !isPayoutEligible(freshBooking)) {
        const error = new Error(
          `Payout is not eligible for release yet. It must be COMPLETED and past the ${PAYOUT_HOLD_DAYS}-day hold, with no open dispute.`,
        )
        error.statusCode = 400
        error.code = 'PAYOUT_NOT_ELIGIBLE'
        error.expose = true
        throw error
      }

      // SEC-002R Class A. Last statement before real money moves: proves the acting admin's session
      // is still live, their account still ACTIVE, their epoch still current and their ADMIN role
      // still held, holding the locks that make a concurrent revocation impossible until this
      // transaction commits. A failure throws, and Postgres rolls back the RELEASE below with it.
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_PAYOUT_RELEASED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [freshBooking.listing?.ownerId],
      })

      const released = await recordWalletEntry(tx, {
        userId: booking.listing.ownerId,
        type: 'RELEASE',
        amountMinor: split.hostGrossMinor,
        currency: booking.currency,
        referenceType: 'booking_payout',
        referenceId: booking.id,
        keyParts: ['booking-host-release', booking.id, approvedPayment?.id],
        note: `Host payout released by admin after the ${PAYOUT_HOLD_DAYS}-day hold following stay completion.`,
      })

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_PAYOUT_RELEASED',
          entityType: 'bookings',
          entityId: booking.id,
          before: booking,
          after: { walletEntry: released },
        },
      })

      return released
    })

    return json(res, 200, { ok: true, walletEntry: entry })
  }

  // Item 2 Phase 2b round 3: finalizes the commission-reversal + cancellation-fee wallet entries a
  // guest/host cancellation used to post inline, atomically, as part of their own action.
  // createRefundRequest() (still triggered directly by the booking's own guest/host at cancel time)
  // moves zero money; THIS is where the real wallet money movement actually happens now, and it
  // stays ADMIN-only end to end -- see finalizeCancellationLedgerEffects() in finance-ledger.mjs
  // and the policy-split comment at the top of bookings.mjs's/host.mjs's cancel handlers.
  const finalizeCancellationMatch = url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/finalize-cancellation$/)
  if (finalizeCancellationMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const bookingId = finalizeCancellationMatch[1]
    const existing = await db().booking.findUnique({
      where: { id: bookingId },
      include: { listing: true, payments: true },
    })
    if (!existing) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (existing.status !== 'CANCELLED') {
      const error = new Error('Only a cancelled booking can have its cancellation finalized.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_CANCELLED'
      error.expose = true
      throw error
    }
    // The cancel handlers mark the payment proof REFUNDED (not delete it), so this is the durable
    // signal a real approved-then-reversed payment actually exists here to finalize against --
    // structurally impossible for a booking that was cancelled with no approved payment at all
    // (nothing to reverse, no fee to charge), matching the same guard the cancel handlers apply to
    // createRefundRequest() itself.
    const approvedPayment = existing.payments.find((payment) => payment.status === 'REFUNDED')
    if (!approvedPayment) {
      const error = new Error('This booking has no reversed payment to finalize (it was cancelled with no approved payment).')
      error.statusCode = 409
      error.code = 'NOTHING_TO_FINALIZE'
      error.expose = true
      throw error
    }
    // Finalizing moves real fee/commission money involving both the guest and the host of this
    // booking -- an admin who is either must not be the one finalizing it.
    assertNotInterestedParty([existing.guestId, existing.listing.ownerId], context.user.id)

    // Who initiated the cancellation determines who owes the cancellation fee -- derived from the
    // durable audit trail the cancel handlers already write, never from caller input.
    const cancellationAuditEntry = await db().adminAuditLog.findFirst({
      where: { entityType: 'bookings', entityId: bookingId, action: { in: ['BOOKING_GUEST_CANCELLED', 'HOST_CANCELLED'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!cancellationAuditEntry) {
      const error = new Error('No recorded cancellation source (guest or host) was found for this booking.')
      error.statusCode = 409
      error.code = 'CANCELLATION_SOURCE_UNKNOWN'
      error.expose = true
      throw error
    }
    const cancelledBy = cancellationAuditEntry.action === 'BOOKING_GUEST_CANCELLED' ? 'GUEST' : 'HOST'

    authorizePaymentOperation({
      operation: 'refund',
      rail: 'manual_proof',
      provider: 'manual',
      division: existing.listing.division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // A genuinely concurrent second finalize call for the same booking can lose a race inside
    // recordWalletEntry's idempotency-by-key check (see WALLET_ENTRY_RACE_LOST in
    // finance-ledger.mjs) -- by the time that happens, the winning transaction has already
    // committed every entry this call would have posted. One retry re-enters
    // finalizeCancellationLedgerEffects with everything now genuinely idempotent (every
    // recordWalletEntry call finds its existing entry via the normal findUnique path, not a race),
    // so the loser still gets a correct, non-error 200 rather than a raw 500 -- exactly like any
    // other idempotent re-call of this endpoint.
    //
    // An independent revenue audit found a real ordering hazard: for a GUEST cancellation without
    // purchased protection, this reverses commission AND debits the guest's own SYBNB wallet for
    // the cancellation fee -- but a manual-proof guest's wallet is never funded until their refund
    // is actually executed (PATCH /api/admin/refunds/:id/execute credits it). Calling this before
    // that happens fails safe today (recordWalletEntry's balance guard refuses to overdraw, the
    // transaction rolls back cleanly, nothing corrupts) but with a generic, confusing
    // WALLET_INSUFFICIENT_FUNDS -- neither route is wired to any frontend yet, so this has never
    // actually been hit by a real workflow, but it's a real footgun for whoever eventually builds
    // one. Translated into a clear, actionable error naming the exact required order instead of
    // silently re-architecting the money movement (Uber's own model nets the fee into one refund
    // settlement instead of two separately-ordered operations -- a deeper fix worth doing when this
    // is actually wired up and exercised for real, not guessed at now).
    //
    // SEC-002R Class A: this transaction posts the commission reversal and the cancellation-fee
    // wallet entries -- real, irreversible money movement. The re-authorization runs as the first
    // statement inside it, before finalizeCancellationLedgerEffects() writes anything, and the two
    // interested-party ids are re-read here rather than reused from the admission-time `existing`.
    const finalizeInTransaction = async (tx) => {
      const fresh = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { guestId: true, listing: { select: { ownerId: true } } },
      })
      await reauthorizeAtCommit(tx, context, {
        action: 'BOOKING_CANCELLATION_FINALIZED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [fresh?.guestId, fresh?.listing?.ownerId],
      })
      return finalizeCancellationLedgerEffects(tx, { booking: existing, approvedPayment, cancelledBy })
    }

    let result
    try {
      result = await db().$transaction(finalizeInTransaction)
    } catch (err) {
      if (err.code === 'WALLET_INSUFFICIENT_FUNDS') {
        const error = new Error(
          "This guest's cancellation fee can't be charged yet because their refund hasn't been executed " +
            '(their SYBNB wallet has no funds until PATCH /api/admin/refunds/:id/execute runs). Execute the ' +
            'refund first, then finalize this cancellation.',
        )
        error.statusCode = 409
        error.code = 'REFUND_MUST_EXECUTE_FIRST'
        error.expose = true
        throw error
      }
      if (err.code !== 'WALLET_ENTRY_RACE_LOST') throw err
      // The retry re-enters the SAME wrapper, so the second attempt re-authorizes from scratch in
      // its own transaction -- authority revoked between the two attempts is caught by the retry.
      result = await db().$transaction(finalizeInTransaction)
    }

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'BOOKING_CANCELLATION_FINALIZED',
        entityType: 'bookings',
        entityId: bookingId,
        before: existing,
        after: { cancelledBy, ...result },
      },
    })

    return json(res, 200, { ok: true, cancelledBy, ...result })
  }

  // Item 2 Phase 2b round 3 (guest-refund gap closure): executes a real, non-legacy refund request
  // by crediting the original payer's wallet -- see executeManualRailRefund() in finance-ledger.mjs
  // for the full reasoning (internal wallet credit, not an external provider call; no real provider
  // is connected or approved anywhere in this codebase). Stays under the existing 'refund'
  // operation, ADMIN-only, unchanged -- this is exactly the real wallet-money-movement half of the
  // round-3 actor-policy split, same as finalize-cancellation above.
  const executeRefundMatch = url.pathname.match(/^\/api\/admin\/refunds\/([^/]+)\/execute$/)
  if (executeRefundMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const refundId = executeRefundMatch[1]
    const refund = await db().refund.findUnique({
      where: { id: refundId },
      include: { paymentProof: { include: { booking: { include: { listing: true } } } } },
    })
    if (!refund) {
      const error = new Error('Refund not found.')
      error.statusCode = 404
      error.code = 'REFUND_NOT_FOUND'
      error.expose = true
      throw error
    }
    const division = refund.paymentProof?.booking?.listing?.division || 'PLATFORM'
    // executeManualRailRefund credits refund.paymentProof.userId's wallet -- the original payer,
    // not necessarily refund.requestedByUserId (which can be an admin who filed the refund on the
    // payer's behalf, e.g. after rejecting a booking). The wallet that gets credited is the real
    // interested party here.
    assertNotInterestedParty([refund.paymentProof.userId], context.user.id)

    authorizePaymentOperation({
      operation: 'refund',
      rail: 'manual_proof',
      provider: 'manual',
      division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // SEC-002R Class A: executeManualRailRefund() credits the original payer's wallet. Re-authorize
    // inside the same transaction, before that credit, against a fresh read of who the payer is.
    const result = await db().$transaction(async (tx) => {
      const freshPayerId = (
        await tx.refund.findUnique({
          where: { id: refundId },
          select: { paymentProof: { select: { userId: true } } },
        })
      )?.paymentProof?.userId
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_REFUND_EXECUTED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [freshPayerId],
      })
      return executeManualRailRefund(tx, { refundId, actorUserId: context.user.id })
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_REFUND_EXECUTED',
        entityType: 'refunds',
        entityId: refundId,
        before: refund,
        after: result,
      },
    })

    return json(res, 200, { ok: true, ...result })
  }

  const legacyRefundAcceptMatch = url.pathname.match(/^\/api\/admin\/refunds\/([^/]+)\/legacy-accept$/)
  if (legacyRefundAcceptMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const refundId = legacyRefundAcceptMatch[1]
    const body = await readJson(req)
    const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : ''
    if (!reason || reason.length > 2000) {
      const error = new Error('reason must be a non-empty string of at most 2000 characters.')
      error.statusCode = 400
      error.code = 'INVALID_ACCEPTANCE_REASON'
      error.expose = true
      throw error
    }

    const refund = await db().refund.findUnique({
      where: { id: refundId },
      include: { paymentProof: { include: { booking: { include: { listing: true } } } } },
    })
    if (!refund) {
      const error = new Error('Refund not found.')
      error.statusCode = 404
      error.code = 'REFUND_NOT_FOUND'
      error.expose = true
      throw error
    }

    // Item 2 Phase 2b round 1, mandatory boundary: this operation exists ONLY for migrated legacy
    // refunds -- it must never become a route to fast-track a real, non-legacy ACTION_REQUIRED
    // refund. Step 2's LEGACY_PENDING_CONFIRMATION requirement below already makes that
    // structurally impossible (that status is CHECK-constrained to migratedFromLegacy=true rows
    // only), but this explicit, early check gives a clear, honest error instead of a confusing
    // "no eligible attempt found" for an obviously-wrong request.
    if (!refund.migratedFromLegacy) {
      const error = new Error('legacy_refund_accept only applies to refunds migrated from legacy data.')
      error.statusCode = 400
      error.code = 'REFUND_NOT_LEGACY'
      error.expose = true
      throw error
    }
    // Same interested party as execute-refund above -- the original payer this refund resolves in
    // favor of, whether or not this specific path moves a wallet balance directly.
    assertNotInterestedParty([refund.paymentProof.userId], context.user.id)

    const division = refund.paymentProof?.booking?.listing?.division || 'PLATFORM'

    authorizePaymentOperation({
      operation: 'legacy_refund_accept',
      rail: 'manual_proof',
      provider: 'manual',
      division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    const acceptedAt = new Date()

    const result = await db().$transaction(async (tx) => {
      // SEC-002R Class A, Step 0: re-authorize before the refund is claimed, so a revoked admin
      // cannot even take the claim (which would strand the refund in IN_PROGRESS if it were taken
      // and then rolled back later) let alone commit the ACCOUNTING_ACCEPTED finalization below.
      const freshPayerId = (
        await tx.refund.findUnique({
          where: { id: refundId },
          select: { paymentProof: { select: { userId: true } } },
        })
      )?.paymentProof?.userId
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_LEGACY_REFUND_ACCEPTED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [freshPayerId],
      })

      // Step 1: claim -- the PRIMARY refund-level serializer. Guarded on the exact precondition a
      // legacy ACTION_REQUIRED refund is created with (see scripts/migrate-legacy-refunds-2a.mjs);
      // 0 rows means already claimed, already resolved, or genuinely not eligible.
      const claimed = await tx.refund.updateMany({
        where: { id: refundId, status: 'ACTION_REQUIRED', reservationHeld: true },
        data: { status: 'IN_PROGRESS' },
      })
      if (claimed.count !== 1) {
        const error = new Error('Refund is not currently claimable (already in progress, already resolved, or not reservation-held).')
        error.statusCode = 409
        error.code = 'REFUND_NOT_CLAIMABLE'
        error.expose = true
        throw error
      }
      const claimedRefund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } })

      // Step 2: derive the original attempt from claimedRefund.id, never from a caller-supplied id
      // (closes the substitution risk an earlier design revision was rejected for). Matches ONLY
      // LEGACY_PENDING_CONFIRMATION -- deliberately excludes LEGACY_UNVERIFIED, which is the
      // explicit owner decision (Finding 8) that zero-evidence legacy rows get no automated
      // acceptance path at all in this phase.
      const candidates = await tx.refundAttempt.findMany({
        where: { refundId: claimedRefund.id, status: 'LEGACY_PENDING_CONFIRMATION', supersededByAttemptId: null },
      })
      if (candidates.length !== 1) {
        const error = new Error(
          `Expected exactly one LEGACY_PENDING_CONFIRMATION attempt to accept for this refund; found ${candidates.length}. ` +
          'LEGACY_UNVERIFIED refunds have no automated acceptance path and are not eligible here.',
        )
        error.statusCode = 409
        error.code = 'NO_ACCEPTABLE_LEGACY_ATTEMPT'
        error.expose = true
        throw error
      }
      const original = candidates[0]

      // Step 3: insert the new LEGACY_ACCOUNTING_ACCEPTED attempt. The evidence digest binds the
      // refund, the original attempt/evidence being accepted, the amount/currency, the actor, the
      // acceptance timestamp, and the normalized reason -- reusing the same sha256-of-joined-parts
      // primitive every idempotency key in this codebase already uses, not a new mechanism.
      const evidenceDigest = idempotencyKey([
        'legacy_refund_accept',
        claimedRefund.id,
        original.id,
        original.legacyPaymentEventId,
        String(claimedRefund.amountMinor),
        claimedRefund.currency,
        context.user.id,
        acceptedAt.toISOString(),
        reason,
      ])
      const newAttempt = await tx.refundAttempt.create({
        data: {
          refundId: claimedRefund.id,
          status: 'LEGACY_ACCOUNTING_ACCEPTED',
          migratedFromLegacy: true,
          completedAt: acceptedAt,
          legacyPaymentEventId: original.legacyPaymentEventId,
          legacyAcceptedByUserId: context.user.id,
          legacyAcceptedAt: acceptedAt,
          legacyAcceptanceReason: reason,
          legacyAcceptanceEvidenceDigest: evidenceDigest,
        },
      })

      // Step 4: mark the original attempt superseded -- an independent, attempt-scoped
      // defense-in-depth guard (the primary invariant is the refund_attempt_supersession_once
      // trigger, which holds regardless of caller).
      const superseded = await tx.refundAttempt.updateMany({
        where: { id: original.id, supersededByAttemptId: null },
        data: { supersededByAttemptId: newAttempt.id },
      })
      if (superseded.count !== 1) {
        const error = new Error('Could not mark the original attempt as superseded.')
        error.statusCode = 409
        error.code = 'SUPERSESSION_FAILED'
        error.expose = true
        throw error
      }

      // Step 5: transfer reserved -> accepted on the payment proof. The guard requires the EXACT
      // expected reserved amount for this migrated refund, not merely "at least this much" --
      // round-2 corrective fix, independent review finding: refunds_one_active_per_payment_proof
      // (Phase 2a) guarantees at most one active refund per proof, so once Step 1 has claimed THIS
      // refund, reservedRefundMinor must equal exactly claimedRefund.amountMinor. A `gte` guard
      // would let this transaction silently succeed even if the proof happened to carry MORE
      // reserved capacity than this specific refund accounts for -- masking a genuine data
      // inconsistency (e.g. a phantom leftover reservation from elsewhere) as a normal transfer
      // instead of surfacing it as the anomaly it actually is. Must affect EXACTLY one row; anything
      // else rolls back Steps 1-4 too. Uses ONLY claimedRefund's own fields, never a caller-supplied
      // proof id or amount.
      const transferred = await tx.paymentProof.updateMany({
        where: { id: claimedRefund.paymentProofId, reservedRefundMinor: claimedRefund.amountMinor },
        data: {
          reservedRefundMinor: { decrement: claimedRefund.amountMinor },
          acceptedRefundMinor: { increment: claimedRefund.amountMinor },
        },
      })
      if (transferred.count !== 1) {
        const error = new Error('Anomaly: payment proof counter transfer did not affect exactly one row.')
        error.statusCode = 500
        error.code = 'COUNTER_TRANSFER_ANOMALY'
        throw error
      }

      // Step 6: finalize. Same exactly-one-row discipline as Step 5. succeededAt is deliberately
      // NEVER set here -- ACCOUNTING_ACCEPTED is a materially different epistemic claim (an
      // owner's acceptance of incomplete evidence) from genuine provider/ledger-confirmed SUCCEEDED,
      // and must never become indistinguishable from it anywhere downstream.
      const finalized = await tx.refund.updateMany({
        where: { id: claimedRefund.id, status: 'IN_PROGRESS', reservationHeld: true },
        data: { status: 'ACCOUNTING_ACCEPTED', reservationHeld: false },
      })
      if (finalized.count !== 1) {
        const error = new Error('Anomaly: refund finalize did not affect exactly one row.')
        error.statusCode = 500
        error.code = 'REFUND_FINALIZE_ANOMALY'
        throw error
      }

      const auditLog = await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_LEGACY_REFUND_ACCEPTED',
          entityType: 'refunds',
          entityId: claimedRefund.id,
          before: { refund: claimedRefund, originalAttemptId: original.id },
          after: { refundStatus: 'ACCOUNTING_ACCEPTED', newAttemptId: newAttempt.id, evidenceDigest },
        },
      })

      return { refundId: claimedRefund.id, newAttemptId: newAttempt.id, auditLogId: auditLog.id }
    })

    const refreshed = await db().refund.findUnique({ where: { id: result.refundId }, include: { attempts: true } })
    return json(res, 200, { ok: true, refund: refreshed })
  }

  if (url.pathname === '/api/admin/review-queue') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()
    await expireStaleWalletGifts()
    // Scale-readiness audit: 4 of these 5 queues had a `take` cap with no `orderBy` at all --
    // Postgres gives no guarantee which rows come back once a queue's real backlog exceeds 25, so
    // admins could see an arbitrary, shuffling subset on every refresh, with some pending items
    // never surfacing at all while others repeat. Oldest-first (FIFO) is the correct ordering for
    // a moderation/review queue -- it's what keeps a real backlog from leaving any one item
    // waiting indefinitely. idDocuments orders by the real submission timestamp
    // (idDocumentSubmittedAt), not createdAt (account-creation date, unrelated to when the ID was
    // actually submitted for review).
    //
    // Follow-up: a moderation queue is different from public search -- items leave it permanently
    // once an admin acts, so a temporarily-oversized backlog self-heals as it's processed, rather
    // than permanently burying real inventory the way the uncapped public search did. Raised the
    // cap 25->100 (a real reduction in the invisible-backlog window, not a full pagination UI,
    // which isn't justified for a queue that drains under normal admin use) and added an honest
    // total count alongside each list so a genuine surge is visible rather than silently capped
    // with no signal -- the same reasoning already applied to the fake-trust-signal fixes elsewhere
    // in this codebase, just for "how big is the real backlog" instead of "is this badge real".
    const REVIEW_QUEUE_LIMIT = 100
    const listingsWhere = { status: 'PENDING_REVIEW' }
    const paymentsWhere = { status: 'PENDING_ADMIN_REVIEW' }
    const giftsWhere = { status: { in: ['CLAIM_PENDING', 'LOCKED'] } }
    const bookingsWhere = { status: { in: ['REQUESTED', 'DISPUTED'] } }
    const idDocumentsWhere = { idDocumentStatus: 'PENDING_REVIEW' }
    const [listings, payments, gifts, bookings, idDocuments, listingsTotal, paymentsTotal, giftsTotal, bookingsTotal, idDocumentsTotal] = await Promise.all([
      db().listing.findMany({
        where: listingsWhere,
        // Admin satisfaction audit finding: the review card showed only a title/division/status --
        // no price, host, or image, so an admin had to open "Details" for every single item just to
        // make an approve/reject call. Price is already a scalar on Listing; owner/media are
        // relations that need an explicit include to come back at all.
        include: {
          owner: { select: { id: true, displayName: true } },
          media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        },
        orderBy: { createdAt: 'asc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().paymentProof.findMany({
        where: paymentsWhere,
        include: {
          booking: {
            include: {
              listing: {
                include: {
                  // idDocumentStatus feeds the admin payout screen's host-verification label --
                  // it was previously hardcoded "Verified host" for every host regardless of real
                  // status (found by an independent re-audit).
                  owner: { select: { id: true, displayName: true, email: true, idDocumentStatus: true } },
                },
              },
            },
          },
          payer: { select: { id: true, displayName: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().walletGift.findMany({ where: giftsWhere, orderBy: { createdAt: 'asc' }, take: REVIEW_QUEUE_LIMIT }),
      db().booking.findMany({
        where: bookingsWhere,
        include: { listing: true },
        orderBy: { createdAt: 'desc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().user.findMany({
        where: idDocumentsWhere,
        select: { id: true, displayName: true, email: true, idDocumentMimeType: true, idDocumentSubmittedAt: true },
        orderBy: { idDocumentSubmittedAt: 'asc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().listing.count({ where: listingsWhere }),
      db().paymentProof.count({ where: paymentsWhere }),
      db().walletGift.count({ where: giftsWhere }),
      db().booking.count({ where: bookingsWhere }),
      db().user.count({ where: idDocumentsWhere }),
    ])

    // Resolve each advertising payment's bound campaign for display -- campaignListingId is a
    // plain string (not a Prisma relation, matching this codebase's other soft cross-references),
    // so it's enriched here rather than via `include`. Admin previously had no way to tell which
    // campaign a payment proof was for except guessing from amount/uploader.
    const campaignListingIds = payments.map((p) => p.campaignListingId).filter(Boolean)
    const campaignListings = campaignListingIds.length
      ? await db().listing.findMany({
          where: { id: { in: campaignListingIds } },
          select: { id: true, titleAr: true, titleEn: true, status: true, metadata: true },
        })
      : []
    const campaignListingById = new Map(campaignListings.map((l) => [l.id, l]))
    const paymentsWithCampaign = payments.map((p) => ({
      ...p,
      campaignListing: p.campaignListingId ? campaignListingById.get(p.campaignListingId) || null : null,
    }))

    return json(res, 200, {
      ok: true,
      queue: { listings, payments: paymentsWithCampaign, gifts, bookings, idDocuments },
      // Additive, not yet declared on the frontend's PlatformReviewQueue type -- safe for existing
      // callers (extra JSON fields are simply ignored) and ready for the frontend to surface once
      // that type is free to edit.
      queueTotals: { listings: listingsTotal, payments: paymentsTotal, gifts: giftsTotal, bookings: bookingsTotal, idDocuments: idDocumentsTotal },
    })
  }

  const idDocumentFileMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/file$/)
  if (idDocumentFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const targetUser = await db().user.findUnique({
      where: { id: idDocumentFileMatch[1] },
      select: { idDocumentRef: true, idDocumentMimeType: true },
    })
    if (!targetUser?.idDocumentRef) {
      const error = new Error('No ID document has been submitted by this user.')
      error.statusCode = 404
      error.code = 'ID_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const buffer = await readIdDocument(targetUser.idDocumentRef)

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_ID_DOCUMENT_VIEWED',
        entityType: 'user_id_document',
        entityId: idDocumentFileMatch[1],
        before: null,
        after: null,
      },
    })

    res.writeHead(200, {
      'content-type': targetUser.idDocumentMimeType || 'application/octet-stream',
      'cache-control': 'private, no-store',
    })
    res.end(buffer)
    return true
  }

  // Supports the WhatsApp/email ID-submission channel: a guest who doesn't want to upload
  // through the website sends their ID to SYBNB's WhatsApp/email directly, and an admin attaches
  // it to the right account here after finding it by the email the guest signed up with.
  if (url.pathname === '/api/admin/users/lookup') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const email = String(url.searchParams.get('email') || '').trim().toLowerCase()
    if (!email) {
      const error = new Error('An email is required to look up a customer.')
      error.statusCode = 400
      error.code = 'USER_LOOKUP_EMAIL_REQUIRED'
      error.expose = true
      throw error
    }

    const foundUser = await db().user.findUnique({
      where: { email },
      select: ID_DOCUMENT_SAFE_SELECT,
    })
    if (!foundUser) {
      const error = new Error('No account found with this email.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_USER_LOOKUP',
        entityType: 'user',
        entityId: foundUser.id,
        before: null,
        after: null,
      },
    })

    return json(res, 200, { ok: true, user: foundUser })
  }

  // SEC-002 — account status as a real security control.
  //
  // AccountStatus.SUSPENDED / DELETED have existed in the schema since the beginning with no
  // handler anywhere that could set them, so the platform's own published security rule ("Suspended
  // or deleted accounts cannot log in or use previously issued sessions") described a state the
  // product had no way to reach. These two endpoints are the enforcement hooks for that rule and
  // nothing more -- they are not an admin user-management feature, and deliberately expose only the
  // status and role transitions the revocation model has to be driven by.
  const userStatusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/)
  if (userStatusMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    // ADMIN only. SUPPORT can read the review queue but must not be able to disable accounts.
    requireAuth(context, ['ADMIN'])

    const targetUserId = userStatusMatch[1]
    const body = await readJson(req)
    const status = String(body.status || '').toUpperCase()
    if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(status)) {
      const error = new Error('status must be ACTIVE, SUSPENDED, or DELETED.')
      error.statusCode = 400
      error.code = 'INVALID_ACCOUNT_STATUS'
      error.expose = true
      throw error
    }
    // Same self-dealing principle as the 9 review paths closed in 115aa09, plus a plain lockout
    // guard: an admin suspending or deleting themselves would revoke their own credentials mid-call
    // and could leave the platform with no reachable administrator.
    assertNotInterestedParty([targetUserId], context.user.id)

    const reason = status === 'SUSPENDED'
      ? REVOCATION_REASONS.ACCOUNT_SUSPENDED
      : status === 'DELETED'
        ? REVOCATION_REASONS.ACCOUNT_DELETED
        : REVOCATION_REASONS.ACCOUNT_REINSTATED

    // setAccountStatus writes the status and revokes the account's live credentials in ONE
    // transaction. Reinstating (-> ACTIVE) revokes too: the documented policy is that a revoked
    // session never comes back, so lifting a suspension requires a fresh login rather than
    // resurrecting the token the suspension was meant to kill.
    //
    // SEC-002R Class A: suspending, deleting or reinstating an account is a privilege mutation and
    // is the exact operation finding N4 was demonstrated on -- a slow PATCH here committed a real
    // suspension after the acting admin's own session had already been revoked mid-request.
    // setAccountStatus() now accepts the caller's transaction, so the re-authorization and the
    // status write are one atomic unit with no window between them.
    const { before, after } = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_ACCOUNT_STATUS_CHANGED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [targetUserId],
      })
      return setAccountStatus(targetUserId, status, reason, { tx })
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_ACCOUNT_STATUS_CHANGED',
        entityType: 'user',
        entityId: targetUserId,
        before,
        after,
      },
    })

    return json(res, 200, { ok: true, user: after, sessionsRevoked: true })
  }

  const userRolesMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/roles$/)
  if (userRolesMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const targetUserId = userRolesMatch[1]
    const body = await readJson(req)
    const add = Array.isArray(body.add) ? body.add.map((role) => String(role).toUpperCase()) : []
    const remove = Array.isArray(body.remove) ? body.remove.map((role) => String(role).toUpperCase()) : []
    const invalid = [...add, ...remove].filter((role) => !VALID_ROLES.has(role))
    if (invalid.length) {
      const error = new Error(`Unknown role(s): ${invalid.join(', ')}.`)
      error.statusCode = 400
      error.code = 'INVALID_ROLE'
      error.expose = true
      throw error
    }
    if (!add.length && !remove.length) {
      const error = new Error('Provide at least one role to add or remove.')
      error.statusCode = 400
      error.code = 'ROLE_CHANGE_EMPTY'
      error.expose = true
      throw error
    }
    // An admin must not be able to grant themselves a role (self-dealing) or strip their own ADMIN
    // (lockout) -- both go through a second administrator, matching the 115aa09 two-party pattern.
    assertNotInterestedParty([targetUserId], context.user.id)

    const target = await db().user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!target) {
      const error = new Error('Account not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    // Role changes revoke every session for the account. Removal MUST be immediate (that is the
    // security requirement); grants revoke too so a token's authority can never silently grow
    // under a session opened before the account was trusted with the role.
    // SEC-002R Class A: granting or stripping a role is the other privilege mutation N4 applies to.
    // Same shape as the status handler above -- one transaction covering both the acting admin's
    // commit-boundary re-authorization and the role write it authorizes.
    const { before, after } = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_USER_ROLES_CHANGED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [targetUserId],
      })
      return applyRoleChange(targetUserId, { add, remove }, REVOCATION_REASONS.ROLE_CHANGED, { tx })
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_USER_ROLES_CHANGED',
        entityType: 'user',
        entityId: targetUserId,
        before: { roles: before },
        after: { roles: after },
      },
    })

    return json(res, 200, { ok: true, userId: targetUserId, roles: after, sessionsRevoked: true })
  }

  const idDocumentAdminUploadMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/upload$/)
  if (idDocumentAdminUploadMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !mimeType) {
      const error = new Error('An ID document file is required.')
      error.statusCode = 400
      error.code = 'ID_DOCUMENT_REQUIRED'
      error.expose = true
      throw error
    }

    const targetUserId = idDocumentAdminUploadMatch[1]
    const previous = await db().user.findUnique({ where: { id: targetUserId }, select: { idDocumentRef: true } })
    if (!previous) {
      const error = new Error('Customer not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    const storageKey = await saveIdDocument(fileBase64, mimeType)
    const updated = await db().user.update({
      where: { id: targetUserId },
      data: {
        idDocumentRef: storageKey,
        idDocumentMimeType: mimeType,
        idDocumentSubmittedAt: new Date(),
        idDocumentStatus: 'PENDING_REVIEW',
        idDocumentReviewedById: null,
        idDocumentReviewedAt: null,
      },
      select: ID_DOCUMENT_SAFE_SELECT,
    })

    if (previous.idDocumentRef && previous.idDocumentRef !== storageKey) {
      await deleteIdDocument(previous.idDocumentRef)
    }

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ID_DOCUMENT_UPLOADED_BY_ADMIN',
        entityType: 'iddocuments',
        entityId: targetUserId,
        before: {},
        after: updated,
      },
    })

    return json(res, 200, { ok: true, user: updated })
  }

  if (url.pathname === '/api/admin/audit-log') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100)
    const entityType = url.searchParams.get('entityType')
    const action = url.searchParams.get('action')
    const auditLog = await db().adminAuditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
      },
      include: {
        actor: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return json(res, 200, { ok: true, auditLog })
  }

  if (url.pathname === '/api/admin/platform-metrics') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const [
      usersByRole,
      listingsByDivision,
      listingsByStatus,
      bookingsByStatus,
      ridesByStatus,
      paymentsByStatus,
      giftsByStatus,
      wallets,
      approvedPaymentVolume,
    ] = await Promise.all([
      db().userRole.groupBy({ by: ['role'], _count: { _all: true } }),
      db().listing.groupBy({ by: ['division'], _count: { _all: true }, orderBy: { division: 'asc' } }),
      db().listing.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().booking.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().rideRequest.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().paymentProof.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().walletGift.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().wallet.aggregate({ _count: { _all: true }, _sum: { cachedBalanceMinor: true } }),
      db().paymentProof.aggregate({
        where: { status: 'APPROVED' },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
    ])

    return json(res, 200, {
      ok: true,
      metrics: {
        usersByRole: toCountMap(usersByRole, 'role'),
        listingsByDivision: toCountMap(listingsByDivision, 'division'),
        listingsByStatus: toCountMap(listingsByStatus, 'status'),
        bookingsByStatus: toCountMap(bookingsByStatus, 'status'),
        ridesByStatus: toCountMap(ridesByStatus, 'status'),
        paymentsByStatus: toCountMap(paymentsByStatus, 'status'),
        giftsByStatus: toCountMap(giftsByStatus, 'status'),
        walletCount: wallets._count._all,
        walletBalanceMinor: wallets._sum.cachedBalanceMinor || 0,
        approvedPaymentCount: approvedPaymentVolume._count._all,
        approvedPaymentVolumeMinor: approvedPaymentVolume._sum.amountMinor || 0,
      },
    })
  }

  const reviewMatch = url.pathname.match(/^\/api\/admin\/review-queue\/([^/]+)\/([^/]+)$/)
  if (reviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const [entityType, entityId] = reviewMatch.slice(1)
    const decision = normalizeDecision(body.decision || body.action)

    // Money-moving entity types only — listing/iddocument decisions never touch payment/wallet
    // state and are deliberately not gated by a payment policy (see payment-policy-routes.mjs).
    // An APPROVED booking decision is a pure status confirm (no wallet effect — see
    // updateReviewEntity's booking branch, only reachable for decision !== 'APPROVED'), so it's
    // intentionally excluded here rather than mislabeled as a refund.
    const normalizedEntityType = String(entityType).toLowerCase()
    let moneyMovingOperation
    if (normalizedEntityType === 'payment' || normalizedEntityType === 'payments') {
      moneyMovingOperation = decision === 'APPROVED' ? 'capture' : 'refund'
    } else if ((normalizedEntityType === 'booking' || normalizedEntityType === 'bookings') && decision !== 'APPROVED') {
      moneyMovingOperation = 'refund'
    }
    if (moneyMovingOperation) {
      authorizePaymentOperation({
        operation: moneyMovingOperation,
        rail: 'manual_proof',
        provider: 'manual',
        division: 'PLATFORM',
        country: activePolicyCountryKey(),
        environment: policyEnvironment(),
        actor: { roles: context.roles },
      })
    }

    const result = await db().$transaction(async (tx) => {
      const before = await findReviewEntity(tx, entityType, entityId)
      // SEC-002R Class A. This one dispatcher is the commit boundary for six distinct irreversible
      // decisions: payment approval (wallet HOLD + platform CREDIT + protection fee + the SELLER
      // role grant + driver fare credit, via approvePaymentProof), payment rejection, wallet-gift
      // approval/blocking (sender refund), booking confirmation/rejection (refund request +
      // reverseBookingPlatformShare), KYC/ID-document approval (which is what unlocks publishing),
      // and listing/advertising-campaign approval. All of them write inside THIS transaction, so
      // one re-authorization here covers every branch and no future 7th branch can be added past
      // it. Self-dealing is deliberately NOT passed here: updateReviewEntity() already re-reads the
      // entity inside this same transaction and calls assertNoSelfReview() on that fresh row, which
      // is itself a commit-boundary check -- duplicating it against a staler copy would be weaker,
      // not stronger.
      await reauthorizeAtCommit(tx, context, {
        action: `REVIEW_${decision}`,
        requiredRoles: ['ADMIN'],
      })
      const after = await updateReviewEntity(tx, entityType, entityId, decision, context.user.id, body)
      const auditLog = await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `REVIEW_${decision}`,
          entityType,
          entityId,
          before: before || {},
          after: after || {},
        },
      })
      return { entity: after, auditLog }
    })
    return json(res, 200, { ok: true, ...result })
  }

  return false
}

function toCountMap(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = row._count._all
    return acc
  }, {})
}

function normalizeDecision(value) {
  const decision = String(value || 'APPROVE').toUpperCase()
  if (decision === 'APPROVE' || decision === 'APPROVED') return 'APPROVED'
  if (decision === 'REJECT' || decision === 'REJECTED') return 'REJECTED'

  const error = new Error('decision must be APPROVE or REJECT.')
  error.statusCode = 400
  error.code = 'INVALID_REVIEW_DECISION'
  error.expose = true
  throw error
}

const ID_DOCUMENT_SAFE_SELECT = {
  id: true,
  displayName: true,
  email: true,
  idDocumentRef: true,
  idDocumentMimeType: true,
  idDocumentSubmittedAt: true,
  idDocumentStatus: true,
  idDocumentReviewedById: true,
  idDocumentReviewedAt: true,
}

function reviewModel(entityType) {
  const normalized = String(entityType || '').toLowerCase()
  if (normalized === 'listing' || normalized === 'listings') return 'listing'
  if (normalized === 'payment' || normalized === 'payments') return 'paymentProof'
  if (normalized === 'gift' || normalized === 'gifts') return 'walletGift'
  if (normalized === 'booking' || normalized === 'bookings') return 'booking'
  if (normalized === 'iddocument' || normalized === 'iddocuments') return 'user'

  const error = new Error('Unsupported review entity type.')
  error.statusCode = 400
  error.code = 'UNSUPPORTED_REVIEW_ENTITY'
  error.expose = true
  throw error
}

async function findReviewEntity(tx, entityType, entityId) {
  const model = reviewModel(entityType)
  // The 'user' model backs ID-document review — never return the full row (password hash, phone
  // hash) into an audit log or API response; only the fields relevant to document review.
  if (model === 'user') {
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }
  return tx[model].findUnique({ where: { id: entityId } })
}

// Centralized "who has a material interest in this entity" resolver. A real audit found the
// self-review guard only covered 'listing' and 'paymentProof' -- 'walletGift', 'user' (KYC), and
// 'booking' had no check at all, and each was independently exploitable live (an admin self-
// approved their own ID document, self-approved their own wallet gift above the anti-fraud review
// threshold, and self-confirmed their own booking including its refund/reversal logic). A 6th
// review type added later would silently reintroduce this exact gap if the check stayed three
// separate inline `if`s instead of one resolver every branch is required to call. Applies
// uniformly to BOTH decisions (APPROVED and REJECTED) -- the conflict of interest in ruling on
// your own submission doesn't depend on which way you rule.
function interestedPartyIds(model, entity) {
  if (model === 'listing') return [entity.ownerId] // listing owner
  if (model === 'paymentProof') return [entity.userId] // payment submitter
  if (model === 'walletGift') return [entity.senderUserId, entity.recipientUserId].filter(Boolean) // sender (refunded if blocked) + recipient (financial beneficiary if approved)
  if (model === 'user') return [entity.id] // the KYC subject IS the reviewed entity
  if (model === 'booking') return [entity.guestId, entity.listing?.ownerId].filter(Boolean) // booking guest (requester) + listing owner (host, financially affected by confirm/cancel)
  throw new Error(`interestedPartyIds: unhandled review model '${model}'`)
}

// Lower-level primitive the review-queue models above build on -- also used directly by the 4
// ADMIN-only money-moving endpoints below (payout release, finalize-cancellation, refund execute,
// legacy-refund-accept) that sit OUTSIDE the review-queue dispatcher entirely and had NO
// self-dealing check of any kind before this fix. Same underlying risk (an admin who also holds
// a HOST/SELLER/GUEST role directing money to themselves), different code shape, one shared
// assertion so it can't drift into 4 separately-written (and separately-forgettable) checks.
function assertNotInterestedParty(interestedIds, actorUserId) {
  if (interestedIds.includes(actorUserId)) throw selfReviewError()
}

function assertNoSelfReview(model, entity, actorUserId) {
  assertNotInterestedParty(interestedPartyIds(model, entity), actorUserId)
}

async function updateReviewEntity(tx, entityType, entityId, decision, actorUserId, body) {
  const model = reviewModel(entityType)
  const note = body.adminNote || body.note || undefined

  if (model === 'listing') {
    const existing = await tx.listing.findUnique({ where: { id: entityId } })
    if (!existing || existing.status !== 'PENDING_REVIEW') throw reviewStateError('LISTING_NOT_REVIEWABLE')
    assertNoSelfReview('listing', existing, actorUserId)
    // Re-check status in the WHERE clause so two concurrent decisions on the same listing can't
    // both apply (same TOCTOU class as the payment-proof and SR-ride races fixed earlier).
    const updated = await tx.listing.updateMany({
      where: { id: entityId, status: 'PENDING_REVIEW' },
      data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' },
    })
    if (updated.count === 0) throw reviewStateError('LISTING_NOT_REVIEWABLE')
    // A rejected advertising campaign never ran -- release its bound payment (rather than leaving
    // it permanently consumed by a dead campaign) so the same, still-valid payment can back a
    // retry. An APPROVED campaign needs no action here: the binding set at creation time simply
    // stays, which is what makes it genuinely consumed going forward.
    if (decision === 'REJECTED' && existing.metadata?.advertising === true) {
      await tx.paymentProof.updateMany({
        where: { campaignListingId: entityId },
        data: { campaignListingId: null },
      })
    }
    return tx.listing.findUnique({ where: { id: entityId } })
  }

  if (model === 'paymentProof') {
    const existing = await tx.paymentProof.findUnique({
      where: { id: entityId },
      include: {
        booking: {
          include: {
            listing: true,
          },
        },
      },
    })
    if (!existing || existing.status !== 'PENDING_ADMIN_REVIEW') throw reviewStateError('PAYMENT_NOT_REVIEWABLE')
    assertNoSelfReview('paymentProof', existing, actorUserId)
    const shamCashReconciliation = decision === 'APPROVED' && isShamCashProvider(existing.provider)
      ? requireShamCashReconciliation(existing, body)
      : null
    const adminNote = [
      note,
      shamCashReconciliation
        ? `Sham Cash reconciled server-side: expected=${shamCashReconciliation.expectedMinor}, account=${shamCashReconciliation.accountMinor}, difference=${shamCashReconciliation.differenceMinor}, source=${shamCashReconciliation.source}.`
        : '',
    ].filter(Boolean).join('\n') || undefined

    if (decision === 'APPROVED') {
      return approvePaymentProof(tx, { proofId: entityId, actorUserId, note: adminNote })
    }

    const rejectResult = await tx.paymentProof.updateMany({
      where: { id: entityId, status: 'PENDING_ADMIN_REVIEW' },
      data: {
        status: 'REJECTED',
        reviewedById: actorUserId,
        reviewedAt: new Date(),
        adminNote,
      },
    })
    if (rejectResult.count === 0) throw reviewStateError('PAYMENT_REVIEW_CONFLICT')
    const rejected = await tx.paymentProof.findUnique({ where: { id: entityId } })

    if (!existing.bookingId && existing.provider === 'seller_plan') {
      await tx.sellerProfile.update({
        where: { userId: existing.userId },
        data: { documentStatus: 'REJECTED' },
      })
    }

    return rejected
  }

  if (model === 'walletGift') {
    const existing = await tx.walletGift.findUnique({ where: { id: entityId } })
    if (!existing || !['CLAIM_PENDING', 'LOCKED'].includes(existing.status)) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    assertNoSelfReview('walletGift', existing, actorUserId)
    const updated = await tx.walletGift.updateMany({
      where: { id: entityId, status: existing.status },
      data: { status: decision === 'APPROVED' ? 'SENT' : 'ADMIN_BLOCKED' },
    })
    if (updated.count === 0) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    // The sender was debited atomically when the gift was created (server/routes/wallet.mjs). A
    // blocked gift must never just vanish that money — refund the sender in the same transaction as
    // the block decision, exactly like a rejected payment proof triggers a refund elsewhere.
    if (decision !== 'APPROVED') {
      await recordWalletEntry(tx, {
        userId: existing.senderUserId,
        type: 'REFUND',
        amountMinor: existing.amountMinor,
        currency: existing.currency,
        referenceType: 'wallet_gift_blocked',
        referenceId: existing.id,
        keyParts: ['wallet-gift-blocked-refund', existing.id],
        note: 'Wallet gift blocked by admin review; sender refunded.',
      })
    }
    return tx.walletGift.findUnique({ where: { id: entityId } })
  }

  if (model === 'user') {
    const existing = await tx.user.findUnique({ where: { id: entityId }, select: { id: true, idDocumentStatus: true } })
    if (!existing || existing.idDocumentStatus !== 'PENDING_REVIEW') throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    assertNoSelfReview('user', existing, actorUserId)
    const updated = await tx.user.updateMany({
      where: { id: entityId, idDocumentStatus: 'PENDING_REVIEW' },
      data: {
        idDocumentStatus: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        idDocumentReviewedById: actorUserId,
        idDocumentReviewedAt: new Date(),
      },
    })
    if (updated.count === 0) throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }

  const existing = await tx.booking.findUnique({
    where: { id: entityId },
    include: { payments: true, listing: true },
  })
  if (!existing || !['REQUESTED', 'DISPUTED'].includes(existing.status)) throw reviewStateError('BOOKING_NOT_REVIEWABLE')
  assertNoSelfReview('booking', existing, actorUserId)
  const updatedBooking = await tx.booking.updateMany({
    where: { id: entityId, status: existing.status },
    data: { status: decision === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED' },
  })
  if (updatedBooking.count === 0) throw reviewStateError('BOOKING_NOT_REVIEWABLE')

  // Rejecting a REQUESTED booking or ruling against the host in a DISPUTED one both cancel a
  // booking that already has an approved payment (the HOLD/admin-share CREDIT were created back
  // when the payment proof was approved, well before this decision). Without reversing them here,
  // the guest's money and the admin's commission are stranded forever with no other code path that
  // ever cleans them up — this mirrors the guest/host-initiated cancellation reversal in
  // bookings.mjs and host.mjs, but with a full refund (no cancellation fee) since the guest didn't
  // choose to cancel.
  if (decision !== 'APPROVED') {
    const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')
    if (approvedPayment) {
      // Card-network payments (Stripe Checkout, the electronic PaymentIntent rail) never had their
      // money enter the platform's own wallet ledger — it went to the card network directly. This
      // app has no real provider-side refund call anywhere, so crediting the guest's wallet here
      // would represent money the platform doesn't actually hold for this payment, unlike a manual
      // proof (local wallet / Sham Cash / bank transfer) where the guest's money genuinely is the
      // platform's liability to return. Mirrors the same principle applyPaymentIntentRefund already
      // establishes for the provider-confirmed refund path — a card payment needs a REAL refund
      // issued through the provider directly, not a wallet credit standing in for one.
      const isCardPayment = ['stripe', 'payment_intent'].includes(approvedPayment.provider)

      await tx.paymentProof.updateMany({
        where: {
          bookingId: existing.id,
          status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
        },
        data: {
          status: 'REFUNDED',
          adminNote: isCardPayment
            ? 'Admin rejected/ruled against this booking. Card payment — issue the real refund through the payment provider directly; no wallet credit was recorded.'
            : 'Auto-refunded after admin rejected/ruled against this booking.',
          reviewedById: actorUserId,
          reviewedAt: new Date(),
        },
      })

      if (!isCardPayment) {
        // Item 2 Phase 2b round 2: creates a Refund + initial RefundAttempt instead of an immediate
        // wallet credit -- owner-confirmed replacement; fulfillment deferred to a later phase.
        // reasonCode distinguishes an admin rejecting a still-REQUESTED booking from a ruling
        // against the host in an already-DISPUTED one -- existing.status is the ORIGINAL status,
        // captured before this transaction's own booking.updateMany above.
        await createRefundRequest(tx, {
          paymentProofId: approvedPayment.id,
          bookingId: existing.id,
          requestedByUserId: actorUserId,
          amountMinor: approvedPayment.amountMinor,
          currency: existing.currency,
          reason: 'Guest refund after admin rejected/ruled against this booking.',
          reasonCode: existing.status === 'DISPUTED' ? 'DISPUTE_RULING' : 'ADMIN_REJECTED_BOOKING',
        })
      }

      // Reverses the platform's own position (admin-share CREDIT, and a host payout clawback if
      // it was already RELEASED) — shared with the PaymentIntent refund webhook path so both
      // reversal routes stay in lockstep instead of two independent implementations drifting.
      await reverseBookingPlatformShare(tx, {
        booking: existing,
        approvedPayment,
        keyPrefix: 'booking-admin-reject',
        adminShareReversalNote: 'Admin/SYBNB share reversed because the admin rejected/ruled against this booking.',
        payoutClawbackNote: 'Host payout clawed back after admin rejected/ruled against this booking post-release.',
      })
    }
  }

  return tx.booking.findUnique({ where: { id: entityId } })
}

function reviewStateError(code) {
  const error = new Error('Entity is not in a reviewable state.')
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

function selfReviewError() {
  const error = new Error('An admin cannot approve or reject their own submission.')
  error.statusCode = 403
  error.code = 'SELF_REVIEW_FORBIDDEN'
  error.expose = true
  return error
}

function isShamCashProvider(provider) {
  const value = String(provider || '').toUpperCase()
  return value.includes('SHAM') || value.includes('LOCAL_WALLET') || value.includes('SYRIAN_LOCAL_WALLET')
}

function minorValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : null
}

function requireShamCashReconciliation(paymentProof, body) {
  const packet = body.shamCashReconciliation || body.shamCash || {}
  const accountMinor = minorValue(packet.accountMinor ?? body.shamCashAccountMinor)
  const expectedMinor = minorValue(packet.expectedMinor ?? body.shamCashExpectedMinor)
  const differenceMinor = minorValue(packet.differenceMinor ?? body.shamCashDifferenceMinor)
  const source = String(packet.source || body.shamCashSource || 'admin-ui')

  if (accountMinor == null || expectedMinor == null || differenceMinor == null) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_REQUIRED',
      'Sham Cash reconciliation is required before approving this payment.',
      409,
    )
  }

  const computedDifference = accountMinor - expectedMinor
  if (computedDifference !== differenceMinor || differenceMinor !== 0 || expectedMinor < Math.round(paymentProof.amountMinor || 0)) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_MISMATCH',
      'Sham Cash account balance does not match the expected SYBNB payment amount.',
      409,
    )
  }

  return { accountMinor, expectedMinor, differenceMinor, source }
}

function throwShamCashError(code, message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}
