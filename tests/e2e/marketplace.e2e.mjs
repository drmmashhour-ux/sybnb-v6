import { createSessionToken } from '../../server/lib/security.mjs'

const API = 'http://127.0.0.1:3051'
const seller1 = { id: process.env.SELLER1, roles: [{ role: 'SELLER' }] }
const seller2 = { id: process.env.SELLER2, roles: [{ role: 'SELLER' }] }
const buyer   = { id: process.env.BUYER,   roles: [{ role: 'GUEST' }] }
const admin   = { id: process.env.ADMIN,   roles: [{ role: 'ADMIN' }] }
const S1 = createSessionToken(seller1)
const S2 = createSessionToken(seller2)
const B  = createSessionToken(buyer)
const A  = createSessionToken(admin)

let pass = 0, fail = 0
async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let j; const text = await res.text()
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}
const code = r => r.j?.error?.code || r.j?.code
const uniq = () => 'MKT-' + Math.floor(performance.now() * 1000)

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

console.log('=== 1. AUTHORIZATION / ROLE GATES ===')
check('anon cannot create listing (401)', (await call('POST','/api/listings', null, {division:'MARKETPLACE',titleAr:'x',priceMinor:1000,currency:'SYP'})).status === 401)
const buyerCreate = await call('POST','/api/listings', B, {division:'MARKETPLACE',titleAr:'x',priceMinor:1000,currency:'SYP'})
check('buyer(GUEST) cannot create listing (403)', buyerCreate.status === 403, buyerCreate.status+' '+code(buyerCreate))
const buyerMod = await call('PATCH','/api/admin/review-queue/listing/00000000-0000-0000-0000-000000000000', B, {decision:'APPROVE'})
check('buyer cannot access admin moderation (403)', buyerMod.status === 403, buyerMod.status+' '+code(buyerMod))

console.log('\n=== 2. PAID-PLAN GATE (mock payment) ===')
const preGate = await call('POST','/api/listings', S1, {division:'MARKETPLACE',titleAr:'Gate test',priceMinor:5000,currency:'SYP'})
check('seller w/o approved plan blocked from MARKETPLACE (403 SELLER_PLAN_REQUIRED)',
  preGate.status === 403 && code(preGate) === 'SELLER_PLAN_REQUIRED', preGate.status+' '+code(preGate))

const planRef = uniq()
const planProof = await call('POST','/api/payments/seller-plan-proof', S1, {planCode:'plus', amountMinor:1500, currency:'USD', providerRef:planRef, legalName:'Seller One', sellerType:'merchant'})
check('seller submits plan payment proof (mock, 201)', planProof.status === 201, planProof.status+' '+code(planProof))
const dupProof = await call('POST','/api/payments/seller-plan-proof', S1, {planCode:'plus', amountMinor:1500, currency:'USD', providerRef:planRef})
check('duplicate plan providerRef rejected (409)', dupProof.status === 409 && code(dupProof) === 'PAYMENT_REFERENCE_DUPLICATE', dupProof.status+' '+code(dupProof))
const proofId = planProof.j?.proof?.id
const approvePlan = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, A, {decision:'APPROVE'})
check('admin approves plan -> seller profile APPROVED (200)', approvePlan.status === 200, approvePlan.status+' '+code(approvePlan))

console.log('\n=== 3. SELLER LISTING LIFECYCLE + MEDIA ===')
const create = await call('POST','/api/listings', S1, {division:'MARKETPLACE',titleAr:'كنبة جلد فاخرة',titleEn:'Leather sofa',description:'Excellent condition',priceMinor:250000,currency:'SYP'})
check('seller creates MARKETPLACE listing after approval (201)', create.status === 201, create.status+' '+code(create))
const listingId = create.j?.listing?.id
check('new listing starts as DRAFT', create.j?.listing?.status === 'DRAFT', create.j?.listing?.status)

// media (new endpoint)
const media = await call('POST', `/api/listings/${listingId}/media`, S1, {media:[{url:'/assets/divisions/marketplace.webp',kind:'image',sortOrder:0}]})
check('seller attaches media to draft (201)', media.status === 201, media.status+' '+code(media))
check('media persisted (1 item)', Array.isArray(media.j?.media) && media.j.media.length === 1, JSON.stringify(media.j?.media))

// isolation: seller2 cannot attach media to seller1 listing
const crossMedia = await call('POST', `/api/listings/${listingId}/media`, S2, {media:[{url:'/x.webp'}]})
check('seller2 cannot add media to seller1 listing (404 isolation)', crossMedia.status === 404, crossMedia.status+' '+code(crossMedia))

// not visible before approval
const preBrowse = await call('GET','/api/listings?division=MARKETPLACE', null)
check('draft listing NOT in public browse', !(preBrowse.j?.listings||[]).some(l => l.id === listingId), 'leaked')

