// SYBNB — PaymentIntent booking/wallet wiring E2E (governed evidence artifact)
//
// Proves the electronic PaymentIntent system, wired into the real booking/wallet flow, behaves
// correctly end-to-end: authoritative amount derivation (never trusts a client-supplied amount),
// booking ownership/state validation, success -> real booking confirmation + wallet HOLD/CREDIT
// (matching bookingFinanceSplit), refund wallet reconciliation (NO double-credit to the guest —
// the card network already returned their money), durable event/attempt history, dead-letter
// gating (a dead-lettered event is not silently reprocessed on provider redelivery), admin replay
// (ADMIN-only, audit-logged, re-derives real effects from stored data), and the reconciliation
// views. Also regression-tests the admin dispute-rejection clawback path (server/routes/admin.mjs),
// since this change refactors it to share reverseBookingPlatformShare() with the new PaymentIntent
// refund path — that branch previously had zero e2e coverage.
//
// NO real money, NO live provider — signatures are minted with a sandbox test secret. Requires the
// server to run with PAYMENT_INTENTS_ENABLED=true (this system is otherwise fully disabled).
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> HOST=<uuid> GUEST=<uuid> OTHER=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-intents-booking.e2e.mjs   (server must run with PAYMENT_INTENTS_ENABLED=true
//      and the SAME PAYMENT_WEBHOOK_SECRET)

import { createSessionToken } from '../../server/lib/security.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { expectedTotalMinor, bookingFinanceSplit } from '../../server/lib/finance-ledger.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_sandbox_test'

const host = { id: process.env.HOST }
const guest = { id: process.env.GUEST }
const other = { id: process.env.OTHER }
const admin = { id: process.env.ADMIN }
if (!host.id || !guest.id || !other.id || !admin.id) {
  console.error('Missing HOST/GUEST/OTHER/ADMIN env')
  process.exit(2)
}
const H = createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
const G = createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })
const O = createSessionToken({ id: other.id, roles: [{ role: 'SELLER' }] })
const A = createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })

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
  let j
  const text = await res.text()
  try {
    j = JSON.parse(text)
  } catch {
    j = { raw: text }
  }
  return { status: res.status, j }
}
async function webhook(eventObj, { secret = SECRET, timestamp } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(API + '/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret, timestamp) },
    body: payload,
  })
  let j
  const t = await res.text()
  try {
    j = JSON.parse(t)
  } catch {
    j = { raw: t }
  }
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code
let evtSeq = 0
const evt = (type, ref, extra = {}) => ({ id: `evt_pib_${Date.now()}_${evtSeq++}`, type, data: { object: { reference: ref, id: `pi_prov_${evtSeq}`, ...extra } } })
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
    division: 'STAYS',
    titleAr: 'شقة اختبار PIB',
    titleEn: 'PIB test flat',
    priceMinor,
    currency: 'SYP',
    instantBookEnabled: true,
  })
  const id = created.j?.listing?.id
  await call('PATCH', `/api/listings/${id}/submit`, H)
  const approved = await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return { id, status: approved.j?.entity?.status }
}

async function makeBooking(listingId, checkInDaysAgo, checkOutDaysAgo) {
  const created = await call('POST', '/api/bookings', G, {
    listingId,
    checkIn: daysAgoIso(checkInDaysAgo),
    checkOut: daysAgoIso(checkOutDaysAgo),
  })
  return created.j?.booking
}

async function walletEntries(referenceId, referenceTypes) {
  return db().walletEntry.findMany({ where: { referenceId, referenceType: { in: referenceTypes } } })
}

console.log('=== SETUP: host publish gate + APPROVED instant-book STAYS listing ===')
await verifyHostForPublishing()
const listing = await makeStaysListing(200000)
check('listing reached APPROVED', listing.status === 'APPROVED', listing.status)

console.log('\n=== A. CREATION-TIME VALIDATION (booking-linked intent) ===')
const bookingA = await makeBooking(listing.id, 5, 3)
check('booking A created PAYMENT_PENDING', bookingA?.status === 'PAYMENT_PENDING', bookingA?.status)

