// SYBNB — Email OTP hardening E2E (governed, self-contained). Proves the Part-10 hardening: fail-
// closed Resend config, webhook signature + timestamp/replay + duplicate-event protection, and
// bounce/complaint suppression. No network, no secrets. Run: node tests/e2e/email-security.e2e.mjs
import { createHmac } from 'node:crypto'
import { emailProviderStatus, sendEmail, verifyResendWebhook, createWebhookReplayGuard, createSuppressionList } from '../../server/lib/email.mjs'

let pass = 0, fail = 0
const ok = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

console.log('=== FAIL-CLOSED when Resend not configured ===')
ok('sandbox default configured, not live', (() => { const s = emailProviderStatus(); return s.provider === 'sandbox' && s.live === false })(), 'unexpected')
let threw = ''
try {
  await sendEmail.call(null, { to: 'x@sybnb.local', subject: 's', text: 't', purpose: 'account-verify' })
} catch (e) { threw = e.code || e.message }
// With EMAIL_PROVIDER=resend but no key, must fail closed. Simulate by temporarily setting env.
process.env.EMAIL_PROVIDER = 'resend'
let failClosed = ''
try { await sendEmail({ to: 'x@sybnb.local', subject: 's', text: 't', purpose: 'account-verify' }) } catch (e) { failClosed = e.code }
delete process.env.EMAIL_PROVIDER
ok('resend without key -> EMAIL_PROVIDER_NOT_CONFIGURED (fail-closed)', failClosed === 'EMAIL_PROVIDER_NOT_CONFIGURED', failClosed)

console.log('\n=== WEBHOOK: signature + timestamp/replay ===')
const secret = 'whsec_' + Buffer.from('sig-secret-abcdefghijklmnop').toString('base64')
const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
const id = 'evt_1', payload = JSON.stringify({ type: 'email.bounced', to: 'bad@sybnb.local' })
const now = 1_700_000_000
const sign = (ts) => 'v1,' + createHmac('sha256', secretBytes).update(`${id}.${ts}.${payload}`).digest('base64')
ok('valid signature + fresh timestamp verifies', verifyResendWebhook({ payload, svixId: id, svixTimestamp: String(now), svixSignature: sign(now), secret, nowSec: now }) === true, 'not verified')
ok('tampered payload rejected', verifyResendWebhook({ payload: payload + 'x', svixId: id, svixTimestamp: String(now), svixSignature: sign(now), secret, nowSec: now }) === false, 'accepted tampered')
ok('stale timestamp rejected (replay window)', verifyResendWebhook({ payload, svixId: id, svixTimestamp: String(now - 10000), svixSignature: sign(now - 10000), secret, nowSec: now }) === false, 'accepted stale')
ok('missing secret rejected (fail-closed)', verifyResendWebhook({ payload, svixId: id, svixTimestamp: String(now), svixSignature: sign(now), secret: '', nowSec: now }) === false, 'accepted no secret')

console.log('\n=== WEBHOOK: duplicate-event protection ===')
const guard = createWebhookReplayGuard()
ok('first delivery of event id is processed', guard.seen('evt_dup') === true, 'not processed')
ok('repeat delivery of same event id is skipped', guard.seen('evt_dup') === false, 'processed twice')

console.log('\n=== BOUNCE / COMPLAINT SUPPRESSION ===')
const supp = createSuppressionList()
ok('address deliverable before suppression', supp.shouldDeliver('User@sybnb.local') === true, 'blocked early')
supp.suppress('user@sybnb.local', 'hard_bounce')
ok('after bounce, delivery blocked (case-insensitive)', supp.shouldDeliver('USER@sybnb.local') === false, 'still delivering')
ok('isSuppressed reflects complaint', (() => { supp.suppress('c@sybnb.local', 'complaint'); return supp.isSuppressed('c@sybnb.local') })(), 'not suppressed')

console.log(`\n==== EMAIL SECURITY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
