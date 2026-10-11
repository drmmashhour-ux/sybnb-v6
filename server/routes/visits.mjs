// Schedule-a-visit (2026-10-11). A buyer/renter requests a date/time to view a listing; the owner
// confirms or declines. Replaces the plain contact thread with a real, trackable viewing request.
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, readJson } from '../lib/responses.mjs'
import { sendPushNotification } from '../lib/push-notifications.mjs'
import { notifyAdmin, notifyUserMulti } from '../lib/notifications.mjs'

function badRequest(message, code = 'BAD_REQUEST', statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  err.expose = true
  return err
}

function listingTitle(l) {
  return (l && (l.titleEn || l.titleAr)) || 'a listing'
}

function toPublicVisit(v, { viewpoint } = {}) {
  return {
    id: v.id,
    listingId: v.listingId,
    listingTitle: listingTitle(v.listing),
    proposedAt: v.proposedAt,
    status: v.status,
    note: v.note || null,
    responseNote: v.responseNote || null,
    confirmedAt: v.confirmedAt || null,
    createdAt: v.createdAt,
    viewpoint: viewpoint || null,
    // Only reveal the counterparty's display name, never contact details.
    requesterName: v.requester?.displayName || null,
    ownerName: v.owner?.displayName || null,
  }
}

export async function handleVisits(req, res, url, context) {
  const path = url.pathname
  if (!path.startsWith('/api/visits')) return false

  // POST /api/visits — request a visit
  if (path === '/api/visits' && req.method === 'POST') {
    requireAuth(context)
    const body = await readJson(req)
    const listingId = String(body.listingId || '').trim()
    if (!listingId) throw badRequest('listingId is required.', 'LISTING_REQUIRED')
    const proposedAtMs = new Date(body.proposedAt).getTime()
    if (!Number.isFinite(proposedAtMs)) throw badRequest('A valid date and time is required.', 'PROPOSED_AT')
    if (proposedAtMs < Date.now() - 60 * 1000) throw badRequest('Pick a time in the future.', 'PROPOSED_AT_PAST')
    if (proposedAtMs > Date.now() + 180 * 24 * 60 * 60 * 1000) throw badRequest('That date is too far in the future.', 'PROPOSED_AT_MAX')

    const listing = await db().listing.findUnique({ where: { id: listingId }, select: { id: true, ownerId: true, titleEn: true, titleAr: true } })
    if (!listing) throw badRequest('Listing not found.', 'LISTING_NOT_FOUND', 404)
    if (listing.ownerId === context.user.id) throw badRequest('You cannot request a visit to your own listing.', 'OWN_LISTING')

    const note = body.note ? String(body.note).slice(0, 500) : null

    // Collapse rapid duplicates: if the requester already has a PENDING request for this listing, update it.
    const existing = await db().visitRequest.findFirst({
      where: { listingId, requesterId: context.user.id, status: 'PENDING' },
    })
    let visit
    if (existing) {
      visit = await db().visitRequest.update({ where: { id: existing.id }, data: { proposedAt: new Date(proposedAtMs), note } })
    } else {
      visit = await db().visitRequest.create({
        data: { listingId, requesterId: context.user.id, ownerId: listing.ownerId, proposedAt: new Date(proposedAtMs), note },
      })
    }

    notifyUserMulti('visit_requested', listing.ownerId, { listingTitle: listingTitle(listing), url: '/#/visits' }, `visit-req-${visit.id}`)
    notifyAdmin('listing_visit_requested', { visitId: visit.id, listingId, requesterId: context.user.id }, `visit-req-${visit.id}`)

    const full = await db().visitRequest.findUnique({ where: { id: visit.id }, include: { listing: true, owner: true } })
    return json(res, 201, { ok: true, visit: toPublicVisit(full, { viewpoint: 'requester' }) })
  }

  // GET /api/visits — both sides
  if (path === '/api/visits' && req.method === 'GET') {
    requireAuth(context)
    const [asRequester, asOwner] = await Promise.all([
      db().visitRequest.findMany({ where: { requesterId: context.user.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { listing: true, owner: true } }),
      db().visitRequest.findMany({ where: { ownerId: context.user.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { listing: true, requester: true } }),
    ])
    return json(res, 200, {
      ok: true,
      asRequester: asRequester.map((v) => toPublicVisit(v, { viewpoint: 'requester' })),
      asOwner: asOwner.map((v) => toPublicVisit(v, { viewpoint: 'owner' })),
    })
  }

  // GET /api/visits/for-listing/:listingId — the requester's own latest request for a listing (for the panel)
  const forListing = path.match(/^\/api\/visits\/for-listing\/([^/]+)$/)
  if (forListing && req.method === 'GET') {
    requireAuth(context)
    const listingId = decodeURIComponent(forListing[1])
    const v = await db().visitRequest.findFirst({
      where: { listingId, requesterId: context.user.id },
      orderBy: { createdAt: 'desc' },
      include: { listing: true, owner: true },
    })
    return json(res, 200, { ok: true, visit: v ? toPublicVisit(v, { viewpoint: 'requester' }) : null })
  }

  // PATCH /api/visits/:id — owner confirms/declines
  const patch = path.match(/^\/api\/visits\/([^/]+)$/)
  if (patch && req.method === 'PATCH') {
    requireAuth(context)
    const id = decodeURIComponent(patch[1])
    const body = await readJson(req)
    const decision = String(body.status || '').toUpperCase()
    if (decision !== 'CONFIRMED' && decision !== 'DECLINED') throw badRequest('status must be CONFIRMED or DECLINED.', 'BAD_STATUS')
    const v = await db().visitRequest.findUnique({ where: { id }, select: { id: true, ownerId: true, requesterId: true, status: true, listingId: true } })
    if (!v) throw badRequest('Visit request not found.', 'NOT_FOUND', 404)
    if (v.ownerId !== context.user.id) throw badRequest('Only the listing owner can respond to this request.', 'FORBIDDEN', 403)
    if (v.status !== 'PENDING') throw badRequest('This request has already been handled.', 'ALREADY_HANDLED', 409)
    const responseNote = body.responseNote ? String(body.responseNote).slice(0, 500) : null
    const updated = await db().visitRequest.update({
      where: { id },
      data: { status: decision, responseNote, confirmedAt: decision === 'CONFIRMED' ? new Date() : null },
      include: { listing: true, owner: true },
    })
    notifyUserMulti(decision === 'CONFIRMED' ? 'visit_confirmed' : 'visit_declined', v.requesterId, { listingTitle: listingTitle(updated.listing), url: '/#/visits' }, `visit-resp-${v.id}-${decision}`)
    return json(res, 200, { ok: true, visit: toPublicVisit(updated, { viewpoint: 'owner' }) })
  }

  // POST /api/visits/:id/cancel — requester cancels
  const cancel = path.match(/^\/api\/visits\/([^/]+)\/cancel$/)
  if (cancel && req.method === 'POST') {
    requireAuth(context)
    const id = decodeURIComponent(cancel[1])
    const v = await db().visitRequest.findUnique({ where: { id }, select: { id: true, requesterId: true, ownerId: true, status: true } })
    if (!v) throw badRequest('Visit request not found.', 'NOT_FOUND', 404)
    if (v.requesterId !== context.user.id) throw badRequest('Only the requester can cancel this request.', 'FORBIDDEN', 403)
    if (v.status === 'CANCELLED') return json(res, 200, { ok: true })
    const updated = await db().visitRequest.update({ where: { id }, data: { status: 'CANCELLED' }, include: { listing: true, owner: true } })
    notifyUserMulti('visit_cancelled', v.ownerId, { url: '/#/visits' }, `visit-cancel-${v.id}`)
    return json(res, 200, { ok: true, visit: toPublicVisit(updated, { viewpoint: 'requester' }) })
  }

  return false
}
