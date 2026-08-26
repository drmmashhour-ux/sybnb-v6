// SYBNB — Item 2 Phase 2a: one-shot legacy-refund backfill.
//
// Populates Refund/RefundAttempt rows for every pre-existing REFUNDED PaymentProof, using the
// SAME six-way classification algorithm independently reviewed and verified across the Item 2
// design cycle (Revision 6 onward; verified counts 49/1/51/43/0/0, stable through Revision 10).
// The classification pass below is a direct adaptation of that reviewed script
// (verify_legacy_refund_classification.mjs) -- same evidence sources, same matching rules, same
// idempotencyKey() import (not reimplemented) -- extended here to WRITE the backfilled rows
// instead of only reporting counts.
//
// Runs read-only classification FIRST, over the whole dataset, and aborts entirely (zero writes)
// if any row comes back ambiguous or unclassified -- this script never guesses. Only if every row
// classifies cleanly does it open a single database transaction and write every Refund/
// RefundAttempt/PaymentProof-counter/PaymentEvent-linkage row atomically: either all 144 rows
// migrate, or none do.
//
// Two judgment calls this backfill makes that were NOT already settled by the design document
// (which specified the six-way classification and the CHECK-constraint shapes, but not a
// row-by-row Refund construction), reported here explicitly for reviewer sign-off:
//
//   1. reasonCode: for wallet-matched buckets (wallet_verified_exact,
//      wallet_verified_protection_fee_adjusted) the matched idempotencyKey prefix positively
//      identifies which of the three known code paths recorded the refund, so reasonCode is
//      derived deterministically (booking-refund -> HOST_CANCELLED, booking-guest-cancel-refund
//      -> GUEST_CANCELLED, booking-admin-reject-refund -> ADMIN_REJECTED_BOOKING). For the two
//      card-rail buckets (provider_event_verified_amount_unpopulated, unverified_card), NO source
//      route is recoverable from either the WalletEntry ledger (none exists) or the PaymentEvent
//      (a payment-gateway artifact with no record of which internal route triggered it) -- so
//      reasonCode is set to the literal string 'LEGACY_UNKNOWN', a value NOT registered in
//      REFUND_ELIGIBILITY_POLICY's closed catalogue (payment-policy.mjs) and never intended to be
//      used by any live code path -- reasonCode is a plain `text` column, not a database enum, so
//      this does not require a schema change, but it is a new value a reviewer has not yet seen.
//   2. LEGACY_UNVERIFIED rows (the unverified_card bucket, 43 of 144) have no accept-transaction
//      path in the approved Revision 10 design -- legacy_refund_accept's Step 2 matches only
//      status='LEGACY_PENDING_CONFIRMATION'. These rows are backfilled as Refund.status=
//      ACTION_REQUIRED / reservationHeld=true, matching every other unresolved legacy row, but
//      NO automated path exists yet to ever resolve them out of that state -- resolving a
//      zero-evidence historical refund claim is a genuinely harder problem, explicitly out of
//      Phase 2a's scope. They will sit at ACTION_REQUIRED indefinitely until a future phase
//      designs that path. This is flagged, not silently decided.
//
// Requires DATABASE_URL. Makes writes only inside one all-or-nothing transaction.
//
//   DATABASE_URL=... node scripts/migrate-legacy-refunds-2a.mjs [--dry-run]

import { PrismaClient } from '@prisma/client'
import { idempotencyKey } from '../server/lib/security.mjs'

const DRY_RUN = process.argv.includes('--dry-run')
const db = new PrismaClient()

const KNOWN_KEY_PREFIXES = [
  { source: 'host.mjs (host-cancel)', prefix: 'booking-refund', reasonCode: 'HOST_CANCELLED' },
  { source: 'bookings.mjs (guest-cancel)', prefix: 'booking-guest-cancel-refund', reasonCode: 'GUEST_CANCELLED' },
  { source: 'admin.mjs (admin-reject)', prefix: 'booking-admin-reject-refund', reasonCode: 'ADMIN_REJECTED_BOOKING' },
]
const MANUAL_FAMILY = new Set(['manual', 'syrian_local_wallet', 'sham_cash'])
const CARD_FAMILY = ['payment_intent', 'stripe', 'card']

