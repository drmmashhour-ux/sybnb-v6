// SYBNB — Webhook durability E2E (governed evidence artifact), BOTH rails.
//
// Proves, over real HTTP against the real running server + real Postgres, the properties the
// corrective review specifically asked to be shown directly rather than claimed:
//   - an invalid signature is rejected before any PaymentEvent row is ever created (both rails);
//   - a duplicate authenticated delivery of the same event id produces exactly one durable row,
//     never a second (both rails);
//   - PAYMENT_INTENT rail: a fresh, valid delivery applies exactly once, producing real, verifiable
//     effects, and a duplicate redelivery is a no-op, not a second effect;
//   - STRIPE_CHECKOUT rail: since 'stripe' is intentionally absent from APPROVED_PROVIDER_CONFIGS
//     (no Stripe/Syria eligibility exists yet), webhook_apply is CORRECTLY, LIVE-provably
//     policy-deferred on every delivery on this server -- this turns out to give an even better live
//     proof than originally planned of "intake persists even when application is denied", for THIS
//     rail specifically (a standing condition, not one that needs env-toggling to reach). This is
//     also the FIRST live proof the stripe_checkout rail has ever had a durable inbox at all (before
//     this corrective round, PaymentEvent.intent_id was NOT NULL, so this table could not hold an
//     event for this rail under any circumstance — see migration 016). The underlying APPLY
//     MECHANISM (finalizeStripeSession / applyStripeCheckoutEvent) is separately proven correct via
//     a direct, in-process call that bypasses the (intentionally closed) policy gate.
//
// What this file does NOT attempt: toggling PAYMENTS_EMERGENCY_STOP / the payment_intent rail's own
// flags mid-test against the already-running shared server, to prove "webhook_apply denied, intake
// still persisted" end-to-end over live HTTP for THAT rail (its flags are all enabled on this
// server, unlike stripe_checkout's permanent provider-approval gap above). That property is proven
// exhaustively and deterministically at the function level instead (payment-policy.e2e.mjs, section
// 9), authoritative for the POLICY GATE's own behavior; combined with a direct code citation that the
// durable upsert statement executes unconditionally BEFORE the webhook_apply policy call in
// server/routes/payment-intents.mjs (cited in the implementation report), this establishes the same
// property without the fragility of a second, separately env-configured server instance — the same
// disclosed limitation payment-policy.e2e.mjs's own header comment already states for exactly this
// reason.
//
// NO real money, NO live provider. signWebhook()'s scheme is genuinely Stripe-compatible (Stripe
// itself uses `t=<ts>,v1=<hmac>`), so the stripe_checkout rail is exercised with a real signature
// verified by the real `stripe` SDK's constructEvent — no live Stripe account or network call
// involved; STRIPE_SECRET_KEY only needs to be a non-"sk_live_"-prefixed, non-empty string.
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> STRIPE_WEBHOOK_SECRET=<secret>
//      STRIPE_SECRET_KEY=sk_test_fake HOST=<uuid> GUEST=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-webhook-durability.e2e.mjs
//      (server must run with PAYMENT_INTENTS_ENABLED=true, PAYMENTS_ENABLED=true, and the SAME
//      PAYMENT_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY)

import { createSessionToken } from './_session.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const PI_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_sandbox_test'
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_stripe_test'

const host = { id: process.env.HOST }
const guest = { id: process.env.GUEST }
const admin = { id: process.env.ADMIN }
if (!host.id || !guest.id || !admin.id) {
  console.error('Missing HOST/GUEST/ADMIN env')
  process.exit(2)
}
const H = await createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
const G = await createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })
const A = await createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) {
    pass++
    console.log(`   PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}  -> ${detail}`)
  }
}

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}

async function piWebhook(eventObj, { secret = PI_SECRET, timestamp } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(`${API}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret, timestamp) },
    body: payload,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}

async function stripeWebhook(eventObj, { secret = STRIPE_SECRET, timestamp } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(`${API}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret, timestamp) },
    body: payload,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}

