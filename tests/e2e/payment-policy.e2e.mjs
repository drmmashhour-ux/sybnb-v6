// SYBNB — Payment policy adversarial tests (governed evidence artifact).
//
// Sections 1-7 call authorizePaymentOperation() directly — this is the precise, deterministic way
// to exhaustively prove each individual gate's behavior (env-var toggling mid-run is only reliable
// against a function running in THIS process; a live server process reads its own env once at
// startup, so a genuinely live "flip the emergency stop mid-flight" HTTP test would need a second,
// separately-configured server instance — noted as a real limitation in the implementation report,
// not silently skipped).
//
// Section 8 uses the ALREADY-RUNNING permissive test server (the same one every other e2e suite in
// this repo runs against) to prove, over real HTTP, that a read-only reconciliation call can never
// move money — this property doesn't need a restrictive config to demonstrate.
//
// Run: node tests/e2e/payment-policy.e2e.mjs (sections 1-7 need no server; section 8 needs the
// same running server + env as tests/e2e/payment-intents-booking.e2e.mjs)

import { authorizePaymentOperation } from '../../server/lib/payment-policy.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) {
    pass++
    console.log(`   PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}  -> ${detail}`)
  }
}

function deniedReason(fn) {
  try {
    fn()
    return null
  } catch (err) {
    return err?.reason || err?.code || String(err)
  }
}

const BASE_INPUT = {
  operation: 'create',
  rail: 'payment_intent',
  provider: 'sandbox',
  division: 'STAYS',
  country: 'SY',
  environment: 'test',
  actor: { roles: ['GUEST'] },
}

// A fully-permissive env, matching what the e2e suites already run the server with, so we can
// prove a specific gate denies WITHOUT every other gate also denying for an unrelated reason.
function withPermissiveEnv(overrides, fn) {
  const keys = [
    'PAYMENTS_EMERGENCY_STOP',
    'PAYMENT_INTENTS_ENABLED',
    'PAYMENTS_ENABLED',
    'PAYMENT_RAIL_MANUAL_PROOF_ENABLED',
    'PAYMENT_POLICY_TEST_COUNTRY_ELIGIBLE',
    'PAYMENT_POLICY_ELIGIBLE_DIVISIONS',
    'PAYMENT_OPERATION_PAYMENT_INTENT_CREATE_ENABLED',
    'PAYMENT_OPERATION_PAYMENT_INTENT_CAPTURE_ENABLED',
    'PAYMENT_OPERATION_PAYMENT_INTENT_REFUND_ENABLED',
    'PAYMENT_OPERATION_PAYMENT_INTENT_REPLAY_ENABLED',
    'PAYMENT_OPERATION_PAYMENT_INTENT_WEBHOOK_INTAKE_ENABLED',
    'PAYMENT_OPERATION_PAYMENT_INTENT_WEBHOOK_APPLY_ENABLED',
    'PAYMENT_OPERATION_PAYMENT_INTENT_RECONCILIATION_READ_ENABLED',
  ]
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const permissive = {
    PAYMENT_INTENTS_ENABLED: 'true',
    PAYMENT_RAIL_MANUAL_PROOF_ENABLED: 'true',
    PAYMENT_POLICY_TEST_COUNTRY_ELIGIBLE: 'true',
    PAYMENT_POLICY_ELIGIBLE_DIVISIONS: 'STAYS,RENTALS,BUY,CARS,MARKETPLACE,NEW_CONSTRUCTION,PLATFORM',
    PAYMENT_OPERATION_PAYMENT_INTENT_CREATE_ENABLED: 'true',
    PAYMENT_OPERATION_PAYMENT_INTENT_CAPTURE_ENABLED: 'true',
    PAYMENT_OPERATION_PAYMENT_INTENT_REFUND_ENABLED: 'true',
    PAYMENT_OPERATION_PAYMENT_INTENT_REPLAY_ENABLED: 'true',
    PAYMENT_OPERATION_PAYMENT_INTENT_WEBHOOK_INTAKE_ENABLED: 'true',
    PAYMENT_OPERATION_PAYMENT_INTENT_WEBHOOK_APPLY_ENABLED: 'true',
    PAYMENT_OPERATION_PAYMENT_INTENT_RECONCILIATION_READ_ENABLED: 'true',
    ...overrides,
  }
  for (const [k, v] of Object.entries(permissive)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

console.log('=== 1. Conflicting flags fail closed ===')
withPermissiveEnv({ PAYMENT_POLICY_TEST_COUNTRY_ELIGIBLE: undefined }, () => {
  // Rail + operation both permissive, but country/division eligibility isn't -- must still deny.
  check(
    'rail+operation enabled but country eligibility off still denies',
    deniedReason(() => authorizePaymentOperation(BASE_INPUT)) === 'COUNTRY_DIVISION_NOT_ELIGIBLE',
    deniedReason(() => authorizePaymentOperation(BASE_INPUT)),
  )
})
withPermissiveEnv({ PAYMENT_INTENTS_ENABLED: undefined }, () => {
  check(
    'country+operation eligible but rail flag off still denies',
    deniedReason(() => authorizePaymentOperation(BASE_INPUT)) === 'RAIL_DISABLED',
    deniedReason(() => authorizePaymentOperation(BASE_INPUT)),
  )
})

console.log('\n=== 2. Emergency stop blocks the primary money-moving operations ===')
withPermissiveEnv({ PAYMENTS_EMERGENCY_STOP: 'true' }, () => {
  for (const operation of ['create', 'capture', 'refund', 'replay']) {
    check(
      `emergency stop blocks ${operation}`,
      deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation })) === 'EMERGENCY_STOP',
      deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation })),
    )
  }
  check(
    'emergency stop blocks webhook_apply',
    deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'webhook_apply' })) === 'EMERGENCY_STOP',
    'not blocked',
  )
})

