// Rezekme launch fixes, over real HTTP against a throwaway DB (API started by the caller with the rezekme settings):
//   SR_REQUIRE_PREPAY=1 SYBNB_PAYMENTS_GATE=enabled PAYMENT_POLICY_ELIGIBLE_DIVISIONS=SR,PLATFORM PAYMENT_RAIL_MANUAL_PROOF_ENABLED=true
//   PAYMENT_OPERATION_MANUAL_PROOF_CREATE_ENABLED=true PAYMENT_OPERATION_MANUAL_PROOF_CAPTURE_ENABLED=true
// Proves: (1) a typed Sham Cash reference no longer pays/unlocks a ride, (2) Sham Cash is a wallet top-up that an admin must approve,
// (3) only then the ride is accepted and the fare held from the wallet, (4) key-code verification is rate limited and keyed.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const run = crypto.randomUUID().slice(0, 8)
let passed = 0; const failures = []
const t = async (name, fn) => { try { await fn(); passed += 1; console.log('PASS', name) } catch (e) { failures.push(name); console.log('FAIL', name, '\n   ', String(e.message).slice(0, 300)) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let j; try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j, code: j?.error?.code }
}

const p = db()
const mkUser = async (label, role) => {
  const u = await p.user.create({ data: { email: `rez-${run}-${label}@example.invalid`, displayName: `Rez ${label}`, status: 'ACTIVE' } })
  await p.userRole.create({ data: { userId: u.id, role } })
  return { u, token: await createSessionToken({ id: u.id, roles: [{ role }] }) }
}
const rider = await mkUser('rider', 'GUEST')
const admin = await mkUser('admin', 'ADMIN')
const driver = await mkUser('driver', 'DRIVER')
await p.driverProfile.create({ data: { userId: driver.u.id, vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: `E2E-${run}`, vehicleYear: 2021, vehicleColor: 'White', vehicleCategory: 'ECONOMY', vehicleStatus: 'APPROVED', inspectionStatus: 'PASSED', active: true } })

const ride = (extra = {}) => call('POST', '/api/sr/rides', rider.token, { pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', category: 'SR Economy', currency: 'USD', ...extra })

await t('a typed Sham Cash reference does NOT unlock or pay a ride (prepay required)', async () => {
  const r = await ride({ guestShamCashRef: `FAKE-${run}` })
  assert.equal(r.status, 402, JSON.stringify(r.j).slice(0, 200))
  assert.equal(r.code, 'RIDE_PREPAY_REQUIRED')
  assert.equal(await p.rideRequest.count({ where: { riderId: rider.u.id } }), 0, 'no ride was created')
})

let proofId; let needed
await t('Sham Cash top-up proof is recorded as PENDING_ADMIN_REVIEW and a duplicate reference is refused', async () => {
  // The server spreads error.details into the error body, so requiredMinor sits on error itself.
  const q = await ride().then((x) => x.j?.error)
  needed = Math.max(1, q?.requiredMinor ?? 5)
  const r = await call('POST', '/api/wallet/topup-proof', rider.token, { amountMinor: needed, currency: 'USD', providerRef: `SC-${run}` })
  assert.equal(r.status, 201, JSON.stringify(r.j).slice(0, 200))
  assert.equal(r.j.proof.status, 'PENDING_ADMIN_REVIEW'); assert.equal(r.j.proof.planCode, 'wallet_topup')
  proofId = r.j.proof.id
  const dup = await call('POST', '/api/wallet/topup-proof', rider.token, { amountMinor: needed, currency: 'USD', providerRef: `SC-${run}` })
  assert.equal(dup.status, 409)
  assert.equal((await ride()).status, 402, 'a pending proof is not money')
})

await t('admin approval (with Sham Cash reconciliation) credits the wallet; then the ride is accepted and the fare is held', async () => {
  const bad = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, admin.token, { decision: 'APPROVED' })
  assert.equal(bad.status, 409, 'approval without reconciliation is refused: ' + JSON.stringify(bad.j).slice(0, 160))
  const ok = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, admin.token, { decision: 'APPROVED', shamCashReconciliation: { accountMinor: needed, expectedMinor: needed, differenceMinor: 0 } })
  assert.equal(ok.status, 200, JSON.stringify(ok.j).slice(0, 240))
  const w = await p.wallet.findFirst({ where: { userId: rider.u.id, currency: 'USD' } })
  assert.ok(w && w.cachedBalanceMinor >= needed, `wallet credited, got ${w?.cachedBalanceMinor}`)
  const r = await ride()
  assert.equal(r.status, 201, JSON.stringify(r.j).slice(0, 240))
  assert.equal(r.j.ride.metadata?.prepaid, true)
})

