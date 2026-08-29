import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import {
  bookingFinanceSplit,
  cancellationAdminFee,
  createRefundRequest,
  readListingFees,
} from '../lib/finance-ledger.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'

export async function handleBookings(req, res, url, context) {
  const cancelMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/)
  if (cancelMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const existing = await db().booking.findFirst({
      where: {
        id: cancelMatch[1],
        guestId: context.user.id,
      },
      include: { listing: true, payments: true },
    })

    if (!existing) {
      const error = new Error('Booking not found for this guest account.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!['REQUESTED', 'CONFIRMED'].includes(existing.status)) {
      const error = new Error('Only requested or confirmed bookings can be cancelled by the guest.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_CANCELLABLE'
      error.expose = true
      throw error
    }

    // Item 2 Phase 2b round 3: creating the refund REQUEST (createRefundRequest, below) moves zero
    // money -- verified exhaustively since round 2 -- so it is genuinely safe for the booking's own
    // guest to trigger directly. It no longer shares a gate with the commission-reversal and
    // cancellation-fee wallet entries (real money movement), which now happen only via a separate,
    // ADMIN-only finalize action (see PATCH /api/admin/bookings/:id/finalize-cancellation in
    // admin.mjs) -- see finalizeCancellationLedgerEffects() in finance-ledger.mjs. This is what
    // resolves the previously-disclosed gap where a real guest could never actually cancel a paid
    // booking at all (the old bundled 'refund' operation was ADMIN-only end to end).
    if (existing.payments.some((payment) => payment.status === 'APPROVED')) {
      authorizePaymentOperation({
        operation: 'refund_request',
        rail: 'manual_proof',
        provider: 'manual',
        division: existing.listing.division,
        country: activePolicyCountryKey(),
        environment: policyEnvironment(),
        actor: { roles: context.roles },
      })
    }

    const booking = await db().$transaction(async (tx) => {
      const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')
      const split = bookingFinanceSplit(existing, approvedPayment?.amountMinor || existing.amountMinor)

      if (approvedPayment) {
        const protectedByAddOn = split.cancellationProtectionPurchased
        const guestRefundAmountMinor = protectedByAddOn
          ? Math.max(0, approvedPayment.amountMinor - split.cancellationProtectionFeeMinor)
          : approvedPayment.amountMinor

        await tx.paymentProof.updateMany({
          where: {
            bookingId: existing.id,
            status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
          },
          data: {
            status: 'REFUNDED',
            adminNote: 'Auto-refunded after guest cancelled the booking.',
            reviewedById: context.user.id,
            reviewedAt: new Date(),
          },
        })

        // Item 2 Phase 2b round 2: creates a Refund + initial RefundAttempt (the new, reviewed data
        // model) instead of an immediate wallet credit -- owner-confirmed replacement, not additive;
        // actual fulfillment is deferred to a later phase that adds real outbound execution. Amount
        // computation (guestRefundAmountMinor, protection-fee-adjusted) is completely unchanged from
        // before this round. Guarded on > 0 to match recordWalletEntry's own prior silent-no-op for
        // a zero amount (the edge case where the protection fee fully consumes the payment) --
        // createRefundRequest itself throws on a non-positive amount rather than no-op, since a
        // real, non-legacy Refund row for zero money is never a meaningful thing to create.
        if (guestRefundAmountMinor > 0) {
          await createRefundRequest(tx, {
            paymentProofId: approvedPayment.id,
            bookingId: existing.id,
            requestedByUserId: context.user.id,
            amountMinor: guestRefundAmountMinor,
            currency: existing.currency,
            reason: 'Guest refund after guest cancelled a protected booking.',
            reasonCode: 'GUEST_CANCELLED',
          })
        }

        // Item 2 Phase 2b round 3: the admin-share-reversal DEBIT and cancellation-fee DEBIT/CREDIT
        // that used to post right here, inline, atomically with the guest's own action, now happen
        // ONLY via the separate ADMIN-only finalize-cancellation action -- see
        // finalizeCancellationLedgerEffects() in finance-ledger.mjs. Zero wallet entries are created
        // by this transaction; that is the whole point of the actor-policy split above.
      }

      return tx.booking.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED' },
        include: {
          guest: {
            select: {
              id: true,
              displayName: true,
              email: true,
            },
          },
          payments: true,
          listing: true,
        },
      })
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'BOOKING_GUEST_CANCELLED',
        entityType: 'bookings',
        entityId: booking.id,
        before: existing,
        after: {
          ...booking,
          cancellationNote: body.note || body.reason || undefined,
          cancellationFee: {
            amountMinor: booking.metadata?.cancellationProtectionPurchased === true ? 0 : cancellationAdminFee(booking.currency).amountMinor,
            currency: cancellationAdminFee(booking.currency).currency,
            chargedTo: 'GUEST',
            waivedByProtection: booking.metadata?.cancellationProtectionPurchased === true,
            // Item 2 Phase 2b round 3: this amount is no longer charged inline here -- it (and the
            // admin-share reversal) now posts only via a separate ADMIN-only finalize action.
            status: 'PENDING_ADMIN_FINALIZATION',
          },
        },
      },
    })

    return json(res, 200, { ok: true, booking })
  }

  const disputeMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/dispute$/)
  if (disputeMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const existing = await db().booking.findFirst({
      where: {
        id: disputeMatch[1],
        guestId: context.user.id,
      },
      include: { listing: true, payments: true },
    })

    if (!existing) {
      const error = new Error('Booking not found for this guest account.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!['CONFIRMED', 'COMPLETED'].includes(existing.status)) {
      const error = new Error('Only confirmed or completed bookings can be disputed.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_DISPUTABLE'
      error.expose = true
      throw error
    }

    const booking = await db().booking.update({
      where: { id: existing.id },
      data: { status: 'DISPUTED' },
      include: {
        guest: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
        listing: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        payments: true,
      },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'BOOKING_DISPUTED',
        entityType: 'bookings',
        entityId: booking.id,
        before: existing,
        after: {
          ...booking,
          disputeNote: body.note || body.reason || undefined,
        },
      },
    })

    return json(res, 200, { ok: true, booking })
  }

  const bookingMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)$/)
  if (bookingMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const booking = await db().booking.findUnique({
      where: { id: bookingMatch[1] },
      include: {
        guest: {
          select: {
            id: true,
            displayName: true,
            email: true,
            idDocumentRef: true,
            idDocumentSubmittedAt: true,
          },
        },
        listing: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        review: true,
      },
    })

    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!isBookingViewable(booking, context)) {
      const error = new Error('This booking is not available for this account.')
      error.statusCode = 403
      error.code = 'BOOKING_FORBIDDEN'
      error.expose = true
      throw error
    }

    // A security audit found this leaked the guest's raw idDocumentRef (an internal storage key)
    // to the booking's HOST too (isBookingViewable allows both), not just the guest/admin -- the
    // host has no legitimate need to see the actual key, only whether one exists (BookingDetailPage
    // .tsx's hasIdDocument = Boolean(booking?.guest?.idDocumentRef) only ever needs a truthy
    // signal). Not independently exploitable today (no route accepts an arbitrary storage key; the
    // real document-retrieval routes are scoped to the document owner or require a signature the
    // host doesn't have), but worth minimizing as real defense in depth -- redact the value, not
    // the field, so the existing has-a-document UI keeps working. idDocumentSubmittedAt (a plain
    // date, not a storage key) is left as-is. Only ADMIN/SUPPORT get the real ref, and they read it
    // via the admin review-queue for that anyway, not this route.
    const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
    const sanitized =
      isStaff || !booking.guest?.idDocumentRef
        ? booking
        : { ...booking, guest: { ...booking.guest, idDocumentRef: 'submitted' } }

    return json(res, 200, { ok: true, booking: sanitized })
  }

  if (url.pathname !== '/api/bookings') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  requireAuth(context, ['GUEST'])
  const body = await readJson(req)
  const checkIn = body.checkIn ? new Date(body.checkIn) : undefined
  const checkOut = body.checkOut ? new Date(body.checkOut) : undefined
  if ((checkIn && Number.isNaN(checkIn.getTime())) || (checkOut && Number.isNaN(checkOut.getTime())) || (checkIn && checkOut && checkOut <= checkIn)) {
    const error = new Error('Booking dates must be valid and check-out must be after check-in.')
    error.statusCode = 400
    error.code = 'BOOKING_DATES_INVALID'
    error.expose = true
    throw error
  }

  const listing = await db().listing.findFirst({
    where: {
      id: body.listingId,
      status: 'APPROVED',
    },
  })

  if (!listing) {
    const error = new Error('Listing is not available for booking.')
    error.statusCode = 404
    error.code = 'LISTING_NOT_BOOKABLE'
    error.expose = true
    throw error
  }

  const isShortStay = listing.division === 'STAYS'

  // The overlap check and the create used to be two separate, unguarded round-trips: two guests
  // requesting the same listing/dates within a race window could both pass the check before
  // either committed, double-booking the listing. A DB-level exclusion constraint would need raw
  // DDL (btree_gist), so instead we serialize concurrent requests for the same listing with a
  // transaction-scoped Postgres advisory lock — same bug class already fixed for SR rides and
  // wallet gifts, adapted here since there's no single row to re-check inside a WHERE clause.
  const booking = await db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${listing.id}))`

    if (checkIn && checkOut) {
      const [overlappingBooking, blockedDate] = await Promise.all([
        tx.booking.findFirst({
          where: {
            listingId: listing.id,
            status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] },
            checkIn: { lt: checkOut },
            checkOut: { gt: checkIn },
          },
        }),
        tx.listingAvailability.findFirst({
          where: {
            listingId: listing.id,
            status: 'BLOCKED',
            date: { gte: checkIn, lt: checkOut },
          },
        }),
      ])

      if (overlappingBooking || blockedDate) {
        const error = new Error('These dates are no longer available for this listing.')
        error.statusCode = 409
        error.code = 'BOOKING_DATES_UNAVAILABLE'
        error.expose = true
        throw error
      }
    }

    const quote = isShortStay && checkIn && checkOut
      ? await computeStayTotalMinor(listing, checkIn, checkOut)
      : { totalMinor: listing.priceMinor, nights: 0, perNight: [] }

    return tx.booking.create({
      data: {
        listingId: listing.id,
        guestId: context.user.id,
        status: 'PAYMENT_PENDING',
        checkIn,
        checkOut,
        amountMinor: quote.totalMinor,
        currency: listing.currency,
        metadata: buildBookingMetadata(body, listing),
      },
    })
  })

  return json(res, 201, { ok: true, booking })
}

export function isBookingViewable(booking, context) {
  return (
    context.roles.includes('ADMIN') ||
    context.roles.includes('SUPPORT') ||
    booking.guestId === context.user.id ||
    booking.listing.ownerId === context.user.id
  )
}

function buildBookingMetadata(body, listing) {
  const protection = body.cancellationProtectionPurchased === true || body.cancellationProtection === true
  const metadata = {}
  if (protection) {
    // Always compute the protection fee server-side (3% of listing price). Never trust a client-
    // submitted premium — it flows into the charge and the ledger, so a guest could otherwise set
    // their own add-on amount.
    metadata.cancellationProtectionPurchased = true
    metadata.cancellationProtectionFeeMinor = Math.round(Number(listing.priceMinor || 0) * 0.03)
    metadata.cancellationProtectionVersion = 'SYBNB_GUEST_CANCELLATION_PROTECTION_V1'
  }
  // Snapshot the listing's itemized fees as they stand right now, at booking-creation time — see
  // the comment on bookingFinanceSplit's feeSnapshot read for why this must never be recomputed
  // from the listing's later (possibly edited) metadata. Only written when the listing actually
  // has at least one explicit fee set; older-style fixed-percentage listings keep working exactly
  // as before with no snapshot (expectedTotalMinor/bookingFinanceSplit both fall back correctly).
  if (listing.division === 'STAYS') {
    const fees = readListingFees(listing.metadata || {})
    if (fees.cleaningFeeMinor || fees.taxesMinor || fees.serviceFeeMinor || fees.parkingFeeMinor) {
      metadata.feeSnapshot = fees
    }
  }
  return metadata
}
