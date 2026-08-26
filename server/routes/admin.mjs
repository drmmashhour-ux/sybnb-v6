import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, bookingFinanceSplit, recordWalletEntry, reverseBookingPlatformShare } from '../lib/finance-ledger.mjs'
import { completeExpiredBookings, isPayoutEligible, payoutEligibleAt, PAYOUT_HOLD_DAYS } from '../lib/booking-lifecycle.mjs'
import { expireStaleWalletGifts } from '../lib/gift-lifecycle.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'
import { idempotencyKey } from '../lib/security.mjs'

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
      const freshBooking = await tx.booking.findUnique({ where: { id: booking.id } })
      if (!freshBooking || !isPayoutEligible(freshBooking)) {
        const error = new Error(
          `Payout is not eligible for release yet. It must be COMPLETED and past the ${PAYOUT_HOLD_DAYS}-day hold, with no open dispute.`,
        )
        error.statusCode = 400
        error.code = 'PAYOUT_NOT_ELIGIBLE'
        error.expose = true
        throw error
      }

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

      // Step 5: transfer reserved -> accepted on the payment proof. Must affect EXACTLY one row;
      // anything else is an anomaly (not a normal race outcome, since Step 1 already confirmed
      // reservation validity) and rolls back Steps 1-4 too. Uses ONLY claimedRefund's own fields,
      // never a caller-supplied proof id or amount.
      const transferred = await tx.paymentProof.updateMany({
        where: { id: claimedRefund.paymentProofId, reservedRefundMinor: { gte: claimedRefund.amountMinor } },
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
    const [listings, payments, gifts, bookings, idDocuments] = await Promise.all([
      db().listing.findMany({ where: { status: 'PENDING_REVIEW' }, take: 25 }),
      db().paymentProof.findMany({
        where: { status: 'PENDING_ADMIN_REVIEW' },
        include: {
          booking: {
            include: {
              listing: {
                include: {
                  owner: { select: { id: true, displayName: true, email: true } },
                },
              },
            },
          },
          payer: { select: { id: true, displayName: true, email: true } },
        },
        take: 25,
      }),
      db().walletGift.findMany({ where: { status: { in: ['CLAIM_PENDING', 'LOCKED'] } }, take: 25 }),
      db().booking.findMany({
        where: { status: { in: ['REQUESTED', 'DISPUTED'] } },
        include: { listing: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      db().user.findMany({
        where: { idDocumentStatus: 'PENDING_REVIEW' },
        select: { id: true, displayName: true, email: true, idDocumentMimeType: true, idDocumentSubmittedAt: true },
        take: 25,
      }),
    ])
    return json(res, 200, { ok: true, queue: { listings, payments, gifts, bookings, idDocuments } })
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

async function updateReviewEntity(tx, entityType, entityId, decision, actorUserId, body) {
  const model = reviewModel(entityType)
  const note = body.adminNote || body.note || undefined

  if (model === 'listing') {
    const existing = await tx.listing.findUnique({ where: { id: entityId } })
    if (!existing || existing.status !== 'PENDING_REVIEW') throw reviewStateError('LISTING_NOT_REVIEWABLE')
    // Re-check status in the WHERE clause so two concurrent decisions on the same listing can't
    // both apply (same TOCTOU class as the payment-proof and SR-ride races fixed earlier).
    const updated = await tx.listing.updateMany({
      where: { id: entityId, status: 'PENDING_REVIEW' },
      data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' },
    })
    if (updated.count === 0) throw reviewStateError('LISTING_NOT_REVIEWABLE')
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
    const existing = await tx.user.findUnique({ where: { id: entityId }, select: { idDocumentStatus: true } })
    if (!existing || existing.idDocumentStatus !== 'PENDING_REVIEW') throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
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
        await recordWalletEntry(tx, {
          userId: existing.guestId,
          type: 'REFUND',
          amountMinor: approvedPayment.amountMinor,
          currency: existing.currency,
          referenceType: 'booking_refund',
          referenceId: existing.id,
          keyParts: ['booking-admin-reject-refund', existing.id, approvedPayment.id],
          note: 'Guest refund after admin rejected/ruled against this booking.',
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
