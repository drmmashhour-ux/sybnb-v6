import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { deleteDriverPhoto, saveDriverPhoto } from '../lib/driver-photo-storage.mjs'
import { getDriverRatingSummary } from '../lib/driver-rating.mjs'
import { updateDriverLocation } from '../lib/live-map.mjs'
import { activateScheduledRides } from '../lib/ride-schedule.mjs'
import { sendPushNotification } from '../lib/push-notifications.mjs'
import { SR_RIDE_COMMISSION_RATE } from '../lib/booking-policy.mjs'
// SEC-002R rounds 3 and 4: the two TERMINAL transitions this route can write are Class A -- COMPLETED
// makes a fare billable, CANCELLED irreversibly destroys a receivable. See the ride status handler
// below for the full reasoning on each.
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'

// SEC-002R: the transitions this route may write that are IRREVERSIBLE and financially load-bearing,
// and therefore re-authorized at the commit boundary. Both are terminal states. See the ride status
// handler for the per-status reasoning and for why the two intermediate transitions are not here.
const COMMIT_PROTECTED_DRIVER_STATUSES = new Set(['COMPLETED', 'CANCELLED'])

const RIDER_STATUS_PUSH_COPY = {
  DRIVER_ARRIVING: { title: 'Your driver is arriving', body: 'Your SR driver is on the way to your pickup point.' },
  IN_PROGRESS: { title: 'Trip started', body: 'Your SR ride is now in progress.' },
  COMPLETED: { title: 'Trip completed', body: 'Thanks for riding with SR. Your receipt is ready.' },
}

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

  // SR Ride vs. Uber gap-closure (P2 #16): self-declared, like the vehicle make/model/plate fields
  // already are -- shown to riders as real data, never dressed up as a verified trust badge.
  if (url.pathname === '/api/driver/accessibility') {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req)
    const profile = await db().driverProfile.upsert({
      where: { userId: context.user.id },
      create: { userId: context.user.id, accessibilityCapable: Boolean(body.accessibilityCapable) },
      update: { accessibilityCapable: Boolean(body.accessibilityCapable) },
      select: { accessibilityCapable: true },
    })
    return json(res, 200, { ok: true, driverProfile: profile })
  }

  // Vehicle registration. The DriverProfile has make/model/plate columns and riders are shown them,
  // but nothing wrote them — so every driver card was blank. A registered vehicle (plate) is now
  // required before a driver can claim a ride (enforced in server/routes/sr-rides.mjs).
  if (url.pathname === '/api/driver/vehicle') {
    requireAuth(context, ['DRIVER'])
    if (req.method === 'GET') {
      const profile = await db().driverProfile.findUnique({
        where: { userId: context.user.id },
        select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true },
      })
      return json(res, 200, { ok: true, driverProfile: profile || null })
    }
    if (req.method === 'PUT') {
      const body = await readJson(req)
      const vehicleMake = String(body.vehicleMake || '').trim().slice(0, 60)
      const vehicleModel = String(body.vehicleModel || '').trim().slice(0, 60)
      const vehiclePlate = String(body.vehiclePlate || '').trim().slice(0, 20)
      if (!vehicleMake || !vehicleModel || !vehiclePlate) {
        const error = new Error('Vehicle make, model and plate are all required.')
        error.statusCode = 400
        error.code = 'VEHICLE_FIELDS_REQUIRED'
        error.expose = true
        throw error
      }
      const profile = await db().driverProfile.upsert({
        where: { userId: context.user.id },
        create: { userId: context.user.id, vehicleMake, vehicleModel, vehiclePlate },
        update: { vehicleMake, vehicleModel, vehiclePlate },
        select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true },
      })
      return json(res, 200, { ok: true, driverProfile: profile })
    }
    return methodNotAllowed(res, ['GET', 'PUT'])
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
    // SR Ride vs. Uber gap-closure (P1 #6): activate any scheduled ride whose pickup time has
    // come within the driver-visibility window -- see server/lib/ride-schedule.mjs. Unscoped here
    // (unlike the single-ride GET) since this is exactly the read path meant to surface every
    // ride ready for dispatch, scheduled or not.
    await activateScheduledRides()
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
        stops: { select: { address: true, lat: true, lng: true }, orderBy: { sequence: 'asc' } },
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
        stops: { select: { address: true, lat: true, lng: true }, orderBy: { sequence: 'asc' } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    })
    const ratingSummary = await getDriverRatingSummary(context.user.id)
    const driverProfile = await db().driverProfile.findUnique({
      where: { userId: context.user.id },
      select: { accessibilityCapable: true, vehicleMake: true, vehicleModel: true, vehiclePlate: true },
    })
    // Honest earnings: COLLECTED money — the driver's actual ride-fare wallet credits (already net
    // of the SYBNB commission) — not merely the BILLED fares of completed rides, which overstated
    // earnings whenever a rider hadn't paid yet. We also surface, per ride, whether it's been PAID
    // or is still AWAITING_PAYMENT, so a driver can see exactly what's outstanding instead of
    // silently wondering why a completed ride didn't pay (driver-satisfaction fix 2026-10-09).
    const collectedEntries = await db().walletEntry.findMany({
      where: { wallet: { userId: context.user.id }, type: 'CREDIT', referenceType: { in: ['ride_fare', 'ride_cancellation_fee'] } },
      select: { referenceId: true, amountMinor: true },
    })
    const collectedMinor = collectedEntries.reduce((sum, e) => sum + (e.amountMinor || 0), 0)
    const paidRideIds = new Set(collectedEntries.map((e) => e.referenceId))
    // Net the driver will receive once a completed/cancelled-fee ride is paid: a fare is net of the
    // commission; a cancellation fee is paid in full (no commission).
    const expectedNetForRide = (ride) => {
      if (ride.status === 'CANCELLED') return ride.cancellationFeeMinor || 0
      if (ride.status === 'COMPLETED') return Math.round((ride.fareMinor || 0) * (1 - SR_RIDE_COMMISSION_RATE))
      return 0
    }
    const annotatedRides = rides.map((ride) => {
      const payable = ride.status === 'COMPLETED' || (ride.status === 'CANCELLED' && ride.cancellationFeeMinor)
      const paymentStatus = paidRideIds.has(ride.id) ? 'PAID' : (payable ? 'AWAITING_PAYMENT' : 'NONE')
      return { ...ride, paymentStatus, expectedNetMinor: expectedNetForRide(ride) }
    })
    const billedMinor = rides.filter((ride) => ride.status === 'COMPLETED').reduce((sum, ride) => sum + (ride.fareMinor || 0), 0)
    // Net earnings still awaiting payment (rides done but not yet paid by rider + approved).
    const awaitingMinor = annotatedRides
      .filter((ride) => ride.paymentStatus === 'AWAITING_PAYMENT')
      .reduce((sum, ride) => sum + (ride.expectedNetMinor || 0), 0)
    return json(res, 200, {
      ok: true,
      overview: {
        driver: {
          id: context.user.id,
          email: context.user.email,
          displayName: context.user.displayName,
          roles: context.roles,
          accessibilityCapable: driverProfile?.accessibilityCapable || false,
          vehicleMake: driverProfile?.vehicleMake || null,
          vehicleModel: driverProfile?.vehicleModel || null,
          vehiclePlate: driverProfile?.vehiclePlate || null,
        },
        totals: {
          assigned: rides.length,
          active: rides.filter((ride) => ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'].includes(ride.status)).length,
          completed: rides.filter((ride) => ride.status === 'COMPLETED').length,
          // earningsMinor is money actually COLLECTED (net of commission); billedMinor is the gross
          // fare value of completed rides; awaitingMinor is net still owed on unpaid completed rides.
          earningsMinor: collectedMinor,
          billedMinor,
          awaitingMinor,
          // So the UI can show "you keep X%" without hardcoding the rate.
          commissionRate: SR_RIDE_COMMISSION_RATE,
        },
        rating: ratingSummary,
        rides: annotatedRides,
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

    // SEC-002R rounds 3 (COMPLETED) and 4 (CANCELLED). The two TERMINAL transitions this route can
    // write are Class A; the two intermediate ones are not. Which is which, and why:
    //
    //   COMPLETED  (round 3, item 4) -- this is what makes a fare BILLABLE.
    //     server/routes/business.mjs's /api/business/usage totals corporate spend as
    //     `rides.filter(r => r.status === 'COMPLETED').reduce((sum, r) => sum + r.fareMinor, 0)`, and
    //     this route's own overview computes earningsMinor the same way -- so writing COMPLETED is
    //     the act that turns a trip into money owed by a company and owed to a driver. There is no
    //     un-complete endpoint.
    //
    //   CANCELLED  (round 4) -- this DESTROYS a receivable, which is the same irreversibility in the
    //     opposite direction, and round 3's reasoning missed it. CANCELLED is reachable from ALL
    //     THREE prior states (see assertDriverRideTransition below) and is terminal: nothing moves a
    //     ride back out of it. This handler writes ONLY `status` on that transition -- it never sets
    //     `cancellationFeeMinor`, unlike the rider-cancel path in server/routes/sr-rides.mjs:328,
    //     which is the sole writer of that field. So a ride driven to CANCELLED here lands with
    //     `cancellationFeeMinor` NULL, and server/routes/payments.mjs:591-601 admits a ride for
    //     payment only when it is `COMPLETED` or `{ status: 'CANCELLED', cancellationFeeMinor:
    //     { not: null } }` -- a NULL-fee CANCELLED ride matches neither, so it drops out of the
    //     payable set entirely, and out of earningsMinor/business usage (both of which filter on
    //     COMPLETED) at the same time. A driver whose session or account authority was revoked
    //     mid-flight could therefore still commit the one write that permanently erases a real,
    //     already-earned receivable. Same Class A severity as COMPLETED, protected the same way.
    //
    // requiredRoles MATCHES this route's own requireAuth(context, ['DRIVER']) exactly, for both. The
    // route is SELF-SCOPED (the `driverId: context.user.id` filter on the read above), so
    // interestedPartyIds is deliberately not passed -- the driver legitimately IS the counterparty on
    // their own ride. The self-scope is carried into the guarded write's WHERE clause so the
    // protected statement stands on its own rather than trusting the pre-transaction read.
    //
    // The OTHER transitions on this route (DRIVER_ARRIVING, IN_PROGRESS) are deliberately left as
    // they are: neither status is read by any money computation in this codebase (they appear only in
    // pooling capacity, messaging eligibility, live-tracking and the "active" count), neither is
    // terminal -- both still lead to COMPLETED or CANCELLED, which ARE protected -- and neither is
    // irreversible in any financial sense. Noted in docs/security/sec-002r-mutation-inventory.md as
    // Class B rather than silently widened.
    const guardedWhere = { id: existing.id, status: existing.status, driverId: context.user.id }
    const updateResult = COMMIT_PROTECTED_DRIVER_STATUSES.has(nextStatus)
      ? await db().$transaction(async (tx) => {
          await reauthorizeAtCommit(tx, context, {
            action: `SR_RIDE_${nextStatus}`,
            requiredRoles: ['DRIVER'],
          })
          return tx.rideRequest.updateMany({ where: guardedWhere, data: { status: nextStatus } })
        })
      // Re-check status in the WHERE clause (optimistic concurrency): if another request already
      // moved this ride between our read and this write, this matches zero rows instead of
      // silently applying a transition that was only valid for the stale status we read.
      : await db().rideRequest.updateMany({ where: guardedWhere, data: { status: nextStatus } })

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

    // SR Ride vs. Uber gap-closure (P1 #7): fire-and-forget -- sendPushNotification() never throws
    // (see server/lib/push-notifications.mjs), so a missing/expired subscription or unconfigured
    // VAPID keys can never fail the status update itself.
    const pushCopy = RIDER_STATUS_PUSH_COPY[nextStatus]
    if (pushCopy) {
      void sendPushNotification(ride.riderId, { ...pushCopy, url: '/#/ride' })
    }

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