const bookingAFull = (await call('GET', `/api/bookings/${bookingA.id}`, G)).j?.booking
const expectedA = expectedTotalMinor(bookingAFull)

const wrongAmount = await call('POST', '/api/payments/intents', G, { bookingId: bookingA.id, amountMinor: 1, currency: 'usd' })
check(
  'creation derives amountMinor from expectedTotalMinor, ignoring client-supplied amount',
  wrongAmount.status === 201 && wrongAmount.j?.intent?.amountMinor === expectedA && wrongAmount.j?.intent?.amountMinor !== 1,
  JSON.stringify(wrongAmount.j),
)
check('creation derives currency from the booking, ignoring client-supplied currency', wrongAmount.j?.intent?.currency === bookingAFull.currency.toLowerCase(), wrongAmount.j?.intent?.currency)
const intentA = wrongAmount.j?.intent

check(
  'a stranger cannot create an intent for someone else\'s booking (403 FORBIDDEN)',
  code(await call('POST', '/api/payments/intents', O, { bookingId: bookingA.id })) === 'PAYMENT_INTENT_BOOKING_FORBIDDEN',
  'accepted',
)
check(
  'a second active intent for the same booking is rejected (409 ALREADY_ACTIVE)',
  code(await call('POST', '/api/payments/intents', G, { bookingId: bookingA.id })) === 'PAYMENT_INTENT_ALREADY_ACTIVE_FOR_BOOKING',
  'accepted',
)

console.log('\n=== B. SUCCESS -> REAL BOOKING CONFIRMATION + WALLET EFFECTS ===')
const succA = evt('payment_intent.succeeded', intentA.reference, { amount_minor: intentA.amountMinor, currency: intentA.currency })
const succA1 = await webhook(succA)
check('signed success webhook applies -> SUCCEEDED', succA1.status === 200 && succA1.j?.applied === true && succA1.j?.status === 'SUCCEEDED', JSON.stringify(succA1.j))

const bookingAAfter = (await call('GET', `/api/bookings/${bookingA.id}`, G)).j?.booking
check('instant-book listing -> booking CONFIRMED on success', bookingAAfter?.status === 'CONFIRMED', bookingAAfter?.status)

const splitA = bookingFinanceSplit(bookingAFull, expectedA)
const entriesA1 = await walletEntries(bookingA.id, ['booking_payout', 'booking_admin_share'])
const holdA = entriesA1.find((e) => e.referenceType === 'booking_payout' && e.type === 'HOLD')
const shareA = entriesA1.find((e) => e.referenceType === 'booking_admin_share' && e.type === 'CREDIT')
check('host payout HOLD recorded matching bookingFinanceSplit', holdA?.amountMinor === splitA.hostGrossMinor, JSON.stringify({ hold: holdA, expected: splitA.hostGrossMinor }))
check('admin share CREDIT recorded matching bookingFinanceSplit', shareA?.amountMinor === splitA.adminShareMinor, JSON.stringify({ share: shareA, expected: splitA.adminShareMinor }))

const succA2 = await webhook(succA) // same event id redelivered
check('duplicate delivery is a no-op (idempotent)', succA2.j?.duplicate === true, JSON.stringify(succA2.j))
const entriesA2 = await walletEntries(bookingA.id, ['booking_payout', 'booking_admin_share'])
check('redelivery did not double-apply wallet effects', entriesA2.length === entriesA1.length, `${entriesA2.length} vs ${entriesA1.length}`)

const detailA = await call('GET', `/api/payments/intents/${intentA.id}`, G)
check('reconciliation: healthy intent has no drift', detailA.j?.reconciliation?.reconciled === true && detailA.j?.reconciliation?.driftReasons?.length === 0, JSON.stringify(detailA.j?.reconciliation))
check('reconciliation view includes the linked proof/booking', detailA.j?.proof?.status === 'APPROVED' && detailA.j?.booking?.status === 'CONFIRMED', JSON.stringify({ proof: detailA.j?.proof, booking: detailA.j?.booking }))

