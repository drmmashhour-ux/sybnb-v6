import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import {
  CANCELLATION_POLICY_VERSION,
  bookingFinanceSplit,
  createRefundRequest,
  expectedTotalMinor,
  readListingFees,
} from '../lib/finance-ledger.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { bookingPolicySettings } from '../lib/country.mjs'
import {
  bookingExpiresAt,
  computeCancellation,
  computeGuestTotals,
  dateBlockingBookingWhere,
  hasStayEnded,
  protectionFeeMinor,
} from '../lib/booking-policy.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { formatMoney, notifyBooking } from '../lib/notifications.mjs'
import { clientIp, isRateLimited } from '../lib/rateLimit.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'
// SEC-002R round 2. The fresh, from-scratch mutation sweep this round required classified guest
// cancellation as Class A: it marks real payment proofs REFUNDED and calls createRefundRequest(),
// which RESERVES refund capacity against the payment proof's own ledger counters -- an irreversible
// commitment of real money, made by a non-admin actor, in a handler whose authority was established
// long before the transaction opens. See server/lib/commit-authorization.mjs.
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'

// Public quote rate limit: generous (a guest flipping dates/protection on a listing page), keyed per
// IP, same shared bucket store as the other public routes.
const QUOTE_RATE_WINDOW_MS = 60_000
const QUOTE_RATE_MAX = Number(process.env.BOOKING_QUOTE_RATE_MAX || 120)

