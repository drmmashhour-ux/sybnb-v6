// SYBNB — seller-plan fee ledger recording E2E (governed evidence artifact).
//
// Closes a real, verified gap: approving a seller/dealer/developer 'seller_plan' payment proof
// (the sole revenue mechanism for the 0%-per-booking-commission divisions -- CARS/MARKETPLACE/
// NEW_CONSTRUCTION -- see bookingFinanceSplit()'s own comment in finance-ledger.mjs) previously
// created ZERO wallet entries on this branch, so real, already-collected plan-fee revenue was
// invisible everywhere a WalletEntry is the source of truth (admin finance totals, income
// projections, payout rows) -- confirmed by an independent audit agent via a real HTTP transaction
// before this fix. approvePaymentProof()'s seller_plan branch now posts a CREDIT to the approving
// admin's own wallet, referenceType 'seller_plan_fee', for the exact proof amount -- mirroring how
// STAYS booking commission is already recorded, and matching a fix that already existed (but was
// never merged into this branch) at commit 29a0f69 on origin/security/sybnb-v6-predeployment.
//
// Proves: (1) the CREDIT posts with the exact amount/currency, referencing the real proof id;
// (2) the admin's wallet balance increases by exactly that amount; (3) a second approval attempt
// on an already-approved proof is refused cleanly and posts no second entry (no double-credit);
// (4) an unrelated seller-plan proof for a DIFFERENT seller/amount gets its own independent entry,
// not conflated with the first.
//
// Run: AUTH_SECRET=<secret> SELLER1=<uuid> SELLER2=<uuid> ADMIN=<uuid>
//      node tests/e2e/seller-plan-fee-ledger.e2e.mjs

import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const seller1 = { id: process.env.SELLER1 }
const seller2 = { id: process.env.SELLER2 }
const admin = { id: process.env.ADMIN }
for (const [name, u] of [['SELLER1', seller1], ['SELLER2', seller2], ['ADMIN', admin]]) {
  if (!u.id) { console.error(`Missing required env ${name} (a synthetic user id).`); process.exit(2) }
}
const S1 = await createSessionToken({ id: seller1.id, roles: [{ role: 'SELLER' }] })
const S2 = await createSessionToken({ id: seller2.id, roles: [{ role: 'SELLER' }] })
const A = await createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })

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

async function submitPlan(token, amountMinor, planCode) {
  const providerRef = `plan_${Date.now()}_${randomUUID()}`
  return call('POST', '/api/payments/seller-plan-proof', token, {
    planCode, amountMinor, currency: 'USD', providerRef, legalName: 'Test Merchant', sellerType: 'dealer',
  })
}

async function main() {
  console.log('=== SELLER-PLAN FEE LEDGER E2E ===')

  // --- 1. Approving a seller-plan proof posts the exact CREDIT, admin balance moves by exactly that ---
  {
    const before = await db().wallet.findUnique({ where: { userId_currency: { userId: admin.id, currency: 'USD' } } })
    const beforeBalance = before?.cachedBalanceMinor || 0

    const proof = await submitPlan(S1, 5000, 'cars-plus')
    check('seller submits plan payment proof (201)', proof.status === 201, JSON.stringify(proof.j))
    const proofId = proof.j?.proof?.id

    const approve = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, { decision: 'APPROVE' })
    check('admin approves the plan proof (200)', approve.status === 200, JSON.stringify(approve.j))

    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'seller_plan_fee', referenceId: proofId } })
    check('seller_plan_fee CREDIT entry exists, exact amount/currency', entry?.type === 'CREDIT' && entry?.amountMinor === 5000 && entry?.currency === 'USD', JSON.stringify(entry))

    const after = await db().wallet.findUnique({ where: { userId_currency: { userId: admin.id, currency: 'USD' } } })
    check('admin USD wallet balance increased by exactly the plan-fee amount', after.cachedBalanceMinor === beforeBalance + 5000, JSON.stringify({ before: beforeBalance, after: after.cachedBalanceMinor }))
  }

  // --- 2. Re-approving an already-approved proof is refused cleanly, no second entry ---
  {
    const proof = await submitPlan(S1, 3000, 'marketplace-plus')
    const proofId = proof.j?.proof?.id
    const first = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, { decision: 'APPROVE' })
    check('first approval succeeds (200)', first.status === 200, JSON.stringify(first.j))
    const second = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, { decision: 'APPROVE' })
    check('second approval on the same proof is refused, not a silent success', second.status >= 400, second.status + ' ' + code(second))
    const entryCount = await db().walletEntry.count({ where: { referenceType: 'seller_plan_fee', referenceId: proofId } })
    check('exactly ONE seller_plan_fee entry exists after both attempts, not two', entryCount === 1, entryCount)
  }

  // --- 3. A different seller's plan fee gets its own independent, correctly-amounted entry ---
  {
    const proof = await submitPlan(S2, 7500, 'new-construction-plus')
    const proofId = proof.j?.proof?.id
    await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, { decision: 'APPROVE' })
    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'seller_plan_fee', referenceId: proofId } })
    check('second seller\'s independent plan-fee entry has its own exact amount, not conflated with the first', entry?.amountMinor === 7500, JSON.stringify(entry))
  }

  console.log(`\n==== SELLER-PLAN FEE LEDGER E2E: ${pass} passed, ${fail} failed ====`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDb()
  process.exit(1)
})
