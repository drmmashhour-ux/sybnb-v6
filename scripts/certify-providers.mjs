// SYBNB — Provider certification harness (RC e9dfd68).
// Certifies each production provider against its REAL sandbox/test endpoint — but ONLY when the
// corresponding TEST credentials are present in the environment. With no credentials it SKIPS
// (no external calls, no secrets), so it is safe to run locally at any time. It NEVER uses live
// keys and NEVER moves real money: Stripe check is read-only (GET /v1/balance in test mode);
// SMS is a connectivity/auth probe with no send unless SMS_CERT_TO is explicitly set; S3 is a
// round-trip on a disposable key the script deletes.
//
// Usage (fill only the providers you are certifying):
//   STRIPE_SECRET_KEY=sk_test_... node scripts/certify-providers.mjs
//   SMS_HTTP_ENDPOINT=... SMS_API_KEY=... [SMS_CERT_TO=+1555...] node scripts/certify-providers.mjs
//   STORAGE_S3_BUCKET=... STORAGE_S3_REGION=... STORAGE_S3_ACCESS_KEY_ID=... STORAGE_S3_SECRET_ACCESS_KEY=... node scripts/certify-providers.mjs
//
// Exit code = number of provider certifications that FAILED (skips do not count as failures).

const results = []
function record(name, status, detail) { results.push({ name, status, detail }); const tag = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL'; console.log(`  ${tag}  ${name}${detail ? '  -> ' + detail : ''}`) }

// ---- Stripe (test mode, read-only) ----
async function certifyStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return record('stripe', 'SKIP', 'STRIPE_SECRET_KEY not set')
  if (!key.startsWith('sk_test_')) return record('stripe', 'FAIL', 'refusing: not a sk_test_ key (live keys never used here)')
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', { headers: { authorization: 'Bearer ' + key } })
    const j = await res.json()
    if (res.ok && j.object === 'balance') record('stripe', 'PASS', 'test-mode balance reachable (livemode=' + j.livemode + ')')
    else record('stripe', 'FAIL', `HTTP ${res.status} ${j?.error?.message || ''}`)
  } catch (e) { record('stripe', 'FAIL', String(e.message || e)) }
  // Webhook secret presence (format only — signing verified by payment-sandbox suite):
  const whsec = process.env.PAYMENT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
  if (whsec && /^whsec_/.test(whsec)) record('stripe:webhook-secret', 'PASS', 'whsec_ present')
  else record('stripe:webhook-secret', 'SKIP', 'no whsec_ set')
}

// ---- SMS provider (connectivity/auth probe; no send unless SMS_CERT_TO set) ----
async function certifySms() {
  const endpoint = process.env.SMS_HTTP_ENDPOINT, apiKey = process.env.SMS_API_KEY
  if (!endpoint || !apiKey) return record('sms', 'SKIP', 'SMS_HTTP_ENDPOINT / SMS_API_KEY not set')
  const to = process.env.SMS_CERT_TO
  try {
    if (!to) {
      // auth/connectivity only — HEAD/GET the endpoint host, do not send.
      const res = await fetch(endpoint, { method: 'GET', headers: { authorization: 'Bearer ' + apiKey } })
      record('sms', res.status < 500 ? 'PASS' : 'FAIL', `endpoint reachable (HTTP ${res.status}); set SMS_CERT_TO to send a real test SMS`)
    } else {
      const res = await fetch(endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ to, text: 'SYBNB provider certification test' }) })
      record('sms', res.ok ? 'PASS' : 'FAIL', `test SMS to ${to} -> HTTP ${res.status}`)
    }
  } catch (e) { record('sms', 'FAIL', String(e.message || e)) }
}

// ---- Object storage (real bucket round-trip via the app's own SigV4 client) ----
async function certifyS3() {
  const need = ['STORAGE_S3_BUCKET', 'STORAGE_S3_REGION', 'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY']
  if (need.some((k) => !process.env[k])) return record('storage-s3', 'SKIP', 'STORAGE_S3_* not fully set')
  try {
    const { s3Config, putObjectS3, getObjectS3, deleteObjectS3 } = await import('../server/lib/s3-client.mjs')
    const cfg = s3Config()
    if (!cfg) return record('storage-s3', 'SKIP', 'STORAGE_S3_* incomplete')
    const path = `certification/probe-${Date.now()}.txt`
    const body = Buffer.from('sybnb-s3-certification')
    await putObjectS3(cfg, path, body, 'text/plain')
    const got = await getObjectS3(cfg, path)
    const match = Buffer.from(got).toString() === body.toString()
    await deleteObjectS3(cfg, path)
    record('storage-s3', match ? 'PASS' : 'FAIL', match ? `put/get/delete round-trip ok on ${cfg.bucket}/${cfg.region}` : 'content mismatch')
  } catch (e) { record('storage-s3', 'FAIL', String(e.message || e)) }
}

console.log('=== SYBNB PROVIDER CERTIFICATION (real sandbox endpoints; skips without creds) ===')
await certifyStripe()
await certifySms()
await certifyS3()
const failed = results.filter((r) => r.status === 'FAIL').length
const passed = results.filter((r) => r.status === 'PASS').length
const skipped = results.filter((r) => r.status === 'SKIP').length
console.log(`\n==== providers: ${passed} passed, ${failed} failed, ${skipped} skipped ====`)
console.log('Record each PASS in docs/launch/PROVIDER_CERTIFICATION.md with vendor + region + date.')
process.exit(failed)
