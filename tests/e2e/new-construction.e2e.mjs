import { createSessionToken } from './_session.mjs'

const API = 'http://127.0.0.1:3051'
const dev1  = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
const dev2  = { id: process.env.SELLER2, roles: [{ role: 'SELLER' }] }
const buyer = { id: process.env.BUYER,   roles: [{ role: 'GUEST' }] }
const admin = { id: process.env.ADMIN,   roles: [{ role: 'ADMIN' }] }
const D1 = await createSessionToken(dev1), D2 = await createSessionToken(dev2)
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

async function approvePlan(token) {
  const ref = 'NC-' + Math.floor(performance.now()*1000)
  const p = await call('POST','/api/payments/seller-plan-proof', token, {planCode:'plus', amountMinor:5000, currency:'USD', providerRef:ref, legalName:'Developer Co', sellerType:'developer'})
  await call('PATCH', `/api/admin/review-queue/payment/${p.j?.proof?.id}`, A, {decision:'APPROVE'})
}
async function makeListing(token, division, meta, price, title, needPlan) {
  const c = await call('POST','/api/listings', token, {division, titleAr:title, titleEn:title, priceMinor:price, currency:'SYP', metadata:meta})
  const id = c.j?.listing?.id
  await call('POST', `/api/listings/${id}/media`, token, {media:[{url:'/assets/divisions/new-construction.webp', kind:'image'}]})
  await call('PATCH', `/api/listings/${id}/submit`, token)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, {decision:'APPROVE'})
  return id
}

