import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { resolveListingCityName } from '../lib/listing-location.mjs'
import { bookingPolicySettings, defaultCurrency, isCurrencyAllowed, payoutMethodConfig } from '../lib/country.mjs'
import {
  CANCELLATION_POLICY_VERSION,
  bookingFinanceSplit,
  buildPayoutRow,
  createPayoutRequest,
  createRefundRequest,
  hostPayoutBalances,
} from '../lib/finance-ledger.mjs'
import { computeCancellation, hasStayEnded } from '../lib/booking-policy.mjs'
import { formatMoney, notifyAdmin, notifyBooking } from '../lib/notifications.mjs'
import { isRateLimited } from '../lib/rateLimit.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { expireOldListings } from '../lib/listing-lifecycle.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'
// SEC-002R round 2. The fresh mutation sweep classified the host's own confirm/cancel decision as
// Class A for the same reason the guest's cancellation is: cancelling marks real payment proofs
// REFUNDED and calls createRefundRequest(), which reserves refund capacity against the proof's
// ledger counters. See server/lib/commit-authorization.mjs.
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'

export async function handleHost(req, res, url, context) {
  if (url.pathname === '/api/host/earnings') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['HOST', 'SELLER'])

    await completeExpiredBookings({ listing: { ownerId: context.user.id } })

    // Scale-readiness audit: this was `checkOut: 'asc'` + `take: 200` -- always the OLDEST 200
    // qualifying bookings, with no pagination. Once any single host accumulates more than 200
    // CONFIRMED/COMPLETED/DISPUTED bookings, their newest earnings silently stopped appearing on
    // their own earnings page -- exactly backwards, and it hits the platform's most successful
    // hosts first. Flipped to newest-first; the frontend (HostEarningsPage.tsx) just renders
    // whatever order the API returns with no re-sort, so this is a pure backend fix.
    const bookings = await db().booking.findMany({
      where: {
        listing: { ownerId: context.user.id },
        status: { in: ['CONFIRMED', 'COMPLETED', 'DISPUTED'] },
      },
      include: { listing: true, payments: true },
      orderBy: { checkOut: 'desc' },
      take: 200,
    })

    const releasedBookingIds = new Set(
      (
        await db().walletEntry.findMany({
          where: {
            referenceType: 'booking_payout',
            type: 'RELEASE',
            referenceId: { in: bookings.map((booking) => booking.id) },
          },
          select: { referenceId: true },
        })
      ).map((entry) => entry.referenceId),
    )

    const rows = bookings.map((booking) => buildPayoutRow(booking, releasedBookingIds))

    const totals = rows.reduce(
      (acc, row) => {
        if (row.status === 'CONFIRMED') {
          acc.forecastedMinor += row.hostGrossMinor
        } else if (row.status === 'COMPLETED') {
          acc.grossEarnedMinor += row.hostGrossMinor
          if (row.payoutStatus === 'RELEASED') acc.releasedMinor += row.hostGrossMinor
          else acc.pendingMinor += row.hostGrossMinor
        }
        return acc
      },
      { forecastedMinor: 0, grossEarnedMinor: 0, releasedMinor: 0, pendingMinor: 0 },
    )

    return json(res, 200, {
      ok: true,
      earnings: {
        rows,
        totals: { ...totals, currency: rows[0]?.currency || defaultCurrency() },
      },
    })
  }

  if (url.pathname === '/api/host/overview') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

    requireAuth(context, ['HOST', 'SELLER'])

    await completeExpiredBookings({ listing: { ownerId: context.user.id } })
    await expireOldListings({ ownerId: context.user.id })

    const listings = await db().listing.findMany({
      where: { ownerId: context.user.id },
      include: {
        bookings: {
          where: {
            status: {
              not: 'PAYMENT_PENDING',
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
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
        media: true,
        location: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    // Unpaid requests are hidden from the host while PAYMENT_PENDING; keep them hidden once they end
    // unpaid (expired by the unpaid sweep, or cancelled by the guest before paying).
    const endedUnpaid = (booking) =>
      booking.status === 'CANCELLED' &&
      (booking.metadata?.cancellationReason === 'EXPIRED_UNPAID' || booking.metadata?.cancellation?.rule === 'UNPAID')
    const requests = listings.flatMap((listing) =>
      listing.bookings.filter((booking) => !endedUnpaid(booking)).map((booking) => ({
        ...booking,
        listing: {
          id: listing.id,
          division: listing.division,
          titleAr: listing.titleAr,
          titleEn: listing.titleEn,
          priceMinor: listing.priceMinor,
          currency: listing.currency,
          status: listing.status,
        },
      })),
    )

    const totals = {
      listings: listings.length,
      approvedListings: listings.filter((listing) => listing.status === 'APPROVED').length,
      pendingListings: listings.filter((listing) => listing.status === 'PENDING_REVIEW').length,
      requests: requests.length,
      requested: requests.filter((booking) => booking.status === 'REQUESTED').length,
      confirmed: requests.filter((booking) => booking.status === 'CONFIRMED').length,
      revenueMinor: requests
        .filter((booking) => booking.status === 'CONFIRMED')
        .reduce((sum, booking) => sum + booking.amountMinor, 0),
    }

    return json(res, 200, {
      ok: true,
      overview: {
        host: {
          id: context.user.id,
          email: context.user.email,
          displayName: context.user.displayName,
          roles: context.roles,
          idDocumentStatus: context.user.idDocumentStatus,
        },
        totals,
        listings,
        requests,
      },
    })
  }

  const requestMatch = url.pathname.match(/^\/api\/host\/requests\/([^/]+)$/)
  if (requestMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['HOST', 'SELLER'])
    const body = await readJson(req)
    const status = normalizeHostDecision(body.decision || body.status)
    const existing = await db().booking.findFirst({
      where: {
        id: requestMatch[1],
        listing: { ownerId: context.user.id },
      },
      include: { listing: true, payments: true },
    })

    if (!existing) {
      const error = new Error('Request not found for this host account.')
      error.statusCode = 404
      error.code = 'HOST_REQUEST_NOT_FOUND'
      error.expose = true
      throw error
    }

    const canConfirm = status === 'CONFIRMED' && existing.status === 'REQUESTED'
    const canCancel = status === 'CANCELLED' && ['REQUESTED', 'CONFIRMED'].includes(existing.status)

    if (!canConfirm && !canCancel) {
      const error = new Error('This booking cannot be changed by the host at its current status.')
      error.statusCode = 400
      error.code = 'HOST_REQUEST_NOT_DECIDABLE'
      error.expose = true
      throw error
    }

    // Review fix: once the check-out date has begun (country time) the stay is used -- a host
    // "cancel" would refund a finished stay in full. Refuse like the guest cancel route does.
    if (canCancel && hasStayEnded(existing, { policy: bookingPolicySettings() })) {
      const error = new Error('This stay has already ended and can no longer be cancelled.')
      error.statusCode = 409
      error.code = 'BOOKING_STAY_ENDED'
      error.expose = true
      throw error
    }

    if (canConfirm && body.acceptedTerms !== true) {
      const error = new Error('Host must accept SYBNB rules and conditions before confirming this booking.')
      error.statusCode = 400
      error.code = 'HOST_TERMS_REQUIRED'
      error.expose = true
      throw error
    }

    // Item 2 Phase 2b round 3: creating the refund REQUEST (createRefundRequest, below) moves zero
    // money -- verified exhaustively since round 2 -- so it is genuinely safe for the booking's own
    // host to trigger directly. It no longer shares a gate with the commission-reversal and
    // cancellation-fee wallet entries (real money movement), which now happen only via a separate,
    // ADMIN-only finalize action (see PATCH /api/admin/bookings/:id/finalize-cancellation in
    // admin.mjs) -- see finalizeCancellationLedgerEffects() in finance-ledger.mjs. This is what
    // resolves the previously-disclosed gap where a real host could never actually cancel a paid
    // booking at all (the old bundled 'refund' operation was ADMIN-only end to end).
    if (status === 'CANCELLED' && existing.payments.some((payment) => payment.status === 'APPROVED')) {
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
      // SEC-002R Class A. Runs before the proof rewrite and before createRefundRequest() reserves
      // anything, under the user_sessions/users locks. Roles mirror this route's own requireAuth
      // list exactly (['HOST', 'SELLER']) -- a host who loses HOST mid-request must not be able to
      // land a cancellation that commits the platform to a refund.
      await reauthorizeAtCommit(tx, context, {
        action: `HOST_${status}`,
        requiredRoles: ['HOST', 'SELLER'],
      })
      const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')

      if (status === 'CANCELLED') {
        await tx.paymentProof.updateMany({
          where: {
            bookingId: existing.id,
            status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
          },
          data: {
            status: 'REFUNDED',
            adminNote: 'Auto-refunded after host cancelled the booking.',
            reviewedById: context.user.id,
            reviewedAt: new Date(),
          },
        })

        // Item 2 Phase 2b round 2: creates a Refund + initial RefundAttempt instead of an immediate
        // wallet credit -- owner-confirmed replacement; fulfillment deferred to a later phase.
        // Guarded on a REAL approvedPayment existing: Refund.paymentProofId is a real, non-null FK,
        // so there is structurally no proof to attach a refund to when no payment was ever
        // approved. This also closes a real, pre-existing defect the old fallback
        // (`approvedPayment?.amountMinor || existing.amountMinor`) had: a host cancelling a booking
        // with NO approved payment would still wallet-credit the guest for the booking's full
        // LISTED price -- crediting money that was never actually paid.
        if (approvedPayment) {
          await createRefundRequest(tx, {
            paymentProofId: approvedPayment.id,
            bookingId: existing.id,
            requestedByUserId: context.user.id,
            amountMinor: approvedPayment.amountMinor,
            currency: existing.currency,
            reason: 'Guest refund after host cancelled a protected booking.',
            reasonCode: 'HOST_CANCELLED',
          })
        }

        // Item 2 Phase 2b round 3: the admin-share-reversal DEBIT and cancellation-fee DEBIT/CREDIT
        // that used to post right here, inline, atomically with the host's own action -- previously
        // UNGUARDED on approvedPayment existing at all, a real pre-existing money-creation defect
        // for a never-paid booking, flagged but explicitly left unfixed in round 2 -- now happen
        // ONLY via the separate ADMIN-only finalize-cancellation action (see
        // finalizeCancellationLedgerEffects() in finance-ledger.mjs), which structurally requires a
        // real REFUNDED payment proof to exist. That requirement closes the old unguarded-fallback
        // defect as a side effect of this round's restructuring, the same way round 2's own
        // `if (approvedPayment)` guard did for the refund-request call above it. Zero wallet
        // entries are created by this transaction; that is the whole point of the actor-policy
        // split above.
      }

      // Payout is intentionally NOT released here. Confirming only means the host accepted the
      // booking; the payout stays held until the stay completes, the 2-week hold passes, and an
      // admin explicitly releases it via /api/admin/payouts (see host-payout-release.mjs).

      // Decision 3 (2026-10-08): a host cancel/decline refunds the guest 100% incl. the protection
      // fee. Snapshot the rule on the booking so admin finalize-cancellation also reverses the
      // protection-fee credit (the legacy path never did, although the refund already included it).
      const hostCancellation = status === 'CANCELLED'
        ? {
            policyVersion: CANCELLATION_POLICY_VERSION,
            cancelledBy: 'HOST',
            cancelledAt: new Date().toISOString(),
            declined: existing.status === 'REQUESTED',
            ...computeCancellation({
              paidMinor: approvedPayment?.amountMinor || 0,
              protectionPurchased: bookingFinanceSplit(existing, approvedPayment?.amountMinor || existing.amountMinor).cancellationProtectionPurchased,
              protectionMinor: bookingFinanceSplit(existing, approvedPayment?.amountMinor || existing.amountMinor).cancellationProtectionFeeMinor,
              checkIn: existing.checkIn,
              cancelledBy: 'HOST',
              isShortStay: existing.listing.division === 'STAYS',
              policy: bookingPolicySettings(),
            }),
            paidMinor: approvedPayment?.amountMinor || 0,
            approvedProofId: approvedPayment?.id || null,
          }
        : null

      // Guarded on the status read before the transaction so two concurrent decisions (host
      // double-click, or a guest cancelling at the same moment) cannot both apply.
      const claimed = await tx.booking.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status },
      })
      if (claimed.count !== 1) {
        const error = new Error('This booking changed while you were deciding. Refresh and try again.')
        error.statusCode = 409
        error.code = 'BOOKING_STATE_CHANGED'
        error.expose = true
        throw error
      }

      return tx.booking.update({
        where: { id: existing.id },
        data: hostCancellation
          ? { status, metadata: { ...(existing.metadata || {}), cancellation: hostCancellation } }
          : { status },
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
        action: `HOST_${status}`,
        entityType: 'bookings',
        entityId: booking.id,
        before: existing,
        after: {
          ...booking,
          termsAcceptance: canConfirm
            ? {
                accepted: true,
                version: body.termsVersion || 'SYBNB_HOST_BOOKING_RULES_V1',
                acceptedAt: new Date().toISOString(),
                acceptedByUserId: context.user.id,
              }
            : undefined,
        },
      },
    })

    if (status === 'CONFIRMED') {
      notifyBooking('guest_host_accepted', booking.id)
    } else {
      const refundMinor = booking.metadata?.cancellation?.refundMinor || 0
      notifyBooking(existing.status === 'REQUESTED' ? 'guest_host_declined' : 'guest_booking_cancelled', booking.id, {
        refund: refundMinor ? formatMoney(refundMinor, booking.currency) : '',
      })
    }

    return json(res, 200, { ok: true, booking })
  }

  // --- Decision 2 (2026-10-08): host payout method + withdrawal requests ---------------------------
  if (url.pathname === '/api/host/payout-method') {
    requireAuth(context, ['HOST', 'SELLER'])
    if (req.method === 'GET') {
      const row = await db().hostPayoutMethod.findUnique({ where: { userId: context.user.id } })
      return json(res, 200, { ok: true, method: toPayoutMethodShape(row) })
    }
    if (req.method === 'PUT') {
      const body = await readJson(req)
      const { type, details } = normalizePayoutMethod(body)
      const before = await db().hostPayoutMethod.findUnique({ where: { userId: context.user.id } })
      const row = await db().hostPayoutMethod.upsert({
        where: { userId: context.user.id },
        create: { userId: context.user.id, type, details },
        update: { type, details },
      })
      await db().adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'HOST_PAYOUT_METHOD_SAVED',
          entityType: 'host_payout_methods',
          entityId: row.id,
          before: before ? maskPayoutMethod(toPayoutMethodShape(before)) : null,
          after: maskPayoutMethod(toPayoutMethodShape(row)),
        },
      })
      return json(res, 200, { ok: true, method: toPayoutMethodShape(row) })
    }
    return methodNotAllowed(res, ['GET', 'PUT'])
  }

  if (url.pathname === '/api/host/payouts') {
    requireAuth(context, ['HOST', 'SELLER'])
    const currency = resolvePayoutCurrency(url.searchParams.get('currency'))
    if (req.method === 'GET') {
      const balances = await db().$transaction((tx) => hostPayoutBalances(tx, { userId: context.user.id, currency }))
      const requests = await db().payoutRequest.findMany({
        where: { hostId: context.user.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return json(res, 200, {
        ok: true,
        availableMinor: balances.availableMinor,
        pendingMinor: balances.pendingMinor,
        currency,
        requests: requests.map(toPayoutRequestShape),
      })
    }
    if (req.method === 'POST') {
      if (await isRateLimited(`host-payout-request:${context.user.id}`, 60 * 60 * 1000, Number(process.env.HOST_PAYOUT_REQUEST_RATE_MAX || 10))) {
        return json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many payout requests. Try again later.' } })
      }
      const body = await readJson(req)
      const amountMinor = Number(body.amountMinor)
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        const error = new Error('amountMinor must be a positive whole number.')
        error.statusCode = 400
        error.code = 'PAYOUT_AMOUNT_INVALID'
        error.expose = true
        throw error
      }
      const requestCurrency = resolvePayoutCurrency(body.currency || url.searchParams.get('currency'))
      const methodRow = await db().hostPayoutMethod.findUnique({ where: { userId: context.user.id } })
      if (!methodRow) {
        const error = new Error('Add a payout method before requesting a withdrawal.')
        error.statusCode = 409
        error.code = 'PAYOUT_METHOD_REQUIRED'
        error.expose = true
        throw error
      }
      const method = toPayoutMethodShape(methodRow)
      const request = await db().$transaction(async (tx) => {
        const created = await createPayoutRequest(tx, { hostId: context.user.id, amountMinor, currency: requestCurrency, method })
        await tx.adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: 'HOST_PAYOUT_REQUESTED',
            entityType: 'payout_requests',
            entityId: created.id,
            before: null,
            after: { ...created, method: maskPayoutMethod(method) },
          },
        })
        return created
      })
      notifyAdmin('admin_payout_request', {
        amount: formatMoney(amountMinor, requestCurrency),
        method: method.type,
        hostName: context.user.displayName || context.user.id,
      }, `admin_payout_request:${request.id}`)
      return json(res, 201, { ok: true, request: toPayoutRequestShape(request) })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const checkinMatch = url.pathname.match(/^\/api\/host\/requests\/([^/]+)\/checkin$/)
  if (checkinMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['HOST', 'SELLER'])
    const body = await readJson(req)
    const action = normalizeCheckpointAction(body.action)
    const existing = await db().booking.findFirst({
      where: {
        id: checkinMatch[1],
        listing: { ownerId: context.user.id },
      },
    })

    if (!existing) {
      const error = new Error('Request not found for this host account.')
      error.statusCode = 404
      error.code = 'HOST_REQUEST_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!['CONFIRMED', 'COMPLETED'].includes(existing.status)) {
      const error = new Error('Guest check-in/out can only be marked for confirmed or completed bookings.')
      error.statusCode = 400
      error.code = 'HOST_CHECKPOINT_NOT_ALLOWED'
      error.expose = true
      throw error
    }

    if (action === 'CHECK_OUT' && !existing.guestCheckedInAt) {
      const error = new Error('Mark the guest as checked in before marking them checked out.')
      error.statusCode = 400
      error.code = 'HOST_CHECKIN_REQUIRED_FIRST'
      error.expose = true
      throw error
    }

    const now = new Date()
    const booking = await db().booking.update({
      where: { id: existing.id },
      data: action === 'CHECK_IN' ? { guestCheckedInAt: now } : { guestCheckedOutAt: now },
      include: {
        guest: { select: { id: true, displayName: true, email: true } },
        payments: true,
        listing: true,
      },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: action === 'CHECK_IN' ? 'HOST_GUEST_CHECKIN' : 'HOST_GUEST_CHECKOUT',
        entityType: 'bookings',
        entityId: booking.id,
        before: existing,
        after: booking,
      },
    })

    return json(res, 200, { ok: true, booking })
  }

  const availabilityMatch = url.pathname.match(/^\/api\/host\/listings\/([^/]+)\/availability$/)
  if (availabilityMatch) {
    requireAuth(context, ['HOST', 'SELLER'])
    const listingId = availabilityMatch[1]
    const existing = await db().listing.findFirst({
      where: { id: listingId, ownerId: context.user.id },
    })

    if (!existing) {
      const error = new Error('Listing not found for this host account.')
      error.statusCode = 404
      error.code = 'HOST_LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (req.method === 'GET') {
      const { from, to } = parseDateRangeParams(url.searchParams)
      const rows = await db().listingAvailability.findMany({
        where: { listingId, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      })
      return json(res, 200, { ok: true, availability: rows })
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req)
      const dates = normalizeAvailabilityDates(body.dates)
      const rows = await db().$transaction(
        dates.map((entry) =>
          db().listingAvailability.upsert({
            where: { listingId_date: { listingId, date: entry.date } },
            create: {
              listingId,
              date: entry.date,
              status: entry.status,
              priceOverrideMinor: entry.priceOverrideMinor,
              note: entry.note,
            },
            update: {
              status: entry.status,
              priceOverrideMinor: entry.priceOverrideMinor,
              note: entry.note,
            },
          }),
        ),
      )

      await db().adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'HOST_LISTING_AVAILABILITY_UPDATED',
          entityType: 'listing_availability',
          entityId: listingId,
          before: null,
          after: { dates: rows },
        },
      })

      return json(res, 200, { ok: true, availability: rows })
    }

    return methodNotAllowed(res, ['GET', 'PATCH'])
  }

  // Edit (PATCH) or remove (DELETE) a listing. Editing content re-enters review so an approved
  // listing can't be silently changed post-approval; delete is blocked when bookings exist.
  // ADMIN may also edit here (e.g. fixing/adjusting a host's price or itemized fees) — deliberately
  // routed through this exact same validation/merge/audit path rather than a second admin-only
  // editor, so there is only ever one place that decides what a valid listing edit looks like.
  const listingEditMatch = url.pathname.match(/^\/api\/host\/listings\/([^/]+)$/)
  if (listingEditMatch) {
    requireAuth(context, ['HOST', 'SELLER', 'ADMIN'])
    const isAdminActor = context.roles.includes('ADMIN')
    const existing = await db().listing.findFirst({
      where: isAdminActor ? { id: listingEditMatch[1] } : { id: listingEditMatch[1], ownerId: context.user.id },
    })
    if (!existing) {
      const error = new Error('Listing not found for this host account.')
      error.statusCode = 404
      error.code = 'HOST_LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req)
      const data = {}
      if (body.titleAr !== undefined) {
        if (String(body.titleAr).trim().length < 3) {
          const error = new Error('Listing title is required.')
          error.statusCode = 400
          error.code = 'LISTING_TITLE_REQUIRED'
          error.expose = true
          throw error
        }
        data.titleAr = String(body.titleAr).trim()
      }
      if (body.titleEn !== undefined) data.titleEn = body.titleEn || null
      if (body.description !== undefined) data.description = body.description || null
      if (body.currency !== undefined) {
        const currency = String(body.currency).toUpperCase()
        if (!isCurrencyAllowed(currency)) {
          const error = new Error(`Currency '${currency}' is not supported for this country.`)
          error.statusCode = 400
          error.code = 'LISTING_CURRENCY_NOT_ALLOWED'
          error.expose = true
          throw error
        }
        data.currency = currency
      }
      if (body.metadata !== undefined) {
        // Merge, not replace — a partial patch (e.g. just one field) must not silently wipe unrelated
        // keys already on the listing (visualFilters, bedrooms/bathrooms, uploaded document/ad file
        // references, etc.) that this specific edit never intended to touch.
        data.metadata = { ...(existing.metadata || {}), ...(body.metadata || {}) }
        // Keep the Location relation in sync if the edit changes governorate/area — otherwise city
        // browse silently goes stale after an edit (M2).
        const govSource = data.metadata?.governorate
        if (govSource) {
          const cityName = resolveListingCityName(govSource)
          if (cityName) {
            const location = await db().location.create({
              data: { country: 'SY', governorate: cityName, city: cityName, area: data.metadata?.area ? String(data.metadata.area) : undefined },
            })
            data.locationId = location.id
          }
        }
      }
      if (body.priceMinor !== undefined) {
        const priceMinor = Number(body.priceMinor)
        if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
          const error = new Error('Listing price must be greater than zero.')
          error.statusCode = 400
          error.code = 'LISTING_PRICE_INVALID'
          error.expose = true
          throw error
        }
        data.priceMinor = priceMinor
      }
      // A content edit to a live/approved listing sends it back through admin review.
      if (Object.keys(data).length && ['APPROVED', 'REJECTED', 'EXPIRED'].includes(existing.status)) {
        data.status = 'PENDING_REVIEW'
      }
      const listing = await db().listing.update({ where: { id: existing.id }, data })
      await db().adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: isAdminActor ? 'ADMIN_LISTING_EDIT' : 'HOST_LISTING_EDIT',
          entityType: 'listings',
          entityId: listing.id,
          before: existing,
          after: listing,
        },
      })
      return json(res, 200, { ok: true, listing })
    }

    if (req.method === 'DELETE') {
      // Deliberately host-only, even though ADMIN can edit above — deleting is far more destructive
      // than adjusting a price/fee, and wasn't part of what was asked for. An admin who needs a
      // listing removed should reject it through the normal review flow instead.
      if (isAdminActor) {
        const error = new Error('Admins cannot delete a listing through this route.')
        error.statusCode = 403
        error.code = 'ADMIN_LISTING_DELETE_NOT_ALLOWED'
        error.expose = true
        throw error
      }
      // Booking has no onDelete cascade/restrict override on its listing relation (Prisma defaults to
      // DB-level RESTRICT), so ANY booking history — not just active statuses — would make the delete
      // below fail with an opaque 500 from the FK constraint. Check for any booking at all and give a
      // clean, actionable error; this also preserves booking/financial history, which should never be
      // silently destroyed by deleting the listing it references.
      const anyBooking = await db().booking.findFirst({
        where: { listingId: existing.id },
        select: { id: true },
      })
      if (anyBooking) {
        const error = new Error('This listing has booking history and cannot be deleted; pause it instead.')
        error.statusCode = 409
        error.code = 'HOST_LISTING_HAS_BOOKINGS'
        error.expose = true
        throw error
      }
      await db().listing.delete({ where: { id: existing.id } })
      await db().adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'HOST_LISTING_DELETE', entityType: 'listings', entityId: existing.id, before: existing, after: null },
      })
      return json(res, 200, { ok: true, deleted: existing.id })
    }

    return methodNotAllowed(res, ['PATCH', 'DELETE'])
  }

  const listingMatch = url.pathname.match(/^\/api\/host\/listings\/([^/]+)\/status$/)
  if (listingMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['HOST', 'SELLER'])
    const body = await readJson(req)
    const status = normalizeHostListingStatus(body.status || body.action)
    const existing = await db().listing.findFirst({
      where: {
        id: listingMatch[1],
        ownerId: context.user.id,
      },
    })

    if (!existing) {
      const error = new Error('Listing not found for this host account.')
      error.statusCode = 404
      error.code = 'HOST_LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }

    // A host may only toggle a LIVE listing between APPROVED (visible) and PAUSED. They must NOT be
    // able to self-approve a DRAFT/PENDING_REVIEW/REJECTED/EXPIRED listing into APPROVED — publishing
    // goes through admin review only. This closes a moderation-bypass hole.
    const transitionAllowed =
      (status === 'PAUSED' && existing.status === 'APPROVED') ||
      (status === 'APPROVED' && existing.status === 'PAUSED')
    if (!transitionAllowed) {
      const error = new Error('Hosts can only pause a live listing or resume a paused one; publishing requires admin review.')
      error.statusCode = 409
      error.code = 'HOST_STATUS_TRANSITION_NOT_ALLOWED'
      error.expose = true
      throw error
    }

    const listing = await db().listing.update({
      where: { id: existing.id },
      data: { status },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: `HOST_LISTING_${status}`,
        entityType: 'listings',
        entityId: listing.id,
        before: existing,
        after: listing,
      },
    })

    return json(res, 200, { ok: true, listing })
  }

  const instantBookMatch = url.pathname.match(/^\/api\/host\/listings\/([^/]+)\/instant-book$/)
  if (instantBookMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['HOST', 'SELLER'])
    const body = await readJson(req)
    const existing = await db().listing.findFirst({
      where: {
        id: instantBookMatch[1],
        ownerId: context.user.id,
      },
    })

    if (!existing) {
      const error = new Error('Listing not found for this host account.')
      error.statusCode = 404
      error.code = 'HOST_LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }

    const listing = await db().listing.update({
      where: { id: existing.id },
      data: { instantBookEnabled: Boolean(body.enabled) },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: `HOST_LISTING_INSTANT_BOOK_${listing.instantBookEnabled ? 'ENABLED' : 'DISABLED'}`,
        entityType: 'listings',
        entityId: listing.id,
        before: existing,
        after: listing,
      },
    })

    return json(res, 200, { ok: true, listing })
  }

  return false
}

