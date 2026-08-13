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
const uniq = () => 'CAR-' + Math.floor(performance.now() * 1000)

async function approvePlan(token, user) {
  const ref = uniq()
  const proof = await call('POST','/api/payments/seller-plan-proof', token, {planCode:'cars-plus', amountMinor:2000, currency:'USD', providerRef:ref, legalName:'Dealer', sellerType:'dealer'})
  await call('PATCH', `/api/admin/review-queue/payment/${proof.j?.proof?.id}`, A, {decision:'APPROVE'})
}
async function makeCar(token, attrs, price, title) {
  const create = await call('POST','/api/listings', token, {division:'CARS', titleAr:title, titleEn:title, priceMinor:price, currency:'SYP', metadata:{ visualFilters: attrs }})
  const id = create.j?.listing?.id
  await call('POST', `/api/listings/${id}/media`, token, {media:[{url:'/assets/divisions/cars.webp', kind:'image'}]})
  await call('PATCH', `/api/listings/${id}/submit`, token)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, {decision:'APPROVE'})
  return id
}

console.log('=== 1. AUTHORIZATION / ROLE GATES (Cars) ===')
check('anon cannot create CARS listing (401)', (await call('POST','/api/listings', null, {division:'CARS',titleAr:'x',priceMinor:1000,currency:'SYP'})).status === 401)
const buyerCreate = await call('POST','/api/listings', B, {division:'CARS',titleAr:'x',priceMinor:1000,currency:'SYP'})
check('buyer(GUEST) cannot create CARS listing (403)', buyerCreate.status === 403, buyerCreate.status+' '+code(buyerCreate))
const buyerMod = await call('PATCH','/api/admin/review-queue/listing/00000000-0000-0000-0000-000000000000', B, {decision:'APPROVE'})
check('buyer cannot access admin moderation (403)', buyerMod.status === 403, buyerMod.status+' '+code(buyerMod))

console.log('\n=== 2. PAID-PLAN GATE (mock, dealer) ===')
const preGate = await call('POST','/api/listings', S1, {division:'CARS',titleAr:'Gate',priceMinor:5000,currency:'SYP'})
check('dealer w/o approved plan blocked from CARS (403 SELLER_PLAN_REQUIRED)', preGate.status === 403 && code(preGate) === 'SELLER_PLAN_REQUIRED', preGate.status+' '+code(preGate))
await approvePlan(S1, seller1)
const postGate = await call('POST','/api/listings', S1, {division:'CARS',titleAr:'Kia Rio 2019',priceMinor:5000,currency:'SYP', metadata:{visualFilters:{carBrand:'kia'}}})
check('dealer with approved plan can create CARS (201)', postGate.status === 201, postGate.status+' '+code(postGate))
const draftId = postGate.j?.listing?.id
check('new CARS listing starts DRAFT', postGate.j?.listing?.status === 'DRAFT', postGate.j?.listing?.status)

console.log('\n=== 3. VEHICLE ATTRIBUTES + MEDIA + LIFECYCLE ===')
const media = await call('POST', `/api/listings/${draftId}/media`, S1, {media:[{url:'/assets/divisions/cars.webp',kind:'image'}]})
check('dealer attaches media to draft (201)', media.status === 201, media.status+' '+code(media))
const crossMedia = await call('POST', `/api/listings/${draftId}/media`, S2, {media:[{url:'/x.webp'}]})
check('sellerB cannot attach media to sellerA car (404 isolation)', crossMedia.status === 404, crossMedia.status+' '+code(crossMedia))
const submit = await call('PATCH', `/api/listings/${draftId}/submit`, S1)
check('submit -> PENDING_REVIEW', submit.status === 200 && submit.j?.listing?.status === 'PENDING_REVIEW', submit.status)
const resubmit = await call('PATCH', `/api/listings/${draftId}/submit`, S1)
check('double-submit blocked (LISTING_NOT_SUBMITTABLE)', resubmit.status === 400 && code(resubmit) === 'LISTING_NOT_SUBMITTABLE', code(resubmit))
const lateMedia = await call('POST', `/api/listings/${draftId}/media`, S1, {media:[{url:'/late.webp'}]})
check('media locked once under review (LISTING_MEDIA_LOCKED)', lateMedia.status === 400 && code(lateMedia) === 'LISTING_MEDIA_LOCKED', code(lateMedia))
const hidden = await call('GET','/api/listings?division=CARS', null)
check('pending car hidden from browse (moderation)', !(hidden.j?.listings||[]).some(l => l.id === draftId), 'leaked')