const sha = (code) => crypto.createHash('sha256').update(`driver-key:${code}`).digest('hex')
await t('key code: issued hash is keyed (not the legacy unsalted sha256) and wrong guesses are rate limited after 5', async () => {
  const issued = await call('POST', `/api/admin/drivers/${driver.u.id}/key-code`, admin.token)
  assert.equal(issued.status, 200); const code = issued.j.code
  const row = await p.driverProfile.findUnique({ where: { userId: driver.u.id } })
  assert.notEqual(row.keyCodeHash, sha(code), 'not the unsalted legacy hash')
  const wrong = code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 4; i += 1) assert.equal((await call('POST', '/api/driver/key-code/verify', driver.token, { code: wrong })).code, 'KEY_CODE_WRONG')
  // 5th attempt may be the last allowed; the 6th must be blocked
  await call('POST', '/api/driver/key-code/verify', driver.token, { code: wrong })
  const sixth = await call('POST', '/api/driver/key-code/verify', driver.token, { code })
  assert.equal(sixth.status, 429); assert.equal(sixth.code, 'KEY_CODE_TOO_MANY_ATTEMPTS')
})

await t('key code issued before the change (legacy hash) still verifies', async () => {
  await p.$executeRaw`DELETE FROM rate_limit_buckets WHERE bucket_key = ${'driver-key-verify:' + driver.u.id}`
  await p.driverProfile.update({ where: { userId: driver.u.id }, data: { keyCodeHash: sha('123456') } })
  const r = await call('POST', '/api/driver/key-code/verify', driver.token, { code: '123456' })
  assert.notEqual(r.code, 'KEY_CODE_WRONG', `code accepted (documents may still block duty): ${JSON.stringify(r.j).slice(0, 160)}`)
})

await t('admin daily report still works once a driver payout is PAID (method is a JSON object)', async () => {
  await p.payoutRequest.create({ data: { hostId: driver.u.id, amountMinor: 4, currency: 'USD', status: 'PAID', reference: `E2E-${run}`, decidedAt: new Date(), method: { kind: 'driver', type: 'sham_cash', accountName: 'E2E', walletNumber: '0999' } } })
  const rep = await call('GET', '/api/admin/daily-report', admin.token)
  assert.equal(rep.status, 200, JSON.stringify(rep.j).slice(0, 200))
})

await t('AI helper: refuses the wrong role, answers configured:false without an AI key (no fake answer), and is rate limited', async () => {
  const wrong = await call('POST', '/api/sr/assistant', driver.token, { role: 'rider', question: 'Where is my money?' })
  assert.equal(wrong.status, 403, JSON.stringify(wrong.j).slice(0, 160))
  const noKey = await call('POST', '/api/sr/assistant', rider.token, { role: 'rider', question: 'Why is my balance 0?' })
  assert.equal(noKey.status, 200); assert.equal(noKey.j.configured, false); assert.equal(noKey.j.answer, undefined)
  const d = await call('POST', '/api/sr/assistant', driver.token, { role: 'driver', question: 'When do I get paid?' })
  assert.equal(d.status, 200); assert.equal(d.j.configured, false)
  assert.equal((await call('POST', '/api/sr/assistant', rider.token, { role: 'rider', question: '' })).status, 400)
  let limited = 0
  for (let i = 0; i < 22; i += 1) { if ((await call('POST', '/api/sr/assistant', rider.token, { role: 'rider', question: 'q' + i })).status === 429) limited += 1 }
  assert.ok(limited >= 1, 'rate limit kicks in after 20 questions per hour')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
await p.$disconnect()
process.exit(failures.length ? 1 : 0)
