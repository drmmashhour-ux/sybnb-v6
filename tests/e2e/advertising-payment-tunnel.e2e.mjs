// SYBNB — Advertising / Payment Tunnel E2E (governed evidence artifact)
//
// Preserves the exact scenario that produced 35/35 in the Advertising / Payment Tunnel gate.
// This is an integration E2E: it requires the V6 API running against a schema-correct database
// (uuid listing ids) with the referenced synthetic users present. It asserts the mock payment
// tunnel + advertiser journey ONLY — it moves no real money, enables no Stripe, and changes no
// product behavior.
//
// Prerequisites / run:
//   1. Start the API against the authoritative staging DB (schema-correct `sybnb_v6`):
//        DATABASE_URL="postgresql://<user>@127.0.0.1:5432/sybnb_v6?schema=public" \
//        AUTH_SECRET=<secret> PHONE_HASH_SECRET=<secret> node server/index.mjs
//   2. Run this test with the SAME AUTH_SECRET and the synthetic user ids:
//        AUTH_SECRET=<secret> SELLER1=<uuid> SELLER2=<uuid> BUYER=<uuid> ADMIN=<uuid> \
//        node tests/e2e/advertising-payment-tunnel.e2e.mjs
//      (or `npm run test:e2e:advertising` with those env vars set)
//
// Config via env (defaults target the local sybnb_v6 synthetic accounts):
//   API_BASE   default http://127.0.0.1:3051
//   SELLER1/2  advertiser A / advertiser B user ids (SELLER role)
//   BUYER      guest user id
//   ADMIN      admin user id
//   AUTH_SECRET must match the running API's AUTH_SECRET (used to mint session tokens)
//
// PRODUCT GAP (documented, intentionally NOT implemented here): the landing "Featured ads"
// marquee is static (hardcoded AD_SPONSORS) — approved advertising campaigns do not dynamically
// appear there; an approved ad surfaces as a normal APPROVED listing in its division. Dynamic ad
// placement is NOT SUPPORTED and is out of scope for the payment-tunnel gate.

import { createSessionToken } from '../../server/lib/security.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const advA = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
const advB = { id: process.env.SELLER2, roles: [{ role: 'SELLER' }] }
const buyer = { id: process.env.BUYER,  roles: [{ role: 'GUEST' }] }
const admin = { id: process.env.ADMIN,  roles: [{ role: 'ADMIN' }] }

for (const [name, u] of [['SELLER1', advA], ['SELLER2', advB], ['BUYER', buyer], ['ADMIN', admin]]) {
  if (!u.id) { console.error(`Missing required env ${name} (a synthetic user id).`); process.exit(2) }
}

const AA = createSessionToken(advA), AB = createSessionToken(advB)
const B = createSessionToken(buyer), A = createSessionToken(admin)

let pass = 0, fail = 0
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = r => r.j?.error?.code || r.j?.code
const has = (r, id) => (r.j?.listings || []).some(l => l.id === id)
// advertising campaign = a listing carrying metadata.advertising, created in a paid division
function adBody(extra = {}) { return { division:'MARKETPLACE', titleAr:'Featured campaign banner', priceMinor:15000, currency:'SYP', metadata:{ advertising:true, adPlan:'plus', adPlacement:'homepage', adDuration:30, visualFilters:{} }, ...extra } }
async function submitProof(token, ref, amount=1900) {
  return call('POST','/api/payments/seller-plan-proof', token, {planCode:'advertising-plus', amountMinor:amount, currency:'USD', providerRef:ref, legalName:'Advertiser Co', sellerType:'advertiser'})
}

console.log('=== 1. GATE: activation blocked before payment/approval ===')
const preCreate = await call('POST','/api/listings', AA, adBody())
check('advertiser cannot create paid ad before plan (403 SELLER_PLAN_REQUIRED)', preCreate.status === 403 && code(preCreate) === 'SELLER_PLAN_REQUIRED', preCreate.status+' '+code(preCreate))
check('anon cannot submit ad payment proof (401)', (await submitProof(null, 'anon-ref')).status === 401)
check('anon cannot create ad (401)', (await call('POST','/api/listings', null, adBody())).status === 401)
check('buyer(GUEST) cannot create ad (403)', (await call('POST','/api/listings', B, adBody())).status === 403)

console.log('\n=== 2. PAYMENT TUNNEL INTEGRITY (mock, seller_plan proof) ===')
check('invalid amount (0, non-zero-fee) rejected (PAYMENT_AMOUNT_INVALID)', code(await submitProof(AA, 'zero-'+Date.now(), 0)) === 'PAYMENT_AMOUNT_INVALID', 'wrong')
check('missing provider reference rejected (PAYMENT_REFERENCE_REQUIRED)', code(await call('POST','/api/payments/seller-plan-proof', AA, {planCode:'advertising-plus', amountMinor:1900, currency:'USD'})) === 'PAYMENT_REFERENCE_REQUIRED', 'wrong')
const ref = 'ADV-' + Math.floor(performance.now()*1000)
const proof = await submitProof(AA, ref)
check('advertiser submits mock ad payment proof (201, PENDING_ADMIN_REVIEW)', proof.status === 201 && proof.j?.proof?.status === 'PENDING_ADMIN_REVIEW', proof.status+' '+proof.j?.proof?.status)
const proofId = proof.j?.proof?.id
check('duplicate/replay provider reference rejected (409 PAYMENT_REFERENCE_DUPLICATE)', code(await submitProof(AA, ref)) === 'PAYMENT_REFERENCE_DUPLICATE', 'replay not blocked')
check('advertiser (non-admin) cannot approve own proof (403)', (await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, AA, {decision:'APPROVE'})).status === 403)
check('other advertiser cannot approve the proof (403)', (await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, AB, {decision:'APPROVE'})).status === 403)
const approve = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, {decision:'APPROVE'})
check('admin approves proof -> unlocks advertising entitlement (200)', approve.status === 200, approve.status+' '+code(approve))
const doubleApprove = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, {decision:'APPROVE'})
check('double approval blocked (not re-reviewable)', doubleApprove.status >= 400 && ['PAYMENT_NOT_REVIEWABLE','PAYMENT_REVIEW_CONFLICT'].includes(code(doubleApprove)), doubleApprove.status+' '+code(doubleApprove))