check(
  'a non-PAYMENT_PENDING booking cannot get a new intent (409 NOT_PAYABLE)',
  code(await call('POST', '/api/payments/intents', G, { bookingId: bookingA.id })) === 'PAYMENT_INTENT_BOOKING_NOT_PAYABLE',
  'accepted',
)

console.log('\n=== C. REFUND: reverses platform share + host clawback-if-released, NEVER credits the guest wallet ===')
const bookingB = await makeBooking(listing.id, 30, 25) // old dates -> immediately payout-eligible once COMPLETED
const bookingBFull = (await call('GET', `/api/bookings/${bookingB.id}`, G)).j?.booking
const expectedB = expectedTotalMinor(bookingBFull)
const intentB = (await call('POST', '/api/payments/intents', G, { bookingId: bookingB.id })).j?.intent
const succB = evt('payment_intent.succeeded', intentB.reference, { amount_minor: intentB.amountMinor, currency: intentB.currency })
await webhook(succB)
const bookingBConfirmed = (await call('GET', `/api/bookings/${bookingB.id}`, G)).j?.booking
check('booking B confirmed before refund scenario', bookingBConfirmed?.status === 'CONFIRMED', bookingBConfirmed?.status)

await call('GET', '/api/admin/payouts', A) // side effect: completeExpiredBookings() flips expired CONFIRMED -> COMPLETED
const bookingBCompleted = (await call('GET', `/api/bookings/${bookingB.id}`, G)).j?.booking
check('booking B auto-completed (checkout in the past)', bookingBCompleted?.status === 'COMPLETED', bookingBCompleted?.status)

const release = await call('PATCH', `/api/admin/payouts/${bookingB.id}/release`, A)
check('payout released before the refund arrives', release.status === 200 && release.j?.walletEntry?.type === 'RELEASE', JSON.stringify(release.j))

const preRefundGuestRefunds = await walletEntries(bookingB.id, ['booking_refund'])
const refundB = evt('charge.refunded', intentB.reference, { amount_minor: intentB.amountMinor })
const refundB1 = await webhook(refundB)
check('refund webhook applies -> REFUNDED', refundB1.status === 200 && refundB1.j?.applied === true && refundB1.j?.status === 'REFUNDED', JSON.stringify(refundB1.j))

const detailB = await call('GET', `/api/payments/intents/${intentB.id}`, G)
check('linked PaymentProof marked REFUNDED', detailB.j?.proof?.status === 'REFUNDED', JSON.stringify(detailB.j?.proof))

const splitB = bookingFinanceSplit(bookingBFull, expectedB)
const reversalB = (await walletEntries(bookingB.id, ['booking_admin_share_reversal'])).find((e) => e.type === 'DEBIT')
check('admin-share reversal DEBIT recorded on refund', reversalB?.amountMinor === splitB.adminShareMinor, JSON.stringify({ reversalB, expected: splitB.adminShareMinor }))
const clawbackB = (await walletEntries(bookingB.id, ['booking_payout_clawback'])).find((e) => e.type === 'DEBIT')
check('host payout clawback DEBIT recorded (payout was already released)', clawbackB?.amountMinor === splitB.hostGrossMinor, JSON.stringify({ clawbackB, expected: splitB.hostGrossMinor }))

const postRefundGuestRefunds = await walletEntries(bookingB.id, ['booking_refund'])
check(
  'guest wallet NOT credited on a card refund (card network already returned the funds)',
  postRefundGuestRefunds.length === preRefundGuestRefunds.length,
  `${postRefundGuestRefunds.length} vs ${preRefundGuestRefunds.length}`,
)

console.log('\n=== D. DEAD-LETTER + ADMIN REPLAY ===')
const bookingC = await makeBooking(listing.id, 5, 3)
const intentC = (await call('POST', '/api/payments/intents', G, { bookingId: bookingC.id })).j?.intent

