import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
// Consume the country-neutral geocoding seam (resolves the active country's geocoder, fail-closed) —
// the route does NOT depend on any country's geocoder module directly.
import { quoteSrRideForActiveCountry } from '../lib/geo-adapter.mjs'
import { signDriverPhotoUrl } from '../lib/driver-photo-storage.mjs'
import { getDriverRatingSummary } from '../lib/driver-rating.mjs'
import { getDriverLocation, getRideCoords } from '../lib/live-map.mjs'
import { signRideShareToken, verifyRideShareToken } from '../lib/ride-share.mjs'
import { defaultCurrency } from '../lib/country.mjs'
import { activateScheduledRides, MIN_SCHEDULE_LEAD_MS } from '../lib/ride-schedule.mjs'
import {
  computeDiscountMinor,
  isPromoRedemptionUniqueViolation,
  promoAlreadyUsedError,
  validateActivePromoCode,
} from '../lib/promo-code.mjs'
import { sendPushNotification } from '../lib/push-notifications.mjs'
import { applyShareDiscount, poolClaimEligibility } from '../lib/ride-pooling.mjs'

// SR Ride vs. Uber gap-closure (P0 #1): only while a driver is actually en route to or on this
// trip -- a completed or cancelled ride has no live position to show, and showing one would be
// stale/misleading rather than genuinely live.
const LIVE_TRACKING_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']

