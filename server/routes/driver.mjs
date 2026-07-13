import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

export async function handleDriver(req, res, url, context) {
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
    const completedRides = rides.filter((ride) => ride.status === 'COMPLETED')
    // updatedAt is Prisma's @updatedAt column, last written on the COMPLETED transition itself
    // (that status is terminal — see assertDriverRideTransition — so no later write can move it
    // again), which makes it a reliable stand-in for "completed at" without a dedicated column.
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const completedToday = completedRides.filter((ride) => ride.updatedAt >= todayStart)

    return json(res, 200, {
      ok: true,
      overview: {
        driver: {
          id: context.user.id,
          email: context.user.email,
          displayName: context.user.displayName,
          roles: context.roles,
          idDocumentStatus: context.user.idDocumentStatus,
        },
        totals: {
          assigned: rides.length,
          active: rides.filter((ride) => ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'].includes(ride.status)).length,
          completed: completedRides.length,
          earningsMinor: completedRides.reduce((sum, ride) => sum + (ride.fareMinor || 0), 0),
          todayCompletedCount: completedToday.length,
          todayEarningsMinor: completedToday.reduce((sum, ride) => sum + (ride.fareMinor || 0), 0),
        },
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
