import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { quoteSrRide } from '../lib/sr-geocoding.mjs'

export async function handleSrRides(req, res, url, context) {
  if (url.pathname === '/api/sr/quote') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const quote = quoteSrRide({
      pickup: body.pickup,
      dropoff: body.dropoff,
      category: body.category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
      currency: body.currency,
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
    const quote = quoteSrRide({
      pickup,
      dropoff,
      category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
      currency: body.currency,
    })

    const ride = await db().rideRequest.create({
      data: {
        riderId: context.user.id,
        pickupLocationId: body.pickupLocationId || undefined,
        dropoffLocationId: body.dropoffLocationId || undefined,
        status: 'REQUESTED',
        fareMinor: quote.fareMinor,
        currency: quote.currency,
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
        WHERE id::text = ${ride.id}
      `
    }

    return json(res, 201, { ok: true, ride })
  }

  const rideMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)$/)
  if (rideMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const ride = await db().rideRequest.findUnique({ where: { id: rideMatch[1] } })
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

  return false
}
