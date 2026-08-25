// SYBNB — Claim ownership & crash recovery E2E (governed evidence artifact).
//
// Proves, over real HTTP + direct library calls against the real running server + real Postgres, the
// properties independent review specifically asked to be shown directly after finding that the
// round-5 CAS claim (a bare compare-and-swap with no ownership token or expiry) solved concurrent
// double-entry into apply() but converted it into a PERMANENT stuck-event problem: a crashed, killed,
// or disconnected worker leaves a row at APPLYING forever, since APPLYING was excluded from
// CLAIMABLE_STATUSES with no path back out — a payment-loss condition, because the provider may have
// already received the durable-intake HTTP 200 and stopped retrying.
//
//   - a row left at APPLYING by a simulated crashed worker (claimed, then nothing — no success or
//     failure handler ever ran, exactly what a killed process leaves behind) is safely reclaimed by a
//     LATER call once its claim expires, and settles to exactly one real financial effect;
//   - repeated 10 times with fresh state, every repetition individually asserted;
//   - a row currently held by an ACTIVE (unexpired) claim is never reclaimed, never has apply()
//     invoked, and is never acknowledged as a final success — it reports retryable:true;
//   - a stale worker that wakes up late (after a newer claimant has already reclaimed and completed
//     the event) can never overwrite the newer claimant's state — its own write, bound to its now-stale
//     token, matches zero rows;
//   - the admin replay endpoint, extended this round, safely recovers a payment_intent-rail event
//     stuck at APPLYING past its claim expiry, and still correctly refuses one that is NOT yet expired.
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> STRIPE_WEBHOOK_SECRET=<secret>
//      STRIPE_SECRET_KEY=sk_test_fake HOST=<uuid> GUEST=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-event-claim-recovery.e2e.mjs
//      (server must run with PAYMENT_INTENTS_ENABLED=true, PAYMENTS_ENABLED=true, and the SAME
//      PAYMENT_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY)

import { randomUUID } from 'node:crypto'
import { createSessionToken } from '../../server/lib/security.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { applyPaymentEvent } from '../../server/lib/payment-event-pipeline.mjs'
import { applyStripeCheckoutEvent } from '../../server/lib/stripe-checkout-apply.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

const host = { id: process.env.HOST }
const guest = { id: process.env.GUEST }
const admin = { id: process.env.ADMIN }
if (!host.id || !guest.id || !admin.id) {
  console.error('Missing HOST/GUEST/ADMIN env')
  process.exit(2)
}
const H = createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
const G = createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })
const A = createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
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
function daysAgoIso(n) { return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString() }

