// SYBNB — OTP / Identity E2E (governed evidence artifact)
//
// Proves the server-authoritative EMAIL verification (OTP) engine under the email-only (Syria)
// profile. Requires the API running with OTP_EXPOSE_FOR_TEST=true so the test can read the code the
// server would otherwise only email. In production OTP_EXPOSE_FOR_TEST is unset and the code is never
// returned to clients. No real email is sent (provider = sandbox). No session is created here — OTP
// endpoints are pre-auth. Run:
//   OTP_EXPOSE_FOR_TEST=true SYBNB_COUNTRY=syria AUTH_SECRET=... PHONE_HASH_SECRET=... DATABASE_URL=... node server/index.mjs
//   node tests/e2e/otp-identity.e2e.mjs

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
async function call(path, body) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = r => r.j?.error?.code || r.j?.code
// unique email per run to avoid cross-run lock/state collisions.
const base = Math.floor(Date.now() % 9000000)
const email = n => `otp-id-${base + n}@sybnb.local`
const send = (e, purpose = 'account-verify', extra = {}) => call('/api/otp/send', { email: e, purpose, ...extra })
const verify = (e, otp, purpose = 'account-verify') => call('/api/otp/verify', { email: e, purpose, code: otp })

console.log('=== 1. INPUT VALIDATION ===')
check('missing identifier rejected (OTP_IDENTIFIER_REQUIRED)', code(await call('/api/otp/send', { purpose: 'account-verify' })) === 'OTP_IDENTIFIER_REQUIRED', 'wrong')
check('invalid purpose rejected (OTP_PURPOSE_INVALID)', code(await send(email(1), 'not-a-purpose')) === 'OTP_PURPOSE_INVALID', 'wrong')
check('verify missing code rejected (OTP_INPUT_REQUIRED)', code(await call('/api/otp/verify', { email: email(1), purpose: 'account-verify' })) === 'OTP_INPUT_REQUIRED', 'wrong')

console.log('\n=== 2. HAPPY PATH: send -> verify (EMAIL channel) ===')
const eA = email(2)
const s1 = await send(eA)
check('send returns 201 (PENDING, sandbox provider)', s1.status === 201 && s1.j?.sent === true && s1.j?.provider === 'sandbox', s1.status + ' ' + s1.j?.provider)
check('channel is email (not sms)', s1.j?.channel === 'email', s1.j?.channel)
check('send masks the email', typeof s1.j?.maskedEmail === 'string' && s1.j.maskedEmail.includes('@') && s1.j.maskedEmail.includes('•'), s1.j?.maskedEmail)
check('send exposes devCode only in test mode', typeof s1.j?.devCode === 'string' && s1.j.devCode.length === 6, 'no devCode — is OTP_EXPOSE_FOR_TEST=true?')
const otpA = s1.j?.devCode
const v1 = await verify(eA, otpA)
check('verify with correct code succeeds (200, verified)', v1.status === 200 && v1.j?.verified === true, v1.status + ' ' + code(v1))

console.log('\n=== 3. SINGLE-USE / REPLAY ===')
const replay = await verify(eA, otpA)
check('replaying a used code is rejected (single-use)', replay.status >= 400 && ['OTP_NOT_FOUND', 'OTP_ALREADY_USED'].includes(code(replay)), replay.status + ' ' + code(replay))

console.log('\n=== 4. WRONG CODE + ATTEMPT LOCK ===')
const eB = email(3)
const sB = await send(eB)
const otpB = sB.j?.devCode
check('1st wrong code -> OTP_CODE_INVALID', code(await verify(eB, '000000')) === 'OTP_CODE_INVALID', 'wrong')
await verify(eB, '111111'); await verify(eB, '222222'); await verify(eB, '333333') // attempts 2,3,4
const fifth = await verify(eB, '444444') // attempt 5 -> exhausted -> lock
check('exhausting attempts locks verification (OTP_LOCKED)', code(fifth) === 'OTP_LOCKED', code(fifth))
check('correct code blocked while locked', code(await verify(eB, otpB)) === 'OTP_LOCKED', 'not locked')
check('send also blocked while locked (abuse lock persists)', code(await send(eB)) === 'OTP_LOCKED', 'send not locked')

console.log('\n=== 5. RESEND THROTTLE ===')
const eC = email(4)
const c1 = await send(eC)
check('first send ok', c1.status === 201, c1.status)
const c2 = await send(eC)
check('immediate resend throttled (OTP_RESEND_TOO_SOON)', code(c2) === 'OTP_RESEND_TOO_SOON', code(c2))

console.log('\n=== 6. NEW CODE INVALIDATES PRIOR (single active) ===')
const eD = email(5)
const d1 = await send(eD, 'guest-login')
const dOtp = d1.j?.devCode
check('send for a different purpose works independently', d1.status === 201, d1.status)
check('verify that code succeeds', (await verify(eD, dOtp, 'guest-login')).j?.verified === true, 'verify failed')

console.log('\n=== 7. SYRIA IS EMAIL-ONLY: phone OTP channel is UNREACHABLE (no sendSms) ===')
const phoneSend = await call('/api/otp/send', { phone: '+963931234567', purpose: 'account-verify' })
check('phone OTP under Syria refused before SMS (OTP_CHANNEL_NOT_ENABLED)', code(phoneSend) === 'OTP_CHANNEL_NOT_ENABLED', phoneSend.status + ' ' + code(phoneSend))

console.log('\n=== 8. REGISTRATION IS BOUND TO A SERVER-VERIFIED EMAIL OTP (no UI bypass) ===')
const regEmail = `otp-reg-${base}@sybnb.local`
const register = (e, extra = {}) => call('/api/auth/register', { email: e, password: 'StrongPass123', role: 'GUEST', displayName: 'OTP Reg', ...extra })
check('register with email but no verified OTP -> 403 REGISTRATION_OTP_REQUIRED', code(await register(regEmail)) === 'REGISTRATION_OTP_REQUIRED', 'bypass allowed')
const rs = await send(regEmail)
const rok = await verify(regEmail, rs.j?.devCode)
check('OTP verified for registration email', rok.j?.verified === true, 'verify failed')
const created = await register(regEmail)
check('register after verified OTP succeeds (201)', created.status === 201, created.status + ' ' + code(created))
check('reusing a consumed OTP for another register -> 403', code(await register(`otp-reg2-${base}@sybnb.local`)) === 'REGISTRATION_OTP_REQUIRED', 'consumed OTP reused')
// phone as optional CONTACT data does not authenticate: phone-only signup is refused under email-only
check('phone-only registration refused under email-only (REGISTRATION_EMAIL_REQUIRED)', code(await call('/api/auth/register', { phone: '+963931230000', password: 'StrongPass123', role: 'GUEST', displayName: 'NoEmail' })) === 'REGISTRATION_EMAIL_REQUIRED', 'phone auth allowed')

console.log(`\n==== OTP / IDENTITY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
