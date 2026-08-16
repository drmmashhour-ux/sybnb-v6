// SYBNB — production API smoke (non-mutating). Run against the deployed private API URL:
//   BASE_URL=https://<render-api-domain> node scripts/prod-smoke.mjs
// Checks liveness/readiness, security headers, 404 handling, rate-limit engagement, and that no
// devCode/secret leaks in responses. Does NOT create accounts, send OTPs, or write data — the
// interactive AR/EN signup/booking smoke is done in the browser against the private frontend URL.
const BASE = (process.env.BASE_URL || '').replace(/\/$/, '')
if (!BASE) { console.error('BASE_URL is required'); process.exit(2) }

let pass = 0, fail = 0
const ok = (l) => { pass++; console.log(`   PASS  ${l}`) }
const no = (l, d) => { fail++; console.log(`  FAIL  ${l}  -> ${d}`) }
const get = async (path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, opts)
  const text = await res.text()
  return { status: res.status, headers: res.headers, text }
}

console.log(`=== SYBNB PROD SMOKE (non-mutating) @ ${BASE} ===`)

const live = await get('/api/health/live')
live.status === 200 ? ok('health/live 200') : no('health/live', live.status)

const ready = await get('/api/health/ready')
ready.status === 200 && /"status"\s*:\s*"ready"/.test(ready.text)
  ? ok('health/ready ready (DB reachable)') : no('health/ready', `${ready.status} ${ready.text.slice(0, 80)}`)

const h = live.headers
h.get('x-content-type-options') === 'nosniff' ? ok('header nosniff') : no('nosniff', h.get('x-content-type-options'))
/frame-ancestors 'none'/.test(h.get('content-security-policy') || '') ? ok('CSP present') : no('CSP', h.get('content-security-policy'))
h.get('strict-transport-security') ? ok('HSTS present (production)') : no('HSTS', 'missing')
h.get('x-request-id') || h.get('request-id') ? ok('request-id present') : no('request-id', 'missing')

const nf = await get('/api/this-route-does-not-exist')
nf.status === 404 ? ok('unknown API route 404') : no('404', nf.status)

// rate-limit: a short burst on an unauthenticated endpoint should eventually 429 (best-effort)
let got429 = false
for (let i = 0; i < 12; i++) { const r = await get('/api/otp/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (r.status === 429) { got429 = true; break } }
got429 ? ok('rate-limit engages (429 on burst)') : console.log('   NOTE  rate-limit not triggered in 12 calls (edge/proxy may absorb) — verify manually')

// no secret/devCode leakage in any body seen
const leak = /devCode|RESEND_API_KEY|AUTH_SECRET|password_hash|PHONE_HASH_SECRET/.test(live.text + ready.text + nf.text)
leak ? no('no secret/devCode in responses', 'LEAK') : ok('no secret/devCode in responses')

console.log(`\n==== PROD SMOKE: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
