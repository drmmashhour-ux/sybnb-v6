import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
// Consume the country-neutral geocoding seam (resolves the active country's geocoder, fail-closed) —
// the route does NOT depend on any country's geocoder module directly.
import { quoteSrRideForActiveCountry } from '../lib/geo-adapter.mjs'
import { signDriverPhotoUrl } from '../lib/driver-photo-storage.mjs'
import { getDriverRatingSummary } from '../lib/driver-rating.mjs'

export async function handleSrRides(req, res, url, context) {
  if (url.pathname === '/api/sr/quote') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const quote = quoteSrRideForActiveCountry({
      pickup: body.pickup,
      dropoff: body.dropoff,
      category: body.category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
    })
    return json(res, 200, { ok: true, quote })
  }

  if (url.pathname === '/api/sr/rides') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const category = String(body.category || 'SR Economy')
    const pickup = String(body.pickup || '')
    const dropoff = String(body.dropoff || '')
    const quote = quoteSrRideForActiveCountry({
      pickup,
      dropoff,
      category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
    })

    const ride = await db().rideRequest.create({
      data: {
        riderId: context.user.id,
        pickupLocationId: body.pickupLocationId || undefined,
        dropoffLocationId: body.dropoffLocationId || undefined,
        status: 'REQUESTED',
        fareMinor: quote.fareMinor,
        currency: body.currency || 'SYP',
        metadata: {
          ...(body.metadata || {}),
          pickup,
          dropoff,
          category,
          distanceKm: quote.distanceKm,
          distanceEstimated: quote.estimated,
        },
      },
    })

    if (quote.pickupCoords || quote.dropoffCoords) {
      await db().$executeRaw`
        UPDATE ride_requests
        SET
          pickup_geo = ${quote.pickupCoords ? `SRID=4326;POINT(${quote.pickupCoords.lng} ${quote.pickupCoords.lat})` : null}::geometry,
          dropoff_geo = ${quote.dropoffCoords ? `SRID=4326;POINT(${quote.dropoffCoords.lng} ${quote.dropoffCoords.lat})` : null}::geometry
        WHERE id = ${ride.id}::uuid
      `
    }

    return json(res, 201, { ok: true, ride })
  }

  const rideMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)$/)
  if (rideMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    // Real driver identity for the rider: name + vehicle already exist in the data model
    // (User.displayName, DriverProfile.vehicle*) but were never surfaced here -- the rider used to
    // see only the first 8 characters of the driver's database id. Select() keeps this to exactly
    // what a rider should reasonably see; never the driver's email/phone/passwordHash.
    const ride = await db().rideRequest.findUnique({
      where: { id: rideMatch[1] },
      include: {
        driver: {
          select: {
            id: true,
            displayName: true,
            idDocumentStatus: true,
            driverProfile: { select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true, photoRef: true } },
          },
        },
        review: true,
        paymentProofs: { select: { id: true, status: true, amountMinor: true, currency: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    if (!ride) {
      const error = new Error('Ride request not found.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!context.roles.includes('ADMIN') && !context.roles.includes('SUPPORT') && ride.riderId !== context.user.id && ride.driverId !== context.user.id) {
      const error = new Error('This ride is not available for this account.')
      error.statusCode = 403
      error.code = 'RIDE_FORBIDDEN'
      error.expose = true
      throw error
    }
    // Signed URL, never the raw storage key (photoRef) -- the driver-photo bucket is private
    // (server/lib/storage.mjs), and the key itself is not meant to leave the server.
    const ratingSummary = ride.driverId ? await getDriverRatingSummary(ride.driverId) : null
    const ridePayload = ride.driver
      ? {
          ...ride,
          driver: {
            id: ride.driver.id,
            displayName: ride.driver.displayName,
            // Real, not decorative: reuses the same idDocumentStatus review pipeline already used
            // for guest/host verification -- never a static claim (CAPSULE_RULES.noFakeTrustSignal).
            // A rider only needs the yes/no answer, never the raw internal review-state string.
            isVerified: ride.driver.idDocumentStatus === 'APPROVED',
            driverProfile: ride.driver.driverProfile
              ? {
                  vehicleMake: ride.driver.driverProfile.vehicleMake,
                  vehicleModel: ride.driver.driverProfile.vehicleModel,
                  vehiclePlate: ride.driver.driverProfile.vehiclePlate,
                  photoUrl: ride.driver.driverProfile.photoRef ? signDriverPhotoUrl(ride.driver.driverProfile.photoRef) : null,
                }
              : null,
            ...ratingSummary,
          },
        }
      : ride
    return json(res, 200, { ok: true, ride: ridePayload })
  }

  const cancelMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/cancel$/)
  if (cancelMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['GUEST'])

    const existing = await db().rideRequest.findUnique({ where: { id: cancelMatch[1] } })
    if (!existing || existing.riderId !== context.user.id) {
      const error = new Error('Ride request not found for this account.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }

    // A rider may cancel only before the trip is under way. Once IN_PROGRESS the driver
    // controls the lifecycle, and terminal states cannot be re-cancelled.
    const riderCancellable = ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING']
    if (!riderCancellable.includes(existing.status)) {
      const error = new Error('This ride can no longer be cancelled by the rider.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_CANCELLABLE'
      error.expose = true
      throw error
    }

    // Optimistic-concurrency guard: re-check the status we read so a driver claim/arrival
    // landing at the same moment cannot be silently overwritten by this cancel.
    const cancelResult = await db().rideRequest.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: 'CANCELLED' },
    })

    if (cancelResult.count === 0) {
      const error = new Error('Ride status changed before the cancellation could apply. Reload and try again.')
      error.statusCode = 409
      error.code = 'RIDE_CANCEL_CONFLICT'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({ where: { id: existing.id } })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'SR_RIDER_CANCELLED',
        entityType: 'ride_requests',
        entityId: ride.id,
        before: existing,
        after: ride,
      },
    })

    return json(res, 200, { ok: true, ride })
  }

  const assignMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/assign-driver$/)
  if (assignMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const body = await readJson(req)
    const driver = await db().user.findFirst({
      where: {
        id: body.driverId,
        roles: { some: { role: 'DRIVER' } },
        status: 'ACTIVE',
      },
    })

    if (!driver) {
      const error = new Error('Assigned user must be an active SR driver.')
      error.statusCode = 400
      error.code = 'INVALID_DRIVER_ASSIGNMENT'
      error.expose = true
      throw error
    }

    const existing = await db().rideRequest.findUnique({ where: { id: assignMatch[1] } })
    if (!existing || !['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED'].includes(existing.status)) {
      const error = new Error('Ride is not available for driver assignment.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_ASSIGNABLE'
      error.expose = true
      throw error
    }

    // Re-check status in the WHERE clause (optimistic concurrency): if another admin/support
    // agent assigned a driver to this ride between our read and this write, this matches zero
    // rows instead of silently overwriting their assignment.
    const assignResult = await db().rideRequest.updateMany({
      where: { id: assignMatch[1], status: existing.status },
      data: { driverId: driver.id, status: 'DRIVER_ASSIGNED' },
    })

    if (assignResult.count === 0) {
      const error = new Error('Ride was updated by another admin action. Reload and try again.')
      error.statusCode = 409
      error.code = 'RIDE_ASSIGNMENT_CONFLICT'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({ where: { id: assignMatch[1] } })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'SR_DRIVER_ASSIGNED',
        entityType: 'ride_requests',
        entityId: ride.id,
        before: existing,
        after: ride,
      },
    })

    return json(res, 200, { ok: true, ride })
  }

  const claimMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/claim$/)
  if (claimMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])

    const existing = await db().rideRequest.findUnique({ where: { id: claimMatch[1] } })
    if (!existing || existing.driverId || !['REQUESTED', 'MATCHING'].includes(existing.status)) {
      const error = new Error('This ride has already been claimed by another driver.')
      error.statusCode = 409
      error.code = 'RIDE_ALREADY_CLAIMED'
      error.expose = true
      throw error
    }

    // Optimistic-concurrency guard: the WHERE clause re-checks driverId is still null so two
    // drivers tapping "accept" on the same pending ride at the same moment can't both win.
    const claimResult = await db().rideRequest.updateMany({
      where: { id: claimMatch[1], driverId: null, status: { in: ['REQUESTED', 'MATCHING'] } },
      data: { driverId: context.user.id, status: 'DRIVER_ASSIGNED' },
    })

    if (claimResult.count === 0) {
      const error = new Error('This ride has already been claimed by another driver.')
      error.statusCode = 409
      error.code = 'RIDE_ALREADY_CLAIMED'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({
      where: { id: claimMatch[1] },
      include: { rider: { select: { id: true, displayName: true, email: true } } },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'SR_DRIVER_SELF_CLAIMED',
        entityType: 'ride_requests',
        entityId: ride.id,
        before: existing,
        after: ride,
      },
    })

    return json(res, 200, { ok: true, ride })
  }

  // Trust remediation: SR Ride previously had no receipt/rating at all after a completed ride.
  // Mirrors POST /api/reviews (reviews.mjs) exactly -- same validation, same one-review-per-unit
  // rule, same admin-hide model -- just for a ride instead of a booking.
  const reviewMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/review$/)
  if (reviewMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const rating = Number(body.rating)
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) || null : null

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      const error = new Error('rating must be an integer from 1 to 5.')
      error.statusCode = 400
      error.code = 'REVIEW_RATING_INVALID'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findFirst({
      where: { id: reviewMatch[1], riderId: context.user.id },
    })

    if (!ride) {
      const error = new Error('Ride not found for this rider account.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (ride.status !== 'COMPLETED') {
      const error = new Error('Only completed rides can be reviewed.')
      error.statusCode = 400
      error.code = 'REVIEW_RIDE_NOT_COMPLETED'
      error.expose = true
      throw error
    }

    const existingReview = await db().rideReview.findUnique({ where: { rideId: ride.id } })
    if (existingReview) {
      const error = new Error('This ride has already been reviewed.')
      error.statusCode = 409
      error.code = 'REVIEW_ALREADY_EXISTS'
      error.expose = true
      throw error
    }

    const review = await db().rideReview.create({
      data: {
        rideId: ride.id,
        riderId: context.user.id,
        rating,
        comment,
      },
    })

    return json(res, 201, { ok: true, review })
  }

  return false
}
