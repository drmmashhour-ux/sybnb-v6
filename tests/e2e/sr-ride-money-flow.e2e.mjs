// SR prepaid money flow on a throwaway database (server on :3051 started with SR_REQUIRE_PREPAY=1):
// a rider with NO funds cannot request a ride; after the wallet is funded the fare is held, and on completion the
// driver is credited their share (fare minus commission) and the rider's wallet is not charged twice.
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

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
  // Keep the cached balance equal to its entries: removing an earlier fixture entry also takes its
  // amount back out of the cache (it used to stay in, so a re-run left the wallet out of balance).
  const old = await db().walletEntry.findMany({ where: { walletId: w.id, referenceType: 'e2e_fixture' }, select: { type: true, amountMinor: true } })
  const oldDelta = old.reduce((sum, e) => sum + (e.type === 'DEBIT' ? -e.amountMinor : e.amountMinor), 0)
  await db().walletEntry.deleteMany({ where: { walletId: w.id, referenceType: 'e2e_fixture' } })
  if (oldDelta) await db().wallet.update({ where: { id: w.id }, data: { cachedBalanceMinor: { decrement: oldDelta } } })
  const current = (await db().wallet.findUnique({ where: { id: w.id } })).cachedBalanceMinor
  // Both directions, so a re-run starts from the balance it asks for (a positive leftover from the
  // previous run used to let the "unfunded rider" request through).
  if (minor !== current) {
    await db().walletEntry.create({ data: { walletId: w.id, type: minor > current ? 'CREDIT' : 'DEBIT', amountMinor: Math.abs(minor - current), currency, referenceType: 'e2e_fixture', referenceId: `fx-${Date.now()}`, idempotencyKey: `e2e-fixture-${userId}-${currency}-${Date.now()}`, note: 'e2e fixture' } })
    await db().wallet.update({ where: { id: w.id }, data: { cachedBalanceMinor: minor } })
  }
}
const balance = async (userId, currency) => (await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } }))?.cachedBalanceMinor ?? 0

console.log('=== PREPAID MONEY FLOW ===')
for (const c of ['USD', 'SYP']) await setBalance(RIDER, c, 0)
const body = { pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', category: 'SR Economy', lowDataMode: true }
const broke = await call('POST', '/api/sr/rides', rider, body)
ok(broke.status === 402 && broke.j?.error?.code === 'RIDE_PREPAY_REQUIRED', 'an unfunded rider cannot request a ride (402 RIDE_PREPAY_REQUIRED)', `http=${broke.status} ${broke.j?.error?.code}`)
const cur = (broke.j?.error?.currency ?? broke.j?.error?.details?.currency) || 'USD'
const need = Number(broke.j?.error?.requiredMinor ?? broke.j?.error?.details?.requiredMinor) || 0
ok(need > 0, 'the response says how much the fare is', `required=${need} ${cur}`)

await setBalance(RIDER, cur, need * 3)
const before = await balance(RIDER, cur)
const created = await call('POST', '/api/sr/rides', rider, { ...body, currency: cur })
ok(created.status === 201, 'a funded rider can request the ride', `http=${created.status} ${JSON.stringify(created.j).slice(0, 140)}`)
const id = created.j?.ride?.id
const afterHold = await balance(RIDER, cur)
ok(before - afterHold === need, 'the fare is held from the rider wallet', `before=${before} after=${afterHold} need=${need}`)

const seen = await call('GET', `/api/sr/rides/${id}`, rider)
const code = seen.j?.ride?.metadata?.pickupCode
ok((await call('PATCH', `/api/sr/rides/${id}/claim`, driver)).status === 200, 'driver claims')
ok((await call('PATCH', `/api/driver/rides/${id}/status`, driver, { status: 'DRIVER_ARRIVING' })).status === 200, 'driver arriving')
ok((await call('POST', `/api/sr/rides/${id}/verify-pickup`, driver, { code })).status === 200, 'pickup verified')
ok((await call('PATCH', `/api/driver/rides/${id}/status`, driver, { status: 'IN_PROGRESS' })).status === 200, 'trip starts')
const done = await call('PATCH', `/api/driver/rides/${id}/status`, driver, { status: 'COMPLETED' })
ok(done.status === 200, 'trip completes', JSON.stringify(done.j).slice(0, 160))

await new Promise((r) => setTimeout(r, 1500))
const afterDone = await balance(RIDER, cur)
ok(afterDone === afterHold, 'the rider is not charged a second time at completion', `afterHold=${afterHold} afterDone=${afterDone}`)
const credits = await db().walletEntry.findMany({ where: { wallet: { userId: DRIVER }, type: 'CREDIT', referenceType: 'ride_fare', referenceId: id }, select: { amountMinor: true } })
const driverGot = credits.reduce((s, e) => s + e.amountMinor, 0)
ok(driverGot > 0 && driverGot < need, 'the driver is credited their share (less than the full fare, so commission was taken)', `driverGot=${driverGot} fare=${need}`)
const rate = need ? 1 - driverGot / need : 0
console.log(`  info  driver credited ${driverGot} of ${need} ${cur} (commission ${(rate * 100).toFixed(1)}%)`)
const payouts = await call('GET', '/api/driver/payouts', driver)
ok(payouts.status === 200 && Number(payouts.j?.availableMinor || 0) + Number(payouts.j?.pendingMinor || 0) > 0, 'the driver payout balance shows the earning', `available=${payouts.j?.availableMinor} pending=${payouts.j?.pendingMinor}`)

await disconnectDb()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