// Publish gate (server/routes/listings.mjs) requires an admin-approved ID document plus an
// accepted 'listing-agreement' legal consent before ANY division's submit() can leave DRAFT --
// satisfy it for both developers up front so downstream submit/approve/browse/inquiry assertions
// are genuinely exercised instead of stopping at 403 ID_VERIFICATION_REQUIRED.
async function verifySellerKyc(token, userId) {
  await call('PATCH', '/api/me/id-document', token, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${userId}`, A, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const doc = legal.j.documents.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', token, { documentKey: 'listing-agreement', version: doc.version })
}
console.log('=== 0. KYC + LEGAL-CONSENT BOOTSTRAP (required by the listings.mjs publish gate) ===')
await verifySellerKyc(D1, dev1.id)
await verifySellerKyc(D2, dev2.id)

console.log('=== 1. AUTHORIZATION / ROLE GATES ===')
check('anon cannot create NEW_CONSTRUCTION (401)', (await call('POST','/api/listings', null, {division:'NEW_CONSTRUCTION',titleAr:'x',priceMinor:1000,currency:'SYP'})).status === 401)
check('buyer(GUEST) cannot create NEW_CONSTRUCTION (403)', (await call('POST','/api/listings', B, {division:'NEW_CONSTRUCTION',titleAr:'x',priceMinor:1000,currency:'SYP'})).status === 403)
check('buyer cannot access admin moderation (403)', (await call('PATCH','/api/admin/review-queue/listing/00000000-0000-0000-0000-000000000000', B, {decision:'APPROVE'})).status === 403)

console.log('\n=== 2. PAID-PLAN GATE (mock, developer) ===')
const preGate = await call('POST','/api/listings', D1, {division:'NEW_CONSTRUCTION',titleAr:'Green Towers project',priceMinor:250000000,currency:'SYP',metadata:{visualFilters:{propertyType:'project'}}})
check('developer w/o approved plan blocked (403 SELLER_PLAN_REQUIRED)', preGate.status === 403 && code(preGate) === 'SELLER_PLAN_REQUIRED', preGate.status+' '+code(preGate))
await approvePlan(D1)
const postGate = await call('POST','/api/listings', D1, {division:'NEW_CONSTRUCTION',titleAr:'Green Towers project',priceMinor:250000000,currency:'SYP',metadata:{visualFilters:{propertyType:'project'}, bedrooms:3, bathrooms:2, sizeSqm:180}})
check('developer with approved plan can create project (201)', postGate.status === 201, postGate.status+' '+code(postGate))
const draftId = postGate.j?.listing?.id
check('new project starts DRAFT', postGate.j?.listing?.status === 'DRAFT', postGate.j?.listing?.status)

console.log('\n=== 3. MEDIA + LIFECYCLE + MODERATION ===')
check('developer attaches media to draft (201)', (await call('POST', `/api/listings/${draftId}/media`, D1, {media:[{url:'/assets/divisions/new-construction.webp'}]})).status === 201)
check('developerB cannot attach media to devA project (404)', (await call('POST', `/api/listings/${draftId}/media`, D2, {media:[{url:'/x.webp'}]})).status === 404)
check('draft project hidden from browse', !has(await call('GET','/api/listings?division=NEW_CONSTRUCTION',null), draftId), 'leaked')
const submit = await call('PATCH', `/api/listings/${draftId}/submit`, D1)
check('submit -> PENDING_REVIEW', submit.status === 200 && submit.j?.listing?.status === 'PENDING_REVIEW', submit.status)
check('double-submit blocked', (await call('PATCH', `/api/listings/${draftId}/submit`, D1)).status === 400)
check('media locked once under review', code(await call('POST', `/api/listings/${draftId}/media`, D1, {media:[{url:'/l.webp'}]})) === 'LISTING_MEDIA_LOCKED', 'not locked')
check('pending project hidden from browse', !has(await call('GET','/api/listings?division=NEW_CONSTRUCTION',null), draftId), 'leaked')
check('developer cannot self-moderate (403)', (await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, D1, {decision:'APPROVE'})).status === 403)
check('admin approves project (200)', (await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, A, {decision:'APPROVE'})).status === 200)
check('approved project now browsable', has(await call('GET','/api/listings?division=NEW_CONSTRUCTION',null), draftId), 'missing')
// reject + resubmit
const rj = await call('POST','/api/listings', D1, {division:'NEW_CONSTRUCTION',titleAr:'reject project',priceMinor:99000000,currency:'SYP',metadata:{visualFilters:{propertyType:'apartment'}}})
const rjId = rj.j?.listing?.id
await call('PATCH', `/api/listings/${rjId}/submit`, D1)
check('admin rejects project -> REJECTED', (await call('PATCH', `/api/admin/review-queue/listing/${rjId}`, A, {decision:'REJECT'})).j?.entity?.status === 'REJECTED', 'no reject')
check('rejected project resubmittable', (await call('PATCH', `/api/listings/${rjId}/submit`, D1)).j?.listing?.status === 'PENDING_REVIEW', 'no resubmit')

console.log('\n=== 4. PROJECT FILTERS (propertyType, beds, starting price) ===')
const projA = draftId // propertyType project, 3 bed, 250M
const aptTower = await makeListing(D1, 'NEW_CONSTRUCTION', {visualFilters:{propertyType:'apartment'}, bedrooms:1, bathrooms:1}, 60000000, 'Studio tower')
const byType = await call('GET','/api/listings?division=NEW_CONSTRUCTION&propertyType=project', null)
check('filter propertyType=project includes project', has(byType, projA), 'missing')
check('filter propertyType=project excludes apartment tower', !has(byType, aptTower), 'leaked')
const byBeds = await call('GET','/api/listings?division=NEW_CONSTRUCTION&bedroomsMin=3', null)
check('filter bedroomsMin=3 includes 3-bed project, excludes 1-bed', has(byBeds, projA) && !has(byBeds, aptTower), 'wrong set')
const byPrice = await call('GET','/api/listings?division=NEW_CONSTRUCTION&priceMax=100000000', null)
check('starting-price filter priceMax=100M includes studio, excludes project', has(byPrice, aptTower) && !has(byPrice, projA), 'wrong set')

console.log('\n=== 5. DIVISION ISOLATION (shared metadata keys) ===')
const buyProj = await makeListing(D1, 'BUY', {visualFilters:{propertyType:'project'}}, 300000000, 'Buy project isolation')
await approvePlan(D2)
const carId = await makeListing(D2, 'CARS', {visualFilters:{carBrand:'toyota', propertyType:'project'}}, 9000000, 'Car isolation')
const rentId = await makeListing(D2, 'RENTALS', {visualFilters:{propertyType:'project'}}, 2000000, 'Rental isolation')
const mktId = await makeListing(D2, 'MARKETPLACE', {}, 200000, 'Sofa isolation')
const ncAll = await call('GET','/api/listings?division=NEW_CONSTRUCTION', null)
check('NC browse excludes BUY', !has(ncAll, buyProj), 'buy leaked')
check('NC browse excludes CARS', !has(ncAll, carId), 'car leaked')
check('NC browse excludes RENTALS', !has(ncAll, rentId), 'rental leaked')
check('NC browse excludes MARKETPLACE', !has(ncAll, mktId), 'mkt leaked')
const ncProject = await call('GET','/api/listings?division=NEW_CONSTRUCTION&propertyType=project', null)
check('NC propertyType=project does NOT leak BUY/CARS/RENTALS w/ same key (division scoping wins)', !has(ncProject, buyProj) && !has(ncProject, carId) && !has(ncProject, rentId), 'cross-division leak')
const buyProjBrowse = await call('GET','/api/listings?division=BUY&propertyType=project', null)
check('BUY project filter still works, excludes NC project', has(buyProjBrowse, buyProj) && !has(buyProjBrowse, projA), 'buy regressed')

console.log('\n=== 6. BUYER DETAIL: media + project specs ===')
const detail = await call('GET', `/api/listings/${projA}`, null)
check('buyer opens project detail (200)', detail.status === 200, detail.status)
check('detail carries media', (detail.j?.listing?.media||[]).length >= 1, 'no media')
check('detail exposes project attributes (type + beds + size)', detail.j?.listing?.metadata?.visualFilters?.propertyType === 'project' && Number(detail.j?.listing?.metadata?.bedrooms) === 3 && Number(detail.j?.listing?.metadata?.sizeSqm) === 180, JSON.stringify(detail.j?.listing?.metadata))
check('detail exposes developer identity', Boolean(detail.j?.listing?.owner?.displayName), JSON.stringify(detail.j?.listing?.owner))
check('unknown/deleted project -> 404', code(await call('GET','/api/listings/11111111-1111-1111-1111-111111111111', null)) === 'LISTING_NOT_FOUND', 'wrong')

console.log('\n=== 7. INQUIRY (contact) — no reservation/deposit ===')
const inquiry = await call('POST', `/api/listings/${projA}/thread/messages`, B, {body:'What is the delivery date and can I book a visit to the showroom?'})
check('buyer sends project inquiry (201, message not booking)', inquiry.status === 201 && Boolean(inquiry.j?.message?.id), inquiry.status+' '+code(inquiry))
check('inquiry response has no booking/payment/reservation/deposit field', !inquiry.j?.booking && !inquiry.j?.payment && !inquiry.j?.reservation && !inquiry.j?.deposit, JSON.stringify(Object.keys(inquiry.j||{})))
const inbox = await call('GET','/api/host/inquiries', D1)
const thread = (inbox.j?.threads||[]).find(t => t.listing?.id === projA)
check('developer receives inquiry', Boolean(thread), 'not received')
check('inquiry shows buyer identity', thread?.guest?.id === buyer.id, JSON.stringify(thread?.guest))
check('developerB cannot see developerA inquiries', !((await call('GET','/api/host/inquiries', D2)).j?.threads||[]).some(t => t.listing?.id === projA), 'leaked')
check('developer replies (201)', (await call('POST', `/api/listings/${projA}/thread/messages`, D1, {body:'Delivery Q4 2027. Showroom visits welcome.', guestId: buyer.id})).status === 201)
check('buyer sees conversation history (>=2)', ((await call('GET', `/api/listings/${projA}/thread`, B)).j?.thread?.messages||[]).length >= 2, 'short')
check('developer cannot fabricate thread w/ unknown buyer (404)', code(await call('POST', `/api/listings/${projA}/thread/messages`, D1, {body:'x', guestId:'00000000-0000-0000-0000-000000000000'})) === 'THREAD_NOT_FOUND', 'not blocked')
check('inquiry on unknown project -> 404', (await call('POST','/api/listings/11111111-1111-1111-1111-111111111111/thread/messages', B, {body:'hi'})).status === 404)

console.log(`\n==== NEW CONSTRUCTION E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
