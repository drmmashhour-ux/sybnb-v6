// Loads/saves the SR pricing config (admin_settings: category 'pricing', key 'sr_<country>'). No schema change.
// Country-neutral: the active country's pack supplies the formula and defaults (see geo-adapter).
// The engine itself is pure; this file only moves the stored inputs into it. Cached for a few seconds
// so a quote never waits on the database, and an admin change is live within seconds on every instance.
import { db } from './prisma.mjs'
import { ridePricingForActiveCountry } from './geo-adapter.mjs'

export const PRICING_CATEGORY = 'pricing'
const CACHE_MS = 15_000
let loadedAt = 0
let loading = null

export const pricingKey = () => ridePricingForActiveCountry().settingKey

export async function readStoredPricing() {
  return db().adminSetting.findUnique({ where: { category_key: { category: PRICING_CATEGORY, key: pricingKey() } } })
}

// Refresh the active engine config from the database if the cache is stale. Fail-open: a database
// error keeps the last good config (or the legacy one at startup) rather than blocking a quote.
export async function refreshSrPricing({ force = false } = {}) {
  const now = Date.now()
  if (!force && now - loadedAt < CACHE_MS) return
  if (loading) return loading
  loading = (async () => {
    try {
      const row = await readStoredPricing()
      const { pack } = ridePricingForActiveCountry()
      pack.setActivePricing(row ? pack.normalizePricing(row.value) : pack.normalizePricing(null))
      loadedAt = Date.now()
    } catch {
      loadedAt = Date.now() - CACHE_MS + 5_000 // retry in 5 s
    } finally {
      loading = null
    }
  })()
  return loading
}

export function invalidateSrPricingCache() {
  loadedAt = 0
}

