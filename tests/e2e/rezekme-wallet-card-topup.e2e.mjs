// Rezekme wallet top-up by card (Stripe Checkout), over real HTTP. The API must be started by the caller with:
//   NODE_OPTIONS="--import ./tests/e2e/helpers-fake-stripe-preload.mjs" STRIPE_SECRET_KEY=sk_test_fake SR_GUEST_STRIPE_ENABLED=1
//   PAYMENTS_ENABLED=true PAYMENT_PROVIDER_STRIPE_APPROVED=true PAYMENT_RAIL_STRIPE_CHECKOUT_ENABLED=true (+ the usual rezekme payment switches)
// Stripe itself is replaced by the preload, so no real charge is possible.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createSessionToken } from './_session.mjs'
import { db } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const FILE = process.env.FAKE_STRIPE_FILE || '/tmp/fake-stripe.json'
const run = crypto.randomUUID().slice(0, 8)
let passed = 0; const failures = []
const t = async (name, fn) => { try { await fn(); passed += 1; console.log('PASS', name) } catch (e) { failures.push(name); console.log('FAIL', name, '\n   ', String(e.message).slice(0, 300)) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let j; try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j, code: j?.error?.code }
}
const p = db()
const mk = async (label) => { const u = await p.user.create({ data: { email: `top-${run}-${label}@example.invalid`, displayName: `Top ${label}`, status: 'ACTIVE' } }); await p.userRole.create({ data: { userId: u.id, role: 'GUEST' } }); return { u, token: await createSessionToken({ id: u.id, roles: [{ role: 'GUEST' }] }) } }
const a = await mk('a'); const b = await mk('b')
const balance = async (u) => (await p.wallet.findFirst({ where: { userId: u.id, currency: 'USD' } }))?.cachedBalanceMinor ?? 0
const markPaid = (id) => { const all = JSON.parse(fs.readFileSync(FILE, 'utf8')); all[id].payment_status = 'paid'; fs.writeFileSync(FILE, JSON.stringify(all)) }
const topup = (token, fareMinor) => call('POST', '/api/payments/stripe/guest-checkout-session', token, { purpose: 'topup', fareMinor, currency: 'USD', origin: 'https://rides.example.test' })

await t('amount limits are enforced ($5 to $500, USD only)', async () => {
  assert.equal((await topup(a.token, 4)).code, 'WALLET_TOPUP_AMOUNT_INVALID')
  assert.equal((await topup(a.token, 501)).code, 'WALLET_TOPUP_AMOUNT_INVALID')
  assert.equal((await call('POST', '/api/payments/stripe/guest-checkout-session', a.token, { purpose: 'topup', fareMinor: 20, currency: 'SYP', origin: 'https://x.test' })).code, 'WALLET_TOPUP_AMOUNT_INVALID')
})

let session
await t('creating a top-up session charges the right amount and returns to the wallet page', async () => {
  const r = await topup(a.token, 20)
  assert.equal(r.status, 201, JSON.stringify(r.j).slice(0, 240))
  session = r.j.sessionId
  const s = JSON.parse(fs.readFileSync(FILE, 'utf8'))[session]
  assert.equal(s.amount, 2000, 'cents'); assert.equal(s.metadata.intentType, 'client_topup'); assert.equal(s.metadata.riderId, a.u.id)
  assert.match(s.success_url, /topup_session_id=.*#\/wallet$/)
})

await t('an unpaid session credits nothing', async () => {
  const r = await call('POST', '/api/wallet/stripe/confirm-topup', a.token, { sessionId: session })
  assert.equal(r.code, 'STRIPE_PAYMENT_NOT_CAPTURED'); assert.equal(await balance(a.u), 0)
})

await t('another rider cannot claim this session', async () => {
  markPaid(session)
  const r = await call('POST', '/api/wallet/stripe/confirm-topup', b.token, { sessionId: session })
  assert.equal(r.status, 403); assert.equal(await balance(b.u), 0)
})

await t('after Stripe says paid, confirming credits $20 once (idempotent on repeat)', async () => {
  const r1 = await call('POST', '/api/wallet/stripe/confirm-topup', a.token, { sessionId: session })
  assert.equal(r1.status, 200, JSON.stringify(r1.j).slice(0, 240)); assert.equal(r1.j.creditedMinor, 20)
  const r2 = await call('POST', '/api/wallet/stripe/confirm-topup', a.token, { sessionId: session })
  assert.equal(r2.status, 200)
  assert.equal(await balance(a.u), 20, 'credited exactly once')
  const w = await call('GET', '/api/wallet?currency=USD', a.token)
  assert.equal(w.j.wallet.availableMinor, 20)
})

await t('a ride-payment session cannot be replayed as a top-up', async () => {
  const all = JSON.parse(fs.readFileSync(FILE, 'utf8')); all.cs_ride = { id: 'cs_ride', payment_status: 'paid', metadata: { intentType: 'client_preride', riderId: a.u.id, fareMinor: '50' }, payment_intent: 'pi_ride' }; fs.writeFileSync(FILE, JSON.stringify(all))
  const r = await call('POST', '/api/wallet/stripe/confirm-topup', a.token, { sessionId: 'cs_ride' })
  assert.equal(r.code, 'TOPUP_SESSION_INVALID'); assert.equal(await balance(a.u), 20)
})

console.log(`\n${passed} passed, ${failures.length} failed`)
await p.$disconnect()
process.exit(failures.length ? 1 : 0)
