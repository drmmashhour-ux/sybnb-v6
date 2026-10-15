// SYBNB — SR VIP tier + rider-offered driver bonus (Yallago gap-closure #2 and #3, 2026-10-15).
//
// Proves, against the real HTTP API:
//   VIP:   'SR VIP' quotes above Van on the same trip; an ECONOMY-vehicle driver is refused the
//          claim (DRIVER_CATEGORY_MISMATCH); a VIP-vehicle driver (recent build year — VIP carries
//          the strictest age gate, default 6y) claims it; a VIP car older than the gate is refused.
//   Bonus: a whole-USD bonus within the cap is added ON TOP of the quoted fare and recorded in
//          metadata.fareFactors.bonusMinor; an out-of-cap or fractional bonus is a 400
//          RIDE_BONUS_INVALID, never a silent clamp.
//
// Like session-revocation, this suite creates its OWN synthetic fixtures (rider + two drivers) via
// Prisma and cleans them up — it never touches the shared env fixtures other suites depend on.
// Run: node tests/e2e/sr-vip-bonus.e2e.mjs   (API_BASE default http://127.0.0.1:3051)
import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let j; try { j = JSON.parse(text) } catch { j = { raw: text.slice(0, 300) } }
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code

const RUN = Date.now()
const ids = { rider: randomUUID(), vipDriver: randomUUID(), ecoDriver: randomUUID() }

