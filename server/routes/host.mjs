import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { resolveListingCityName } from '../lib/listing-location.mjs'
import { isCurrencyAllowed } from '../lib/country.mjs'
import {
  bookingFinanceSplit,
  buildPayoutRow,
  cancellationAdminFee,
  createRefundRequest,
  originalAdminShareRecipient,
  recordWalletEntry,
} from '../lib/finance-ledger.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { expireOldListings } from '../lib/listing-lifecycle.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'

export async function handleHost(req, res, url, context) {
  if (url.pathname === '/api/host/earnings') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['HOST', 'SELLER'])

    await completeExpiredBookings({ listing: { ownerId: context.user.id } })

    const bookings = await db().booking.findMany({
      where: {
        listing: { ownerId: context.user.id },
        status: { in: ['CONFIRMED', 'COMPLETED', 'DISPUTED'] },
      },
      include: { listing: true, payments: true },
      orderBy: { checkOut: 'asc' },
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
        totals: { ...totals, currency: rows[0]?.currency || 'SYP' },
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

    const requests = listings.flatMap((listing) =>
      listing.bookings.map((booking) => ({
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

    if (canConfirm && body.acceptedTerms !== true) {
      const error = new Error('Host must accept SYBNB rules and conditions before confirming this booking.')
      error.statusCode = 400
      error.code = 'HOST_TERMS_REQUIRED'
      error.expose = true
      throw error
    }

    // Only money-moving when the host is CANCELLING (reverses a real, already-approved payment) —
    // confirming is a pure status change (the payout stays held either way; see the comment below).
    if (status === 'CANCELLED' && existing.payments.some((payment) => payment.status === 'APPROVED')) {
      authorizePaymentOperation({
        operation: 'refund',
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

      if (status === 'CANCELLED') {
        // Same fix as the guest-cancel path in bookings.mjs: reverse against whoever actually
        // received the original commission-share wallet credit, not the possibly stale/null
        // PaymentProof.reviewedById field.
        const adminRecipientId = await originalAdminShareRecipient(tx, existing.id)

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
        // Guarded on a REAL approvedPayment existing, unlike the removed recordWalletEntry call
        // above it: Refund.paymentProofId is a real, non-null FK, so there is structurally no proof
        // to attach a refund to when no payment was ever approved. This also closes a real,
        // pre-existing defect the old fallback (`approvedPayment?.amountMinor || existing.amountMinor`)
        // had: a host cancelling a booking with NO approved payment would still wallet-credit the
        // guest for the booking's full LISTED price -- crediting money that was never actually
        // paid. bookings.mjs's equivalent guest-cancel path already correctly guards its whole
        // refund block on `if (approvedPayment)`; host.mjs did not. The OTHER wallet entries below
        // (admin-share-reversal, host-cancel-fee) still share this same unguarded pattern -- left
        // untouched here as a separate, already-flagged finding (see the delivered report), not
        // "necessary to create the new refund records" and therefore out of this round's scope.
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

        await recordWalletEntry(tx, {
          userId: adminRecipientId,
          type: 'DEBIT',
          amountMinor: split.adminShareMinor,
          currency: existing.currency,
          referenceType: 'booking_admin_share_reversal',
          referenceId: existing.id,
          keyParts: ['booking-admin-share-reversal', existing.id, approvedPayment?.id],
          note: 'Admin/SYBNB share reversed because the protected booking was refunded.',
        })

        const hostCancelFee = cancellationAdminFee(existing.currency)
        await recordWalletEntry(tx, {
          userId: existing.listing.ownerId,
          type: 'DEBIT',
          amountMinor: hostCancelFee.amountMinor,
          currency: hostCancelFee.currency,
          referenceType: 'booking_host_cancel_fee',
          referenceId: existing.id,
          keyParts: ['booking-host-cancel-fee-host', existing.id, approvedPayment?.id],
          note: 'Host cancellation admin fee after cancelling a protected paid booking.',
        })

        await recordWalletEntry(tx, {
          userId: adminRecipientId,
          type: 'CREDIT',
          amountMinor: hostCancelFee.amountMinor,
          currency: hostCancelFee.currency,
          referenceType: 'booking_host_cancel_fee',
          referenceId: existing.id,
          keyParts: ['booking-host-cancel-fee-admin', existing.id, approvedPayment?.id],
          note: 'Admin received host cancellation fee for protected paid booking.',
        })
      }

      // Payout is intentionally NOT released here. Confirming only means the host accepted the
      // booking; the payout stays held until the stay completes, the 2-week hold passes, and an
      // admin explicitly releases it via /api/admin/payouts (see host-payout-release.mjs).

      return tx.booking.update({
        where: { id: existing.id },
        data: { status },
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

    return json(res, 200, { ok: true, booking })
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

  // Edit (PATCH) or remove (DELETE) a host's own listing. Editing content re-enters review so an
  // approved listing can't be silently changed post-approval; delete is blocked when bookings exist.
  const listingEditMatch = url.pathname.match(/^\/api\/host\/listings\/([^/]+)$/)
  if (listingEditMatch) {
    requireAuth(context, ['HOST', 'SELLER'])
    const existing = await db().listing.findFirst({ where: { id: listingEditMatch[1], ownerId: context.user.id } })
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
        data: { actorUserId: context.user.id, action: 'HOST_LISTING_EDIT', entityType: 'listings', entityId: listing.id, before: existing, after: listing },
      })
      return json(res, 200, { ok: true, listing })
    }

    if (req.method === 'DELETE') {
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
