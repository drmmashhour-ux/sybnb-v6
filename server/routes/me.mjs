import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { bookingExpiresAt } from '../lib/booking-policy.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { bookingPolicySettings, defaultCurrency } from '../lib/country.mjs'
// SEC-002R round 3, item 1: the self-service half of finding G1 -- see the id-document handler below.
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'

export async function handleMe(req, res, url, context) {
  // Airbnb-style "Become a host": one account for everything. A signed-in customer adds the HOST
  // role to the SAME account instead of opening a separate host account. HOST is already publicly
  // self-registerable (auth.mjs PUBLIC_REGISTER_ROLES), so this grants nothing a stranger cannot
  // already obtain; it only stops forcing a second account. Grant-only, idempotent, and -- like the
  // seller-plan grant in finance-ledger.mjs -- deliberately does NOT revoke the current session:
  // roles are read live per request, so the very next host request is authorized. Any role REMOVAL
  // still must go through applyRoleChange(). Commit-boundary re-authorization mirrors the other
  // self-service mutation in this file, so a revoked/suspended actor cannot gain a role.
  if (url.pathname === '/api/me/become-host') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const roles = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, { action: 'SELF_BECOME_HOST' })
      await tx.userRole.upsert({
        where: { userId_role: { userId: context.user.id, role: 'HOST' } },
        create: { userId: context.user.id, role: 'HOST' },
        update: {},
      })
      const rows = await tx.userRole.findMany({ where: { userId: context.user.id }, select: { role: true } })
      return rows.map((row) => row.role)
    })
    return json(res, 200, { ok: true, roles })
  }

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

    // SEC-002R round 3, item 1. This is the SELF-SERVICE side of finding G1 (server/routes/admin.mjs
    // /api/admin/id-document/:userId/upload, fixed in round 2) -- structurally the same defect and
    // therefore the same fix, mirrored statement for statement. Before this change the handler was
    // three untransacted operations with no commit-boundary re-authorization anywhere: a blob write,
    // a bare db().user.update() rewriting the actor's own KYC state, and -- the part that matters --
    // an IRREVERSIBLE deleteIdDocument() of the actor's own previous identity document, executed
    // whether or not the actor still had any authority at the moment it ran.
    //
    // The filesystem/object side cannot join a Postgres transaction, so ordering carries the
    // guarantee (identical to the admin path's):
    //
    //   1. Write the NEW blob first. It is inert until a row points at it; orphaning one costs
    //      storage, not correctness.
    //   2. Do the durable DB effect inside ONE transaction with reauthorizeAtCommit() as its first
    //      statement, under held user_sessions/users locks. A revoked actor gets no row change.
    //   3. Delete the PREVIOUS document only AFTER that transaction has genuinely committed -- never
    //      on a refused or thrown path. The previous ref is re-read INSIDE the transaction, so a
    //      concurrent upload's document is never the one destroyed.
    //   4. If the transaction is refused or fails, delete the NEW blob from step 1, so a refused
    //      request leaves nothing behind at all.
    //
    // requiredRoles is deliberately EMPTY: this route's own requireAuth(context) takes no roles --
    // any signed-in account may submit its own KYC document. The re-check therefore asserts exactly
    // what admission asserted (live session, non-revoked, unexpired, current epoch, ACTIVE account)
    // and nothing more. No interestedPartyIds either: the actor IS legitimately the subject here.
    // Unlike the admin path there is no audit row on this route to bring inside the transaction --
    // this handler never wrote one, and adding one is a separate change, not this fix's to make.
    const storageKey = await saveIdDocument(fileBase64, mimeType)
    let user
    let supersededRef = null
    try {
      ;({ user, supersededRef } = await db().$transaction(async (tx) => {
        await reauthorizeAtCommit(tx, context, { action: 'ID_DOCUMENT_SUBMITTED' })
        const current = await tx.user.findUnique({
          where: { id: context.user.id },
          select: { idDocumentRef: true },
        })
        const row = await tx.user.update({
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
        return { user: row, supersededRef: current?.idDocumentRef ?? null }
      }))
    } catch (err) {
      // Nothing in the DB references the blob written above; a refused or failed request must not
      // leave it lying in the KYC bucket.
      await deleteIdDocument(storageKey).catch(() => {})
      throw err
    }

    // Replacing a previous submission (e.g. after a rejection) — remove the old file now that the
    // new one is safely written, the DB row points at the new one, and that write has COMMITTED.
    if (supersededRef && supersededRef !== storageKey) {
      await deleteIdDocument(supersededRef)
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

  // SR Ride vs. Uber gap-closure (P2 #13): saved places (e.g. "Home", "Work") for quick reuse
  // when requesting a ride. Generic under /api/me/ rather than /api/sr/ -- nothing here is
  // ride-specific, and other divisions could reuse the same list later.
  if (url.pathname === '/api/me/saved-places') {
    if (req.method === 'GET') {
      requireAuth(context)
      const places = await db().savedPlace.findMany({
        where: { userId: context.user.id },
        orderBy: { createdAt: 'asc' },
      })
      return json(res, 200, { ok: true, places })
    }
    if (req.method === 'POST') {
      requireAuth(context)
      const body = await readJson(req)
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      const address = typeof body.address === 'string' ? body.address.trim() : ''
      if (!label || !address) {
        const error = new Error('A label and address are required.')
        error.statusCode = 400
        error.code = 'SAVED_PLACE_INVALID'
        error.expose = true
        throw error
      }
      const lat = Number.isFinite(Number(body.lat)) ? Number(body.lat) : undefined
      const lng = Number.isFinite(Number(body.lng)) ? Number(body.lng) : undefined
      // No real user needs more than a handful of saved places; without a cap a buggy or scripted
      // client could create an unbounded number against one account (found in a scale-readiness
      // sweep of unbounded findMany queries -- most were naturally bounded by real-world cardinality
      // of the parent entity, but nothing stopped creation here).
      const existingCount = await db().savedPlace.count({ where: { userId: context.user.id } })
      if (existingCount >= 50) {
        const error = new Error('You have reached the maximum number of saved places.')
        error.statusCode = 422
        error.code = 'SAVED_PLACE_LIMIT_REACHED'
        error.expose = true
        throw error
      }
      const place = await db().savedPlace.create({
        data: { userId: context.user.id, label, address, lat, lng },
      })
      return json(res, 201, { ok: true, place })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const savedPlaceMatch = url.pathname.match(/^\/api\/me\/saved-places\/([^/]+)$/)
  if (savedPlaceMatch) {
    if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE'])
    requireAuth(context)
    // Scoped to the caller's own userId in the WHERE clause -- deleteMany rather than delete so a
    // mismatched id (not found, or owned by someone else) is a clean no-op, not a thrown 500.
    const result = await db().savedPlace.deleteMany({ where: { id: savedPlaceMatch[1], userId: context.user.id } })
    if (result.count === 0) {
      const error = new Error('Saved place not found for this account.')
      error.statusCode = 404
      error.code = 'SAVED_PLACE_NOT_FOUND'
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true })
  }

  if (url.pathname !== '/api/me/overview') return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  requireAuth(context)

  await completeExpiredBookings({ guestId: context.user.id })

  const [bookings, listings, payments, rides, wallet, sentGifts, claimedGifts, sellerProfile] = await Promise.all([
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
      where: { userId_currency: { userId: context.user.id, currency: defaultCurrency() } },
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
      },
      // expiresAt (createdAt + the unpaid window) on each still-unpaid request, same as
      // GET /api/bookings/:id, so the guest dashboard can show the pay-by deadline.
      bookings: bookings.map((booking) => {
        const expiresAt = bookingExpiresAt(booking, bookingPolicySettings())
        return expiresAt ? { ...booking, expiresAt } : booking
      }),
      listings,
      payments,
      rides,
      wallet,
      sellerProfile,
      gifts: {
        sent: sentGifts,
        claimed: claimedGifts,
      },
    },
  })
}