// Seed a synthetic DEAD_LETTERED delivery directly (simulating an event that already failed 5 real
// attempts, e.g. a transient DB blip during those windows) — the underlying booking/business data
// is entirely valid, so replay is expected to genuinely succeed once retried.
const seededEventId = `evt_pib_seed_dl_${Date.now()}`
const seeded = await db().paymentEvent.create({
  data: {
    intentId: intentC.id,
    providerEventId: seededEventId,
    type: 'payment_intent.succeeded',
    amountMinor: intentC.amountMinor,
    currency: intentC.currency,
    providerObjectId: `pi_prov_seed_${Date.now()}`,
    processingStatus: 'DEAD_LETTERED',
    attempts: 5,
    lastAttemptAt: new Date(),
    lastError: '{"code":"SIMULATED_TEST_FAILURE","statusCode":500,"message":"internal error"}',
  },
})

const deadEventObj = { id: seededEventId, type: 'payment_intent.succeeded', data: { object: { reference: intentC.reference, id: `pi_prov_seed`, amount_minor: intentC.amountMinor, currency: intentC.currency } } }
const redeliverDead = await webhook(deadEventObj)
check('redelivering an already DEAD_LETTERED event is a safe no-op, not reprocessed', redeliverDead.status === 200 && redeliverDead.j?.deadLettered === true, JSON.stringify(redeliverDead.j))
const seededAfterRedelivery = await db().paymentEvent.findUnique({ where: { id: seeded.id } })
check('dead-lettered event unchanged by the redelivery (attempts/status untouched)', seededAfterRedelivery.processingStatus === 'DEAD_LETTERED' && seededAfterRedelivery.attempts === 5, JSON.stringify(seededAfterRedelivery))

const detailCBefore = await call('GET', `/api/payments/intents/${intentC.id}`, G)
check('reconciliation flags the dead-lettered intent as drifted', detailCBefore.j?.reconciliation?.driftReasons?.includes('LATEST_EVENT_NOT_APPLIED'), JSON.stringify(detailCBefore.j?.reconciliation))

const reconciliationList = await call('GET', '/api/admin/payment-intents/reconciliation', A)
check(
  'admin-wide reconciliation lists the dead-lettered event',
  reconciliationList.status === 200 && reconciliationList.j?.deadLettered?.some((e) => e.eventId === seeded.id),
  JSON.stringify(reconciliationList.j?.deadLettered),
)
check('non-ADMIN/SUPPORT cannot list admin reconciliation', (await call('GET', '/api/admin/payment-intents/reconciliation', G)).status === 403, 'accepted')

check('non-ADMIN cannot replay an event (403)', (await call('POST', `/api/admin/payment-events/${seeded.id}/replay`, O)).status === 403, 'accepted')

const replay = await call('POST', `/api/admin/payment-events/${seeded.id}/replay`, A)
check('admin replay of a dead-lettered event, once the underlying data is valid, genuinely succeeds', replay.status === 200 && replay.j?.result?.applied === true && replay.j?.result?.status === 'SUCCEEDED', JSON.stringify(replay.j))

const bookingCAfter = (await call('GET', `/api/bookings/${bookingC.id}`, G)).j?.booking
check('replay produced the real booking/wallet effect (booking CONFIRMED)', bookingCAfter?.status === 'CONFIRMED', bookingCAfter?.status)
const entriesC = await walletEntries(bookingC.id, ['booking_payout', 'booking_admin_share'])
check('replay produced real wallet HOLD/CREDIT entries', entriesC.some((e) => e.referenceType === 'booking_payout' && e.type === 'HOLD') && entriesC.some((e) => e.referenceType === 'booking_admin_share' && e.type === 'CREDIT'), JSON.stringify(entriesC))

const replayAudit = await db().adminAuditLog.findFirst({ where: { entityType: 'payment_event', entityId: seeded.id, action: 'ADMIN_PAYMENT_EVENT_REPLAYED' } })
check(
  'replay is audit-logged (before DEAD_LETTERED -> after APPLIED)',
  replayAudit?.before?.processingStatus === 'DEAD_LETTERED' && replayAudit?.after?.processingStatus === 'APPLIED',
  JSON.stringify(replayAudit),
)

check(
  'replaying an already-APPLIED event is rejected (409 NOT_REPLAYABLE)',
  code(await call('POST', `/api/admin/payment-events/${seeded.id}/replay`, A)) === 'PAYMENT_EVENT_NOT_REPLAYABLE',
  'accepted',
)

