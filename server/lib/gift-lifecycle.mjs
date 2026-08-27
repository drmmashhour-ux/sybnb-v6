import { db } from './prisma.mjs'
import { recordWalletEntry } from './finance-ledger.mjs'

// A gift with no claim before its expiry previously just sat there forever — the sender's money,
// debited at creation, had no way back. There is no scheduler in this deployment, so this runs
// opportunistically from read paths that touch gifts (claim attempts, the admin review queue),
// the same pattern completeExpiredBookings() uses for bookings.
export async function expireStaleWalletGifts() {
  const now = new Date()
  // Scale-readiness audit: no orderBy meant Postgres didn't guarantee which 100 expired-but-
  // unprocessed gifts got swept on any given call. Harmless for a healthy sweep rate (processed
  // rows leave the where filter regardless of order), but without ordering there's no deterministic
  // catch-up if the backlog ever grows faster than incidental read-path traffic sweeps it -- oldest-
  // expired-first ensures a real backlog drains in a predictable order instead of an arbitrary one.
  const expired = await db().walletGift.findMany({
    where: {
      status: { in: ['SENT', 'CLAIM_PENDING', 'LOCKED'] },
      expiresAt: { lt: now },
    },
    select: { id: true, senderUserId: true, amountMinor: true, currency: true, status: true },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  })

  for (const gift of expired) {
    await db().$transaction(async (tx) => {
      // Re-check status in the WHERE clause: if a concurrent claim or admin decision already moved
      // this gift out of the state we read it in, back off rather than double-refund or overwrite
      // a legitimate claim.
      const updated = await tx.walletGift.updateMany({
        where: { id: gift.id, status: gift.status },
        data: { status: 'EXPIRED' },
      })
      if (updated.count === 0) return

      await recordWalletEntry(tx, {
        userId: gift.senderUserId,
        type: 'REFUND',
        amountMinor: gift.amountMinor,
        currency: gift.currency,
        referenceType: 'wallet_gift_expired',
        referenceId: gift.id,
        keyParts: ['wallet-gift-expired-refund', gift.id],
        note: 'Wallet gift expired unclaimed; sender refunded.',
      })
    })
  }

  return expired.length
}
