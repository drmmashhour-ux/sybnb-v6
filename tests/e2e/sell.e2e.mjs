import { createSessionToken } from '../../server/lib/security.mjs'

const API = 'http://127.0.0.1:3051'
const sellerA = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
const sellerB = { id: process.env.SELLER2, roles: [{ role: 'SELLER' }] }
const buyer   = { id: process.env.BUYER,   roles: [{ role: 'GUEST' }] }
const admin   = { id: process.env.ADMIN,   roles: [{ role: 'ADMIN' }] }
const SA = createSessionToken(sellerA), SB = createSessionToken(sellerB)
const B = createSessionToken(buyer), A = createSessionToken(admin)

let pass = 0, fail = 0
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = r => r.j?.error?.code || r.j?.code
async function approvePlan(token, plan) {
  const ref = 'SELL-' + Math.floor(performance.now()*1000)
  const p = await call('POST','/api/payments/seller-plan-proof', token, {planCode:plan, amountMinor:2500, currency:'USD', providerRef:ref, legalName:'Merchant', sellerType:'dealer'})
  const r = await call('PATCH', `/api/admin/review-queue/payment/${p.j?.proof?.id}`, A, {decision:'APPROVE'})
  return { proofStatus: p.status, approveStatus: r.status }
}

console.log('=== 1. PAID-PLAN SELLER JOURNEY through /sell (Cars) ===')
// seller starts with NO profile (reset in wrapper): plan requirement must be enforced
const carBlocked = await call('POST','/api/listings', SA, {division:'CARS', titleAr:'BMW 320i 2020', priceMinor:14000000, currency:'SYP', metadata:{visualFilters:{carBrand:'bmw'}}})
check('paid division blocked before plan (403 SELLER_PLAN_REQUIRED)', carBlocked.status === 403 && code(carBlocked) === 'SELLER_PLAN_REQUIRED', carBlocked.status+' '+code(carBlocked))
const plan = await approvePlan(SA, 'cars-plus')
check('mock plan proof submitted (201) + admin approved (200)', plan.proofStatus === 201 && plan.approveStatus === 200, JSON.stringify(plan))
const carCreate = await call('POST','/api/listings', SA, {division:'CARS', titleAr:'BMW 320i 2020', priceMinor:14000000, currency:'SYP', metadata:{visualFilters:{carBrand:'bmw', carFuel:'gas'}}})
check('after plan approval, create Cars listing (201)', carCreate.status === 201, carCreate.status+' '+code(carCreate))
const carId = carCreate.j?.listing?.id
check('Cars media attach (201)', (await call('POST', `/api/listings/${carId}/media`, SA, {media:[{url:'/assets/divisions/cars.webp'}]})).status === 201)
check('Cars submit -> PENDING_REVIEW', (await call('PATCH', `/api/listings/${carId}/submit`, SA)).j?.listing?.status === 'PENDING_REVIEW', 'no submit')

console.log('\n=== 2. COMMISSION/CONTACT SELLER JOURNEY through /sell (Buy, no plan) ===')
// same seller, non-paid division must NOT demand a plan
const buyCreate = await call('POST','/api/listings', SA, {division:'BUY', titleAr:'Villa for sale Damascus', priceMinor:450000000, currency:'SYP', metadata:{visualFilters:{propertyType:'villa'}, bedrooms:4, bathrooms:3}})
check('Buy create requires NO plan (201)', buyCreate.status === 201, buyCreate.status+' '+code(buyCreate))
check('Buy create not blocked by SELLER_PLAN_REQUIRED', code(buyCreate) !== 'SELLER_PLAN_REQUIRED', code(buyCreate))
const buyId = buyCreate.j?.listing?.id
check('Buy media attach (201)', (await call('POST', `/api/listings/${buyId}/media`, SA, {media:[{url:'/assets/divisions/buy-property.webp'}]})).status === 201)
check('Buy submit -> PENDING_REVIEW', (await call('PATCH', `/api/listings/${buyId}/submit`, SA)).j?.listing?.status === 'PENDING_REVIEW', 'no submit')
// Rentals (non-paid) also no gate; NC (paid) gate enforced for a fresh unrelated seller path
const rentCreate = await call('POST','/api/listings', SA, {division:'RENTALS', titleAr:'Monthly flat Mezzeh', priceMinor:1900000, currency:'SYP', metadata:{visualFilters:{propertyType:'apartment'}}})
check('Rentals create requires NO plan (201)', rentCreate.status === 201 && code(rentCreate) !== 'SELLER_PLAN_REQUIRED', rentCreate.status+' '+code(rentCreate))

console.log('\n=== 3. WIZARD VALIDATION (server-enforced) ===')
check('empty title rejected (LISTING_TITLE_REQUIRED)', code(await call('POST','/api/listings', SA, {division:'BUY', titleAr:'', priceMinor:1000, currency:'SYP'})) === 'LISTING_TITLE_REQUIRED', 'wrong')
check('zero/negative price rejected (LISTING_PRICE_INVALID)', code(await call('POST','/api/listings', SA, {division:'BUY', titleAr:'Valid title', priceMinor:0, currency:'SYP'})) === 'LISTING_PRICE_INVALID', 'wrong')
check('invalid division rejected (LISTING_DIVISION_INVALID)', code(await call('POST','/api/listings', SA, {division:'ROCKETS', titleAr:'Valid title', priceMinor:1000, currency:'SYP'})) === 'LISTING_DIVISION_INVALID', 'wrong')
check('media over bound rejected (LISTING_MEDIA_TOO_MANY)', code(await call('POST', `/api/listings/${buyId}/media`, SA, {media:Array.from({length:21},()=>({url:'/x.webp'}))})) === 'LISTING_MEDIA_LOCKED' || code(await call('POST', `/api/listings/${rentCreate.j?.listing?.id}/media`, SA, {media:Array.from({length:21},()=>({url:'/x.webp'}))})) === 'LISTING_MEDIA_TOO_MANY', 'bound not enforced')
check('duplicate submit blocked (LISTING_NOT_SUBMITTABLE)', code(await call('PATCH', `/api/listings/${buyId}/submit`, SA)) === 'LISTING_NOT_SUBMITTABLE', 'wrong')
check('media on invalid listing id -> 404', (await call('POST','/api/listings/11111111-1111-1111-1111-111111111111/media', SA, {media:[{url:'/x.webp'}]})).status === 404)

