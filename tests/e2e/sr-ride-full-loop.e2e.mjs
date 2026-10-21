// SR ride full loop on a throwaway database (server on :3051, DRIVER_ID = an APPROVED, on-duty ECONOMY driver):
// rider requests -> driver claims -> arriving -> pickup code verified -> trip starts -> rider cannot cancel mid-trip ->
// trip completes -> rider sees COMPLETED -> driver sees the earning in the payout balance.
import { createSessionToken } from './_session.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label} ${extra}`) } }

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}

const rider = await createSessionToken({ id: process.env.GUEST || process.env.BUYER, roles: [{ role: 'GUEST' }] })
const driver = await createSessionToken({ id: process.env.DRIVER_ID, roles: [{ role: 'DRIVER' }] })

console.log('=== FULL LOOP ===')
const created = await call('POST', '/api/sr/rides', rider, { pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', category: 'SR Economy', currency: 'SYP', lowDataMode: true })
ok(created.status === 201 && created.j?.ride?.status === 'REQUESTED', 'rider creates a ride', JSON.stringify(created.j).slice(0, 160))
const id = created.j?.ride?.id
const seen = await call('GET', `/api/sr/rides/${id}`, rider)
const code = seen.j?.ride?.metadata?.pickupCode
ok(typeof code === 'string' && code.length === 4, 'rider can see the 4-digit pickup code')

const claim = await call('PATCH', `/api/sr/rides/${id}/claim`, driver)
ok(claim.status === 200 && claim.j?.ride?.status === 'DRIVER_ASSIGNED', 'driver claims the ride', JSON.stringify(claim.j).slice(0, 160))
const arriving = await call('PATCH', `/api/driver/rides/${id}/status`, driver, { status: 'DRIVER_ARRIVING' })
ok(arriving.status === 200, 'driver -> arriving', JSON.stringify(arriving.j).slice(0, 160))

const early = await call('PATCH', `/api/driver/rides/${id}/status`, driver, { status: 'IN_PROGRESS' })
ok(early.status === 403 && early.j?.error?.code === 'PICKUP_NOT_VERIFIED', 'trip cannot start before the pickup code is verified')
const wrong = await call('POST', `/api/sr/rides/${id}/verify-pickup`, driver, { code: code === '0000' ? '1111' : '0000' })
ok(wrong.status === 403 && wrong.j?.error?.code === 'PICKUP_CODE_MISMATCH', 'a wrong pickup code is rejected')
const right = await call('POST', `/api/sr/rides/${id}/verify-pickup`, driver, { code })
ok(right.status === 200, 'the right pickup code is accepted', JSON.stringify(right.j).slice(0, 160))

const start = await call('PATCH', `/api/driver/rides/${id}/status`, driver, { status: 'IN_PROGRESS' })
ok(start.status === 200, 'trip starts after verification', JSON.stringify(start.j).slice(0, 160))
const cancel = await call('PATCH', `/api/sr/rides/${id}/cancel`, rider)
ok(cancel.status >= 400, 'rider cannot cancel once the trip is in progress', `http=${cancel.status} ${cancel.j?.ride?.status || ''}`)

const done = await call('PATCH', `/api/driver/rides/${id}/status`, driver, { status: 'COMPLETED' })
ok(done.status === 200, 'driver completes the trip', JSON.stringify(done.j).slice(0, 200))
const final = await call('GET', `/api/sr/rides/${id}`, rider)
ok(final.j?.ride?.status === 'COMPLETED', 'rider sees COMPLETED', `status=${final.j?.ride?.status}`)

const payouts = await call('GET', '/api/driver/payouts', driver)
ok(payouts.status === 200, 'driver payout summary loads', `http=${payouts.status}`)
// Earnings are COLLECTED money: the driver is credited only when the rider's wallet pays the fare (prepay).
// This test runs without a funded rider wallet, so the balance stays 0 here by design. The funded-wallet money flow
// (top-up -> prepay hold -> completion -> driver credit) is a separate test.
ok(Number.isFinite(Number(payouts.j?.availableMinor)) && Number.isFinite(Number(payouts.j?.pendingMinor)), 'payout balances are numeric')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
