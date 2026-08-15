// SYBNB — Frontend SIGNUP JOURNEY integration test (governed, no-cheat).
//
// Exercises the EXACT client functions the signup UI (GuestAccountPage) calls — requestOtp,
// confirmOtp, createGuestAccountSession from src/shared/api/platformApi.ts — against the live API,
// reading the verification code from the /api/otp/send RESPONSE the way the email inbox would receive
// it (NOT from the database). No cheating: no preloaded auth, no direct DB user insert, no OTP bypass,
// no navigating straight to an authenticated URL. Proves a new customer can complete signup by email
// only. API must run with OTP_EXPOSE_FOR_TEST=true + SYBNB_COUNTRY=syria (run-all-e2e sets these).
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(mkdtempSync(join(tmpdir(), 'sybnb-signup-')), 'platformApi.mjs')
execSync(`npx esbuild ${join(root, 'src/shared/api/platformApi.ts')} --bundle --format=esm --outfile=${out} --log-level=error "--define:import.meta.env={}"`, { stdio: 'inherit' })

// Minimal browser-global stubs the client functions touch (sessionStorage/window). This does NOT
// preload any auth — it's an empty store, exactly like a fresh browser.
const store = new Map()
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}
globalThis.window = globalThis.window || { location: { hash: '' } }

const api = await import(out)
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

const base = Date.now()
const email = `signup-journey-${base}@sybnb.local`

console.log('=== NEW CUSTOMER SIGNUP BY EMAIL (the UI code path) ===')
// 1. Request the verification code by EMAIL (no phone) — as the "Email me the code" button does.
const send = await api.requestOtp({ email, purpose: 'account-verify' })
check('OTP requested by email channel (no phone)', send.channel === 'email' && send.sent === true, JSON.stringify(send))
check('code delivered via the send response (inbox)', typeof send.devCode === 'string' && send.devCode.length === 6, 'no devCode')

// 2. Confirm the code — as the "Confirm code" button does.
const verified = await api.confirmOtp({ email, purpose: 'account-verify', code: send.devCode })
check('email code verifies', verified === true, `verified=${verified}`)

// 3. Open the account — as the "Open account and continue" button does.
const session = await api.createGuestAccountSession({ firstName: 'Journey', lastName: 'Test', email, password: 'StrongPass123' })
check('account created + session token issued (email-only)', Boolean(session && session.token), 'no token')

console.log('\n=== NO BYPASS: signup without a verified email OTP must fail ===')
let blocked = false
try {
  await api.createGuestAccountSession({ firstName: 'No', lastName: 'Otp', email: `nootp-${base}@sybnb.local`, password: 'StrongPass123' })
} catch { blocked = true }
check('unverified email cannot open an account (OTP-gated)', blocked === true, 'account created without OTP')

console.log(`\n==== SIGNUP JOURNEY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
