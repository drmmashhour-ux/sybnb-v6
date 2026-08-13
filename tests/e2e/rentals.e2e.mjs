import { createSessionToken } from '../../server/lib/security.mjs'

const API = 'http://127.0.0.1:3051'
const seller1 = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
const seller2 = { id: process.env.SELLER2, roles: [{ role: 'SELLER' }] }
const buyer   = { id: process.env.BUYER,   roles: [{ role: 'GUEST' }] }
const admin   = { id: process.env.ADMIN,   roles: [{ role: 'ADMIN' }] }
const S1 = createSessionToken(seller1), S2 = createSessionToken(seller2)
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

async function makeListing(token, division, meta, price, title) {
  const c = await call('POST','/api/listings', token, {division, titleAr:title, titleEn:title, priceMinor:price, currency:'SYP', metadata:meta})
  const id = c.j?.listing?.id
  await call('POST', `/api/listings/${id}/media`, token, {media:[{url:'/assets/divisions/monthly-rental.webp', kind:'image'}]})
  await call('PATCH', `/api/listings/${id}/submit`, token)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, {decision:'APPROVE'})
  return id
}
async function approvePlan(token) {
  const ref = 'RNT-' + Math.floor(performance.now()*1000)
  const p = await call('POST','/api/payments/seller-plan-proof', token, {planCode:'plus', amountMinor:1500, currency:'USD', providerRef:ref, legalName:'X', sellerType:'dealer'})
  await call('PATCH', `/api/admin/review-queue/payment/${p.j?.proof?.id}`, A, {decision:'APPROVE'})
}

console.log('=== 1. COMMISSION/CONTACT MODEL: no plan gate ===')
const noPlan = await call('POST','/api/listings', S1, {division:'RENTALS', titleAr:'Furnished flat monthly', priceMinor:1800000, currency:'SYP', metadata:{visualFilters:{propertyType:'apartment'}, bedrooms:2, bathrooms:1}})
check('landlord creates RENTALS WITHOUT any plan (201, no gate)', noPlan.status === 201, noPlan.status+' '+code(noPlan))
check('RENTALS create not blocked by SELLER_PLAN_REQUIRED', code(noPlan) !== 'SELLER_PLAN_REQUIRED', code(noPlan))
const draftId = noPlan.j?.listing?.id
check('new RENTALS listing starts DRAFT', noPlan.j?.listing?.status === 'DRAFT', noPlan.j?.listing?.status)

console.log('\n=== 2. AUTHORIZATION / ROLE GATES ===')
check('anon cannot create RENTALS (401)', (await call('POST','/api/listings', null, {division:'RENTALS',titleAr:'x',priceMinor:1000,currency:'SYP'})).status === 401)
check('renter(GUEST) cannot create RENTALS (403)', (await call('POST','/api/listings', B, {division:'RENTALS',titleAr:'x',priceMinor:1000,currency:'SYP'})).status === 403)
check('renter cannot access admin moderation (403)', (await call('PATCH','/api/admin/review-queue/listing/00000000-0000-0000-0000-000000000000', B, {decision:'APPROVE'})).status === 403)

console.log('\n=== 3. MEDIA + LIFECYCLE + MODERATION ===')
check('owner attaches media to draft (201)', (await call('POST', `/api/listings/${draftId}/media`, S1, {media:[{url:'/assets/divisions/monthly-rental.webp'}]})).status === 201)
check('landlordB cannot attach media to landlordA rental (404)', (await call('POST', `/api/listings/${draftId}/media`, S2, {media:[{url:'/x.webp'}]})).status === 404)
check('draft rental hidden from browse', !has(await call('GET','/api/listings?division=RENTALS',null), draftId), 'leaked')
const submit = await call('PATCH', `/api/listings/${draftId}/submit`, S1)
check('submit -> PENDING_REVIEW', submit.status === 200 && submit.j?.listing?.status === 'PENDING_REVIEW', submit.status)
check('double-submit blocked', (await call('PATCH', `/api/listings/${draftId}/submit`, S1)).status === 400)
check('media locked once under review', code(await call('POST', `/api/listings/${draftId}/media`, S1, {media:[{url:'/l.webp'}]})) === 'LISTING_MEDIA_LOCKED', 'not locked')
check('pending rental hidden from browse', !has(await call('GET','/api/listings?division=RENTALS',null), draftId), 'leaked')
check('landlord cannot self-moderate (403)', (await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, S1, {decision:'APPROVE'})).status === 403)
check('admin approves rental (200)', (await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, A, {decision:'APPROVE'})).status === 200)
check('approved rental now browsable', has(await call('GET','/api/listings?division=RENTALS',null), draftId), 'missing')
// reject + resubmit
const rj = await call('POST','/api/listings', S1, {division:'RENTALS', titleAr:'reject rental', priceMinor:900000, currency:'SYP', metadata:{visualFilters:{propertyType:'room'}}})
const rjId = rj.j?.listing?.id
await call('PATCH', `/api/listings/${rjId}/submit`, S1)
const reject = await call('PATCH', `/api/admin/review-queue/listing/${rjId}`, A, {decision:'REJECT'})
check('admin rejects rental -> REJECTED', reject.j?.entity?.status === 'REJECTED', JSON.stringify(reject.j?.entity?.status))
check('rejected rental resubmittable', (await call('PATCH', `/api/listings/${rjId}/submit`, S1)).j?.listing?.status === 'PENDING_REVIEW', 'no resubmit')

