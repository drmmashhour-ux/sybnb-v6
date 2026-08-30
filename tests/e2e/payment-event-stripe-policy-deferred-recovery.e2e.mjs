// SYBNB — stripe_checkout POLICY_DEFERRED recovery, proven through the REAL HTTP webhook route and
// the REAL payment-policy authorization pipeline in BOTH phases (governed evidence artifact).
//
// Round 8's claim that stripe_checkout POLICY_DEFERRED recovery was proven via live redelivery and
// admin replay was REJECTED by independent review: the "recovery" was actually performed by calling
// the internal pipeline directly, bypassing the HTTP route and payment-policy authorization entirely,
// and the admin-replay assertion was too weak to distinguish "eligibility now succeeds, this server's
// own standing stripe-unapproved condition denies it" from any other failure — including the real 503
// that the packaged server log actually showed. This suite closes that gap by never calling
// applyPaymentEvent/applyStripeCheckoutEvent for these specific proofs — every assertion here is
// against a real HTTP response from a real running server.
//
// Runs TWO servers SIMULTANEOUSLY against the SAME database:
//   - "unapproved" (API_BASE_UNAPPROVED, default :3051): the real, permanent production
//     configuration — APPROVED_PROVIDER_CONFIGS has no 'stripe' entry, full stop.
//   - "approved" (API_BASE_APPROVED, default :3052): the SAME configuration PLUS
//     NODE_ENV=test AND PAYMENT_POLICY_TEST_STRIPE_APPROVED=true — a narrow, explicitly-named,
//     test-runtime-only override (see resolveApprovedProviderConfig() in
//     server/lib/payment-policy.mjs) that exists ONLY so this exact end-to-end proof is possible.
//     Independent review's Round 9 response found the guard's prior condition
//     (`environment !== 'production'`) also activated in `development`/`staging`, not only a genuine
//     test runtime; the guard now requires environment === 'test' exactly (NODE_ENV=test), proven
//     exhaustively against every other environment value — including production, staging,
//     development, and malformed/near-miss variants — by the dedicated, server-free
//     payment-policy-stripe-approval-guard.e2e.mjs, which also runs a mutation probe against the
//     guard's prior, weaker condition. Production reads APPROVED_PROVIDER_CONFIGS.stripe directly
//     (always undefined) regardless of this env var's value or NODE_ENV.
//
// Proves:
//   - Phase A (unapproved server): a correctly signed Stripe webhook is durably received (200),
//     POLICY_DEFERRED, zero financial effects, zero consumed attempts — proving PAYMENTS_ENABLED=true
//     (set on BOTH servers) is not sufficient on its own; provider approval is a separate, necessary
//     gate (negative control: "enabling the rail without provider approval remains insufficient");
//   - Phase B (approved server): the EXACT SAME event, redelivered through the real HTTP webhook
//     route, returns 200 with applied:true, settles APPLIED, and produces exactly one real financial
//     effect and exactly one consumed attempt;
//   - a FRESH POLICY_DEFERRED event, recovered through the real, authenticated admin replay HTTP
//     route on the approved server: exactly 200, result.applied === true, APPLIED, exactly one
//     effect, and a real admin audit log entry;
//   - negative control: an invalid signature still creates zero rows;
//   - the unapproved server's own denial is asserted PRECISELY (503, PAYMENT_POLICY_DENIED, the exact
//     "No approved provider configuration for this request." message) — not merely "not the
//     eligibility-refusal shape", which is how the round-8 assertion passed for the wrong reason.
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> STRIPE_WEBHOOK_SECRET=<secret>
//      STRIPE_SECRET_KEY=sk_test_fake HOST=<uuid> GUEST=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-event-stripe-policy-deferred-recovery.e2e.mjs
//      (two servers must already be running against the SAME database: one with the standard
//      permissive test env (PAYMENTS_ENABLED=true, stripe genuinely unapproved) on port 3051, and a
//      SECOND with the SAME env plus NODE_ENV=test, PAYMENT_POLICY_TEST_STRIPE_APPROVED=true, and
//      PAYMENT_OPERATION_STRIPE_CHECKOUT_REPLAY_ENABLED=true on port 3052)

