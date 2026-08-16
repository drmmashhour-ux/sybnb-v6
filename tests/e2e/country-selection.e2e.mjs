// SYBNB — Country selection E2E (governed evidence). Self-contained (no API/DB).
// The master platform is country-neutral; the active country is chosen by SYBNB_COUNTRY and its
// profile loaded from countries/<country>. Proves fail-closed selection and no cross-country bleed.
//   node tests/e2e/country-selection.e2e.mjs
import { validateEnv } from '../../server/lib/env.mjs'
import { loadCountryProfile, supportedCountries } from '../../server/lib/country.mjs'

let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const base = { AUTH_SECRET: 'x', PHONE_HASH_SECRET: 'y', DATABASE_URL: 'z' }
const hasCountryProblem = (env) => validateEnv(env).some((p) => /SYBNB_COUNTRY|country profile|not valid for country/i.test(p))

console.log('=== FAIL-CLOSED COUNTRY SELECTION (master is country-neutral) ===')
check('no SYBNB_COUNTRY refuses to run', hasCountryProblem({ ...base }), 'not refused')
check('unsupported SYBNB_COUNTRY refuses', hasCountryProblem({ ...base, SYBNB_COUNTRY: 'canada' }), 'not refused')
check('SYBNB_COUNTRY=syria passes', validateEnv({ ...base, SYBNB_COUNTRY: 'syria' }).length === 0, JSON.stringify(validateEnv({ ...base, SYBNB_COUNTRY: 'syria' })))
check('this release supports Syria only', JSON.stringify(supportedCountries()) === JSON.stringify(['syria']), supportedCountries().join(','))

console.log('\n=== SYRIA PROFILE (isolated, not baked into master) ===')
const { profile } = loadCountryProfile({ SYBNB_COUNTRY: 'syria' })
check('service country is SY', profile.country === 'SY', profile.country)
check('operating entity is Québec (corporate identity, not market)', profile.operatingEntity.country === 'CA-QC', profile.operatingEntity.country)
check('allowed currencies SYP/USD (no CAD)', JSON.stringify(profile.currencies.allowed) === JSON.stringify(['SYP', 'USD']), JSON.stringify(profile.currencies.allowed))
check('advertising default USD', profile.currencies.advertisingDefault === 'USD', profile.currencies.advertisingDefault)
check('per-country gates closed (legal DRAFT, payments off, public closed, deploy blocked)',
  profile.gates.legal === 'DRAFT' && profile.gates.payments === 'disabled' && profile.gates.publicAccess === 'closed' && profile.gates.deployment === 'blocked',
  JSON.stringify(profile.gates))

console.log('\n=== NO CROSS-COUNTRY INHERITANCE ===')
check('active-profile currency guard rejects CAD under syria', hasCountryProblem({ ...base, SYBNB_COUNTRY: 'syria', ADVERTISING_CURRENCY: 'CAD' }), 'not rejected')
check('active-profile currency guard rejects STRIPE_CURRENCY=cad under syria', hasCountryProblem({ ...base, SYBNB_COUNTRY: 'syria', STRIPE_CURRENCY: 'cad' }), 'not rejected')
check('USD advertising allowed under syria', validateEnv({ ...base, SYBNB_COUNTRY: 'syria', ADVERTISING_CURRENCY: 'USD' }).length === 0)

console.log('\n=== PRODUCTION EMAIL PROVIDER FAIL-CLOSED (email OTP is the primary auth channel) ===')
const prodBase = { ...base, SYBNB_COUNTRY: 'syria', NODE_ENV: 'production', CORS_ORIGIN: 'https://app', STORAGE_PROVIDER: 's3', STORAGE_S3_BUCKET: 'b', STORAGE_S3_REGION: 'r' }
const hasEmailProblem = (env) => validateEnv(env).some((p) => /EMAIL_PROVIDER|RESEND_API_KEY|EMAIL_FROM/i.test(p))
check('production on sandbox email refuses (would silently send no OTP)', hasEmailProblem({ ...prodBase }), 'not refused')
check('production EMAIL_PROVIDER=resend without creds refuses', hasEmailProblem({ ...prodBase, EMAIL_PROVIDER: 'resend' }), 'not refused')
check('production resend WITH creds passes the email check', !hasEmailProblem({ ...prodBase, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'no-reply@x' }), 'blocked')
check('fully-configured production has zero problems', validateEnv({ ...prodBase, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'no-reply@x' }).length === 0, JSON.stringify(validateEnv({ ...prodBase, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'no-reply@x' })))
check('non-production sandbox email is allowed (staging/tests)', !hasEmailProblem({ ...base, SYBNB_COUNTRY: 'syria' }), 'blocked in non-prod')

console.log(`\n==== COUNTRY SELECTION E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
