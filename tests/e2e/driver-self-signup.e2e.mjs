// New driver self sign-up as the rides app does it: verified email code -> DRIVER register is refused
// (403) -> GUEST register (title DRIVER) -> /api/me/become-driver -> account holds DRIVER, and the
// applicant still cannot see open rides until an operator approves ID + vehicle.
const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); if (!ok) failed++ }
async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}
const email = `new-driver-${Date.now()}@e2e.test`
const password = 'Driver-pass-12345'
const sent = await call('/api/otp/send', { method: 'POST', body: { email, purpose: 'staff-login' } })
check('otp sent', sent.status === 201, String(sent.status))
const code = sent.data?.devCode
const verified = await call('/api/otp/verify', { method: 'POST', body: { email, purpose: 'staff-login', code } })
check('otp verified', verified.status === 200 && verified.data?.verified === true)
const login1 = await call('/api/auth/login', { method: 'POST', body: { email, password } })
check('login before account -> 401', login1.status === 401, String(login1.status))
const regDriver = await call('/api/auth/register', { method: 'POST', body: { email, password, displayName: 'x', role: 'DRIVER' } })
check('DRIVER self-register refused', regDriver.status === 403, String(regDriver.status))
const reg = await call('/api/auth/register', { method: 'POST', body: { email, password, displayName: 'new-driver', role: 'GUEST', title: 'DRIVER' } })
check('GUEST register with verified code', reg.status === 201 || reg.status === 200, `${reg.status} ${JSON.stringify(reg.data?.error || '')}`)
const token = reg.data?.token
const become = await call('/api/me/become-driver', { method: 'POST', token, body: {} })
check('become-driver adds DRIVER', become.status === 200 && (become.data?.roles || []).includes('DRIVER'), JSON.stringify(become.data))
const login2 = await call('/api/auth/login', { method: 'POST', body: { email, password } })
check('login now carries DRIVER', login2.status === 200 && (login2.data?.user?.roles || []).includes('DRIVER'), String(login2.status))
const pending = await call('/api/sr/rides/pending', { token: login2.data?.token })
check('unapproved applicant gets no open rides', pending.status !== 200 || (Array.isArray(pending.data?.rides) ? pending.data.rides.length === 0 : true), String(pending.status))
console.log(failed ? `FAILED ${failed}` : 'ALL PASS')
process.exit(failed ? 1 : 0)
