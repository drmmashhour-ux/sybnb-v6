// SYBNB — Host DASHBOARD login journey integration test (governed, no-cheat).
//
// Exercises the exact client functions the host access screen (StaffAccessPage, role=HOST) calls —
// requestOtp, confirmOtp, createStaffAccountSession('HOST', ...) — against the live API, reading the
// code from the /api/otp/send RESPONSE like the email inbox (NOT the DB). Proves a host can verify by
// EMAIL and open the booking-management session (phone optional). No preloaded auth, no DB insert, no
// OTP bypass. API must run with OTP_EXPOSE_FOR_TEST=true + SYBNB_COUNTRY=syria.
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(mkdtempSync(join(tmpdir(), 'sybnb-host-')), 'platformApi.mjs')
execSync(`npx esbuild ${join(root, 'src/shared/api/platformApi.ts')} --bundle --format=esm --outfile=${out} --log-level=error "--define:import.meta.env={}"`, { stdio: 'inherit' })

const store = new Map()
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size } }
globalThis.localStorage = globalThis.sessionStorage
globalThis.window = globalThis.window || { location: { hash: '' }, dispatchEvent: () => {}, Event: function () {} }
globalThis.Event = globalThis.Event || function () {}

const api = await import(out)
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const base = Date.now()
const email = `host-dash-${base}@sybnb.local`

console.log('=== HOST DASHBOARD LOGIN BY EMAIL (StaffAccessPage role=HOST) ===')
const send = await api.requestOtp({ email, purpose: 'staff-login' })
check('host access OTP requested by email (no phone)', send.channel === 'email' && send.sent === true, JSON.stringify(send))
check('code delivered via the send response (inbox)', typeof send.devCode === 'string' && send.devCode.length === 6, 'no devCode')

const verified = await api.confirmOtp({ email, purpose: 'staff-login', code: send.devCode })
check('email code verifies', verified === true, `verified=${verified}`)

const session = await api.createStaffAccountSession('HOST', { email, password: 'StrongPass123', mode: 'signUp' })
check('host session opened + token issued (email-only, phone omitted)', Boolean(session && session.token), 'no token')

console.log('\n=== NO BYPASS: host access without a verified email OTP must fail ===')
let blocked = false
try {
  await api.createStaffAccountSession('HOST', { email: `nootp-host-${base}@sybnb.local`, password: 'StrongPass123', mode: 'signUp' })
} catch { blocked = true }
check('unverified email cannot open a host session (OTP-gated)', blocked === true, 'session opened without OTP')

console.log(`\n==== HOST LOGIN JOURNEY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