export async function handleBookings(req, res, url, context) {
  // Money-flow decision 5 (2026-10-08): the single source of the numbers a guest sees before
  // booking. Same arithmetic as booking creation + every payment rail (computeGuestTotals via
  // expectedTotalMinor), so the quoted total is exactly what will be charged.
  if (url.pathname === '/api/bookings/quote') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    if (await isRateLimited(`booking-quote:${clientIp(req)}`, QUOTE_RATE_WINDOW_MS, QUOTE_RATE_MAX)) {
      return json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many quote requests. Try again shortly.' } })
    }
    const listingId = String(url.searchParams.get('listingId') || '')
    const { checkIn, checkOut } = parseStayDates(url.searchParams.get('checkIn'), url.searchParams.get('checkOut'))
    const protection = ['1', 'true'].includes(String(url.searchParams.get('protection') || '0').toLowerCase())
    const listing = listingId ? await db().listing.findFirst({ where: { id: listingId, status: 'APPROVED' } }) : null
    if (!listing) {
      const error = new Error('Listing is not available for booking.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    const isShortStay = listing.division === 'STAYS'
    const stay = isShortStay && checkIn && checkOut
      ? await computeStayTotalMinor(listing, checkIn, checkOut)
      : { totalMinor: listing.priceMinor, nights: 0 }
    const totals = computeGuestTotals({
      stayMinor: stay.totalMinor,
      fees: readListingFees(listing.metadata || {}),
      extraFeesMinor: metadataMinor(listing.metadata, 'extraFeesMinor'),
      isShortStay,
      protection,
    })
    let reason
    if (isDemoListing(listing)) reason = 'LISTING_NOT_BOOKABLE'
    else if (context?.user?.id && listing.ownerId === context.user.id) reason = 'OWN_LISTING'
    else if (checkIn && checkOut && (await datesUnavailable(db(), listing.id, checkIn, checkOut))) reason = 'BOOKING_DATES_UNAVAILABLE'
    return json(res, 200, {
      ok: true,
      quote: {
        nights: stay.nights,
        stayMinor: totals.stayMinor,
        cleaningMinor: totals.cleaningMinor,
        taxesMinor: totals.taxesMinor,
        otherFeesMinor: totals.otherFeesMinor,
        protectionMinor: totals.protectionMinor,
        totalMinor: totals.totalMinor,
        commissionMinor: totals.commissionMinor,
        hostShareMinor: totals.hostShareMinor,
        currency: listing.currency,
        bookable: !reason,
        ...(reason ? { reason } : {}),
      },
    })
  }

  const cancelQuoteMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/cancel-quote$/)
  if (cancelQuoteMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['GUEST'])
    const existing = await findGuestBooking(cancelQuoteMatch[1], context.user.id)
    await assertStayNotEnded(existing)
    const { cancellation } = guestCancellationFor(existing)
    return json(res, 200, {
      ok: true,
      cancelQuote: {
        refundMinor: cancellation.refundMinor,
        retainedMinor: cancellation.retainedMinor,
        rule: cancellation.rule,
        deadline: cancellation.deadline,
        currency: existing.currency,
      },
    })
  }

  const cancelMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/)
  if (cancelMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const existing = await findGuestBooking(cancelMatch[1], context.user.id)
    // Review fix (HIGH): COMPLETED is only set lazily, so a CONFIRMED booking whose stay is already
    // over must be refused here -- otherwise the post-check-in 50% rule would refund a used stay.
    await assertStayNotEnded(existing)

    // Decision 3: an unpaid request (PAYMENT_PENDING) can now also be cancelled by its guest --
    // nothing to refund. REQUESTED/CONFIRMED follow the refund rules below.
    if (!['PAYMENT_PENDING', 'REQUESTED', 'CONFIRMED'].includes(existing.status)) {
      const error = new Error('Only unpaid, requested or confirmed bookings can be cancelled by the guest.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_CANCELLABLE'
      error.expose = true
      throw error
    }
    // A transfer receipt already under admin review means money may have been sent but is not yet
    // verified -- cancelling now would leave that transfer with no refund path. Wait for the review.
    if (existing.status === 'PAYMENT_PENDING' && existing.payments.some((payment) => payment.status === 'PENDING_ADMIN_REVIEW')) {
      const error = new Error('Your payment receipt is being reviewed. You can cancel once the review is done.')
      error.statusCode = 409
      error.code = 'PAYMENT_UNDER_REVIEW'
      error.expose = true
      throw error
    }
    const { cancellation, approvedPayment: approvedAtRead } = guestCancellationFor(existing)

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
      // SEC-002R Class A. First statement in the transaction, before the proof status rewrite and
      // before createRefundRequest() reserves anything: proves the cancelling guest's session is
      // still live, their account still ACTIVE, their epoch still current and GUEST still held,
      // under the user_sessions/users locks that stop a concurrent revocation from landing inside
      // this window. A failure throws and Postgres rolls back everything below it.
      await reauthorizeAtCommit(tx, context, {
        action: 'BOOKING_GUEST_CANCELLED',
        requiredRoles: ['GUEST'],
      })
      // Re-read the booking's status inside the transaction and claim it with a conditional update
      // first: two concurrent cancels (or a cancel racing the expiry sweep / a host decision) must
      // not both create refund requests or both rewrite the proofs.
      const claimed = await tx.booking.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status: 'CANCELLED' },
      })
      if (claimed.count !== 1) {
        const error = new Error('This booking changed while you were cancelling it. Refresh and try again.')
        error.statusCode = 409
        error.code = 'BOOKING_STATE_CHANGED'
        error.expose = true
        throw error
      }
      const approvedPayment = approvedAtRead

      // Review fix (LOW): re-check for a live proof INSIDE the transaction, after the status claim
      // above has locked the booking row. A receipt submitted between the outer read and the claim
      // must still block an unpaid cancel (same rule as the pre-check above).
      if (!approvedPayment) {
        const liveProof = await tx.paymentProof.findFirst({
          where: { bookingId: existing.id, status: { in: ['PENDING_ADMIN_REVIEW', 'APPROVED'] } },
          select: { id: true },
        })
        if (liveProof) {
          const error = new Error('A payment for this booking is being reviewed or was just approved. Refresh and try again.')
          error.statusCode = 409
          error.code = 'PAYMENT_UNDER_REVIEW'
          error.expose = true
          throw error
        }
      }

      if (!approvedPayment) {
        // Unpaid: just cancel. A never-uploaded placeholder proof (PENDING_PROOF) is closed out.
        await tx.paymentProof.updateMany({
          where: { bookingId: existing.id, status: 'PENDING_PROOF' },
          data: { status: 'REJECTED', adminNote: 'Booking cancelled by the guest before payment.' },
        })
      }

      if (approvedPayment) {
        // Decision 3 (owner, 2026-10-08): the refund is whatever the cancellation rule says --
        // regular price: 100% if >= 72h before check-in 00:00 (country time), else 50%; protected
        // price: 100% minus the protection fee until check-in 00:00, else 50% of (paid - fee).
        const guestRefundAmountMinor = cancellation.refundMinor

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
            reason: `Guest refund after guest cancelled the booking (${cancellation.rule}).`,
            reasonCode: 'GUEST_CANCELLED',
          })
        }

        // Item 2 Phase 2b round 3: the admin-share-reversal DEBIT and cancellation-fee DEBIT/CREDIT
        // that used to post right here, inline, atomically with the guest's own action, now happen
        // ONLY via the separate ADMIN-only finalize-cancellation action -- see
        // finalizeCancellationLedgerEffects() in finance-ledger.mjs. Zero wallet entries are created
        // by this transaction; that is the whole point of the actor-policy split above.
      }

      // The rule this cancellation was decided under is snapshotted server-side on the booking:
      // admin finalize-cancellation reads it to post the retained-amount split (12% commission /
      // 88% host on the retained stay part) instead of a full reversal.
      return tx.booking.update({
        where: { id: existing.id },
        data: {
          metadata: {
            ...(existing.metadata || {}),
            cancellation: {
              policyVersion: CANCELLATION_POLICY_VERSION,
              cancelledBy: 'GUEST',
              cancelledAt: new Date().toISOString(),
              ...cancellation,
              paidMinor: approvedPayment?.amountMinor || 0,
              // Review fix (LOW): finalize-cancellation settles against exactly this proof.
              approvedProofId: approvedPayment?.id || null,
            },
          },
        },
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
          // Decision 3 replaces the legacy guest cancellation fee for cancellations made under the
          // new rules: the refund amount below is the whole consequence for the guest.
          cancellationRule: {
            rule: cancellation.rule,
            refundMinor: cancellation.refundMinor,
            retainedMinor: cancellation.retainedMinor,
            deadline: cancellation.deadline,
            status: approvedAtRead ? 'PENDING_ADMIN_FINALIZATION' : 'NOTHING_TO_SETTLE',
          },
        },
      },
    })

    notifyBooking('guest_booking_cancelled', booking.id, {
      refund: cancellation.refundMinor ? formatMoney(cancellation.refundMinor, booking.currency) : '',
    })
    if (existing.status !== 'PAYMENT_PENDING') notifyBooking('host_booking_cancelled', booking.id)

    return json(res, 200, {
      ok: true,
      booking: withExpiry(booking),
      refund: {
        rule: cancellation.rule,
        refundMinor: cancellation.refundMinor,
        retainedMinor: cancellation.retainedMinor,
        currency: booking.currency,
      },
    })
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

    return json(res, 200, { ok: true, booking: withExpiry(sanitized) })
  }

  if (url.pathname !== '/api/bookings') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  requireAuth(context, ['GUEST'])
  const body = await readJson(req)
  const { checkIn, checkOut } = parseStayDates(body.checkIn, body.checkOut)

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

  // Decision 7: demo/sample inventory is never bookable, and a host cannot book their own listing.
  if (isDemoListing(listing)) {
    const error = new Error('This is a demo listing and cannot be booked.')
    error.statusCode = 409
    error.code = 'LISTING_NOT_BOOKABLE'
    error.expose = true
    throw error
  }
  if (listing.ownerId === context.user.id) {
    const error = new Error('You cannot book your own listing.')
    error.statusCode = 409
    error.code = 'OWN_LISTING'
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

    // Decision 6: a stale unpaid request (PAYMENT_PENDING past the expiry window with no live
    // proof) no longer blocks these dates, even before the expiry sweep has marked it CANCELLED.
    if (checkIn && checkOut && (await datesUnavailable(tx, listing.id, checkIn, checkOut))) {
      const error = new Error('These dates are no longer available for this listing.')
      error.statusCode = 409
      error.code = 'BOOKING_DATES_UNAVAILABLE'
      error.expose = true
      throw error
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
        metadata: buildBookingMetadata(body, listing, quote.totalMinor),
      },
    })
  })

  notifyBooking('guest_request_received', booking.id, {
    total: formatMoney(expectedTotalMinor({ ...booking, listing }), booking.currency),
    expiryHours: bookingPolicySettings().unpaidExpiryHours,
    expiresAt: bookingExpiresAt(booking, bookingPolicySettings()) || '',
  })

  return json(res, 201, { ok: true, booking: withExpiry(booking) })
}

