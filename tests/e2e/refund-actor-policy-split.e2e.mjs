// SYBNB — Item 2 Phase 2b round 3: refund actor-policy split + finalize-cancellation E2E
// (governed evidence artifact).
//
// Proves, over real HTTP against the real running server + real Postgres, the redesign that
// resolves the previously-disclosed ADMIN-only refund-policy gap (see the Phase 2b round 2
// report): createRefundRequest() moves zero money (proven exhaustively since round 2), so it now
// runs under a new, broader-actor 'refund_request' policy operation (ADMIN/HOST/GUEST) instead of
// the ADMIN-only 'refund' operation it used to share with real wallet-money-moving side effects.
// Those side effects -- commission-share reversal and cancellation-fee DEBIT/CREDIT -- were split
// out of the guest/host-triggered cancel transaction entirely and now happen ONLY via a new,
// separate, ADMIN-only action: PATCH /api/admin/bookings/:id/finalize-cancellation (still under
// the unchanged 'refund' operation).
//
// This suite specifically proves:
//   - host/guest cancel now genuinely succeeds over real HTTP (the gap is resolved) while still
//     creating ZERO wallet entries -- money movement is structurally impossible for that actor.
//   - the ADMIN-only finalize action correctly posts the commission-reversal + cancellation-fee
//     wallet entries, with amounts matching bookingFinanceSplit()/cancellationAdminFee() exactly,
//     for both a host-initiated and a guest-initiated cancellation (with and without the guest's
//     cancellation-protection add-on, which waives the fee).
//   - a host, a guest (including the booking's own guest/host), and an unrelated authenticated
//     user can never finalize -- clean 403, zero effects, never a 500. Anonymous gets 401.
//   - finalizing a non-cancelled booking, or a cancelled booking with no approved payment ever,
//     is refused cleanly with a specific error code and zero effects.
//   - finalize is idempotent (recordWalletEntry's own idempotency-by-key) under both a sequential
//     double-call and a genuine concurrent race -- never a double-post.
//   - the refund_request operation's own flag genuinely gates it (default-deny), proven directly
//     at the policy-function level.
//   - no hard refund-cap violation exists anywhere this suite touches.
//
// Run: AUTH_SECRET=<secret> ADMIN=<uuid> HOST=<uuid> GUEST=<uuid> BUYER=<uuid>
//      node tests/e2e/refund-actor-policy-split.e2e.mjs
//      (server must run with the full payment-policy config this repo's run-all-e2e.sh sets,
//      including PAYMENT_OPERATION_MANUAL_PROOF_REFUND_REQUEST_ENABLED=true)

import { randomUUID } from 'node:crypto'
import { createSessionToken } from '../../server/lib/security.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../../server/lib/payment-policy.mjs'
import { bookingFinanceSplit, cancellationAdminFee } from '../../server/lib/finance-ledger.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

const host = { id: process.env.HOST }
const guest = { id: process.env.GUEST }
const admin = { id: process.env.ADMIN }
const other = { id: process.env.BUYER } // an unrelated, authenticated GUEST -- not this booking's own guest
for (const [name, u] of [['HOST', host], ['GUEST', guest], ['ADMIN', admin], ['BUYER', other]]) {
  if (!u.id) { console.error(`Missing required env ${name} (a synthetic user id).`); process.exit(2) }
}
const H = createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
const G = createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })
const A = createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })
const O = createSessionToken({ id: other.id, roles: [{ role: 'GUEST' }] })

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
    division: 'STAYS', titleAr: 'شقة اختبار RAPS', titleEn: 'RAPS test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
  })
  const id = created.j?.listing?.id
  await call('PATCH', `/api/listings/${id}/submit`, H)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return id
}
let bookingDateCursor = 5
async function makeBooking(listingId, opts = {}) {
  const checkInDaysAgo = -bookingDateCursor
  const checkOutDaysAgo = -(bookingDateCursor + 2)
  bookingDateCursor += 3
  const created = await call('POST', '/api/bookings', G, {
    listingId, checkIn: daysAgoIso(checkInDaysAgo), checkOut: daysAgoIso(checkOutDaysAgo),
    ...(opts.protection ? { cancellationProtectionPurchased: true } : {}),
  })
  return created.j?.booking
}
async function payAndApprove(bookingId) {
  const providerRef = `wallet_raps_${Date.now()}_${randomUUID()}`
  const proof = await call('POST', '/api/payments/local-wallet-proof', G, { bookingId, providerRef })
  const proofId = proof.j?.proof?.id
  const amountMinor = proof.j?.proof?.amountMinor
  await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, {
    decision: 'APPROVE',
    shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 },
  })
  return { proofId, amountMinor }
}
async function walletEntriesFor(bookingId, referenceTypes) {
  return db().walletEntry.findMany({ where: { referenceId: bookingId, referenceType: { in: referenceTypes } } })
}

