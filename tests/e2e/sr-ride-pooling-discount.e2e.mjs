// SYBNB — SR Ride pooling discount is conditional on genuine pooling, not just opt-in (governed
// evidence artifact).
//
// An independent revenue audit found the 15% pooling discount (SHARE_DISCOUNT_PERCENT) was applied
// unconditionally at ride-REQUEST time from the rider's own client-supplied `shareable` flag, with
// nothing ever verifying a ride was actually pooled with anyone -- a rider could always set
// shareable=true for a guaranteed discount. Fixed by moving the discount to claim time, applied
// only when poolClaimEligibility() confirms a genuine pool (same driver, both shareable, pickups
// within POOL_MAX_DISTANCE_KM); both rides in a real pool get the discount retroactively and are
// linked via pairedRideId.
//
// Run: node tests/e2e/sr-ride-pooling-discount.e2e.mjs (needs the shared permissive test server on
// :3051). Finds its own two clean drivers (real, ACTIVE, zero active rides right now) rather than
// trusting a fixed DRIVER_ID/DRIVER2_ID -- this suite runs right after sr-ride.e2e.mjs in the
// canonical regression, which deliberately leaves a ride mid-flight on whatever driver it used, so
// a fixed id can't be assumed clean.

import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RIDER_A = process.env.GUEST || '483d4e40-3ba6-4ec7-8383-9d527324cf49'
const RIDER_B = process.env.GUEST2 || 'ec554c79-c1e4-451a-b65c-206486a5a491'

async function findCleanDrivers(count) {
  const drivers = await db().user.findMany({
    where: { status: 'ACTIVE', roles: { some: { role: 'DRIVER' } } },
    select: { id: true },
  })
  const busy = new Set(
    (await db().rideRequest.findMany({
      where: { driverId: { not: null }, status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'] } },
      select: { driverId: true },
    })).map((r) => r.driverId),
  )
  return drivers.filter((d) => !busy.has(d.id)).slice(0, count).map((d) => d.id)
}

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await res.json().catch(() => ({}))
  return { status: res.status, j }
}

function requestRide(token, pickup, dropoff) {
  return call('POST', '/api/sr/rides', token, {
    pickup: pickup.label, dropoff: dropoff.label, category: 'SR Economy', shareable: true,
    pickupCoords: pickup, dropoffCoords: dropoff,
  })
}

const createdIds = []

async function run() {
  const [driverId, driver2Id] = await findCleanDrivers(2)
  if (!driverId || !driver2Id) {
    console.log('  SKIP  need 2 real ACTIVE drivers with zero active rides right now to run this suite')
    process.exit(0)
  }
  const riderAToken = await createSessionToken({ id: RIDER_A, roles: [{ role: 'GUEST' }] })
  const riderBToken = await createSessionToken({ id: RIDER_B, roles: [{ role: 'GUEST' }] })
  const driverToken = await createSessionToken({ id: driverId, roles: [{ role: 'DRIVER' }] })
  const driver2Token = await createSessionToken({ id: driver2Id, roles: [{ role: 'DRIVER' }] })

  const UMAYYAD = { label: 'Umayyad Square, Damascus', lat: 33.5131, lng: 36.2919 }
  const NEAR_UMAYYAD = { label: 'Near Umayyad Square, Damascus', lat: 33.514, lng: 36.293 }
  const MEZZEH = { label: 'Mezzeh, Damascus', lat: 33.5, lng: 36.27 }
  const KAFR_SOUSA = { label: 'Kafr Sousa, Damascus', lat: 33.48, lng: 36.28 }

  try {
    console.log('=== unpooled: a genuinely solo shareable ride is billed at the FULL fare ===')
    {
      const created = await requestRide(riderAToken, UMAYYAD, MEZZEH)
      const rideId = created.j?.ride?.id
      createdIds.push(rideId)
      const originalFare = created.j?.ride?.fareMinor
      check('ride created at full (undiscounted) fare', typeof originalFare === 'number' && originalFare > 0, JSON.stringify(created.j))

      const claimed = await call('PATCH', `/api/sr/rides/${rideId}/claim`, driver2Token)
      check('solo claim succeeds', claimed.status === 200, `${claimed.status} ${JSON.stringify(claimed.j)}`)
      check('fare unchanged after a solo (unpooled) claim', claimed.j?.ride?.fareMinor === originalFare, `${claimed.j?.ride?.fareMinor} vs ${originalFare}`)
      check('pairedRideId stays null', !claimed.j?.ride?.pairedRideId, JSON.stringify(claimed.j?.ride?.pairedRideId))
    }

    console.log('=== genuine pool: two shareable rides claimed by the same driver both get discounted + linked ===')
    {
      const createdA = await requestRide(riderAToken, UMAYYAD, MEZZEH)
      const rideAId = createdA.j?.ride?.id
      createdIds.push(rideAId)
      const fareA = createdA.j?.ride?.fareMinor

      const createdB = await requestRide(riderBToken, NEAR_UMAYYAD, KAFR_SOUSA)
      const rideBId = createdB.j?.ride?.id
      createdIds.push(rideBId)
      const fareB = createdB.j?.ride?.fareMinor

      const claimA = await call('PATCH', `/api/sr/rides/${rideAId}/claim`, driverToken)
      check('first claim (no pool partner yet) stays full fare', claimA.j?.ride?.fareMinor === fareA, `${claimA.j?.ride?.fareMinor} vs ${fareA}`)

      const claimB = await call('PATCH', `/api/sr/rides/${rideBId}/claim`, driverToken)
      check('second claim genuinely pools (200)', claimB.status === 200, `${claimB.status} ${JSON.stringify(claimB.j)}`)
      const expectedFareB = Math.max(0, fareB - Math.round((fareB * 15) / 100))
      check('ride B discounted by exactly 15%', claimB.j?.ride?.fareMinor === expectedFareB, `${claimB.j?.ride?.fareMinor} vs expected ${expectedFareB}`)
      check('ride B linked to ride A', claimB.j?.ride?.pairedRideId === rideAId, claimB.j?.ride?.pairedRideId)

      const rideAAfter = await db().rideRequest.findUnique({ where: { id: rideAId }, select: { fareMinor: true, pairedRideId: true } })
      const expectedFareA = Math.max(0, fareA - Math.round((fareA * 15) / 100))
      check('ride A retroactively discounted by exactly 15%', rideAAfter.fareMinor === expectedFareA, `${rideAAfter.fareMinor} vs expected ${expectedFareA}`)
      check('ride A linked back to ride B', rideAAfter.pairedRideId === rideBId, rideAAfter.pairedRideId)
    }

    console.log(`\n${pass} passed, ${fail} failed`)
  } finally {
    console.log('=== cleanup ===')
    if (createdIds.length) {
      const { count } = await db().rideRequest.deleteMany({ where: { id: { in: createdIds.filter(Boolean) } } })
      console.log(`deleted ${count}/${createdIds.filter(Boolean).length} fixtures`)
    }
    await disconnectDb()
  }
  process.exit(fail ? 1 : 0)
}

run().catch(async (err) => {
  console.error('SUITE ERROR', err)
  if (createdIds.length) await db().rideRequest.deleteMany({ where: { id: { in: createdIds.filter(Boolean) } } }).catch(() => {})
  await disconnectDb().catch(() => {})
  process.exit(1)
})
