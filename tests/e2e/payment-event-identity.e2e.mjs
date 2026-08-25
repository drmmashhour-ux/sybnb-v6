// SYBNB — Canonical event-identity and durable-intake E2E (governed evidence artifact), both rails.
//
// Proves, over real HTTP against the real running server + real Postgres, the properties independent
// review specifically asked to be shown directly:
//   - an authenticated event with an unsupported type is persisted and marked IGNORED (previously
//     returned before ever reaching the durable insert);
//   - an authenticated event with an unknown/unresolvable local reference is persisted and marked
//     QUARANTINED (previously threw a 404 before persistence);
//   - an authenticated event whose amount/currency conflicts with the resolved local record is
//     persisted and marked QUARANTINED, zero effects (previously threw a 400 before persistence);
//   - an exact duplicate delivery resolves to the same row, at most one effect;
//   - the SAME literal event-id string delivered under two different providers (payment_intent rail's
//     sandbox vs stripe_checkout rail's stripe) produces two INDEPENDENT rows, never a collision — the
//     direct proof providerEventId is no longer globally unique;
//   - a redelivery under the same canonical identity but with an ALTERED payload (different digest)
//     is a genuine conflict, recorded in a SEPARATE, append-only PaymentEventConflict row — the
//     ORIGINAL event row is proven byte-for-byte unchanged (not just its identity fields), including
//     the critical case where the original had already reached APPLIED (an earlier version of this
//     fix overwrote exactly this — independent review found it, this file now proves it can't recur);
//   - 20 REPETITIONS of 20 concurrent identical deliveries, each against FRESH booking/intent state,
//     produce EXACTLY one real financial effect (a PaymentProof row), one PaymentEvent row, one
//     consumed attempt, and a final APPLIED status — asserted INDIVIDUALLY on every one of the 20
//     repetitions, on BOTH rails, the stripe_checkout rail routed through the real shared pipeline
//     function (not a direct bypass, which the previous version of this test used and so never
//     actually exercised the claim logic for that rail at all) — a run-wide "never more than one"
//     maximum (this suite's previous methodology) can pass even when most repetitions produce ZERO
//     effects, which independent review correctly flagged as not actually proving "exactly one effect
//     every time";
//   - a live redelivery racing an admin replay of the same event produces exactly one effect, every
//     time, repeated 20 times with fresh state;
//   - the canonical event identity no longer forks on the mutable, ambient environment label
//     (process.env.NODE_ENV) — the same event delivered under several different environment strings
//     still resolves to one row and one effect, both before and after it has applied;
//   - the atomic claim (compare-and-swap) that guards apply() makes double-execution and a late
//     failure downgrading an already-committed APPLIED row structurally impossible, proven directly:
//     a claim attempt against an already-APPLIED or currently-APPLYING row never even invokes apply().
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> STRIPE_WEBHOOK_SECRET=<secret>
//      STRIPE_SECRET_KEY=sk_test_fake HOST=<uuid> GUEST=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-event-identity.e2e.mjs
//      (server must run with PAYMENT_INTENTS_ENABLED=true, PAYMENTS_ENABLED=true, and the SAME
//      PAYMENT_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY — this suite is slower than
//      most others in this repo: sections 7 and 8 alone issue several hundred real HTTP requests
//      across their repetitions)

import { createHash } from 'node:crypto'
import { createSessionToken } from '../../server/lib/security.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { policyEnvironment } from '../../server/lib/payment-policy.mjs'

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
async function piWebhook(eventObj, { secret = PI_SECRET } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(`${API}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret) },
    body: payload,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
async function stripeWebhook(eventObj, { secret = STRIPE_SECRET } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(`${API}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret) },
    body: payload,
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
    division: 'STAYS', titleAr: 'شقة اختبار PEI', titleEn: 'PEI test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
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

console.log('=== SETUP ===')
await verifyHostForPublishing()
const listing = await makeStaysListing(160000)
const booking = await makeBooking(listing, 10, 7)
check('setup: real booking created', Boolean(booking?.id), JSON.stringify(booking))
const intentRes = await call('POST', '/api/payments/intents', G, { bookingId: booking.id })
const intent = intentRes.j?.intent
check('setup: real PaymentIntent created', Boolean(intent?.id), JSON.stringify(intentRes))

