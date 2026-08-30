// SYBNB — refund execution (wallet-credit) E2E (governed evidence artifact).
//
// Closes the second real gap an independent audit agent verified via live HTTP transactions: a
// cancelled booking's "refund" was only ever a durable REQUEST (createRefundRequest, round 2) --
// no code path anywhere actually returned the guest's money. This suite proves the new closure:
// PATCH /api/admin/refunds/:refundId/execute (executeManualRailRefund, finance-ledger.mjs) credits
// the original payer's SYBNB wallet with the exact refund amount -- the same internal ledger
// mechanism this platform already uses for host payouts and admin commission, not an external
// provider call (no real provider is connected or approved anywhere in this codebase).
//
// Proves: (1) the full lifecycle end-to-end -- guest cancels (creates the request, zero money) ->
// admin finalizes (commission reversal + fee, zero guest money) -> admin executes (the guest's
// wallet actually increases by exactly the refund amount, for the first time in the whole
// lifecycle); (2) the proof's reserved/succeeded counters transfer exactly, cap invariant intact;
// (3) legacy refunds are refused (they have their own acceptance path, legacy_refund_accept);
// (4) a card-rail refund attempt (synthetic, since createRefundRequest already refuses card-rail at
// creation) is refused, defense-in-depth; (5) non-admin actors and anonymous are refused cleanly,
// never a 500; (6) re-executing an already-executed refund is refused cleanly, no double-credit;
// (7) a genuine concurrent race settles to exactly one wallet credit, the loser refused cleanly
// (not a 500 -- this design's attempt-level claim serializes before any wallet mutation, unlike the
// finalize-cancellation route's own booking-status-only guard).
//
// Run: AUTH_SECRET=<secret> ADMIN=<uuid> HOST=<uuid> GUEST=<uuid>
//      node tests/e2e/refund-execution-wallet-credit.e2e.mjs

import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

const host = { id: process.env.HOST }
const guest = { id: process.env.GUEST }
const admin = { id: process.env.ADMIN }
const other = { id: process.env.BUYER } // an unrelated, authenticated GUEST -- not this booking's own guest
for (const [name, u] of [['HOST', host], ['GUEST', guest], ['ADMIN', admin], ['BUYER', other]]) {
  if (!u.id) { console.error(`Missing required env ${name} (a synthetic user id).`); process.exit(2) }
}
const H = await createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
const G = await createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })
const A = await createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })
const O = await createSessionToken({ id: other.id, roles: [{ role: 'GUEST' }] })

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
const code = (r) => r.j?.error?.code || r.j?.code
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
    division: 'STAYS', titleAr: 'شقة اختبار REW', titleEn: 'REW test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
  })
  const id = created.j?.listing?.id
  await call('PATCH', `/api/listings/${id}/submit`, H)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return id
}
let bookingDateCursor = 5
async function makeBooking(listingId) {
  const checkInDaysAgo = -bookingDateCursor
  const checkOutDaysAgo = -(bookingDateCursor + 2)
  bookingDateCursor += 3
  const created = await call('POST', '/api/bookings', G, { listingId, checkIn: daysAgoIso(checkInDaysAgo), checkOut: daysAgoIso(checkOutDaysAgo) })
  return created.j?.booking
}
async function payAndApprove(bookingId) {
  const providerRef = `wallet_rew_${Date.now()}_${randomUUID()}`
  const proof = await call('POST', '/api/payments/local-wallet-proof', G, { bookingId, providerRef })
  const proofId = proof.j?.proof?.id
  const amountMinor = proof.j?.proof?.amountMinor
  await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, {
    decision: 'APPROVE',
    shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 },
  })
  return { proofId, amountMinor }
}
async function guestBalance() {
  const r = await call('GET', '/api/wallet', G)
  return r.j?.wallet?.cachedBalanceMinor || 0
}