import { createHash } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API_UNAPPROVED = process.env.API_BASE_UNAPPROVED || 'http://127.0.0.1:3051'
const API_APPROVED = process.env.API_BASE_APPROVED || 'http://127.0.0.1:3052'
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
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}
async function call(apiBase, method, path, token, body) {
  const res = await fetch(apiBase + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
async function stripeWebhook(apiBase, eventObj) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(`${apiBase}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, STRIPE_SECRET) },
    body: payload,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function daysAgoIso(n) { return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString() }

async function verifyHostForPublishing() {
  await call(API_UNAPPROVED, 'PATCH', '/api/me/id-document', H, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call(API_UNAPPROVED, 'PATCH', `/api/admin/review-queue/iddocument/${host.id}`, A, { decision: 'APPROVE' })
  const legal = await call(API_UNAPPROVED, 'GET', '/api/legal', null)
  const doc = legal.j.documents.find((d) => d.key === 'listing-agreement')
  await call(API_UNAPPROVED, 'POST', '/api/legal/consent', H, { documentKey: 'listing-agreement', version: doc.version })
}
async function makeStaysListing(priceMinor) {
  const created = await call(API_UNAPPROVED, 'POST', '/api/listings', H, {
    division: 'STAYS', titleAr: 'شقة اختبار SPD', titleEn: 'SPD test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
  })
  const id = created.j?.listing?.id
  await call(API_UNAPPROVED, 'PATCH', `/api/listings/${id}/submit`, H)
  await call(API_UNAPPROVED, 'PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return id
}
async function makeBooking(listingId, checkInDaysAgo, checkOutDaysAgo) {
  const created = await call(API_UNAPPROVED, 'POST', '/api/bookings', G, { listingId, checkIn: daysAgoIso(checkInDaysAgo), checkOut: daysAgoIso(checkOutDaysAgo) })
  return created.j?.booking
}

console.log('=== SETUP ===')
await verifyHostForPublishing()
const listing = await makeStaysListing(160000)

console.log('\n=== 1. Negative control: an invalid signature creates zero rows (unapproved server) ===')
{
  const before = await db().paymentEvent.count({ where: { rail: 'stripe_checkout' } })
  const payload = JSON.stringify({ id: `evt_spd_bad_${Date.now()}`, type: 'checkout.session.completed', data: { object: { id: 'cs_bad', payment_status: 'paid' } } })
  const res = await fetch(`${API_UNAPPROVED}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
    body: payload,
  })
  const after = await db().paymentEvent.count({ where: { rail: 'stripe_checkout' } })
  check('invalid-signature request is rejected (400)', res.status === 400, res.status)
  check('zero PaymentEvent rows created by the invalid-signature request', before === after, `${before} -> ${after}`)
}

console.log('\n=== 2. Phase A (unapproved server): a correctly signed webhook is durably received but POLICY_DEFERRED -- PAYMENTS_ENABLED=true is NOT sufficient on its own ===')
let sharedBooking, sharedSessionId, sharedEventId, sharedEvtObj
{
  sharedBooking = await makeBooking(listing, 700, 697)
  sharedSessionId = `cs_test_spd_shared_${Date.now()}`
  sharedEventId = `evt_spd_shared_${Date.now()}`
  sharedEvtObj = { id: sharedEventId, type: 'checkout.session.completed', data: { object: { id: sharedSessionId, payment_status: 'paid', currency: 'syp', metadata: { bookingId: sharedBooking.id, sypTotalMinor: '160000' } } } }

  const proofCountBefore = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sharedSessionId } })
  const res = await stripeWebhook(API_UNAPPROVED, sharedEvtObj)
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: sharedEventId, rail: 'stripe_checkout' } })
  const proofCountAfter = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sharedSessionId } })

  check('the webhook is durably received (200) on the unapproved server', res.status === 200, JSON.stringify(res))
  check('the response reflects policyDeferred, not a false success', res.j?.policyDeferred === true, JSON.stringify(res))
  check('the row is POLICY_DEFERRED', row?.processingStatus === 'POLICY_DEFERRED', row?.processingStatus)
  check('zero real financial effects resulted (the rail flag alone is not sufficient -- provider approval is a separate, necessary gate)', proofCountBefore === 0 && proofCountAfter === 0, `${proofCountBefore} -> ${proofCountAfter}`)
  check('zero attempts were consumed while deferred', row?.attempts === 0, row?.attempts)
}

console.log('\n=== 3. Phase B (approved server): redelivering the EXACT SAME event through the real HTTP webhook route now succeeds ===')
{
  const proofCountBefore = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sharedSessionId } })
  const res = await stripeWebhook(API_APPROVED, sharedEvtObj)
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: sharedEventId, rail: 'stripe_checkout' } })
  const proofCountAfter = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sharedSessionId } })

  check('the redelivery through the real HTTP route on the approved server returns 200 with applied:true', res.status === 200 && res.j?.applied === true, JSON.stringify(res))
  check('the event settles APPLIED', row?.processingStatus === 'APPLIED', row?.processingStatus)
  check('exactly one real financial effect resulted', proofCountBefore === 0 && proofCountAfter === 1, `${proofCountBefore} -> ${proofCountAfter}`)
  check('exactly one attempt was consumed (zero were consumed while deferred, per section 2)', row?.attempts === 1, row?.attempts)
}