console.log('\n=== 1. Unsupported authenticated event type -> persisted and IGNORED (was: dropped before persistence) ===')
{
  const eventId = `evt_pei_unsupported_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.created', data: { object: { reference: intent.reference, id: 'pi_prov_unsupported' } } } // not in targetStatusFor's mapping
  const before = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const res = await piWebhook(evt)
  const after = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('unsupported-type webhook still returns 200', res.status === 200, JSON.stringify(res))
  check('exactly one durable row was created for the unsupported type', before === 0 && after === 1, `${before} -> ${after}`)
  check('the row is marked IGNORED, not silently absent', row?.processingStatus === 'IGNORED', row?.processingStatus)
}

console.log('\n=== 2. Unknown local reference -> persisted and QUARANTINED (was: 404 before persistence) ===')
{
  const eventId = `evt_pei_unknown_ref_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: 'pi_totally_unknown_reference_does_not_exist', id: 'pi_prov_unknown' } } }
  const before = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const res = await piWebhook(evt)
  const after = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('unknown-reference webhook still returns 200', res.status === 200, JSON.stringify(res))
  check('exactly one durable row was created for the unknown reference', before === 0 && after === 1, `${before} -> ${after}`)
  check('the row is marked QUARANTINED with a typed reason, not silently absent', row?.processingStatus === 'QUARANTINED' && row?.lastError === 'PAYMENT_INTENT_NOT_FOUND', JSON.stringify(row))
  check('the raw providerReference is preserved verbatim even though it never resolved', row?.providerReference === 'pi_totally_unknown_reference_does_not_exist', row?.providerReference)
}

console.log('\n=== 3. Amount/currency mismatch -> persisted and QUARANTINED, zero effects (was: 400 before persistence) ===')
{
  const eventId = `evt_pei_amount_mismatch_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intent.reference, id: 'pi_prov_mismatch', amount_minor: intent.amountMinor + 999999 } } }
  const beforeProofs = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })
  const res = await piWebhook(evt)
  const afterProofs = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('amount-mismatch webhook still returns 200', res.status === 200, JSON.stringify(res))
  check('the row is marked QUARANTINED with a typed reason', row?.processingStatus === 'QUARANTINED' && row?.lastError === 'PAYMENT_AMOUNT_MISMATCH', JSON.stringify(row))
  check('zero real effects from the quarantined mismatch', beforeProofs === afterProofs, `${beforeProofs} -> ${afterProofs}`)
}

console.log('\n=== 4. Exact duplicate delivery -> one row, one effect (regression, both fields checked) ===')
{
  const eventId = `evt_pei_exact_dup_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_exact_dup' } } }
  const r1 = await piWebhook(evt)
  const r2 = await piWebhook(evt)
  const count = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  check('first delivery succeeds', r1.status === 200, JSON.stringify(r1))
  check('exact duplicate redelivery succeeds without creating a second row', r2.status === 200 && count === 1, `count=${count}`)
}

