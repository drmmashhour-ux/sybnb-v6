import { createSessionToken } from './_session.mjs'

const API = 'http://127.0.0.1:3051'
const seller1 = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
const seller2 = { id: process.env.SELLER2, roles: [{ role: 'SELLER' }] }
const buyer   = { id: process.env.BUYER,   roles: [{ role: 'GUEST' }] }
const admin   = { id: process.env.ADMIN,   roles: [{ role: 'ADMIN' }] }
const S1 = await createSessionToken(seller1), S2 = await createSessionToken(seller2)
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

async function makeBuy(token, meta, price, title) {
  const c = await call('POST','/api/listings', token, {division:'BUY', titleAr:title, titleEn:title, priceMinor:price, currency:'SYP', metadata:meta})
  const id = c.j?.listing?.id
  await call('POST', `/api/listings/${id}/media`, token, {media:[{url:'/assets/divisions/buy-property.webp', kind:'image'}]})
  await call('PATCH', `/api/listings/${id}/submit`, token)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, {decision:'APPROVE'})
  return id
}
async function approvePlan(token) {
  const ref = 'BUY-' + Math.floor(performance.now()*1000)
  const p = await call('POST','/api/payments/seller-plan-proof', token, {planCode:'plus', amountMinor:1500, currency:'USD', providerRef:ref, legalName:'X', sellerType:'dealer'})
  await call('PATCH', `/api/admin/review-queue/payment/${p.j?.proof?.id}`, A, {decision:'APPROVE'})
}