// submit
const submit = await call('PATCH', `/api/listings/${listingId}/submit`, S1)
check('seller submits listing -> PENDING_REVIEW (200)', submit.status === 200 && submit.j?.listing?.status === 'PENDING_REVIEW', submit.status+' '+submit.j?.listing?.status)
// idempotency / double submit
const resubmit = await call('PATCH', `/api/listings/${listingId}/submit`, S1)
check('double-submit blocked (400 LISTING_NOT_SUBMITTABLE)', resubmit.status === 400 && code(resubmit) === 'LISTING_NOT_SUBMITTABLE', resubmit.status+' '+code(resubmit))
// media locked after leaving draft
const lateMedia = await call('POST', `/api/listings/${listingId}/media`, S1, {media:[{url:'/late.webp'}]})
check('media locked once under review (400 LISTING_MEDIA_LOCKED)', lateMedia.status === 400 && code(lateMedia) === 'LISTING_MEDIA_LOCKED', lateMedia.status+' '+code(lateMedia))

// still not visible while pending
const midBrowse = await call('GET','/api/listings?division=MARKETPLACE', null)
check('pending listing still hidden from browse (moderation)', !(midBrowse.j?.listings||[]).some(l => l.id === listingId), 'leaked')

console.log('\n=== 4. ADMIN MODERATION ===')
const approve = await call('PATCH', `/api/admin/review-queue/listing/${listingId}`, A, {decision:'APPROVE'})
check('admin approves listing (200)', approve.status === 200, approve.status+' '+code(approve))
const dupApprove = await call('PATCH', `/api/admin/review-queue/listing/${listingId}`, A, {decision:'APPROVE'})
check('re-approve already-approved blocked (LISTING_NOT_REVIEWABLE)', dupApprove.status >= 400 && code(dupApprove) === 'LISTING_NOT_REVIEWABLE', dupApprove.status+' '+code(dupApprove))

console.log('\n=== 5. BUYER BROWSE / DETAIL ===')
const browse = await call('GET','/api/listings?division=MARKETPLACE', null)
const inBrowse = (browse.j?.listings||[]).find(l => l.id === listingId)
check('approved listing appears in public browse', Boolean(inBrowse), 'missing')
check('browse listing carries media', Boolean(inBrowse && (inBrowse.media||[]).length >= 1), JSON.stringify(inBrowse?.media))
const detail = await call('GET', `/api/listings/${listingId}`, null)
check('buyer opens listing detail (200)', detail.status === 200, detail.status)
check('detail exposes seller identity', Boolean(detail.j?.listing?.owner?.displayName), JSON.stringify(detail.j?.listing?.owner))
const missing = await call('GET','/api/listings/11111111-1111-1111-1111-111111111111', null)
check('invalid/deleted listing -> 404', missing.status === 404 && code(missing) === 'LISTING_NOT_FOUND', missing.status+' '+code(missing))

console.log('\n=== 6. INQUIRY / CONTACT LIFECYCLE ===')
const inqOnMissing = await call('POST','/api/listings/11111111-1111-1111-1111-111111111111/thread/messages', B, {body:'hi'})
check('inquiry on non-existent listing -> 404', inqOnMissing.status === 404, inqOnMissing.status+' '+code(inqOnMissing))
const inquiry = await call('POST', `/api/listings/${listingId}/thread/messages`, B, {body:'Is the sofa still available?'})
check('buyer sends inquiry (201)', inquiry.status === 201, inquiry.status+' '+code(inquiry))
const sellerInbox = await call('GET','/api/host/inquiries', S1)
const thread = (sellerInbox.j?.threads||[]).find(t => t.listing?.id === listingId)
check('seller receives the inquiry', Boolean(thread), 'not received')
check('inquiry shows buyer identity to seller', Boolean(thread?.guest?.id === buyer.id), JSON.stringify(thread?.guest))
// isolation: seller2 does NOT see seller1's inquiry
const seller2Inbox = await call('GET','/api/host/inquiries', S2)
check('seller2 cannot see seller1 inquiries (isolation)', !(seller2Inbox.j?.threads||[]).some(t => t.listing?.id === listingId), 'leaked')
// seller replies
const reply = await call('POST', `/api/listings/${listingId}/thread/messages`, S1, {body:'Yes, still available.', guestId: buyer.id})
check('seller replies in thread (201)', reply.status === 201, reply.status+' '+code(reply))
// buyer sees confirmation/history
const buyerThread = await call('GET', `/api/listings/${listingId}/thread`, B)
const msgs = buyerThread.j?.thread?.messages || []
check('buyer sees full conversation history (>=2 msgs)', msgs.length >= 2, 'count='+msgs.length)
// owner cannot fabricate a thread with arbitrary guest
const fab = await call('POST', `/api/listings/${listingId}/thread/messages`, S1, {body:'spam', guestId:'00000000-0000-0000-0000-000000000000'})
check('seller cannot fabricate thread w/ unknown guest (404 THREAD_NOT_FOUND)', fab.status === 404 && code(fab) === 'THREAD_NOT_FOUND', fab.status+' '+code(fab))

console.log(`\n==== MARKETPLACE E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