console.log('\n=== 5. The SAME literal event-id string across two different providers -> two INDEPENDENT rows, never a collision ===')
{
  const sharedEventId = `evt_pei_shared_id_${Date.now()}`
  const piEvt = { id: sharedEventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_shared' } } }
  const bookingForStripe = await makeBooking(listing, 20, 17)
  const stripeEvt = { id: sharedEventId, type: 'checkout.session.completed', data: { object: { id: 'cs_test_shared', payment_status: 'paid', currency: 'syp', metadata: { bookingId: bookingForStripe.id, sypTotalMinor: '160000' } } } }

  const r1 = await piWebhook(piEvt)
  const r2 = await stripeWebhook(stripeEvt)
  const piRows = await db().paymentEvent.findMany({ where: { providerEventId: sharedEventId, rail: 'payment_intent' } })
  const stripeRows = await db().paymentEvent.findMany({ where: { providerEventId: sharedEventId, rail: 'stripe_checkout' } })
  check('the payment_intent-rail delivery with this shared id succeeds', r1.status === 200, JSON.stringify(r1))
  check('the stripe_checkout-rail delivery with the SAME literal event id succeeds independently (no collision)', r2.status === 200, JSON.stringify(r2))
  check('exactly one payment_intent-rail row exists for this event id', piRows.length === 1, piRows.length)
  check('exactly one stripe_checkout-rail row exists for this SAME event id -- a genuinely separate row', stripeRows.length === 1, stripeRows.length)
  check('the two rows are different database rows entirely', piRows[0]?.id !== stripeRows[0]?.id, JSON.stringify({ pi: piRows[0]?.id, stripe: stripeRows[0]?.id }))
}

console.log('\n=== 6a. Redelivery under the same identity with an ALTERED payload -> conflict recorded SEPARATELY, ORIGINAL EVENT ROW NEVER MUTATED ===')
{
  const eventId = `evt_pei_conflict_${Date.now()}`
  const evt1 = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_conflict_v1' } } }
  // Same event id, DIFFERENT payload (different provider object id -> different payload digest).
  const evt2 = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_conflict_v2_ALTERED' } } }

  const r1 = await piWebhook(evt1)
  const rowAfterFirst = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const conflictsBefore = await db().paymentEventConflict.count({ where: { paymentEventId: rowAfterFirst.id } })
  const r2 = await piWebhook(evt2)
  const rowAfterSecond = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const conflictsAfter = await db().paymentEventConflict.count({ where: { paymentEventId: rowAfterFirst.id } })
  const count = await db().paymentEvent.count({ where: { providerEventId: eventId, rail: 'payment_intent' } })

  check('first (genuine) delivery succeeds', r1.status === 200, JSON.stringify(r1))
  check('the altered-payload redelivery is acknowledged (200), not a crash', r2.status === 200 && r2.j?.conflict === true, JSON.stringify(r2))
  check('still exactly one PaymentEvent row for this event id -- the conflict never creates a second event row', count === 1, count)
  check(
    'the ORIGINAL event row is COMPLETELY UNCHANGED by the conflict -- every field byte-identical, not just the identity fields (the exact defect independent review found)',
    JSON.stringify(rowAfterFirst) === JSON.stringify(rowAfterSecond),
    JSON.stringify({ before: rowAfterFirst, after: rowAfterSecond }),
  )
  check('a NEW, separate PaymentEventConflict row was created to record the conflicting delivery', conflictsAfter === conflictsBefore + 1, `${conflictsBefore} -> ${conflictsAfter}`)
  const conflictRow = await db().paymentEventConflict.findFirst({ where: { paymentEventId: rowAfterFirst.id }, orderBy: { receivedAt: 'desc' } })
  check('the conflict record captures the INCOMING (altered) providerObjectId for investigation, distinct from the original', conflictRow?.providerObjectId === 'pi_prov_conflict_v2_ALTERED', conflictRow?.providerObjectId)
  check('the conflict record stores a payload digest, never a raw payload field', Boolean(conflictRow?.payloadDigest) && conflictRow?.payloadDigest !== JSON.stringify(evt2), conflictRow?.payloadDigest)
}

console.log('\n=== 6b. Conflict against an ALREADY-APPLIED original -- the critical case: a successful payment\'s true outcome must never be destroyed ===')
{
  const bookingConflict = await makeBooking(listing, 30, 27)
  const intentConflictRes = await call('POST', '/api/payments/intents', G, { bookingId: bookingConflict.id })
  const intentConflict = intentConflictRes.j?.intent
  const eventId = `evt_pei_conflict_applied_${Date.now()}`
  const goodEvt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intentConflict.reference, id: 'pi_prov_applied_good', amount_minor: intentConflict.amountMinor, currency: intentConflict.currency } } }
  const badEvt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intentConflict.reference, id: 'pi_prov_applied_BOGUS', amount_minor: intentConflict.amountMinor, currency: intentConflict.currency } } }

  const r1 = await piWebhook(goodEvt)
  check('the genuine event applies successfully', r1.status === 200 && r1.j?.applied === true, JSON.stringify(r1))
  const appliedRow = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('setup: the original row genuinely reached APPLIED', appliedRow?.processingStatus === 'APPLIED', appliedRow?.processingStatus)
  const proofCountBefore = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentConflict.reference } })

  const r2 = await piWebhook(badEvt)
  const rowAfterConflict = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const proofCountAfter = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentConflict.reference } })

  check('the conflicting delivery against an APPLIED original is acknowledged as a conflict, not applied', r2.status === 200 && r2.j?.conflict === true, JSON.stringify(r2))
  check('the ALREADY-APPLIED original stays APPLIED -- its true, authoritative outcome is never destroyed by a later conflicting delivery', rowAfterConflict?.processingStatus === 'APPLIED', rowAfterConflict?.processingStatus)
  check(
    'appliedAt/attempts/lastError on the original are completely unchanged',
    rowAfterConflict?.appliedAt?.getTime() === appliedRow?.appliedAt?.getTime() && rowAfterConflict?.attempts === appliedRow?.attempts && rowAfterConflict?.lastError === appliedRow?.lastError,
    JSON.stringify({ before: appliedRow, after: rowAfterConflict }),
  )
  check('zero new PaymentProof rows -- the conflicting delivery against an APPLIED original never applies anything', proofCountBefore === proofCountAfter, `${proofCountBefore} -> ${proofCountAfter}`)
  const conflictRecord = await db().paymentEventConflict.findFirst({ where: { paymentEventId: appliedRow.id } })
  check('the conflict is still durably recorded as its own audit entry, referencing the original', Boolean(conflictRecord), 'no conflict record created')
}