async function verifyHostForPublishing() {
  await call('PATCH', '/api/me/id-document', H, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${host.id}`, A, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const doc = legal.j.documents.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', H, { documentKey: 'listing-agreement', version: doc.version })
}
async function makeStaysListing(priceMinor) {
  const created = await call('POST', '/api/listings', H, {
    division: 'STAYS', titleAr: 'شقة اختبار CR', titleEn: 'CR test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
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

// Seeds a fresh stripe_checkout-rail PaymentEvent at RECEIVED, and returns it plus a matching
// `session` object applyStripeCheckoutEvent() expects — everything needed to independently claim and
// apply it via the real pipeline function, without going through live HTTP.
async function seedReceivedStripeEvent(listing, checkInDaysAgo, checkOutDaysAgo, tag) {
  const booking = await makeBooking(listing, checkInDaysAgo, checkOutDaysAgo)
  const sessionId = `cs_test_cr_${tag}_${Date.now()}`
  const eventRow = await db().paymentEvent.create({
    data: {
      rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout', environment: 'test', subjectType: 'BOOKING',
      providerReference: booking.id, bookingId: booking.id, originalBookingId: booking.id,
      providerEventId: `evt_cr_${tag}_${Date.now()}`, type: 'checkout.session.completed',
      amountMinor: 160000, currency: 'syp', providerObjectId: sessionId, payloadDigest: `digest_${tag}`, processingStatus: 'RECEIVED',
    },
  })
  const session = { id: sessionId, payment_status: 'paid', metadata: { bookingId: booking.id, sypTotalMinor: '160000' } }
  return { eventRow, session, booking }
}

console.log('=== SETUP ===')
await verifyHostForPublishing()
const listing = await makeStaysListing(160000)

console.log('\n=== 1. A crashed-worker claim (claimed, then nothing -- no success/failure handler ever ran) is safely reclaimed and settles to exactly one effect, repeated 10x with fresh state ===')
{
  const badReps = []
  for (let rep = 0; rep < 10; rep++) {
    const { eventRow, session } = await seedReceivedStripeEvent(listing, 40 + rep * 4, 37 + rep * 4, `crash${rep}`)
    // Directly write the state a crashed worker leaves behind: claimed (attempts bumped, APPLYING,
    // a real token), then abandoned -- claimExpiresAt already in the past, exactly as if
    // CLAIM_DURATION_MS had elapsed with nobody ever calling apply() to completion (or apply() started
    // and the process died before either the success or failure handler ran). No cleanup, no error
    // record -- precisely what a killed process leaves in the database.
    const staleToken = randomUUID()
    await db().paymentEvent.update({
      where: { id: eventRow.id },
      data: { processingStatus: 'APPLYING', claimToken: staleToken, attempts: 1, lastAttemptAt: new Date(), claimExpiresAt: new Date(Date.now() - 1000) },
    })

    // A LATER call (standing in for a provider redelivery or an admin replay) reclaims it.
    const result = await applyPaymentEvent({ eventId: eventRow.id, rail: 'stripe_checkout', apply: (claimToken) => applyStripeCheckoutEvent({ eventId: eventRow.id, session, claimToken }) })
    const finalRow = await db().paymentEvent.findUnique({ where: { id: eventRow.id } })
    const proofCount = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: session.id } })
    const ok =
      result?.applied === true &&
      finalRow?.processingStatus === 'APPLIED' &&
      finalRow?.attempts === 2 && // 1 from the simulated stale claim + exactly 1 more from this reclaim
      finalRow?.claimToken === null &&
      finalRow?.claimExpiresAt === null &&
      proofCount === 1
    if (!ok) badReps.push({ rep, result, finalRow, proofCount })
  }
  check(
    'EVERY one of 10 repetitions: a row abandoned mid-claim (simulated crash) is reclaimed by a later call, settles to exactly one real financial effect, exactly one additional consumed attempt, and a fully cleared claim',
    badReps.length === 0,
    JSON.stringify(badReps),
  )
}

console.log('\n=== 2. A row held by an ACTIVE (unexpired) claim is never reclaimed, never runs apply(), and is never acknowledged as a final success ===')
{
  const { eventRow, session } = await seedReceivedStripeEvent(listing, 100, 97, 'active')
  const activeToken = randomUUID()
  await db().paymentEvent.update({
    where: { id: eventRow.id },
    data: { processingStatus: 'APPLYING', claimToken: activeToken, attempts: 1, lastAttemptAt: new Date(), claimExpiresAt: new Date(Date.now() + 60_000) }, // still 60s from expiring
  })
  let spyInvoked = false
  const result = await applyPaymentEvent({
    eventId: eventRow.id,
    rail: 'stripe_checkout',
    apply: async () => { spyInvoked = true; return { applied: true } },
  })
  const rowAfter = await db().paymentEvent.findUnique({ where: { id: eventRow.id } })
  check('apply() is never invoked while an active claim is held by someone else', spyInvoked === false, 'apply() was called')
  check('the result explicitly reports retryable:true, never a final applied/duplicate claim', result?.retryable === true && result?.applied !== true && result?.duplicate !== true, JSON.stringify(result))
  check('attempts is not incremented by the losing attempt', rowAfter?.attempts === 1, rowAfter?.attempts)
  check('the row and its active claim token are completely unchanged', rowAfter?.claimToken === activeToken && rowAfter?.processingStatus === 'APPLYING', JSON.stringify(rowAfter))
}

console.log('\n=== 3. A stale worker that wakes up late, AFTER a newer claimant has already reclaimed and completed the event, can never overwrite the newer claimant\'s state ===')
{
  const { eventRow, session } = await seedReceivedStripeEvent(listing, 110, 107, 'stale-late')
  // Worker 1 claims (directly, so this test knows its exact token), then is abandoned -- exactly
  // section 1's crash simulation, but this time the token is captured so a LATE write attempt using
  // it can be issued deliberately, after worker 2 has already taken over and finished.
  const worker1Token = randomUUID()
  await db().paymentEvent.update({
    where: { id: eventRow.id },
    data: { processingStatus: 'APPLYING', claimToken: worker1Token, attempts: 1, lastAttemptAt: new Date(), claimExpiresAt: new Date(Date.now() - 1000) },
  })

  // Worker 2: a real reclaim that completes normally.
  const result2 = await applyPaymentEvent({ eventId: eventRow.id, rail: 'stripe_checkout', apply: (claimToken) => applyStripeCheckoutEvent({ eventId: eventRow.id, session, claimToken }) })
  const rowAfterWorker2 = await db().paymentEvent.findUnique({ where: { id: eventRow.id } })
  check('worker 2 (the real reclaim) applies successfully', result2?.applied === true, JSON.stringify(result2))
  check('worker 2 settles the row at APPLIED with a cleared claim', rowAfterWorker2?.processingStatus === 'APPLIED' && rowAfterWorker2?.claimToken === null, JSON.stringify(rowAfterWorker2))

  // Worker 1 finally "wakes up" and attempts its own write using its now-stale token -- the exact
  // scenario independent review named: "an expired worker cannot update the event after a new
  // claimant takes ownership".
  const staleWriteResult = await applyStripeCheckoutEvent({ eventId: eventRow.id, session, claimToken: worker1Token })
  const rowAfterStaleWrite = await db().paymentEvent.findUnique({ where: { id: eventRow.id } })
  const proofCount = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: session.id } })
  check('the stale worker\'s own write is a structural no-op (claimLost:true), never throws', staleWriteResult?.claimLost === true, JSON.stringify(staleWriteResult))
  check(
    'the row after the stale write is byte-identical to what worker 2 established -- the late write changed nothing',
    JSON.stringify(rowAfterStaleWrite) === JSON.stringify(rowAfterWorker2),
    JSON.stringify({ afterWorker2: rowAfterWorker2, afterStaleWrite: rowAfterStaleWrite }),
  )
  check('exactly one real financial effect exists -- the stale worker\'s late write never doubled it', proofCount === 1, proofCount)
}

console.log('\n=== 4. Admin replay recovers a payment_intent-rail event stuck at APPLYING past its claim expiry, and still correctly refuses one that is not yet expired ===')
{
  const intentBooking = await makeBooking(listing, 120, 117)
  const intentRes = await call('POST', '/api/payments/intents', G, { bookingId: intentBooking.id })
  const intent = intentRes.j?.intent
  check('setup: real PaymentIntent created', Boolean(intent?.id), JSON.stringify(intentRes))

  // 4a. Expired claim -> replay succeeds and completes the event.
  const eventIdExpired = `evt_cr_replay_expired_${Date.now()}`
  const seededExpired = await db().paymentEvent.create({
    data: {
      rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
      subjectType: 'PAYMENT_INTENT', providerReference: intent.reference, intentId: intent.id,
      originalIntentId: intent.id, originalBookingId: intent.bookingId ?? null,
      providerEventId: eventIdExpired, type: 'payment_intent.succeeded', amountMinor: intent.amountMinor, currency: intent.currency,
      providerObjectId: 'pi_prov_replay_expired', payloadDigest: 'd1', processingStatus: 'APPLYING',
      claimToken: randomUUID(), attempts: 1, lastAttemptAt: new Date(), claimExpiresAt: new Date(Date.now() - 1000),
    },
  })
  const replayExpired = await call('POST', `/api/admin/payment-events/${seededExpired.id}/replay`, A, {})
  const rowAfterExpiredReplay = await db().paymentEvent.findUnique({ where: { id: seededExpired.id } })
  const proofCountExpired = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })
  check('replay of a payment_intent event stuck APPLYING past its claim expiry succeeds (200), not refused', replayExpired.status === 200, JSON.stringify(replayExpired))
  check('the event settles at APPLIED via the replay', rowAfterExpiredReplay?.processingStatus === 'APPLIED', rowAfterExpiredReplay?.processingStatus)
  check('exactly one real financial effect resulted', proofCountExpired === 1, proofCountExpired)

  // 4b. NOT-yet-expired claim -> replay still correctly refuses (still actively owned by someone).
  const intentBookingB = await makeBooking(listing, 130, 127)
  const intentResB = await call('POST', '/api/payments/intents', G, { bookingId: intentBookingB.id })
  const intentB = intentResB.j?.intent
  const eventIdActive = `evt_cr_replay_active_${Date.now()}`
  const seededActive = await db().paymentEvent.create({
    data: {
      rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
      subjectType: 'PAYMENT_INTENT', providerReference: intentB.reference, intentId: intentB.id,
      originalIntentId: intentB.id, originalBookingId: intentB.bookingId ?? null,
      providerEventId: eventIdActive, type: 'payment_intent.succeeded', amountMinor: intentB.amountMinor, currency: intentB.currency,
      providerObjectId: 'pi_prov_replay_active', payloadDigest: 'd2', processingStatus: 'APPLYING',
      claimToken: randomUUID(), attempts: 1, lastAttemptAt: new Date(), claimExpiresAt: new Date(Date.now() + 60_000),
    },
  })
  const replayActive = await call('POST', `/api/admin/payment-events/${seededActive.id}/replay`, A, {})
  const rowAfterActiveReplay = await db().paymentEvent.findUnique({ where: { id: seededActive.id } })
  check('replay of a payment_intent event still actively owned (claim not yet expired) is correctly refused (409)', replayActive.status === 409, JSON.stringify(replayActive))
  check('the still-actively-claimed row is completely untouched by the refused replay attempt', rowAfterActiveReplay?.processingStatus === 'APPLYING' && rowAfterActiveReplay?.attempts === 1, JSON.stringify(rowAfterActiveReplay))
}

console.log(`\n==== PAYMENT EVENT CLAIM OWNERSHIP & RECOVERY: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
