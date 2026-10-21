// Loads/saves the SR pricing config (admin_settings: category 'pricing', key 'sr'). No schema change.
// The engine itself is pure; this file only moves the stored inputs into it. Cached for a few seconds
// so a quote never waits on the database, and an admin change is live within seconds on every instance.
import { db } from './prisma.mjs'
import { normalizePricing, setActivePricing, storableConfig, legacyConfig } from '../../countries/syria/geo/sr-pricing.mjs'

export const PRICING_CATEGORY = 'pricing'
export const PRICING_KEY = 'sr'
const CACHE_MS = 15_000
let loadedAt = 0
let loading = null

export async function readStoredPricing() {
  return db().adminSetting.findUnique({ where: { category_key: { category: PRICING_CATEGORY, key: PRICING_KEY } } })
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
      setActivePricing(row ? normalizePricing(row.value) : normalizePricing(null))
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

export { normalizePricing, storableConfig, legacyConfig }
