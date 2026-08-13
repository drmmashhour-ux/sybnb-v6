// SYBNB — Production Storage E2E (governed evidence artifact)
//
// Exercises the storage abstraction (server/lib/storage.mjs) directly plus the HTTP signed-
// retrieval route against the running API. Requires AUTH_SECRET to match the running API so the
// signatures the test mints verify server-side. No real cloud bucket is used (provider=local);
// the s3 path is asserted to FAIL CLOSED when unconfigured.
//
// Run: AUTH_SECRET=<secret> node tests/e2e/storage.e2e.mjs   (or npm run test:e2e:storage)

import {
  putObject, getObjectBytes, deleteObject, signObjectUrl, verifySignedObject, storageStatus,
} from '../../server/lib/storage.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
async function expectThrow(label, fn, expectedCode) {
  try { await fn(); check(label, false, 'did not throw') }
  catch (e) { check(label, e?.code === expectedCode, `threw ${e?.code}`) }
}
// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

console.log('=== 1. UPLOAD VALIDATION ===')
await expectThrow('reject unsupported MIME (STORAGE_TYPE_INVALID)', () => putObject('kyc', { base64: PNG, contentType: 'text/html' }), 'STORAGE_TYPE_INVALID')
await expectThrow('reject empty file (STORAGE_EMPTY)', () => putObject('kyc', { base64: '', contentType: 'image/png' }), 'STORAGE_EMPTY')
await expectThrow('reject oversize file (STORAGE_TOO_LARGE)', () => putObject('kyc', { base64: Buffer.alloc(9 * 1024 * 1024).toString('base64'), contentType: 'image/png' }), 'STORAGE_TOO_LARGE')
await expectThrow('reject unknown bucket (STORAGE_BUCKET_UNKNOWN)', () => putObject('nope', { base64: PNG, contentType: 'image/png' }), 'STORAGE_BUCKET_UNKNOWN')

console.log('\n=== 2. PUT -> GET ROUND TRIP (private kyc bucket) ===')
const put = await putObject('kyc', { base64: PNG, contentType: 'image/png' })
check('put returns a server-generated key (uuid.ext)', /^[a-f0-9-]{36}\.png$/.test(put.key), put.key)
check('put reports size', put.size > 0, String(put.size))
const bytes = await getObjectBytes('kyc', put.key)
check('get returns the same bytes', Buffer.from(PNG, 'base64').equals(bytes), 'mismatch')

console.log('\n=== 3. PATH TRAVERSAL / KEY VALIDATION ===')
await expectThrow('traversal key rejected (STORAGE_KEY_INVALID)', () => getObjectBytes('kyc', '../../../../etc/passwd'), 'STORAGE_KEY_INVALID')
await expectThrow('malformed key rejected', () => getObjectBytes('kyc', 'not-a-key.png'), 'STORAGE_KEY_INVALID')

console.log('\n=== 4. SIGNED, TIME-LIMITED RETRIEVAL ===')
const signed = signObjectUrl('kyc', put.key, 300)
check('signObjectUrl returns a signed path', signed.startsWith(`/api/storage/kyc/${put.key}?exp=`) && signed.includes('sig='), signed)
const u = new URL('http://x' + signed)
check('valid signature verifies', verifySignedObject('kyc', put.key, u.searchParams.get('exp'), u.searchParams.get('sig')), 'did not verify')
check('tampered signature rejected', !verifySignedObject('kyc', put.key, u.searchParams.get('exp'), 'deadbeef'), 'accepted tampered')
check('expired signature rejected', !verifySignedObject('kyc', put.key, String(Math.floor(Date.now() / 1000) - 10), u.searchParams.get('sig')), 'accepted expired')

console.log('\n=== 5. HTTP SIGNED ROUTE (against running API) ===')
const okRes = await fetch(API + signed)
check('GET with valid signed URL -> 200', okRes.status === 200, String(okRes.status))
check('served with nosniff + private cache', okRes.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(okRes.headers.get('cache-control') || ''), 'weak headers')
const badRes = await fetch(API + `/api/storage/kyc/${put.key}?exp=${u.searchParams.get('exp')}&sig=deadbeef`)
check('GET with invalid signature -> 403', badRes.status === 403, String(badRes.status))
const noSig = await fetch(API + `/api/storage/kyc/${put.key}`)
check('GET with no signature -> 403', noSig.status === 403, String(noSig.status))

console.log('\n=== 6. DELETION ===')
await deleteObject('kyc', put.key)
await expectThrow('deleted object no longer retrievable', () => getObjectBytes('kyc', put.key), 'ENOENT') // fs read throws ENOENT-coded

console.log('\n=== 7. PRODUCTION PROVIDER FAILS CLOSED WHEN UNCONFIGURED ===')
const prior = process.env.STORAGE_PROVIDER
process.env.STORAGE_PROVIDER = 's3'
delete process.env.STORAGE_S3_BUCKET
delete process.env.STORAGE_S3_REGION
check('s3 provider reports not-configured', storageStatus().configured === false, JSON.stringify(storageStatus()))
await expectThrow('s3 upload fails closed (STORAGE_NOT_CONFIGURED)', () => putObject('kyc', { base64: PNG, contentType: 'image/png' }), 'STORAGE_NOT_CONFIGURED')
process.env.STORAGE_PROVIDER = prior || 'local'

console.log(`\n==== STORAGE E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
