import test from 'node:test'
import assert from 'node:assert/strict'
import { refundPrepaidRide } from '../../server/lib/finance-ledger.mjs'
import { waiveRideCancellationFee } from '../../server/lib/ride-fee-waiver.mjs'

// Minimal in-memory stand-in for the Prisma transaction client (wallets, wallet entries, ride row).
function fakeTx() {
  const wallets = []
  const entries = []
  const rides = new Map()
  let n = 0
  const walletBy = (where) => wallets.find((w) => (where.id ? w.id === where.id : w.userId === where.userId_currency.userId && w.currency === where.userId_currency.currency))
  const match = (e, where) => Object.entries(where).every(([k, v]) => {
    if (k === 'wallet') return true
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(e[k])
    return e[k] === v
  })
  return {
    wallets, entries, rides,
    wallet: {
      upsert: async ({ where, create }) => walletBy(where) || (wallets.push({ id: `w${++n}`, ...create }), wallets[wallets.length - 1]),
      update: async ({ where, data }) => {
        const w = walletBy(where)
        const d = data.cachedBalanceMinor
        w.cachedBalanceMinor += d.increment ? d.increment : -d.decrement
        return w
      },
      updateMany: async ({ where, data }) => {
        const w = wallets.find((x) => x.id === where.id)
        if (!w || w.cachedBalanceMinor < where.cachedBalanceMinor.gte) return { count: 0 }
        w.cachedBalanceMinor -= data.cachedBalanceMinor.decrement
        return { count: 1 }
      },
    },
    walletEntry: {
      findUnique: async ({ where }) => entries.find((e) => e.idempotencyKey === where.idempotencyKey) || null,
      findFirst: async ({ where }) => entries.find((e) => match(e, where)) || null,
      findMany: async ({ where }) => entries.filter((e) => match(e, where)).map((e) => ({ ...e, wallet: wallets.find((w) => w.id === e.walletId) })),
      create: async ({ data }) => (entries.push({ id: `e${++n}`, ...data }), entries[entries.length - 1]),
    },
    rideRequest: { update: async ({ where, data }) => Object.assign(rides.get(where.id), data) },
  }
}

const balance = (tx, userId) => tx.wallets.find((w) => w.userId === userId)?.cachedBalanceMinor ?? 0

test('prepaid cancelled ride: waiving the fee returns the whole prepayment to the rider and nets the driver to zero', async () => {
  const tx = fakeTx()
  const ride = { id: 'r1', riderId: 'rider', driverId: 'driver', currency: 'USD', fareMinor: 1000, cancellationFeeMinor: 1000, metadata: { prepaid: true, prepaidAmountMinor: 1000 } }
  tx.rides.set(ride.id, ride)
  await refundPrepaidRide(tx, { ride }) // cancellation: fee 100% -> driver credited 1000, rider refund 0
  assert.equal(balance(tx, 'driver'), 1000)
  assert.equal(balance(tx, 'rider'), 0)

  const out = await waiveRideCancellationFee(tx, { ride, reason: 'test' })
  assert.equal(out.waivedMinor, 1000)
  assert.equal(out.riderCreditedMinor, 1000)
  assert.equal(balance(tx, 'driver'), 0)
  assert.equal(balance(tx, 'rider'), 1000)
  assert.equal(tx.rides.get('r1').cancellationFeeMinor, null)

  // idempotent: a second waive moves no money
  await waiveRideCancellationFee(tx, { ride: { ...ride, cancellationFeeMinor: 1000 }, reason: 'again' })
  assert.equal(balance(tx, 'driver'), 0)
  assert.equal(balance(tx, 'rider'), 1000)
})

test('partial fee on a prepaid ride (15%): rider ends with the full prepayment back', async () => {
  const tx = fakeTx()
  const ride = { id: 'r2', riderId: 'rider', driverId: 'driver', currency: 'USD', fareMinor: 2000, cancellationFeeMinor: 300, metadata: { prepaid: true, prepaidAmountMinor: 2000 } }
  tx.rides.set(ride.id, ride)
  await refundPrepaidRide(tx, { ride })
  assert.equal(balance(tx, 'rider'), 1700)
  assert.equal(balance(tx, 'driver'), 300)
  await waiveRideCancellationFee(tx, { ride, reason: 'test' })
  assert.equal(balance(tx, 'rider'), 2000)
  assert.equal(balance(tx, 'driver'), 0)
})

test('unpaid (non-prepaid) ride: fee is cleared, no wallet movement, no manual refund needed', async () => {
  const tx = fakeTx()
  const ride = { id: 'r3', riderId: 'rider', driverId: 'driver', currency: 'USD', fareMinor: 1000, cancellationFeeMinor: 1000, metadata: {} }
  tx.rides.set(ride.id, ride)
  const out = await waiveRideCancellationFee(tx, { ride, reason: 'test' })
  assert.equal(out.needsManualRefund, false)
  assert.equal(tx.wallets.length, 0)
  assert.equal(tx.rides.get('r3').cancellationFeeMinor, null)
})