async function makeDriver(id, email, profile) {
  await db().user.create({
    data: {
      id, email, displayName: email, status: 'ACTIVE', idDocumentStatus: 'APPROVED',
      roles: { create: [{ role: 'DRIVER' }] },
      driverProfile: { create: { vehicleStatus: 'APPROVED', inspectionStatus: 'PASSED', active: true, ...profile } },
    },
  })
}
// Cleanup must remove every dependent row first, or the user delete FK-fails and the leftover
// drivers poison the NEXT suite's findCleanDrivers() (observed live 2026-10-15: a stale vipbonus
// driver with a PENDING_REVIEW vehicle made sr-ride-pooling-discount fail with
// DRIVER_VEHICLE_NOT_APPROVED). Sweeps ALL vipbonus-* fixtures from any previous run, not just
// this RUN's ids, and the end-of-suite call is a real CHECK so a failure is loud, never silent.
async function cleanup() {
  const stale = await db().user.findMany({ where: { email: { startsWith: 'vipbonus-' } }, select: { id: true } })
  const all = [...new Set([...stale.map((u) => u.id), ...Object.values(ids)])]
  if (!all.length) return
  const rides = await db().rideRequest.findMany({
    where: { OR: [{ riderId: { in: all } }, { driverId: { in: all } }] },
    select: { id: true },
  })
  const rideIds = rides.map((r) => r.id)
  if (rideIds.length) {
    await db().rideEvent.deleteMany({ where: { rideId: { in: rideIds } } })
    await db().rideRequest.deleteMany({ where: { id: { in: rideIds } } })
  }
  // PUT /api/driver/vehicle (checks 5a/5b) writes admin audit rows with the driver as actor.
  await db().adminAuditLog.deleteMany({ where: { actorUserId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { entityType: 'user', entityId: { in: all } } })
  await db().user.deleteMany({ where: { id: { in: all } } })
}

await cleanup().catch(() => {})
await db().user.create({ data: { id: ids.rider, email: `vipbonus-rider-${RUN}@sybnb.test`, displayName: 'vip rider', status: 'ACTIVE', roles: { create: [{ role: 'GUEST' }] } } })
await makeDriver(ids.vipDriver, `vipbonus-vip-${RUN}@sybnb.test`, { vehicleMake: 'Mercedes', vehicleModel: 'E-Class', vehiclePlate: `VIP-${RUN % 100000}`, vehicleYear: new Date().getFullYear() - 1, vehicleColor: 'Black', vehicleCategory: 'VIP' })
await makeDriver(ids.ecoDriver, `vipbonus-eco-${RUN}@sybnb.test`, { vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: `ECO-${RUN % 100000}`, vehicleYear: 2021, vehicleColor: 'White', vehicleCategory: 'ECONOMY' })

const riderT = await createSessionToken({ id: ids.rider, roles: [{ role: 'GUEST' }] })
const vipT = await createSessionToken({ id: ids.vipDriver, roles: [{ role: 'DRIVER' }] })
const ecoT = await createSessionToken({ id: ids.ecoDriver, roles: [{ role: 'DRIVER' }] })

console.log('=== SR VIP + DRIVER BONUS (gap-closure #2/#3) ===')
const rideArgs = { pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', currency: 'SYP', lowDataMode: true }

// 1. VIP quotes above Van on the identical trip.
const vipQuote = (await call('POST', '/api/sr/quote', riderT, { ...rideArgs, category: 'SR VIP' })).j?.quote
const vanQuote = (await call('POST', '/api/sr/quote', riderT, { ...rideArgs, category: 'SR Van' })).j?.quote
check('1a. VIP quote returned', Number.isFinite(vipQuote?.fareMinor), JSON.stringify(vipQuote))
check('1b. VIP prices at or above Van on the same trip', vipQuote?.fareMinor >= vanQuote?.fareMinor, `vip=${vipQuote?.fareMinor} van=${vanQuote?.fareMinor}`)

// 2. Bonus validation is fail-closed.
const tooBig = await call('POST', '/api/sr/rides', riderT, { ...rideArgs, category: 'SR VIP', bonusMinor: 999 })
check('2a. out-of-cap bonus is a 400 RIDE_BONUS_INVALID', tooBig.status === 400 && code(tooBig) === 'RIDE_BONUS_INVALID', `${tooBig.status} ${code(tooBig)}`)
const fractional = await call('POST', '/api/sr/rides', riderT, { ...rideArgs, category: 'SR VIP', bonusMinor: 2.5 })
check('2b. fractional bonus is a 400 RIDE_BONUS_INVALID', fractional.status === 400 && code(fractional) === 'RIDE_BONUS_INVALID', `${fractional.status} ${code(fractional)}`)

// 3. A valid bonus lands on top of the quote and in the audit trail.
const BONUS = 5
const created = await call('POST', '/api/sr/rides', riderT, { ...rideArgs, category: 'SR VIP', bonusMinor: BONUS })
const ride = created.j?.ride
check('3a. VIP ride with bonus created', created.status === 201 && Boolean(ride?.id), JSON.stringify(created.j).slice(0, 200))
check('3b. fare = quote + bonus', ride?.fareMinor === vipQuote?.fareMinor + BONUS, `fare=${ride?.fareMinor} quote=${vipQuote?.fareMinor} bonus=${BONUS}`)
check('3c. bonus recorded in fareFactors', ride?.metadata?.fareFactors?.bonusMinor === BONUS, JSON.stringify(ride?.metadata?.fareFactors))

// 4. Tier-to-vehicle enforcement: ECONOMY car cannot take a VIP ride; a VIP car can.
const ecoClaim = await call('PATCH', `/api/sr/rides/${ride.id}/claim`, ecoT)
check('4a. ECONOMY driver refused the VIP ride (DRIVER_CATEGORY_MISMATCH)', ecoClaim.status === 403 && code(ecoClaim) === 'DRIVER_CATEGORY_MISMATCH', `${ecoClaim.status} ${code(ecoClaim)}`)
const vipClaim = await call('PATCH', `/api/sr/rides/${ride.id}/claim`, vipT)
check('4b. VIP driver claims the VIP ride', vipClaim.status === 200, `${vipClaim.status} ${JSON.stringify(vipClaim.j).slice(0, 200)}`)

// 5. VIP age gate (enforced at vehicle registration, server/routes/driver.mjs): a driver cannot
// DECLARE a car older than the VIP limit (default 6y) as VIP — the only writer of the category.
const vehicleBase = { vehicleMake: 'Audi', vehicleModel: 'A6', vehiclePlate: `AGE-${RUN % 100000}` }
const oldCarVip = await call('PUT', '/api/driver/vehicle', ecoT, { ...vehicleBase, vehicleCategory: 'VIP', vehicleYear: new Date().getFullYear() - 10 })
check('5a. registering a 10-year-old car as VIP is refused (VEHICLE_CATEGORY_YEAR_INVALID)',
  oldCarVip.status === 400 && code(oldCarVip) === 'VEHICLE_CATEGORY_YEAR_INVALID',
  `${oldCarVip.status} ${code(oldCarVip)} ${JSON.stringify(oldCarVip.j).slice(0, 160)}`)
const newCarVip = await call('PUT', '/api/driver/vehicle', ecoT, { ...vehicleBase, vehicleCategory: 'VIP', vehicleYear: new Date().getFullYear() - 1 })
check('5b. a recent car may register as VIP', newCarVip.status === 200, `${newCarVip.status} ${JSON.stringify(newCarVip.j).slice(0, 160)}`)

// 6. International trip (gap-closure #4a): a named cross-border dropoff carries the surcharge and
// is recorded in the audit trail; a client cannot inject the flags itself.
const intl = await call('POST', '/api/sr/rides', riderT, { ...rideArgs, dropoff: 'Beirut', category: 'SR Comfort', metadata: { deliveryOnly: true } })
const intlRide = intl.j?.ride
check('6a. Damascus->Beirut ride created', intl.status === 201 && Boolean(intlRide?.id), JSON.stringify(intl.j).slice(0, 200))
check('6b. internationalTrip + surcharge recorded in fareFactors',
  intlRide?.metadata?.fareFactors?.internationalTrip === true && Number(intlRide?.metadata?.fareFactors?.internationalSurcharge) > 0,
  JSON.stringify(intlRide?.metadata?.fareFactors))
check('6c. client-injected metadata.deliveryOnly is overridden (anti-injection)', intlRide?.metadata?.deliveryOnly === false, `deliveryOnly=${JSON.stringify(intlRide?.metadata?.deliveryOnly)}`)

// 7. Package delivery (gap-closure #4b): the real flag is recorded.
const pkg = await call('POST', '/api/sr/rides', riderT, { ...rideArgs, category: 'SR Economy', deliveryOnly: true })
check('7a. package-delivery ride records deliveryOnly', pkg.status === 201 && pkg.j?.ride?.metadata?.deliveryOnly === true, JSON.stringify(pkg.j?.ride?.metadata?.deliveryOnly))

let cleanupError = null
await cleanup().catch((err) => { cleanupError = err })
check('cleanup removed all suite fixtures (no residue for later suites)', !cleanupError, cleanupError?.message?.slice(0, 200))
await disconnectDb()
console.log(`\n=== SR VIP+BONUS RESULT: ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
