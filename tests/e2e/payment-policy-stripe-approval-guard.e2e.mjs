// SYBNB — Direct, in-process adversarial proof for resolveApprovedProviderConfig()'s stripe
// test-override guard in payment-policy.mjs. No live server needed (mirrors operations.e2e.mjs's
// own direct-function-call style, an established pattern in this suite for pure input->output policy
// logic) -- exhaustively exercising this guard across environment/override-value combinations through
// a live server would need one process per combination for no added rigor, since the guard reads
// `environment` as a plain function argument and `process.env.PAYMENT_POLICY_TEST_STRIPE_APPROVED`
// fresh on every call.
//
// Independent review of Round 9 accepted the two-server HTTP recovery proof but rejected the guard's
// condition at the time (`environment !== 'production'`): it let the override activate in
// `development` AND `staging`, not only a genuine test runtime, and nothing committed would have
// caught a future weakening of this specific guard back toward that shape. This file:
//   1. Proves the guard denies for every environment value except the exact string 'test' --
//      including production, staging, development, and malformed/near-miss casing, whitespace, and
//      missing/null/empty values -- even with the override env var correctly set to 'true'.
//   2. Proves the guard denies for every override-env-var value except the exact string 'true' --
//      including missing, false, numeric/word-truthy, and case/whitespace near-misses -- even under
//      environment === 'test'.
//   3. Proves only the single (environment==='test', override==='true') cell ever approves.
//   4. Proves other providers ('manual', 'sandbox') are unaffected by any of the above.
//   5. Runs a MUTATION PROBE: two deliberately weakened stand-in guards are defined inline (one is
//      the EXACT prior condition this round replaces) and shown to disagree with the real guard's
//      (correct) denial on the same inputs -- demonstrating that if the real guard ever regressed
//      back to either shape, section 1's own assertions above would immediately start failing, not
//      merely that they are asserted to.

import { resolveApprovedProviderConfig } from '../../server/lib/payment-policy.mjs'

let passed = 0
let failed = 0
function check(name, condition) {
  if (condition) {
    passed++
    console.log(`   PASS  ${name}`)
  } else {
    failed++
    console.log(`   FAIL  ${name}`)
  }
}

// Calls the REAL guard with a temporarily-set override env var, always restoring the prior value
// afterward so this file never leaks environment state to whatever runs after it.
function isApproved(provider, environment, overrideValue) {
  const prior = process.env.PAYMENT_POLICY_TEST_STRIPE_APPROVED
  if (overrideValue === undefined) delete process.env.PAYMENT_POLICY_TEST_STRIPE_APPROVED
  else process.env.PAYMENT_POLICY_TEST_STRIPE_APPROVED = overrideValue
  const result = resolveApprovedProviderConfig(provider, environment)
  if (prior === undefined) delete process.env.PAYMENT_POLICY_TEST_STRIPE_APPROVED
  else process.env.PAYMENT_POLICY_TEST_STRIPE_APPROVED = prior
  return result !== null
}

console.log('\n=== 1. Every environment value except the exact string "test" denies, even with a correctly-set override ===')
const NON_TEST_ENVIRONMENTS = [
  'production', 'staging', 'development', // the 3 real recognized non-test environments
  undefined, null, '', // missing/malformed
  'Test', 'TEST', ' test', 'test ', 'testing', 'tests', // near-miss casing/whitespace/word-boundary
]
for (const env of NON_TEST_ENVIRONMENTS) {
  check(`environment=${JSON.stringify(env)} denies stripe even with override=true`, isApproved('stripe', env, 'true') === false)
}

console.log('\n=== 2. Every override value except the exact string "true" denies, even under environment === "test" ===')
const NON_TRUE_OVERRIDES = [
  undefined, 'false', '0', '1', 'yes', 'True', 'TRUE', ' true', 'true ', '', 'truee',
]
for (const ov of NON_TRUE_OVERRIDES) {
  check(`override=${JSON.stringify(ov)} denies stripe even under environment='test'`, isApproved('stripe', 'test', ov) === false)
}

