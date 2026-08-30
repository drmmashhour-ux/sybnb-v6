// SYBNB — Staff Access self-registration role boundary (regression for a real UI bug)
//
// A real audit found StaffAccessPage.tsx's "Create account" tab was a nonfunctional promise for
// ADMIN and DRIVER: createStaffAccountSession() tries POST /api/auth/register regardless of role,
// but PUBLIC_REGISTER_ROLES (server/routes/auth.mjs) only allows GUEST/HOST/SELLER, so the
// register() call for ADMIN/DRIVER always 403s and silently falls back to login() -- both tabs
// ended up doing the exact same thing with no visible difference. The frontend fix (only render
// the sign-in/sign-up toggle for role==='HOST') depends entirely on this backend invariant holding.
// This suite protects that invariant directly, so a future change to PUBLIC_REGISTER_ROLES can't
// silently re-break the frontend's assumption without a test noticing.
//
// Run: node tests/e2e/staff-access-role-registration.e2e.mjs (API_BASE default http://127.0.0.1:3051)

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = (r) => r.j?.error?.code || r.j?.code

console.log('=== ADMIN/DRIVER self-registration must be architecturally rejected (not just hidden in the UI) ===')
const adminReg = await call('POST', '/api/auth/register', { email: `staff-audit-admin-${Date.now()}@example.test`, password: 'AuditPass123!', displayName: 'Audit Admin', role: 'ADMIN' })
check('ADMIN register blocked at the role gate (403 ROLE_REGISTRATION_FORBIDDEN)', adminReg.status === 403 && code(adminReg) === 'ROLE_REGISTRATION_FORBIDDEN', adminReg.status + ' ' + code(adminReg))
const driverReg = await call('POST', '/api/auth/register', { email: `staff-audit-driver-${Date.now()}@example.test`, password: 'AuditPass123!', displayName: 'Audit Driver', role: 'DRIVER' })
check('DRIVER register blocked at the role gate (403 ROLE_REGISTRATION_FORBIDDEN)', driverReg.status === 403 && code(driverReg) === 'ROLE_REGISTRATION_FORBIDDEN', driverReg.status + ' ' + code(driverReg))

console.log('\n=== HOST/GUEST/SELLER self-registration must pass the role gate (fails later only for lack of OTP) ===')
const hostReg = await call('POST', '/api/auth/register', { email: `staff-audit-host-${Date.now()}@example.test`, password: 'AuditPass123!', displayName: 'Audit Host', role: 'HOST' })
check('HOST register passes the role gate (fails on OTP, not ROLE_REGISTRATION_FORBIDDEN)', code(hostReg) !== 'ROLE_REGISTRATION_FORBIDDEN', hostReg.status + ' ' + code(hostReg))
const guestReg = await call('POST', '/api/auth/register', { email: `staff-audit-guest-${Date.now()}@example.test`, password: 'AuditPass123!', displayName: 'Audit Guest', role: 'GUEST' })
check('GUEST register passes the role gate', code(guestReg) !== 'ROLE_REGISTRATION_FORBIDDEN', guestReg.status + ' ' + code(guestReg))
const sellerReg = await call('POST', '/api/auth/register', { email: `staff-audit-seller-${Date.now()}@example.test`, password: 'AuditPass123!', displayName: 'Audit Seller', role: 'SELLER' })
check('SELLER register passes the role gate', code(sellerReg) !== 'ROLE_REGISTRATION_FORBIDDEN', sellerReg.status + ' ' + code(sellerReg))

console.log(`\n==== STAFF ACCESS ROLE REGISTRATION E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