console.log('\n=== 4. MODERATION: APPROVE + REJECT ===')
const approve = await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, A, {decision:'APPROVE'})
check('admin approves car (200)', approve.status === 200, approve.status)
const sellerMod = await call('PATCH', `/api/admin/review-queue/listing/${draftId}`, S1, {decision:'APPROVE'})
check('dealer cannot moderate (admin-only, 403)', sellerMod.status === 403, sellerMod.status+' '+code(sellerMod))
// reject path on a fresh listing
const rj = await call('POST','/api/listings', S1, {division:'CARS',titleAr:'reject-me',priceMinor:3000,currency:'SYP',metadata:{visualFilters:{carBrand:'bmw'}}})
const rjId = rj.j?.listing?.id
await call('PATCH', `/api/listings/${rjId}/submit`, S1)
const reject = await call('PATCH', `/api/admin/review-queue/listing/${rjId}`, A, {decision:'REJECT'})
check('admin rejects car -> REJECTED', reject.status === 200 && reject.j?.entity?.status === 'REJECTED', JSON.stringify(reject.j?.entity?.status))
const rejBrowse = await call('GET','/api/listings?division=CARS', null)
check('rejected car not browsable', !(rejBrowse.j?.listings||[]).some(l => l.id === rjId), 'leaked')
const reAddMedia = await call('POST', `/api/listings/${rjId}/media`, S1, {media:[{url:'/assets/divisions/cars.webp'}]})
check('rejected car re-opens for media edit', reAddMedia.status === 201, reAddMedia.status+' '+code(reAddMedia))
const reSubmit = await call('PATCH', `/api/listings/${rjId}/submit`, S1)
check('rejected car can be resubmitted (REJECTED->PENDING_REVIEW)', reSubmit.status === 200 && reSubmit.j?.listing?.status === 'PENDING_REVIEW', reSubmit.j?.listing?.status)

console.log('\n=== 5. FILTERS / SEARCH (attributes, price, division scoping) ===')
const toyota = await makeCar(S1, {carBrand:'toyota', carBody:'sedan', carFuel:'diesel', carTransmission:'automatic', condition:'used'}, 15000000, 'Toyota Camry')
const honda  = await makeCar(S1, {carBrand:'honda', carBody:'suv', carFuel:'gas', carTransmission:'manual', condition:'new'}, 8000000, 'Honda CR-V')
const byBrand = await call('GET','/api/listings?division=CARS&carBrand=toyota', null)
check('filter carBrand=toyota includes toyota', (byBrand.j?.listings||[]).some(l => l.id === toyota), 'missing')
check('filter carBrand=toyota excludes honda', !(byBrand.j?.listings||[]).some(l => l.id === honda), 'leaked honda')
const byFuel = await call('GET','/api/listings?division=CARS&carFuel=gas', null)
check('filter carFuel=gas includes honda, excludes toyota', (byFuel.j?.listings||[]).some(l=>l.id===honda) && !(byFuel.j?.listings||[]).some(l=>l.id===toyota), 'wrong set')
const byTrans = await call('GET','/api/listings?division=CARS&carTransmission=manual', null)
check('filter carTransmission=manual isolates honda', (byTrans.j?.listings||[]).some(l=>l.id===honda) && !(byTrans.j?.listings||[]).some(l=>l.id===toyota), 'wrong set')
const byPrice = await call('GET','/api/listings?division=CARS&priceMin=10000000', null)
check('price filter priceMin=10M includes toyota, excludes honda', (byPrice.j?.listings||[]).some(l=>l.id===toyota) && !(byPrice.j?.listings||[]).some(l=>l.id===honda), 'wrong set')
// division scoping: a MARKETPLACE listing must never appear under CARS
const mkt = await approvePlanAndMakeMarketplace()
const carsBrowse = await call('GET','/api/listings?division=CARS', null)
check('CARS browse excludes MARKETPLACE listing (no division leak)', !(carsBrowse.j?.listings||[]).some(l => l.id === mkt), 'division leak')
const mktBrowse = await call('GET','/api/listings?division=MARKETPLACE', null)
check('MARKETPLACE browse excludes CARS listing', !(mktBrowse.j?.listings||[]).some(l => l.id === toyota), 'division leak')

