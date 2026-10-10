import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { randomInt } from 'node:crypto'
// Consume the country-neutral geocoding seam (resolves the active country's geocoder, fail-closed) —
// the route does NOT depend on any country's geocoder module directly.
import { quoteSrRideForActiveCountry } from '../lib/geo-adapter.mjs'
import { resolveTrafficDistance } from '../lib/traffic-distance.mjs'
import { signDriverPhotoUrl } from '../lib/driver-photo-storage.mjs'
import { getDriverRatingSummary } from '../lib/driver-rating.mjs'
import { getDriverLocation, getRideCoords, etaMinutesBetween } from '../lib/live-map.mjs'
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
import { rideCategoryToVehicle } from '../lib/vehicle-category.mjs'
import { notifyAdmin } from '../lib/notifications.mjs'
import { recordWalletEntry, refundPrepaidRide } from '../lib/finance-ledger.mjs'
// SEC-002R round 2 (findings G2 + same-shape sweep): the three platform-admin instruments in this
// file -- promo-code creation, promo-code activation toggling, and business-account onboarding --
// were bare db().x.create/update calls with no transaction and no commit-boundary re-authorization.
// G2 was reproduced live against a revoked admin. See server/lib/commit-authorization.mjs.
// SEC-002R round 3 additionally wires this file's ride cancel (money: cancellationFeeMinor) and
// admin/support driver assignment (dispatch to a live passenger), and closes the business-account
// self-dealing gap round 2 left open -- see each call site.
import { REAUTH_FAILURE_CODES, reauthorizeAtCommit } from '../lib/commit-authorization.mjs'
import { applyShareDiscount, poolClaimEligibility } from '../lib/ride-pooling.mjs'
import { offerRideToNextDriver, runDispatchSweep } from '../lib/ride-dispatch.mjs'
import { logRideEventSafe } from '../lib/ride-events.mjs'
import { analyzeRide } from '../lib/ai-ride-analyst.mjs'

// SR Ride vs. Uber gap-closure (P0 #1): only while a driver is actually en route to or on this
// trip -- a completed or cancelled ride has no live position to show, and showing one would be
// stale/misleading rather than genuinely live.
const LIVE_TRACKING_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']

// No-driver-found signal (2026-10-09): a still-unclaimed request older than this is flagged
// matchTimedOut in the ride payload so the rider UI can offer to keep waiting or cancel/retry,
// instead of an open-ended "waiting for driver" with no feedback. Non-destructive (never auto-
// cancels); env-tunable.
const RIDE_MATCH_TIMEOUT_MS = (() => {
  const raw = Number(process.env.SR_MATCH_TIMEOUT_SECONDS)
  return (Number.isFinite(raw) && raw > 0 ? raw : 300) * 1000
})()

// SR cancellation policy (owner decision 2026-10-09, Uber-aligned). The fee percentage and the
// free-cancel grace window are both env-tunable for operational tuning; the defaults below are the
// confirmed launch values (15% of the locked fare, 120s grace after a driver is assigned). A rider
// always cancels for free before a driver commits, and for free within the grace window right after
// assignment; after that, or once the driver is en route, the fee applies.
const RIDE_CANCELLATION_FEE_PERCENT = (() => {
  const raw = Number(process.env.RIDE_CANCELLATION_FEE_PERCENT)
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 15
})()
const RIDE_CANCEL_GRACE_MS = (() => {
  const raw = Number(process.env.RIDE_CANCEL_GRACE_SECONDS)
  return (Number.isFinite(raw) && raw >= 0 ? raw : 120) * 1000
})()

// Compute an SR quote, upgraded with live Google road distance + traffic when GOOGLE_MAPS_API_KEY is
// set. Pure/sync engine first (resolves coords + a gazetteer estimate); then, if a key and valid
// coords exist, re-quote with the live distance, traffic-aware minutes, and congestion multiplier.
// Fail-open: any Google error leaves the gazetteer quote untouched. Used by BOTH /quote and /rides so
// the price shown equals the price charged.
async function computeSrQuoteWithTraffic(baseParams) {
  let quote = quoteSrRideForActiveCountry(baseParams)
  if (!process.env.GOOGLE_MAPS_API_KEY) return quote
  if (!quote.pickupCoords || !quote.dropoffCoords) return quote
  const points = [quote.pickupCoords, ...(Array.isArray(quote.stopCoords) ? quote.stopCoords : []), quote.dropoffCoords]
  const live = await resolveTrafficDistance({ points })
  if (!live) return quote
  return quoteSrRideForActiveCountry({
    ...baseParams,
    distanceKmOverride: live.distanceKm,
    estimatedMinutesOverride: Math.round(live.durationInTrafficMin),
    trafficMultiplierOverride: live.trafficMultiplier,
  })
}