// --- helpers ------------------------------------------------------------------------------------

function isDemoListing(listing) {
  return listing?.metadata?.demo === true
}

function metadataMinor(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function parseStayDates(rawCheckIn, rawCheckOut) {
  const checkIn = rawCheckIn ? new Date(rawCheckIn) : undefined
  const checkOut = rawCheckOut ? new Date(rawCheckOut) : undefined
  if ((checkIn && Number.isNaN(checkIn.getTime())) || (checkOut && Number.isNaN(checkOut.getTime())) || (checkIn && checkOut && checkOut <= checkIn)) {
    const error = new Error('Booking dates must be valid and check-out must be after check-in.')
    error.statusCode = 400
    error.code = 'BOOKING_DATES_INVALID'
    error.expose = true
    throw error
  }
  return { checkIn, checkOut }
}

// True when an active booking or a host-blocked day overlaps [checkIn, checkOut). Active = REQUESTED
// / CONFIRMED, or PAYMENT_PENDING still inside its payment window or with a live proof/intent.
async function datesUnavailable(client, listingId, checkIn, checkOut) {
  const [overlappingBooking, blockedDate] = await Promise.all([
    client.booking.findFirst({
      where: {
        listingId,
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
        ...dateBlockingBookingWhere(new Date(), bookingPolicySettings()),
      },
      select: { id: true },
    }),
    client.listingAvailability.findFirst({
      where: {
        listingId,
        status: 'BLOCKED',
        date: { gte: checkIn, lt: checkOut },
      },
      select: { id: true },
    }),
  ])
  return Boolean(overlappingBooking || blockedDate)
}

// Adds `expiresAt` (createdAt + the unpaid-expiry window) while a booking is PAYMENT_PENDING.
function withExpiry(booking) {
  if (!booking) return booking
  const expiresAt = bookingExpiresAt(booking, bookingPolicySettings())
  return expiresAt ? { ...booking, expiresAt } : booking
}

async function findGuestBooking(id, guestId) {
  const existing = await db().booking.findFirst({
    where: { id, guestId },
    include: { listing: true, payments: true, paymentIntents: { select: { status: true } } },
  })
  if (!existing) {
    const error = new Error('Booking not found for this guest account.')
    error.statusCode = 404
    error.code = 'BOOKING_NOT_FOUND'
    error.expose = true
    throw error
  }
  return existing
}

// Refuses (409 BOOKING_STAY_ENDED) once the check-out date has begun in country time, and runs the
// lazy completion sweep for this booking so its status catches up to COMPLETED.
async function assertStayNotEnded(booking) {
  if (!hasStayEnded(booking, { policy: bookingPolicySettings() })) return
  await completeExpiredBookings({ id: booking.id }).catch(() => {})
  const error = new Error('This stay has already ended and can no longer be cancelled. Open a dispute if something went wrong.')
  error.statusCode = 409
  error.code = 'BOOKING_STAY_ENDED'
  error.expose = true
  throw error
}

// Decision 3 applied to a guest's own cancellation of `booking` right now.
function guestCancellationFor(booking, now = new Date()) {
  const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
  const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)
  const cancellation = computeCancellation({
    paidMinor: approvedPayment?.amountMinor || 0,
    protectionPurchased: split.cancellationProtectionPurchased,
    protectionMinor: split.cancellationProtectionFeeMinor,
    checkIn: booking.checkIn,
    now,
    cancelledBy: 'GUEST',
    isShortStay: !booking.listing || booking.listing.division === 'STAYS',
    policy: bookingPolicySettings(),
  })
  return { cancellation, approvedPayment, split }
}


