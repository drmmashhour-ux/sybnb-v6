// STEP 5D -- security-time readiness: fail closed before the first DB clock sample and after a stale one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { syncClock, trustedNow, approxNow, securityTimeStatus, clockStatus, maxSampleAgeMs, startClockSync, SecurityTimeNotReadyError, DEFAULT_MAX_SAMPLE_AGE_MS, _resetClockForTests, _ageClockSampleForTests } from '../../server/lib/authz/clock.mjs'
import { evaluateAccess, DENY } from '../../server/lib/authz/evaluate.mjs'

const NOW = new Date('2026-10-19T12:00:00Z')
const orgIndex = { organizationsById: new Map([['org1', { id: 'org1', name: 'Org' }]]), legalEntitiesById: new Map(), businessUnitsById: new Map(), platformsById: new Map(), platformsByCode: new Map() }
const user = { id: 'u1', status: 'ACTIVE' }
const mkVersion = (codes) => ({ id: 'rv1', versionNumber: 1, status: 'EFFECTIVE', effectiveFrom: new Date('2026-01-01'), platformCoverage: ['*'], permissionCodes: codes, role: { code: 'R', status: 'ACTIVE' } })
const mkAssign = (over = {}) => ({ id: 'a1', userId: 'u1', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), effectiveTo: null, activationAt: null, revokedAt: null, platformQualifier: [], roleVersion: mkVersion(['read.thing', 'tier3.thing', 'risky.thing', 'tier4.thing']), scopes: [{ id: 's1', kind: 'ORGANIZATION', organizationId: 'org1' }], ...over })
const ev = (permission, { timeTrusted, assignments = [mkAssign()], suspensions = [], recentAuthAt = NOW } = {}) =>
  evaluateAccess({ user, permission, assignments, suspensions, resource: { type: 'thing', facts: { organizationId: 'org1' } }, context: { now: NOW, timeTrusted, session: { recentAuthAt } }, orgIndex })
const READ = { code: 'read.thing', tier: 1 }, T3 = { code: 'tier3.thing', tier: 3 }, T4 = { code: 'tier4.thing', tier: 4, highRisk: true }, RISKY = { code: 'risky.thing', tier: 2, highRisk: true }

test('before the first database sample: not ready, trustedNow throws SECURITY_TIME_NOT_READY, approxNow still works', () => {
  _resetClockForTests()
  const st = securityTimeStatus()
  assert.equal(st.ready, false); assert.equal(st.reason, 'NOT_SAMPLED'); assert.equal(st.sampleAgeMs, null)
  assert.throws(() => trustedNow(), (e) => e instanceof SecurityTimeNotReadyError && e.code === 'SECURITY_TIME_NOT_READY' && e.status === 503)
  assert.ok(Math.abs(approxNow().getTime() - Date.now()) < 50, 'harmless callers still get a best-effort time')
  assert.equal(clockStatus().ready, false)
})

test('the first sample makes security time READY; the status exposes no sensitive data', async () => {
  _resetClockForTests()
  await syncClock(null, { sample: async () => new Date(Date.now() + 2_000) })
  const st = securityTimeStatus()
  assert.equal(st.ready, true); assert.equal(st.reason, null)
  assert.ok(Math.abs(trustedNow().getTime() - Date.now() - 2_000) < 50)
  assert.deepEqual(Object.keys(st).sort(), ['maxSampleAgeMs', 'ready', 'reason', 'sampleAgeMs'])
  _resetClockForTests()
})

test('stale policy: a sample older than the maximum age is no longer trusted; resampling recovers', async () => {
  _resetClockForTests()
  await syncClock(null, { sample: async () => new Date() })
  _ageClockSampleForTests(DEFAULT_MAX_SAMPLE_AGE_MS - 1_000)
  assert.equal(securityTimeStatus().ready, true, 'inside the bound the last-known sample is still used')
  _ageClockSampleForTests(2_000)
  const st = securityTimeStatus()
  assert.equal(st.ready, false); assert.equal(st.reason, 'STALE')
  assert.throws(() => trustedNow(), /not ready/)
  await syncClock(null, { sample: async () => new Date() })
  assert.equal(securityTimeStatus().ready, true, 'recovered after resampling')
  assert.doesNotThrow(() => trustedNow())
  _resetClockForTests()
})