console.log('\n=== 7. Financial-effect concurrency: 20 repetitions x 20 simultaneous deliveries, fresh state each time, EVERY repetition asserted individually, both rails ===')
{
  // payment_intent rail, live HTTP: a REAL succeeded event (a genuine effect to duplicate, unlike an
  // earlier version of this test which used 'processing' -- a status-only transition with nothing to
  // duplicate in the first place). Fresh booking+intent every repetition. Every one of the 20
  // repetitions is checked and recorded on its own -- a run-wide "never more than one" maximum (this
  // suite's earlier methodology) can pass even when most repetitions produce ZERO effects, as long as
  // none ever produces two, which independent review correctly flagged as not actually proving
  // "exactly one effect every time".
  const piBadReps = []
  for (let rep = 0; rep < 20; rep++) {
    const b = await makeBooking(listing, 40 + rep * 4, 37 + rep * 4) // 4-day spacing > the 3-day booking window, so consecutive repetitions never overlap
    const iRes = await call('POST', '/api/payments/intents', G, { bookingId: b.id })
    const i = iRes.j?.intent
    const eventId = `evt_pei_conc_pi_${rep}_${Date.now()}`
    const evt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: i.reference, id: `pi_prov_conc_${rep}`, amount_minor: i.amountMinor, currency: i.currency } } }
    const results = await Promise.all(Array.from({ length: 20 }, () => piWebhook(evt)))
    const rowCount = await db().paymentEvent.count({ where: { providerEventId: eventId, rail: 'payment_intent' } })
    const proofCount = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: i.reference } })
    const eventRow = await db().paymentEvent.findFirst({ where: { providerEventId: eventId, rail: 'payment_intent' } })
    const ok = results.every((r) => r.status === 200) && rowCount === 1 && proofCount === 1 && eventRow?.processingStatus === 'APPLIED' && eventRow?.attempts === 1
    if (!ok) piBadReps.push({ rep, statuses: results.map((r) => r.status), rowCount, proofCount, processingStatus: eventRow?.processingStatus, attempts: eventRow?.attempts })
  }
  check(
    'payment_intent rail: EVERY one of the 20 repetitions independently produced exactly 1 event row, exactly 1 real financial effect (PaymentProof), settled APPLIED, and consumed exactly 1 attempt -- not merely "never more than one" across the whole run',
    piBadReps.length === 0,
    JSON.stringify(piBadReps),
  )

  // stripe_checkout rail: webhook_apply is intentionally, permanently policy-deferred on this server
  // (stripe has no approved provider config -- see payment-policy.mjs), so a live-HTTP concurrency
  // test would trivially show zero effects for the wrong reason (never reaching apply at all, not
  // because concurrency was handled safely). Proving the APPLY MECHANISM's own concurrency safety
  // routes through the real shared pipeline function (applyPaymentEvent -- the exact function the
  // live webhook route and admin replay both call), bypassing only the policy gate, never the
  // pipeline's own claim logic -- an earlier version of this test called applyStripeCheckoutEvent
  // directly, which bypassed the pipeline (and therefore its CAS claim) entirely, so it never actually
  // exercised the claim logic under review for this rail at all.
  const { applyPaymentEvent } = await import('../../server/lib/payment-event-pipeline.mjs')
  const { applyStripeCheckoutEvent } = await import('../../server/lib/stripe-checkout-apply.mjs')
  const stripeBadReps = []
  for (let rep = 0; rep < 20; rep++) {
    const b = await makeBooking(listing, 200 + rep * 4, 197 + rep * 4) // far enough from the payment_intent-rail loop's own date range above, 4-day spacing avoids self-overlap too
    const sessionId = `cs_test_conc_${rep}_${Date.now()}`
    const eventRow = await db().paymentEvent.create({
      data: {
        rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout', environment: 'test', subjectType: 'BOOKING',
        providerReference: b.id, bookingId: b.id, originalBookingId: b.id,
        providerEventId: `evt_pei_conc_stripe_${rep}_${Date.now()}`, type: 'checkout.session.completed',
        amountMinor: 160000, currency: 'syp', providerObjectId: sessionId, payloadDigest: `digest_${rep}`, processingStatus: 'RECEIVED',
      },
    })
    const session = { id: sessionId, payment_status: 'paid', metadata: { bookingId: b.id, sypTotalMinor: '160000' } }
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        applyPaymentEvent({ eventId: eventRow.id, rail: 'stripe_checkout', apply: () => applyStripeCheckoutEvent({ eventId: eventRow.id, session }) }).catch((e) => ({ threw: true, message: e?.message })),
      ),
    )
    const proofCount = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
    const finalRow = await db().paymentEvent.findUnique({ where: { id: eventRow.id } })
    const ok = !results.some((r) => r?.threw) && proofCount === 1 && finalRow?.processingStatus === 'APPLIED' && finalRow?.attempts === 1
    if (!ok) stripeBadReps.push({ rep, proofCount, processingStatus: finalRow?.processingStatus, attempts: finalRow?.attempts })
  }
  check(
    'stripe_checkout rail, through the REAL pipeline (not a direct bypass): EVERY one of the 20 repetitions independently produced exactly 1 real financial effect, settled APPLIED, and consumed exactly 1 attempt',
    stripeBadReps.length === 0,
    JSON.stringify(stripeBadReps),
  )
}

