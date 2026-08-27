// SYBNB — Email OTP hardening E2E (governed, self-contained). Proves the Part-10 hardening: fail-
// closed Resend config, webhook signature + timestamp/replay + duplicate-event protection, and
// bounce/complaint suppression. No secrets. Suppression is Postgres-backed (see lib/email.mjs), so
// this file needs DATABASE_URL, same as the other e2e suites that assert DB state directly.
// Run: node tests/e2e/email-security.e2e.mjs
import { createHmac } from 'node:crypto'
import { emailProviderStatus, sendEmail, verifyResendWebhook, createWebhookReplayGuard, suppressEmail, isEmailSuppressed } from '../../server/lib/email.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

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

console.log('\n=== BOUNCE / COMPLAINT SUPPRESSION (Postgres-backed) ===')
const testAddr = `suppress-test-${process.pid}-${Date.now()}@sybnb.local`
const complaintAddr = `complaint-test-${process.pid}-${Date.now()}@sybnb.local`
await db().suppressedEmail.deleteMany({ where: { email: { in: [testAddr, complaintAddr] } } })
ok('address deliverable before suppression', (await isEmailSuppressed('User@sybnb.local')) === false, 'blocked early')
await suppressEmail(testAddr, 'hard_bounce')
ok('after bounce, delivery blocked (case-insensitive)', (await isEmailSuppressed(testAddr.toUpperCase())) === true, 'still delivering')
await suppressEmail(complaintAddr, 'complaint')
ok('isSuppressed reflects complaint', await isEmailSuppressed(complaintAddr), 'not suppressed')

console.log('\n=== sendEmail() REFUSES A SUPPRESSED ADDRESS ===')
let sendThrew = ''
try { await sendEmail({ to: testAddr, subject: 's', text: 't', purpose: 'account-verify' }) } catch (e) { sendThrew = e.code }
ok('sendEmail throws EMAIL_SUPPRESSED for a suppressed address', sendThrew === 'EMAIL_SUPPRESSED', sendThrew)
let sendOk = false
try { const r = await sendEmail({ to: `not-suppressed-${process.pid}@sybnb.local`, subject: 's', text: 't', purpose: 'account-verify' }); sendOk = r.delivered === true } catch (e) { sendOk = false }
ok('sendEmail still delivers to a non-suppressed address', sendOk, 'unexpectedly blocked')

await db().suppressedEmail.deleteMany({ where: { email: { in: [testAddr, complaintAddr] } } })

console.log(`\n==== EMAIL SECURITY E2E: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
