// SYBNB — short-stay booking money flow E2E (owner decisions of 2026-10-08; governed evidence).
//
// SELF-CONTAINED: seeds its own users (guest, second guest, host, admin) and APPROVED listings
// directly through Prisma, so it needs no pre-existing synthetic fixtures -- it runs the same against
// a fresh CI database (`prisma migrate deploy` only) and a long-lived local one.
//
// Proves, through the real HTTP API + real ledger rows:
//   1. GET /api/bookings/quote -- nights, stay, fees, protection = 3% of the FULL stay, total,
//      commission = 12% of (total - protection), host share; bookable flags.
//   2. Demo listing -> 409 LISTING_NOT_BOOKABLE; own listing -> 409 OWN_LISTING.
//   3. Booking -> manual proof -> admin approve -> host accept -> guest cancel-quote & cancel inside
//      72h (HALF rule) -> admin finalize + execute refund -> every ledger leg exact, and
//      guest refund + SYBNB kept + host kept == amount paid.
//   4. Protected booking declined by the host -> 100% refund incl. protection; finalize reverses the
//      protection-fee credit.
//   5. Unpaid request older than 48h stops blocking dates (before the sweep), the sweep cancels it
//      EXPIRED_UNPAID, and a proof can no longer be submitted for it.
//   6. Host payout method + withdrawal request -> admin PAID -> wallet DEBIT; over-withdrawal
//      refused; reject path moves no money.
//
// Needs the API running with the payment-policy env from scripts/run-all-e2e.sh (manual_proof rail
// + its operation flags + PAYMENT_POLICY_TEST_COUNTRY_ELIGIBLE), and DATABASE_URL + SYBNB_COUNTRY in
// this process's env. Run: node tests/e2e/booking-money-flow.e2e.mjs

import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RUN = randomUUID().slice(0, 8)
const DAY = 24 * 60 * 60 * 1000

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
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
const dateOnly = (ms) => new Date(ms).toISOString().slice(0, 10)
// UTC midnight `days` from today -- calendar dates, exactly as the frontend sends them.
function dayFromToday(days) {
  const now = new Date()
  return dateOnly(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY)
}