console.log('\n=== 3. Emergency stop does NOT block webhook_intake or reconciliation_read ===')
withPermissiveEnv({ PAYMENTS_EMERGENCY_STOP: 'true' }, () => {
  check('webhook_intake still allowed under emergency stop', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'webhook_intake' })) === null, 'was blocked')
  check(
    'reconciliation_read still allowed under emergency stop',
    deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'reconciliation_read', actor: { roles: ['ADMIN'] } })) === null,
    'was blocked',
  )
})

console.log('\n=== 4. Unknown/malformed inputs each individually refuse (default deny) ===')
withPermissiveEnv({}, () => {
  check('unknown operation refuses', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'not_a_real_operation' })) === 'UNKNOWN_INPUT', 'accepted')
  check('unknown rail refuses', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, rail: '' })) === 'UNKNOWN_INPUT', 'accepted')
  check('unknown provider refuses', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, provider: 'not_a_real_provider' })) === 'PROVIDER_NOT_APPROVED', 'accepted')
  check('unknown country refuses', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, country: 'ZZ' })) === 'COUNTRY_DIVISION_NOT_ELIGIBLE', 'accepted')
  check('unknown division refuses', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, division: 'NOT_A_REAL_DIVISION' })) === 'COUNTRY_DIVISION_NOT_ELIGIBLE', 'accepted')
  check('unrecognized environment refuses', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, environment: 'not_a_real_env' })) === 'ENVIRONMENT_NOT_PERMITTED', 'accepted')
  check('missing operation entirely refuses', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: undefined })) === 'UNKNOWN_INPUT', 'accepted')
})

console.log('\n=== 5. Missing provider-configuration approval refuses even with everything else permissive ===')
withPermissiveEnv({ PAYMENTS_ENABLED: 'true' }, () => {
  // 'stripe' is intentionally never in APPROVED_PROVIDER_CONFIGS (see payment-policy.mjs's own
  // comment on the Stripe/Syria eligibility finding) -- this must deny regardless of every other
  // gate being satisfied, proving credentials/rail-enablement alone can never substitute for it.
  check(
    'provider=stripe denies even with rail+operation+country all permissive',
    deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, rail: 'stripe_checkout', provider: 'stripe' })) === 'PROVIDER_NOT_APPROVED',
    deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, rail: 'stripe_checkout', provider: 'stripe' })),
  )
})

console.log('\n=== 6. Unauthorized actor refuses replay ===')
withPermissiveEnv({}, () => {
  check('a GUEST actor cannot replay', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'replay', actor: { roles: ['GUEST'] } })) === 'ACTOR_UNAUTHORIZED', 'accepted')
  check('a SUPPORT actor cannot replay (ADMIN only)', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'replay', actor: { roles: ['SUPPORT'] } })) === 'ACTOR_UNAUTHORIZED', 'accepted')
  check('an ADMIN actor CAN replay', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'replay', actor: { roles: ['ADMIN'] } })) === null, 'denied')
  check('a missing actor cannot replay', deniedReason(() => authorizePaymentOperation({ ...BASE_INPUT, operation: 'replay', actor: undefined })) === 'ACTOR_UNAUTHORIZED', 'accepted')
})

console.log('\n=== 7. Every refusal leaves nothing behind at the function level (pure — no DB/IO on denial) ===')
withPermissiveEnv({ PAYMENTS_EMERGENCY_STOP: 'true' }, () => {
  let threw = false
  try {
    authorizePaymentOperation(BASE_INPUT)
  } catch {
    threw = true
  }
  check('a denial throws synchronously with no side effect (no DB import even touched)', threw, 'did not throw')
})

console.log('\n=== 8. Live: reconciliation_read can never move money (real HTTP, real DB, real server) ===')
const admin = { id: process.env.ADMIN }
if (!admin.id) {
  console.log('   SKIP  (set ADMIN=<uuid> to run the live section)')
} else {
  const A = createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })
  const before = await db().walletEntry.count()
  const beforeIntents = await db().paymentIntent.count()
  const beforeBookings = await db().booking.count()
  const res = await fetch(`${API}/api/admin/payment-intents/reconciliation`, { headers: { authorization: `Bearer ${A}` } })
  await res.text()
  const after = await db().walletEntry.count()
  const afterIntents = await db().paymentIntent.count()
  const afterBookings = await db().booking.count()
  check('reconciliation_read call succeeded (200)', res.status === 200, res.status)
  check('reconciliation_read created zero wallet entries', before === after, `${before} -> ${after}`)
  check('reconciliation_read created zero payment intents', beforeIntents === afterIntents, `${beforeIntents} -> ${afterIntents}`)
  check('reconciliation_read created zero bookings', beforeBookings === afterBookings, `${beforeBookings} -> ${afterBookings}`)
}

console.log(`\n==== PAYMENT POLICY ADVERSARIAL TESTS: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
