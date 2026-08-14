// SYBNB — Email OTP / verification / recovery E2E (governed). Proves the email-only communication
// path works end-to-end and that NO hidden SMS dependency blocks it: OTP is sent+verified by EMAIL
// while the SMS provider stays sandbox/unconfigured, and email-only registration is gated by a
// verified email OTP (fail-closed). Run with the API started with OTP_EXPOSE_FOR_TEST=true (devCode).
//   node tests/e2e/email-otp.e2e.mjs
import { emailProviderStatus } from '../../server/lib/email.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
async function call(path, body) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  let j = {}; try { j = await res.json() } catch {}
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code
const base = Date.now()
const email = `email-otp-${base}@sybnb.local`
const purpose = 'account-verify'

console.log('=== EMAIL PROVIDER DEFAULT (sandbox; no key, safe) ===')
const st = emailProviderStatus()
check('email provider sandbox configured (no live key needed for tests)', st.provider === 'sandbox' && st.configured === true && st.live === false, JSON.stringify(st))

console.log('\n=== EMAIL OTP SEND + VERIFY (no SMS involved) ===')
const s = await call('/api/otp/send', { email, purpose })
check('email OTP send -> 201', s.status === 201, s.status + ' ' + code(s))
check('channel is email (not sms)', s.j?.channel === 'email', s.j?.channel)
check('email is masked in response', typeof s.j?.maskedEmail === 'string' && s.j.maskedEmail.includes('@') && s.j.maskedEmail.includes('•'), s.j?.maskedEmail)
check('devCode present in test mode', typeof s.j?.devCode === 'string' && s.j.devCode.length >= 4, 'no devCode (need OTP_EXPOSE_FOR_TEST=true)')
const otp = s.j?.devCode
const v = await call('/api/otp/verify', { email, purpose, code: otp })
check('email OTP verify -> 200 verified', v.status === 200 && v.j?.verified === true, v.status + ' ' + code(v))

console.log('\n=== FAIL-CLOSED: bad code + replay ===')
check('wrong code rejected', code(await call('/api/otp/verify', { email: `x-${base}@sybnb.local`, purpose, code: '000000' })) === 'OTP_NOT_FOUND' || code(await call('/api/otp/verify', { email, purpose, code: '000000' })) === 'OTP_ALREADY_USED', 'unexpected')
check('missing identifier rejected (OTP_IDENTIFIER_REQUIRED)', code(await call('/api/otp/send', { purpose })) === 'OTP_IDENTIFIER_REQUIRED', 'wrong')

console.log('\n=== EMAIL-ONLY REGISTRATION IS OTP-GATED (fail-closed) ===')
// No verified OTP for this fresh email -> must be rejected.
const regEmail = `reg-${base}@sybnb.local`
const noOtp = await call('/api/auth/register', { email: regEmail, password: 'StrongPass123', role: 'GUEST', displayName: 'Email Reg' })
check('email-only register without verified OTP -> 403 REGISTRATION_OTP_REQUIRED', noOtp.status === 403 && code(noOtp) === 'REGISTRATION_OTP_REQUIRED', noOtp.status + ' ' + code(noOtp))
// Verify an email OTP, then register -> allowed (proves the email verification/recovery substrate works).
const rs = await call('/api/otp/send', { email: regEmail, purpose })
await call('/api/otp/verify', { email: regEmail, purpose, code: rs.j?.devCode })
const created = await call('/api/auth/register', { email: regEmail, password: 'StrongPass123', role: 'GUEST', displayName: 'Email Reg' })
check('email-only register after verified email OTP -> 201', created.status === 201, created.status + ' ' + code(created))
// Consumed OTP cannot be replayed for another account.
const reuse = await call('/api/auth/register', { email: `reg2-${base}@sybnb.local`, password: 'StrongPass123', role: 'GUEST', displayName: 'Email Reg2' })
check('fresh email still needs its own OTP (no cross-account bypass)', reuse.status === 403 && code(reuse) === 'REGISTRATION_OTP_REQUIRED', reuse.status + ' ' + code(reuse))

console.log(`\n==== EMAIL OTP E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