function normalizeHostDecision(value) {
  const decision = String(value || 'CONFIRM').toUpperCase()
  if (decision === 'CONFIRM' || decision === 'CONFIRMED' || decision === 'APPROVE') return 'CONFIRMED'
  if (decision === 'CANCEL' || decision === 'CANCELLED' || decision === 'REJECT') return 'CANCELLED'

  const error = new Error('decision must be CONFIRM or CANCEL.')
  error.statusCode = 400
  error.code = 'INVALID_HOST_REQUEST_DECISION'
  error.expose = true
  throw error
}

function normalizeCheckpointAction(value) {
  const action = String(value || '').toUpperCase()
  if (action === 'CHECK_IN' || action === 'CHECK_OUT') return action

  const error = new Error('action must be CHECK_IN or CHECK_OUT.')
  error.statusCode = 400
  error.code = 'INVALID_CHECKPOINT_ACTION'
  error.expose = true
  throw error
}

function parseDateRangeParams(searchParams) {
  const from = parseDateOnly(searchParams.get('from')) || new Date()
  const toRaw = parseDateOnly(searchParams.get('to'))
  const to = toRaw || new Date(from.getTime() + 1000 * 60 * 60 * 24 * 90)
  return { from, to }
}

function parseDateOnly(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeAvailabilityDates(input) {
  if (!Array.isArray(input) || !input.length) {
    const error = new Error('At least one date entry is required.')
    error.statusCode = 400
    error.code = 'AVAILABILITY_DATES_REQUIRED'
    error.expose = true
    throw error
  }

  return input.map((entry) => {
    const date = parseDateOnly(entry?.date)
    if (!date) {
      const error = new Error('Each availability entry needs a valid date (YYYY-MM-DD).')
      error.statusCode = 400
      error.code = 'AVAILABILITY_DATE_INVALID'
      error.expose = true
      throw error
    }
    const status = String(entry?.status || 'BLOCKED').toUpperCase()
    if (!['BLOCKED', 'AVAILABLE'].includes(status)) {
      const error = new Error('Availability status must be BLOCKED or AVAILABLE.')
      error.statusCode = 400
      error.code = 'AVAILABILITY_STATUS_INVALID'
      error.expose = true
      throw error
    }
    const priceOverrideMinor = entry?.priceOverrideMinor === null || entry?.priceOverrideMinor === undefined
      ? null
      : Number(entry.priceOverrideMinor)
    if (priceOverrideMinor !== null && (!Number.isFinite(priceOverrideMinor) || priceOverrideMinor < 0)) {
      const error = new Error('priceOverrideMinor must be a non-negative number.')
      error.statusCode = 400
      error.code = 'AVAILABILITY_PRICE_INVALID'
      error.expose = true
      throw error
    }
    return { date, status, priceOverrideMinor, note: entry?.note || null }
  })
}

function normalizeHostListingStatus(value) {
  const status = String(value || '').toUpperCase()
  if (status === 'PAUSE' || status === 'PAUSED') return 'PAUSED'
  if (status === 'RESUME' || status === 'APPROVE' || status === 'APPROVED') return 'APPROVED'

  const error = new Error('status must be PAUSED or APPROVED.')
  error.statusCode = 400
  error.code = 'INVALID_HOST_LISTING_STATUS'
  error.expose = true
  throw error
}

// --- payout helpers -----------------------------------------------------------------------------

const PAYOUT_FIELDS = ['shamCashNumber', 'accountName', 'bankName', 'accountNumber', 'officeCity']
const PAYOUT_FIELD_MAX = 120

function payoutError(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

// Validates against the ACTIVE country profile's payoutMethods (countries/<country>/profile.mjs):
// the type must be one the country offers, and exactly that type's required fields are stored.
export function normalizePayoutMethod(body = {}) {
  const config = payoutMethodConfig()
  const type = String(body.type || '').trim().toUpperCase()
  const spec = config[type]
  if (!spec) {
    throw payoutError(400, 'PAYOUT_METHOD_TYPE_INVALID', `type must be one of: ${Object.keys(config).join(', ') || '(none configured)'}.`)
  }
  const details = {}
  for (const field of spec.required || []) {
    const value = typeof body[field] === 'string' || typeof body[field] === 'number' ? String(body[field]).trim() : ''
    if (!value) throw payoutError(400, 'PAYOUT_METHOD_FIELD_REQUIRED', `${field} is required for ${type}.`)
    if (value.length > PAYOUT_FIELD_MAX) throw payoutError(400, 'PAYOUT_METHOD_FIELD_TOO_LONG', `${field} is too long.`)
    if ((field === 'shamCashNumber' || field === 'accountNumber') && !/^[A-Za-z0-9 +\-]{4,}$/.test(value)) {
      throw payoutError(400, 'PAYOUT_METHOD_FIELD_INVALID', `${field} has invalid characters.`)
    }
    details[field] = value
  }
  return { type, details }
}

function toPayoutMethodShape(row) {
  if (!row) return null
  const details = row.details && typeof row.details === 'object' ? row.details : {}
  const shape = { type: row.type }
  for (const field of PAYOUT_FIELDS) if (details[field]) shape[field] = details[field]
  return shape
}

// Audit rows never carry a full wallet/account number -- last 4 characters only.
export function maskPayoutMethod(method) {
  if (!method) return method
  const masked = { ...method }
  for (const field of ['shamCashNumber', 'accountNumber']) {
    if (masked[field]) masked[field] = `****${String(masked[field]).slice(-4)}`
  }
  return masked
}

function resolvePayoutCurrency(raw) {
  const currency = String(raw || defaultCurrency() || '').toUpperCase()
  if (!isCurrencyAllowed(currency)) throw payoutError(400, 'PAYOUT_CURRENCY_INVALID', `Currency '${currency}' is not supported.`)
  return currency
}

export function toPayoutRequestShape(row) {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    method: row.method,
    ...(row.reference ? { reference: row.reference } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.createdAt,
    ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
  }
}