async function main() {
  console.log('=== REFUND ACTOR-POLICY SPLIT + FINALIZE-CANCELLATION E2E ===')
  await verifyHostForPublishing()
  const listingId = await makeStaysListing(150000)

  // --- 1. Host-cancel succeeds directly over real HTTP -- the actor gap is resolved -- and moves
  // zero wallet money. ---
  {
    const booking = await makeBooking(listingId)
    const { proofId } = await payAndApprove(booking.id)
    const cancel = await call('PATCH', `/api/host/requests/${booking.id}`, H, { status: 'CANCELLED' })
    check('host-cancel: succeeds for the real HOST actor (200)', cancel.status === 200 && cancel.j?.booking?.status === 'CANCELLED', JSON.stringify(cancel.j))
    const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
    check('host-cancel: creates a real refund request', refund?.migratedFromLegacy === false, JSON.stringify(refund))
    const moneyEntries = await walletEntriesFor(booking.id, ['booking_admin_share_reversal', 'booking_host_cancel_fee'])
    check('host-cancel: ZERO commission-reversal/fee wallet entries (host cannot directly move money)', moneyEntries.length === 0, moneyEntries.length)
  }

  // --- 2. Guest-cancel: same resolution, same zero-money proof. ---
  {
    const booking = await makeBooking(listingId)
    const { proofId } = await payAndApprove(booking.id)
    const cancel = await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    check('guest-cancel: succeeds for the real GUEST actor (200)', cancel.status === 200 && cancel.j?.booking?.status === 'CANCELLED', JSON.stringify(cancel.j))
    const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
    check('guest-cancel: creates a real refund request', refund?.migratedFromLegacy === false, JSON.stringify(refund))
    const moneyEntries = await walletEntriesFor(booking.id, ['booking_admin_share_reversal', 'booking_guest_cancel_fee'])
    check('guest-cancel: ZERO commission-reversal/fee wallet entries (guest cannot directly move money)', moneyEntries.length === 0, moneyEntries.length)
  }

  // --- 3. Admin finalize-cancellation after a HOST cancel: correct wallet entries, exact amounts. ---
  let hostCancelledBookingForRepeat
  {
    const booking = await makeBooking(listingId)
    const { amountMinor } = await payAndApprove(booking.id)
    await call('PATCH', `/api/host/requests/${booking.id}`, H, { status: 'CANCELLED' })
    const fresh = await db().booking.findUnique({ where: { id: booking.id }, include: { listing: true } })
    const expectedSplit = bookingFinanceSplit(fresh, amountMinor)
    const expectedFee = cancellationAdminFee(fresh.currency)

    const finalize = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})
    check('finalize (host-cancel): admin succeeds (200), cancelledBy=HOST', finalize.status === 200 && finalize.j?.cancelledBy === 'HOST', JSON.stringify(finalize.j))
    const reversal = await db().walletEntry.findFirst({ where: { referenceId: booking.id, referenceType: 'booking_admin_share_reversal', type: 'DEBIT' } })
    check('finalize (host-cancel): admin-share-reversal DEBIT posted with the exact split amount', reversal?.amountMinor === expectedSplit.adminShareMinor, JSON.stringify({ got: reversal?.amountMinor, expected: expectedSplit.adminShareMinor }))
    const hostFeeDebit = await db().walletEntry.findFirst({ where: { referenceId: booking.id, referenceType: 'booking_host_cancel_fee', type: 'DEBIT' } })
    check('finalize (host-cancel): host cancellation-fee DEBIT posted with the exact fee amount', hostFeeDebit?.amountMinor === expectedFee.amountMinor, JSON.stringify({ got: hostFeeDebit?.amountMinor, expected: expectedFee.amountMinor }))
    const adminFeeCredit = await db().walletEntry.findFirst({ where: { referenceId: booking.id, referenceType: 'booking_host_cancel_fee', type: 'CREDIT' } })
    check('finalize (host-cancel): matching admin CREDIT posted for the same fee amount', adminFeeCredit?.amountMinor === expectedFee.amountMinor, JSON.stringify({ got: adminFeeCredit?.amountMinor, expected: expectedFee.amountMinor }))
    hostCancelledBookingForRepeat = booking.id
  }

  // --- 4. Admin finalize-cancellation after a GUEST cancel WITHOUT protection: fee charged. ---
  {
    const booking = await makeBooking(listingId)
    const { amountMinor } = await payAndApprove(booking.id)
    await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    const fresh = await db().booking.findUnique({ where: { id: booking.id }, include: { listing: true } })
    const expectedFee = cancellationAdminFee(fresh.currency)

    const finalize = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})
    check('finalize (guest-cancel, no protection): admin succeeds, cancelledBy=GUEST, feeCharged=true', finalize.status === 200 && finalize.j?.cancelledBy === 'GUEST' && finalize.j?.feeCharged === true, JSON.stringify(finalize.j))
    const guestFeeDebit = await db().walletEntry.findFirst({ where: { referenceId: booking.id, referenceType: 'booking_guest_cancel_fee', type: 'DEBIT' } })
    check('finalize (guest-cancel, no protection): guest cancellation-fee DEBIT posted with the exact fee amount', guestFeeDebit?.amountMinor === expectedFee.amountMinor, JSON.stringify({ got: guestFeeDebit?.amountMinor, expected: expectedFee.amountMinor }))
  }

  // --- 5. Admin finalize-cancellation after a GUEST cancel WITH protection: fee waived, matching
  // the guest-cancel handler's own original protectedByAddOn rule exactly. ---
  {
    const booking = await makeBooking(listingId, { protection: true })
    await payAndApprove(booking.id)
    await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})

    const finalize = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})
    check('finalize (guest-cancel, WITH protection): admin succeeds, feeCharged=false (waived)', finalize.status === 200 && finalize.j?.feeCharged === false, JSON.stringify(finalize.j))
    const guestFeeDebit = await db().walletEntry.findFirst({ where: { referenceId: booking.id, referenceType: 'booking_guest_cancel_fee' } })
    check('finalize (guest-cancel, WITH protection): no guest cancellation-fee entry exists at all', !guestFeeDebit, JSON.stringify(guestFeeDebit))
    const reversal = await db().walletEntry.findFirst({ where: { referenceId: booking.id, referenceType: 'booking_admin_share_reversal' } })
    check('finalize (guest-cancel, WITH protection): commission-reversal still posts regardless of the fee waiver', Boolean(reversal), JSON.stringify(reversal))
  }

  // --- 6. Non-admin actors can never finalize: the booking's own host, its own guest, and a
  // totally unrelated authenticated user -- clean 403, zero effects, never a 500. ---
  {
    const booking = await makeBooking(listingId)
    await payAndApprove(booking.id)
    await call('PATCH', `/api/host/requests/${booking.id}`, H, { status: 'CANCELLED' })

    const asHost = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, H, {})
    check('finalize: the booking\'s own HOST cannot finalize (403, not 500)', asHost.status === 403, asHost.status + ' ' + code(asHost))
    const asGuest = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, G, {})
    check('finalize: the booking\'s own GUEST cannot finalize (403, not 500)', asGuest.status === 403, asGuest.status + ' ' + code(asGuest))
    const asOther = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, O, {})
    check('finalize: an unrelated authenticated user cannot finalize (403, not 500)', asOther.status === 403, asOther.status + ' ' + code(asOther))
    const entries = await walletEntriesFor(booking.id, ['booking_admin_share_reversal', 'booking_host_cancel_fee'])
    check('finalize: zero effects from every refused attempt', entries.length === 0, entries.length)
  }

  // --- 7. Anonymous cannot finalize -- clean 401. ---
  {
    const booking = await makeBooking(listingId)
    await payAndApprove(booking.id)
    await call('PATCH', `/api/host/requests/${booking.id}`, H, { status: 'CANCELLED' })
    const anon = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, null, {})
    check('finalize: anonymous refused (401)', anon.status === 401, anon.status)
  }

  // --- 8. Finalizing a booking that isn't CANCELLED is refused cleanly. ---
  {
    const booking = await makeBooking(listingId)
    await payAndApprove(booking.id)
    const finalize = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})
    check('finalize: refused for a non-cancelled booking (400 BOOKING_NOT_CANCELLED)', finalize.status === 400 && code(finalize) === 'BOOKING_NOT_CANCELLED', finalize.status + ' ' + code(finalize))
  }

  // --- 9. Finalizing a cancelled booking that never had an approved payment is refused cleanly
  // (nothing to reverse, no fee to charge -- structurally distinct from "not yet finalized"). This
  // exact combination is unreachable through the real cancel routes (canCancel only accepts
  // REQUESTED/CONFIRMED, and in this codebase's actual lifecycle a booking only ever reaches
  // either of those AFTER a payment proof is approved -- see approvePaymentProof's own
  // nextStatus), so the CANCELLED-with-no-payment state is seeded directly, mirroring this
  // codebase's established pattern for edge cases HTTP alone can't cleanly construct (e.g. Round
  // 2's synthetic proof fixtures). The point under test is the finalize endpoint's own guard, not
  // how a booking might reach this state. ---
  {
    const booking = await makeBooking(listingId)
    await db().booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })
    const finalize = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {})
    check('finalize: refused for a cancelled booking with no approved/reversed payment (409 NOTHING_TO_FINALIZE)', finalize.status === 409 && code(finalize) === 'NOTHING_TO_FINALIZE', finalize.status + ' ' + code(finalize))
  }

  // --- 10. Finalize is idempotent: calling it again for the SAME already-finalized booking posts
  // no new entries and leaves wallet balances unchanged (recordWalletEntry's own idempotency). ---
  {
    const before = await db().walletEntry.count({ where: { referenceId: hostCancelledBookingForRepeat, referenceType: { in: ['booking_admin_share_reversal', 'booking_host_cancel_fee'] } } })
    const repeat = await call('PATCH', `/api/admin/bookings/${hostCancelledBookingForRepeat}/finalize-cancellation`, A, {})
    check('finalize: repeating an already-finalized booking still returns 200 (idempotent, not an error)', repeat.status === 200, JSON.stringify(repeat.j))
    const after = await db().walletEntry.count({ where: { referenceId: hostCancelledBookingForRepeat, referenceType: { in: ['booking_admin_share_reversal', 'booking_host_cancel_fee'] } } })
    check('finalize: repeating posts ZERO new wallet entries (no double-credit)', after === before, JSON.stringify({ before, after }))
  }

  // --- 11. Finalize concurrency race: two genuinely simultaneous admin finalize calls for the
  // SAME booking settle to exactly one set of wallet entries, never two. ---
  {
    const booking = await makeBooking(listingId)
    await payAndApprove(booking.id)
    await call('PATCH', `/api/bookings/${booking.id}/cancel`, G, {})
    const [r1, r2] = await Promise.all([
      call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {}),
      call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, A, {}),
    ])
    check('finalize race: both concurrent admin calls succeed (idempotent, neither errors)', r1.status === 200 && r2.status === 200, JSON.stringify({ r1: r1.status, r2: r2.status }))
    const reversalCount = await db().walletEntry.count({ where: { referenceId: booking.id, referenceType: 'booking_admin_share_reversal' } })
    check('finalize race: exactly ONE admin-share-reversal entry, not two', reversalCount === 1, reversalCount)
    const feeDebitCount = await db().walletEntry.count({ where: { referenceId: booking.id, referenceType: 'booking_guest_cancel_fee', type: 'DEBIT' } })
    check('finalize race: exactly ONE guest-fee DEBIT entry, not two', feeDebitCount === 1, feeDebitCount)
  }

  // --- 12. Default-deny: the refund_request operation's own flag genuinely gates it, proven
  // directly at the policy-function level (mirrors this repo's established pattern for testing an
  // individual operation flag without standing up a second flag-off server process). ---
  {
    const saved = process.env.PAYMENT_OPERATION_MANUAL_PROOF_REFUND_REQUEST_ENABLED
    delete process.env.PAYMENT_OPERATION_MANUAL_PROOF_REFUND_REQUEST_ENABLED
    let denied = null
    try {
      authorizePaymentOperation({
        operation: 'refund_request', rail: 'manual_proof', provider: 'manual', division: 'STAYS',
        country: activePolicyCountryKey(), environment: policyEnvironment(), actor: { roles: ['GUEST'] },
      })
    } catch (e) { denied = e }
    check('default-deny: refund_request refused when its own operation flag is unset', denied?.code === 'PAYMENT_POLICY_DENIED' && denied?.reason === 'OPERATION_DISABLED', JSON.stringify({ code: denied?.code, reason: denied?.reason }))
    if (saved !== undefined) process.env.PAYMENT_OPERATION_MANUAL_PROOF_REFUND_REQUEST_ENABLED = saved
    // Restore, then prove a HOST actor is genuinely allowed once the flag is back on (closes the
    // loop: this isn't a flag that's merely absent from evaluate(), it's the real gate).
    let allowed = null
    try {
      authorizePaymentOperation({
        operation: 'refund_request', rail: 'manual_proof', provider: 'manual', division: 'STAYS',
        country: activePolicyCountryKey(), environment: policyEnvironment(), actor: { roles: ['HOST'] },
      })
      allowed = true
    } catch { allowed = false }
    check('default-deny control: refund_request allowed for a HOST actor once the flag is restored', allowed === true, allowed)
  }

  // --- 13. DB invariant: no hard refund-cap violation exists anywhere. Direct SQL for the real
  // cross-column comparison Prisma's query API can't express. ---
  {
    const rows = await db().$queryRaw`SELECT count(*)::int AS n FROM payment_proofs WHERE reserved_refund_minor + succeeded_refund_minor + accepted_refund_minor > amount_minor`
    check('DB invariant: zero refund-cap violations anywhere', Number(rows?.[0]?.n) === 0, JSON.stringify(rows))
  }

  console.log(`\n==== REFUND ACTOR-POLICY SPLIT + FINALIZE-CANCELLATION E2E: ${pass} passed, ${fail} failed ====`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDb()
  process.exit(1)
})