function daysAgoIso(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

async function verifyHostForPublishing() {
  await call('PATCH', '/api/me/id-document', H, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${host.id}`, A, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const doc = legal.j.documents.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', H, { documentKey: 'listing-agreement', version: doc.version })
}
async function makeStaysListing(priceMinor) {
  const created = await call('POST', '/api/listings', H, {
    division: 'STAYS', titleAr: 'شقة اختبار WD', titleEn: 'WD test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
  })
  const id = created.j?.listing?.id
  await call('PATCH', `/api/listings/${id}/submit`, H)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return id
}
async function makeBooking(listingId, checkInDaysAgo, checkOutDaysAgo) {
  const created = await call('POST', '/api/bookings', G, { listingId, checkIn: daysAgoIso(checkInDaysAgo), checkOut: daysAgoIso(checkOutDaysAgo) })
  return created.j?.booking
}

console.log('=== SETUP: host publish gate + one APPROVED STAYS listing + two bookings (one per rail) ===')
await verifyHostForPublishing()
const listing = await makeStaysListing(150000)
const bookingA = await makeBooking(listing, 10, 7) // payment_intent rail
const bookingB = await makeBooking(listing, 20, 17) // stripe_checkout rail — non-overlapping dates
check('setup: two real bookings created', Boolean(bookingA?.id) && Boolean(bookingB?.id), JSON.stringify({ bookingA, bookingB }))

console.log('\n=== PAYMENT_INTENT RAIL ===')
const intentRes = await call('POST', '/api/payments/intents', G, { bookingId: bookingA.id })
const intent = intentRes.j?.intent
check('setup: real PaymentIntent created for booking A', Boolean(intent?.id), JSON.stringify(intentRes))

console.log('\n--- Invalid signature: zero PaymentEvent rows created ---')
{
  const before = await db().paymentEvent.count({ where: { rail: 'payment_intent' } })
  const payload = JSON.stringify({ id: `evt_wd_bad_${Date.now()}`, type: 'payment_intent.succeeded', data: { object: { reference: intent.reference, id: 'pi_prov_bad' } } })
  const res = await fetch(`${API}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
    body: payload,
  })
  const after = await db().paymentEvent.count({ where: { rail: 'payment_intent' } })
  check('invalid-signature request is rejected (400)', res.status === 400, res.status)
  check('zero PaymentEvent rows created by the invalid-signature request', before === after, `${before} -> ${after}`)
}

console.log('\n--- Duplicate authenticated delivery: exactly one durable row, exactly one applied effect ---')
{
  const eventId = `evt_wd_dup_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intent.reference, id: 'pi_prov_dup' } } }
  const before = await db().paymentEvent.count({ where: { rail: 'payment_intent', providerEventId: eventId } })
  const r1 = await piWebhook(evt)
  const r2 = await piWebhook(evt) // exact redelivery, same event id
  const after = await db().paymentEvent.count({ where: { rail: 'payment_intent', providerEventId: eventId } })
  const proofCount = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })
  check('first delivery applies', r1.status === 200 && r1.j?.applied === true, JSON.stringify(r1))
  check('duplicate delivery acknowledged as a no-op, not re-applied', r2.status === 200 && r2.j?.applied === false, JSON.stringify(r2))
  check('exactly one durable PaymentEvent row for this event id', before === 0 && after === 1, `${before} -> ${after}`)
  check('exactly one PaymentProof row (effect applied once, not twice)', proofCount === 1, proofCount)
}

console.log('\n=== STRIPE_CHECKOUT RAIL (durable inbox is new in this corrective round — migration 016) ===')
console.log('--- Invalid signature: zero PaymentEvent rows created for this rail ---')
{
  const before = await db().paymentEvent.count({ where: { rail: 'stripe_checkout' } })
  const payload = JSON.stringify({ id: `evt_wd_stripe_bad_${Date.now()}`, type: 'checkout.session.completed', data: { object: { id: 'cs_test_bad', payment_status: 'paid', metadata: { bookingId: bookingB.id } } } })
  const res = await fetch(`${API}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
    body: payload,
  })
  const after = await db().paymentEvent.count({ where: { rail: 'stripe_checkout' } })
  check('invalid-signature request is rejected (400)', res.status === 400, res.status)
  check('zero stripe_checkout PaymentEvent rows created by the invalid-signature request', before === after, `${before} -> ${after}`)
}

