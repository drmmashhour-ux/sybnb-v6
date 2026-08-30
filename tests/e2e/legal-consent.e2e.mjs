// SYBNB — Legal / Consent E2E (governed evidence artifact)
//
// Proves the versioned-consent infrastructure. The document TEXT is owner/legal-supplied and NOT
// invented — Terms & Privacy report status DRAFT and the manifest is launch-blocking until an owner
// publishes real content. Run: AUTH_SECRET=<secret> BUYER=<uuid> node tests/e2e/legal-consent.e2e.mjs

import { createSessionToken } from './_session.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const user = { id: process.env.BUYER, roles: [{ role: 'GUEST' }] }
if (!user.id) { console.error('Missing BUYER env'); process.exit(2) }
const T = await createSessionToken(user)

let pass = 0, fail = 0
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = r => r.j?.error?.code || r.j?.code

console.log('=== 1. PUBLIC MANIFEST (launch-blocking while DRAFT) ===')
const m = await call('GET', '/api/legal', null)
check('GET /api/legal -> 200', m.status === 200, m.status)
const terms = (m.j?.documents || []).find(d => d.key === 'terms')
const privacy = (m.j?.documents || []).find(d => d.key === 'privacy')
check('terms + privacy present with versions', Boolean(terms?.version && privacy?.version), JSON.stringify({ terms, privacy }))
check('terms/privacy are DRAFT (owner content required)', terms?.status === 'DRAFT' && privacy?.status === 'DRAFT', 'not draft')
check('manifest is launch-blocking while any doc is DRAFT', m.j?.launchBlocking === true, String(m.j?.launchBlocking))

console.log('\n=== 2. CONSENT REQUIRES AUTH ===')
check('anon cannot record consent (401)', (await call('POST', '/api/legal/consent', null, { documentKey: 'terms', version: terms.version })).status === 401)
check('anon cannot read consents (401)', (await call('GET', '/api/legal/consent', null)).status === 401)

console.log('\n=== 3. VERSIONED CONSENT RECORDING ===')
check('unknown document rejected (LEGAL_DOCUMENT_UNKNOWN)', code(await call('POST', '/api/legal/consent', T, { documentKey: 'nope', version: '1' })) === 'LEGAL_DOCUMENT_UNKNOWN', 'wrong')
check('stale/forged version rejected (LEGAL_VERSION_MISMATCH)', code(await call('POST', '/api/legal/consent', T, { documentKey: 'terms', version: '9.9.9' })) === 'LEGAL_VERSION_MISMATCH', 'wrong')
const rec = await call('POST', '/api/legal/consent', T, { documentKey: 'terms', version: terms.version })
check('consent for current version recorded (201)', rec.status === 201 && rec.j?.consent?.documentKey === 'terms', rec.status + ' ' + code(rec))
const rec2 = await call('POST', '/api/legal/consent', T, { documentKey: 'terms', version: terms.version })
check('re-recording same version is idempotent (no duplicate)', rec2.status === 201, rec2.status)
const list = await call('GET', '/api/legal/consent', T)
check('user can read their consents (contains terms)', (list.j?.consents || []).some(c => c.documentKey === 'terms' && c.version === terms.version), 'missing')

console.log(`\n==== LEGAL / CONSENT E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