console.log('\n=== 4. RENTAL FILTERS (property type, beds, baths, monthly rent) ===')
const apt2  = draftId // apartment, 2 bed, 1 bath, 1.8M
const villa5 = await makeListing(S1, 'RENTALS', {visualFilters:{propertyType:'villa'}, bedrooms:5, bathrooms:4}, 6000000, 'Villa monthly Malki')
const byType = await call('GET','/api/listings?division=RENTALS&propertyType=villa', null)
check('filter propertyType=villa includes villa', has(byType, villa5), 'missing')
check('filter propertyType=villa excludes apartment', !has(byType, apt2), 'leaked apt')
const byBeds = await call('GET','/api/listings?division=RENTALS&bedroomsMin=3', null)
check('filter bedroomsMin=3 includes 5-bed villa, excludes 2-bed apt', has(byBeds, villa5) && !has(byBeds, apt2), 'wrong set')
const byBaths = await call('GET','/api/listings?division=RENTALS&bathroomsMin=3', null)
check('filter bathroomsMin=3 isolates 4-bath villa', has(byBaths, villa5) && !has(byBaths, apt2), 'wrong set')
const byRent = await call('GET','/api/listings?division=RENTALS&priceMax=2000000', null)
check('monthly-rent filter priceMax=2M includes apt, excludes villa', has(byRent, apt2) && !has(byRent, villa5), 'wrong set')

console.log('\n=== 5. DIVISION ISOLATION (shared metadata keys) ===')
// A BUY villa with the SAME propertyType key must NOT surface in a RENTALS villa filter
const buyVilla = await makeListing(S1, 'BUY', {visualFilters:{propertyType:'villa'}, bedrooms:5, bathrooms:4}, 480000000, 'Buy villa for isolation')
await approvePlan(S2)
const carId = await makeListing(S2, 'CARS', {visualFilters:{carBrand:'toyota', propertyType:'villa'}}, 9000000, 'Car isolation')
const mktId = await makeListing(S2, 'MARKETPLACE', {}, 200000, 'Sofa isolation')
const rentAll = await call('GET','/api/listings?division=RENTALS', null)
check('RENTALS browse excludes BUY listing', !has(rentAll, buyVilla), 'buy leaked')
check('RENTALS browse excludes CARS listing', !has(rentAll, carId), 'car leaked')
check('RENTALS browse excludes MARKETPLACE listing', !has(rentAll, mktId), 'mkt leaked')
const rentVilla = await call('GET','/api/listings?division=RENTALS&propertyType=villa', null)
check('RENTALS propertyType=villa does NOT leak BUY villa (division scoping wins)', !has(rentVilla, buyVilla), 'cross-division leak')
check('RENTALS propertyType=villa does NOT leak CARS (metadata propertyType ignored cross-division)', !has(rentVilla, carId), 'cross-division leak')
const buyVillaBrowse = await call('GET','/api/listings?division=BUY&propertyType=villa', null)
check('BUY villa filter still works, excludes the RENTALS villa', has(buyVillaBrowse, buyVilla) && !has(buyVillaBrowse, villa5), 'buy regressed')

console.log('\n=== 6. RENTER DETAIL: media + property specs ===')
const detail = await call('GET', `/api/listings/${villa5}`, null)
check('renter opens rental detail (200)', detail.status === 200, detail.status)
check('detail carries media', (detail.j?.listing?.media||[]).length >= 1, 'no media')
check('detail exposes property type + beds', detail.j?.listing?.metadata?.visualFilters?.propertyType === 'villa' && Number(detail.j?.listing?.metadata?.bedrooms) === 5, JSON.stringify(detail.j?.listing?.metadata))
check('unknown/deleted rental -> 404', code(await call('GET','/api/listings/11111111-1111-1111-1111-111111111111', null)) === 'LISTING_NOT_FOUND', 'wrong')

console.log('\n=== 7. INQUIRY (contact) — no deposit/rent movement ===')
const inquiry = await call('POST', `/api/listings/${villa5}/thread/messages`, B, {body:'Is this available for a 12-month lease? Can I view it?'})
check('renter sends contact inquiry (201, message not booking)', inquiry.status === 201 && Boolean(inquiry.j?.message?.id), inquiry.status+' '+code(inquiry))
check('inquiry response has no booking/payment/deposit field', !inquiry.j?.booking && !inquiry.j?.payment && !inquiry.j?.deposit, JSON.stringify(Object.keys(inquiry.j||{})))
const inbox = await call('GET','/api/host/inquiries', S1)
const thread = (inbox.j?.threads||[]).find(t => t.listing?.id === villa5)
check('landlord receives inquiry', Boolean(thread), 'not received')
check('inquiry shows renter identity', thread?.guest?.id === buyer.id, JSON.stringify(thread?.guest))
check('landlordB cannot see landlordA inquiries', !((await call('GET','/api/host/inquiries', S2)).j?.threads||[]).some(t => t.listing?.id === villa5), 'leaked')
check('landlord replies (201)', (await call('POST', `/api/listings/${villa5}/thread/messages`, S1, {body:'Yes, viewing welcome.', guestId: buyer.id})).status === 201)
check('renter sees conversation history (>=2)', ((await call('GET', `/api/listings/${villa5}/thread`, B)).j?.thread?.messages||[]).length >= 2, 'short')
check('landlord cannot fabricate thread w/ unknown renter (404)', code(await call('POST', `/api/listings/${villa5}/thread/messages`, S1, {body:'x', guestId:'00000000-0000-0000-0000-000000000000'})) === 'THREAD_NOT_FOUND', 'not blocked')
check('inquiry on unknown rental -> 404', (await call('POST','/api/listings/11111111-1111-1111-1111-111111111111/thread/messages', B, {body:'hi'})).status === 404)

console.log(`\n==== RENTALS E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
