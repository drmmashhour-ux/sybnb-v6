// SYBNB — Host/Seller SIGNUP JOURNEY integration test (governed, no-cheat).
//
// Exercises the EXACT client functions the host/seller account UI (SellerAccountPage) calls —
// requestOtp, confirmOtp, createSellerAccountSession from platformApi.ts — against the live API,
// reading the code from the /api/otp/send RESPONSE like the email inbox (NOT the DB). Proves a new
// host can verify + create a SELLER account by EMAIL (phone optional). No preloaded auth, no DB
// insert, no OTP bypass. API must run with OTP_EXPOSE_FOR_TEST=true + SYBNB_COUNTRY=syria.
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(mkdtempSync(join(tmpdir(), 'sybnb-seller-')), 'platformApi.mjs')
execSync(`npx esbuild ${join(root, 'src/shared/api/platformApi.ts')} --bundle --format=esm --outfile=${out} --log-level=error "--define:import.meta.env={}"`, { stdio: 'inherit' })

const store = new Map()
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size } }
globalThis.localStorage = globalThis.sessionStorage
globalThis.window = globalThis.window || { location: { hash: '' } }

const api = await import(out)
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const base = Date.now()
const email = `host-journey-${base}@sybnb.local`

console.log('=== NEW HOST/SELLER SIGNUP BY EMAIL (the SellerAccountPage code path) ===')
const send = await api.requestOtp({ email, purpose: 'seller-login' })
check('host OTP requested by email (no phone)', send.channel === 'email' && send.sent === true, JSON.stringify(send))
check('code delivered via the send response (inbox)', typeof send.devCode === 'string' && send.devCode.length === 6, 'no devCode')

const verified = await api.confirmOtp({ email, purpose: 'seller-login', code: send.devCode })
check('email code verifies', verified === true, `verified=${verified}`)

const session = await api.createSellerAccountSession({ displayName: 'Host Journey', email, password: 'StrongPass123', sellerRole: 'owner', planCode: 'plus' })
check('SELLER account created + session token (email-only)', Boolean(session && session.token), 'no token')

console.log('\n=== NO BYPASS: seller signup without a verified email OTP must fail ===')
let blocked = false
try {
  await api.createSellerAccountSession({ displayName: 'No Otp', email: `nootp-seller-${base}@sybnb.local`, password: 'StrongPass123', sellerRole: 'owner', planCode: 'plus' })
} catch { blocked = true }
check('unverified email cannot open a seller account (OTP-gated)', blocked === true, 'account created without OTP')

console.log(`\n==== SELLER SIGNUP JOURNEY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
