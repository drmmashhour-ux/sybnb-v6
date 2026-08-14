// SYBNB — Operations E2E (governed evidence artifact)
//
// Asserts production operational controls on the running API: liveness vs readiness, security
// headers, request-id correlation, body-size limit, and that errors don't leak secrets. Also
// checks env validation fails closed (in-process). Run: node tests/e2e/operations.e2e.mjs

import { validateEnv } from '../../server/lib/env.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

console.log('=== 1. HEALTH: liveness vs readiness ===')
const live = await fetch(API + '/api/health/live')
check('GET /api/health/live -> 200 alive', live.status === 200 && (await live.json()).status === 'alive', String(live.status))
const ready = await fetch(API + '/api/health/ready')
const readyJson = await ready.json()
check('GET /api/health/ready -> 200 ready (DB reachable)', ready.status === 200 && readyJson.status === 'ready', String(ready.status))

console.log('\n=== 2. SECURITY HEADERS + REQUEST ID ===')
check('x-content-type-options: nosniff', live.headers.get('x-content-type-options') === 'nosniff', live.headers.get('x-content-type-options'))
check('x-frame-options: DENY', live.headers.get('x-frame-options') === 'DENY', live.headers.get('x-frame-options'))
check('referrer-policy: no-referrer', live.headers.get('referrer-policy') === 'no-referrer', live.headers.get('referrer-policy'))
check('content-security-policy present', /frame-ancestors 'none'/.test(live.headers.get('content-security-policy') || ''), live.headers.get('content-security-policy'))
check('x-request-id echoed', Boolean(live.headers.get('x-request-id')), 'missing')
const echoed = await fetch(API + '/api/health/live', { headers: { 'x-request-id': 'corr-123' } })
check('supplied x-request-id is preserved (correlation)', echoed.headers.get('x-request-id') === 'corr-123', echoed.headers.get('x-request-id'))

console.log('\n=== 3. BODY-SIZE LIMIT (DoS guard) ===')
const big = 'x'.repeat(13 * 1024 * 1024)
const tooBig = await fetch(API + '/api/otp/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+963900000000', purpose: 'account-verify', pad: big }) })
const tooBigJson = await tooBig.json().catch(() => ({}))
check('oversize body rejected (413 PAYLOAD_TOO_LARGE)', tooBig.status === 413 && tooBigJson.error?.code === 'PAYLOAD_TOO_LARGE', tooBig.status + ' ' + (tooBigJson.error?.code || ''))

console.log('\n=== 4. ERRORS DO NOT LEAK SECRETS ===')
// A malformed JSON body -> generic 400; response must not echo internal detail/secret.
const badJson = await fetch(API + '/api/otp/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' })
const badText = await badJson.text()
check('malformed JSON -> governed 400, no secret/stack in body', badJson.status === 400 && !/AUTH_SECRET|password|stack|node_modules/i.test(badText), badText.slice(0, 80))

console.log('\n=== 5. ENV VALIDATION FAILS CLOSED ===')
check('missing core secret is a validation problem', validateEnv({ DATABASE_URL: 'x' }).some(p => /AUTH_SECRET/.test(p)), 'not flagged')
check('production requires durable storage + CORS', (() => {
  const p = validateEnv({ AUTH_SECRET: 'a', PHONE_HASH_SECRET: 'b', DATABASE_URL: 'c', NODE_ENV: 'production', STORAGE_PROVIDER: 'local' })
  return p.some(x => /CORS_ORIGIN/.test(x)) && p.some(x => /STORAGE_PROVIDER must be/.test(x))
})(), 'not failing closed')
check('production rejects OTP_EXPOSE_FOR_TEST + STORAGE_ALLOW_LOCAL', (() => {
  const p = validateEnv({ AUTH_SECRET: 'a', PHONE_HASH_SECRET: 'b', DATABASE_URL: 'c', NODE_ENV: 'production', CORS_ORIGIN: 'x', STORAGE_PROVIDER: 's3', STORAGE_S3_BUCKET: 'b', STORAGE_S3_REGION: 'r', OTP_EXPOSE_FOR_TEST: 'true', STORAGE_ALLOW_LOCAL: 'true' })
  return p.some(x => /OTP_EXPOSE_FOR_TEST/.test(x)) && p.some(x => /STORAGE_ALLOW_LOCAL/.test(x))
})(), 'not rejected')
check('fully-configured production env passes', validateEnv({ AUTH_SECRET: 'a', PHONE_HASH_SECRET: 'b', DATABASE_URL: 'c', NODE_ENV: 'production', CORS_ORIGIN: 'https://x', STORAGE_PROVIDER: 's3', STORAGE_S3_BUCKET: 'b', STORAGE_S3_REGION: 'r', SYBNB_COUNTRY: 'syria' }).length === 0, 'unexpected problems')
check('production env WITHOUT SYBNB_COUNTRY fails closed', validateEnv({ AUTH_SECRET: 'a', PHONE_HASH_SECRET: 'b', DATABASE_URL: 'c', NODE_ENV: 'production', CORS_ORIGIN: 'https://x', STORAGE_PROVIDER: 's3', STORAGE_S3_BUCKET: 'b', STORAGE_S3_REGION: 'r' }).some(p => /SYBNB_COUNTRY/.test(p)), 'country not enforced')

console.log(`\n==== OPERATIONS E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
