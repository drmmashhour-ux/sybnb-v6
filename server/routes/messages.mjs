import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { isBookingViewable } from './bookings.mjs'

const MESSAGING_ELIGIBLE_BOOKING_STATUSES = ['CONFIRMED', 'COMPLETED', 'DISPUTED']

// SR Ride vs. Uber gap-closure (P0 #4): a rider and driver only have anything to coordinate once
// a driver actually exists (never REQUESTED/MATCHING) up through a short window after the trip
// ends (mirrors Uber's own in-app chat window, e.g. reporting a lost item) -- not CANCELLED,
// which has no live coordination need and would otherwise reopen a channel disputes should go
// through support for instead.
const MESSAGING_ELIGIBLE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']

async function loadBookingForThread(bookingId, context) {
  const booking = await db().booking.findUnique({
    where: { id: bookingId },
    include: { listing: true },
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

  if (!MESSAGING_ELIGIBLE_BOOKING_STATUSES.includes(booking.status)) {
    const error = new Error('Messaging opens once the booking is confirmed.')
    error.statusCode = 400
    error.code = 'MESSAGING_NOT_ELIGIBLE'
    error.expose = true
    throw error
  }

  return booking
}

function senderRoleFor(booking, context) {
  if (context.roles.includes('ADMIN')) return 'ADMIN'
  if (context.roles.includes('SUPPORT')) return 'SUPPORT'
  if (booking.listing.ownerId === context.user.id) return 'HOST'
  return 'GUEST'
}

async function ensureThread(bookingId) {
  return db().messageThread.upsert({
    where: { bookingId },
    create: { bookingId },
    update: {},
  })
}

function listingSenderRoleFor(listing, context) {
  if (context.roles.includes('ADMIN')) return 'ADMIN'
  if (context.roles.includes('SUPPORT')) return 'SUPPORT'
  if (listing.ownerId === context.user.id) return 'HOST'
  return 'GUEST'
}

async function loadListingForThread(listingId, context) {
  const listing = await db().listing.findUnique({ where: { id: listingId } })
  if (!listing) {
    const error = new Error('Listing not found.')
    error.statusCode = 404
    error.code = 'LISTING_NOT_FOUND'
    error.expose = true
    throw error
  }

  const isOwner = listing.ownerId === context.user.id
  if (!isOwner && listing.status !== 'APPROVED') {
    const error = new Error('This listing is not available for this account.')
    error.statusCode = 403
    error.code = 'LISTING_FORBIDDEN'
    error.expose = true
    throw error
  }

  return { listing, isOwner }
}

async function ensureListingThread(listingId, guestId) {
  return db().messageThread.upsert({
    where: { listingId_guestId: { listingId, guestId } },
    create: { listingId, guestId },
    update: {},
  })
}

async function loadRideForThread(rideId, context) {
  const ride = await db().rideRequest.findUnique({ where: { id: rideId } })

  if (!ride) {
    const error = new Error('Ride request not found.')
    error.statusCode = 404
    error.code = 'RIDE_NOT_FOUND'
    error.expose = true
    throw error
  }

  const isParticipant =
    context.roles.includes('ADMIN') ||
    context.roles.includes('SUPPORT') ||
    ride.riderId === context.user.id ||
    ride.driverId === context.user.id
  if (!isParticipant) {
    const error = new Error('This ride is not available for this account.')
    error.statusCode = 403
    error.code = 'RIDE_FORBIDDEN'
    error.expose = true
    throw error
  }

  if (!MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status)) {
    const error = new Error('Messaging opens once a driver is assigned to the ride.')
    error.statusCode = 400
    error.code = 'MESSAGING_NOT_ELIGIBLE'
    error.expose = true
    throw error
  }

  return ride
}

function rideSenderRoleFor(ride, context) {
  if (context.roles.includes('ADMIN')) return 'ADMIN'
  if (context.roles.includes('SUPPORT')) return 'SUPPORT'
  return ride.driverId === context.user.id ? 'DRIVER' : 'RIDER'
}

async function ensureRideThread(rideId) {
  return db().messageThread.upsert({
    where: { rideId },
    create: { rideId },
    update: {},
  })
}

export async function handleMessages(req, res, url, context) {
  const listingThreadMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/thread$/)
  if (listingThreadMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const { listing, isOwner } = await loadListingForThread(listingThreadMatch[1], context)
    const guestId = isOwner ? String(url.searchParams.get('guestId') || '') : context.user.id
    if (isOwner && !guestId) {
      const error = new Error('guestId is required for the listing owner.')
      error.statusCode = 400
      error.code = 'GUEST_ID_REQUIRED'
      error.expose = true
      throw error
    }
    if (isOwner && guestId === context.user.id) {
      const error = new Error('An owner cannot open a thread with themselves.')
      error.statusCode = 400
      error.code = 'INVALID_GUEST_ID'
      error.expose = true
      throw error
    }

    // Only the guest side auto-creates a thread by messaging the listing owner. An owner (isOwner)
    // can only open a thread a guest already started — otherwise an owner could fabricate an
    // inquiry thread with an arbitrary guestId they have no real relationship with and message
    // into it unsolicited.
    const thread = isOwner
      ? await db().messageThread.findUnique({ where: { listingId_guestId: { listingId: listing.id, guestId } } })
      : await ensureListingThread(listing.id, guestId)

    if (!thread) {
      const error = new Error('This inquiry thread does not exist yet.')
      error.statusCode = 404
      error.code = 'THREAD_NOT_FOUND'
      error.expose = true
      throw error
    }

    const messages = await db().message.findMany({
      where: { threadId: thread.id },
      include: { sender: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    return json(res, 200, { ok: true, thread: { id: thread.id, listingId: listing.id, guestId, messages } })
  }

  const listingSendMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/thread\/messages$/)
  if (listingSendMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const { listing, isOwner } = await loadListingForThread(listingSendMatch[1], context)
    const body = await readJson(req)
    const text = typeof body.body === 'string' ? body.body.trim() : ''

    if (!text) {
      const error = new Error('Message body is required.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_REQUIRED'
      error.expose = true
      throw error
    }
    if (text.length > 4000) {
      const error = new Error('Message body is too long.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_TOO_LONG'
      error.expose = true
      throw error
    }

    const guestId = isOwner ? String(body.guestId || '') : context.user.id
    if (isOwner && !guestId) {
      const error = new Error('guestId is required for the listing owner.')
      error.statusCode = 400
      error.code = 'GUEST_ID_REQUIRED'
      error.expose = true
      throw error
    }

    const thread = isOwner
      ? await db().messageThread.findUnique({ where: { listingId_guestId: { listingId: listing.id, guestId } } })
      : await ensureListingThread(listing.id, guestId)

    if (!thread) {
      const error = new Error('This inquiry thread does not exist yet.')
      error.statusCode = 404
      error.code = 'THREAD_NOT_FOUND'
      error.expose = true
      throw error
    }

    const message = await db().message.create({
      data: {
        threadId: thread.id,
        senderUserId: context.user.id,
        senderRole: listingSenderRoleFor(listing, context),
        body: text,
      },
      include: { sender: { select: { id: true, displayName: true } } },
    })

    return json(res, 201, { ok: true, message })
  }

  // Mirror of /api/host/inquiries for the guest side — without this, a guest who sends a listing
  // inquiry (Rentals/Buy/Cars/Marketplace/New-Construction) has no way to ever see the host's reply;
  // the inbox only supported booking/payment/ride/gift threads.
  if (url.pathname === '/api/me/inquiries') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const threads = await db().messageThread.findMany({
      where: { guestId: context.user.id, listingId: { not: null } },
      include: {
        listing: { select: { id: true, titleAr: true, titleEn: true, division: true, priceMinor: true, currency: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })

    return json(res, 200, { ok: true, threads })
  }

  if (url.pathname === '/api/host/inquiries') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const threads = await db().messageThread.findMany({
      where: { listing: { ownerId: context.user.id } },
      include: {
        listing: { select: { id: true, titleAr: true, titleEn: true, division: true, priceMinor: true, currency: true } },
        guest: { select: { id: true, displayName: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })

    return json(res, 200, { ok: true, threads })
  }

  const threadMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/thread$/)
  if (threadMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const booking = await loadBookingForThread(threadMatch[1], context)
    const thread = await ensureThread(booking.id)
    const messages = await db().message.findMany({
      where: { threadId: thread.id },
      include: { sender: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    return json(res, 200, { ok: true, thread: { id: thread.id, bookingId: booking.id, messages } })
  }

  const sendMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/thread\/messages$/)
  if (sendMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const booking = await loadBookingForThread(sendMatch[1], context)
    const body = await readJson(req)
    const text = typeof body.body === 'string' ? body.body.trim() : ''

    if (!text) {
      const error = new Error('Message body is required.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_REQUIRED'
      error.expose = true
      throw error
    }

    if (text.length > 4000) {
      const error = new Error('Message body is too long.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_TOO_LONG'
      error.expose = true
      throw error
    }

    const thread = await ensureThread(booking.id)
    const message = await db().message.create({
      data: {
        threadId: thread.id,
        senderUserId: context.user.id,
        senderRole: senderRoleFor(booking, context),
        body: text,
      },
      include: { sender: { select: { id: true, displayName: true } } },
    })

    return json(res, 201, { ok: true, message })
  }

  const rideThreadMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/thread$/)
  if (rideThreadMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const ride = await loadRideForThread(rideThreadMatch[1], context)
    const thread = await ensureRideThread(ride.id)
    const messages = await db().message.findMany({
      where: { threadId: thread.id },
      include: { sender: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    return json(res, 200, { ok: true, thread: { id: thread.id, rideId: ride.id, messages } })
  }

  const rideSendMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/thread\/messages$/)
  if (rideSendMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const ride = await loadRideForThread(rideSendMatch[1], context)
    const body = await readJson(req)
    const text = typeof body.body === 'string' ? body.body.trim() : ''

    if (!text) {
      const error = new Error('Message body is required.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_REQUIRED'
      error.expose = true
      throw error
    }

    if (text.length > 4000) {
      const error = new Error('Message body is too long.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_TOO_LONG'
      error.expose = true
      throw error
    }

    const thread = await ensureRideThread(ride.id)
    const message = await db().message.create({
      data: {
        threadId: thread.id,
        senderUserId: context.user.id,
        senderRole: rideSenderRoleFor(ride, context),
        body: text,
      },
      include: { sender: { select: { id: true, displayName: true } } },
    })

    return json(res, 201, { ok: true, message })
  }

  return false
}
