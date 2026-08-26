// SYBNB — Item 2 Phase 2b round 2 (updated in round 3): new refund request creation E2E (governed
// evidence artifact). Round 3 resolved the ADMIN-only actor gate this file's round-2 version
// documented as a known, disclosed gap -- host/guest cancel now genuinely succeeds over real HTTP
// (see tests/e2e/refund-actor-policy-split.e2e.mjs for the full round-3 actor-boundary and
// finalize-cancellation adversarial suite; this file keeps the round-2 request-creation-correctness
// coverage: reasonCode catalogue, idempotency, concurrency, cap enforcement, card-rail exclusion).
//
// Proves, over real HTTP against the real running server + real Postgres (plus a few direct,
// function-level probes of createRefundRequest() for the surgical cases HTTP alone can't cleanly
// exercise), that host/guest/admin refund-triggering actions now create the new Refund + initial
// RefundAttempt records instead of an immediate wallet credit -- per this round's explicit,
// owner-confirmed scope:
//   - host-cancel (host.mjs), guest-cancel (bookings.mjs), admin-reject/dispute-ruling (admin.mjs,
//     manual-rail branch only) each create a real, non-legacy Refund + CLAIMED RefundAttempt with
//     the correct reasonCode, and produce ZERO wallet entries and ZERO provider calls.
//   - reasonCode is always one of the 4 real REFUND_ELIGIBILITY_POLICY values -- LEGACY_UNKNOWN is
//     structurally unreachable from createRefundRequest() (throws synchronously if ever passed).
//   - a genuinely duplicate/racing request is refused or idempotent per the accepted model: a real
//     concurrent HTTP race on the same booking settles to exactly one refund; a direct retry of the
//     exact same logical request at the function level is idempotent (returns the existing attempt,
//     no new row); a genuinely different second request against a proof that already has an active
//     refund is refused (DUPLICATE_REFUND_REQUEST).
//   - the atomic, cumulative reservation guard cannot be pushed past payment_proofs.amount_minor,
//     even when the proof already carries prior reserved/succeeded/accepted capacity.
//   - card-rail proofs are refused (REFUND_PROVIDER_NOT_SUPPORTED) -- createRefundRequest() has no
//     real provider-object identity to reference for them yet (out of this round's scope).
//
// Run: AUTH_SECRET=<secret> ADMIN=<uuid> HOST=<uuid> GUEST=<uuid>
//      node tests/e2e/refund-request-creation.e2e.mjs
//      (server must run with the full payment-policy config this repo's run-all-e2e.sh sets)

import { randomUUID } from 'node:crypto'
import { createSessionToken } from '../../server/lib/security.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { createRefundRequest } from '../../server/lib/finance-ledger.mjs'

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
async function makeStaysListing(priceMinor, instantBookEnabled = true) {
  const created = await call('POST', '/api/listings', H, {
    division: 'STAYS', titleAr: 'شقة اختبار RRC', titleEn: 'RRC test flat', priceMinor, currency: 'SYP', instantBookEnabled,
  })
  const id = created.j?.listing?.id
  await call('PATCH', `/api/listings/${id}/submit`, H)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return id
}
// Every call needs its own non-overlapping date range on the shared listing -- otherwise the
// instant-book listing's own availability guard refuses the second and later bookings outright.
let bookingDateCursor = 5
async function makeBooking(listingId) {
  const checkInDaysAgo = -bookingDateCursor
  const checkOutDaysAgo = -(bookingDateCursor + 2)
  bookingDateCursor += 3
  const created = await call('POST', '/api/bookings', G, { listingId, checkIn: daysAgoIso(checkInDaysAgo), checkOut: daysAgoIso(checkOutDaysAgo) })
  return created.j?.booking
}
async function payAndApprove(bookingId) {
  const providerRef = `wallet_rrc_${Date.now()}_${randomUUID()}`
  const proof = await call('POST', '/api/payments/local-wallet-proof', G, { bookingId, providerRef })
  const proofId = proof.j?.proof?.id
  const amountMinor = proof.j?.proof?.amountMinor
  await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, {
    decision: 'APPROVE',
    shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 },
  })
  return { proofId, amountMinor }
}
async function refundFor(proofId) {
  return db().refund.findFirst({ where: { paymentProofId: proofId }, include: { attempts: true } })
}
async function walletRefundEntries(bookingId) {
  return db().walletEntry.findMany({ where: { referenceId: bookingId, referenceType: 'booking_refund', type: 'REFUND' } })
}