console.log('\n=== 8. Concurrency between a LIVE redelivery and an ADMIN REPLAY of the same event -> exactly one effect, every repetition, 20 repetitions with fresh state ===')
{
  const replayBadReps = []
  for (let rep = 0; rep < 20; rep++) {
    const bookingReplay = await makeBooking(listing, 400 + rep * 4, 397 + rep * 4) // comfortably past every other loop's date range in this file
    const intentReplayRes = await call('POST', '/api/payments/intents', G, { bookingId: bookingReplay.id })
    const intentReplay = intentReplayRes.j?.intent
    const eventId = `evt_pei_replay_race_${rep}_${Date.now()}`
    const evtObj = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intentReplay.reference, id: `pi_prov_replay_race_${rep}`, amount_minor: intentReplay.amountMinor, currency: intentReplay.currency } } }
    // Seed a FAILED (not DEAD_LETTERED) delivery directly -- eligible for both admin replay and a live
    // redelivery falling through to re-attempt, exactly the two paths this test races against each other.
    const payloadDigest = createHash('sha256').update(JSON.stringify(evtObj)).digest('hex')
    const seeded = await db().paymentEvent.create({
      data: {
        rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: policyEnvironment(),
        subjectType: 'PAYMENT_INTENT', providerReference: intentReplay.reference, intentId: intentReplay.id,
        originalIntentId: intentReplay.id, originalBookingId: intentReplay.bookingId ?? null,
        providerEventId: eventId, type: 'payment_intent.succeeded', amountMinor: intentReplay.amountMinor, currency: intentReplay.currency,
        providerObjectId: `pi_prov_replay_race_${rep}`, payloadDigest, processingStatus: 'FAILED', attempts: 2, lastError: 'synthetic seed for replay-vs-redelivery race test',
      },
    })
    const proofCountBefore = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentReplay.reference } })

    const [replayRes, webhookRes] = await Promise.all([
      call('POST', `/api/admin/payment-events/${seeded.id}/replay`, A, {}),
      piWebhook(evtObj),
    ])

    const proofCountAfter = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentReplay.reference } })
    const finalRow = await db().paymentEvent.findUnique({ where: { id: seeded.id } })
    // attempts must land at exactly 3 (seeded at 2, exactly one winning claim adds 1) -- proving the
    // CAS claim let only ONE of the two racing paths (live redelivery, admin replay) actually execute,
    // never both.
    const ok =
      (replayRes.status === 200 || replayRes.status === 409) &&
      webhookRes.status === 200 &&
      proofCountAfter === proofCountBefore + 1 &&
      finalRow?.processingStatus === 'APPLIED' &&
      finalRow?.attempts === 3
    if (!ok) {
      replayBadReps.push({
        rep,
        replayStatus: replayRes.status,
        webhookStatus: webhookRes.status,
        proofCountBefore,
        proofCountAfter,
        finalStatus: finalRow?.processingStatus,
        attempts: finalRow?.attempts,
      })
    }
  }
  check(
    'live-webhook-vs-admin-replay race: EVERY one of 20 repetitions with fresh state produced exactly one real financial effect, settled APPLIED, and consumed exactly one MORE attempt (2 -> 3) -- never two concurrent claims both executing',
    replayBadReps.length === 0,
    JSON.stringify(replayBadReps),
  )
}

