// SYBNB — S3 storage integration E2E (governed evidence artifact)
//
// Certifies the REAL s3 storage code path (server/lib/storage.mjs + s3-client.mjs) end-to-end
// against a local S3-compatible mock HTTP server — proving put/get/delete actually issue correctly
// SIGNED requests to an S3-style endpoint, without any cloud account or real bucket. No real
// credentials; the mock validates that a SigV4 Authorization header is present and well-formed.
//
// Run: node tests/e2e/storage-s3-integration.e2e.mjs

import { createServer } from 'node:http'

let pass = 0, fail = 0
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

// --- in-memory S3-compatible mock (path-style: /<bucket>/<key>) ---
const objects = new Map()
const seenAuth = []
const mock = createServer((req, res) => {
  const auth = req.headers['authorization'] || ''
  seenAuth.push({ method: req.method, path: req.url, auth })
  // Reject anything that isn't a well-formed SigV4 request (proves we actually sign).
  if (!/^AWS4-HMAC-SHA256 Credential=.+, SignedHeaders=.+, Signature=[a-f0-9]{64}$/.test(auth)) {
    res.writeHead(403); return res.end('unsigned')
  }
  if (!req.headers['x-amz-date'] || !req.headers['x-amz-content-sha256']) {
    res.writeHead(400); return res.end('missing amz headers')
  }
  if (req.method === 'PUT') {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { objects.set(req.url, Buffer.concat(chunks)); res.writeHead(200); res.end() })
  } else if (req.method === 'GET') {
    const b = objects.get(req.url); if (!b) { res.writeHead(404); return res.end() } res.writeHead(200); res.end(b)
  } else if (req.method === 'DELETE') {
    objects.delete(req.url); res.writeHead(204); res.end()
  } else { res.writeHead(405); res.end() }
})

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const port = mock.address().port

// Configure the s3 provider to point at the mock (path-style), with sandbox/fake credentials.
process.env.STORAGE_PROVIDER = 's3'
process.env.STORAGE_S3_BUCKET = 'sybnb-test'
process.env.STORAGE_S3_REGION = 'us-east-1'
process.env.STORAGE_S3_ACCESS_KEY_ID = 'AKIATEST'
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'testsecret'
process.env.STORAGE_S3_ENDPOINT = `http://127.0.0.1:${port}`
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true'

// Import AFTER env is set (module reads provider at call time, so this is fine either way).
const { putObject, getObjectBytes, deleteObject, storageStatus } = await import('../../server/lib/storage.mjs')

console.log('=== S3 PROVIDER STATUS ===')
check('s3 provider reports configured against the mock', storageStatus().provider === 's3' && storageStatus().configured === true, JSON.stringify(storageStatus()))

console.log('\n=== REAL SIGNED PUT -> GET -> DELETE ROUND TRIP ===')
const put = await putObject('kyc', { base64: PNG, contentType: 'image/png' })
check('putObject stored via signed PUT (uuid key)', /^[a-f0-9-]{36}\.png$/.test(put.key), put.key)
check('mock received a PUT at /<bucket>/kyc/<key>', seenAuth.some(r => r.method === 'PUT' && r.path === `/sybnb-test/kyc/${put.key}`), JSON.stringify(seenAuth.map(s => s.path)))
const got = await getObjectBytes('kyc', put.key)
check('getObjectBytes returns the same bytes via signed GET', Buffer.from(PNG, 'base64').equals(got), 'mismatch')
await deleteObject('kyc', put.key)
let deleted = false
try { await getObjectBytes('kyc', put.key) } catch { deleted = true }
check('deleteObject removed it (subsequent GET 404s)', deleted, 'still present')

console.log('\n=== ALL REQUESTS WERE SIGNED (no unsigned access) ===')
check('every mock request carried a well-formed SigV4 Authorization', seenAuth.length >= 3 && seenAuth.every(r => /^AWS4-HMAC-SHA256 Credential=/.test(r.auth)), 'unsigned request seen')

mock.close()
console.log(`\n==== S3 INTEGRATION E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