console.log('\n=== 6. BUYER DETAIL: media + specifications ===')
const detail = await call('GET', `/api/listings/${toyota}`, null)
check('buyer opens vehicle detail (200)', detail.status === 200, detail.status)
check('detail carries media', (detail.j?.listing?.media||[]).length >= 1, JSON.stringify(detail.j?.listing?.media))
const vf = detail.j?.listing?.metadata?.visualFilters
check('detail exposes vehicle specs (make/fuel/transmission)', vf?.carBrand === 'toyota' && vf?.carFuel === 'diesel' && vf?.carTransmission === 'automatic', JSON.stringify(vf))
check('detail exposes seller identity', Boolean(detail.j?.listing?.owner?.displayName), JSON.stringify(detail.j?.listing?.owner))
const missing = await call('GET','/api/listings/11111111-1111-1111-1111-111111111111', null)
check('unknown/deleted vehicle -> 404', missing.status === 404 && code(missing) === 'LISTING_NOT_FOUND', missing.status+' '+code(missing))

console.log('\n=== 7. INQUIRY LIFECYCLE ===')
const inquiry = await call('POST', `/api/listings/${toyota}/thread/messages`, B, {body:'Is the Camry still available? Can I inspect it?'})
check('buyer sends inquiry on car (201)', inquiry.status === 201, inquiry.status+' '+code(inquiry))
const inbox = await call('GET','/api/host/inquiries', S1)
const thread = (inbox.j?.threads||[]).find(t => t.listing?.id === toyota)
check('dealer receives inquiry', Boolean(thread), 'not received')
check('inquiry shows buyer identity', thread?.guest?.id === buyer.id, JSON.stringify(thread?.guest))
const inbox2 = await call('GET','/api/host/inquiries', S2)
check('sellerB cannot see sellerA car inquiries (isolation)', !(inbox2.j?.threads||[]).some(t => t.listing?.id === toyota), 'leaked')
const reply = await call('POST', `/api/listings/${toyota}/thread/messages`, S1, {body:'Yes, available. Inspection welcome.', guestId: buyer.id})
check('dealer replies (201)', reply.status === 201, reply.status+' '+code(reply))
const buyerThread = await call('GET', `/api/listings/${toyota}/thread`, B)
check('buyer sees conversation history (>=2 msgs)', (buyerThread.j?.thread?.messages||[]).length >= 2, 'count='+(buyerThread.j?.thread?.messages||[]).length)
const fab = await call('POST', `/api/listings/${toyota}/thread/messages`, S1, {body:'spam', guestId:'00000000-0000-0000-0000-000000000000'})
check('dealer cannot fabricate thread w/ unknown buyer (404)', fab.status === 404 && code(fab) === 'THREAD_NOT_FOUND', fab.status+' '+code(fab))
const inqMissing = await call('POST','/api/listings/11111111-1111-1111-1111-111111111111/thread/messages', B, {body:'hi'})
check('inquiry on unknown vehicle -> 404', inqMissing.status === 404, inqMissing.status)

console.log(`\n==== CARS E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)

async function approvePlanAndMakeMarketplace() {
  // seller2 gets an approved plan and posts a MARKETPLACE listing for the cross-division leak test
  await approvePlan(S2, seller2)
  const c = await call('POST','/api/listings', S2, {division:'MARKETPLACE', titleAr:'Sofa', priceMinor:200000, currency:'SYP'})
  const id = c.j?.listing?.id
  await call('POST', `/api/listings/${id}/media`, S2, {media:[{url:'/assets/divisions/marketplace.webp'}]})
  await call('PATCH', `/api/listings/${id}/submit`, S2)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, {decision:'APPROVE'})
  return id
}