console.log('--- Fresh valid delivery: durably stored even though APPLICATION is correctly policy-deferred (stripe has no approved provider config — see payment-policy.mjs) ---')
{
  const sessionId = `cs_test_wd_${Date.now()}`
  const eventId = `evt_wd_stripe_${Date.now()}`
  const evt = { id: eventId, type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', currency: 'syp', metadata: { bookingId: bookingB.id, sypTotalMinor: String(150000) } } } }
  const before = await db().paymentEvent.count({ where: { rail: 'stripe_checkout', providerEventId: eventId } })
  const beforeProofs = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  const r1 = await stripeWebhook(evt)
  const r2 = await stripeWebhook(evt) // duplicate redelivery of the same event id
  const after = await db().paymentEvent.count({ where: { rail: 'stripe_checkout', providerEventId: eventId } })
  const afterProofs = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  const eventRow = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('first delivery is durably received but application is correctly policy-deferred (provider=stripe has no approved config yet — intentional)', r1.status === 200 && r1.j?.policyDeferred === true, JSON.stringify(r1))
  check('redelivery of the same event is also policy-deferred, not silently dropped', r2.status === 200 && r2.j?.policyDeferred === true, JSON.stringify(r2))
  check('exactly one durable stripe_checkout PaymentEvent row for this event id, despite two deliveries (upsert dedup works before any policy decision)', before === 0 && after === 1, `${before} -> ${after}`)
  check('the durable row is correctly traced to the real booking (not intent -- this rail has none)', eventRow?.bookingId === bookingB.id && eventRow?.intentId === null, JSON.stringify(eventRow))
  check('the row is correctly marked POLICY_DEFERRED (a real, queryable status — not silently marked applied/ignored, and not conflated with "not yet attempted")', eventRow?.processingStatus === 'POLICY_DEFERRED', eventRow?.processingStatus)
  check('zero real effects while deferred -- no PaymentProof created for either delivery', beforeProofs === 0 && afterProofs === 0, `${beforeProofs} -> ${afterProofs}`)
}

console.log('\n--- In-process: the APPLY MECHANISM itself (not the policy decision, which is intentionally closed for stripe above) produces exactly one effect ---')
{
  // Calls finalizeStripeSession directly, NOT applyStripeCheckoutEvent -- round 8: independent review
  // found applyStripeCheckoutEvent's previous nullish-claimToken bypass let this call proceed with no
  // claim at all, which is now correctly refused (CLAIM_TOKEN_REQUIRED). finalizeStripeSession itself
  // has no claim concept whatsoever by design (the non-webhook /stripe/confirm route already calls it
  // exactly this way, with no options object at all) -- calling it directly here is not a workaround,
  // it is testing the actual idempotent mechanism this section has always claimed to test ("the apply
  // MECHANISM itself"), one layer below the claim-gated webhook wrapper.
  const { finalizeStripeSession } = await import('../../server/lib/stripe-checkout-apply.mjs')
  const sessionId = `cs_test_wd_mech_${Date.now()}`
  const session = { id: sessionId, payment_status: 'paid', metadata: { bookingId: bookingB.id, sypTotalMinor: '150000' } }
  const proof1 = await finalizeStripeSession(session)
  const proof2 = await finalizeStripeSession(session) // re-apply the same session id
  const proofCount = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  const proof = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: sessionId } })
  check('the apply mechanism produces a real proof on a genuine first application', Boolean(proof1?.id), JSON.stringify(proof1))
  check('re-running the same apply is idempotent (finalizeStripeSession\'s own existingProof check) -- the same proof id, not a new one', proof2?.id === proof1?.id, JSON.stringify({ proof1, proof2 }))
  check('exactly one real PaymentProof row exists after two apply calls (never doubled)', proofCount === 1, proofCount)
  check('the PaymentProof was auto-approved (booking confirmed, matching the payment_intent rail\'s own behavior)', proof?.status === 'APPROVED', proof?.status)
}

console.log(`\n==== PAYMENT WEBHOOK DURABILITY (BOTH RAILS): ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
