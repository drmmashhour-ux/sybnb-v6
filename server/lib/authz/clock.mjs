// STEP 5C -- TRUSTED TIME POLICY (decision: the DATABASE CLOCK is authoritative for security state).
//
// Problem found in 5B: a row stamped by a Postgres default (now()) and compared against the application's
// new Date() can differ by milliseconds (or seconds on a drifting host), which made a freshly written grant
// "not yet effective" inside the same transaction.
//
// Rules (apply to every authorization decision and every security-state transition):
//   1. INSIDE a transaction that changes security state, read ONE timestamp with dbNow(tx) (= Postgres now(),
//      fixed for the whole transaction) and use it for every comparison AND every written timestamp
//      (effective_from, activation_at, approved_at, reviewed_at, revoked_at, reactivated_at, ...). Never mix
//      it with new Date() / Date.now() in the same decision, and never rely on a column DEFAULT now().
//   2. (5D: strict) On the REQUEST path (the evaluator, session validity, step-up window) the application cannot afford a
//      round trip per decision, so it uses trustedNow(): the application clock corrected by the measured
//      offset to the database clock (sampled at start-up and every 60 s, best round trip wins). It therefore
//      follows the database clock, not the host clock. Residual error is the round-trip jitter (milliseconds)
//      and it fails CLOSED: a grant stamped by the database a few ms "in the future" is simply denied for
//      those ms; nothing is ever allowed early because of it.
//      5D: until the FIRST database sample exists, and whenever the newest sample is older than
//      MAX_SAMPLE_AGE_MS, the corrector is NOT trusted: trustedNow() throws SECURITY_TIME_NOT_READY and the
//      evaluator denies every time-sensitive permission (tier >= 3, high-risk, step-up, activation/effective
//      windows) with SECURITY_TIME_NOT_READY. Harmless reads (tier <= 2) keep working on plain, open-ended,
//      already-ACTIVE assignments using approxNow() (best effort, never used for a privileged decision).
//      A zero offset is never silently used for privileged authorization.
//   3. Evidence rows use dbClock() (clock_timestamp()) read under the chain lock, so the chain is monotonic.
//   4. Nothing may depend on the millisecond ordering of two clocks: continuity, bootstrap and the activation
//      worker derive their own `now` from the database inside their transaction.
//   5. A 48 h delay is never reduced by clock handling: activation_at = approved_at (database time) + delay,
//      and the evaluator compares it strictly (now >= activation_at) with no tolerance.
let offsetMs = 0
let bestRtt = Infinity
let lastSyncAt = 0
let timer = null

// Maximum age of the last database clock sample that may still be used for privileged decisions.
// Resample interval is 60 s, so 5 minutes tolerates ~4 missed samples (a DB blip) while bounding drift error:
// even a 100 ppm host-clock drift accumulates only ~30 ms in 5 minutes. Override with
// ADMIN_SECURITY_TIME_MAX_AGE_MS, clamped to 30 s .. 15 min (never unbounded).
export const DEFAULT_MAX_SAMPLE_AGE_MS = 5 * 60_000
export function maxSampleAgeMs(env = process.env) {
  const n = Number(env.ADMIN_SECURITY_TIME_MAX_AGE_MS)
  if (!Number.isFinite(n)) return DEFAULT_MAX_SAMPLE_AGE_MS
  return Math.min(15 * 60_000, Math.max(30_000, Math.round(n)))
}

export class SecurityTimeNotReadyError extends Error {
  constructor(reason) {
    super('Security time is not ready.')
    this.name = 'SecurityTimeNotReadyError'
    this.status = 503
    this.code = 'SECURITY_TIME_NOT_READY'
    this.expose = true
    this.reason = reason
  }
}

/** Database transaction time (stable for the whole transaction). Use inside $transaction callbacks. */
export async function dbNow(client) {
  const rows = await client.$queryRaw`SELECT now() AS t`
  return new Date(rows[0].t)
}

/** Database wall clock at this instant (not transaction-stable). Used for the evidence chain. */
export async function dbClock(client) {
  const rows = await client.$queryRaw`SELECT clock_timestamp() AS t`
  return new Date(rows[0].t)
}