// Publish gate (server/routes/listings.mjs) requires an admin-approved ID document plus an
// accepted 'listing-agreement' legal consent before ANY division's submit() can leave DRAFT --
// satisfy it for both sellers up front so downstream submit/approve/browse/inquiry assertions are
// genuinely exercised instead of stopping at 403 ID_VERIFICATION_REQUIRED.
async function verifySellerKyc(token, userId) {
  await call('PATCH', '/api/me/id-document', token, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${userId}`, A, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const doc = legal.j.documents.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', token, { documentKey: 'listing-agreement', version: doc.version })
}
console.log('=== 0. KYC + LEGAL-CONSENT BOOTSTRAP (required by the listings.mjs publish gate) ===')
await verifySellerKyc(S1, seller1.id)
await verifySellerKyc(S2, seller2.id)

console.log('=== 1. COMMISSION/CONTACT MODEL: no plan gate ===')
// seller1 has NO seller profile (deleted in wrapper) — Buy must NOT require a paid plan
const noPlanCreate = await call('POST','/api/listings', S1, {division:'BUY', titleAr:'Villa in Damascus', priceMinor:500000000, currency:'SYP', metadata:{visualFilters:{propertyType:'villa'}}})
check('seller creates BUY listing WITHOUT any plan (201, no gate)', noPlanCreate.status === 201, noPlanCreate.status+' '+code(noPlanCreate))
check('BUY create not blocked by SELLER_PLAN_REQUIRED', code(noPlanCreate) !== 'SELLER_PLAN_REQUIRED', code(noPlanCreate))
const draftId = noPlanCreate.j?.listing?.id
check('new BUY listing starts DRAFT', noPlanCreate.j?.listing?.status === 'DRAFT', noPlanCreate.j?.listing?.status)

console.log('\n=== 2. AUTHORIZATION / ROLE GATES ===')
check('anon cannot create BUY (401)', (await call('POST','/api/listings', null, {division:'BUY',titleAr:'x',priceMinor:1000,currency:'SYP'})).status === 401)
const buyerCreate = await call('POST','/api/listings', B, {division:'BUY',titleAr:'x',priceMinor:1000,currency:'SYP'})
check('buyer(GUEST) cannot create BUY (403)', buyerCreate.status === 403, buyerCreate.status+' '+code(buyerCreate))
check('buyer cannot access admin moderation (403)', (await call('PATCH','/api/admin/review-queue/listing/00000000-0000-0000-0000-000000000000', B, {decision:'APPROVE'})).status === 403)

console.log('\n=== 3. MEDIA + LIFECYCLE + MODERATION ===')
const media = await call('POST', `/api/listings/${draftId}/media`, S1, {media:[{url:'/assets/divisions/buy-property.webp'}]})
check('owner attaches media to draft (201)', media.status === 201, media.status+' '+code(media))
const crossMedia = await call('POST', `/api/listings/${draftId}/media`, S2, {media:[{url:'/x.webp'}]})
check('sellerB cannot attach media to sellerA property (404)', crossMedia.status === 404, crossMedia.status+' '+code(crossMedia))
check('draft property hidden from browse', !has(await call('GET','/api/listings?division=BUY',null), draftId), 'leaked')
const submit = await call('PATCH', `/api/listings/${draftId}/submit`, S1)
check('submit -> PENDING_REVIEW', submit.status === 200 && submit.j?.listing?.status === 'PENDING_REVIEW', submit.status)
check('double-submit blocked', (await call('PATCH', `/api/listings/${draftId}/submit`, S1)).status === 400)
check('media locked once under review', code(await call('POST', `/api/listings/${draftId}/media`, S1, {media:[{url:'/l.webp'}]})) === 'LISTING_MEDIA_LOCKED', 'not locked')
check('pending property hidden from browse', !has(await call('GET','/api/listings?division=BUY',null), draftId), 'leaked')
const sellerMod = await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, S1, {decision:'APPROVE'})
check('seller cannot self-moderate (403)', sellerMod.status === 403, sellerMod.status)
check('admin approves property (200)', (await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, A, {decision:'APPROVE'})).status === 200)
check('approved property now browsable', has(await call('GET','/api/listings?division=BUY',null), draftId), 'missing')

console.log('\n=== 4. PROPERTY FILTERS ===')
const villa = draftId // villa, 500M, propertyType villa (no beds set) — augment: create richer set
const aptB   = await makeBuy(S1, {visualFilters:{propertyType:'apartment'}, bedrooms:2, bathrooms:1}, 120000000, 'Apartment Mezzeh')
const villaR = await makeBuy(S1, {visualFilters:{propertyType:'villa'}, bedrooms:5, bathrooms:4}, 480000000, 'Villa Malki')
const byType = await call('GET','/api/listings?division=BUY&propertyType=apartment', null)
check('filter propertyType=apartment includes apt', has(byType, aptB), 'missing')
check('filter propertyType=apartment excludes villa', !has(byType, villaR), 'leaked villa')
const byBeds = await call('GET','/api/listings?division=BUY&bedroomsMin=3', null)
check('filter bedroomsMin=3 includes 5-bed villa', has(byBeds, villaR), 'missing')
check('filter bedroomsMin=3 excludes 2-bed apt', !has(byBeds, aptB), 'leaked apt')
const byBaths = await call('GET','/api/listings?division=BUY&bathroomsMin=3', null)
check('filter bathroomsMin=3 isolates 4-bath villa', has(byBaths, villaR) && !has(byBaths, aptB), 'wrong set')
const byPrice = await call('GET','/api/listings?division=BUY&priceMax=150000000', null)
check('filter priceMax=150M includes apt, excludes villa', has(byPrice, aptB) && !has(byPrice, villaR), 'wrong set')

console.log('\n=== 5. DIVISION ISOLATION (rerun shared-filter safety) ===')
await approvePlan(S2)
const car = await call('POST','/api/listings', S2, {division:'CARS', titleAr:'Toyota Buy-Test', priceMinor:9000000, currency:'SYP', metadata:{visualFilters:{carBrand:'toyota', propertyType:'villa'}}})
const carId = car.j?.listing?.id
await call('POST', `/api/listings/${carId}/media`, S2, {media:[{url:'/assets/divisions/cars.webp'}]})
await call('PATCH', `/api/listings/${carId}/submit`, S2)
await call('PATCH', `/api/admin/review-queue/listing/${carId}`, A, {decision:'APPROVE'})
const mkt = await call('POST','/api/listings', S2, {division:'MARKETPLACE', titleAr:'Sofa Buy-Test', priceMinor:200000, currency:'SYP'})
const mktId = mkt.j?.listing?.id
await call('POST', `/api/listings/${mktId}/media`, S2, {media:[{url:'/assets/divisions/marketplace.webp'}]})
await call('PATCH', `/api/listings/${mktId}/submit`, S2)
await call('PATCH', `/api/admin/review-queue/listing/${mktId}`, A, {decision:'APPROVE'})
const buyAll = await call('GET','/api/listings?division=BUY', null)
check('BUY browse excludes CARS listing', !has(buyAll, carId), 'car leaked')
check('BUY browse excludes MARKETPLACE listing', !has(buyAll, mktId), 'mkt leaked')
// the car has propertyType=villa in metadata but is division CARS — must NOT surface under BUY villa filter
const buyVilla = await call('GET','/api/listings?division=BUY&propertyType=villa', null)
check('BUY propertyType=villa does NOT leak the CARS listing (division scoping wins)', !has(buyVilla, carId), 'cross-division leak')
// Cars regression: carBrand filter still works and excludes property
const carsToyota = await call('GET','/api/listings?division=CARS&carBrand=toyota', null)
check('CARS carBrand=toyota still works, excludes BUY villa', has(carsToyota, carId) && !has(carsToyota, villaR), 'cars filter regressed')

console.log('\n=== 6. BUYER DETAIL: media + property specs ===')
const detail = await call('GET', `/api/listings/${villaR}`, null)
check('buyer opens property detail (200)', detail.status === 200, detail.status)
check('detail carries media', (detail.j?.listing?.media||[]).length >= 1, JSON.stringify(detail.j?.listing?.media))
const vf = detail.j?.listing?.metadata?.visualFilters
check('detail exposes property type', vf?.propertyType === 'villa', JSON.stringify(vf))
check('detail exposes bedrooms/bathrooms', Number(detail.j?.listing?.metadata?.bedrooms) === 5, JSON.stringify(detail.j?.listing?.metadata?.bedrooms))
check('unknown/deleted property -> 404', code(await call('GET','/api/listings/11111111-1111-1111-1111-111111111111', null)) === 'LISTING_NOT_FOUND', 'wrong')

console.log('\n=== 7. INQUIRY (contact) — no booking/commission created ===')
const inquiry = await call('POST', `/api/listings/${villaR}/thread/messages`, B, {body:'I would like to request a visit for this villa.'})
check('buyer sends contact/visit inquiry (201, message not booking)', inquiry.status === 201 && Boolean(inquiry.j?.message?.id), inquiry.status+' '+code(inquiry))
check('inquiry response has no booking/payment/commission field', !inquiry.j?.booking && !inquiry.j?.payment && !inquiry.j?.commission, JSON.stringify(Object.keys(inquiry.j||{})))
const inbox = await call('GET','/api/host/inquiries', S1)
const thread = (inbox.j?.threads||[]).find(t => t.listing?.id === villaR)
check('seller receives inquiry', Boolean(thread), 'not received')
check('inquiry shows buyer identity', thread?.guest?.id === buyer.id, JSON.stringify(thread?.guest))
check('sellerB cannot see sellerA inquiries', !((await call('GET','/api/host/inquiries', S2)).j?.threads||[]).some(t => t.listing?.id === villaR), 'leaked')
const reply = await call('POST', `/api/listings/${villaR}/thread/messages`, S1, {body:'Visit welcome this weekend.', guestId: buyer.id})
check('seller replies (201)', reply.status === 201, reply.status+' '+code(reply))
check('buyer sees conversation history (>=2)', ((await call('GET', `/api/listings/${villaR}/thread`, B)).j?.thread?.messages||[]).length >= 2, 'short')
check('seller cannot fabricate thread w/ unknown buyer (404)', code(await call('POST', `/api/listings/${villaR}/thread/messages`, S1, {body:'x', guestId:'00000000-0000-0000-0000-000000000000'})) === 'THREAD_NOT_FOUND', 'not blocked')
check('inquiry on unknown property -> 404', (await call('POST','/api/listings/11111111-1111-1111-1111-111111111111/thread/messages', B, {body:'hi'})).status === 404)

console.log(`\n==== BUY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