async function main() {
  console.log('=== REFUND EXECUTION (WALLET CREDIT) E2E ===')
  await verifyHostForPublishing()
  const listingId = await makeStaysListing(150000)

  // --- 1. Full lifecycle: cancel -> finalize -> execute -- the guest's wallet only ever increases
  // at the LAST step, by exactly the refund amount. ---
  {
    const booking = await makeBooking(listingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    // This local dev DB is shared by other concurrent suites/sessions reusing the same fixture
    // GUEST id, so raw wallet-balance snapshots are noisy (confirmed by an independent audit agent
    // earlier this session). Precise per-booking WalletEntry existence/amount checks (below) are
    // immune to that noise; a scoped before/after balance delta is used only around the single
    // execute call, in as tight a window as possible.
    const cancel = await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    check('cancel succeeds (200)', cancel.status === 200, JSON.stringify(cancel.j))
    check('zero REFUND-type wallet entry exists yet (request only, zero money)', !(await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } })), 'entry already exists')

    const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
    const finalize = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})
    check('finalize succeeds (200)', finalize.status === 200, JSON.stringify(finalize.j))
    check('still zero REFUND-type wallet entry after finalize (commission-reversal/fee only, not the guest\'s refund)', !(await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } })), 'entry already exists')

    const balanceBeforeExecute = await guestBalance()
    const execute = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, A, {})
    check('execute succeeds (200)', execute.status === 200, JSON.stringify(execute.j))
    check('execute response reports the refund as SUCCEEDED', execute.j?.refund?.status === 'SUCCEEDED', execute.j?.refund?.status)

    const balanceAfterExecute = await guestBalance()
    check('guest wallet balance increased by EXACTLY the refund amount, for the first time in the lifecycle', balanceAfterExecute === balanceBeforeExecute + amountMinor, JSON.stringify({ balanceBeforeExecute, balanceAfterExecute, amountMinor }))

    const walletEntry = await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } })
    check('a REFUND-type wallet entry exists for this booking, exact amount', walletEntry?.amountMinor === amountMinor, JSON.stringify(walletEntry))

    const refundAfter = await db().refund.findUnique({ where: { id: refund.id } })
    check('Refund row: status SUCCEEDED, reservationHeld false, succeededAt set', refundAfter.status === 'SUCCEEDED' && refundAfter.reservationHeld === false && refundAfter.succeededAt !== null, JSON.stringify(refundAfter))
    const attemptAfter = await db().refundAttempt.findFirst({ where: { refundId: refund.id } })
    check('RefundAttempt: status SUCCEEDED, completedAt set', attemptAfter.status === 'SUCCEEDED' && attemptAfter.completedAt !== null, JSON.stringify(attemptAfter))

    const proofAfter = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('proof counters: reservedRefundMinor decremented to 0, succeededRefundMinor incremented to the exact amount', proofAfter.reservedRefundMinor === 0 && proofAfter.succeededRefundMinor === amountMinor, JSON.stringify(proofAfter))
  }

  // --- 2. Re-executing an already-executed refund is refused cleanly, no double-credit. ---
  {
    const booking = await makeBooking(listingId)
    const { proofId } = await payAndApprove(booking.id)
    await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
    await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})

    const first = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, A, {})
    check('first execute succeeds', first.status === 200, JSON.stringify(first.j))

    // By the time this second, purely-sequential call reads the refund's attempts, the only
    // attempt is already SUCCEEDED (not CLAIMED) -- correctly and more precisely reported as
    // "nothing left to claim" (NO_CLAIMABLE_ATTEMPT), distinct from REFUND_NOT_EXECUTABLE, which is
    // reserved for a genuine microsecond-scale race where an attempt WAS CLAIMED when read but lost
    // the claim itself (see case 3 below) -- both are clean, correct 409s for "already executed".
    const second = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, A, {})
    check('second execute on the same refund is refused cleanly (409 NO_CLAIMABLE_ATTEMPT), not a silent success', second.status === 409 && code(second) === 'NO_CLAIMABLE_ATTEMPT', second.status + ' ' + code(second))
    check('exactly one REFUND wallet entry exists for this booking, not two', await db().walletEntry.count({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } }) === 1, 'count mismatch')
  }

  // --- 3. A genuine concurrent race: two simultaneous execute calls for the same refund settle to
  // exactly one wallet credit; the loser is refused cleanly, never a 500 (the attempt-level claim
  // serializes BEFORE any wallet mutation, unlike finalize-cancellation's booking-status guard). ---
  {
    const booking = await makeBooking(listingId)
    const { proofId, amountMinor } = await payAndApprove(booking.id)
    await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
    await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})
    const balanceBefore = await guestBalance()

    const [r1, r2] = await Promise.all([
      call('PATCH', `/api/admin/refunds/${refund.id}/execute`, A, {}),
      call('PATCH', `/api/admin/refunds/${refund.id}/execute`, A, {}),
    ])
    const statuses = [r1.status, r2.status].sort()
    check('race: exactly one 200, one clean 409 refusal (never a 500)', statuses[0] === 200 && statuses[1] === 409, JSON.stringify({ r1: r1.status, r2: r2.status }))
    check('race: guest balance increased by exactly ONE refund amount, not two', await guestBalance() === balanceBefore + amountMinor, JSON.stringify({ balanceBefore, amountMinor }))
    check('race: exactly one REFUND wallet entry exists', await db().walletEntry.count({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } }) === 1, 'count mismatch')
  }

  // --- 4. Legacy refunds are refused -- they have their own acceptance path. ---
  {
    const legacyRefund = await db().refund.findFirst({ where: { migratedFromLegacy: true } })
    check('setup: a real migrated legacy refund exists in this DB to test against', Boolean(legacyRefund), 'none found')
    if (legacyRefund) {
      const attempt = await call('PATCH', `/api/admin/refunds/${legacyRefund.id}/execute`, A, {})
      check('execute refuses a legacy refund (400 REFUND_IS_LEGACY)', attempt.status === 400 && code(attempt) === 'REFUND_IS_LEGACY', attempt.status + ' ' + code(attempt))
    }
  }

  // --- 5. Card-rail refund (synthetic -- createRefundRequest already refuses card-rail at
  // creation, so this can only be constructed directly, mirroring this repo's established pattern
  // for edge cases HTTP alone can't produce). Defense-in-depth: execute must refuse it too. ---
  {
    const booking = await makeBooking(listingId)
    const cardProof = await db().paymentProof.create({
      data: { bookingId: booking.id, userId: guest.id, provider: 'payment_intent', status: 'APPROVED', amountMinor: 200000, currency: 'SYP' },
    })
    const cardRefund = await db().refund.create({
      data: {
        paymentProofId: cardProof.id, bookingId: booking.id, requestedByUserId: guest.id,
        amountMinor: 200000, currency: 'SYP', reason: 'synthetic card-rail probe', reasonCode: 'GUEST_CANCELLED',
        rail: 'payment_intent', status: 'IN_PROGRESS', reservationHeld: true, migratedFromLegacy: false,
      },
    })
    // refund_attempt_status_shape (the DB CHECK, not just the Prisma schema) requires
    // idempotencyKey/requestFingerprint non-null for any ordinary (non-legacy) attempt regardless
    // of status -- both must be set for this synthetic fixture to insert at all.
    await db().refundAttempt.create({
      data: {
        refundId: cardRefund.id, status: 'CLAIMED', migratedFromLegacy: false, provider: 'stripe',
        providerPaymentObjectType: 'charge', providerPaymentObjectId: 'ch_synthetic', providerEndpointKey: 'stripe-refund',
        canonicalRequestVersion: 1, amountMinor: 200000, currency: 'SYP',
        idempotencyKey: `synthetic-card-rail-${cardRefund.id}`, requestFingerprint: `synthetic-card-rail-fp-${cardRefund.id}`,
      },
    })
    const attempt = await call('PATCH', `/api/admin/refunds/${cardRefund.id}/execute`, A, {})
    check('execute refuses a card-rail refund (400 REFUND_PROVIDER_NOT_SUPPORTED)', attempt.status === 400 && code(attempt) === 'REFUND_PROVIDER_NOT_SUPPORTED', attempt.status + ' ' + code(attempt))
  }

  // --- 6. Non-admin actors and anonymous are refused cleanly, never a 500. ---
  {
    const booking = await makeBooking(listingId)
    const { proofId } = await payAndApprove(booking.id)
    await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
    await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})

    const asGuest = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, G, {})
    check('the refund\'s own guest cannot execute it (403, not 500)', asGuest.status === 403, asGuest.status + ' ' + code(asGuest))
    const asHost = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, H, {})
    check('the booking\'s host cannot execute it (403, not 500)', asHost.status === 403, asHost.status + ' ' + code(asHost))
    const asOther = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, O, {})
    check('an unrelated authenticated user cannot execute it (403, not 500)', asOther.status === 403, asOther.status + ' ' + code(asOther))
    const anon = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, null, {})
    check('anonymous cannot execute it (401)', anon.status === 401, anon.status)
    check('zero wallet effects from every refused attempt', await db().walletEntry.count({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } }) === 0, 'expected 0')
  }

  // --- 7. DB invariant: no hard refund-cap violation exists anywhere after all this activity. ---
  {
    const rows = await db().$queryRaw`SELECT count(*)::int AS n FROM payment_proofs WHERE reserved_refund_minor + succeeded_refund_minor + accepted_refund_minor > amount_minor`
    check('DB invariant: zero refund-cap violations anywhere', Number(rows?.[0]?.n) === 0, JSON.stringify(rows))
  }

  console.log(`\n==== REFUND EXECUTION (WALLET CREDIT) E2E: ${pass} passed, ${fail} failed ====`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDb()
  process.exit(1)
})