export function isBookingViewable(booking, context) {
  return (
    context.roles.includes('ADMIN') ||
    context.roles.includes('SUPPORT') ||
    booking.guestId === context.user.id ||
    booking.listing.ownerId === context.user.id
  )
}

function buildBookingMetadata(body, listing, stayTotalMinor) {
  const protection = body.cancellationProtectionPurchased === true || body.cancellationProtection === true
  const metadata = {}
  if (protection) {
    // Always compute the protection fee server-side. Never trust a client-submitted premium — it
    // flows into the charge and the ledger, so a guest could otherwise set their own add-on amount.
    // Decision 5 (2026-10-08): 3% of the FULL stay amount (all nights, before cleaning/taxes) --
    // previously 3% of ONE night's listing price, which under-charged every multi-night stay and
    // disagreed with the frontend. Same figure as GET /api/bookings/quote's protectionMinor.
    metadata.cancellationProtectionPurchased = true
    metadata.cancellationProtectionFeeMinor = protectionFeeMinor(stayTotalMinor)
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
  // Persist the guest's acceptance of the short-term-rental agreement (the UI hard-blocks the
  // booking until it is ticked, and that agreement binds the guest to the commission / in-platform-
  // payment / dispute terms). It was previously sent by the client but never recorded — a silent
  // no-op on a legally meaningful consent. Record WHAT was accepted and WHEN.
  if (body.acceptedTerms === true) {
    metadata.guestAgreementAcceptedAt = new Date().toISOString()
    metadata.guestAgreementVersion = String(body.termsVersion || 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1')
  }
  return metadata
}
