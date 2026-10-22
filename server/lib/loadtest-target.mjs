// Load-test target marker (k6 preparation). The k6 scripts in loadtest/k6 refuse to send any load
// unless GET /api/health on the target says `loadTestTarget: true`. This server only says that when
// ALL of the following hold, so production can never answer yes by accident:
//   1. LOADTEST_TARGET_ENABLED=1 is set on this service (never set it on production);
//   2. no live Stripe key is configured (sk_live_ / rk_live_), so no real card can be charged;
//   3. the connected database contains the table `loadtest_target_marker`, created by hand on the
//      staging database branch only (see loadtest/k6/README.md). Production never has it, so even a
//      misconfigured flag on production still answers false.
import { db } from './prisma.mjs'

const CACHE_MS = 60_000
let cached = { at: 0, value: false }

export function liveStripeKeyConfigured(env = process.env) {
  return [env.STRIPE_SECRET_KEY, env.STRIPE_RESTRICTED_KEY].some((k) => /^(sk|rk)_live_/.test(String(k || '')))
}

export function loadTestFlagEnabled(env = process.env) {
  return env.LOADTEST_TARGET_ENABLED === '1' && !liveStripeKeyConfigured(env)
}

export async function databaseHasLoadTestMarker(client = db()) {
  const rows = await client.$queryRawUnsafe(`select to_regclass('public.loadtest_target_marker') is not null as present`)
  return Boolean(rows?.[0]?.present)
}

export async function isLoadTestTarget() {
  if (!loadTestFlagEnabled()) return false
  if (Date.now() - cached.at < CACHE_MS) return cached.value
  let value = false
  try {
    value = await databaseHasLoadTestMarker()
  } catch {
    value = false
  }
  cached = { at: Date.now(), value }
  return value
}