test('the maximum age is bounded: default 5 min, env override clamped to 30 s .. 15 min', () => {
  assert.equal(maxSampleAgeMs({}), 300_000)
  assert.equal(maxSampleAgeMs({ ADMIN_SECURITY_TIME_MAX_AGE_MS: '1' }), 30_000)
  assert.equal(maxSampleAgeMs({ ADMIN_SECURITY_TIME_MAX_AGE_MS: '99999999999' }), 900_000)
  assert.equal(maxSampleAgeMs({ ADMIN_SECURITY_TIME_MAX_AGE_MS: 'abc' }), 300_000)
})

test('startup sampler: failed first samples keep security time NOT READY and retry fast until one succeeds', async () => {
  _resetClockForTests()
  let calls = 0
  const client = { $queryRaw: async () => { calls += 1; if (calls < 3) throw new Error('db down'); return [{ t: new Date() }] } }
  const logs = []
  let readyAt = null
  const h = startClockSync(client, { intervalMs: 60_000, retryMs: 20, log: { error: (m) => logs.push(m), info: (m) => logs.push(m) }, onReady: () => { readyAt = calls } })
  await h.first
  assert.equal(securityTimeStatus().ready, false, 'still not ready after the first failure')
  for (let i = 0; i < 50 && !securityTimeStatus().ready; i += 1) await new Promise((r) => setTimeout(r, 20))
  h.stop()
  assert.equal(securityTimeStatus().ready, true); assert.equal(readyAt, 3)
  assert.ok(logs.includes('clock_sync_failed') && logs.includes('security_time_ready'))
  _resetClockForTests()
})

test('evaluator, time NOT trusted: tier >= 3, high-risk and step-up permissions fail closed with SECURITY_TIME_NOT_READY', () => {
  for (const p of [T3, T4, RISKY]) {
    const r = ev(p, { timeTrusted: false })
    assert.equal(r.decision, 'DENY'); assert.equal(r.reason, DENY.SECURITY_TIME_NOT_READY, p.code)
  }
  for (const p of [T3, T4, RISKY]) assert.equal(ev(p, { timeTrusted: true }).decision, 'ALLOW', `${p.code} allowed once time is trusted`)
})

test('evaluator, time NOT trusted: harmless reads keep working on plain assignments only', () => {
  assert.equal(ev(READ, { timeTrusted: false }).decision, 'ALLOW')
  // temporary (effectiveTo), activation-windowed and revoked grants are NOT honored without a trusted clock
  assert.equal(ev(READ, { timeTrusted: false, assignments: [mkAssign({ effectiveTo: new Date('2027-01-01') })] }).decision, 'DENY')
  assert.equal(ev(READ, { timeTrusted: false, assignments: [mkAssign({ activationAt: new Date('2026-01-01') })] }).decision, 'DENY')
  assert.equal(ev(READ, { timeTrusted: false, assignments: [mkAssign({ status: 'PENDING_ACTIVATION', approvedAt: new Date('2026-01-01'), activationAt: new Date('2026-01-01') })] }).decision, 'DENY')
  assert.equal(ev(READ, { timeTrusted: true, assignments: [mkAssign({ effectiveTo: new Date('2027-01-01') })] }).decision, 'ALLOW')
})

test('evaluator, time NOT trusted: any non-lifted suspension is treated as in force (fail closed), even one whose window has not opened', () => {
  const sus = [{ id: 's', permissionCode: 'read.thing', roleVersionId: null, effectiveFrom: new Date('2027-01-01'), effectiveTo: null, liftedAt: null }]
  assert.equal(ev(READ, { timeTrusted: true, suspensions: sus }).decision, 'ALLOW', 'trusted: not yet in force')
  assert.equal(ev(READ, { timeTrusted: false, suspensions: sus }).reason, DENY.PERMISSION_SUSPENDED)
})

test('evaluator default (no timeTrusted in context, e.g. an injected transaction clock) is trusted', () => {
  assert.equal(ev(T4, { timeTrusted: undefined }).decision, 'ALLOW')
})
