import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'

export async function handleMe(req, res, url, context) {
  if (url.pathname === '/api/me/id-document') {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)

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

    const storageKey = await saveIdDocument(fileBase64, mimeType)
    const previous = await db().user.findUnique({ where: { id: context.user.id }, select: { idDocumentRef: true } })

    const user = await db().user.update({
      where: { id: context.user.id },
      data: {
        idDocumentRef: storageKey,
        idDocumentMimeType: mimeType,
        idDocumentSubmittedAt: new Date(),
        idDocumentStatus: 'PENDING_REVIEW',
        idDocumentReviewedById: null,
        idDocumentReviewedAt: null,
      },
      select: { id: true, idDocumentRef: true, idDocumentSubmittedAt: true, idDocumentStatus: true },
    })

    // Replacing a previous submission (e.g. after a rejection) — remove the old file now that the
    // new one is safely written and the DB row points at the new one.
    if (previous?.idDocumentRef && previous.idDocumentRef !== storageKey) {
      await deleteIdDocument(previous.idDocumentRef)
    }

    return json(res, 200, { ok: true, user })
  }

  if (url.pathname === '/api/me/id-document/file') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    if (!context.user.idDocumentRef) {
      const error = new Error('No ID document has been submitted yet.')
      error.statusCode = 404
      error.code = 'ID_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const buffer = await readIdDocument(context.user.idDocumentRef)
    res.writeHead(200, {
      'content-type': context.user.idDocumentMimeType || 'application/octet-stream',
      'cache-control': 'private, no-store',
    })
    res.end(buffer)
    return true
  }

  if (url.pathname !== '/api/me/overview') return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  requireAuth(context)

  await completeExpiredBookings({ guestId: context.user.id })

  const [bookings, listings, payments, rides, wallet, sentGifts, claimedGifts, sellerProfile, referralsMade] = await Promise.all([
    db().booking.findMany({
      where: { guestId: context.user.id },
      include: { listing: true, payments: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db().listing.findMany({
      where: { ownerId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db().paymentProof.findMany({
      where: { userId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db().rideRequest.findMany({
      where: { OR: [{ riderId: context.user.id }, { driverId: context.user.id }] },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    }),
    db().wallet.findUnique({
      where: { userId_currency: { userId: context.user.id, currency: 'SYP' } },
      include: { entries: { orderBy: { createdAt: 'desc' }, take: 10 } },
    }),
    db().walletGift.findMany({
      where: { senderUserId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db().walletGift.findMany({
      where: { recipientUserId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db().sellerProfile.findUnique({ where: { userId: context.user.id } }),
    db().referral.findMany({
      where: { referrerUserId: context.user.id },
      include: { referee: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  return json(res, 200, {
    ok: true,
    overview: {
      user: {
        id: context.user.id,
        email: context.user.email,
        displayName: context.user.displayName,
        roles: context.roles,
        idDocumentRef: context.user.idDocumentRef,
        idDocumentSubmittedAt: context.user.idDocumentSubmittedAt,
        idDocumentStatus: context.user.idDocumentStatus,
        referralCode: context.user.referralCode,
      },
      bookings,
      listings,
      payments,
      rides,
      wallet,
      sellerProfile,
      gifts: {
        sent: sentGifts,
        claimed: claimedGifts,
      },
      referrals: {
        made: referralsMade,
        rewardedCount: referralsMade.filter((r) => r.status === 'REWARDED').length,
        pendingCount: referralsMade.filter((r) => r.status === 'PENDING').length,
      },
    },
  })
}
