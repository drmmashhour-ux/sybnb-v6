import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, bookingFinanceSplit, originalAdminShareRecipient, recordWalletEntry } from '../lib/finance-ledger.mjs'
import { completeExpiredBookings, isPayoutEligible, payoutEligibleAt, PAYOUT_HOLD_DAYS } from '../lib/booking-lifecycle.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

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

  if (url.pathname === '/api/admin/host-insights') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const insights = await db().hostInsight.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        host: { select: { id: true, displayName: true, email: true } },
        listing: { select: { id: true, titleAr: true, titleEn: true } },
      },
    })
    const totals = {
      generated: insights.length,
      emailed: insights.filter((insight) => insight.emailSentAt).length,
      read: insights.filter((insight) => insight.readAt).length,
    }
    return json(res, 200, { ok: true, insights, totals })
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

  if (url.pathname === '/api/admin/review-queue') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()
    const [listings, payments, gifts, bookings, idDocuments] = await Promise.all([
      db().listing.findMany({ where: { status: 'PENDING_REVIEW' }, take: 25 }),
      db().paymentProof.findMany({
        where: { status: 'PENDING_ADMIN_REVIEW' },
        include: {
          booking: {
            include: {
              listing: {
                include: {
                  owner: { select: { id: true, displayName: true, email: true, idDocumentStatus: true } },
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
    const auditLog = await db().adminAuditLog.findMany({
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

  if (url.pathname === '/api/admin/revenue-summary') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    // Platform revenue today is exactly three real wallet-entry kinds: the STR admin commission
    // share, the (non-refundable) cancellation-protection fee, and the seller/dealer/developer
    // plan fee — all recorded as CREDIT entries by approvePaymentProof() in finance-ledger.mjs.
    // SR rides currently record zero platform commission (the full fare is a driver-side figure
    // only, never credited to an admin wallet) — that's surfaced explicitly below rather than
    // silently folded into "revenue".
    const [commissionEntries, completedSrRides] = await Promise.all([
      db().walletEntry.findMany({
        where: { type: 'CREDIT', referenceType: { in: ['booking_admin_share', 'booking_protection_fee', 'seller_plan_fee'] } },
        select: { amountMinor: true, currency: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      db().rideRequest.aggregate({
        where: { status: 'COMPLETED' },
        _count: { _all: true },
        _sum: { fareMinor: true },
      }),
    ])

    // Seller-plan fees default to USD while booking commission is SYP (see payments.mjs /
    // bookingFinanceSplit) — summing different currencies' minor units together as one number
    // would silently misreport the total, so each currency gets its own totals/history/projection
    // instead of being flattened into a single (wrongly-labeled) figure.
    const entriesByCurrency = new Map()
    for (const entry of commissionEntries) {
      if (!entriesByCurrency.has(entry.currency)) entriesByCurrency.set(entry.currency, [])
      entriesByCurrency.get(entry.currency).push(entry)
    }

    const byCurrency = Array.from(entriesByCurrency.entries())
      .map(([currency, entries]) => {
        const totalRevenueMinor = entries.reduce((sum, entry) => sum + entry.amountMinor, 0)

        const dailyTotals = new Map()
        for (const entry of entries) {
          const day = entry.createdAt.toISOString().slice(0, 10)
          dailyTotals.set(day, (dailyTotals.get(day) || 0) + entry.amountMinor)
        }
        const history = Array.from(dailyTotals.entries())
          .map(([day, amountMinor]) => ({ day, amountMinor }))
          .sort((a, b) => a.day.localeCompare(b.day))

        const firstDay = new Date(entries[0].createdAt)
        const lastDay = new Date(entries[entries.length - 1].createdAt)
        // +1 so a single day of data still divides by 1, not 0.
        const elapsedDays = Math.max(1, Math.ceil((lastDay.getTime() - firstDay.getTime()) / 86400000) + 1)
        const dailyAverageMinor = totalRevenueMinor / elapsedDays

        return {
          currency,
          totalRevenueMinor,
          sampleSize: entries.length,
          history,
          projection: {
            elapsedDays,
            dailyAverageMinor: Math.round(dailyAverageMinor),
            next30DaysMinor: Math.round(dailyAverageMinor * 30),
            next90DaysMinor: Math.round(dailyAverageMinor * 90),
          },
        }
      })
      .sort((a, b) => b.sampleSize - a.sampleSize)

    return json(res, 200, {
      ok: true,
      revenue: {
        byCurrency,
        srRidesCompletedCount: completedSrRides._count._all,
        srRidesFareVolumeMinor: completedSrRides._sum.fareMinor || 0,
      },
    })
  }

  const approveAllMatch = url.pathname.match(/^\/api\/admin\/accommodations\/([^/]+)\/approve-all$/)
  if (approveAllMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const accommodationId = approveAllMatch[1]

    const result = await db().$transaction(async (tx) => {
      const accommodation = await tx.accommodation.findUnique({ where: { id: accommodationId } })
      if (!accommodation) {
        const error = new Error('Accommodation not found.')
        error.statusCode = 404
        error.code = 'ACCOMMODATION_NOT_FOUND'
        error.expose = true
        throw error
      }

      const pendingListings = await tx.listing.findMany({
        where: { accommodationId, status: 'PENDING_REVIEW' },
        select: { id: true },
      })
      // Same TOCTOU-safe re-check-in-WHERE pattern as the single-listing review-queue approval
      // below — each room type is updated individually so a concurrent decision on one room type
      // can't silently double-apply.
      for (const pending of pendingListings) {
        await tx.listing.updateMany({ where: { id: pending.id, status: 'PENDING_REVIEW' }, data: { status: 'APPROVED' } })
      }

      const accommodationUpdate =
        accommodation.status === 'PENDING_REVIEW' ? { status: 'APPROVED' } : {}
      const updatedAccommodation = await tx.accommodation.update({
        where: { id: accommodationId },
        data: accommodationUpdate,
      })

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'REVIEW_APPROVED',
          entityType: 'accommodation',
          entityId: accommodationId,
          before: { pendingListingIds: pendingListings.map((listing) => listing.id) },
          after: { approvedListingIds: pendingListings.map((listing) => listing.id) },
        },
      })

      return { accommodation: updatedAccommodation, approvedListingIds: pendingListings.map((listing) => listing.id) }
    })

    return json(res, 200, { ok: true, ...result })
  }

  const reviewMatch = url.pathname.match(/^\/api\/admin\/review-queue\/([^/]+)\/([^/]+)$/)
  if (reviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const [entityType, entityId] = reviewMatch.slice(1)
    const decision = normalizeDecision(body.decision || body.action)
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
      const split = bookingFinanceSplit(existing, approvedPayment.amountMinor)
      const adminRecipientId = await originalAdminShareRecipient(tx, existing.id)

      await tx.paymentProof.updateMany({
        where: {
          bookingId: existing.id,
          status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
        },
        data: {
          status: 'REFUNDED',
          adminNote: 'Auto-refunded after admin rejected/ruled against this booking.',
          reviewedById: actorUserId,
          reviewedAt: new Date(),
        },
      })

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

      await recordWalletEntry(tx, {
        userId: adminRecipientId,
        type: 'DEBIT',
        amountMinor: split.adminShareMinor,
        currency: existing.currency,
        referenceType: 'booking_admin_share_reversal',
        referenceId: existing.id,
        keyParts: ['booking-admin-reject-admin-share-reversal', existing.id, approvedPayment.id],
        note: 'Admin/SYBNB share reversed because the admin rejected/ruled against this booking.',
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
  const source = String(packet.source || body.shamCashSource || 'admin-ui')
  // expectedMinor is recomputed from this payment's own row rather than trusted from the client.
  // The admin UI used to send one aggregate figure summed across every pending Sham Cash payment,
  // so reconciling the total let a single balance entry silently "cover" unrelated bookings too —
  // approving one payment could flip another, unreconciled payment's mismatch banner to matched.
  const expectedMinor = Math.round(paymentProof.amountMinor || 0)

  if (accountMinor == null) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_REQUIRED',
      'Sham Cash reconciliation is required before approving this payment.',
      409,
    )
  }

  const differenceMinor = accountMinor - expectedMinor
  if (differenceMinor !== 0) {
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