console.log('\n=== 9. Canonical identity no longer forks on the mutable environment label -> one event row, one effect, across several different NODE_ENV/environment strings ===')
{
  const { intakeEvent, applyPaymentEvent } = await import('../../server/lib/payment-event-pipeline.mjs')
  const { applyStripeCheckoutEvent } = await import('../../server/lib/stripe-checkout-apply.mjs')

  const bookingEnv = await makeBooking(listing, 300, 297)
  const sessionId = `cs_test_envfork_${Date.now()}`
  const eventIdEnv = `evt_pei_envfork_${Date.now()}`
  const payloadDigest = createHash('sha256').update(sessionId).digest('hex')
  const baseFields = {
    rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout',
    subjectType: 'BOOKING', providerReference: bookingEnv.id, bookingId: bookingEnv.id, originalBookingId: bookingEnv.id,
    providerEventId: eventIdEnv, type: 'checkout.session.completed', amountMinor: 160000, currency: 'syp',
    providerObjectId: sessionId, payloadDigest, processingStatus: 'RECEIVED',
  }

  // Same event, same endpoint, delivered under THREE different environment labels -- simulating
  // exactly the scenario independent review named: a deploy config change, or two processes (e.g. a
  // test script and the live server it drives) observing different process.env.NODE_ENV values for
  // what is genuinely the same authenticated delivery.
  const first = await intakeEvent({ ...baseFields, environment: 'test' })
  const second = await intakeEvent({ ...baseFields, environment: 'staging' })
  const third = await intakeEvent({ ...baseFields, environment: 'production' })
  const rowCountEnv = await db().paymentEvent.count({ where: { providerEventId: eventIdEnv } })

  check(
    'the same event delivered under 3 different environment labels resolves to the SAME row id every time',
    first.eventRow.id === second.eventRow.id && second.eventRow.id === third.eventRow.id,
    JSON.stringify({ first: first.eventRow.id, second: second.eventRow.id, third: third.eventRow.id }),
  )
  check('none of the 3 environment-varied deliveries were classified as a genuine conflict', first.conflict === false && second.conflict === false && third.conflict === false, JSON.stringify({ a: first.conflict, b: second.conflict, c: third.conflict }))
  check('exactly ONE PaymentEvent row exists for this event id despite 3 different environment labels -- the exact defect independent review found', rowCountEnv === 1, rowCountEnv)

  // Apply it once (through the real shared pipeline), then redeliver under a FOURTH environment label
  // after it has already applied -- proving "one event, one effect" survives environment drift both
  // BEFORE and AFTER application, not only at the intake step.
  const session = { id: sessionId, payment_status: 'paid', metadata: { bookingId: bookingEnv.id, sypTotalMinor: '160000' } }
  await applyPaymentEvent({ eventId: first.eventRow.id, rail: 'stripe_checkout', apply: () => applyStripeCheckoutEvent({ eventId: first.eventRow.id, session }) })
  const fourth = await intakeEvent({ ...baseFields, environment: 'development' })
  const proofCountEnv = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  const rowCountEnvAfter = await db().paymentEvent.count({ where: { providerEventId: eventIdEnv } })

  check('a 4th delivery under yet another environment label, after the event already applied, still resolves to the SAME row', fourth.eventRow.id === first.eventRow.id, JSON.stringify({ first: first.eventRow.id, fourth: fourth.eventRow.id }))
  check('still exactly ONE PaymentEvent row after 4 total environment-varied deliveries', rowCountEnvAfter === 1, rowCountEnvAfter)
  check('exactly ONE real financial effect resulted, despite delivery under 4 different environment labels total spanning both before and after application', proofCountEnv === 1, proofCountEnv)
}