// Full auto-dispatch (2026-10-10): the entire manual-claim flow -- every eligibility gate, the
// atomic claim+pooling transaction, the driver-assigned push, and the response payload -- extracted
// verbatim so the auto-dispatch "accept offer" path reuses it EXACTLY, with one added guard. Manual
// /claim calls it with requireOfferForCaller=false (identical behavior to before); accept-offer calls
// it with requireOfferForCaller=true, which first requires the caller to be the ride's current,
// unexpired offer holder. A successful claim also clears the outstanding offer fields.
async function claimRideForDriver(context, rideId, { requireOfferForCaller = false } = {}) {
  if (requireOfferForCaller) {
    const offered = await db().rideRequest.findUnique({
      where: { id: rideId },
      select: { offeredDriverId: true, offerExpiresAt: true },
    })
    if (!offered || offered.offeredDriverId !== context.user.id || !offered.offerExpiresAt || offered.offerExpiresAt <= new Date()) {
      const error = new Error('This ride offer has expired or was reassigned.')
      error.statusCode = 409
      error.code = 'RIDE_OFFER_EXPIRED'
      error.expose = true
      throw error
    }
  }

  const existing = await db().rideRequest.findUnique({ where: { id: rideId } })
  if (!existing || existing.driverId || !['REQUESTED', 'MATCHING'].includes(existing.status)) {
    const error = new Error('This ride has already been claimed by another driver.')
    error.statusCode = 409
    error.code = 'RIDE_ALREADY_CLAIMED'
    error.expose = true
    throw error
  }

  // Pilot-safety gate: a driver may only pick up a passenger once (1) their identity is verified
  // via the same ID-review pipeline as hosts/guests, and (2) they have registered a vehicle, so
  // the rider can see and trust who/what is collecting them. Previously any DRIVER-role account
  // with no approved ID, no photo and no vehicle could accept a live passenger.
  const claimingUser = await db().user.findUnique({
    where: { id: context.user.id },
    select: { idDocumentStatus: true },
  })
  if (claimingUser?.idDocumentStatus !== 'APPROVED') {
    const error = new Error('Verify your identity (an approved ID document) before accepting rides.')
    error.statusCode = 403
    error.code = 'DRIVER_NOT_VERIFIED'
    error.expose = true
    throw error
  }
  const claimingVehicle = await db().driverProfile.findUnique({
    where: { userId: context.user.id },
    select: { vehiclePlate: true, vehicleStatus: true, vehicleCategory: true, registrationExpiresAt: true, inspectionStatus: true, inspectionExpiresAt: true },
  })
  if (!claimingVehicle?.vehiclePlate) {
    const error = new Error('Register your vehicle (make, model and plate) before accepting rides.')
    error.statusCode = 403
    error.code = 'DRIVER_VEHICLE_REQUIRED'
    error.expose = true
    throw error
  }
  if (claimingVehicle.vehicleStatus !== 'APPROVED') {
    const error = new Error('Your vehicle is awaiting review. You can accept rides once it is approved.')
    error.statusCode = 403
    error.code = 'DRIVER_VEHICLE_NOT_APPROVED'
    error.expose = true
    throw error
  }

  // Tier-to-vehicle enforcement: a driver may only claim a ride whose category matches their
  // self-declared vehicle category (so SUV/Van pricing is guaranteed and never collected by a car
  // that doesn't match). EXACT match -- the ride's category lives in metadata->>'category'.
  const requiredVehicleCategory = rideCategoryToVehicle(existing.metadata?.category)
  if (!claimingVehicle.vehicleCategory) {
    const error = new Error('Set your vehicle category before accepting rides.')
    error.statusCode = 403
    error.code = 'DRIVER_CATEGORY_REQUIRED'
    error.expose = true
    throw error
  }
  if (claimingVehicle.vehicleCategory !== requiredVehicleCategory) {
    const error = new Error('Your vehicle category does not match this ride type.')
    error.statusCode = 403
    error.code = 'DRIVER_CATEGORY_MISMATCH'
    error.expose = true
    throw error
  }

  // Safety gates (2026-10-10): an unsafe or out-of-date vehicle cannot take rides. Registration
  // expiry is ALWAYS enforced; the mechanical-inspection requirement is gated by the env flag
  // SR_REQUIRE_VEHICLE_INSPECTION (default on -- only an explicit 'false'/'0' skips the inspection
  // checks, and registration still blocks). Mirrors the auto-dispatch eligibility SQL exactly.
  const safetyNow = new Date()
  if (claimingVehicle.registrationExpiresAt && claimingVehicle.registrationExpiresAt <= safetyNow) {
    const error = new Error('Your vehicle registration has expired \u2014 renew it to accept rides.')
    error.statusCode = 403
    error.code = 'DRIVER_REGISTRATION_EXPIRED'
    error.expose = true
    throw error
  }
  const inspectionRequired = !['false', '0'].includes(String(process.env.SR_REQUIRE_VEHICLE_INSPECTION ?? '').trim().toLowerCase())
  if (inspectionRequired) {
    if (claimingVehicle.inspectionStatus !== 'PASSED') {
      const error = new Error('Your vehicle must pass a mechanical inspection before accepting rides.')
      error.statusCode = 403
      error.code = 'DRIVER_INSPECTION_NOT_PASSED'
      error.expose = true
      throw error
    }
    if (claimingVehicle.inspectionExpiresAt && claimingVehicle.inspectionExpiresAt <= safetyNow) {
      const error = new Error('Your vehicle inspection has expired \u2014 renew it to accept rides.')
      error.statusCode = 403
      error.code = 'DRIVER_INSPECTION_EXPIRED'
      error.expose = true
      throw error
    }
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
    // SEC-002R round 2, fresh-sweep Class A. A claim does two things a revoked actor must not be
    // able to commit: it MUTATES fareMinor on up to two riders' rides (the pooling discount --
    // real money the platform will bill), and it dispatches THIS driver to a live passenger. A
    // driver suspended or de-roled mid-request is precisely the actor who must not end up assigned
    // to a rider. Runs before the claim write, under the user_sessions/users locks.
    await reauthorizeAtCommit(tx, context, {
      action: 'SR_RIDE_CLAIMED',
      requiredRoles: ['DRIVER'],
    })
    const claimed = await tx.rideRequest.updateMany({
      where: { id: rideId, driverId: null, status: { in: ['REQUESTED', 'MATCHING'] } },
      data: {
        driverId: context.user.id,
        status: 'DRIVER_ASSIGNED',
        offeredDriverId: null,
        offerExpiresAt: null,
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
        data: { fareMinor: applyShareDiscount(otherRide?.fareMinor ?? 0), pairedRideId: rideId },
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
    where: { id: rideId },
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

  // Safety Phase 1 (2026-10-10): immutable TRIP SNAPSHOT + ACCEPTED black-box event. Both run
  // AFTER the claim has already committed, wrapped so nothing here can fail or delay the claim
  // itself. The snapshot pins who/what was dispatched (driver identity + the EXACT vehicle + the
  // rider) at assignment time, so the trail stays truthful even if the driver later edits their
  // vehicle. Written as a metadata.snapshot merge (never touches fare/settlement fields).
  try {
    const [snapDriverProfile, snapDriverUser] = await Promise.all([
      db().driverProfile.findUnique({
        where: { userId: context.user.id },
        select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true, vehicleColor: true, vehicleYear: true, vehicleCategory: true, photoRef: true },
      }),
      db().user.findUnique({ where: { id: context.user.id }, select: { id: true, displayName: true } }),
    ])
    const snapshot = {
      assignedAt: new Date().toISOString(),
      driver: { id: context.user.id, displayName: snapDriverUser?.displayName ?? context.user.displayName ?? null, photoRef: snapDriverProfile?.photoRef ?? null },
      vehicle: {
        make: snapDriverProfile?.vehicleMake ?? null,
        model: snapDriverProfile?.vehicleModel ?? null,
        plate: snapDriverProfile?.vehiclePlate ?? null,
        color: snapDriverProfile?.vehicleColor ?? null,
        year: snapDriverProfile?.vehicleYear ?? null,
        category: snapDriverProfile?.vehicleCategory ?? null,
      },
      rider: { id: ride.riderId, displayName: ride.rider?.displayName ?? null },
    }
    const baseMeta = ride.metadata && typeof ride.metadata === 'object' ? ride.metadata : {}
    await db().rideRequest.update({ where: { id: ride.id }, data: { metadata: { ...baseMeta, snapshot } } })
    await logRideEventSafe(db(), { rideId: ride.id, type: 'ACCEPTED', actorId: context.user.id, actorRole: 'DRIVER', meta: { driverId: context.user.id, vehiclePlate: snapDriverProfile?.vehiclePlate ?? null } })
  } catch {
    // best-effort: the snapshot/event must never fail an already-committed claim
  }

  // SR Ride vs. Uber gap-closure (P1 #7): fire-and-forget, never fails the claim itself.
  // context.user is the claiming driver -- real name, not a relation this query never included.
  void sendPushNotification(ride.riderId, {
    title: 'Driver assigned',
    body: `${context.user.displayName} is on the way to your pickup.`,
    url: '/#/ride',
  })

  // Safety Phase 2 (2026-10-10): the driver claims/accepts the ride here -- strip the rider's pickup
  // PIN from this response too, so a driver never receives it in any payload (the rider shows it in
  // person; metadata.pickupVerifiedAt is kept).
  const safeRide = ride.metadata && typeof ride.metadata === 'object' && !Array.isArray(ride.metadata)
    ? { ...ride, metadata: (() => { const { pickupCode: _omit, ...rest } = ride.metadata; return rest })() }
    : ride
  return { ok: true, ride: safeRide }
}

// Safety Phase 2 (2026-10-10): a crypto-random, zero-padded 4-digit pickup PIN. The rider shows it
// to the driver, who verifies it via POST /api/sr/rides/:id/verify-pickup before the trip can start
// (the driver IN_PROGRESS transition is gated on metadata.pickupVerifiedAt). Anti wrong-pickup /
// impersonation. Generated here, server-side only -- a client can never supply or override it.
function generatePickupCode() {
  return String(randomInt(0, 10000)).padStart(4, '0')
}

export async function handleSrRides(req, res, url, context) {
  if (url.pathname === '/api/sr/quote') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    // Include stops so the quoted fare/distance match what the ride-create path (which already
    // accounts for stops) will actually charge -- otherwise a multi-stop rider is shown a cheaper
    // direct-trip estimate and then billed the longer multi-leg fare.
    const quoteStops = (Array.isArray(body.stops) ? body.stops : [])
      .map((stop) => String(stop || '').trim())
      .filter(Boolean)
      .slice(0, 3)
    const quote = await computeSrQuoteWithTraffic({
      pickup: body.pickup,
      dropoff: body.dropoff,
      category: body.category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
      stops: quoteStops,
      stopCoordsOverrides: Array.isArray(body.stopCoords) ? body.stopCoords : [],
      riderCount: body.riderCount,
      bagCount: body.bagCount,
      scheduled: Boolean(body.scheduled) || Boolean(body.scheduledFor),
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
    const quote = await computeSrQuoteWithTraffic({
      pickup,
      dropoff,
      category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
      stops,
      stopCoordsOverrides,
      riderCount: body.riderCount,
      bagCount: body.bagCount,
      scheduled: Boolean(body.scheduledFor),
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
      // SR fares are priced in USD by the fare engine (quote.currency); fall back to the request
      // currency or the country default only if the quote somehow omitted it.
      currency: quote.currency || body.currency || defaultCurrency(),
      metadata: {
        ...(body.metadata || {}),
        pickup,
        dropoff,
        category,
        distanceKm: quote.distanceKm,
        distanceEstimated: quote.estimated,
        distanceSource: quote.distanceSource,
        estimatedMinutes: quote.estimatedMinutes,
        // Safety Phase 2 (2026-10-10): the 4-digit pickup PIN. Set here, AFTER the `...(body.metadata
        // || {})` spread above, so a client can never inject or override its own code.
        pickupCode: generatePickupCode(),
        // Pricing factors captured at booking time (audit trail of why this fare was charged).
        fareFactors: {
          baseFareMinor: quote.baseFareMinor,
          airportSurcharge: quote.airportSurcharge,
          stopsCount: quote.stopsCount,
          stopsFee: quote.stopsFee,
          riderCount: quote.riderCount,
          ridersFee: quote.ridersFee,
          bagCount: quote.bagCount,
          bagsFee: quote.bagsFee,
          fuelSurchargePercent: quote.fuelSurchargePercent,
          trafficMultiplier: quote.trafficMultiplier,
          trafficSource: quote.trafficSource,
          isNight: quote.isNight,
          nightMultiplier: quote.nightMultiplier,
          scheduled: quote.scheduled,
          scheduleMultiplier: quote.scheduleMultiplier,
          demandMultiplier: quote.demandMultiplier,
          surgeMultiplier: quote.surgeMultiplier,
        },
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
    // Pre-authorization (2026-10-09): if the rider has enough wallet balance, DEBIT the fare now and
    // mark the ride prepaid, so it settles to the driver INSTANTLY on completion with no post-ride
    // proof or admin step (the single biggest driver-reliability win). Best-effort: only for an
    // immediate, non-pooled ride (a shared ride's fare changes at claim), and any failure
    // (insufficient balance, payments gated) silently falls back to the existing post-ride proof
    // path — a ride is never blocked by prepayment. The DEBIT moves the rider's OWN money into
    // platform custody (same pattern as funding a wallet gift), with recordWalletEntry's atomic
    // no-overdraw guard preventing double-spend.
    if (!scheduledFor && !shareable && finalFareMinor > 0) {
      try {
        await db().$transaction(async (tx) => {
          await recordWalletEntry(tx, {
            userId: context.user.id,
            type: 'DEBIT',
            amountMinor: finalFareMinor,
            currency: ride.currency,
            referenceType: 'ride_prepayment',
            referenceId: ride.id,
            keyParts: ['ride-prepayment', ride.id],
            note: 'Rider prepaid the ride fare from wallet balance.',
          })
          await tx.rideRequest.update({
            where: { id: ride.id },
            data: { metadata: { ...ride.metadata, prepaid: true, prepaidAmountMinor: finalFareMinor } },
          })
        })
        ride = { ...ride, metadata: { ...ride.metadata, prepaid: true, prepaidAmountMinor: finalFareMinor } }
      } catch (err) {
        if (err?.code !== 'WALLET_INSUFFICIENT_FUNDS' && err?.code !== 'WALLET_ENTRY_RACE_LOST') throw err
        // insufficient balance -> leave the ride unprepaid; it uses the post-ride proof path.
      }
    }
    const [createdStops, createdCoords] = await Promise.all([
      db().rideStop.findMany({ where: { rideId: ride.id }, select: { address: true, lat: true, lng: true }, orderBy: { sequence: 'asc' } }),
      getRideCoords(ride.id),
    ])
    // Full auto-dispatch (2026-10-10): kick off the first offer to the nearest online driver as soon
    // as the ride is fully persisted, but ONLY for an immediate (REQUESTED) ride -- a scheduled DRAFT
    // is dispatched later by the pending-list sweep once activateScheduledRides() flips it to REQUESTED.
    // Fire-and-forget: a dispatch failure must never fail (or delay) the create response.
    if (ride.status === 'REQUESTED') offerRideToNextDriver(ride.id).catch(() => {})
    // Safety Phase 1 (2026-10-10): open the ride's immutable black box with a CREATED event.
    // Fire-and-forget and best-effort -- it never blocks or fails the create response.
    void logRideEventSafe(db(), {
      rideId: ride.id,
      type: 'CREATED',
      actorId: context.user.id,
      actorRole: 'GUEST',
      lat: createdCoords.pickup?.lat ?? null,
      lng: createdCoords.pickup?.lng ?? null,
      meta: { category, pickup, dropoff, fareMinor: ride.fareMinor ?? null, currency: ride.currency, scheduled: Boolean(scheduledFor) },
    })
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
            driverProfile: { select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true, vehicleColor: true, vehicleYear: true, photoRef: true } },
          },
        },
        review: true,
        paymentProofs: { select: { id: true, status: true, amountMinor: true, currency: true, provider: true }, orderBy: { createdAt: 'desc' }, take: 5 },
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
    // ETA for the rider: minutes from the driver's live position to the pickup while the driver is
    // assigned/arriving (null once the trip is IN_PROGRESS or if there's no live position/coords).
    const etaToPickupMinutes =
      driverLocation && rideCoords.pickup && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status)
        ? etaMinutesBetween(driverLocation, rideCoords.pickup)
        : null
    // No-driver-found feedback: flag a long-unclaimed request so the UI isn't an open-ended wait.
    const matchTimedOut =
      ['REQUESTED', 'MATCHING'].includes(ride.status)
      && !ride.driverId
      && ride.requestedAt
      && (Date.now() - new Date(ride.requestedAt).getTime() > RIDE_MATCH_TIMEOUT_MS)
    // Safety Phase 2 (2026-10-10): the pickup PIN is the rider's to show, never the driver's to
    // read -- redact metadata.pickupCode for anyone who is not the rider (driver / support / admin),
    // so the verify-pickup gate can't be bypassed by reading the code straight off this payload.
    const isRiderViewer = ride.riderId === context.user.id
    const safeRideMetadata = isRiderViewer
      ? ride.metadata
      : (() => {
          const base = ride.metadata && typeof ride.metadata === 'object' ? ride.metadata : {}
          const { pickupCode: _omitPickupCode, ...rest } = base
          return rest
        })()
    const ridePayload = ride.driver
      ? {
          ...ride,
          pickupCoords: rideCoords.pickup,
          dropoffCoords: rideCoords.dropoff,
          etaToPickupMinutes,
          matchTimedOut: Boolean(matchTimedOut),
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
                  vehicleColor: ride.driver.driverProfile.vehicleColor,
                  vehicleYear: ride.driver.driverProfile.vehicleYear,
                  photoUrl: ride.driver.driverProfile.photoRef ? signDriverPhotoUrl(ride.driver.driverProfile.photoRef) : null,
                }
              : null,
            ...ratingSummary,
            location: driverLocation,
          },
        }
      : { ...ride, pickupCoords: rideCoords.pickup, dropoffCoords: rideCoords.dropoff, etaToPickupMinutes, matchTimedOut: Boolean(matchTimedOut) }
    ridePayload.metadata = safeRideMetadata
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

    // SR cancellation policy (owner decision 2026-10-09, Uber-aligned). A driver already assigned or
    // en route has committed real time/travel, so cancelling on them is not free -- EXCEPT within a
    // short grace window right after assignment (Uber's own model), during which the rider may still
    // cancel at no charge. Before a driver commits (REQUESTED/MATCHING) it is always free. The fee is
    // computed from the ride's own locked fareMinor, never invented. updatedAt is the assignment
    // timestamp here: the status transition to DRIVER_ASSIGNED is the last write before a cancel.
    const withinGraceWindow = existing.status === 'DRIVER_ASSIGNED'
      && existing.updatedAt
      && (Date.now() - new Date(existing.updatedAt).getTime() < RIDE_CANCEL_GRACE_MS)
    const driverAlreadyCommitted = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(existing.status) && !withinGraceWindow
    const cancellationFeeMinor = driverAlreadyCommitted && existing.fareMinor
      ? Math.round((existing.fareMinor * RIDE_CANCELLATION_FEE_PERCENT) / 100)
      : null

    // SEC-002R round 3, item 3. Class A: `cancellationFeeMinor` is a REAL money field, computed from
    // the ride's own locked fareMinor, and there is no endpoint anywhere that reverses it -- once
    // this row commits, the rider owes that fee. Before this change it was a bare, untransacted
    // updateMany with no commit-boundary re-authorization.
    //
    // requiredRoles MATCHES this route's own requireAuth(context, ['GUEST']) exactly -- not widened,
    // not narrowed. This route is SELF-SCOPED (the `existing.riderId !== context.user.id` check
    // above), so interestedPartyIds is deliberately NOT passed: the actor legitimately IS the
    // interested party on their own cancellation, and passing it would refuse every real cancel.
    // The self-scope is additionally carried INTO the guarded write (`riderId` in the WHERE clause)
    // so the protected statement is self-contained rather than relying on the pre-transaction read.
    const cancelResult = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'SR_RIDER_CANCELLED',
        requiredRoles: ['GUEST'],
      })
      // Optimistic-concurrency guard: re-check the status we read so a driver claim/arrival
      // landing at the same moment cannot be silently overwritten by this cancel.
      const result = await tx.rideRequest.updateMany({
        where: { id: existing.id, status: existing.status, riderId: context.user.id },
        data: { status: 'CANCELLED', cancellationFeeMinor },
      })
      // Prepaid ride: refund the rider their prepayment (minus any cancellation fee, which goes to
      // the committed driver) atomically with the cancellation. Idempotent by ride id.
      if (result.count === 1 && existing.metadata?.prepaid) {
        await refundPrepaidRide(tx, { ride: { ...existing, cancellationFeeMinor } })
      }
      return result
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

  // Ride dispute (2026-10-09): either party to a COMPLETED ride (the rider or the assigned driver)
  // may open a dispute, moving it to DISPUTED with a reason, so a contested fare/ride has a
  // structured hold an admin resolves (confirm, or reverse the payment) instead of ad-hoc handling.
  const disputeMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/dispute$/)
  if (disputeMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)
    const body = await readJson(req)
    const reason = body.reason ? String(body.reason).trim().slice(0, 1000) : ''
    const existing = await db().rideRequest.findUnique({ where: { id: disputeMatch[1] } })
    if (!existing || (existing.riderId !== context.user.id && existing.driverId !== context.user.id)) {
      const error = new Error('Ride not found for this account.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (existing.status !== 'COMPLETED') {
      const error = new Error('Only a completed ride can be disputed.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_DISPUTABLE'
      error.expose = true
      throw error
    }
    const openedBy = existing.riderId === context.user.id ? 'RIDER' : 'DRIVER'
    const metadata = {
      ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
      dispute: { openedBy, openedByUserId: context.user.id, reason, openedAt: new Date().toISOString() },
    }
    // Optimistic-concurrency guard on COMPLETED so a concurrent change can't be overwritten.
    const updated = await db().rideRequest.updateMany({
      where: { id: existing.id, status: 'COMPLETED' },
      data: { status: 'DISPUTED', metadata },
    })
    if (updated.count !== 1) {
      const error = new Error('This ride can no longer be disputed. Reload and try again.')
      error.statusCode = 409
      error.code = 'RIDE_DISPUTE_CONFLICT'
      error.expose = true
      throw error
    }
    const ride = await db().rideRequest.findUnique({ where: { id: existing.id } })
    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'SR_RIDE_DISPUTED',
        entityType: 'ride_requests',
        entityId: ride.id,
        before: existing,
        after: ride,
      },
    })
    // Safety Phase 1 (2026-10-10): record the dispute in the ride's black box too.
    void logRideEventSafe(db(), { rideId: ride.id, type: 'DISPUTED', actorId: context.user.id, actorRole: openedBy, meta: { openedBy, reason } })
    notifyAdmin('admin_ride_disputed', { rideId: ride.id, openedBy }, `admin_ride_disputed:${ride.id}`)
    return json(res, 200, { ok: true, ride })
  }

  // Safety Phase 1 (2026-10-10): SOS / PANIC. Either party to an ACTIVE ride -- the rider (GUEST)
  // or the assigned driver (DRIVER) -- can pull it. It creates an OPEN Incident (the single durable
  // source of truth, with a copy of the trip snapshot + the other party embedded so the admin
  // console needs no second lookup), appends an SOS event to the ride's black box, and alerts admins
  // over BOTH email and push. Designed to be FAST and robust: the incident write is the only thing
  // that must succeed; every alert side-effect is fire-and-forget and can never delay or fail it.
  const sosMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/sos$/)
  if (sosMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST', 'DRIVER'])
    const body = await readJson(req).catch(() => ({}))
    const ride = await db().rideRequest.findUnique({ where: { id: sosMatch[1] } })
    if (!ride || (ride.riderId !== context.user.id && ride.driverId !== context.user.id)) {
      const error = new Error('Ride not found for this account.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    const SOS_ACTIVE_STATUSES = ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
    if (!SOS_ACTIVE_STATUSES.includes(ride.status)) {
      const error = new Error('SOS is only available during an active ride.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_ACTIVE'
      error.expose = true
      throw error
    }
    const reporterRole = ride.riderId === context.user.id ? 'RIDER' : 'DRIVER'
    const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null
    const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null
    const note = body.note ? String(body.note).trim().slice(0, 1000) : null
    const otherPartyId = reporterRole === 'RIDER' ? ride.driverId : ride.riderId
    const rideMeta = ride.metadata && typeof ride.metadata === 'object' ? ride.metadata : {}
    const incident = await db().incident.create({
      data: {
        rideId: ride.id,
        reporterId: context.user.id,
        reporterRole,
        type: 'SOS',
        status: 'OPEN',
        lat,
        lng,
        note,
        meta: {
          rideStatus: ride.status,
          reporterDisplayName: context.user.displayName ?? null,
          otherPartyId: otherPartyId ?? null,
          snapshot: rideMeta.snapshot ?? null,
          pickup: rideMeta.pickup ?? null,
          dropoff: rideMeta.dropoff ?? null,
        },
      },
    })
    // Black-box event -- standalone (not part of the incident insert) so a logging failure can
    // never lose the incident itself. Best-effort; never throws.
    void logRideEventSafe(db(), { rideId: ride.id, type: 'SOS', actorId: context.user.id, actorRole: reporterRole, lat, lng, meta: { incidentId: incident.id, note } })
    // Alert admins: email (idempotency-keyed to the incident) + web push to every ADMIN account.
    // Both fire-and-forget so a slow or unconfigured channel never delays the panic response.
    notifyAdmin('admin_sos_triggered', { rideId: ride.id, incidentId: incident.id, reporterRole, status: ride.status }, `sos:${incident.id}`)
    void (async () => {
      try {
        const adminRoles = await db().userRole.findMany({ where: { role: 'ADMIN' }, select: { userId: true } })
        await Promise.all(adminRoles.map((r) => sendPushNotification(r.userId, {
          title: 'SOS triggered',
          body: `A ${reporterRole.toLowerCase()} pulled SOS on an active ride.`,
          url: '/admin/sr/incidents',
        })))
      } catch {
        // push alerting is best-effort
      }
    })()
    // Safety Phase 3 (2026-10-10): give the fresh SOS incident an INSTANT AI read. Fully
    // fire-and-forget -- NOT awaited before responding, so the panic response stays fast -- and
    // best-effort: analyzeRide never throws and is key-gated, and a failure to attach can never
    // affect the SOS. On success the advisory read is merged onto incident.meta.ai.
    void (async () => {
      try {
        const [events, incidents] = await Promise.all([
          db().rideEvent.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: 'asc' } }),
          db().incident.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: 'desc' } }),
        ])
        const analysis = await analyzeRide({ ride, events, incidents })
        if (analysis.configured && !analysis.error) {
          const fresh = await db().incident.findUnique({ where: { id: incident.id }, select: { meta: true } })
          const baseMeta = fresh?.meta && typeof fresh.meta === 'object' && !Array.isArray(fresh.meta) ? fresh.meta : {}
          await db().incident.update({ where: { id: incident.id }, data: { meta: { ...baseMeta, ai: analysis } } })
        }
      } catch {
        // best-effort: an AI attach failure must never affect the SOS
      }
    })().catch(() => {})
    return json(res, 201, { ok: true, incidentId: incident.id })
  }

  // Safety Phase 2 (2026-10-10): pickup PIN verification. The assigned driver submits the 4-digit
  // code the rider reads them; a match proves the right rider is in the car before the trip can
  // start. Allowed only at the pickup moment (DRIVER_ASSIGNED / DRIVER_ARRIVING). On success it
  // stamps metadata.pickupVerifiedAt (which driver.mjs's IN_PROGRESS transition is gated on) and
  // appends a PICKUP_VERIFIED event to the ride's black box.
  const verifyPickupMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/verify-pickup$/)
  if (verifyPickupMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req).catch(() => ({}))
    const ride = await db().rideRequest.findUnique({ where: { id: verifyPickupMatch[1] } })
    if (!ride) {
      const error = new Error('Ride not found.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (ride.driverId !== context.user.id) {
      const error = new Error('This ride is not assigned to your account.')
      error.statusCode = 403
      error.code = 'RIDE_FORBIDDEN'
      error.expose = true
      throw error
    }
    if (!['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status)) {
      const error = new Error('Pickup can only be verified before the trip starts.')
      error.statusCode = 409
      error.code = 'PICKUP_NOT_VERIFIABLE'
      error.expose = true
      throw error
    }
    const rideMeta = ride.metadata && typeof ride.metadata === 'object' ? ride.metadata : {}
    const expected = String(rideMeta.pickupCode ?? '')
    const provided = String(body.code ?? '').trim()
    if (!expected || provided !== expected) {
      const error = new Error('That pickup code does not match. Ask the rider to read you the 4-digit code shown in their app.')
      error.statusCode = 403
      error.code = 'PICKUP_CODE_MISMATCH'
      error.expose = true
      throw error
    }
    const verifiedAt = new Date().toISOString()
    await db().rideRequest.update({
      where: { id: ride.id },
      data: { metadata: { ...rideMeta, pickupVerifiedAt: verifiedAt } },
    })
    // Best-effort black-box event -- never blocks the success response.
    void logRideEventSafe(db(), {
      rideId: ride.id,
      type: 'PICKUP_VERIFIED',
      actorId: context.user.id,
      actorRole: 'DRIVER',
      meta: { verifiedAt },
    })
    return json(res, 200, { ok: true })
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

    // Verification parity with the self-claim path (fix 2026-10-09): admin/support dispatch must NOT
    // be a backdoor around the rider-safety gate. The driver being assigned must have an approved ID
    // document AND a registered vehicle, exactly as a self-claiming driver must -- otherwise an
    // operator could put an unverified, vehicle-less driver onto a live passenger.
    if (driver.idDocumentStatus !== 'APPROVED') {
      const error = new Error('This driver has not completed identity verification (an approved ID document) and cannot be dispatched.')
      error.statusCode = 400
      error.code = 'DRIVER_NOT_VERIFIED'
      error.expose = true
      throw error
    }
    const assignedDriverProfile = await db().driverProfile.findUnique({
      where: { userId: driver.id },
      select: { vehiclePlate: true, vehicleStatus: true, accessibilityCapable: true },
    })
    if (!assignedDriverProfile?.vehiclePlate) {
      const error = new Error('This driver has no registered vehicle (make, model and plate) and cannot be dispatched.')
      error.statusCode = 400
      error.code = 'DRIVER_VEHICLE_REQUIRED'
      error.expose = true
      throw error
    }
    if (assignedDriverProfile.vehicleStatus !== 'APPROVED') {
      const error = new Error('This driver\'s vehicle has not been approved by review and cannot be dispatched.')
      error.statusCode = 400
      error.code = 'DRIVER_VEHICLE_NOT_APPROVED'
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

    // Same accessibility guarantee the self-claim path enforces: a rider who marked
    // accessibilityRequired needs a driver whose vehicle is self-declared capable. Reuses the
    // driver-profile read above (which already fetched accessibilityCapable).
    if (existing.accessibilityRequired && !assignedDriverProfile.accessibilityCapable) {
      const error = new Error('This ride requires an accessibility-capable vehicle.')
      error.statusCode = 400
      error.code = 'RIDE_ACCESSIBILITY_MISMATCH'
      error.expose = true
      throw error
    }

    // SEC-002R round 3, item 2. Class A, and the SAME durable effect as /claim below (protected in
    // round 2): this dispatches a named driver to a live passenger. Before this change it was a
    // bare, untransacted updateMany with no commit-boundary re-authorization, so a suspended or
    // de-roled admin/support agent could still commit a real dispatch. Mirrors the /claim fix's
    // shape exactly -- reauthorizeAtCommit() first, under held user_sessions/users locks, then the
    // guarded write, in one transaction.
    //
    // requiredRoles MATCHES this route's own requireAuth(context, ['ADMIN', 'SUPPORT']) -- admitting
    // the same pair, since narrowing to ADMIN would silently break SUPPORT's real dispatch workflow
    // and widening is a policy decision, not this fix's. No interestedPartyIds: the driver being
    // assigned is validated as a real ACTIVE DRIVER account above, and an admin assigning THEMSELVES
    // is not expressible here (assignment requires the target to hold DRIVER; an admin who also held
    // DRIVER self-assigning is a distinct policy question, recorded in the round-3 report, not
    // silently decided here).
    const assignResult = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'SR_DRIVER_ASSIGNED',
        requiredRoles: ['ADMIN', 'SUPPORT'],
      })
      // Re-check status in the WHERE clause (optimistic concurrency): if another admin/support
      // agent assigned a driver to this ride between our read and this write, this matches zero
      // rows instead of silently overwriting their assignment.
      return tx.rideRequest.updateMany({
        where: { id: assignMatch[1], status: existing.status },
        data: { driverId: driver.id, status: 'DRIVER_ASSIGNED' },
      })
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
    const payload = await claimRideForDriver(context, claimMatch[1])
    return json(res, 200, payload)
  }

  const acceptOfferMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/accept-offer$/)
  if (acceptOfferMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    return json(res, 200, await claimRideForDriver(context, acceptOfferMatch[1], { requireOfferForCaller: true }))
  }

  const declineOfferMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/decline-offer$/)
  if (declineOfferMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    const declineRideId = declineOfferMatch[1]
    const existingOffer = await db().rideRequest.findUnique({
      where: { id: declineRideId },
      select: { offeredDriverId: true, declinedByIds: true },
    })
    if (!existingOffer || existingOffer.offeredDriverId !== context.user.id) {
      const error = new Error('This ride offer is no longer yours to decline.')
      error.statusCode = 409
      error.code = 'RIDE_OFFER_NOT_YOURS'
      error.expose = true
      throw error
    }
    const declined = Array.from(new Set([...(existingOffer.declinedByIds || []), context.user.id]))
    await db().rideRequest.update({
      where: { id: declineRideId },
      data: { declinedByIds: declined, offeredDriverId: null, offerExpiresAt: null },
    })
    await offerRideToNextDriver(declineRideId)
    return json(res, 200, { ok: true })
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
            driverProfile: { select: { vehicleMake: true, vehicleModel: true, vehiclePlate: true, vehicleColor: true, vehicleYear: true, photoRef: true } },
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
                    vehicleColor: ride.driver.driverProfile.vehicleColor,
                    vehicleYear: ride.driver.driverProfile.vehicleYear,
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

      // SEC-002R round 2, finding G2 (reproduced live against a revoked admin). A promo code is a
      // commercial instrument: once it exists and is active, any rider who learns the string gets a
      // real, permanent discount off real ride revenue, and redemptions are irreversible. Class A.
      // The create and its audit row now share ONE transaction whose first statement re-establishes
      // the acting admin's authority under held user_sessions/users locks.
      let promoCode
      try {
        promoCode = await db().$transaction(async (tx) => {
          await reauthorizeAtCommit(tx, context, {
            action: 'SR_PROMO_CODE_CREATED',
            requiredRoles: ['ADMIN'],
          })
          const created = await tx.promoCode.create({
            data: {
              code,
              discountType,
              discountValue: Math.round(discountValue),
              maxDiscountMinor: Number.isFinite(Number(body.maxDiscountMinor)) ? Math.round(Number(body.maxDiscountMinor)) : undefined,
              expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
              createdByAdminId: context.user.id,
            },
          })
          // An admin-experience audit found promo-code/business-account admin actions were the only
          // admin-mutating routes in this file with no audit trail at all -- every other admin
          // decision here (ride cancel/assign/claim) already logs. Closing that gap.
          await tx.adminAuditLog.create({
            data: { actorUserId: context.user.id, action: 'SR_PROMO_CODE_CREATED', entityType: 'promo_codes', entityId: created.id, before: null, after: created },
          })
          return created
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
    // SEC-002R round 2, same-shape sweep. Classified Class A: this is the ONLY switch that turns a
    // discount instrument on or off. Activating one makes real, unrecoverable discounts immediately
    // redeemable by anyone holding the code; deactivating one is a live commercial control. Same
    // treatment as the create above.
    const promoCode = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'SR_PROMO_CODE_TOGGLED',
        requiredRoles: ['ADMIN'],
      })
      const toggled = await tx.promoCode.update({
        where: { id: promoCodeMatch[1] },
        data: { active: Boolean(body.active) },
      })
      await tx.adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'SR_PROMO_CODE_TOGGLED', entityType: 'promo_codes', entityId: toggled.id, before: existingPromoCode, after: toggled },
      })
      return toggled
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

      // SEC-002R round 2, same-shape sweep. Classified Class A: this is a PRIVILEGE grant. It makes
      // the named user a business admin, and business.mjs's loadOwnBusinessAccount() derives that
      // authority purely from `businessAccount.adminUserId === context.user.id` -- so creating this
      // row hands that person the standing power to add and remove members who can then bill real
      // rides to the company. Same class as a role change, and treated the same way.
      const businessAccount = await db().$transaction(async (tx) => {
        // SEC-002R round 3, item 5 -- the self-dealing gap round 2 deliberately left open is now
        // CLOSED, on the owner's explicit instruction.
        //
        // THE ATTACK. `adminUserId` is the whole of a business account's authority: business.mjs's
        // loadOwnBusinessAccount() derives "is this caller the company's admin" from
        // `businessAccount.adminUserId === context.user.id` and nothing else. A platform ADMIN who
        // named THEMSELVES here therefore walked straight into POST /api/business/members (already
        // commit-boundary-protected, but protection is not the question -- authority is) and granted
        // any rider standing power to bill real rides to that company, whose corporate usage
        // business.mjs then totals as genuine money owed. One admin, acting alone, creating the
        // company AND holding its purse: exactly the class closed for the other nine admin decision
        // paths in 115aa09, on a path that had no check of any kind.
        //
        // THE FIX. The identical predicate those nine use -- "the actor must not be an interested
        // party in the thing they are deciding" -- via the SAME shared mechanism
        // (reauthorizeAtCommit's interestedPartyIds), not a parallel one. `adminUser.id` is re-read
        // INSIDE this transaction, by the same email, immediately before the check: a genuine
        // commit-boundary comparison, not a replay of the admission-time one, so an account swap
        // committing between the outer lookup and this write cannot slip past it. The refusal
        // carries its own code (BUSINESS_ACCOUNT_SELF_DEALING) rather than the review-queue wording,
        // because an operator hitting it needs to be told which rule they hit.
        //
        // SCOPE, stated honestly: this blocks the actor naming THEMSELVES. "Any account they
        // control" is NOT determinable in this codebase -- there is no account-ownership or
        // delegation graph, so an admin who controls a second, unrelated account can still name that
        // one. That residual is recorded in docs/security/sec-002r-mutation-inventory.md; it is a
        // collusion/second-identity problem, not something this check can see.
        const designated = await tx.user.findUnique({ where: { email: adminEmail }, select: { id: true } })
        if (!designated) {
          const error = new Error('No account exists with the admin email. That person must sign up first.')
          error.statusCode = 404
          error.code = 'BUSINESS_ACCOUNT_ADMIN_NOT_FOUND'
          error.expose = true
          throw error
        }
        await reauthorizeAtCommit(tx, context, {
          action: 'SR_BUSINESS_ACCOUNT_CREATED',
          requiredRoles: ['ADMIN'],
          interestedPartyIds: [designated.id],
          selfDealingError: {
            code: REAUTH_FAILURE_CODES.BUSINESS_ACCOUNT_SELF_DEALING,
            message: 'An admin cannot create a business account naming themselves as its business admin.',
          },
        })
        const created = await tx.businessAccount.create({
          // designated.id, not the pre-transaction adminUser.id: the row created is the one the
          // self-dealing check above actually ruled on.
          data: { name, billingContactEmail, adminUserId: designated.id },
          include: { admin: { select: { id: true, displayName: true, email: true } } },
        })
        await tx.adminAuditLog.create({
          data: { actorUserId: context.user.id, action: 'SR_BUSINESS_ACCOUNT_CREATED', entityType: 'business_accounts', entityId: created.id, before: null, after: created },
        })
        return created
      })
      return json(res, 201, { ok: true, businessAccount })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  return false
}
