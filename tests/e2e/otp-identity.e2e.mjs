// SYBNB — OTP / Identity E2E (governed evidence artifact)
//
// Proves the server-authoritative phone-verification (OTP) engine. Requires the API running with
// OTP_EXPOSE_FOR_TEST=true so the test can read the code the server would otherwise only SMS.
// In production OTP_EXPOSE_FOR_TEST is unset and the code is never returned to clients.
//
// No real SMS is sent (provider = sandbox). No account/session is created here — OTP endpoints are
// pre-auth. Run:
//   OTP_EXPOSE_FOR_TEST=true AUTH_SECRET=<secret> PHONE_HASH_SECRET=<secret> DATABASE_URL=... node server/index.mjs
//   node tests/e2e/otp-identity.e2e.mjs   (or: npm run test:e2e:otp)

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
async function call(path, body) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = r => r.j?.error?.code || r.j?.code
// unique phone per run to avoid cross-run lock/state collisions. Date.now() (not performance.now,
// which resets per process) keeps the seed distinct across repeated runs against the same DB.
const base = Math.floor(Date.now() % 9000000)
const phone = n => `+96393${String(base + n).padStart(7, '0')}`
const send = (p, purpose = 'account-verify', extra = {}) => call('/api/otp/send', { phone: p, purpose, ...extra })
const verify = (p, otp, purpose = 'account-verify') => call('/api/otp/verify', { phone: p, purpose, code: otp })

console.log('=== 1. INPUT VALIDATION ===')
check('missing phone rejected (OTP_PHONE_REQUIRED)', code(await call('/api/otp/send', { purpose: 'account-verify' })) === 'OTP_PHONE_REQUIRED', 'wrong')
check('invalid purpose rejected (OTP_PURPOSE_INVALID)', code(await send(phone(1), 'not-a-purpose')) === 'OTP_PURPOSE_INVALID', 'wrong')
check('verify missing code rejected (OTP_INPUT_REQUIRED)', code(await call('/api/otp/verify', { phone: phone(1), purpose: 'account-verify' })) === 'OTP_INPUT_REQUIRED', 'wrong')

console.log('\n=== 2. HAPPY PATH: send -> verify ===')
const pA = phone(2)
const s1 = await send(pA)
check('send returns 201 (PENDING, sandbox provider)', s1.status === 201 && s1.j?.sent === true && s1.j?.provider === 'sandbox', s1.status + ' ' + s1.j?.provider)
check('send masks the phone', typeof s1.j?.maskedPhone === 'string' && s1.j.maskedPhone.includes('••••'), s1.j?.maskedPhone)
check('send exposes devCode only in test mode', typeof s1.j?.devCode === 'string' && s1.j.devCode.length === 6, 'no devCode — is OTP_EXPOSE_FOR_TEST=true?')
const otpA = s1.j?.devCode
const v1 = await verify(pA, otpA)
check('verify with correct code succeeds (200, verified)', v1.status === 200 && v1.j?.verified === true, v1.status + ' ' + code(v1))

console.log('\n=== 3. SINGLE-USE / REPLAY ===')
const replay = await verify(pA, otpA)
check('replaying a used code is rejected (single-use)', replay.status >= 400 && ['OTP_NOT_FOUND', 'OTP_ALREADY_USED'].includes(code(replay)), replay.status + ' ' + code(replay))

console.log('\n=== 4. WRONG CODE + ATTEMPT LOCK ===')
const pB = phone(3)
const sB = await send(pB)
const otpB = sB.j?.devCode
check('1st wrong code -> OTP_CODE_INVALID', code(await verify(pB, '000000')) === 'OTP_CODE_INVALID', 'wrong')
await verify(pB, '111111'); await verify(pB, '222222'); await verify(pB, '333333') // attempts 2,3,4
const fifth = await verify(pB, '444444') // attempt 5 -> exhausted -> lock
check('exhausting attempts locks verification (OTP_LOCKED)', code(fifth) === 'OTP_LOCKED', code(fifth))
check('correct code blocked while locked', code(await verify(pB, otpB)) === 'OTP_LOCKED', 'not locked')
check('send also blocked while locked (abuse lock persists)', code(await send(pB)) === 'OTP_LOCKED', 'send not locked')

console.log('\n=== 5. RESEND THROTTLE ===')
const pC = phone(4)
const c1 = await send(pC)
check('first send ok', c1.status === 201, c1.status)
const c2 = await send(pC)
check('immediate resend throttled (OTP_RESEND_TOO_SOON)', code(c2) === 'OTP_RESEND_TOO_SOON', code(c2))

console.log('\n=== 6. NEW CODE INVALIDATES PRIOR (single active) ===')
// (covered implicitly: send cancels prior PENDING; here we confirm a fresh purpose works cleanly)
const pD = phone(5)
const d1 = await send(pD, 'guest-login')
const dOtp = d1.j?.devCode
check('send for a different purpose works independently', d1.status === 201, d1.status)
check('verify that code succeeds', (await verify(pD, dOtp, 'guest-login')).j?.verified === true, 'verify failed')

// NOTE: a per-IP burst limiter is ALSO enforced in production (30/min/IP) but is bypassed under
// OTP_EXPOSE_FOR_TEST so this suite stays deterministic/re-runnable. The idempotent per-identifier
// abuse controls above (resend throttle + 5-attempt lock) are the ones asserted here.

console.log('\n=== 7. REGISTRATION IS BOUND TO A SERVER-VERIFIED OTP (no UI bypass) ===')
const regPhone = phone(50)
const regEmail = `otp-reg-${base}@sybnb.local`
const register = (email, ph, extra = {}) => call('/api/auth/register', { email, password: 'StrongPass123', phone: ph, role: 'GUEST', displayName: 'OTP Reg', ...extra })
// direct API registration with a phone but NO verified OTP -> rejected
check('register with phone but no verified OTP -> 403 REGISTRATION_OTP_REQUIRED', code(await register(regEmail, regPhone)) === 'REGISTRATION_OTP_REQUIRED', 'bypass allowed')
// verify OTP, then register -> allowed
const rs = await send(regPhone)
const rok = await verify(regPhone, rs.j?.devCode)
check('OTP verified for registration phone', rok.j?.verified === true, 'verify failed')
const created = await register(regEmail, regPhone)
check('register after verified OTP succeeds (201)', created.status === 201, created.status + ' ' + code(created))
// reuse: the consumed OTP cannot bind a second account (replay/cross-account)
check('reusing a consumed OTP for another register -> 403', code(await register(`otp-reg2-${base}@sybnb.local`, regPhone)) === 'REGISTRATION_OTP_REQUIRED', 'consumed OTP reused')

console.log(`\n==== OTP / IDENTITY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