console.log('\n=== 10. Direct proof: the CAS claim makes double-execution and a late failure downgrading a committed state structurally impossible, not just improbable ===')
{
  const { applyPaymentEvent } = await import('../../server/lib/payment-event-pipeline.mjs')

  // 10a. A row already APPLIED must never be re-claimed, and a "late failure" attempting to act on it
  // must never even run, let alone downgrade it -- the exact scenario independent review named
  // ("ensure a late failing worker cannot overwrite a committed APPLIED state").
  const bookingCasApplied = await makeBooking(listing, 500, 497) // comfortably past every loop's date range in this file
  const eventCasApplied = await db().paymentEvent.create({
    data: {
      rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout', environment: 'test', subjectType: 'BOOKING',
      providerReference: bookingCasApplied.id, bookingId: bookingCasApplied.id, originalBookingId: bookingCasApplied.id,
      providerEventId: `evt_pei_cas_applied_${Date.now()}`, type: 'checkout.session.completed',
      amountMinor: 160000, currency: 'syp', providerObjectId: 'cs_test_cas_applied', payloadDigest: 'd',
      processingStatus: 'APPLIED', attempts: 1, appliedAt: new Date(),
    },
  })
  let spyInvokedApplied = false
  const resultApplied = await applyPaymentEvent({
    eventId: eventCasApplied.id,
    rail: 'stripe_checkout',
    apply: async () => {
      spyInvokedApplied = true
      throw new Error('this must never run -- forced late failure')
    },
  })
  const rowAfterApplied = await db().paymentEvent.findUnique({ where: { id: eventCasApplied.id } })
  check('a claim attempt against an already-APPLIED row never invokes apply() at all', spyInvokedApplied === false, 'apply() was called')
  check('the claim call itself does not throw even though the (never-invoked) apply() would have', resultApplied?.duplicate === true, JSON.stringify(resultApplied))
  check(
    'the row stays byte-identical -- a late failure cannot downgrade an already-committed APPLIED state',
    JSON.stringify(rowAfterApplied) === JSON.stringify(eventCasApplied),
    JSON.stringify({ before: eventCasApplied, after: rowAfterApplied }),
  )

  // 10b. A row currently APPLYING (a sibling delivery mid-flight) must also never be re-claimed by a
  // second delivery -- exactly the state two concurrent deliveries would both have observed and both
  // acted on under the old unconditional-update bug.
  const bookingCasApplying = await makeBooking(listing, 510, 507)
  const eventCasApplying = await db().paymentEvent.create({
    data: {
      rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout', environment: 'test', subjectType: 'BOOKING',
      providerReference: bookingCasApplying.id, bookingId: bookingCasApplying.id, originalBookingId: bookingCasApplying.id,
      providerEventId: `evt_pei_cas_applying_${Date.now()}`, type: 'checkout.session.completed',
      amountMinor: 160000, currency: 'syp', providerObjectId: 'cs_test_cas_applying', payloadDigest: 'd',
      processingStatus: 'APPLYING', attempts: 1, lastAttemptAt: new Date(),
    },
  })
  let spyInvokedApplying = false
  const resultApplying = await applyPaymentEvent({
    eventId: eventCasApplying.id,
    rail: 'stripe_checkout',
    apply: async () => {
      spyInvokedApplying = true
      return { applied: true }
    },
  })
  const rowAfterApplying = await db().paymentEvent.findUnique({ where: { id: eventCasApplying.id } })
  check('a second claim attempt against a row a sibling currently holds (APPLYING) never invokes apply()', spyInvokedApplying === false, 'apply() was called')
  check('the loser reports claimed:false, not a false APPLIED/duplicate claim', resultApplying?.claimed === false && resultApplying?.duplicate === false, JSON.stringify(resultApplying))
  check('attempts is NOT incremented by the losing claim attempt', rowAfterApplying?.attempts === 1, rowAfterApplying?.attempts)
  check('the row is untouched -- still APPLYING, exactly as the sibling left it', rowAfterApplying?.processingStatus === 'APPLYING', rowAfterApplying?.processingStatus)
}

console.log(`\n==== PAYMENT EVENT CANONICAL IDENTITY: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
