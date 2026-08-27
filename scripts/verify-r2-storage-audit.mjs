// SYBNB — read-only R2 object-key audit against the REAL bucket, using this repo's own
// s3Config() for credentials/endpoint resolution (server/lib/s3-client.mjs), but with its own
// SigV4 signing for a LIST request -- the repo's exported signV4() only handles object-level
// GET/PUT/DELETE (no query string in the signature); ListObjectsV2 requires the query string to
// be part of the canonical request, so reusing signV4() as-is would sign incorrectly and get a
// 403 from R2. Lists every prefix this app actually uses (kyc, payment-proof, listing-media,
// driver-photo -- see server/lib/storage.mjs's BUCKETS) and checks every key against the exact
// format the app itself enforces at upload time (KEY_RE = /^[a-f0-9-]{36}\.(jpg|png|pdf|webp)$/).
// No writes, no deletes.
//
//   set -a; . ./.env.production.local; set +a; node scripts/verify-r2-storage-audit.mjs
import { createHash, createHmac } from 'crypto'
import { s3Config } from '../server/lib/s3-client.mjs'

const KEY_RE = /^[a-f0-9-]{36}\.(jpg|png|pdf|webp)$/
const PREFIXES = ['kyc', 'payment-proof', 'listing-media', 'driver-photo']
const sha256hex = (s) => createHash('sha256').update(s).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()
const hmacHex = (key, data) => createHmac('sha256', key).update(data).digest('hex')
const EMPTY_HASH = sha256hex('')

const cfg = s3Config()
if (!cfg) { console.error('STORAGE_S3_* env vars not fully set'); process.exit(2) }

function signingKey(secret, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, dateStamp), region), service), 'aws4_request')
}

function listUrl(prefix) {
  const base = cfg.endpoint.replace(/\/+$/, '')
  const path = cfg.forcePathStyle ? `${base}/${cfg.bucket}` : base
  // Canonical query string must be sorted by key, RFC3986-encoded.
  const params = { 'list-type': '2', 'max-keys': '1000', prefix: prefix + '/' }
  const qs = Object.keys(params).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&')
  return `${path}?${qs}`
}

async function listPrefix(prefix) {
  const url = listUrl(prefix)
  const u = new URL(url)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStamp = amzDate.slice(0, 8)
  const headers = { host: u.host, 'x-amz-content-sha256': EMPTY_HASH, 'x-amz-date': amzDate }
  const sortedKeys = Object.keys(headers).sort()
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join('')
  const signedHeaders = sortedKeys.join(';')
  const canonicalRequest = ['GET', u.pathname, u.search.slice(1), canonicalHeaders, signedHeaders, EMPTY_HASH].join('\n')
  const scope = `${dateStamp}/${cfg.region}/${cfg.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n')
  const signature = hmacHex(signingKey(cfg.secretAccessKey, dateStamp, cfg.region, cfg.service), stringToSign)
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(url, {
    method: 'GET',
    headers: { authorization, 'x-amz-date': amzDate, 'x-amz-content-sha256': EMPTY_HASH },
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 400) }
  const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1])
  return { ok: true, keys }
}

console.log('=== R2 STORAGE KEY AUDIT (read-only) ===')
console.log(`  bucket: ${cfg.bucket}   endpoint: ${cfg.endpoint ? new URL(cfg.endpoint).host : '(aws default)'}`)

let totalObjects = 0
let totalBad = 0
for (const prefix of PREFIXES) {
  const result = await listPrefix(prefix)
  if (!result.ok) {
    console.log(`  [${prefix}]  LIST FAILED  status=${result.status}  ${result.body}`)
    continue
  }
  const objectKeys = result.keys.map((k) => k.slice(prefix.length + 1)) // strip "prefix/"
  const bad = objectKeys.filter((k) => k && !KEY_RE.test(k))
  totalObjects += objectKeys.length
  totalBad += bad.length
  console.log(`  [${prefix}]  objects=${objectKeys.length}  non-conforming-keys=${bad.length}`)
  if (bad.length) bad.slice(0, 5).forEach((k) => console.log(`      BAD KEY: ${k}`))
  if (objectKeys.length) console.log(`      sample: ${objectKeys[0]}`)
}

console.log(`\n  total objects across all 4 prefixes: ${totalObjects}`)
console.log(`  total non-conforming keys (would indicate a plaintext-filename leak): ${totalBad}`)
console.log(totalBad === 0 ? '  PASS -- every key is an opaque random UUID+extension, no identifiable filenames.' : '  FAIL -- see BAD KEY lines above.')