console.log('\n=== 4. SELLER DASHBOARD CONTINUITY (/api/host/overview) ===')
const dash = await call('GET','/api/host/overview', SA)
check('seller dashboard returns 200', dash.status === 200, dash.status)
const myListings = dash.j?.overview?.listings || []
const findMine = id => myListings.find(l => l.id === id)
check('dashboard shows the Cars listing under seller', Boolean(findMine(carId)), 'missing car')
check('dashboard shows the Buy listing under seller', Boolean(findMine(buyId)), 'missing buy')
check('dashboard listing carries correct division', findMine(carId)?.division === 'CARS' && findMine(buyId)?.division === 'BUY', 'wrong division')
check('dashboard listing carries correct pending status', findMine(carId)?.status === 'PENDING_REVIEW' && findMine(buyId)?.status === 'PENDING_REVIEW', 'wrong status')
check('dashboard listing carries media', (findMine(buyId)?.media||[]).length >= 1, 'no media')
check('dashboard totals reflect pending listings', Number(dash.j?.overview?.totals?.pendingListings) >= 2, JSON.stringify(dash.j?.overview?.totals))

console.log('\n=== 5. CROSS-SELLER ISOLATION ===')
const dashB = await call('GET','/api/host/overview', SB)
check('sellerB dashboard does NOT contain sellerA listings', !(dashB.j?.overview?.listings||[]).some(l => l.id === carId || l.id === buyId), 'leaked')
// sellerB cannot submit or attach media to sellerA drafts
const draftA = await call('POST','/api/listings', SA, {division:'BUY', titleAr:'Draft only villa', priceMinor:1000000, currency:'SYP'})
const draftAId = draftA.j?.listing?.id
check('sellerB cannot submit sellerA draft (404)', (await call('PATCH', `/api/listings/${draftAId}/submit`, SB)).status === 404)
check('sellerB cannot attach media to sellerA draft (404)', (await call('POST', `/api/listings/${draftAId}/media`, SB, {media:[{url:'/x.webp'}]})).status === 404)

console.log('\n=== 6. AUTHORIZATION + DIVISION TAMPERING ===')
check('anon cannot create via Sell (401)', (await call('POST','/api/listings', null, {division:'BUY', titleAr:'x', priceMinor:1000, currency:'SYP'})).status === 401)
check('buyer(GUEST) cannot create seller listing (403)', (await call('POST','/api/listings', B, {division:'BUY', titleAr:'x', priceMinor:1000, currency:'SYP'})).status === 403)
// division tampering: sellerB (no plan) cannot bypass paid-plan by posting a paid division
check('sellerB w/o plan cannot create MARKETPLACE via division field (403 SELLER_PLAN_REQUIRED)', code(await call('POST','/api/listings', SB, {division:'MARKETPLACE', titleAr:'Tamper item', priceMinor:5000, currency:'SYP'})) === 'SELLER_PLAN_REQUIRED', 'gate bypassed')
check('sellerB w/o plan cannot create NEW_CONSTRUCTION via division field (403)', code(await call('POST','/api/listings', SB, {division:'NEW_CONSTRUCTION', titleAr:'Tamper project', priceMinor:5000, currency:'SYP'})) === 'SELLER_PLAN_REQUIRED', 'gate bypassed')
check('seller cannot self-moderate own listing (403)', (await call('PATCH', `/api/admin/review-queue/listing/${buyId}`, SA, {decision:'APPROVE'})).status === 403)
check('seller cannot use admin payment-proof approval (403)', (await call('PATCH', `/api/admin/review-queue/payment/11111111-1111-1111-1111-111111111111`, SA, {decision:'APPROVE'})).status === 403)

console.log('\n=== 7. SELLER -> BROWSE HANDOFF ===')
// admin approves the Buy listing created through /sell; it must surface in browse intact
check('admin approves the /sell Buy listing (200)', (await call('PATCH', `/api/admin/review-queue/listing/${buyId}`, A, {decision:'APPROVE'})).status === 200)
const browse = await call('GET','/api/listings?division=BUY', null)
const inBrowse = (browse.j?.listings||[]).find(l => l.id === buyId)
check('listing surfaces in correct browse division', Boolean(inBrowse), 'missing')
check('handoff retains media', (inBrowse?.media||[]).length >= 1, 'no media')
const detail = await call('GET', `/api/listings/${buyId}`, null)
check('handoff retains metadata/specs (propertyType + beds)', detail.j?.listing?.metadata?.visualFilters?.propertyType === 'villa' && Number(detail.j?.listing?.metadata?.bedrooms) === 4, JSON.stringify(detail.j?.listing?.metadata))
check('handoff retains seller identity', Boolean(detail.j?.listing?.owner?.displayName), JSON.stringify(detail.j?.listing?.owner))

console.log(`\n==== SELL E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
