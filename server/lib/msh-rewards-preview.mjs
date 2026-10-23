// A read-only projection. Never awards tokens, redeems points, or writes a money ledger.
export const MSH_ACTIVITY_LIMIT = 100
const proofSelect = { status: true, amountMinor: true, currency: true, reservedRefundMinor: true, succeededRefundMinor: true, acceptedRefundMinor: true }
export function activityPreview(userId, stays, rides) {
  if (typeof userId !== 'string' || !userId) throw new Error('Authenticated account required')
  const entries = new Map()
  for (const [kind, rows] of [['stay', stays], ['ride', rides]]) {
    for (const row of rows.slice(0, MSH_ACTIVITY_LIMIT)) {
      if (row.status !== 'COMPLETED' || (kind === 'stay' ? row.guestId : row.riderId) !== userId) continue
      const key = `${kind}:${row.id}`
      if (entries.has(key)) continue
      const proofs = kind === 'stay' ? row.payments : row.paymentProofs
      const amount = kind === 'stay' ? row.amountMinor : row.fareMinor
      let reason = 'payment'
      const refunded = proofs?.some(p => p.status === 'REFUNDED' || [p.reservedRefundMinor, p.succeededRefundMinor, p.acceptedRefundMinor].some(n => n > 0))
      const paid = (proofs || []).filter(p => p.status === 'APPROVED' && p.currency === row.currency && Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0).reduce((sum, p) => sum + p.amountMinor, 0)
      if (refunded) reason = 'refund'
      else if (Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(paid) && paid >= amount) reason = 'eligible'
      entries.set(key, { reference: key, kind, eligibility: reason })
    }
  }
  return {
    mode: 'draft', enabled: false, issuedTokens: 0, redeemableTokens: 0,
    rule: null, limitPerService: MSH_ACTIVITY_LIMIT,
    truncated: stays.length > MSH_ACTIVITY_LIMIT || rides.length > MSH_ACTIVITY_LIMIT,
    entries: [...entries.values()],
  }
}
export async function readRewardsActivity(database, userId) {
  if (typeof userId !== 'string' || !userId) throw new Error('Authenticated account required')
  return database.$transaction(async tx => {
    const stays = await tx.booking.findMany({ where: { guestId: userId, status: 'COMPLETED' }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: MSH_ACTIVITY_LIMIT + 1,
      select: { id: true, guestId: true, status: true, amountMinor: true, currency: true, payments: { select: proofSelect } } })
    const rides = await tx.rideRequest.findMany({ where: { riderId: userId, status: 'COMPLETED' }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: MSH_ACTIVITY_LIMIT + 1,
      select: { id: true, riderId: true, status: true, fareMinor: true, currency: true, paymentProofs: { select: proofSelect } } })
    return activityPreview(userId, stays, rides)
  }, { isolationLevel: 'RepeatableRead' })
}