console.log('\n=== 3. ADVERTISER JOURNEY: create -> submit -> approve -> visible ===')
const create = await call('POST','/api/listings', AA, adBody())
check('after approval advertiser creates ad campaign (201)', create.status === 201, create.status+' '+code(create))
const adId = create.j?.listing?.id
check('ad campaign carries advertising metadata', create.j?.listing?.metadata?.advertising === true, JSON.stringify(create.j?.listing?.metadata?.advertising))
check('ad campaign starts DRAFT (not active)', create.j?.listing?.status === 'DRAFT', create.j?.listing?.status)
check('ad media attach (201)', (await call('POST', `/api/listings/${adId}/media`, AA, {media:[{url:'/assets/divisions/marketplace.webp'}]})).status === 201)
check('draft ad NOT publicly visible', !has(await call('GET','/api/listings?division=MARKETPLACE',null), adId), 'leaked')
check('ad submit -> PENDING_REVIEW', (await call('PATCH', `/api/listings/${adId}/submit`, AA)).j?.listing?.status === 'PENDING_REVIEW', 'no submit')
check('pending ad NOT publicly visible before review', !has(await call('GET','/api/listings?division=MARKETPLACE',null), adId), 'leaked')
check('advertiser cannot self-approve ad (403)', (await call('PATCH', `/api/admin/review-queue/listing/${adId}`, AA, {decision:'APPROVE'})).status === 403)
check('admin approves ad listing (200)', (await call('PATCH', `/api/admin/review-queue/listing/${adId}`, A, {decision:'APPROVE'})).status === 200)
check('approved ad now publicly visible (activation)', has(await call('GET','/api/listings?division=MARKETPLACE',null), adId), 'missing')

console.log('\n=== 4. ADVERTISER STATUS SURFACE (/api/me/overview) ===')
const overview = await call('GET','/api/me/overview', AA)
check('advertiser overview 200', overview.status === 200, overview.status)
check('overview shows approved payment proof', (overview.j?.overview?.payments||[]).some(p => p.id === proofId && p.status === 'APPROVED'), 'proof status missing')
check('overview shows sellerProfile APPROVED (entitlement)', overview.j?.overview?.sellerProfile?.documentStatus === 'APPROVED', JSON.stringify(overview.j?.overview?.sellerProfile?.documentStatus))
check('overview shows the ad campaign listing', (overview.j?.overview?.listings||[]).some(l => l.id === adId), 'ad missing')

console.log('\n=== 5. ISOLATION: private campaign/payment info ===')
const overviewB = await call('GET','/api/me/overview', AB)
check('advertiserB overview does NOT contain advertiserA proof', !(overviewB.j?.overview?.payments||[]).some(p => p.id === proofId), 'proof leaked')
check('advertiserB overview does NOT contain advertiserA campaign', !(overviewB.j?.overview?.listings||[]).some(l => l.id === adId), 'campaign leaked')
const draftAd = await call('POST','/api/listings', AA, adBody({ titleAr:'Second campaign draft' }))
const draftAdId = draftAd.j?.listing?.id
check('advertiserB cannot attach media to advertiserA campaign (404)', (await call('POST', `/api/listings/${draftAdId}/media`, AB, {media:[{url:'/x.webp'}]})).status === 404)
check('advertiserB cannot submit advertiserA campaign (404)', (await call('PATCH', `/api/listings/${draftAdId}/submit`, AB)).status === 404)
check('invalid/unknown campaign id fails safely (404)', (await call('GET','/api/listings/11111111-1111-1111-1111-111111111111', null)).status === 404)

console.log('\n=== 6. REJECTED PROOF PATH (no entitlement, no activation) ===')
const rref = 'ADVR-' + Math.floor(performance.now()*1000)
const rproof = await submitProof(AB, rref)
check('advertiserB submits proof (201)', rproof.status === 201, rproof.status)
const rReject = await call('PATCH', `/api/admin/review-queue/payment/${rproof.j?.proof?.id}`, A, {decision:'REJECT'})
check('admin rejects proof (200)', rReject.status === 200, rReject.status)
const ovB2 = await call('GET','/api/me/overview', AB)
check('rejected proof -> sellerProfile documentStatus REJECTED', ovB2.j?.overview?.sellerProfile?.documentStatus === 'REJECTED', JSON.stringify(ovB2.j?.overview?.sellerProfile?.documentStatus))
check('advertiserB w/ rejected proof still blocked from paid ad (403)', code(await call('POST','/api/listings', AB, adBody())) === 'SELLER_PLAN_REQUIRED', 'gate bypassed after rejection')

console.log(`\n==== ADVERTISING / PAYMENT TUNNEL E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
