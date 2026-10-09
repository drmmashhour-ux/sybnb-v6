// SYBNB — host verification (activation code) + admin sign-in code E2E (owner decisions of
// 2026-10-08; governed evidence).
//
// SELF-CONTAINED: seeds its own host, guest, admin accounts and an APPROVED stay through Prisma, so
// it runs the same against a fresh CI database (`prisma migrate deploy` only) and a long-lived one.
//
// Proves, through the real HTTP API + real rows:
//   1. An unverified host's APPROVED stay is hidden from browse, detail, availability and both quote
//      endpoints (404), and POST /api/bookings refuses it (409 HOST_NOT_VERIFIED). The owner still
//      reads its calendar.
//   2. Only an ADMIN (not the host, not for their own account) can issue a code; the code is 6 digits,
//      returned once, stored only as a hash, expires in 7 days, re-issuing retires the previous one,
//      and the audit row never contains it. GET /api/admin/hosts filters by status.
//   3. Wrong codes: a malformed entry costs no attempt; 5 wrong guesses lock the code, after which
//      even the correct code is refused until re-issued.
//   4. The correct (re-issued) code verifies the host (users.host_verified_at/by, code used, audit
//      row); the stay becomes visible and bookable; re-issuing for a verified host is refused.
//   5. Admin sign-in: password alone -> 403 ADMIN_LOGIN_CODE_REQUIRED; a 'staff-login' code does not
//      count; a fresh 'admin-login' code -> 200 with a ~12h session; the code is single-use; a wrong
//      password is still a plain 401; a non-admin login is unchanged.
//   6. GET /api/me returns the account's LIVE roles (become-host reflected without a new login).
//
// Needs the API running with OTP_EXPOSE_FOR_TEST=true (section 5 reads the emailed code from the
// devCode field, as every OTP suite does) and DATABASE_URL + AUTH_SECRET in this process's env.
// Run: node tests/e2e/host-verification.e2e.mjs

import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RUN = randomUUID().slice(0, 8)
const DAY = 24 * 60 * 60 * 1000
const PASSWORD = 'HostVerify-E2E-Pw!'

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
}
async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code
const dateOnly = (ms) => new Date(ms).toISOString().slice(0, 10)
function dayFromToday(days) {
  const now = new Date()
  return dateOnly(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY)
}
async function clearBuckets(prefixes) {
  await db().rateLimitBucket.deleteMany({ where: { OR: prefixes.map((p) => ({ bucketKey: { startsWith: p } })) } })
}

async function seedUser(label, roles, extra = {}) {
  const user = await db().user.create({
    data: {
      email: `host-verify-${label}-${RUN}@example.test`,
      displayName: `HV ${label} ${RUN}`,
      locale: 'en',
      passwordHash: hashPassword(PASSWORD),
      roles: { create: roles.map((role) => ({ role })) },
      ...extra,
    },
  })
  const token = await createSessionToken({ id: user.id, roles: roles.map((role) => ({ role })) })
  return { ...user, token }
}