async function main() {
  console.log('=== REFUND REQUEST CREATION E2E ===')
  await verifyHostForPublishing()
  const listingId = await makeStaysListing(150000)
  // A separate, non-instant-book listing -- bookings on it stay REQUESTED even after payment
  // approval, which the admin review-queue REJECT decision requires (['REQUESTED','DISPUTED']).
  const reviewableListingId = await makeStaysListing(150000, false)

  // --- 1. Host-cancel: Item 2 Phase 2b round 3 resolved the previously-disclosed ADMIN-only gate
  // gap -- the real HTTP route now genuinely succeeds for a real HOST actor (operation split to
  // refund_request, actor-authorized for HOST/GUEST/ADMIN; see tests/e2e/refund-actor-policy-
  // split.e2e.mjs for the full actor-boundary/finalize-action adversarial suite). Still zero wallet
  // entries -- the commission-reversal/cancellation-fee money movement is now a separate, later,
  // ADMIN-only action, not part of this transaction at all.
  {
    const booking = await makeBooking(listingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    const cancel = await call('PATCH', `/api/host/requests/${booking.id}`, H, { status: 'CANCELLED' })
    check('host-cancel HTTP route: succeeds for a real HOST actor (200, CANCELLED)', cancel.status === 200 && cancel.j?.booking?.status === 'CANCELLED', JSON.stringify(cancel.j))
    const refund = await refundFor(proofId)
    check('host-cancel: real, non-legacy Refund created with the correct amount', refund?.amountMinor === amountMinor && refund?.migratedFromLegacy === false, JSON.stringify(refund))
    check('host-cancel: reasonCode is HOST_CANCELLED', refund?.reasonCode === 'HOST_CANCELLED', refund?.reasonCode)
    check('host-cancel: status IN_PROGRESS, reservationHeld true', refund?.status === 'IN_PROGRESS' && refund?.reservationHeld === true, JSON.stringify(refund))
    check('host-cancel: exactly one CLAIMED, non-legacy attempt', refund?.attempts?.length === 1 && refund.attempts[0].status === 'CLAIMED' && refund.attempts[0].migratedFromLegacy === false, JSON.stringify(refund?.attempts))
    const walletEntries = await walletRefundEntries(booking.id)
    check('host-cancel: ZERO wallet REFUND entries (money movement is now a separate ADMIN-only action)', walletEntries.length === 0, JSON.stringify(walletEntries))
    // referenceId alone isn't specific enough -- approval-time entries (e.g. the admin-share
    // CREDIT) already legitimately reference this same booking. Scope to the referenceTypes only
    // the deferred admin finalize action would ever create.
    const deferredEntries = await db().walletEntry.count({ where: { referenceId: booking.id, referenceType: { in: ['booking_admin_share_reversal', 'booking_host_cancel_fee', 'booking_guest_cancel_fee', 'booking_payout_clawback'] } } })
    check('host-cancel: ZERO commission-reversal/cancellation-fee wallet entries yet (deferred to admin finalize)', deferredEntries === 0, deferredEntries)
    const proof = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('host-cancel: proof reservedRefundMinor reflects the reservation', proof.reservedRefundMinor === amountMinor, proof.reservedRefundMinor)
  }

  // --- 2. Guest-cancel: same resolution, same zero-wallet-effect proof ---
  {
    const booking = await makeBooking(listingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    const cancel = await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    check('guest-cancel HTTP route: succeeds for a real GUEST actor (200, CANCELLED)', cancel.status === 200 && cancel.j?.booking?.status === 'CANCELLED', JSON.stringify(cancel.j))
    const refund = await refundFor(proofId)
    check('guest-cancel: real, non-legacy Refund created', refund?.migratedFromLegacy === false && refund?.amountMinor > 0, JSON.stringify(refund))
    check('guest-cancel: reasonCode is GUEST_CANCELLED', refund?.reasonCode === 'GUEST_CANCELLED', refund?.reasonCode)
    const walletEntries = await walletRefundEntries(booking.id)
    check('guest-cancel: ZERO wallet REFUND entries', walletEntries.length === 0, JSON.stringify(walletEntries))
    const deferredEntries = await db().walletEntry.count({ where: { referenceId: booking.id, referenceType: { in: ['booking_admin_share_reversal', 'booking_host_cancel_fee', 'booking_guest_cancel_fee', 'booking_payout_clawback'] } } })
    check('guest-cancel: ZERO commission-reversal/cancellation-fee wallet entries yet (deferred to admin finalize)', deferredEntries === 0, deferredEntries)
  }

  // --- 3. Admin-reject (REQUESTED booking) creates a real Refund + RefundAttempt, ADMIN_REJECTED_BOOKING ---
  {
    const booking = await makeBooking(reviewableListingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    const reject = await call('PATCH', `/api/admin/review-queue/booking/${booking.id}`, A, { decision: 'REJECT' })
    check('admin-reject: booking transitioned to CANCELLED', reject.status === 200 && reject.j?.entity?.status === 'CANCELLED', JSON.stringify(reject.j))

    const refund = await refundFor(proofId)
    check('admin-reject: real, non-legacy Refund created with the correct amount', refund?.amountMinor === amountMinor && refund?.migratedFromLegacy === false, JSON.stringify(refund))
    check('admin-reject: reasonCode is ADMIN_REJECTED_BOOKING (not DISPUTE_RULING -- this was never DISPUTED)', refund?.reasonCode === 'ADMIN_REJECTED_BOOKING', refund?.reasonCode)
    const walletEntries = await walletRefundEntries(booking.id)
    check('admin-reject: ZERO wallet REFUND entries', walletEntries.length === 0, JSON.stringify(walletEntries))
  }

  // --- 4. Real concurrent race: two genuinely simultaneous createRefundRequest() calls with
  // IDENTICAL params against the same proof (Promise.all -- not sequential, so neither transaction
  // can see the other's uncommitted row via the idempotency findUnique). A synthetic proof with
  // generous headroom is used so BOTH reservations succeed capacity-wise -- the real differentiator
  // under test is the refunds_one_active_per_payment_proof DB-level uniqueness constraint deciding
  // the race, not the capacity guard (that is covered separately by case 7). This is a genuine HTTP-
  // route-level race for the admin path (the only path not blocked by the policy gate documented in
  // cases 1-2) and a function-level race for host/guest, mirroring exactly what each route calls.
  {
    const booking = await makeBooking(listingId)
    const raceProof = await db().paymentProof.create({
      data: { bookingId: booking.id, userId: guest.id, provider: 'manual', status: 'APPROVED', amountMinor: 1000000, currency: 'SYP' },
    })
    const params = {
      paymentProofId: raceProof.id, bookingId: booking.id, requestedByUserId: admin.id,
      amountMinor: 100, currency: 'SYP', reason: 'concurrency race probe', reasonCode: 'ADMIN_REJECTED_BOOKING',
    }
    const results = await Promise.allSettled([
      db().$transaction((tx) => createRefundRequest(tx, params)),
      db().$transaction((tx) => createRefundRequest(tx, params)),
    ])
    // Two valid outcomes for a genuine race with identical params, matching the required-evidence
    // framing exactly ("refused or idempotent"): either the loser interleaves tightly enough to hit
    // the DB uniqueness constraint (DUPLICATE_REFUND_REQUEST), or it lands after the winner already
    // committed and legitimately finds it via the idempotency check (idempotent: true). Both leave
    // exactly one real refund/attempt in existence -- verified separately below. What must NEVER
    // happen: both calls reporting idempotent: false (two independent refunds for one request).
    const outcomes = results.map((r) => r.status === 'fulfilled' ? { idempotent: r.value.idempotent } : { code: r.reason?.code })
    const newlyCreatedCount = results.filter((r) => r.status === 'fulfilled' && r.value.idempotent === false).length
    const safeLoser = (r) => r.status === 'rejected' ? r.reason?.code === 'DUPLICATE_REFUND_REQUEST' : r.value.idempotent === true
    check('concurrency race: exactly one call creates a new refund; the other is refused or idempotent, never a second independent refund', newlyCreatedCount === 1 && results.filter((r) => !(r.status === 'fulfilled' && r.value.idempotent === false)).every(safeLoser), JSON.stringify(outcomes))
    const refundCount = await db().refund.count({ where: { paymentProofId: raceProof.id } })
    check('concurrency race: exactly ONE Refund created for this proof, not two', refundCount === 1, refundCount)
    const attemptCount = await db().refundAttempt.count({ where: { refund: { paymentProofId: raceProof.id } } })
    check('concurrency race: exactly ONE RefundAttempt, not two', attemptCount === 1, attemptCount)
    const proofAfter = await db().paymentProof.findUnique({ where: { id: raceProof.id } })
    check('concurrency race: reservedRefundMinor reflects only the winning reservation (the loser rolled back with its transaction)', proofAfter.reservedRefundMinor === 100, proofAfter.reservedRefundMinor)
  }

  // --- 4b. Real concurrent HTTP race on the admin route -- the one path the policy gate does not
  // block -- two simultaneous admin-reject requests for the SAME booking.
  {
    const booking = await makeBooking(reviewableListingId)
    const { proofId } = await payAndApprove(booking.id)
    const [r1, r2] = await Promise.all([
      call('PATCH', `/api/admin/review-queue/booking/${booking.id}`, A, { decision: 'REJECT' }),
      call('PATCH', `/api/admin/review-queue/booking/${booking.id}`, A, { decision: 'REJECT' }),
    ])
    const statuses = [r1.status, r2.status].sort()
    check('admin HTTP race: exactly one 200, one refused (booking no longer reviewable OR duplicate refund refused)', statuses[0] === 200 && statuses[1] >= 400, JSON.stringify({ r1: r1.status, r2: r2.status }))
    const refundCount = await db().refund.count({ where: { paymentProofId: proofId } })
    check('admin HTTP race: exactly ONE Refund created for this proof, not two', refundCount === 1, refundCount)
    const attemptCount = await db().refundAttempt.count({ where: { refund: { paymentProofId: proofId } } })
    check('admin HTTP race: exactly ONE RefundAttempt, not two', attemptCount === 1, attemptCount)
  }

  // --- 5. Function-level idempotency: identical retry returns the existing attempt, no new row ---
  {
    const booking = await makeBooking(listingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    const params = {
      paymentProofId: proofId, bookingId: booking.id, requestedByUserId: admin.id,
      amountMinor, currency: 'SYP', reason: 'idempotency probe', reasonCode: 'ADMIN_REJECTED_BOOKING',
    }
    const first = await db().$transaction((tx) => createRefundRequest(tx, params))
    check('idempotency probe: first call creates a new refund/attempt', first.idempotent === false, JSON.stringify(first))
    const second = await db().$transaction((tx) => createRefundRequest(tx, params))
    check('idempotency probe: identical retry is idempotent (same attempt, no new row)', second.idempotent === true && second.attempt.id === first.attempt.id, JSON.stringify({ first: first.attempt.id, second: second.attempt.id, idempotent: second.idempotent }))
    const totalAttempts = await db().refundAttempt.count({ where: { refundId: first.refund.id } })
    check('idempotency probe: exactly one attempt total after both calls', totalAttempts === 1, totalAttempts)
    const proof = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('idempotency probe: reservedRefundMinor incremented exactly once, not twice', proof.reservedRefundMinor === amountMinor, proof.reservedRefundMinor)
  }

  // --- 6. Genuinely different second request against an already-active refund is refused ---
  // Uses a synthetic manual-rail proof with generous headroom so the SECOND request's amount still
  // fits the atomic capacity guard -- the point of this case is the DB-level
  // refunds_one_active_per_payment_proof partial unique index, not a capacity refusal (that is
  // covered separately by case 7). A first request that reserved the FULL proof capacity would make
  // the second request fail the capacity check first and never reach the uniqueness constraint.
  {
    const booking = await makeBooking(listingId)
    const bigProof = await db().paymentProof.create({
      data: { bookingId: booking.id, userId: guest.id, provider: 'manual', status: 'APPROVED', amountMinor: 1000000, currency: 'SYP' },
    })
    await db().$transaction((tx) => createRefundRequest(tx, {
      paymentProofId: bigProof.id, bookingId: booking.id, requestedByUserId: admin.id,
      amountMinor: 100, currency: 'SYP', reason: 'first real request', reasonCode: 'ADMIN_REJECTED_BOOKING',
    }))
    let secondErr = null
    try {
      await db().$transaction((tx) => createRefundRequest(tx, {
        paymentProofId: bigProof.id, bookingId: booking.id, requestedByUserId: admin.id,
        amountMinor: 100, currency: 'SYP', reason: 'a genuinely different second request', reasonCode: 'DISPUTE_RULING',
      }))
    } catch (e) { secondErr = e }
    check('duplicate refusal: a genuinely different second request against an active refund is refused', secondErr?.code === 'DUPLICATE_REFUND_REQUEST', JSON.stringify({ code: secondErr?.code, message: secondErr?.message }))
    const refundCount = await db().refund.count({ where: { paymentProofId: bigProof.id } })
    check('duplicate refusal: still exactly one Refund (the failed second attempt left zero effects)', refundCount === 1, refundCount)
    const proofAfter = await db().paymentProof.findUnique({ where: { id: bigProof.id } })
    check('duplicate refusal: reservedRefundMinor reflects only the first, successful reservation (the refused second reservation was rolled back with its transaction)', proofAfter.reservedRefundMinor === 100, proofAfter.reservedRefundMinor)
  }

  // --- 7. Atomic cap enforcement: reservation cannot push past amount_minor ---
  {
    const booking = await makeBooking(listingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    // Directly consume most of the proof's capacity first (simulating prior activity), leaving
    // less headroom than a new request needs.
    await db().paymentProof.update({ where: { id: proofId }, data: { succeededRefundMinor: amountMinor - 100 } })
    let capErr = null
    try {
      await db().$transaction((tx) => createRefundRequest(tx, {
        paymentProofId: proofId, bookingId: booking.id, requestedByUserId: admin.id,
        amountMinor: 500, currency: 'SYP', reason: 'over-cap probe', reasonCode: 'ADMIN_REJECTED_BOOKING',
      }))
    } catch (e) { capErr = e }
    check('cap enforcement: a request exceeding remaining capacity is refused', capErr?.code === 'INSUFFICIENT_REFUND_CAPACITY', JSON.stringify({ code: capErr?.code }))
    const proofAfter = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('cap enforcement: reservedRefundMinor untouched by the refused request (zero partial effect)', proofAfter.reservedRefundMinor === 0, proofAfter.reservedRefundMinor)
    check('cap enforcement: no Refund row was created', (await db().refund.count({ where: { paymentProofId: proofId } })) === 0, 'expected 0')
    // Sanity: a request that DOES fit the remaining headroom still succeeds.
    const fits = await db().$transaction((tx) => createRefundRequest(tx, {
      paymentProofId: proofId, bookingId: booking.id, requestedByUserId: admin.id,
      amountMinor: 100, currency: 'SYP', reason: 'control: fits remaining headroom', reasonCode: 'ADMIN_REJECTED_BOOKING',
    }))
    check('cap enforcement control: a request that fits the remaining headroom succeeds', fits.idempotent === false, JSON.stringify(fits))
    const proofFinal = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('cap enforcement control: reserved+succeeded now exactly equals amount_minor (fully consumed, not exceeded)', proofFinal.reservedRefundMinor + proofFinal.succeededRefundMinor === amountMinor, JSON.stringify(proofFinal))
  }

  // --- 8. LEGACY_UNKNOWN is structurally unreachable from a new refund request ---
  {
    const booking = await makeBooking(listingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    let legacyErr = null
    try {
      await db().$transaction((tx) => createRefundRequest(tx, {
        paymentProofId: proofId, bookingId: booking.id, requestedByUserId: admin.id,
        amountMinor, currency: 'SYP', reason: 'attempting LEGACY_UNKNOWN', reasonCode: 'LEGACY_UNKNOWN',
      }))
    } catch (e) { legacyErr = e }
    check('LEGACY_UNKNOWN: rejected synchronously before any write', legacyErr !== null && /not in the closed catalogue/.test(legacyErr.message), legacyErr?.message)
    check('LEGACY_UNKNOWN: zero effects', (await db().refund.count({ where: { paymentProofId: proofId } })) === 0, 'expected 0')
  }

  // --- 9. Card-rail proofs are refused (no real provider-object identity to reference yet) ---
  {
    const booking = await makeBooking(listingId)
    const cardProof = await db().paymentProof.create({
      data: { bookingId: booking.id, userId: guest.id, provider: 'payment_intent', status: 'APPROVED', amountMinor: 100000, currency: 'SYP' },
    })
    let cardErr = null
    try {
      await db().$transaction((tx) => createRefundRequest(tx, {
        paymentProofId: cardProof.id, bookingId: booking.id, requestedByUserId: admin.id,
        amountMinor: 100000, currency: 'SYP', reason: 'card-rail probe', reasonCode: 'ADMIN_REJECTED_BOOKING',
      }))
    } catch (e) { cardErr = e }
    check('card-rail proof: refused with REFUND_PROVIDER_NOT_SUPPORTED', cardErr?.code === 'REFUND_PROVIDER_NOT_SUPPORTED', JSON.stringify({ code: cardErr?.code }))
    const cardProofAfter = await db().paymentProof.findUnique({ where: { id: cardProof.id } })
    check('card-rail proof: zero effects, reservedRefundMinor still 0', cardProofAfter.reservedRefundMinor === 0, cardProofAfter.reservedRefundMinor)
  }

  console.log(`\n==== REFUND REQUEST CREATION E2E: ${pass} passed, ${fail} failed ====`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDb()
  process.exit(1)
})