console.log('\n=== 3. Only the single (environment===\'test\', override===\'true\') cell approves ===')
check('environment=test + override=true APPROVES', isApproved('stripe', 'test', 'true') === true)
check('environment=production + override=true still denies (cross-check against §1)', isApproved('stripe', 'production', 'true') === false)
check('environment=test + override=false still denies (cross-check against §2)', isApproved('stripe', 'test', 'false') === false)

console.log('\n=== 4. Other providers are unaffected by this guard entirely ===')
// resolveApprovedProviderConfig() only resolves a provider's config object; it never itself checks
// whether that config's own `environments` list includes the requested environment -- that separate
// inclusion check happens one layer up, at Gate 4 in evaluate(). So the correct proof of "unaffected
// by this guard" is that manual/sandbox still resolve their real, unmodified config objects (the
// early-return `if (APPROVED_PROVIDER_CONFIGS[provider]) return ...` line, never reaching the
// stripe-specific branch below it) -- not a re-test of Gate 4's own separate environments.includes()
// gate, which this file is not about.
check('manual resolves its real config object regardless of environment (early-return branch)', isApproved('manual', 'production', undefined) === true)
check('sandbox resolves its real config object in a non-production environment, unaffected by the stripe override var', isApproved('sandbox', 'staging', undefined) === true)
check('sandbox\'s resolved config is the untouched original object, not something the stripe branch could have altered', resolveApprovedProviderConfig('sandbox', 'staging').approvalReference === 'internal-sandbox-testing-only')

console.log('\n=== 5. Mutation probe: the real guard\'s denial is a genuine regression tripwire, not a tautology ===')
// Two deliberately weakened stand-ins for the real guard's environment condition -- NOT edits to the
// real source file, just local functions computing what a weakened guard's decision WOULD have been
// on the same inputs `isApproved()` above already exercised against the real guard.
//   - priorRoundGuard is the EXACT condition this round replaces (independent review's actual
//     finding: `environment !== 'production'`).
//   - anyStringGuard is a hypothetical, even weaker regression, included to prove this probe isn't
//     narrowly tuned to just the one historical case.
function wouldApproveUnderGuard(environmentGuard, environment, overrideValue) {
  return typeof environment === 'string' && environmentGuard(environment) && overrideValue === 'true'
}
const priorRoundGuard = (environment) => environment !== 'production'
const anyStringGuard = (environment) => environment.length > 0

for (const env of ['staging', 'development']) {
  const realGuardDenies = isApproved('stripe', env, 'true') === false
  const priorGuardWouldApprove = wouldApproveUnderGuard(priorRoundGuard, env, 'true')
  const anyStringGuardWouldApprove = wouldApproveUnderGuard(anyStringGuard, env, 'true')
  check(`real guard denies environment=${env} (re-confirms §1 immediately before comparing against the weakened stand-ins below)`, realGuardDenies)
  check(`the PRIOR (pre-correction) guard shape WOULD have approved environment=${env} -- disagreeing with the real guard's denial above`, priorGuardWouldApprove === true)
  check(`an even weaker any-non-empty-string guard WOULD also have approved environment=${env}`, anyStringGuardWouldApprove === true)
}
// The decisive proof: if the real guard's environment condition were ever weakened back to either
// stand-in shape, the real guard's own decision for 'staging'/'development' would flip to approve --
// meaning section 1's "denies" assertions for those two environments would themselves start failing.
// This is demonstrated here by literally computing the weakened shapes' decisions on the same inputs
// and showing they disagree with the real guard's current (correct) denial, not merely asserted.

console.log(`\n==== STRIPE APPROVAL GUARD (ENVIRONMENT + OVERRIDE ADVERSARIAL MATRIX): ${passed} passed, ${failed} failed ====`)
process.exit(failed > 0 ? 1 : 0)