async function seedUser(label, roles) {
  const user = await db().user.create({
    data: {
      email: `money-flow-${label}-${RUN}@example.test`,
      displayName: `MF ${label} ${RUN}`,
      locale: 'en',
      // Host verification (migration 049): this suite's host is pre-verified so its stays are bookable.
      hostVerifiedAt: roles.includes('HOST') ? new Date() : undefined,
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
  const token = await createSessionToken({ id: user.id, roles: roles.map((role) => ({ role })) })
  return { ...user, token }
}
async function seedListing(ownerId, { priceMinor, metadata = {}, instantBookEnabled = false }) {
  return db().listing.create({
    data: {
      ownerId,
      division: 'STAYS',
      titleAr: `شقة اختبار ${RUN}`,
      titleEn: `Money flow flat ${RUN}`,
      status: 'APPROVED',
      priceMinor,
      currency: 'SYP',
      instantBookEnabled,
      metadata,
    },
  })
}
async function walletBalance(userId, currency = 'SYP') {
  const w = await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  return w?.cachedBalanceMinor || 0
}
async function entries(bookingId, referenceType, type) {
  return db().walletEntry.findMany({ where: { referenceId: bookingId, referenceType, ...(type ? { type } : {}) } })
}
const sum = (rows) => rows.reduce((acc, row) => acc + row.amountMinor, 0)

async function payAndApprove(guest, admin, bookingId) {
  const proof = await call('POST', '/api/payments/local-wallet-proof', guest.token, { bookingId, providerRef: `mf_${RUN}_${randomUUID()}` })
  const proofId = proof.j?.proof?.id
  const amountMinor = proof.j?.proof?.amountMinor
  const approve = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, admin.token, {
    decision: 'APPROVE',
    shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 },
  })
  return { proof, approve, proofId, amountMinor }
}

async function main() {
  console.log('=== BOOKING MONEY FLOW E2E (decisions 2-8, 2026-10-08) ===')
  const guest = await seedUser('guest', ['GUEST'])
  const guest2 = await seedUser('guest2', ['GUEST'])
  const host = await seedUser('host', ['HOST', 'GUEST'])
  const admin = await seedUser('admin', ['ADMIN'])
  const PRICE = 100_000
  const listing = await seedListing(host.id, { priceMinor: PRICE })
  const demo = await seedListing(host.id, { priceMinor: PRICE, metadata: { demo: true } })

  // --- 1. Quote --------------------------------------------------------------------------------
  console.log('\n--- 1. quote endpoint ---')
  const qIn = dayFromToday(30)
  const qOut = dayFromToday(33)
  const quote = await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${qIn}&checkOut=${qOut}&protection=1`, null)
  const q = quote.j?.quote
  check('quote: 200 with a quote', quote.status === 200 && q, quote)
  check('quote: 3 nights, stay = 3 x price', q?.nights === 3 && q?.stayMinor === 3 * PRICE, q)
  check('quote: protection = 3% of the FULL stay (not one night)', q?.protectionMinor === Math.round(3 * PRICE * 0.03), q)
  check('quote: cleaning 5% / taxes 2% fallback for a listing with no explicit fees', q?.cleaningMinor === 15_000 && q?.taxesMinor === 6_000 && q?.otherFeesMinor === 0, q)
  check('quote: total = stay + cleaning + taxes + other + protection', q?.totalMinor === q?.stayMinor + q?.cleaningMinor + q?.taxesMinor + q?.otherFeesMinor + q?.protectionMinor, q)
  check('quote: commission = 12% of (total - protection); host share = remainder', q?.commissionMinor === Math.round((q?.totalMinor - q?.protectionMinor) * 0.12) && q?.commissionMinor + q?.hostShareMinor === q?.totalMinor - q?.protectionMinor, q)
  check('quote: bookable, SYP', q?.bookable === true && q?.currency === 'SYP' && !q?.reason, q)
  const q0 = (await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${qIn}&checkOut=${qOut}&protection=0`, null)).j?.quote
  check('quote: protection=0 -> no protection fee, total lower by exactly that fee', q0?.protectionMinor === 0 && q0?.totalMinor === q?.totalMinor - q?.protectionMinor, q0)
  const demoQuote = (await call('GET', `/api/bookings/quote?listingId=${demo.id}&checkIn=${qIn}&checkOut=${qOut}`, null)).j?.quote
  check('quote: demo listing -> bookable=false, reason LISTING_NOT_BOOKABLE', demoQuote?.bookable === false && demoQuote?.reason === 'LISTING_NOT_BOOKABLE', demoQuote)
  const ownQuote = (await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${qIn}&checkOut=${qOut}`, host.token)).j?.quote
  check('quote: own listing -> bookable=false, reason OWN_LISTING', ownQuote?.bookable === false && ownQuote?.reason === 'OWN_LISTING', ownQuote)
  const badDates = await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${qOut}&checkOut=${qIn}`, null)
  check('quote: check-out before check-in -> 400 BOOKING_DATES_INVALID', badDates.status === 400 && code(badDates) === 'BOOKING_DATES_INVALID', badDates)

  // --- 2. Demo + own listing ----------------------------------------------------------------------
  console.log('\n--- 2. non-bookable listings ---')
  const demoBooking = await call('POST', '/api/bookings', guest.token, { listingId: demo.id, checkIn: qIn, checkOut: qOut })
  check('POST /api/bookings on a demo listing -> 409 LISTING_NOT_BOOKABLE', demoBooking.status === 409 && code(demoBooking) === 'LISTING_NOT_BOOKABLE', demoBooking)
  const ownBooking = await call('POST', '/api/bookings', host.token, { listingId: listing.id, checkIn: qIn, checkOut: qOut })
  check('POST /api/bookings on your own listing -> 409 OWN_LISTING', ownBooking.status === 409 && code(ownBooking) === 'OWN_LISTING', ownBooking)

  // --- 3. Main flow: HALF refund (cancel inside 72h) ----------------------------------------------
  console.log('\n--- 3. booking -> proof -> approve -> accept -> cancel (HALF) -> finalize + execute ---')
  const created = await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: dayFromToday(1), checkOut: dayFromToday(3) })
  const booking = created.j?.booking
  check('booking created (201, PAYMENT_PENDING)', created.status === 201 && booking?.status === 'PAYMENT_PENDING', created)
  check('booking carries expiresAt = createdAt + 48h while unpaid', booking?.expiresAt && Date.parse(booking.expiresAt) - Date.parse(booking.createdAt) === 48 * 60 * 60 * 1000, booking)
  const mainQuote = (await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${dayFromToday(1)}&checkOut=${dayFromToday(3)}`, null)).j?.quote
  check('the booked dates now quote as unavailable', mainQuote?.bookable === false && mainQuote?.reason === 'BOOKING_DATES_UNAVAILABLE', mainQuote)

  // Commission is credited to the house account when PLATFORM_ACCOUNT_ID is configured, else to the
  // approving admin (finance-ledger.mjs approvePaymentProof) -- mirror that here.
  const revenueUserId = process.env.PLATFORM_ACCOUNT_ID || admin.id
  const adminBefore = await walletBalance(revenueUserId)
  const hostBefore = await walletBalance(host.id)
  const guestBefore = await walletBalance(guest.id)
  const { approve, proofId, amountMinor: paid } = await payAndApprove(guest, admin, booking.id)
  check('proof amount == the quoted guest total (single source of truth)', paid === mainQuote?.totalMinor, { paid, quoted: mainQuote?.totalMinor })
  check('admin approves the proof (200)', approve.status === 200, approve)
  const A = Math.round(paid * 0.12)
  const Hg = paid - A
  const adminShare = await entries(booking.id, 'booking_admin_share', 'CREDIT')
  const hostHold = await entries(booking.id, 'booking_payout', 'HOLD')
  check('approval: SYBNB commission CREDIT = 12% of paid', sum(adminShare) === A, { got: sum(adminShare), A })
  check('approval: host HOLD = 88% of paid', sum(hostHold) === Hg, { got: sum(hostHold), Hg })

  const accept = await call('PATCH', `/api/host/requests/${booking.id}`, host.token, { decision: 'CONFIRM', acceptedTerms: true })
  check('host accepts (CONFIRMED)', accept.status === 200 && accept.j?.booking?.status === 'CONFIRMED', accept)

  const cq = await call('GET', `/api/bookings/${booking.id}/cancel-quote`, guest.token)
  const expectedRefund = Math.round(paid / 2)
  check('cancel-quote: rule HALF (inside 72h), refund 50%, retained the rest', cq.status === 200 && cq.j?.cancelQuote?.rule === 'HALF' && cq.j?.cancelQuote?.refundMinor === expectedRefund && cq.j?.cancelQuote?.retainedMinor === paid - expectedRefund && cq.j?.cancelQuote?.currency === 'SYP' && Boolean(cq.j?.cancelQuote?.deadline), cq)
  const cqOther = await call('GET', `/api/bookings/${booking.id}/cancel-quote`, guest2.token)
  check('cancel-quote: another guest gets 404', cqOther.status === 404, cqOther)

  const cancel = await call('PATCH', `/api/bookings/${booking.id}/cancel`, guest.token, { reason: 'plans changed' })
  check('guest cancel: 200, CANCELLED, refund matches the cancel-quote', cancel.status === 200 && cancel.j?.booking?.status === 'CANCELLED' && cancel.j?.refund?.refundMinor === expectedRefund && cancel.j?.refund?.rule === 'HALF', cancel)
  const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
  check('refund request created for exactly the HALF amount', refund?.amountMinor === expectedRefund, refund)
  const snapshot = (await db().booking.findUnique({ where: { id: booking.id } })).metadata?.cancellation
  check('booking.metadata.cancellation snapshot records the rule and the exact approved proof', snapshot?.rule === 'HALF' && snapshot?.refundMinor === expectedRefund && snapshot?.cancelledBy === 'GUEST' && snapshot?.approvedProofId === proofId, snapshot)
  const cancelAgain = await call('PATCH', `/api/bookings/${booking.id}/cancel`, guest.token, {})
  check('cancelling again -> 400 BOOKING_NOT_CANCELLABLE', cancelAgain.status === 400 && code(cancelAgain) === 'BOOKING_NOT_CANCELLABLE', cancelAgain)

  const finalize = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, admin.token, {})
  check('admin finalize: 200, rule HALF, no guest fee', finalize.status === 200 && finalize.j?.rule === 'HALF' && finalize.j?.feeCharged === false, finalize)
  const retained = paid - expectedRefund
  const c = Math.round(retained * 0.12)
  const h = retained - c
  const reversal = await entries(booking.id, 'booking_admin_share_reversal', 'DEBIT')
  const hostRelease = await entries(booking.id, 'booking_payout', 'RELEASE')
  check('finalize: commission reversed only for the refunded part (A - 12% of retained)', sum(reversal) === A - c, { got: sum(reversal), expected: A - c })
  check('finalize: host share of the retained amount (88%) RELEASED to the host', sum(hostRelease) === h, { got: sum(hostRelease), expected: h })
  check('finalize: no guest cancellation fee', (await entries(booking.id, 'booking_guest_cancel_fee')).length === 0, 'fee entry exists')

  const execute = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, admin.token, {})
  check('admin executes the refund (200, SUCCEEDED)', execute.status === 200 && execute.j?.refund?.status === 'SUCCEEDED', execute)
  const guestRefund = await entries(booking.id, 'booking_refund', 'REFUND')
  check('guest wallet REFUND entry = refund amount', sum(guestRefund) === expectedRefund, { got: sum(guestRefund) })
  const finalize2 = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, admin.token, {})
  check('finalize is idempotent (second call 200, no new entries)', finalize2.status === 200 && sum(await entries(booking.id, 'booking_admin_share_reversal', 'DEBIT')) === A - c && sum(await entries(booking.id, 'booking_payout', 'RELEASE')) === h, finalize2)

  const adminDelta = (await walletBalance(revenueUserId)) - adminBefore
  const hostDelta = (await walletBalance(host.id)) - hostBefore
  const guestDelta = (await walletBalance(guest.id)) - guestBefore
  check('balances: SYBNB keeps exactly 12% of the retained amount', adminDelta === c, { adminDelta, c })
  check('balances: host keeps exactly 88% of the retained amount', hostDelta === h, { hostDelta, h })
  check('balances: guest wallet got exactly the refund', guestDelta === expectedRefund, { guestDelta, expectedRefund })
  check('conservation: refund + SYBNB kept + host kept == amount paid', guestDelta + adminDelta + hostDelta === paid, { guestDelta, adminDelta, hostDelta, paid })

  // --- 4. Protected booking: guest cancel-quote early, then host DECLINE (100% incl. protection) ----
  console.log('\n--- 4. protected booking: FULL_MINUS_PROTECTION quote, host decline refunds everything ---')
  const pCreated = await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: dayFromToday(40), checkOut: dayFromToday(43), cancellationProtection: true })
  const pBooking = pCreated.j?.booking
  const F = Math.round(3 * PRICE * 0.03)
  check('protected booking: protection fee snapshotted = 3% of the full 3-night stay', pBooking?.metadata?.cancellationProtectionFeeMinor === F, pBooking?.metadata)
  const p = await payAndApprove(guest, admin, pBooking.id)
  check('protected booking: proof amount includes the protection fee', p.amountMinor === (await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${dayFromToday(40)}&checkOut=${dayFromToday(43)}&protection=1`, null)).j?.quote?.totalMinor, p.amountMinor)
  const pcq = (await call('GET', `/api/bookings/${pBooking.id}/cancel-quote`, guest.token)).j?.cancelQuote
  check('protected cancel-quote before check-in: FULL_MINUS_PROTECTION = paid - protection', pcq?.rule === 'FULL_MINUS_PROTECTION' && pcq?.refundMinor === p.amountMinor - F && pcq?.retainedMinor === F, pcq)
  const protectionCredit = await entries(pBooking.id, 'booking_protection_fee', 'CREDIT')
  check('approval: protection fee CREDITed to SYBNB', sum(protectionCredit) === F, sum(protectionCredit))
  const decline = await call('PATCH', `/api/host/requests/${pBooking.id}`, host.token, { decision: 'CANCEL' })
  check('host declines the paid request (CANCELLED)', decline.status === 200 && decline.j?.booking?.status === 'CANCELLED', decline)
  const pRefund = await db().refund.findFirst({ where: { paymentProofId: p.proofId } })
  check('host decline: refund request = 100% of paid incl. protection', pRefund?.amountMinor === p.amountMinor, pRefund)
  const pFinalize = await call('PATCH', `/api/admin/bookings/${pBooking.id}/finalize-cancellation`, admin.token, {})
  check('finalize (host decline): 200, cancelledBy HOST', pFinalize.status === 200 && pFinalize.j?.cancelledBy === 'HOST' && pFinalize.j?.rule === 'FULL', pFinalize)
  const pA = Math.round((p.amountMinor - F) * 0.12)
  check('finalize (host decline): full commission reversed', sum(await entries(pBooking.id, 'booking_admin_share_reversal', 'DEBIT')) === pA, sum(await entries(pBooking.id, 'booking_admin_share_reversal', 'DEBIT')))
  check('finalize (host decline): protection-fee credit reversed', sum(await entries(pBooking.id, 'booking_protection_fee_reversal', 'DEBIT')) === F, sum(await entries(pBooking.id, 'booking_protection_fee_reversal', 'DEBIT')))
  check('finalize (host decline): host gets nothing released', (await entries(pBooking.id, 'booking_payout', 'RELEASE')).length === 0, 'release exists')
  const pExec = await call('PATCH', `/api/admin/refunds/${pRefund.id}/execute`, admin.token, {})
  check('refund executed: guest credited everything incl. protection', pExec.status === 200 && sum(await entries(pBooking.id, 'booking_refund', 'REFUND')) === p.amountMinor, pExec)

  // --- 5. Unpaid expiry --------------------------------------------------------------------------
  console.log('\n--- 5. unpaid request expiry ---')
  const eIn = dayFromToday(60)
  const eOut = dayFromToday(62)
  const stale = (await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: eIn, checkOut: eOut })).j?.booking
  const blocked = await call('POST', '/api/bookings', guest2.token, { listingId: listing.id, checkIn: eIn, checkOut: eOut })
  check('a fresh unpaid request blocks its dates (409)', blocked.status === 409 && code(blocked) === 'BOOKING_DATES_UNAVAILABLE', blocked)
  await db().booking.update({ where: { id: stale.id }, data: { createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000) } })
  const avail = await call('GET', `/api/listings/${listing.id}/availability?from=${eIn}&to=${eOut}`, null)
  check('availability no longer shows the stale unpaid request as booked', avail.status === 200 && !(avail.j?.bookedRanges || []).some((r) => r.checkIn === eIn), avail.j?.bookedRanges)
  const rebook = await call('POST', '/api/bookings', guest2.token, { listingId: listing.id, checkIn: eIn, checkOut: eOut })
  check('another guest can book the same dates before the sweep runs (201)', rebook.status === 201, rebook)
  const lateProof = await call('POST', '/api/payments/local-wallet-proof', guest.token, { bookingId: stale.id, providerRef: `mf_late_${RUN}` })
  check('paying the expired request is refused (409 BOOKING_NOT_PAYABLE)', lateProof.status === 409 && code(lateProof) === 'BOOKING_NOT_PAYABLE', lateProof)
  const expired = await db().booking.findUnique({ where: { id: stale.id } })
  check('the stale request is CANCELLED with reason EXPIRED_UNPAID', expired.status === 'CANCELLED' && expired.metadata?.cancellationReason === 'EXPIRED_UNPAID', { status: expired.status, metadata: expired.metadata })
  check('expiry wrote an audit row', Boolean(await db().adminAuditLog.findFirst({ where: { entityId: stale.id, action: 'BOOKING_EXPIRED_UNPAID' } })), 'no audit row')
  // The read-path hook (GET /api/me/overview -> completeExpiredBookings) sweeps too.
  const stale2 = (await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: dayFromToday(70), checkOut: dayFromToday(71) })).j?.booking
  await db().booking.update({ where: { id: stale2.id }, data: { createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000) } })
  await call('GET', '/api/me/overview', guest.token)
  const swept = await db().booking.findUnique({ where: { id: stale2.id } })
  check('the lifecycle hook (guest overview) expires stale unpaid requests', swept.status === 'CANCELLED' && swept.metadata?.cancellationReason === 'EXPIRED_UNPAID', swept.status)
  const unpaidCancel = (await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: dayFromToday(80), checkOut: dayFromToday(81) })).j?.booking
  const uc = await call('PATCH', `/api/bookings/${unpaidCancel.id}/cancel`, guest.token, {})
  check('guest cancels an unpaid request: 200, rule UNPAID, nothing to refund', uc.status === 200 && uc.j?.refund?.rule === 'UNPAID' && uc.j?.refund?.refundMinor === 0, uc)

  // --- 6. Host payouts ---------------------------------------------------------------------------
  console.log('\n--- 6. host payout method + withdrawal requests ---')
  const noMethod = await call('GET', '/api/host/payout-method', host.token)
  check('no payout method yet -> method null', noMethod.status === 200 && noMethod.j?.method === null, noMethod)
  const noMethodRequest = await call('POST', '/api/host/payouts', host.token, { amountMinor: 1000 })
  check('requesting without a method -> 409 PAYOUT_METHOD_REQUIRED', noMethodRequest.status === 409 && code(noMethodRequest) === 'PAYOUT_METHOD_REQUIRED', noMethodRequest)
  const badMethod = await call('PUT', '/api/host/payout-method', host.token, { type: 'SHAM_CASH', accountName: 'Host' })
  check('SHAM_CASH without a number -> 400', badMethod.status === 400 && code(badMethod) === 'PAYOUT_METHOD_FIELD_REQUIRED', badMethod)
  const saved = await call('PUT', '/api/host/payout-method', host.token, { type: 'SHAM_CASH', shamCashNumber: '0991234567', accountName: 'MF Host', bankName: 'ignored' })
  check('save SHAM_CASH method -> only that type\'s fields stored', saved.status === 200 && saved.j?.method?.type === 'SHAM_CASH' && saved.j?.method?.shamCashNumber === '0991234567' && saved.j?.method?.bankName === undefined, saved)
  const asGuest = await call('GET', '/api/host/payouts', guest.token)
  check('a non-host cannot read host payouts (403)', asGuest.status === 403, asGuest)

  const balances = await call('GET', '/api/host/payouts', host.token)
  const released = sum(await db().walletEntry.findMany({ where: { wallet: { userId: host.id, currency: 'SYP' }, type: 'RELEASE', referenceType: 'booking_payout' } }))
  const hostFees = sum(await db().walletEntry.findMany({ where: { wallet: { userId: host.id, currency: 'SYP' }, type: 'DEBIT', referenceType: 'booking_host_cancel_fee' } }))
  const available = Math.min(released - hostFees, await walletBalance(host.id))
  check('available = released earnings - host fees (capped by wallet balance); nothing pending', balances.status === 200 && balances.j?.availableMinor === available && balances.j?.pendingMinor === 0 && balances.j?.currency === 'SYP', { got: balances.j, available })
  check('setup: host has a positive available balance from the HALF-cancel retained share', available > 200, available)

  const over = await call('POST', '/api/host/payouts', host.token, { amountMinor: available + 1 })
  check('over-withdrawal refused (409 PAYOUT_AMOUNT_EXCEEDS_AVAILABLE)', over.status === 409 && code(over) === 'PAYOUT_AMOUNT_EXCEEDS_AVAILABLE', over)
  const badAmount = await call('POST', '/api/host/payouts', host.token, { amountMinor: -5 })
  check('non-positive amount refused (400)', badAmount.status === 400, badAmount)
  const first = await call('POST', '/api/host/payouts', host.token, { amountMinor: available - 100 })
  check('withdrawal request created (201, REQUESTED, method snapshot)', first.status === 201 && first.j?.request?.status === 'REQUESTED' && first.j?.request?.method?.type === 'SHAM_CASH', first)
  check('creating a request moves no money', (await db().walletEntry.count({ where: { referenceType: 'host_payout_withdrawal', referenceId: first.j?.request?.id } })) === 0, 'entry exists')
  const overPending = await call('POST', '/api/host/payouts', host.token, { amountMinor: 101 })
  check('amount > available - pending refused (409)', overPending.status === 409 && code(overPending) === 'PAYOUT_AMOUNT_EXCEEDS_AVAILABLE', overPending)
  const second = await call('POST', '/api/host/payouts', host.token, { amountMinor: 100 })
  check('a second request up to available - pending is accepted', second.status === 201, second)
  const afterRequests = (await call('GET', '/api/host/payouts', host.token)).j
  check('host view: pending = sum of open requests, both listed', afterRequests?.pendingMinor === available && afterRequests?.requests?.length === 2, afterRequests)

  const list = await call('GET', '/api/admin/payout-requests?status=REQUESTED', admin.token)
  const listed = list.j?.requests?.find((r) => r.id === first.j?.request?.id)
  check('admin list shows the request with host + method details', list.status === 200 && listed?.host?.id === host.id && listed?.method?.shamCashNumber === '0991234567', listed)
  const hostCannot = await call('PATCH', `/api/admin/payout-requests/${first.j?.request?.id}`, host.token, { action: 'paid', reference: 'x' })
  check('a host cannot mark their own payout paid (403)', hostCannot.status === 403, hostCannot)
  const noRef = await call('PATCH', `/api/admin/payout-requests/${first.j?.request?.id}`, admin.token, { action: 'paid' })
  check('marking paid without a reference -> 400 PAYOUT_REFERENCE_REQUIRED', noRef.status === 400 && code(noRef) === 'PAYOUT_REFERENCE_REQUIRED', noRef)
  const hostWalletBefore = await walletBalance(host.id)
  const paidRes = await call('PATCH', `/api/admin/payout-requests/${first.j?.request?.id}`, admin.token, { action: 'paid', reference: `SHAM-${RUN}` })
  check('admin marks PAID (200, reference stored)', paidRes.status === 200 && paidRes.j?.request?.status === 'PAID' && paidRes.j?.request?.reference === `SHAM-${RUN}`, paidRes)
  const debit = await db().walletEntry.findMany({ where: { referenceType: 'host_payout_withdrawal', referenceId: first.j?.request?.id } })
  check('PAID posts exactly one DEBIT of the request amount', debit.length === 1 && debit[0].type === 'DEBIT' && debit[0].amountMinor === available - 100, debit)
  check('host wallet balance decreased by exactly the paid amount', (await walletBalance(host.id)) === hostWalletBefore - (available - 100), { before: hostWalletBefore, after: await walletBalance(host.id) })
  const paidAgain = await call('PATCH', `/api/admin/payout-requests/${first.j?.request?.id}`, admin.token, { action: 'paid', reference: 'again' })
  check('marking the same request paid twice -> 409, no second DEBIT', paidAgain.status === 409 && (await db().walletEntry.count({ where: { referenceType: 'host_payout_withdrawal', referenceId: first.j?.request?.id } })) === 1, paidAgain)
  const noNote = await call('PATCH', `/api/admin/payout-requests/${second.j?.request?.id}`, admin.token, { action: 'reject' })
  check('reject without a reason -> 400 PAYOUT_NOTE_REQUIRED', noNote.status === 400 && code(noNote) === 'PAYOUT_NOTE_REQUIRED', noNote)
  const rejected = await call('PATCH', `/api/admin/payout-requests/${second.j?.request?.id}`, admin.token, { action: 'reject', note: 'Number does not match account name' })
  check('reject: REJECTED with note, no wallet entry', rejected.status === 200 && rejected.j?.request?.status === 'REJECTED' && (await db().walletEntry.count({ where: { referenceType: 'host_payout_withdrawal', referenceId: second.j?.request?.id } })) === 0, rejected)
  const finalView = (await call('GET', '/api/host/payouts', host.token)).j
  check('after PAID + REJECTED: available = 100, nothing pending', finalView?.availableMinor === 100 && finalView?.pendingMinor === 0, finalView)
  const overAfter = await call('POST', '/api/host/payouts', host.token, { amountMinor: 101 })
  check('cannot withdraw already-paid money again (409)', overAfter.status === 409, overAfter)

  // --- 7. Review fixes ---------------------------------------------------------------------------
  console.log('\n--- 7a. no cancellation once the stay has ended ---')
  const ended = (await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: dayFromToday(90), checkOut: dayFromToday(92) })).j?.booking
  await payAndApprove(guest, admin, ended.id)
  await call('PATCH', `/api/host/requests/${ended.id}`, host.token, { decision: 'CONFIRM', acceptedTerms: true })
  await db().booking.update({ where: { id: ended.id }, data: { checkIn: new Date(dayFromToday(-5)), checkOut: new Date(dayFromToday(-2)) } })
  const endedQuote = await call('GET', `/api/bookings/${ended.id}/cancel-quote`, guest.token)
  check('cancel-quote after check-out -> 409 BOOKING_STAY_ENDED', endedQuote.status === 409 && code(endedQuote) === 'BOOKING_STAY_ENDED', endedQuote)
  const endedCancel = await call('PATCH', `/api/bookings/${ended.id}/cancel`, guest.token, {})
  check('guest cancel after check-out -> 409 BOOKING_STAY_ENDED (no 50% refund of a used stay)', endedCancel.status === 409 && code(endedCancel) === 'BOOKING_STAY_ENDED', endedCancel)
  const endedHostCancel = await call('PATCH', `/api/host/requests/${ended.id}`, host.token, { decision: 'CANCEL' })
  check('host cancel after check-out -> 409 BOOKING_STAY_ENDED', endedHostCancel.status === 409 && code(endedHostCancel) === 'BOOKING_STAY_ENDED', endedHostCancel)
  const endedAfter = await db().booking.findUnique({ where: { id: ended.id } })
  check('the ended stay was not cancelled and no refund request exists', endedAfter.status !== 'CANCELLED' && !(await db().refund.findFirst({ where: { bookingId: ended.id } })), endedAfter.status)

  console.log('\n--- 7b. a proof cannot advance a booking that is no longer awaiting payment ---')
  const raced = (await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: dayFromToday(100), checkOut: dayFromToday(101) })).j?.booking
  const racedProof = await call('POST', '/api/payments/local-wallet-proof', guest.token, { bookingId: raced.id, providerRef: `mf_race_${RUN}` })
  await db().booking.update({ where: { id: raced.id }, data: { status: 'REQUESTED' } }) // simulates a concurrent state change
  const racedApprove = await call('PATCH', `/api/admin/review-queue/payment/${racedProof.j?.proof?.id}`, admin.token, {
    decision: 'APPROVE',
    shamCashReconciliation: { accountMinor: racedProof.j?.proof?.amountMinor, expectedMinor: racedProof.j?.proof?.amountMinor, differenceMinor: 0 },
  })
  check('approval refused with 409 BOOKING_STATE_CHANGED', racedApprove.status === 409 && code(racedApprove) === 'BOOKING_STATE_CHANGED', racedApprove)
  check('no HOLD/commission posted and the proof stayed under review', (await entries(raced.id, 'booking_payout')).length === 0 && (await entries(raced.id, 'booking_admin_share')).length === 0 && (await db().paymentProof.findUnique({ where: { id: racedProof.j?.proof?.id } }))?.status === 'PENDING_ADMIN_REVIEW', 'ledger touched')

  console.log('\n--- 7c. card money arriving for a cancelled booking is recorded + refunded, not dropped ---')
  if (process.env.PAYMENT_INTENTS_ENABLED === 'true') {
    const closed = (await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: dayFromToday(110), checkOut: dayFromToday(111) })).j?.booking
    const intent = (await call('POST', '/api/payments/intents', guest.token, { bookingId: closed.id })).j?.intent
    check('setup: payment intent created', Boolean(intent?.reference), intent)
    const closedCancel = await call('PATCH', `/api/bookings/${closed.id}/cancel`, guest.token, {})
    check('setup: guest cancels the unpaid booking', closedCancel.status === 200, closedCancel)
    const secret = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_sandbox_test'
    const sendEvent = async (type, extra) => {
      const payload = JSON.stringify({ id: `evt_mf_${RUN}_${type}`, type, data: { object: { reference: intent.reference, id: `pi_mf_${RUN}`, ...extra } } })
      const res = await fetch(API + '/api/payments/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret) }, body: payload })
      return res.status
    }
    const succStatus = await sendEvent('payment_intent.succeeded', { amount_minor: intent.amountMinor, currency: intent.currency })
    check('late succeeded webhook accepted (200)', succStatus === 200, succStatus)
    const lateProof = await db().paymentProof.findFirst({ where: { provider: 'payment_intent', providerRef: intent.reference } })
    check('the payment is recorded (proof REFUNDED, linked to the booking)', lateProof?.status === 'REFUNDED' && lateProof?.bookingId === closed.id && lateProof?.amountMinor === intent.amountMinor, lateProof)
    const lateRefund = lateProof ? await db().refund.findFirst({ where: { paymentProofId: lateProof.id } }) : null
    check('a refund is open for the full amount (PAYMENT_AFTER_BOOKING_CLOSED, IN_PROGRESS)', lateRefund?.reasonCode === 'PAYMENT_AFTER_BOOKING_CLOSED' && lateRefund?.status === 'IN_PROGRESS' && lateRefund?.amountMinor === intent.amountMinor, lateRefund)
    check('the cancelled booking was not resurrected and no ledger effect was posted', (await db().booking.findUnique({ where: { id: closed.id } })).status === 'CANCELLED' && (await entries(closed.id, 'booking_payout')).length === 0, 'booking/ledger changed')
    check('an audit row records it', Boolean(lateProof && await db().adminAuditLog.findFirst({ where: { entityId: lateProof.id, action: 'PAYMENT_RECEIVED_FOR_CLOSED_BOOKING' } })), 'no audit row')
    const adminRefunds = await call('GET', '/api/admin/refunds?status=IN_PROGRESS', admin.token)
    check('it is visible in the admin refund list', adminRefunds.j?.refunds?.some((r) => r.id === lateRefund?.id), adminRefunds.status)
    const refundStatus = await sendEvent('charge.refunded', { amount_minor: intent.amountMinor })
    const settled = lateRefund ? await db().refund.findUnique({ where: { id: lateRefund.id } }) : null
    check('provider refund webhook closes it (refund SUCCEEDED)', refundStatus === 200 && settled?.status === 'SUCCEEDED', { refundStatus, settled })
  } else {
    console.log('   (skipped: PAYMENT_INTENTS_ENABLED is not true in this environment)')
  }

  console.log(`\n==== BOOKING MONEY FLOW E2E: ${pass} passed, ${fail} failed ====`)
}

try {
  await main()
} catch (error) {
  fail++
  console.error('UNCAUGHT', error)
  console.log(`\n==== BOOKING MONEY FLOW E2E: ${pass} passed, ${fail} failed ====`)
} finally {
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
