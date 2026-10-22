// Variable pricing for stays (owner decision 2026-10-22: "host rules + admin seasons").
//
// Two layers, applied night by night:
//   1. HOST rules, stored on the listing (metadata.pricing):
//        weekendPriceMinor   price for a weekend night (which nights are "weekend" is set by admin)
//        weeklyDiscountPct   off the whole stay when it is 7+ nights
//        monthlyDiscountPct  off the whole stay when it is 28+ nights (replaces the weekly one)
//        seasonalOptOut      true = the admin's high-season uplifts never apply to this listing
//      A per-date price the host set in the calendar (listing_availability.priceOverrideMinor) is the
//      host's exact price for that night: it wins over the weekend price and is never uplifted.
//   2. ADMIN seasons, stored in admin_settings (category 'pricing', key 'stays_<country>'), edited
//      from the admin app like the SR pricing: weekend nights + dated high-season periods (Eid,
//      summer...) with a % uplift on the host's nightly price.
//
// Length-of-stay discounts apply once to the sum of the nights. The platform commission and the
// guest totals are computed downstream from the discounted stay total, exactly as before.
//
// The engine (priceStayNights) is pure; loading the admin config is the only I/O, cached briefly
// so quotes never wait on it. Inside a booking transaction the config is read through the same
// transaction client (never a second pooled connection -- see computeStayTotalMinor).
import { db } from './prisma.mjs'
import { activeCountryKey, stayPricingDefaults } from './country.mjs'

export const STAY_PRICING_CATEGORY = 'pricing'
export const stayPricingKey = () => `stays_${activeCountryKey()}`

export const STAY_PRICING_LIMITS = Object.freeze({
  maxSeasons: 24,
  maxSeasonUpliftPct: 100,
  maxWeeklyDiscountPct: 50,
  maxMonthlyDiscountPct: 70,
  weeklyMinNights: 7,
  monthlyMinNights: 28,
  maxSeasonDays: 366,
})

// Defaults come from the active country profile (countries/<country>/profile.mjs stayPricing):
// which nights are weekend nights (JS getUTCDay, 0 = Sunday). Admin can change them.
export const defaultStayPricing = () => stayPricingDefaults()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function clampInt(value, min, max) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null
}

// Admin config -> a safe, bounded shape. Unknown/invalid entries are dropped, not guessed.
export function normalizeStayPricingConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const weekendNights = Array.isArray(source.weekendNights)
    ? [...new Set(source.weekendNights.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [...defaultStayPricing().weekendNights]
  const seasons = (Array.isArray(source.seasons) ? source.seasons : [])
    .map((season, index) => {
      const from = validDate(season?.from)
      const to = validDate(season?.to)
      if (!from || !to || to < from) return null
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
      if (days > STAY_PRICING_LIMITS.maxSeasonDays) return null
      const upliftPct = clampInt(season?.upliftPct, 0, STAY_PRICING_LIMITS.maxSeasonUpliftPct)
      if (!upliftPct) return null
      const name = String(season?.name || '').trim().slice(0, 60) || `Season ${index + 1}`
      const id = String(season?.id || '').trim().slice(0, 40) || `s${index + 1}`
      return { id, name, from, to, upliftPct }
    })
    .filter(Boolean)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .slice(0, STAY_PRICING_LIMITS.maxSeasons)
  return { weekendNights, seasons }
}

// Host rules from listing.metadata.pricing -> a safe, bounded shape.
export function normalizeHostPricing(raw, basePriceMinor = 0) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const weekend = Math.round(Number(source.weekendPriceMinor))
  return {
    // A weekend price must be positive; at most 10x the base price guards against a typo (an extra zero is fine, three are not).
    weekendPriceMinor: Number.isFinite(weekend) && weekend > 0 && (!basePriceMinor || weekend <= basePriceMinor * 10) ? weekend : null,
    weeklyDiscountPct: clampInt(source.weeklyDiscountPct ?? 0, 0, STAY_PRICING_LIMITS.maxWeeklyDiscountPct),
    monthlyDiscountPct: clampInt(source.monthlyDiscountPct ?? 0, 0, STAY_PRICING_LIMITS.maxMonthlyDiscountPct),
    seasonalOptOut: source.seasonalOptOut === true,
  }
}

function seasonFor(date, seasons) {
  // Overlapping seasons: the highest uplift wins (never stacked).
  let best = null
  for (const season of seasons) {
    if (date >= season.from && date <= season.to && (!best || season.upliftPct > best.upliftPct)) best = season
  }
  return best
}

// Pure. nights = ['YYYY-MM-DD', ...]; overrides = Map(date -> priceMinor).
export function priceStayNights({ basePriceMinor, nights, overrides = new Map(), hostPricing, config }) {
  const host = normalizeHostPricing(hostPricing, basePriceMinor)
  const cfg = normalizeStayPricingConfig(config)
  const weekendSet = new Set(cfg.weekendNights)
  const perNight = nights.map((date) => {
    if (overrides.has(date)) return { date, priceMinor: overrides.get(date), basis: 'custom' }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    const isWeekend = weekendSet.has(weekday) && host.weekendPriceMinor != null
    const nightly = isWeekend ? host.weekendPriceMinor : basePriceMinor
    const season = host.seasonalOptOut ? null : seasonFor(date, cfg.seasons)
    if (season) {
      return { date, priceMinor: Math.round(nightly * (1 + season.upliftPct / 100)), basis: isWeekend ? 'weekend' : 'base', season: season.name, upliftPct: season.upliftPct }
    }
    return { date, priceMinor: nightly, basis: isWeekend ? 'weekend' : 'base' }
  })
  const subtotalMinor = perNight.reduce((sum, night) => sum + night.priceMinor, 0)
  let discountKind = null
  let discountPct = 0
  if (nights.length >= STAY_PRICING_LIMITS.monthlyMinNights && host.monthlyDiscountPct > 0) {
    discountKind = 'MONTHLY'
    discountPct = host.monthlyDiscountPct
  } else if (nights.length >= STAY_PRICING_LIMITS.weeklyMinNights && host.weeklyDiscountPct > 0) {
    discountKind = 'WEEKLY'
    discountPct = host.weeklyDiscountPct
  }
  const discountMinor = discountPct ? Math.round((subtotalMinor * discountPct) / 100) : 0
  return {
    perNight,
    subtotalMinor,
    discountMinor,
    discountPct,
    discountKind,
    totalMinor: subtotalMinor - discountMinor,
  }
}

// --- admin config storage (cached) ---------------------------------------------------------------
const CACHE_MS = 15_000
let cached = null
let cachedAt = 0

export async function readStoredStayPricing(client = db()) {
  return client.adminSetting.findUnique({ where: { category_key: { category: STAY_PRICING_CATEGORY, key: stayPricingKey() } } })
}

export async function getStayPricingConfig(client = db()) {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached
  try {
    const row = await readStoredStayPricing(client)
    cached = normalizeStayPricingConfig(row?.value ?? defaultStayPricing())
    cachedAt = Date.now()
  } catch (error) {
    // Fail-open to the last good config (or the defaults) -- unless we're inside a transaction,
    // where a failed statement has already aborted the transaction and must surface.
    if (client !== db()) throw error
    cached = cached || normalizeStayPricingConfig(defaultStayPricing())
    cachedAt = Date.now() - CACHE_MS + 5_000
  }
  return cached
}

export function invalidateStayPricingCache() {
  cached = null
  cachedAt = 0
}