/** READY only after a first database sample, and only while that sample is younger than the max age. No sensitive data. */
export function securityTimeStatus(nowMs = Date.now()) {
  const max = maxSampleAgeMs()
  if (!lastSyncAt) return { ready: false, reason: 'NOT_SAMPLED', sampleAgeMs: null, maxSampleAgeMs: max }
  const age = Math.max(0, nowMs - lastSyncAt)
  if (age > max) return { ready: false, reason: 'STALE', sampleAgeMs: age, maxSampleAgeMs: max }
  return { ready: true, reason: null, sampleAgeMs: age, maxSampleAgeMs: max }
}

/**
 * STRICT trusted time for privileged / time-sensitive decisions: the application clock corrected to the
 * database clock. Throws SECURITY_TIME_NOT_READY (fail closed) before the first sample or once it is stale.
 */
export function trustedNow() {
  const st = securityTimeStatus()
  if (!st.ready) throw new SecurityTimeNotReadyError(st.reason)
  return new Date(Date.now() + offsetMs)
}

/**
 * Best-effort time (offset applied if one is known, else the host clock). NEVER use it to allow a privileged or
 * time-windowed action; it is for harmless reads, display, cache expiry and housekeeping.
 */
export function approxNow() {
  return new Date(Date.now() + offsetMs)
}

export function clockStatus() {
  const st = securityTimeStatus()
  return { offsetMs, bestRoundTripMs: Number.isFinite(bestRtt) ? bestRtt : null, lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null, stale: !st.ready, ready: st.ready, reason: st.reason, sampleAgeMs: st.sampleAgeMs, maxSampleAgeMs: st.maxSampleAgeMs }
}

/** Sample the database clock. Keeps the last few samples and uses the one with the lowest round trip. */
const samples = []
export async function syncClock(client, { sample = async () => (await client.$queryRaw`SELECT clock_timestamp() AS t`)[0].t } = {}) {
  const t0 = Date.now()
  const dbT = new Date(await sample()).getTime()
  const t1 = Date.now()
  samples.push({ rtt: t1 - t0, offset: Math.round(dbT - (t0 + t1) / 2), at: t1 })
  if (samples.length > 5) samples.shift()
  // Only samples younger than the max age may contribute (an old low-RTT sample must not pin a drifted offset).
  const fresh = samples.filter((x) => t1 - x.at <= maxSampleAgeMs())
  const best = (fresh.length ? fresh : [samples[samples.length - 1]]).reduce((m, x) => (x.rtt < m.rtt ? x : m))
  offsetMs = best.offset; bestRtt = best.rtt; lastSyncAt = Date.now()
  return clockStatus()
}

/**
 * Start-up + periodic sampling. Until the first sample succeeds the security time stays NOT READY and the
 * sampler retries quickly (retryMs) rather than waiting a full interval. `onReady` fires once.
 */
export function startClockSync(client, { intervalMs = 60_000, retryMs = 2_000, log = null, onReady = null } = {}) {
  let stopped = false
  let announced = false
  let retry = null
  const run = async () => {
    try {
      const s = await syncClock(client)
      if (Math.abs(s.offsetMs) > 2_000) log?.error?.('clock_skew_detected', { offsetMs: s.offsetMs })
      if (!announced) { announced = true; log?.info?.('security_time_ready', { offsetMs: s.offsetMs, roundTripMs: s.bestRoundTripMs }); onReady?.(s) }
    } catch (e) {
      log?.error?.('clock_sync_failed', { message: String(e.message || e).slice(0, 120), securityTimeReady: securityTimeStatus().ready })
      if (!stopped && !securityTimeStatus().ready) { clearTimeout(retry); retry = setTimeout(run, retryMs); retry.unref?.() }
    }
  }
  const first = run()
  timer = setInterval(run, intervalMs); timer.unref()
  return { stop: () => { stopped = true; clearInterval(timer); clearTimeout(retry) }, run, first }
}

/** Test hooks. */
export function _resetClockForTests() { offsetMs = 0; bestRtt = Infinity; lastSyncAt = 0; samples.length = 0 }
/** Age the newest sample by `ms` (simulates a clock-sync outage without waiting). */
export function _ageClockSampleForTests(ms) { if (lastSyncAt) lastSyncAt -= ms }
