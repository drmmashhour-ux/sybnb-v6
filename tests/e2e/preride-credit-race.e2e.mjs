// Card pre-ride / top-up credit under concurrency (scale work, 2026-10-22). Stripe redelivers webhooks
// and the rider's browser confirms the same payment at the same moment; the three credit paths all call
// recordCardPrepayCreditOnce. Ten simultaneous calls for ONE PaymentIntent must write exactly one
// wallet CREDIT and one payment-intent row, raise the balance once, and none of the callers may fail.
import { randomUUID } from 'node:crypto'
import { db } from '../../server/lib/prisma.mjs'
import { recordCardPrepayCreditOnce } from '../../server/lib/finance-ledger.mjs'

const prisma = db()
let failed = 0
const check = (name, ok, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' ' + extra : ''}`); if (!ok) failed++ }

const user = await prisma.user.create({ data: { email: `credit-race-${Date.now()}@e2e.test`, displayName: 'Credit race', roles: { create: [{ role: 'GUEST' }] } } })
const pi = `pi_test_race_${randomUUID().slice(0, 12)}`
const args = { userId: user.id, paymentIntentId: pi, sessionId: 'cs_test_race', amountMinor: 24, currency: 'USD' }

console.log('=== ten concurrent credits for one PaymentIntent ===')
const results = await Promise.allSettled(Array.from({ length: 10 }, () => recordCardPrepayCreditOnce(args)))
const rejected = results.filter((r) => r.status === 'rejected')
check('no caller fails', rejected.length === 0, rejected.map((r) => r.reason?.code || r.reason?.message).join(','))
check('exactly one call reports a fresh credit', results.filter((r) => r.status === 'fulfilled' && !r.value.duplicate).length === 1)
const entries = await prisma.walletEntry.findMany({ where: { referenceType: 'stripe_card_prepay', referenceId: pi } })
check('exactly one wallet CREDIT exists', entries.length === 1, `entries=${entries.length}`)
const intents = await prisma.paymentIntent.count({ where: { reference: `stripe-preride:${pi}` } })
check('exactly one payment intent row', intents === 1, `intents=${intents}`)
const wallet = await prisma.wallet.findFirst({ where: { userId: user.id } })
check('balance raised once (24)', wallet?.cachedBalanceMinor === 24, `balance=${wallet?.cachedBalanceMinor}`)

console.log('=== a later redelivery is a clean duplicate ===')
const again = await recordCardPrepayCreditOnce(args)
check('redelivery is reported as duplicate, not an error', again.duplicate === true || again.entry?.id === entries[0].id)
const wallet2 = await prisma.wallet.findFirst({ where: { userId: user.id } })
check('balance unchanged after redelivery', wallet2?.cachedBalanceMinor === 24)

console.log(`\n${failed ? `FAILED ${failed}` : 'ALL PASS'}`)
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
