import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { deleteDriverPhoto, saveDriverPhoto } from '../lib/driver-photo-storage.mjs'
import { getDriverRatingSummary } from '../lib/driver-rating.mjs'
import { updateDriverLocation } from '../lib/live-map.mjs'

export async function handleDriver(req, res, url, context) {
  // SR Ride vs. Uber gap-closure (P0 #1): the driver client reports its own GPS position here
  // while sharing is on; never gated to a specific ride (a real driver app reports continuously,
  // same as the location column itself belongs to the driver, not to any one ride).
  if (url.pathname === '/api/driver/location') {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req)
    const lat = Number(body.lat)
    const lng = Number(body.lng)

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      const error = new Error('A valid lat/lng is required.')
      error.statusCode = 400
      error.code = 'DRIVER_LOCATION_INVALID'
      error.expose = true
      throw error
    }

    await updateDriverLocation(context.user.id, lat, lng)
    return json(res, 200, { ok: true })
  }
  // SR Ride vs. Uber gap-closure: a driver's own photo, so a rider can actually recognize who
  // they're getting into a car with (previously nothing beyond name + vehicle text existed).
  // Mirrors PATCH /api/me/id-document exactly -- same validation shape, same storage discipline.
  if (url.pathname === '/api/driver/photo') {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''

    if (!fileBase64 || !mimeType) {
      const error = new Error('A photo file is required.')
      error.statusCode = 400
      error.code = 'DRIVER_PHOTO_REQUIRED'
      error.expose = true
      throw error
    }

    const storageKey = await saveDriverPhoto(fileBase64, mimeType)
    const previous = await db().driverProfile.findUnique({ where: { userId: context.user.id }, select: { photoRef: true } })

    const profile = await db().driverProfile.upsert({
      where: { userId: context.user.id },
      create: { userId: context.user.id, photoRef: storageKey, photoMimeType: mimeType },
      update: { photoRef: storageKey, photoMimeType: mimeType },
      select: { photoRef: true, photoMimeType: true },
    })

    // Replacing a previous photo -- remove the old file now that the new one is safely written and
    // the DB row points at the new one (same ordering as the ID-document replace path).
    if (previous?.photoRef && previous.photoRef !== storageKey) {
      await deleteDriverPhoto(previous.photoRef)
    }

    return json(res, 200, { ok: true, driverProfile: profile })
  }

  if (url.pathname === '/api/driver/rides/pending') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const rides = await db().rideRequest.findMany({
      where: { driverId: null, status: { in: ['REQUESTED', 'MATCHING'] } },
      include: {
        rider: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { requestedAt: 'asc' },
      take: 20,
    })
    return json(res, 200, { ok: true, rides })
  }

  if (url.pathname === '/api/driver/rides') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const rides = await db().rideRequest.findMany({
      where: { driverId: context.user.id },
      include: {
        rider: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    })
    const ratingSummary = await getDriverRatingSummary(context.user.id)
    return json(res, 200, {
      ok: true,
      overview: {
        driver: {
          id: context.user.id,
          email: context.user.email,
          displayName: context.user.displayName,
          roles: context.roles,
        },
        totals: {
          assigned: rides.length,
          active: rides.filter((ride) => ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'].includes(ride.status)).length,
          completed: rides.filter((ride) => ride.status === 'COMPLETED').length,
          earningsMinor: rides
            .filter((ride) => ride.status === 'COMPLETED')
            .reduce((sum, ride) => sum + (ride.fareMinor || 0), 0),
        },
        rating: ratingSummary,
        rides,
      },
    })
  }

  const rideMatch = url.pathname.match(/^\/api\/driver\/rides\/([^/]+)\/status$/)
  if (rideMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req)
    const nextStatus = normalizeDriverRideStatus(body.status || body.action)
    const existing = await db().rideRequest.findFirst({
      where: { id: rideMatch[1], driverId: context.user.id },
    })

    if (!existing) {
      const error = new Error('Ride not found for this driver account.')
      error.statusCode = 404
      error.code = 'DRIVER_RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }

    assertDriverRideTransition(existing.status, nextStatus)

    // Re-check status in the WHERE clause (optimistic concurrency): if another request already
    // moved this ride between our read and this write, this matches zero rows instead of
    // silently applying a transition that was only valid for the stale status we read.
    const updateResult = await db().rideRequest.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: nextStatus },
    })

    if (updateResult.count === 0) {
      const error = new Error('Ride status changed before this update could apply. Reload and try again.')
      error.statusCode = 409
      error.code = 'DRIVER_RIDE_STATUS_CONFLICT'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({
      where: { id: existing.id },
      include: {
        rider: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: `DRIVER_${nextStatus}`,
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

function normalizeDriverRideStatus(value) {
  const status = String(value || '').toUpperCase()
  if (['DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) return status

  const error = new Error('status must be DRIVER_ARRIVING, IN_PROGRESS, COMPLETED, or CANCELLED.')
  error.statusCode = 400
  error.code = 'INVALID_DRIVER_RIDE_STATUS'
  error.expose = true
  throw error
}

function assertDriverRideTransition(currentStatus, nextStatus) {
  const allowed = {
    DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'CANCELLED'],
    DRIVER_ARRIVING: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  }

  if (allowed[currentStatus]?.includes(nextStatus)) return

  const error = new Error(`Cannot move ride from ${currentStatus} to ${nextStatus}.`)
  error.statusCode = 400
  error.code = 'INVALID_DRIVER_RIDE_TRANSITION'
  error.expose = true
  throw error
}
