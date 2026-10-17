// Waiving a rider's cancellation / no-show fee after the rider contested it (2026-10-17).
//
// Money rules, all inside the caller's transaction:
//  * Whatever the driver was credited for this ride's fee is debited back (reverseRidePayment; it may
//    push the driver wallet negative, the same receivable rule used by every other reversal).
//  * Prepaid ride: the rider only got back (prepaid - fee) at cancellation, so the fee part is
//    credited back to the rider's wallet now. Idempotent through the wallet idempotency key.
//  * The ride's cancellationFeeMinor is set to NULL (never 0: the payment gate admits any CANCELLED
//    ride whose fee is "not null", and 0 would still look payable).
//  * A fee the rider already paid by manual proof was money received outside the wallet; the wallet
//    side is reversed, but handing the cash back is a manual step, flagged in the result.
import { recordWalletEntry, reverseRidePayment } from './finance-ledger.mjs'

export async function waiveRideCancellationFee(tx, { ride, reason }) {
  const feeMinor = Math.max(0, Math.round(ride.cancellationFeeMinor || 0))
  if (!feeMinor) return { waivedMinor: 0, reversal: null, riderCreditedMinor: 0, needsManualRefund: false }
  const reversal = await reverseRidePayment(tx, { rideId: ride.id, reason: `Fee waived: ${reason}` })
  let riderCreditedMinor = 0
  const prepaid = Boolean(ride.metadata && ride.metadata.prepaid)
  if (prepaid) {
    const entry = await recordWalletEntry(tx, {
      userId: ride.riderId,
      type: 'REFUND',
      amountMinor: feeMinor,
      currency: ride.currency,
      referenceType: 'ride_cancellation_fee_waived',
      referenceId: ride.id,
      keyParts: ['ride-fee-waived', ride.id],
      note: `Cancellation fee waived after contest: ${reason}`,
    })
    riderCreditedMinor = entry ? feeMinor : 0
  }
  const needsManualRefund = !prepaid && reversal.reversedEntries > 0
  await tx.rideRequest.update({ where: { id: ride.id }, data: { cancellationFeeMinor: null } })
  return { waivedMinor: feeMinor, reversal, riderCreditedMinor, needsManualRefund }
}
