// Rides under concurrency (scale work, 2026-10-22). Self-contained: creates its own rider, drivers and
// rides directly in the test database, then races real HTTP calls against the running API.
//   1. Two drivers accept the SAME ride at the same instant -> exactly one wins, the other gets 409.
//   2. One driver claims TWO rides at the same instant -> exactly one wins (409 DRIVER_ALREADY_ON_RIDE).
//   3. Concurrent dispatchers offering the same ride -> one offer, offerSeq advances by exactly 1.
//   4. Concurrent sweeps -> only one runs per window; no ride is offered to two drivers.
//   5. A driver with a live offer is not offered a second ride.
// Run: API_BASE=http://127.0.0.1:3051 node tests/e2e/sr-ride-concurrency.e2e.mjs (with the e2e env).
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from './_session.mjs'
import { offerRideToNextDriver, runDispatchSweep } from '../../server/lib/ride-dispatch.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const prisma = db()
let failed = 0
const check = (name, ok, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' ' + extra : ''}`); if (!ok) failed++ }
const tag = `conc-${Date.now()}`
const DOCS = ['LICENCE', 'CRIMINAL_RECORD', 'REGISTRATION', 'INSURANCE', 'MECHANIC_REPORT', 'CAR_PHOTO_FRONT', 'CAR_PHOTO_BACK', 'CAR_PHOTO_LEFT', 'CAR_PHOTO_RIGHT', 'CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT']
const BASE = { lat: 33.5100, lng: 36.2900 }

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

async function makeDriver(i, dLat = 0) {
  const user = await prisma.user.create({ data: { email: `${tag}-d${i}@e2e.test`, displayName: `Conc driver ${i}`, idDocumentStatus: 'APPROVED', roles: { create: [{ role: 'DRIVER' }] } } })
  await prisma.driverProfile.create({ data: { userId: user.id, vehiclePlate: `C-${i}-${Date.now() % 10000}`, vehicleStatus: 'APPROVED', vehicleCategory: 'ECONOMY', inspectionStatus: 'PASSED', inspectionExpiresAt: new Date(Date.now() + 864e5 * 30), registrationExpiresAt: new Date(Date.now() + 864e5 * 30), largeBagCapacity: 3, handBagCapacity: 3, onDutyAt: new Date() } })
  await prisma.$executeRawUnsafe(`update driver_profiles set last_location_geo = ST_SetSRID(ST_MakePoint($1, $2), 4326), last_location_updated_at = now() where user_id = $3::uuid`, BASE.lng, BASE.lat + dLat, user.id)
  for (const kind of DOCS) await prisma.driverDocument.create({ data: { userId: user.id, kind, storageKey: `e2e/${kind}`, mimeType: 'image/png', status: 'APPROVED' } })
  return { id: user.id, token: await createSessionToken({ id: user.id, roles: ['DRIVER'] }) }
}

async function makeRide(riderId, dLat = 0) {
  const ride = await prisma.rideRequest.create({ data: { riderId, status: 'REQUESTED', fareMinor: 10, currency: 'USD', metadata: { category: 'SR Economy', pickup: 'P', dropoff: 'D' } } })
  await prisma.$executeRawUnsafe(`update ride_requests set pickup_geo = ST_SetSRID(ST_MakePoint($1, $2), 4326) where id = $3::uuid`, BASE.lng, BASE.lat + dLat, ride.id)
  return ride
}

async function main() {
  // isolate from other suites' open rides near the same point
  await prisma.$executeRawUnsafe(`update ride_requests set status='CANCELLED', offered_driver_id=null, offer_expires_at=null where status in ('REQUESTED','MATCHING') and driver_id is null`)
  const rider = await prisma.user.create({ data: { email: `${tag}-r@e2e.test`, displayName: 'Conc rider', roles: { create: [{ role: 'GUEST' }] } } })
  const drivers = []
  for (let i = 0; i < 4; i++) drivers.push(await makeDriver(i, i * 0.001))

  console.log('=== 1. two drivers accept the same ride at once ===')
  const r1 = await makeRide(rider.id)
  const both = await Promise.all([drivers[0], drivers[1]].map((d) => call('PATCH', `/api/sr/rides/${r1.id}/claim`, d.token, {})))
  const wins = both.filter((x) => x.status === 200).length
  check('exactly one claim succeeds', wins === 1, JSON.stringify(both.map((x) => x.status)))
  check('the loser gets 409', both.some((x) => x.status === 409))
  const after1 = await prisma.rideRequest.findUnique({ where: { id: r1.id } })
  check('ride holds exactly the winning driver', [drivers[0].id, drivers[1].id].includes(after1.driverId) && after1.status === 'DRIVER_ASSIGNED')

  console.log('=== 2. one driver claims two rides at once ===')
  const r2a = await makeRide(rider.id, 0.0005)
  const r2b = await makeRide(rider.id, 0.0006)
  const d2 = drivers[2]
  const two = await Promise.all([r2a, r2b].map((r) => call('PATCH', `/api/sr/rides/${r.id}/claim`, d2.token, {})))
  check('exactly one of the two claims succeeds', two.filter((x) => x.status === 200).length === 1, JSON.stringify(two.map((x) => `${x.status}:${x.data?.error?.code || ''}`)))
  check('the other is refused as DRIVER_ALREADY_ON_RIDE (or already claimed)', two.some((x) => x.status === 409))
  const live = await prisma.rideRequest.count({ where: { driverId: d2.id, status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'] } } })
  check('driver holds exactly one live ride', live === 1, `live=${live}`)

  console.log('=== 3. concurrent dispatchers on the same ride ===')
  const r3 = await makeRide(rider.id, 0.002)
  const before3 = (await prisma.rideRequest.findUnique({ where: { id: r3.id } })).offerSeq
  const offers = await Promise.all(Array.from({ length: 8 }, () => offerRideToNextDriver(r3.id)))
  const after3 = await prisma.rideRequest.findUnique({ where: { id: r3.id } })
  check('only one dispatcher made the offer', offers.filter((o) => o.offered).length === 1, JSON.stringify(offers.map((o) => (o.offered ? 'offered' : o.raced ? 'raced' : o.alreadyOffered ? 'already' : 'none'))))
  check('offerSeq advanced by exactly 1', after3.offerSeq === before3 + 1, `${before3}->${after3.offerSeq}`)
  check('the ride is offered to the driver the winning dispatcher chose', after3.offeredDriverId === offers.find((o) => o.offered)?.driverId)

  console.log('=== 4. a driver holding a live offer is not offered a second ride ===')
  const r4 = await makeRide(rider.id, 0.002)
  const res4 = await offerRideToNextDriver(r4.id)
  const after4 = await prisma.rideRequest.findUnique({ where: { id: r4.id } })
  check('second ride goes to a different driver (or nobody)', !res4.offered || after4.offeredDriverId !== after3.offeredDriverId, `r3->${after3.offeredDriverId?.slice(0, 8)} r4->${after4.offeredDriverId?.slice(0, 8)}`)

  console.log('=== 5. concurrent sweeps are single-flight ===')
  const sweeps = await Promise.all(Array.from({ length: 10 }, () => runDispatchSweep()))
  check('at most one concurrent sweep ran', sweeps.filter((s) => !s.skipped).length <= 1, `ran=${sweeps.filter((s) => !s.skipped).length}`)
  const dupOffers = await prisma.$queryRawUnsafe(`select offered_driver_id, count(*)::int n from ride_requests where offered_driver_id is not null and driver_id is null and status in ('REQUESTED','MATCHING') and offer_expires_at > now() group by offered_driver_id having count(*) > 1`)
  check('no driver holds two live offers', dupOffers.length === 0, JSON.stringify(dupOffers))

  // cleanup
  await prisma.$executeRawUnsafe(`update ride_requests set status='CANCELLED', offered_driver_id=null, offer_expires_at=null where rider_id = $1::uuid`, rider.id)
  // take this suite's drivers offline so later suites that look for "the nearest driver" never see them
  await prisma.$executeRawUnsafe(`update driver_profiles set on_duty_at = null, last_location_updated_at = now() - interval '1 day' where user_id = any($1::uuid[])`, drivers.map((d) => d.id))
  console.log(`\n${failed ? `FAILED ${failed}` : 'ALL PASS'}`)
  await prisma.$disconnect()
  process.exit(failed ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
