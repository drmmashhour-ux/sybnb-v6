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
// A real display surface now exists: GET /api/advertising/active (server/routes/listings.mjs)
// returns real, admin-approved, non-expired ad campaigns for the landing page's "Sponsored"
// section (src/modules/landing/LandingPage.tsx) to render — no fake/hardcoded sponsor cards.
// Section 7 below proves an ad is absent before approval and present with real media after.
//
// An approved ad IS a real APPROVED listing row (individually fetchable, administratively real —
// see "activation" below), but is deliberately excluded from GET /api/listings' ordinary
// division/city search results (commit c411043). A prior version of this suite asserted the
// opposite — that an approved ad SHOULD appear in real product search — which was true only
// because that exclusion didn't exist yet; an independent re-audit found 62 real approved ads
// showing up disguised as real MARKETPLACE products in genuine buyer search results, and the fix
// closed exactly that leak. This suite was not re-run against that fix at the time (only verified
// live via curl), so its own assertion went stale until this regression pass caught it.

import { createSessionToken } from './_session.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const advA = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
const advB = { id: process.env.SELLER2, roles: [{ role: 'SELLER' }] }
const buyer = { id: process.env.BUYER,  roles: [{ role: 'GUEST' }] }
const admin = { id: process.env.ADMIN,  roles: [{ role: 'ADMIN' }] }

for (const [name, u] of [['SELLER1', advA], ['SELLER2', advB], ['BUYER', buyer], ['ADMIN', admin]]) {
  if (!u.id) { console.error(`Missing required env ${name} (a synthetic user id).`); process.exit(2) }
}

const AA = await createSessionToken(advA), AB = await createSessionToken(advB)
const B = await createSessionToken(buyer), A = await createSessionToken(admin)

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
function adBody(extra = {}) { return { division:'MARKETPLACE', titleAr:'Featured campaign banner', priceMinor:15000, currency:'SYP', metadata:{ advertising:true, adPlan:'plus', adPlacement:'homepage', adDuration:30, adDurationDays:7, visualFilters:{} }, ...extra } }
async function submitProof(token, ref, amount=1900) {
  return call('POST','/api/payments/seller-plan-proof', token, {planCode:'advertising-plus', amountMinor:amount, currency:'USD', providerRef:ref, legalName:'Advertiser Co', sellerType:'advertiser'})
}

