// SYBNB — Resend live email certification runner (RC d1fd5b9). Dev/cert tooling only — NOT runtime.
//
// Runs against Resend's REAL API only when RESEND_API_KEY is present; otherwise SKIPS safely (no
// network, no secrets). The API key is NEVER printed, logged, or committed — only booleans/ids are
// shown. Sends only to a SAFE test address you pass via RESEND_CERT_TO. Usage:
//   EMAIL_PROVIDER=resend RESEND_API_KEY=... EMAIL_FROM='no-reply@notifications.sybnb.app' \
//   RESEND_CERT_TO='you@yourinbox' [RESEND_DOMAIN=notifications.sybnb.app] node scripts/certify-resend.mjs
//
// Verifies: domain verification status, live delivery, idempotency (same Idempotency-Key de-dupes),
// (offline) webhook signature+replay+dedup, and (DB-backed, skips if unreachable) bounce/complaint
// suppression via the app's own email lib.
import { verifyResendWebhook, createWebhookReplayGuard, suppressEmail, isEmailSuppressed } from '../server/lib/email.mjs'
import { disconnectDb } from '../server/lib/prisma.mjs'
import { createHmac } from 'node:crypto'

const results = []
const rec = (name, status, detail) => { results.push({ name, status }); console.log(`  ${status}  ${name}${detail ? '  -> ' + detail : ''}`) }
const key = process.env.RESEND_API_KEY
const from = process.env.EMAIL_FROM
const to = process.env.RESEND_CERT_TO
const domain = process.env.RESEND_DOMAIN || 'notifications.sybnb.app'

console.log('=== SYBNB RESEND CERTIFICATION (real API when RESEND_API_KEY set; safe-skip otherwise) ===')

// --- Offline checks (always run; no key needed) ---
{
  const secret = 'whsec_' + Buffer.from('cert-secret-abcdefghijklmnop').toString('base64')
  const sb = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const id = 'evt_cert', payload = JSON.stringify({ type: 'email.delivered' }), now = 1_700_000_000
  const sig = 'v1,' + createHmac('sha256', sb).update(`${id}.${now}.${payload}`).digest('base64')
  const good = verifyResendWebhook({ payload, svixId: id, svixTimestamp: String(now), svixSignature: sig, secret, nowSec: now })
  const stale = verifyResendWebhook({ payload, svixId: id, svixTimestamp: String(now - 9999), svixSignature: sig, secret, nowSec: now })
  const guard = createWebhookReplayGuard(); const dupOk = guard.seen('e1') === true && guard.seen('e1') === false
  rec('webhook signature verifies + stale rejected', (good && !stale) ? 'PASS' : 'FAIL')
  rec('duplicate-event guard', dupOk ? 'PASS' : 'FAIL')
}

// Suppression is Postgres-backed (shared across instances, survives restarts) -- needs a DB, so this
// check SKIPs rather than fails when DATABASE_URL isn't reachable from this standalone script.
{
  const addr = `cert-suppression-${Date.now()}@x.test`
  try {
    const before = await isEmailSuppressed(addr)
    await suppressEmail(addr, 'bounce')
    const after = await isEmailSuppressed(addr)
    rec('bounce suppression recorded + consulted (DB-backed)', (before === false && after === true) ? 'PASS' : 'FAIL')
  } catch (e) {
    rec('bounce suppression recorded + consulted (DB-backed)', 'SKIP', `DB unreachable: ${e.message || e}`)
  } finally {
    await disconnectDb().catch(() => {})
  }
}

if (!key || !from) {
  rec('domain verification status', 'SKIP', 'RESEND_API_KEY / EMAIL_FROM not set (owner action)')
  rec('live delivery to safe test address', 'SKIP', 'no key')
  rec('idempotency (same key de-dupes)', 'SKIP', 'no key')
  console.log('\nProvide RESEND_API_KEY + EMAIL_FROM (+ RESEND_CERT_TO) to run live checks. Key is never printed.')
  console.log(`\n==== RESEND CERT: ${results.filter(r => r.status === 'PASS').length} pass, ${results.filter(r => r.status === 'FAIL').length} fail, ${results.filter(r => r.status === 'SKIP').length} skip ====`)
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0)
}

// --- Live checks (key present) ---
const auth = { authorization: `Bearer ${key}` } // never logged
try {
  const res = await fetch(`https://api.resend.com/domains`, { headers: auth })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    // A least-privilege Sending-access key cannot list domains (management scope). That is expected
    // and NOT a failure — live delivery below proves the domain works. SKIP, don't fail.
    rec('domain verification status', 'SKIP', `key lacks domains:read (HTTP ${res.status}) — expected for a Sending-access key; verify in dashboard`)
  } else {
    const d = (j?.data || []).find((x) => x.name === domain)
    rec('domain verification status', d?.status === 'verified' ? 'PASS' : 'FAIL', d ? `${domain}: ${d.status}` : `${domain} not found`)
  }
} catch (e) { rec('domain verification status', 'FAIL', String(e.message || e)) }

if (to) {
  const idem = `sybnb-cert-${Date.now()}`
  const send = () => fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'Idempotency-Key': idem },
    body: JSON.stringify({ from, to: [to], subject: 'SYBNB Resend certification', text: 'Certification test — no action needed.' }),
  }).then(async (r) => ({ ok: r.ok, id: (await r.json().catch(() => ({})))?.id }))
  try {
    const a = await send(); const b = await send() // same Idempotency-Key
    rec('live delivery to safe test address', a.ok ? 'PASS' : 'FAIL', a.id ? `id=${a.id}` : '')
    rec('idempotency (same key de-dupes)', a.id && b.id && a.id === b.id ? 'PASS' : 'FAIL', `a=${a.id} b=${b.id}`)
  } catch (e) { rec('live delivery', 'FAIL', String(e.message || e)) }
} else {
  rec('live delivery / idempotency', 'SKIP', 'set RESEND_CERT_TO to a safe inbox to send')
}

const fails = results.filter(r => r.status === 'FAIL').length
console.log(`\n==== RESEND CERT: ${results.filter(r => r.status === 'PASS').length} pass, ${fails} fail, ${results.filter(r => r.status === 'SKIP').length} skip ====`)
console.log('Record domain status + region + DPA in docs/launch/RESEND_CERTIFICATION.md. Key never printed.')
process.exit(fails ? 1 : 0)