async function main() {
  console.log('=== HOST VERIFICATION + ADMIN LOGIN CODE E2E (2026-10-08) ===')
  const host = await seedUser('host', ['HOST', 'GUEST'])
  const guest = await seedUser('guest', ['GUEST'])
  const admin = await seedUser('admin', ['ADMIN'])
  // A unique price so the browse query isolates this run's listing.
  const PRICE = 7_100_000 + Math.floor(Math.random() * 90_000)
  const listing = await db().listing.create({
    data: { ownerId: host.id, division: 'STAYS', titleAr: `إقامة تحقق ${RUN}`, titleEn: `Verify stay ${RUN}`, status: 'APPROVED', priceMinor: PRICE, currency: 'SYP' },
  })
  const qIn = dayFromToday(40)
  const qOut = dayFromToday(42)
  const browse = async () => (await call('GET', `/api/listings?division=STAYS&priceMin=${PRICE}&priceMax=${PRICE}`, null)).j?.listings || []

  // --- 1. Hidden + not bookable --------------------------------------------------------------
  console.log('\n--- 1. unverified host: listing hidden and not bookable ---')
  check('host starts unverified (DB)', !(await db().user.findUnique({ where: { id: host.id } })).hostVerifiedAt, 'already verified')
  check('browse does not return the stay', !(await browse()).some((l) => l.id === listing.id), 'listed')
  const allDivisions = (await call('GET', `/api/listings?priceMin=${PRICE}&priceMax=${PRICE}`, null)).j?.listings || []
  check('browse without a division does not return it either', !allDivisions.some((l) => l.id === listing.id), 'listed')
  const detail = await call('GET', `/api/listings/${listing.id}`, null)
  check('GET /api/listings/:id -> 404', detail.status === 404, detail)
  const availAnon = await call('GET', `/api/listings/${listing.id}/availability`, null)
  check('availability (public) -> 404', availAnon.status === 404, availAnon)
  const availOwner = await call('GET', `/api/listings/${listing.id}/availability`, host.token)
  check('availability (owner) -> 200', availOwner.status === 200, availOwner)
  const lq = await call('GET', `/api/listings/${listing.id}/quote?checkIn=${qIn}&checkOut=${qOut}`, null)
  check('GET /api/listings/:id/quote -> 404', lq.status === 404, lq)
  const bq = await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${qIn}&checkOut=${qOut}`, null)
  check('GET /api/bookings/quote -> 404', bq.status === 404, bq)
  const refused = await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: qIn, checkOut: qOut })
  check('POST /api/bookings -> 409 HOST_NOT_VERIFIED', refused.status === 409 && code(refused) === 'HOST_NOT_VERIFIED', refused)
  const status0 = (await call('GET', '/api/host/verification', host.token)).j
  check('GET /api/host/verification: not verified, no pending code', status0?.verified === false && status0?.hasPendingCode === false, status0)

  // --- 2. Issuing --------------------------------------------------------------------------------
  console.log('\n--- 2. admin issues activation codes ---')
  await clearBuckets(['host-activation-issue', 'host-activate', `admin-action:${admin.id}`])
  const noCode = await call('POST', '/api/host/activate', host.token, { code: '123456' })
  check('activate before any code -> 404 ACTIVATION_CODE_NOT_FOUND', noCode.status === 404 && code(noCode) === 'ACTIVATION_CODE_NOT_FOUND', noCode)
  const byHost = await call('POST', `/api/admin/hosts/${host.id}/activation-code`, host.token, {})
  check('a host cannot issue a code -> 403', byHost.status === 403, byHost)
  const self = await call('POST', `/api/admin/hosts/${admin.id}/activation-code`, admin.token, {})
  check('an admin cannot issue a code for their own account -> 403', self.status === 403 && code(self) === 'SELF_VERIFICATION_FORBIDDEN', self)
  const notHost = await call('POST', `/api/admin/hosts/${guest.id}/activation-code`, admin.token, {})
  check('issuing for a non-host -> 409 NOT_A_HOST', notHost.status === 409 && code(notHost) === 'NOT_A_HOST', notHost)

  const listUnverified = await call('GET', '/api/admin/hosts?status=unverified', admin.token)
  const row0 = listUnverified.j?.hosts?.find((h) => h.id === host.id)
  check('GET /api/admin/hosts?status=unverified lists the host (listingsCount 1, no code yet)', row0 && row0.listingsCount === 1 && row0.verifiedAt === null && row0.latestCode === null, row0 || listUnverified.status)
  check('GET /api/admin/hosts?status=bogus -> 400', (await call('GET', '/api/admin/hosts?status=bogus', admin.token)).status === 400, 'expected 400')
  check('GET /api/admin/hosts as a host -> 403', (await call('GET', '/api/admin/hosts', host.token)).status === 403, 'expected 403')

  const issueA = await call('POST', `/api/admin/hosts/${host.id}/activation-code`, admin.token, {})
  const codeA = issueA.j?.code
  check('issue -> 201 with a 6-digit code', issueA.status === 201 && /^\d{6}$/.test(codeA || ''), issueA)
  const ttlDays = (new Date(issueA.j?.expiresAt).getTime() - Date.now()) / DAY
  check('code expires in ~7 days', ttlDays > 6.9 && ttlDays <= 7.01, ttlDays)
  const rowA = await db().hostActivationCode.findUnique({ where: { id: issueA.j?.codeId } })
  check('DB stores only a hash (no plaintext), attempts 0, issued_by = admin', rowA && rowA.codeHash !== codeA && !rowA.codeHash.includes(codeA) && rowA.attempts === 0 && rowA.issuedById === admin.id, rowA)
  const auditA = await db().adminAuditLog.findFirst({ where: { action: 'HOST_ACTIVATION_CODE_ISSUED', entityId: host.id }, orderBy: { createdAt: 'desc' } })
  check('audit row written, without the code', auditA && !JSON.stringify(auditA).includes(codeA), auditA)

  const issueB = await call('POST', `/api/admin/hosts/${host.id}/activation-code`, admin.token, { sendEmail: true })
  const codeB = issueB.j?.code
  check('re-issue -> 201 (email requested -> emailQueued)', issueB.status === 201 && issueB.j?.emailQueued === true, issueB)
  const retiredA = await db().hostActivationCode.findUnique({ where: { id: issueA.j?.codeId } })
  check('the previous unused code was retired (expires_at <= now)', retiredA.expiresAt.getTime() <= Date.now(), retiredA)
  const status1 = (await call('GET', '/api/host/verification', host.token)).j
  check('host sees a pending code with its expiry', status1?.hasPendingCode === true && Boolean(status1?.codeExpiresAt) && status1?.attemptsRemaining === 5, status1)

  // --- 3. Wrong attempts + lock ------------------------------------------------------------------
  console.log('\n--- 3. wrong codes lock after 5 attempts ---')
  const malformed = await call('POST', '/api/host/activate', host.token, { code: '12ab' })
  check('malformed code -> 400 ACTIVATION_CODE_FORMAT', malformed.status === 400 && code(malformed) === 'ACTIVATION_CODE_FORMAT', malformed)
  check('...and it did not spend an attempt', (await db().hostActivationCode.findUnique({ where: { id: issueB.j?.codeId } })).attempts === 0, 'attempt spent')
  const wrongCodes = []
  wrongCodes.push(codeA !== codeB ? codeA : String((Number(codeB) + 1) % 1_000_000).padStart(6, '0')) // the retired code no longer works
  while (wrongCodes.length < 5) {
    const candidate = String((Number(codeB) + 7 * wrongCodes.length + 3) % 1_000_000).padStart(6, '0')
    if (candidate !== codeB) wrongCodes.push(candidate)
  }
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', '/api/host/activate', host.token, { code: wrongCodes[i] })
    check(`wrong code #${i + 1} -> 400 ACTIVATION_CODE_INVALID, ${4 - i} left`, r.status === 400 && code(r) === 'ACTIVATION_CODE_INVALID' && r.j?.error?.attemptsRemaining === 4 - i, r)
  }
  const fifth = await call('POST', '/api/host/activate', host.token, { code: wrongCodes[4] })
  check('wrong code #5 -> 423 ACTIVATION_CODE_LOCKED', fifth.status === 423 && code(fifth) === 'ACTIVATION_CODE_LOCKED', fifth)
  const lockedCorrect = await call('POST', '/api/host/activate', host.token, { code: codeB })
  check('even the correct code is refused once locked -> 423', lockedCorrect.status === 423, lockedCorrect)
  check('host is still unverified', !(await db().user.findUnique({ where: { id: host.id } })).hostVerifiedAt, 'verified')
  const status2 = (await call('GET', '/api/host/verification', host.token)).j
  check('host status shows the code locked', status2?.codeLocked === true && status2?.hasPendingCode === false, status2)
  const listed = (await call('GET', '/api/admin/hosts?status=unverified', admin.token)).j?.hosts?.find((h) => h.id === host.id)
  check('admin list shows the latest code LOCKED with 5 attempts', listed?.latestCode?.state === 'LOCKED' && listed?.latestCode?.attempts === 5, listed)

  // --- 4. Correct code verifies ------------------------------------------------------------------
  console.log('\n--- 4. a fresh code verifies the host ---')
  await clearBuckets(['host-activate'])
  const issueC = await call('POST', `/api/admin/hosts/${host.id}/activation-code`, admin.token, {})
  const codeC = issueC.j?.code
  check('re-issue after lock -> 201', issueC.status === 201 && /^\d{6}$/.test(codeC || ''), issueC)
  const spaced = `${codeC.slice(0, 3)} ${codeC.slice(3)}`
  const ok = await call('POST', '/api/host/activate', host.token, { code: spaced })
  check('correct code (typed with a space) -> 200 with verifiedAt', ok.status === 200 && Boolean(ok.j?.verifiedAt), ok)
  const verifiedRow = await db().user.findUnique({ where: { id: host.id } })
  check('DB: host_verified_at set, host_verified_by = issuing admin', Boolean(verifiedRow.hostVerifiedAt) && verifiedRow.hostVerifiedById === admin.id, verifiedRow)
  const usedC = await db().hostActivationCode.findUnique({ where: { id: issueC.j?.codeId } })
  check('DB: the code is marked used', Boolean(usedC?.usedAt), usedC)
  check('audit HOST_VERIFIED written', Boolean(await db().adminAuditLog.findFirst({ where: { action: 'HOST_VERIFIED', entityId: host.id } })), 'missing')
  const again = await call('POST', '/api/host/activate', host.token, { code: codeC })
  check('activating again -> 200 alreadyVerified', again.status === 200 && again.j?.alreadyVerified === true, again)
  const reissue = await call('POST', `/api/admin/hosts/${host.id}/activation-code`, admin.token, {})
  check('issuing for a verified host -> 409 HOST_ALREADY_VERIFIED', reissue.status === 409 && code(reissue) === 'HOST_ALREADY_VERIFIED', reissue)
  const verifiedList = (await call('GET', '/api/admin/hosts?status=verified', admin.token)).j?.hosts || []
  check('admin list status=verified includes the host', verifiedList.some((h) => h.id === host.id && h.verifiedAt), 'missing')
  check('browse now returns the stay', (await browse()).some((l) => l.id === listing.id), 'not listed')
  const detail2 = await call('GET', `/api/listings/${listing.id}`, null)
  check('GET /api/listings/:id -> 200, owner exposes only id + displayName', detail2.status === 200 && detail2.j?.listing?.owner && !('hostVerifiedAt' in detail2.j.listing.owner), detail2.status)
  check('public availability -> 200', (await call('GET', `/api/listings/${listing.id}/availability`, null)).status === 200, 'not 200')
  check('quote -> 200', (await call('GET', `/api/bookings/quote?listingId=${listing.id}&checkIn=${qIn}&checkOut=${qOut}`, null)).status === 200, 'not 200')
  const booked = await call('POST', '/api/bookings', guest.token, { listingId: listing.id, checkIn: qIn, checkOut: qOut })
  check('POST /api/bookings -> 201', booked.status === 201, booked)

  // --- 5. Admin sign-in needs a fresh email code -------------------------------------------------
  console.log('\n--- 5. admin sign-in requires a fresh admin-login code ---')
  await clearBuckets(['auth:'])
  const login = (email, password = PASSWORD) => call('POST', '/api/auth/login', null, { email, password })
  const noOtp = await login(admin.email)
  check('admin password only -> 403 ADMIN_LOGIN_CODE_REQUIRED', noOtp.status === 403 && code(noOtp) === 'ADMIN_LOGIN_CODE_REQUIRED' && !noOtp.j?.token, noOtp)
  const wrongPw = await login(admin.email, 'not-the-password')
  check('wrong password -> plain 401 (no admin-ness oracle)', wrongPw.status === 401 && code(wrongPw) === 'INVALID_CREDENTIALS', wrongPw)
  const otp = async (purpose) => {
    const sent = await call('POST', '/api/otp/send', null, { email: admin.email, purpose })
    if (!sent.j?.devCode) return null
    const verified = await call('POST', '/api/otp/verify', null, { email: admin.email, purpose, code: sent.j.devCode })
    return verified.status === 200
  }
  const staffOk = await otp('staff-login')
  if (staffOk === null) {
    console.log('   (skipped the code-backed half: API is not running with OTP_EXPOSE_FOR_TEST=true)')
  } else {
    const withStaff = await login(admin.email)
    check("a verified 'staff-login' code does not count -> 403", withStaff.status === 403 && code(withStaff) === 'ADMIN_LOGIN_CODE_REQUIRED', withStaff)
    check("'admin-login' code sent + verified", (await otp('admin-login')) === true, 'otp failed')
    const withAdmin = await login(admin.email)
    check('admin password + fresh code -> 200 with a token', withAdmin.status === 200 && Boolean(withAdmin.j?.token), withAdmin)
    const hours = (new Date(withAdmin.j?.expiresAt).getTime() - Date.now()) / 3600_000
    check('admin session lifetime is ~12h (not 7 days)', hours > 11.9 && hours <= 12.01, hours)
    check('that session can use admin endpoints', (await call('GET', '/api/admin/hosts', withAdmin.j?.token)).status === 200, 'not 200')
    const replay = await login(admin.email)
    check('the code is single-use: a second login without a new code -> 403', replay.status === 403, replay)
  }
  const guestLogin = await login(guest.email)
  check('non-admin login is unchanged (password only) -> 200', guestLogin.status === 200 && Boolean(guestLogin.j?.token), guestLogin)
  const guestHours = (new Date(guestLogin.j?.expiresAt).getTime() - Date.now()) / 3600_000
  check('non-admin session keeps the 7-day lifetime', guestHours > 24 * 6.9, guestHours)

  // --- 6. Live roles -----------------------------------------------------------------------------
  console.log('\n--- 6. GET /api/me returns live roles ---')
  const me0 = await call('GET', '/api/me', guest.token)
  check('GET /api/me -> roles [GUEST]', me0.status === 200 && JSON.stringify(me0.j?.user?.roles) === '["GUEST"]', me0)
  await call('POST', '/api/me/become-host', guest.token, {})
  const me1 = await call('GET', '/api/me', guest.token)
  check('after become-host the SAME session reads HOST without signing in again', me1.status === 200 && me1.j?.user?.roles?.includes('HOST'), me1)
  check('GET /api/me without a session -> 401', (await call('GET', '/api/me', null)).status === 401, 'not 401')

  console.log(`\n==== HOST VERIFICATION E2E: ${pass} passed, ${fail} failed ====`)
}

try {
  await main()
} catch (error) {
  fail++
  console.error('UNCAUGHT', error)
  console.log(`\n==== HOST VERIFICATION E2E: ${pass} passed, ${fail} failed ====`)
} finally {
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
