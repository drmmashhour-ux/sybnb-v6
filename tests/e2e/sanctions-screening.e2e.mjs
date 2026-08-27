// SYBNB — Sanctions screening gate (server/lib/sanctions.mjs) real-database test.
//
// Not a live-HTTP e2e like its siblings — this module isn't wired into any route yet (architecture
// audit follow-up, Module 2.1; see countries/<country>/profile.mjs's externalGates for why: the
// actual compliance determination is a legal/counsel review, not something this codebase decides).
// This proves the fail-closed engine itself against real Postgres, with the deterministic sandbox
// provider. Run: DATABASE_URL=<url> node tests/e2e/sanctions-screening.e2e.mjs
// Fixtures use a distinctive subjectId prefix and are deleted at the end regardless of outcome.

import { db } from '../../server/lib/prisma.mjs'
import { checkSanctionsGate, sanctionsProviderStatus } from '../../server/lib/sanctions.mjs'

let pass = 0, fail = 0
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

const SUBJECT_PREFIX = 'sanctions-gate-test'
const rid = (n) => `${SUBJECT_PREFIX}-req-${n}-${Date.now()}`

async function run() {
  console.log('=== 0. Provider status ===')
  const status = sanctionsProviderStatus()
  check('sandbox provider reports configured, non-live', status.provider === 'sandbox' && status.configured === true && status.live === false, JSON.stringify(status))

  console.log('\n=== 1. Scenario A — clean pass ===')
  const reqA = rid('clean')
  const resultA = await checkSanctionsGate({
    requestId: reqA, subjectType: 'TEST_SUBJECT', subjectId: `${SUBJECT_PREFIX}-a`,
    fullName: 'Ahmad Example', countryCode: 'SY',
  })
  check('CLEARED does not throw and returns the persisted row', resultA?.status === 'CLEARED', JSON.stringify(resultA))
  const rowA = await db().sanctionsScreeningResult.findUnique({ where: { requestId: reqA } })
  check('CLEARED result is durably persisted with matchScore 0', rowA?.status === 'CLEARED' && rowA.matchScore === 0, JSON.stringify(rowA))

  console.log('\n=== 2. Scenario B — hard match blocks and is logged ===')
  const reqB = rid('hard')
  let threwB = null
  try {
    await checkSanctionsGate({
      requestId: reqB, subjectType: 'TEST_SUBJECT', subjectId: `${SUBJECT_PREFIX}-b`,
      fullName: 'SANCTIONS_TEST_HARD_MATCH Example', countryCode: 'SY',
    })
  } catch (err) { threwB = err }
  check('HARD_MATCH throws', Boolean(threwB), 'did not throw')
  check('HARD_MATCH throws with the right code + statusCode', threwB?.code === 'SANCTIONS_HARD_MATCH' && threwB?.statusCode === 403, JSON.stringify({ code: threwB?.code, statusCode: threwB?.statusCode }))
  const rowB = await db().sanctionsScreeningResult.findUnique({ where: { requestId: reqB } })
  check('HARD_MATCH result is durably persisted (not silently dropped)', rowB?.status === 'HARD_MATCH' && rowB.matchScore === 100, JSON.stringify(rowB))

  console.log('\n=== 3. Scenario C — potential match blocks pending review ===')
  const reqC = rid('potential')
  let threwC = null
  try {
    await checkSanctionsGate({
      requestId: reqC, subjectType: 'TEST_SUBJECT', subjectId: `${SUBJECT_PREFIX}-c`,
      fullName: 'SANCTIONS_TEST_POTENTIAL_MATCH Example', countryCode: 'SY',
    })
  } catch (err) { threwC = err }
  check('POTENTIAL_MATCH throws with the right code + statusCode', threwC?.code === 'SANCTIONS_POTENTIAL_MATCH' && threwC?.statusCode === 403, JSON.stringify({ code: threwC?.code, statusCode: threwC?.statusCode }))

  console.log('\n=== 4. Scenario D — provider failure fails closed, still logged ===')
  const reqD = rid('providererr')
  let threwD = null
  try {
    await checkSanctionsGate({
      requestId: reqD, subjectType: 'TEST_SUBJECT', subjectId: `${SUBJECT_PREFIX}-d`,
      fullName: 'SANCTIONS_TEST_PROVIDER_ERROR Example', countryCode: 'SY',
    })
  } catch (err) { threwD = err }
  check('provider failure throws SANCTIONS_SYSTEM_ERROR / 503 (fail closed, not fail open)', threwD?.code === 'SANCTIONS_SYSTEM_ERROR' && threwD?.statusCode === 503, JSON.stringify({ code: threwD?.code, statusCode: threwD?.statusCode }))
  const rowD = await db().sanctionsScreeningResult.findUnique({ where: { requestId: reqD } })
  check('provider-failure result is durably persisted as SYSTEM_ERROR, not silently swallowed', rowD?.status === 'SYSTEM_ERROR', JSON.stringify(rowD))

  console.log('\n=== 5. Missing input fails closed before ever reaching the provider ===')
  let threwE = null
  try {
    await checkSanctionsGate({ requestId: rid('missing'), subjectType: '', subjectId: '', fullName: '', countryCode: '' })
  } catch (err) { threwE = err }
  check('missing required fields rejected up front (400)', threwE?.code === 'SANCTIONS_SCREENING_INPUT_INVALID' && threwE?.statusCode === 400, JSON.stringify({ code: threwE?.code, statusCode: threwE?.statusCode }))

  console.log('\n=== 6. Scenario D (concurrency) — distinct concurrent requests map to distinct rows, no cross-contamination ===')
  const reqConcurrent1 = rid('concurrent1')
  const reqConcurrent2 = rid('concurrent2')
  const [concurrent1, concurrent2] = await Promise.all([
    checkSanctionsGate({ requestId: reqConcurrent1, subjectType: 'TEST_SUBJECT', subjectId: `${SUBJECT_PREFIX}-e1`, fullName: 'Concurrent One', countryCode: 'SY' }),
    checkSanctionsGate({ requestId: reqConcurrent2, subjectType: 'TEST_SUBJECT', subjectId: `${SUBJECT_PREFIX}-e2`, fullName: 'Concurrent Two', countryCode: 'SY' }),
  ])
  check('concurrent request 1 maps to its own requestId', concurrent1.requestId === reqConcurrent1 && concurrent1.fullNameChecked === 'Concurrent One', JSON.stringify(concurrent1))
  check('concurrent request 2 maps to its own requestId, no cross-contamination', concurrent2.requestId === reqConcurrent2 && concurrent2.fullNameChecked === 'Concurrent Two', JSON.stringify(concurrent2))

  console.log('\n=== 7. requestId collision is rejected (the unique constraint is the idempotency guarantee) ===')
  let threwF = null
  try {
    await checkSanctionsGate({ requestId: reqA, subjectType: 'TEST_SUBJECT', subjectId: `${SUBJECT_PREFIX}-a-retry`, fullName: 'Ahmad Example Retry', countryCode: 'SY' })
  } catch (err) { threwF = err }
  check('reusing an already-screened requestId is rejected, not silently double-logged', Boolean(threwF) && threwF.code === 'P2002', String(threwF?.code))

  // Cleanup
  const deleted = await db().sanctionsScreeningResult.deleteMany({ where: { subjectType: 'TEST_SUBJECT', subjectId: { startsWith: SUBJECT_PREFIX } } })
  console.log(`\ncleanup: deleted ${deleted.count} test fixture rows`)

  console.log(`\n==== SANCTIONS SCREENING GATE: ${pass} passed, ${fail} failed ====`)
  process.exit(fail ? 1 : 0)
}

run().catch(async (err) => {
  console.error('FATAL', err)
  await db().sanctionsScreeningResult.deleteMany({ where: { subjectType: 'TEST_SUBJECT', subjectId: { startsWith: SUBJECT_PREFIX } } }).catch(() => {})
  process.exit(1)
})
