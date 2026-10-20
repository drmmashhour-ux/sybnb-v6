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
//   2. On the REQUEST path (the evaluator, session validity, step-up window) the application cannot afford a
//      round trip per decision, so it uses trustedNow(): the application clock corrected by the measured
//      offset to the database clock (sampled at start-up and every 60 s, best round trip wins). It therefore
//      follows the database clock, not the host clock. Residual error is the round-trip jitter (milliseconds)
//      and it fails CLOSED: a grant stamped by the database a few ms "in the future" is simply denied for
//      those ms; nothing is ever allowed early because of it.
//   3. Evidence rows use dbClock() (clock_timestamp()) read under the chain lock, so the chain is monotonic.
//   4. Nothing may depend on the millisecond ordering of two clocks: continuity, bootstrap and the activation
//      worker derive their own `now` from the database inside their transaction.
//   5. A 48 h delay is never reduced by clock handling: activation_at = approved_at (database time) + delay,
//      and the evaluator compares it strictly (now >= activation_at) with no tolerance.
let offsetMs = 0
let bestRtt = Infinity
let lastSyncAt = 0
let timer = null
const STALE_MS = 5 * 60_000

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

/** Application "now" corrected to the database clock. Synchronous; see rule 2. */
export function trustedNow() {
  return new Date(Date.now() + offsetMs)
}

export function clockStatus() {
  return { offsetMs, bestRoundTripMs: Number.isFinite(bestRtt) ? bestRtt : null, lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null, stale: !lastSyncAt || Date.now() - lastSyncAt > STALE_MS }
}

/** Sample the database clock. Keeps the last few samples and uses the one with the lowest round trip. */
const samples = []
export async function syncClock(client, { sample = async () => (await client.$queryRaw`SELECT clock_timestamp() AS t`)[0].t } = {}) {
  const t0 = Date.now()
  const dbT = new Date(await sample()).getTime()
  const t1 = Date.now()
  samples.push({ rtt: t1 - t0, offset: Math.round(dbT - (t0 + t1) / 2) })
  if (samples.length > 5) samples.shift()
  const best = samples.reduce((m, x) => (x.rtt < m.rtt ? x : m))
  offsetMs = best.offset; bestRtt = best.rtt; lastSyncAt = Date.now()
  return clockStatus()
}

export function startClockSync(client, { intervalMs = 60_000, log = null } = {}) {
  const run = async () => {
    try {
      const s = await syncClock(client)
      if (Math.abs(s.offsetMs) > 2_000) log?.error?.('clock_skew_detected', { offsetMs: s.offsetMs })
    } catch (e) { log?.error?.('clock_sync_failed', { message: String(e.message || e).slice(0, 120) }) }
  }
  run()
  timer = setInterval(run, intervalMs); timer.unref()
  return { stop: () => clearInterval(timer), run }
}

/** Test hook: reset the corrector. */
export function _resetClockForTests() { offsetMs = 0; bestRtt = Infinity; lastSyncAt = 0; samples.length = 0 }