// Publish gate (server/routes/listings.mjs) requires an admin-approved ID document plus an
// accepted 'listing-agreement' legal consent before ANY division's submit() can leave DRAFT --
// satisfy it for both advertisers up front so the submit/approve assertions below are genuinely
// exercised instead of stopping at 403 ID_VERIFICATION_REQUIRED.
async function verifySellerKyc(token, userId) {
  await call('PATCH', '/api/me/id-document', token, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${userId}`, A, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const doc = legal.j.documents.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', token, { documentKey: 'listing-agreement', version: doc.version })
}
console.log('=== 0. KYC + LEGAL-CONSENT BOOTSTRAP (required by the listings.mjs publish gate) ===')
await verifySellerKyc(AA, advA.id)
await verifySellerKyc(AB, advB.id)

console.log('=== 1. GATE: activation blocked before payment/approval ===')
// One approved, unused advertising payment = one campaign (owner-approved business rule) --
// checked directly, not via the coarse sellerProfile.documentStatus flag CARS/MARKETPLACE/
// NEW_CONSTRUCTION dealers use, so the code is ADVERTISING_PAYMENT_REQUIRED, not SELLER_PLAN_REQUIRED.
const preCreate = await call('POST','/api/listings', AA, adBody())
check('advertiser cannot create ad before any approved payment (403 ADVERTISING_PAYMENT_REQUIRED)', preCreate.status === 403 && code(preCreate) === 'ADVERTISING_PAYMENT_REQUIRED', preCreate.status+' '+code(preCreate))
check('anon cannot submit ad payment proof (401)', (await submitProof(null, 'anon-ref')).status === 401)
check('anon cannot create ad (401)', (await call('POST','/api/listings', null, adBody())).status === 401)
check('buyer(GUEST) cannot create ad (403)', (await call('POST','/api/listings', B, adBody())).status === 403)

console.log('\n=== 2. PAYMENT TUNNEL INTEGRITY (mock, seller_plan proof) ===')
check('invalid amount (0, non-zero-fee) rejected (PAYMENT_AMOUNT_INVALID)', code(await submitProof(AA, 'zero-'+Date.now(), 0)) === 'PAYMENT_AMOUNT_INVALID', 'wrong')
check('amount not matching the real advertising-plus price rejected (PAYMENT_AMOUNT_MISMATCH)', code(await submitProof(AA, 'mismatch-'+Date.now(), 1)) === 'PAYMENT_AMOUNT_MISMATCH', 'client-trusted amount accepted')
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
// Real duration enforcement: adBody() requested 7 days (adDurationDays:7) -- the flat per-tier
// default (plus=30, premium=60) would put expiresAt ~30 days out; a real 7-day expiry proves the
// advertiser's own chosen duration is honored, not silently ignored.
const expiresInDays = (new Date(create.j?.listing?.expiresAt) - Date.now()) / 86400000
check('ad expiry honors the advertiser\'s chosen duration (~7 days, not the flat 30-day default)', expiresInDays > 6 && expiresInDays < 8, `${expiresInDays} days`)
check('ad media attach (201)', (await call('POST', `/api/listings/${adId}/media`, AA, {media:[{url:'/assets/divisions/marketplace.webp', kind:'mainBanner'}]})).status === 201)
check('draft ad NOT publicly visible', !has(await call('GET','/api/listings?division=MARKETPLACE',null), adId), 'leaked')
check('ad submit -> PENDING_REVIEW', (await call('PATCH', `/api/listings/${adId}/submit`, AA)).j?.listing?.status === 'PENDING_REVIEW', 'no submit')
check('pending ad NOT publicly visible before review', !has(await call('GET','/api/listings?division=MARKETPLACE',null), adId), 'leaked')
check('advertiser cannot self-approve ad (403)', (await call('PATCH', `/api/admin/review-queue/listing/${adId}`, AA, {decision:'APPROVE'})).status === 403)
check('admin approves ad listing (200)', (await call('PATCH', `/api/admin/review-queue/listing/${adId}`, A, {decision:'APPROVE'})).status === 200)
// Activation proof: the listing itself is a real, individually-fetchable APPROVED row (GET
// /api/listings/:id only ever returns status='APPROVED' rows -- see server/routes/listings.mjs).
// NOT a search-visibility check -- see this file's header for why an approved ad is deliberately
// excluded from ordinary product search.
const activated = await call('GET', `/api/listings/${adId}`, null)
check('approved ad now individually fetchable (activation)', activated.status === 200 && activated.j?.listing?.id === adId, activated.status+' '+JSON.stringify(activated.j))
check('approved ad still excluded from ordinary product search (no disguised leak)', !has(await call('GET','/api/listings?division=MARKETPLACE',null), adId), 'leaked')

console.log('\n=== 3b. DISPLAY SURFACE: GET /api/advertising/active ===')
const activeAds = await call('GET', '/api/advertising/active', null)
check('active-ads endpoint is public (200, no auth)', activeAds.status === 200, activeAds.status)
const activeAd = (activeAds.j?.ads || []).find((a) => a.id === adId)
check('approved ad appears in the real public display surface', Boolean(activeAd), JSON.stringify(activeAds.j?.ads?.map((a) => a.id)))
check('display surface carries the real attached banner media (not fake/empty)', activeAd?.media?.some((m) => m.kind === 'mainBanner' && m.url), JSON.stringify(activeAd?.media))

console.log('\n=== 3c. ONE PAYMENT = ONE CAMPAIGN (owner-approved business rule) ===')
// The proof approved in section 2 was already spent on the campaign created+approved in section 3
// -- a second campaign must NOT be creatable from that same payment, however long ago it was
// approved. This is checked directly (not inferred), so a stale sellerProfile.documentStatus=
// APPROVED left over from that same old payment can't accidentally re-authorize a new campaign.
const secondWithoutNewPayment = await call('POST','/api/listings', AA, adBody({ titleAr:'Second campaign, no new payment' }))
check('second campaign blocked without a NEW payment (403 ADVERTISING_PAYMENT_REQUIRED)', secondWithoutNewPayment.status === 403 && code(secondWithoutNewPayment) === 'ADVERTISING_PAYMENT_REQUIRED', secondWithoutNewPayment.status+' '+code(secondWithoutNewPayment))

const ref2 = 'ADV2-' + Math.floor(performance.now()*1000)
const proof2 = await submitProof(AA, ref2)
const approve2 = await call('PATCH', `/api/admin/review-queue/payment/${proof2.j?.proof?.id}`, A, {decision:'APPROVE'})
check('a fresh payment is approvable independently of the first', approve2.status === 200, approve2.status)
const draftForVisibility = await call('POST','/api/listings', AA, adBody({ titleAr:'Not-yet-approved campaign' }))
const draftAdVisId = draftForVisibility.j?.listing?.id
check('a NEW payment unlocks exactly one new campaign (201)', draftForVisibility.status === 201, draftForVisibility.status+' '+code(draftForVisibility))
const overviewAfterBind = await call('GET', '/api/me/overview', AA)
const boundProof2 = (overviewAfterBind.j?.overview?.payments || []).find((p) => p.id === proof2.j?.proof?.id)
check('the new payment is bound to this exact campaign, deterministically (campaignListingId)', boundProof2?.campaignListingId === draftAdVisId, JSON.stringify(boundProof2?.campaignListingId) + ' vs ' + draftAdVisId)
const thirdWithoutNewPayment = await call('POST','/api/listings', AA, adBody({ titleAr:'Third campaign, no new payment' }))
check('a second-in-a-row campaign is blocked again once THIS payment is also bound (403)', thirdWithoutNewPayment.status === 403 && code(thirdWithoutNewPayment) === 'ADVERTISING_PAYMENT_REQUIRED', thirdWithoutNewPayment.status+' '+code(thirdWithoutNewPayment))

const activeAdsAfterDraft = await call('GET', '/api/advertising/active', null)
check('a DRAFT (not yet approved) ad never appears on the public display surface', !(activeAdsAfterDraft.j?.ads || []).some((a) => a.id === draftAdVisId), 'unapproved ad leaked to display surface')

console.log('\n=== 3d. REJECTION RELEASES THE PAYMENT FOR A RETRY ===')
const ref3 = 'ADV3-' + Math.floor(performance.now()*1000)
const proof3 = await submitProof(AA, ref3)
await call('PATCH', `/api/admin/review-queue/payment/${proof3.j?.proof?.id}`, A, {decision:'APPROVE'})
const rejectedCampaign = await call('POST','/api/listings', AA, adBody({ titleAr:'Will be rejected' }))
check('third payment unlocks a new campaign (201)', rejectedCampaign.status === 201, rejectedCampaign.status)
const rejectedCampaignId = rejectedCampaign.j?.listing?.id
await call('POST', `/api/listings/${rejectedCampaignId}/media`, AA, {media:[{url:'/assets/divisions/marketplace.webp', kind:'mainBanner'}]})
await call('PATCH', `/api/listings/${rejectedCampaignId}/submit`, AA)
const campaignReject = await call('PATCH', `/api/admin/review-queue/listing/${rejectedCampaignId}`, A, {decision:'REJECT'})
check('admin rejects the campaign (200)', campaignReject.status === 200, campaignReject.status)
const retryWithSamePayment = await call('POST','/api/listings', AA, adBody({ titleAr:'Retry after rejection' }))
check('a REJECTED campaign releases its payment -- the SAME payment backs a retry (201, not 403)', retryWithSamePayment.status === 201, retryWithSamePayment.status+' '+code(retryWithSamePayment))
const retryAgainBlocked = await call('POST','/api/listings', AA, adBody({ titleAr:'Second retry, should be blocked' }))
check('once the retry campaign exists, that same payment is bound again -- a further campaign is blocked', retryAgainBlocked.status === 403 && code(retryAgainBlocked) === 'ADVERTISING_PAYMENT_REQUIRED', retryAgainBlocked.status+' '+code(retryAgainBlocked))

console.log('\n=== 3e. ADMIN PAYMENT REVIEW SHOWS THE CAMPAIGN ASSOCIATION ===')
const refPending = 'ADVP-' + Math.floor(performance.now()*1000)
const proofPending = await submitProof(AB, refPending)
const queueBeforeApproval = await call('GET', '/api/admin/review-queue', A)
const pendingInQueue = (queueBeforeApproval.j?.queue?.payments || []).find((p) => p.id === proofPending.j?.proof?.id)
check('pending advertising payment carries its own planCode (deterministic, not inferred)', pendingInQueue?.planCode === 'advertising-plus', JSON.stringify(pendingInQueue?.planCode))
check('pending advertising payment has no campaign yet (not created until after approval)', pendingInQueue?.campaignListingId == null, JSON.stringify(pendingInQueue?.campaignListingId))

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
// Reuses draftAdVisId (section 3c) rather than creating yet another campaign here -- under the
// one-payment-per-campaign rule, AA has no unconsumed payment left to spend on a fresh one.
const draftAdId = draftAdVisId
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
check('advertiserB w/ rejected proof still blocked from a paid ad (403 ADVERTISING_PAYMENT_REQUIRED)', code(await call('POST','/api/listings', AB, adBody())) === 'ADVERTISING_PAYMENT_REQUIRED', 'gate bypassed after rejection')

// Section 7: negative regression matrix for the security patch that closed 3 real, live-proven
// gaps found by an independent adversarial audit (not this suite) -- see commit for the audit
// evidence. This suite previously only proved the *quantity* rule (one payment = one campaign);
// it never proved division-scoping, dealer-inventory isolation, tier integrity, or self-review.
console.log('\n=== 7a. DIVISION MUST BE MARKETPLACE -- fails closed on any other division, payment stays unconsumed ===')
const div7ref = 'ADV7-' + Math.floor(performance.now()*1000)
const div7proof = await submitProof(AA, div7ref)
await call('PATCH', `/api/admin/review-queue/payment/${div7proof.j?.proof?.id}`, A, {decision:'APPROVE'})
const carsAttempt = await call('POST','/api/listings', AA, adBody({ division:'CARS' }))
check('advertising + division:CARS rejected (400 ADVERTISING_DIVISION_INVALID)', carsAttempt.status === 400 && code(carsAttempt) === 'ADVERTISING_DIVISION_INVALID', carsAttempt.status+' '+code(carsAttempt))
const staysAttempt = await call('POST','/api/listings', AA, adBody({ division:'STAYS' }))
check('advertising + division:STAYS rejected, not silently ungated (400 ADVERTISING_DIVISION_INVALID)', staysAttempt.status === 400 && code(staysAttempt) === 'ADVERTISING_DIVISION_INVALID', staysAttempt.status+' '+code(staysAttempt))
const ov7 = await call('GET','/api/me/overview', AA)
const stillUnconsumed = (ov7.j?.overview?.payments||[]).find((p) => p.id === div7proof.j?.proof?.id)
check('payment stays unconsumed after both rejected division attempts (campaignListingId still null)', stillUnconsumed?.campaignListingId == null, JSON.stringify(stillUnconsumed?.campaignListingId))
const correctDivision = await call('POST','/api/listings', AA, adBody({ division:'MARKETPLACE', titleAr:'Correct division campaign' }))
check('the SAME payment still works for the correct division (201) -- fix does not break the real path', correctDivision.status === 201, correctDivision.status+' '+code(correctDivision))

console.log('\n=== 7b. AN ADVERTISING PAYMENT MUST NOT UNLOCK DEALER INVENTORY (the critical finding) ===')
// AA has zero unconsumed advertising-tier proofs at this point (the one from 7a was just spent in
// the correct-division check above) and has NEVER had a 'plus'/'premium' dealer-tier proof
// approved -- a real audit found sellerProfile.documentStatus alone used to authorize this.
const carsReal = await call('POST','/api/listings', AA, { division:'CARS', titleAr:'Real BMW listing', priceMinor:500000000, currency:'SYP', metadata:{ visualFilters:{ carBrand:'bmw' } } })
check('advertising-only entitlement does NOT unlock a real CARS listing (403 SELLER_PLAN_REQUIRED)', carsReal.status === 403 && code(carsReal) === 'SELLER_PLAN_REQUIRED', carsReal.status+' '+code(carsReal))
const newConstructionReal = await call('POST','/api/listings', AA, { division:'NEW_CONSTRUCTION', titleAr:'Real tower project', priceMinor:900000000, currency:'SYP', metadata:{} })
check('advertising-only entitlement does NOT unlock a real NEW_CONSTRUCTION listing (403 SELLER_PLAN_REQUIRED)', newConstructionReal.status === 403 && code(newConstructionReal) === 'SELLER_PLAN_REQUIRED', newConstructionReal.status+' '+code(newConstructionReal))
// The converse also holds -- a real dealer-tier payment (planCode 'plus') does NOT unlock advertising.
const dealerRef = 'DEALER7-' + Math.floor(performance.now()*1000)
const dealerProof = await call('POST','/api/payments/seller-plan-proof', AA, {planCode:'plus', amountMinor:2000, currency:'USD', providerRef:dealerRef, legalName:'AA Dealer', sellerType:'dealer'})
await call('PATCH', `/api/admin/review-queue/payment/${dealerProof.j?.proof?.id}`, A, {decision:'APPROVE'})
const carsRealWithDealerPlan = await call('POST','/api/listings', AA, { division:'CARS', titleAr:'Real BMW listing 2', priceMinor:500000000, currency:'SYP', metadata:{ visualFilters:{ carBrand:'bmw' } } })
check('a genuine dealer-tier payment correctly DOES unlock real CARS inventory (201)', carsRealWithDealerPlan.status === 201, carsRealWithDealerPlan.status+' '+code(carsRealWithDealerPlan))
const adWithDealerPlan = await call('POST','/api/listings', AA, adBody({ titleAr:'Trying to use dealer plan for an ad' }))
check('that same dealer-tier payment does NOT unlock an advertising campaign (403 ADVERTISING_PAYMENT_REQUIRED)', adWithDealerPlan.status === 403 && code(adWithDealerPlan) === 'ADVERTISING_PAYMENT_REQUIRED', adWithDealerPlan.status+' '+code(adWithDealerPlan))

console.log('\n=== 7c. TIER INTEGRITY -- server derives the real tier, a plus payment cannot buy premium display ===')
const tierRef = 'TIER7-' + Math.floor(performance.now()*1000)
const tierProof = await submitProof(AA, tierRef) // advertising-plus, $19
await call('PATCH', `/api/admin/review-queue/payment/${tierProof.j?.proof?.id}`, A, {decision:'APPROVE'})
const spoofAttempt = await call('POST','/api/listings', AA, adBody({ titleAr:'Spoofed premium campaign', metadata:{ advertising:true, adPlan:'premium', adPlacement:'homepage', adDuration:30, adDurationDays:30, visualFilters:{} } }))
check('campaign created from a plus-tier payment (201)', spoofAttempt.status === 201, spoofAttempt.status)
check('server overwrites the client-claimed adPlan with the REAL paid tier (plus, not premium)', spoofAttempt.j?.listing?.metadata?.adPlan === 'plus', JSON.stringify(spoofAttempt.j?.listing?.metadata?.adPlan))

console.log('\n=== 7d. ADMIN SELF-REVIEW IS FORBIDDEN ===')
// Same underlying fix (existing.ownerId/userId === actorUserId) protects both the listing-review
// and payment-review branches in server/routes/admin.mjs; this proves it on the payment branch,
// which needs no extra role fixture (submitting a seller-plan-proof only requires any authenticated
// user, per server/routes/payments.mjs's requireAuth(context)).
const selfRef = 'SELF7-' + Math.floor(performance.now()*1000)
const selfProof = await call('POST','/api/payments/seller-plan-proof', A, {planCode:'plus', amountMinor:2000, currency:'USD', providerRef:selfRef, legalName:'Admin Self', sellerType:'dealer'})
check('admin can submit a payment proof under their own id (201)', selfProof.status === 201, selfProof.status)
const selfApprove = await call('PATCH', `/api/admin/review-queue/payment/${selfProof.j?.proof?.id}`, A, {decision:'APPROVE'})
check('admin cannot approve their OWN payment proof (403 SELF_REVIEW_FORBIDDEN)', selfApprove.status === 403 && code(selfApprove) === 'SELF_REVIEW_FORBIDDEN', selfApprove.status+' '+code(selfApprove))

console.log(`\n==== ADVERTISING / PAYMENT TUNNEL E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
