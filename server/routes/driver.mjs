import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { deleteDriverPhoto, saveDriverPhoto } from '../lib/driver-photo-storage.mjs'
import { getDriverRatingSummary } from '../lib/driver-rating.mjs'
import { updateDriverLocation, getDriverLocation, getRideCoords, haversineKm, etaMinutesForKm } from '../lib/live-map.mjs'
import { activateScheduledRides } from '../lib/ride-schedule.mjs'
import { runDispatchSweep } from '../lib/ride-dispatch.mjs'
import { VEHICLE_CATEGORY_VALUES, isCategoryAllowedForYear, VEHICLE_MAX_AGE_YEARS } from '../lib/vehicle-category.mjs'
import { sendPushNotification } from '../lib/push-notifications.mjs'
import { SR_RIDE_COMMISSION_RATE } from '../lib/booking-policy.mjs'
import { settlePrepaidRide } from '../lib/finance-ledger.mjs'
// SEC-002R rounds 3 and 4: the two TERMINAL transitions this route can write are Class A -- COMPLETED
// makes a fare billable, CANCELLED irreversibly destroys a receivable. See the ride status handler
// below for the full reasoning on each.
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'
import { logRideEventSafe } from '../lib/ride-events.mjs'

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
        select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true, vehicleStatus: true, vehicleCategory: true, vehicleYear: true, vehicleColor: true, registrationExpiresAt: true, inspectionStatus: true, inspectionExpiresAt: true },
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
      // Optional self-declared vehicle category (tier-to-vehicle enforcement). When present it must be
      // one of the five enum values; setting/changing it is allowed and leaves the vehicleStatus
      // review behavior untouched (make/model/plate changes still re-open review as before).
      let vehicleCategory
      if (body.vehicleCategory !== undefined && body.vehicleCategory !== null && body.vehicleCategory !== '') {
        vehicleCategory = String(body.vehicleCategory)
        if (!VEHICLE_CATEGORY_VALUES.includes(vehicleCategory)) {
          const error = new Error('vehicleCategory must be one of BIKE, ECONOMY, COMFORT, SUV, VAN.')
          error.statusCode = 400
          error.code = 'VEHICLE_CATEGORY_INVALID'
          error.expose = true
          throw error
        }
      }
      // Safety-grade vehicle profile: build year, color and registration expiry. The driver may NOT
      // set inspectionStatus / inspectionExpiresAt here -- those are admin-only (set via the admin
      // vehicle-review route), so any such fields in the body are simply ignored.
      let vehicleYear
      if (body.vehicleYear !== undefined && body.vehicleYear !== null && body.vehicleYear !== '') {
        const y = Number(body.vehicleYear)
        const currentYear = new Date().getFullYear()
        if (!Number.isInteger(y) || y < 1980 || y > currentYear + 1) {
          const error = new Error(`vehicleYear must be an integer between 1980 and ${currentYear + 1}.`)
          error.statusCode = 400
          error.code = 'VEHICLE_YEAR_INVALID'
          error.expose = true
          throw error
        }
        vehicleYear = y
      }
      let vehicleColor
      if (body.vehicleColor !== undefined) {
        vehicleColor = String(body.vehicleColor || '').trim().slice(0, 40)
      }
      let registrationExpiresAt
      if (body.registrationExpiresAt !== undefined && body.registrationExpiresAt !== null && body.registrationExpiresAt !== '') {
        const d = new Date(body.registrationExpiresAt)
        if (Number.isNaN(d.getTime())) {
          const error = new Error('registrationExpiresAt must be a valid ISO date.')
          error.statusCode = 400
          error.code = 'REGISTRATION_DATE_INVALID'
          error.expose = true
          throw error
        }
        registrationExpiresAt = d
      }
      // Year-based tier policy: when the driver sets/changes their category and a build year is known
      // (just supplied, or already saved), the car must be young enough for that tier (BIKE is always
      // allowed; model-based division isn't feasible without a vehicle dataset, so tiering is by age).
      if (vehicleCategory) {
        let effectiveYear = vehicleYear
        if (effectiveYear === undefined) {
          const existingYear = await db().driverProfile.findUnique({
            where: { userId: context.user.id },
            select: { vehicleYear: true },
          })
          effectiveYear = existingYear?.vehicleYear ?? undefined
        }
        if (effectiveYear != null && !isCategoryAllowedForYear(vehicleCategory, effectiveYear)) {
          const maxAge = VEHICLE_MAX_AGE_YEARS[vehicleCategory]
          const error = new Error(`This vehicle is too old for the ${vehicleCategory} category (maximum age ${maxAge} years).`)
          error.statusCode = 400
          error.code = 'VEHICLE_CATEGORY_YEAR_INVALID'
          error.expose = true
          throw error
        }
      }
      // Persist the new fields alongside the category; a field absent from the body is left untouched.
      const extraVehicleFields = {
        ...(vehicleCategory !== undefined ? { vehicleCategory } : {}),
        ...(vehicleYear !== undefined ? { vehicleYear } : {}),
        ...(vehicleColor !== undefined ? { vehicleColor: vehicleColor || null } : {}),
        ...(registrationExpiresAt !== undefined ? { registrationExpiresAt } : {}),
      }
      // Registering or changing the vehicle sends it (back) to PENDING_REVIEW: a self-declared
      // vehicle must be reviewed before the driver can accept rides, and any later change re-opens
      // review so a driver can't swap to an unapproved car after approval.
      const profile = await db().driverProfile.upsert({
        where: { userId: context.user.id },
        create: { userId: context.user.id, vehicleMake, vehicleModel, vehiclePlate, vehicleStatus: 'PENDING_REVIEW', ...extraVehicleFields },
        update: { vehicleMake, vehicleModel, vehiclePlate, vehicleStatus: 'PENDING_REVIEW', ...extraVehicleFields },
        select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true, vehicleStatus: true, vehicleCategory: true, vehicleYear: true, vehicleColor: true, registrationExpiresAt: true, inspectionStatus: true, inspectionExpiresAt: true },
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
    // Full auto-dispatch (2026-10-10): no daemon in this deployment, so the offer-escalation sweep
    // runs here on the pending-list read -- mirroring activateScheduledRides() above. It expires
    // lapsed offers (re-offering to the next-nearest driver) and seeds offers on still-unoffered
    // open rides. Best-effort; never throws into this read path.
    await runDispatchSweep()
    const rides = await db().rideRequest.findMany({
      where: {
        driverId: null,
        status: { in: ['REQUESTED', 'MATCHING'] },
        // A driver sees a ride only if it's been offered specifically to them, or it's an open
        // (unoffered) ride claimable as the manual fallback -- but never one they already declined.
        OR: [{ offeredDriverId: context.user.id }, { offeredDriverId: null }],
        NOT: { declinedByIds: { has: context.user.id } },
      },
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
    // Proximity dispatch (2026-10-09): rank open requests nearest-first from the driver's own live
    // location, and attach a straight-line distance + rough ETA to each pickup so a driver picks the
    // closest ride instead of scanning a flat FIFO list. Falls back to FIFO (unchanged) when the
    // driver has no fresh location or a ride has no geocoded pickup. Pure UX/estimate, never billing.
    const driverLoc = await getDriverLocation(context.user.id)
    const withProximity = await Promise.all(rides.map(async (ride) => {
      let pickupDistanceKm = null
      if (driverLoc) {
        const coords = await getRideCoords(ride.id)
        pickupDistanceKm = coords.pickup ? haversineKm(driverLoc, coords.pickup) : null
      }
      return { ...ride, offeredToYou: ride.offeredDriverId === context.user.id, pickupDistanceKm, etaToPickupMinutes: etaMinutesForKm(pickupDistanceKm) }
    }))
    // Rides offered directly to this driver always sort first (they're the active hand-raise), then
    // the existing nearest-first ordering for the open fallback rides below them.
    withProximity.sort((a, b) => {
      if (a.offeredToYou !== b.offeredToYou) return a.offeredToYou ? -1 : 1
      if (!driverLoc) return 0
      if (a.pickupDistanceKm == null && b.pickupDistanceKm == null) return 0
      if (a.pickupDistanceKm == null) return 1
      if (b.pickupDistanceKm == null) return -1
      return a.pickupDistanceKm - b.pickupDistanceKm
    })
    return json(res, 200, { ok: true, rides: withProximity, driverLocated: Boolean(driverLoc) })
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
      select: { accessibilityCapable: true, vehicleMake: true, vehicleModel: true, vehiclePlate: true, vehicleStatus: true, vehicleCategory: true, vehicleYear: true, vehicleColor: true, registrationExpiresAt: true, inspectionStatus: true, inspectionExpiresAt: true },
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
          vehicleStatus: driverProfile?.vehicleStatus || null,
          vehicleCategory: driverProfile?.vehicleCategory || null,
          vehicleYear: driverProfile?.vehicleYear ?? null,
          vehicleColor: driverProfile?.vehicleColor || null,
          registrationExpiresAt: driverProfile?.registrationExpiresAt ? driverProfile.registrationExpiresAt.toISOString() : null,
          inspectionStatus: driverProfile?.inspectionStatus || null,
          inspectionExpiresAt: driverProfile?.inspectionExpiresAt ? driverProfile.inspectionExpiresAt.toISOString() : null,
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
          // SR fares are USD-denominated (see countries/syria/geo/geocoding.mjs). Surface the currency
          // so the dashboard labels earnings in the ride currency instead of a hardcoded SYP. Falls
          // back to the first ride's currency, then USD.
          currency: rides[0]?.currency || 'USD',
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
          const r = await tx.rideRequest.updateMany({ where: guardedWhere, data: { status: nextStatus } })
          // Prepaid ride (2026-10-09): completing it settles the fare INSTANTLY from the rider's
          // prepayment — driver gets the net (fare minus commission), platform the commission — with no post-ride proof or admin step.
          // Idempotent (keyed by ride id) and marked settled so a re-run never double-pays.
          if (r.count === 1 && nextStatus === 'COMPLETED' && existing.metadata?.prepaid && !existing.metadata?.settled) {
            await settlePrepaidRide(tx, { ride: existing })
            await tx.rideRequest.update({
              where: { id: existing.id },
              data: { metadata: { ...existing.metadata, settled: true } },
            })
          }
          return r
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

    // Safety Phase 1 (2026-10-10): append this status change to the ride's immutable black box, with
    // the driver's live location when it is fresh (getDriverLocation returns null when stale). Best-
    // effort and fire-and-forget -- it never blocks or fails the status update.
    const RIDE_EVENT_FOR_STATUS = { DRIVER_ARRIVING: 'ARRIVING', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' }
    void (async () => {
      const loc = await getDriverLocation(context.user.id).catch(() => null)
      await logRideEventSafe(db(), {
        rideId: ride.id,
        type: RIDE_EVENT_FOR_STATUS[nextStatus] ?? nextStatus,
        actorId: context.user.id,
        actorRole: 'DRIVER',
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
        meta: { from: existing.status, to: nextStatus },
      })
    })()

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