async function classify(proof) {
  const matchedKeys = []
  for (const { source, prefix, reasonCode } of KNOWN_KEY_PREFIXES) {
    const key = idempotencyKey([prefix, proof.bookingId, proof.id])
    const entry = await db.walletEntry.findUnique({ where: { idempotencyKey: key }, include: { wallet: true } })
    if (entry) matchedKeys.push({ source, reasonCode, key, entry })
  }

  let eventEvidence = null
  let matchedIntent = null
  if (CARD_FAMILY.includes(proof.provider)) {
    matchedIntent = proof.providerRef ? await db.paymentIntent.findFirst({ where: { reference: proof.providerRef } }) : null
    if (matchedIntent) {
      const events = await db.paymentEvent.findMany({
        where: { intentId: matchedIntent.id, type: 'charge.refunded', processingStatus: 'APPLIED' },
      })
      if (events.length === 1) eventEvidence = events[0]
      else if (events.length > 1) eventEvidence = { AMBIGUOUS_MULTIPLE: events.length }
    }
  }

  const hasWalletMatch = matchedKeys.length === 1
  const hasAmbiguousWalletMatch = matchedKeys.length > 1
  const hasEventEvidence = eventEvidence && !eventEvidence.AMBIGUOUS_MULTIPLE
  const hasAmbiguousEventEvidence = eventEvidence && eventEvidence.AMBIGUOUS_MULTIPLE

  if (hasAmbiguousWalletMatch || hasAmbiguousEventEvidence) {
    return { bucket: 'ambiguous', reason: hasAmbiguousWalletMatch ? `${matchedKeys.length} exact-key wallet matches` : `${eventEvidence.AMBIGUOUS_MULTIPLE} APPLIED charge.refunded events` }
  }
  if (hasWalletMatch && hasEventEvidence) {
    return { bucket: 'ambiguous', reason: 'matches BOTH wallet and provider-event evidence' }
  }

  if (hasWalletMatch) {
    if (!MANUAL_FAMILY.has(proof.provider)) {
      return { bucket: 'ambiguous', reason: `wallet-keyed evidence found but proof.provider='${proof.provider}' is not in the manual-family allowlist` }
    }
    const { entry, source, reasonCode } = matchedKeys[0]
    const exact = entry.amountMinor === proof.amountMinor && entry.currency === proof.currency && entry.wallet.userId === proof.userId
    if (exact) {
      return { bucket: 'wallet_verified_exact', entry, source, reasonCode }
    }
    const booking = await db.booking.findUnique({ where: { id: proof.bookingId }, select: { metadata: true } })
    const purchased = booking?.metadata?.cancellationProtectionPurchased === true
    const feeMinor = purchased ? Number(booking.metadata.cancellationProtectionFeeMinor || 0) : 0
    const expectedAdjusted = proof.amountMinor - feeMinor
    const beneficiaryOk = entry.wallet.userId === proof.userId
    const currencyOk = entry.currency === proof.currency
    if (purchased && beneficiaryOk && currencyOk && entry.amountMinor === expectedAdjusted) {
      return { bucket: 'wallet_verified_protection_fee_adjusted', entry, source, reasonCode }
    }
    return { bucket: 'ambiguous', reason: `wallet entry found (source: ${source}) but amount ${entry.amountMinor} matches neither exact (${proof.amountMinor}) nor protection-fee-adjusted (${expectedAdjusted}) pattern; currencyOk=${currencyOk} beneficiaryOk=${beneficiaryOk}` }
  }

  if (hasEventEvidence) {
    const amountPopulated = eventEvidence.amountMinor != null && eventEvidence.currency != null
    if (amountPopulated) {
      return { bucket: 'ambiguous', reason: 'provider event has amount/currency populated -- new tier not yet defined, flagging rather than guessing' }
    }
    return { bucket: 'provider_event_verified_amount_unpopulated', event: eventEvidence }
  }

  if (CARD_FAMILY.includes(proof.provider)) {
    return { bucket: 'unverified_card' }
  }

  return { bucket: 'unclassified', provider: proof.provider, adminNote: proof.adminNote }
}