// Placeholder rate pending a real business decision from the owner -- see the cancel handler
// below for the disclosure. Not derived from anything; a plain, named, easily-found constant.
const RIDE_CANCELLATION_FEE_PERCENT = 20

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
    // SR Ride vs. Uber gap-closure (P2 #14): up to 3 intermediate stops, matching Uber's own
    // multi-stop cap. Blank entries are dropped rather than rejected -- a rider clearing a stop
    // field shouldn't block the whole request.
    const stops = (Array.isArray(body.stops) ? body.stops : [])
      .map((stop) => String(stop || '').trim())
      .filter(Boolean)
      .slice(0, 3)
    const stopCoordsOverrides = Array.isArray(body.stopCoords) ? body.stopCoords : []
    const quote = quoteSrRideForActiveCountry({
      pickup,
      dropoff,
      category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
      stops,
      stopCoordsOverrides,
    })

    // SR Ride vs. Uber gap-closure (P1 #6): an optional future pickup time. A ride created dormant
    // (RideStatus.DRAFT) only becomes dispatchable once activateScheduledRides() picks it up from a
    // read path -- see server/lib/ride-schedule.mjs for why (no scheduler in this deployment).
    let scheduledFor
    if (body.scheduledFor) {
      const parsed = new Date(body.scheduledFor)
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
        const error = new Error('A scheduled ride must be requested at least 30 minutes ahead.')
        error.statusCode = 400
        error.code = 'RIDE_SCHEDULE_TOO_SOON'
        error.expose = true
        throw error
      }
      scheduledFor = parsed
    }

    // SR Ride vs. Uber gap-closure: an optional "bill to my company" flag. Real membership check,
    // never a client-supplied businessAccountId -- a rider can only attribute a ride to a company
    // they're an actual, currently-active member of.
    let businessAccountId
    if (body.billToBusinessAccount) {
      const membership = await db().businessAccountMember.findFirst({
        where: { userId: context.user.id, businessAccount: { active: true } },
        select: { businessAccountId: true },
      })
      if (!membership) {
        const error = new Error('You are not a member of an active business account.')
        error.statusCode = 403
        error.code = 'BUSINESS_ACCOUNT_NOT_MEMBER'
        error.expose = true
        throw error
      }
      businessAccountId = membership.businessAccountId
    }

    // SR Ride vs. Uber gap-closure (P2 #12): an optional promo code, applied against the ride's
    // own already-computed fareMinor -- never a client-supplied discount. Validated read-only
    // first (codes aren't concurrently created/modified by the requesting rider, so no race there);
    // the actual redemption is created in the SAME transaction as the ride itself, so a concurrent
    // double-submission of the same code by the same rider rolls the whole ride creation back
    // instead of leaving a discounted ride with no valid redemption record.
    let promo
    let discountMinor = 0
    if (body.promoCode) {
      promo = await validateActivePromoCode(body.promoCode)
      discountMinor = computeDiscountMinor(promo, quote.fareMinor)
    }

    // Ride-pooling: an independent revenue audit found the flat discount was previously applied
    // right here, unconditionally, from the rider's own client-supplied `shareable` flag -- meaning
    // any rider could always opt in for a guaranteed 15% off regardless of whether a driver ever
    // actually pooled the ride with anyone (confirmed live: a shareable ride claimed as a driver's
    // only active ride, never paired, still billed at the discounted fare). `shareable` still
    // records the rider's opt-in (it's what makes THEIR ride eligible to be pooled, and what a
    // driver's claim checks against), but the fare itself starts undiscounted; the claim route
    // below applies applyShareDiscount() only once poolClaimEligibility() confirms a genuine pool.
    const shareable = Boolean(body.shareable)
    const finalFareMinor = quote.fareMinor - discountMinor

    const rideData = {
      riderId: context.user.id,
      pickupLocationId: body.pickupLocationId || undefined,
      dropoffLocationId: body.dropoffLocationId || undefined,
      status: scheduledFor ? 'DRAFT' : 'REQUESTED',
      scheduledFor,
      accessibilityRequired: Boolean(body.accessibilityRequired),
      shareable,
      fareMinor: finalFareMinor,
      promoCodeId: promo?.id,
      discountMinor: promo ? discountMinor : undefined,
      businessAccountId,
      currency: body.currency || defaultCurrency(),
      metadata: {
        ...(body.metadata || {}),
        pickup,
        dropoff,
        category,
        distanceKm: quote.distanceKm,
        distanceEstimated: quote.estimated,
      },
    }

    let ride
    if (promo) {
      try {
        ride = await db().$transaction(async (tx) => {
          const created = await tx.rideRequest.create({ data: rideData })
          await tx.promoRedemption.create({
            data: { promoCodeId: promo.id, userId: context.user.id, rideId: created.id, discountAppliedMinor: discountMinor },
          })
          return created
        })
      } catch (err) {
        if (isPromoRedemptionUniqueViolation(err)) throw promoAlreadyUsedError()
        throw err
      }
    } else {
      ride = await db().rideRequest.create({ data: rideData })
    }

    if (quote.pickupCoords || quote.dropoffCoords) {
      await db().$executeRaw`
        UPDATE ride_requests
        SET
          pickup_geo = ${quote.pickupCoords ? `SRID=4326;POINT(${quote.pickupCoords.lng} ${quote.pickupCoords.lat})` : null}::geometry,
          dropoff_geo = ${quote.dropoffCoords ? `SRID=4326;POINT(${quote.dropoffCoords.lng} ${quote.dropoffCoords.lat})` : null}::geometry
        WHERE id = ${ride.id}::uuid
      `
    }

    if (stops.length > 0) {
      await db().rideStop.createMany({
        data: stops.map((address, index) => ({
          rideId: ride.id,
          sequence: index,
          address,
          lat: quote.stopCoords[index]?.lat,
          lng: quote.stopCoords[index]?.lng,
        })),
      })
    }

    // A real bug caught by an independent re-audit, not by this session's own testing: the raw
    // Prisma create() result has no relations at all -- stops/pickupCoords/dropoffCoords were
    // silently `undefined` here even though PlatformRideRequest's TS type promises they're always
    // present, and GET /api/sr/rides/:id below always includes them. The frontend's very first
    // setRide() call (right after a successful request) used this response, so `ride.stops` being
    // undefined crashed the tracking screen's `ride?.stops.map(...)` on the very next render --
    // the `?.` only guarded `ride`, not `ride.stops`. Fixed at the root here (a consistent
    // response shape) rather than only defensively in the frontend.
    const [createdStops, createdCoords] = await Promise.all([
      db().rideStop.findMany({ where: { rideId: ride.id }, select: { address: true, lat: true, lng: true }, orderBy: { sequence: 'asc' } }),
      getRideCoords(ride.id),
    ])
    return json(res, 201, { ok: true, ride: { ...ride, stops: createdStops, pickupCoords: createdCoords.pickup, dropoffCoords: createdCoords.dropoff } })
  }

  const rideMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)$/)
  if (rideMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    // Scoped to this one ride -- cheap, and means the rider polling their own scheduled ride sees
    // it flip from DRAFT to REQUESTED right on schedule without needing a driver to poll first.
    await activateScheduledRides({ id: rideMatch[1] })
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
        stops: { select: { address: true, lat: true, lng: true }, orderBy: { sequence: 'asc' } },
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
    const rideCoords = await getRideCoords(ride.id)
    // Only fetched while actually en route -- a completed/cancelled ride has no live position
    // (LIVE_TRACKING_STATUSES), and getDriverLocation() itself already refuses to return a stale
    // (unreported-in-2-minutes) position even for a ride that is still active.
    const driverLocation =
      ride.driverId && LIVE_TRACKING_STATUSES.includes(ride.status) ? await getDriverLocation(ride.driverId) : null
    const ridePayload = ride.driver
      ? {
          ...ride,
          pickupCoords: rideCoords.pickup,
          dropoffCoords: rideCoords.dropoff,
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
            location: driverLocation,
          },
        }
      : { ...ride, pickupCoords: rideCoords.pickup, dropoffCoords: rideCoords.dropoff }
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
    const riderCancellable = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING']
    if (!riderCancellable.includes(existing.status)) {
      const error = new Error('This ride can no longer be cancelled by the rider.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_CANCELLABLE'
      error.expose = true
      throw error
    }

    // SR Ride vs. Uber gap-closure (P1 #9): a driver already assigned or en route has committed
    // real time/travel to this ride -- cancelling on them for free, unlike cancelling before a
    // driver exists (REQUESTED/MATCHING, always free), is what Uber's own cancellation-fee policy
    // protects against. RIDE_CANCELLATION_FEE_PERCENT is a placeholder rate pending a real business
    // decision from the owner (same disclosure the 0%-commission ride-payment default already
    // carries) -- computed here from the ride's own locked fareMinor, never invented.
    const driverAlreadyCommitted = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(existing.status)
    const cancellationFeeMinor = driverAlreadyCommitted && existing.fareMinor
      ? Math.round((existing.fareMinor * RIDE_CANCELLATION_FEE_PERCENT) / 100)
      : null

    // Optimistic-concurrency guard: re-check the status we read so a driver claim/arrival
    // landing at the same moment cannot be silently overwritten by this cancel.
    const cancelResult = await db().rideRequest.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: 'CANCELLED', cancellationFeeMinor },
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

    // Ride-pooling: real eligibility, not a decorative "Share" label. Also closes a genuine
    // pre-existing gap -- nothing previously stopped a driver from claiming any number of
    // unrelated active rides at once; a normal (non-shareable) ride now correctly enforces one
    // active ride per driver, and a shareable ride allows a second only if it's also shareable and
    // its pickup is genuinely close to the driver's other active ride. pairedWithRideId is set only
    // when this claim genuinely pools with the driver's other active ride -- that's the ONLY
    // trigger for the discount now (see the ride-creation comment above for why).
    const { pairedWithRideId } = await poolClaimEligibility(context.user.id, existing)

    // SR Ride vs. Uber gap-closure (P2 #16): enforced, not decorative -- a rider who marked
    // accessibilityRequired genuinely needs a driver who self-declared their vehicle as capable.
    // Real matching, not just a badge nobody has to honor (CAPSULE_RULES.noFakeTrustSignal).
    if (existing.accessibilityRequired) {
      const claimingDriverProfile = await db().driverProfile.findUnique({
        where: { userId: context.user.id },
        select: { accessibilityCapable: true },
      })
      if (!claimingDriverProfile?.accessibilityCapable) {
        const error = new Error('This ride requires an accessibility-capable vehicle.')
        error.statusCode = 403
        error.code = 'RIDE_ACCESSIBILITY_MISMATCH'
        error.expose = true
        throw error
      }
    }

    // Optimistic-concurrency guard: the WHERE clause re-checks driverId is still null so two
    // drivers tapping "accept" on the same pending ride at the same moment can't both win. When
    // this claim genuinely pools (pairedWithRideId set), the discount is applied to BOTH rides'
    // fareMinor and the pairing recorded on both, in the SAME transaction as the claim itself --
    // the two rides never end up "half paired" (one linked, fare unchanged on the other) even if
    // something fails partway. The other ride's update is guarded on pairedRideId: null too: by
    // construction (poolClaimEligibility caps a driver at 2 active rides) it can never already be
    // paired with a third ride, but the guard costs nothing and means a violated assumption fails
    // safe (0 rows updated) instead of silently re-discounting an already-paired ride.
    const claimResult = await db().$transaction(async (tx) => {
      const claimed = await tx.rideRequest.updateMany({
        where: { id: claimMatch[1], driverId: null, status: { in: ['REQUESTED', 'MATCHING'] } },
        data: {
          driverId: context.user.id,
          status: 'DRIVER_ASSIGNED',
          ...(pairedWithRideId
            ? { fareMinor: applyShareDiscount(existing.fareMinor ?? 0), pairedRideId: pairedWithRideId }
            : {}),
        },
      })
      if (claimed.count === 0) return { count: 0 }

      if (pairedWithRideId) {
        const otherRide = await tx.rideRequest.findUnique({ where: { id: pairedWithRideId }, select: { fareMinor: true } })
        await tx.rideRequest.updateMany({
          where: { id: pairedWithRideId, pairedRideId: null },
          data: { fareMinor: applyShareDiscount(otherRide?.fareMinor ?? 0), pairedRideId: claimMatch[1] },
        })
      }
      return { count: claimed.count }
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

    // SR Ride vs. Uber gap-closure (P1 #7): fire-and-forget, never fails the claim itself.
    // context.user is the claiming driver -- real name, not a relation this query never included.
    void sendPushNotification(ride.riderId, {
      title: 'Driver assigned',
      body: `${context.user.displayName} is on the way to your pickup.`,
      url: '/#/ride',
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

  // SR Ride vs. Uber gap-closure (P0 #3): trip-sharing with a trusted contact. Mints a signed,
  // time-limited token (server/lib/ride-share.mjs) -- no account needed to view, matching how
  // Uber's own share links work. Only mintable while the ride is actually in a live-tracking
  // status; sharing a not-yet-matched or already-finished ride has nothing live to show.
  const shareMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/share$/)
  if (shareMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])

    const ride = await db().rideRequest.findUnique({ where: { id: shareMatch[1] } })
    if (!ride || ride.riderId !== context.user.id) {
      const error = new Error('Ride request not found for this account.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!LIVE_TRACKING_STATUSES.includes(ride.status)) {
      const error = new Error('This ride cannot be shared right now.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_SHAREABLE'
      error.expose = true
      throw error
    }

    const { exp, sig } = signRideShareToken(ride.id)
    return json(res, 200, { ok: true, rideId: ride.id, exp, sig })
  }

  // Public: no auth, verified purely by the signed token above. Deliberately minimal -- never the
  // rider's own identity (whoever holds this link already knows who they're checking on), never
  // payment/fare data, never the driver's raw internal review status.
  const sharedMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/shared$/)
  if (sharedMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const rideId = sharedMatch[1]
    const exp = url.searchParams.get('exp')
    const sig = url.searchParams.get('sig')
    if (!verifyRideShareToken(rideId, exp, sig)) {
      const error = new Error('This share link is invalid or has expired.')
      error.statusCode = 403
      error.code = 'RIDE_SHARE_INVALID'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({
      where: { id: rideId },
      include: {
        driver: {
          select: {
            displayName: true,
            idDocumentStatus: true,
            driverProfile: { select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true, photoRef: true } },
          },
        },
      },
    })
    if (!ride) {
      const error = new Error('Ride request not found.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }

    const rideCoords = await getRideCoords(ride.id)
    const driverLocation =
      ride.driverId && LIVE_TRACKING_STATUSES.includes(ride.status) ? await getDriverLocation(ride.driverId) : null

    return json(res, 200, {
      ok: true,
      ride: {
        status: ride.status,
        pickupCoords: rideCoords.pickup,
        dropoffCoords: rideCoords.dropoff,
        driver: ride.driver
          ? {
              displayName: ride.driver.displayName,
              isVerified: ride.driver.idDocumentStatus === 'APPROVED',
              driverProfile: ride.driver.driverProfile
                ? {
                    vehicleMake: ride.driver.driverProfile.vehicleMake,
                    vehicleModel: ride.driver.driverProfile.vehicleModel,
                    vehiclePlate: ride.driver.driverProfile.vehiclePlate,
                    photoUrl: ride.driver.driverProfile.photoRef ? signDriverPhotoUrl(ride.driver.driverProfile.photoRef) : null,
                  }
                : null,
              location: driverLocation,
            }
          : null,
      },
    })
  }

  // SR Ride vs. Uber gap-closure (P2 #12): admin-managed promo codes. Owner-approved scope: simple
  // percent-or-flat discount, admin-created, single redemption per rider.
  if (url.pathname === '/api/admin/sr/promo-codes') {
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN'])
      // Scale-readiness audit: unbounded findMany. Admin-curated and slow-growing today, but with
      // no cap at all a real backlog would eventually load every row ever created on one screen.
      const promoCodes = await db().promoCode.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
      return json(res, 200, { ok: true, promoCodes })
    }
    if (req.method === 'POST') {
      requireAuth(context, ['ADMIN'])
      const body = await readJson(req)
      const code = String(body.code || '').trim().toUpperCase()
      const discountType = body.discountType === 'FLAT' ? 'FLAT' : body.discountType === 'PERCENT' ? 'PERCENT' : null
      const discountValue = Number(body.discountValue)

      if (!code || !discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
        const error = new Error('A code, discountType (PERCENT or FLAT), and a positive discountValue are required.')
        error.statusCode = 400
        error.code = 'PROMO_CODE_CREATE_INVALID'
        error.expose = true
        throw error
      }
      if (discountType === 'PERCENT' && discountValue > 100) {
        const error = new Error('A percent discount cannot exceed 100.')
        error.statusCode = 400
        error.code = 'PROMO_CODE_CREATE_INVALID'
        error.expose = true
        throw error
      }

      let promoCode
      try {
        promoCode = await db().promoCode.create({
          data: {
            code,
            discountType,
            discountValue: Math.round(discountValue),
            maxDiscountMinor: Number.isFinite(Number(body.maxDiscountMinor)) ? Math.round(Number(body.maxDiscountMinor)) : undefined,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
            createdByAdminId: context.user.id,
          },
        })
      } catch (err) {
        if (err?.code === 'P2002') {
          const error = new Error('A promo code with this code already exists.')
          error.statusCode = 409
          error.code = 'PROMO_CODE_DUPLICATE'
          error.expose = true
          throw error
        }
        throw err
      }
      // An admin-experience audit found promo-code/business-account admin actions were the only
      // admin-mutating routes in this file with no audit trail at all -- every other admin
      // decision here (ride cancel/assign/claim) already logs. Closing that gap.
      await db().adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'SR_PROMO_CODE_CREATED', entityType: 'promo_codes', entityId: promoCode.id, before: null, after: promoCode },
      })
      return json(res, 201, { ok: true, promoCode })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const promoCodeMatch = url.pathname.match(/^\/api\/admin\/sr\/promo-codes\/([^/]+)$/)
  if (promoCodeMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    // An admin-experience audit found this had no existence check at all -- update() on a
    // nonexistent id throws Prisma's raw P2025, leaking as an opaque 500 instead of a clean 404
    // (the exact bug class already fixed elsewhere in this codebase for local storage reads).
    const existingPromoCode = await db().promoCode.findUnique({ where: { id: promoCodeMatch[1] } })
    if (!existingPromoCode) {
      const error = new Error('Promo code not found.')
      error.statusCode = 404
      error.code = 'PROMO_CODE_NOT_FOUND'
      error.expose = true
      throw error
    }
    const promoCode = await db().promoCode.update({
      where: { id: promoCodeMatch[1] },
      data: { active: Boolean(body.active) },
    })
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'SR_PROMO_CODE_TOGGLED', entityType: 'promo_codes', entityId: promoCode.id, before: existingPromoCode, after: promoCode },
    })
    return json(res, 200, { ok: true, promoCode })
  }

  // SR Ride vs. Uber gap-closure: platform-admin onboarding of a business/corporate account. The
  // designated admin must already be a real, existing user (found by email) -- SYBNB onboards the
  // company, the company's own admin then manages their own members via /api/business/*.
  if (url.pathname === '/api/admin/sr/business-accounts') {
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN'])
      // Scale-readiness audit: same unbounded-findMany gap as promo codes above.
      const businessAccounts = await db().businessAccount.findMany({
        include: { admin: { select: { id: true, displayName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      return json(res, 200, { ok: true, businessAccounts })
    }
    if (req.method === 'POST') {
      requireAuth(context, ['ADMIN'])
      const body = await readJson(req)
      const name = String(body.name || '').trim()
      const billingContactEmail = String(body.billingContactEmail || '').trim().toLowerCase()
      const adminEmail = String(body.adminEmail || '').trim().toLowerCase()

      if (!name || !billingContactEmail || !adminEmail) {
        const error = new Error('A company name, billing contact email, and admin email are required.')
        error.statusCode = 400
        error.code = 'BUSINESS_ACCOUNT_CREATE_INVALID'
        error.expose = true
        throw error
      }

      const adminUser = await db().user.findUnique({ where: { email: adminEmail } })
      if (!adminUser) {
        const error = new Error('No account exists with the admin email. That person must sign up first.')
        error.statusCode = 404
        error.code = 'BUSINESS_ACCOUNT_ADMIN_NOT_FOUND'
        error.expose = true
        throw error
      }

      const businessAccount = await db().businessAccount.create({
        data: { name, billingContactEmail, adminUserId: adminUser.id },
        include: { admin: { select: { id: true, displayName: true, email: true } } },
      })
      await db().adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'SR_BUSINESS_ACCOUNT_CREATED', entityType: 'business_accounts', entityId: businessAccount.id, before: null, after: businessAccount },
      })
      return json(res, 201, { ok: true, businessAccount })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  return false
}
