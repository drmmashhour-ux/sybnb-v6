// SR unmatched-request expiry on a throwaway database (server on :3051 with SR_REQUIRE_PREPAY=1):
// a prepaid request nobody takes is cancelled after SR_MATCH_EXPIRE_MINUTES and the rider is refunded in full,
// exactly once; a fresh request and a request a driver already claimed are left alone.
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { expireUnmatchedRides } from '../../server/lib/ride-dispatch.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label} ${extra}`) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
const RIDER = process.env.GUEST2 || process.env.GUEST
const DRIVER = process.env.DRIVER_ID
const rider = await createSessionToken({ id: RIDER, roles: [{ role: 'GUEST' }] })
const driver = await createSessionToken({ id: DRIVER, roles: [{ role: 'DRIVER' }] })
async function setBalance(userId, currency, minor) {
  const w = await db().wallet.upsert({ where: { userId_currency: { userId, currency } }, update: {}, create: { userId, currency } })
  await db().walletEntry.deleteMany({ where: { walletId: w.id, referenceType: 'e2e_fixture' } })
  const current = (await db().wallet.findUnique({ where: { id: w.id } })).cachedBalanceMinor
  if (minor > current) {
    await db().walletEntry.create({ data: { walletId: w.id, type: 'CREDIT', amountMinor: minor - current, currency, referenceType: 'e2e_fixture', referenceId: `fx-${Date.now()}`, idempotencyKey: `e2e-fixture-${userId}-${currency}-${Date.now()}`, note: 'e2e fixture' } })
    await db().wallet.update({ where: { id: w.id }, data: { cachedBalanceMinor: minor } })
  }
}
async function resetRider() {
  await db().rideRequest.updateMany({ where: { riderId: RIDER, status: { in: ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'] } }, data: { status: 'CANCELLED' } })
  await db().wallet.updateMany({ where: { userId: RIDER }, data: { cachedBalanceMinor: 0 } })
}
const balance = async (userId, currency) => (await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } }))?.cachedBalanceMinor ?? 0

console.log('=== UNMATCHED REQUEST EXPIRY ===')
await resetRider()
for (const c of ['USD', 'SYP']) await setBalance(RIDER, c, 0)
const body = { pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', category: 'SR Economy', lowDataMode: true }
const probe = await call('POST', '/api/sr/rides', rider, body)
const cur = (probe.j?.error?.currency ?? probe.j?.error?.details?.currency) || 'USD'
const need = Number(probe.j?.error?.requiredMinor ?? probe.j?.error?.details?.requiredMinor) || 0
await setBalance(RIDER, cur, need * 5)
const start = await balance(RIDER, cur)

// 1) a request nobody takes, aged past the limit
const a = await call('POST', '/api/sr/rides', rider, { ...body, currency: cur })
ok(a.status === 201, 'request A created (prepaid)')
const idA = a.j?.ride?.id
ok(start - (await balance(RIDER, cur)) === need, 'fare held for A')
// the rider's own app must not have been trapped: make A old
await db().rideRequest.update({ where: { id: idA }, data: { requestedAt: new Date(Date.now() - 3 * 3600 * 1000) } })

// 2) a fresh request, not old
const b = await call('POST', '/api/sr/rides', rider, { ...body, currency: cur })
const idB = b.j?.ride?.id
ok(b.status === 201 || b.status === 409, 'request B created or blocked by an open ride', `http=${b.status}`)

const n = await expireUnmatchedRides()
const rideA = await db().rideRequest.findUnique({ where: { id: idA } })
ok(rideA.status === 'CANCELLED', 'old unmatched request A is cancelled', `status=${rideA.status} expired=${n}`)
ok(!!rideA.metadata?.expiredNoDriver, 'A records why it expired')
const refunds = await db().walletEntry.findMany({ where: { wallet: { userId: RIDER }, type: 'REFUND', referenceType: 'ride_prepayment_refund', referenceId: idA }, select: { amountMinor: true } })
ok(refunds.reduce((s, e) => s + e.amountMinor, 0) === need, 'rider refunded in full', `refunds=${JSON.stringify(refunds)} need=${need}`)
const audit = await db().adminAuditLog.findFirst({ where: { action: 'SR_RIDE_EXPIRED_NO_DRIVER', entityId: idA } })
ok(!!audit, 'an audit record is written')

const bAfter = idB ? await db().rideRequest.findUnique({ where: { id: idB } }) : null
if (bAfter) ok(['REQUESTED', 'MATCHING'].includes(bAfter.status), 'fresh request B is left alone', `status=${bAfter.status}`)

// 3) running it again must not refund twice
const before2 = await balance(RIDER, cur)
await expireUnmatchedRides()
ok((await balance(RIDER, cur)) === before2, 'a second run changes nothing (no double refund)')

// 4) an old request a driver already claimed is not expired
if (idB) {
  const claim = await call('PATCH', `/api/sr/rides/${idB}/claim`, driver)
  ok(claim.status === 200, 'driver claims B')
  await db().rideRequest.update({ where: { id: idB }, data: { requestedAt: new Date(Date.now() - 3 * 3600 * 1000) } })
  await expireUnmatchedRides()
  const bNow = await db().rideRequest.findUnique({ where: { id: idB } })
  ok(bNow.status !== 'CANCELLED', 'a claimed ride is never expired', `status=${bNow.status}`)
  await call('PATCH', `/api/sr/rides/${idB}/cancel`, rider)
}

await resetRider()
await disconnectDb()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