async function main() {
  const startedAt = new Date().toISOString()
  const refunded = await db.paymentProof.findMany({
    where: { status: 'REFUNDED' },
    orderBy: { id: 'asc' },
  })

  const classified = []
  const counts = { wallet_verified_exact: 0, wallet_verified_protection_fee_adjusted: 0, provider_event_verified_amount_unpopulated: 0, unverified_card: 0, ambiguous: 0, unclassified: 0 }
  for (const proof of refunded) {
    const result = await classify(proof)
    counts[result.bucket]++
    classified.push({ proof, result })
  }

  const blocking = classified.filter((c) => c.result.bucket === 'ambiguous' || c.result.bucket === 'unclassified')
  console.log(JSON.stringify({ ok: blocking.length === 0, phase: 'classification', startedAt, totalRefundedProofs: refunded.length, counts }, null, 2))
  if (blocking.length) {
    console.log(JSON.stringify({ ok: false, phase: 'classification', blockingRows: blocking.map((c) => ({ proofId: c.proof.id, bucket: c.result.bucket, reason: c.result.reason })) }, null, 2))
    console.error('ABORTING: at least one row is ambiguous or unclassified. Zero writes made.')
    await db.$disconnect()
    process.exitCode = 1
    return
  }

  if (DRY_RUN) {
    console.log(JSON.stringify({ ok: true, phase: 'dry-run-complete', note: 'Classification is clean; --dry-run set, so no writes were made.' }))
    await db.$disconnect()
    return
  }

  const writeSummary = { refundsCreated: 0, attemptsCreated: 0, paymentEventsLinked: 0 }

  await db.$transaction(async (tx) => {
    for (const { proof, result } of classified) {
      const existingActive = await tx.refund.findFirst({ where: { paymentProofId: proof.id } })
      if (existingActive) {
        throw new Error(`INVARIANT VIOLATION: payment_proof ${proof.id} already has a refund row -- backfill must only run once against a table with zero pre-existing refunds`)
      }

      if (result.bucket === 'wallet_verified_exact' || result.bucket === 'wallet_verified_protection_fee_adjusted') {
        const { entry, reasonCode } = result
        const refund = await tx.refund.create({
          data: {
            paymentProofId: proof.id,
            bookingId: proof.bookingId,
            requestedByUserId: null,
            amountMinor: entry.amountMinor,
            currency: entry.currency,
            reason: `Legacy refund migrated from wallet ledger evidence (Item 2 Phase 2a, bucket=${result.bucket})`,
            reasonCode,
            rail: proof.provider,
            status: 'SUCCEEDED',
            reservationHeld: false,
            migratedFromLegacy: true,
            succeededAt: entry.createdAt,
          },
        })
        await tx.refundAttempt.create({
          data: {
            refundId: refund.id,
            status: 'SUCCEEDED',
            migratedFromLegacy: true,
            completedAt: entry.createdAt,
            legacyWalletEntryId: entry.id,
          },
        })
        await tx.paymentProof.update({
          where: { id: proof.id },
          data: { succeededRefundMinor: { increment: entry.amountMinor } },
        })
        writeSummary.refundsCreated++
        writeSummary.attemptsCreated++
        continue
      }

      if (result.bucket === 'provider_event_verified_amount_unpopulated') {
        const { event } = result
        const refund = await tx.refund.create({
          data: {
            paymentProofId: proof.id,
            bookingId: proof.bookingId,
            requestedByUserId: null,
            amountMinor: proof.amountMinor,
            currency: proof.currency,
            reason: 'Legacy refund migrated -- provider charge.refunded event found (APPLIED) but amount/currency were not populated on that event; requires owner confirmation via legacy_refund_accept (Item 2 Phase 2a)',
            reasonCode: 'LEGACY_UNKNOWN',
            rail: proof.provider,
            status: 'ACTION_REQUIRED',
            reservationHeld: true,
            migratedFromLegacy: true,
          },
        })
        const attempt = await tx.refundAttempt.create({
          data: {
            refundId: refund.id,
            status: 'LEGACY_PENDING_CONFIRMATION',
            migratedFromLegacy: true,
            completedAt: event.receivedAt,
            legacyPaymentEventId: event.id,
          },
        })
        await tx.paymentProof.update({
          where: { id: proof.id },
          data: { reservedRefundMinor: { increment: proof.amountMinor } },
        })
        await tx.paymentEvent.update({
          where: { id: event.id },
          data: {
            refundId: refund.id,
            originalRefundId: refund.id,
            refundAttemptId: attempt.id,
            originalRefundAttemptId: attempt.id,
          },
        })
        writeSummary.refundsCreated++
        writeSummary.attemptsCreated++
        writeSummary.paymentEventsLinked++
        continue
      }

      if (result.bucket === 'unverified_card') {
        const refund = await tx.refund.create({
          data: {
            paymentProofId: proof.id,
            bookingId: proof.bookingId,
            requestedByUserId: null,
            amountMinor: proof.amountMinor,
            currency: proof.currency,
            reason: 'Legacy refund migrated -- proof marked REFUNDED historically but no corroborating wallet or provider-event evidence could be found (Item 2 Phase 2a). No automated acceptance path exists for this bucket yet.',
            reasonCode: 'LEGACY_UNKNOWN',
            rail: proof.provider,
            status: 'ACTION_REQUIRED',
            reservationHeld: true,
            migratedFromLegacy: true,
          },
        })
        await tx.refundAttempt.create({
          data: {
            refundId: refund.id,
            status: 'LEGACY_UNVERIFIED',
            migratedFromLegacy: true,
            completedAt: proof.reviewedAt || proof.updatedAt || proof.createdAt,
          },
        })
        await tx.paymentProof.update({
          where: { id: proof.id },
          data: { reservedRefundMinor: { increment: proof.amountMinor } },
        })
        writeSummary.refundsCreated++
        writeSummary.attemptsCreated++
        continue
      }

      throw new Error(`UNREACHABLE: bucket ${result.bucket} for proof ${proof.id} reached the write phase without a handler`)
    }
  })

  console.log(JSON.stringify({ ok: true, phase: 'write-complete', finishedAt: new Date().toISOString(), writeSummary }, null, 2))
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect()
  process.exitCode = 1
})
