// SYBNB — PaymentProof duplicate-reference race E2E (governed evidence artifact)
//
// Proves the DB unique constraint on (provider, provider_ref) closes the TOCTOU race: firing many
// concurrent proof submissions with the SAME reference results in exactly ONE created proof, the
// rest rejected as duplicates — no duplicate rows. No real money. Run:
//   AUTH_SECRET=<secret> SELLER1=<uuid> node tests/e2e/payment-proof-race.e2e.mjs

import { createSessionToken } from './_session.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const seller = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
if (!seller.id) { console.error('Missing SELLER1'); process.exit(2) }
const S = await createSessionToken(seller)

let pass = 0, fail = 0
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
async function submit(ref) {
  const res = await fetch(API + '/api/payments/seller-plan-proof', {
    method: 'POST', headers: { authorization: `Bearer ${S}`, 'content-type': 'application/json' },
    body: JSON.stringify({ planCode: 'race-plus', amountMinor: 1500, currency: 'USD', providerRef: ref, legalName: 'Race', sellerType: 'dealer' }),
  })
  let j; try { j = await res.json() } catch { j = {} }
  return { status: res.status, code: j?.error?.code }
}

console.log('=== CONCURRENT SAME-REFERENCE SUBMISSIONS (race) ===')
const ref = 'RACE-' + Date.now()
const N = 8
const results = await Promise.all(Array.from({ length: N }, () => submit(ref)))
const created = results.filter(r => r.status === 201).length
const dupes = results.filter(r => r.status === 409 && r.code === 'PAYMENT_REFERENCE_DUPLICATE').length
console.log(`   ${N} concurrent → ${created} created (201), ${dupes} duplicate (409), other: ${N - created - dupes}`)
check('exactly ONE concurrent submission created a proof', created === 1, `created=${created}`)
check('all other concurrent submissions rejected as duplicate', dupes === N - 1, `dupes=${dupes}`)
check('no unexpected statuses', created + dupes === N, `sum=${created + dupes}`)

console.log('\n=== SEQUENTIAL RE-SUBMIT ALSO REJECTED ===')
const again = await submit(ref)
check('re-submitting the same reference → 409 duplicate', again.status === 409 && again.code === 'PAYMENT_REFERENCE_DUPLICATE', `${again.status} ${again.code}`)

console.log(`\n==== PAYMENT-PROOF RACE E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