console.log('\n=== 4. A FRESH POLICY_DEFERRED event, recovered through the real, authenticated admin replay HTTP route on the approved server ===')
{
  const booking = await makeBooking(listing, 710, 707)
  const sessionId = `cs_test_spd_replay_${Date.now()}`
  const eventId = `evt_spd_replay_${Date.now()}`
  const evtObj = { id: eventId, type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', currency: 'syp', metadata: { bookingId: booking.id, sypTotalMinor: '160000' } } } }

  // Genuinely reach POLICY_DEFERRED via the real, unapproved server first -- not a synthetic seed.
  const intakeRes = await stripeWebhook(API_UNAPPROVED, evtObj)
  const seeded = await db().paymentEvent.findFirst({ where: { providerEventId: eventId, rail: 'stripe_checkout' } })
  check('setup: the fresh event genuinely reaches POLICY_DEFERRED via the real webhook route', intakeRes.status === 200 && intakeRes.j?.policyDeferred === true && seeded?.processingStatus === 'POLICY_DEFERRED', JSON.stringify({ intakeRes, status: seeded?.processingStatus }))

  const proofCountBefore = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  const auditCountBefore = await db().adminAuditLog.count({ where: { entityType: 'payment_event', entityId: seeded.id } })

  const replayRes = await call(API_APPROVED, 'POST', `/api/admin/payment-events/${seeded.id}/replay`, A, {})

  const rowAfter = await db().paymentEvent.findUnique({ where: { id: seeded.id } })
  const proofCountAfter = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  const auditCountAfter = await db().adminAuditLog.count({ where: { entityType: 'payment_event', entityId: seeded.id } })

  check('the authenticated admin replay HTTP route returns exactly 200 with result.applied === true', replayRes.status === 200 && replayRes.j?.result?.applied === true, JSON.stringify(replayRes))
  check('the event settles APPLIED', rowAfter?.processingStatus === 'APPLIED', rowAfter?.processingStatus)
  check('exactly one real financial effect resulted', proofCountBefore === 0 && proofCountAfter === 1, `${proofCountBefore} -> ${proofCountAfter}`)
  check('exactly one attempt was consumed', rowAfter?.attempts === 1, rowAfter?.attempts)
  check('a real admin audit log entry was recorded for the replay', auditCountAfter === auditCountBefore + 1, `${auditCountBefore} -> ${auditCountAfter}`)
}

console.log('\n=== 5. The unapproved server\'s own denial is precise, not merely "not the eligibility-refusal shape" ===')
{
  const booking = await makeBooking(listing, 720, 717)
  const sessionId = `cs_test_spd_precise_${Date.now()}`
  const eventId = `evt_spd_precise_${Date.now()}`
  const evtObj = { id: eventId, type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', currency: 'syp', metadata: { bookingId: booking.id, sypTotalMinor: '160000' } } } }
  await stripeWebhook(API_UNAPPROVED, evtObj)
  const seeded = await db().paymentEvent.findFirst({ where: { providerEventId: eventId, rail: 'stripe_checkout' } })

  // Admin replay's OWN eligibility check now passes (POLICY_DEFERRED is claimable, round 8) -- the
  // request reaches authorizePaymentOperation('replay', ...), which denies for the PRECISE, expected
  // reason (provider not approved on THIS server), not any other failure shape.
  const replayRes = await call(API_UNAPPROVED, 'POST', `/api/admin/payment-events/${seeded.id}/replay`, A, {})
  check(
    'replay on the unapproved server is refused with the EXACT expected policy denial (503, PAYMENT_POLICY_DENIED, "No approved provider configuration for this request.") -- not merely "not PAYMENT_EVENT_NOT_REPLAYABLE"',
    replayRes.status === 503 && replayRes.j?.error?.code === 'PAYMENT_POLICY_DENIED' && replayRes.j?.error?.message === 'No approved provider configuration for this request.',
    JSON.stringify(replayRes),
  )
  const rowAfter = await db().paymentEvent.findUnique({ where: { id: seeded.id } })
  check('the row is untouched by the refused replay attempt', rowAfter?.processingStatus === 'POLICY_DEFERRED' && rowAfter?.attempts === 0, JSON.stringify(rowAfter))
}

console.log(`\n==== STRIPE_CHECKOUT POLICY_DEFERRED RECOVERY (REAL HTTP + POLICY): ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