const detailCAfter = await call('GET', `/api/payments/intents/${intentC.id}`, G)
check('reconciliation clean after successful replay', detailCAfter.j?.reconciliation?.reconciled === true, JSON.stringify(detailCAfter.j?.reconciliation))

console.log('\n=== E. ADMIN DISPUTE-REJECTION CLAWBACK REGRESSION (refactored to share reverseBookingPlatformShare) ===')
const bookingD = await makeBooking(listing.id, 30, 25)
const bookingDFull = (await call('GET', `/api/bookings/${bookingD.id}`, G)).j?.booking
const proofRefD = `wallet_pib_${Date.now()}`
const proofD = await call('POST', '/api/payments/local-wallet-proof', G, { bookingId: bookingD.id, providerRef: proofRefD })
check('local-wallet proof submitted for booking D', proofD.status === 201, JSON.stringify(proofD.j))
const proofDId = proofD.j?.proof?.id
const proofDAmount = proofD.j?.proof?.amountMinor
// syrian_local_wallet is treated as a Sham-Cash-style provider (server/routes/admin.mjs's
// isShamCashProvider), so approval requires a reconciled account balance in the request body.
const approveD = await call('PATCH', `/api/admin/review-queue/payment/${proofDId}`, A, {
  decision: 'APPROVE',
  shamCashReconciliation: { accountMinor: proofDAmount, expectedMinor: proofDAmount, differenceMinor: 0 },
})
check('admin approved booking D payment proof', approveD.status === 200, JSON.stringify(approveD.j))
const bookingDConfirmed = (await call('GET', `/api/bookings/${bookingD.id}`, G)).j?.booking
check('booking D confirmed via the (unrelated) local-wallet-proof rail', bookingDConfirmed?.status === 'CONFIRMED', bookingDConfirmed?.status)

await call('GET', '/api/admin/payouts', A)
const bookingDCompleted = (await call('GET', `/api/bookings/${bookingD.id}`, G)).j?.booking
check('booking D auto-completed', bookingDCompleted?.status === 'COMPLETED', bookingDCompleted?.status)
const releaseD = await call('PATCH', `/api/admin/payouts/${bookingD.id}/release`, A)
check('booking D payout released before dispute', releaseD.status === 200, JSON.stringify(releaseD.j))

const disputeD = await call('PATCH', `/api/bookings/${bookingD.id}/dispute`, G, {})
check('guest disputed booking D', disputeD.status === 200 && disputeD.j?.booking?.status === 'DISPUTED', JSON.stringify(disputeD.j))
const rejectD = await call('PATCH', `/api/admin/review-queue/booking/${bookingD.id}`, A, { decision: 'REJECT' })
check('admin rejected the dispute -> booking CANCELLED', rejectD.status === 200 && rejectD.j?.entity?.status === 'CANCELLED', JSON.stringify(rejectD.j))

const splitD = bookingFinanceSplit(bookingDFull, proofD.j?.proof?.amountMinor)
const guestRefundD = (await walletEntries(bookingD.id, ['booking_refund'])).find((e) => e.type === 'REFUND')
check('guest IS refunded on the admin-rejection path (unlike the PaymentIntent card-refund path)', guestRefundD?.amountMinor === proofD.j?.proof?.amountMinor, JSON.stringify(guestRefundD))
const shareReversalD = (await walletEntries(bookingD.id, ['booking_admin_share_reversal'])).find((e) => e.type === 'DEBIT')
check('admin-share reversal DEBIT recorded (refactored shared helper)', shareReversalD?.amountMinor === splitD.adminShareMinor, JSON.stringify({ shareReversalD, expected: splitD.adminShareMinor }))
const payoutClawbackD = (await walletEntries(bookingD.id, ['booking_payout_clawback'])).find((e) => e.type === 'DEBIT')
check('host payout clawback DEBIT recorded (refactored shared helper)', payoutClawbackD?.amountMinor === splitD.hostGrossMinor, JSON.stringify({ payoutClawbackD, expected: splitD.hostGrossMinor }))

console.log(`\n==== PAYMENT INTENTS BOOKING E2E: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
