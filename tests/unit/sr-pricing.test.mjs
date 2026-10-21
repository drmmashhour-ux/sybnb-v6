import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePricing, recommendedConfig, legacyConfig, storableConfig, deriveClassRates, DEFAULT_COSTS, SR_CATEGORIES } from '../../countries/syria/geo/sr-pricing.mjs'
import { quoteSrRide } from '../../countries/syria/geo/geocoding.mjs'

const NOON = new Date('2026-10-21T09:00:00Z') // Wednesday 12:00 Damascus
const quote = (pricing, extra = {}) => quoteSrRide({ pickup: 'a', dropoff: 'b', category: 'SR Economy', lowDataMode: true, distanceKmOverride: 5, estimatedMinutesOverride: 15, now: NOON, pricing, ...extra })

test('legacy config keeps the old fixed rates', () => {
  const cfg = normalizePricing(null)
  assert.equal(cfg.source, 'legacy')
  assert.equal(cfg.rates['SR Economy'].perKmUsd, 0.18)
  assert.equal(quote(cfg).fareMinor, 5) // 1.2 + 0.9 + 0.3 = 2.4 -> min 4 -> round up to $5
})

test('formula: Economy rates follow the cost inputs', () => {
  const r = deriveClassRates('SR Economy', DEFAULT_COSTS, { emptyKmPct: 40 })
  // vehicle: 0.085*1.4 + 0.04 + 7000*0.7/200000 + 0.01 + 0.01 = 0.2035; /0.65 empty share /0.8 platform
  assert.ok(Math.abs(r.breakdown.vehicleCostPerKm - 0.2035) < 0.001)
  assert.ok(Math.abs(r.perKmUsd - 0.391) < 0.002)
  // driver 450 / (208*60*0.6) = 0.0601 ; (+0.02 traffic) / 0.8 = 0.100
  assert.ok(Math.abs(r.perMinUsd - 0.1) < 0.002)
})

test('every +$0.10 per litre raises Economy per-km by about 1.3 cents', () => {
  const a = normalizePricing(recommendedConfig()).rates['SR Economy'].perKmUsd
  const cfg = recommendedConfig(); cfg.costs = { ...cfg.costs, fuelPriceUsdPerL: 1.5 }
  const b = normalizePricing(cfg).rates['SR Economy'].perKmUsd
  assert.ok(b > a && b - a > 0.012 && b - a < 0.022)
})

test('higher driver income raises per-minute, not per-km', () => {
  const lo = recommendedConfig(); lo.costs = { ...lo.costs, driverIncomeUsdPerMonth: 400 }
  const hi = recommendedConfig(); hi.costs = { ...hi.costs, driverIncomeUsdPerMonth: 500 }
  const l = normalizePricing(lo).rates['SR Economy'], h = normalizePricing(hi).rates['SR Economy']
  assert.ok(h.perMinUsd > l.perMinUsd)
  assert.equal(h.perKmUsd, l.perKmUsd)
})

test('night, peak and demand knobs move the fare; maintenance factor moves the rates', () => {
  const cfg = normalizePricing(recommendedConfig())
  const day = quote(cfg, { distanceKmOverride: 30, estimatedMinutesOverride: 40 })
  const night = quote(cfg, { distanceKmOverride: 30, estimatedMinutesOverride: 40, now: new Date('2026-10-21T20:30:00Z') }) // 23:30
  assert.ok(night.fareMinor > day.fareMinor)
  assert.equal(night.isNight, true)
  const surge = normalizePricing({ ...recommendedConfig(), multipliers: { ...recommendedConfig().multipliers, demand: 2 } })
  assert.ok(quote(surge, { distanceKmOverride: 30, estimatedMinutesOverride: 40 }).fareMinor >= day.fareMinor * 1.9)
  const rough = recommendedConfig(); rough.costs = { ...rough.costs, maintenanceFactor: 2 }
  assert.ok(normalizePricing(rough).rates['SR Economy'].perKmUsd > normalizePricing(recommendedConfig()).rates['SR Economy'].perKmUsd)
})

test('intercity km use the long-trip rate, Homs and Aleppo land in the study ranges', () => {
  const cfg = normalizePricing(recommendedConfig())
  const homs = quote(cfg, { distanceKmOverride: 162, estimatedMinutesOverride: undefined }).fareMinor
  const aleppo = quote(cfg, { distanceKmOverride: 355, estimatedMinutesOverride: undefined }).fareMinor
  assert.ok(homs >= 75 && homs <= 110, `homs ${homs}`)
  assert.ok(aleppo >= 160 && aleppo <= 210, `aleppo ${aleppo}`)
  const flat = recommendedConfig(); flat.intercity = { ...flat.intercity, emptyKmPct: 0 }
  assert.ok(quote(normalizePricing(flat), { distanceKmOverride: 162, estimatedMinutesOverride: undefined }).fareMinor < homs) // no empty return -> cheaper long-trip rate
})

test('safety fee per trip is added; rounding step is whole dollars', () => {
  const base = recommendedConfig()
  const none = normalizePricing({ ...base, fees: { ...base.fees, safetyFeePerTripUsd: 0, roundingUsd: 1, minChargeUsd: 0 } })
  const withFee = normalizePricing({ ...base, fees: { ...base.fees, safetyFeePerTripUsd: 2, roundingUsd: 1, minChargeUsd: 0 } })
  assert.ok(quote(withFee).fareMinor >= quote(none).fareMinor + 2)
  assert.ok(Number.isInteger(quote(normalizePricing({ ...base, fees: { ...base.fees, roundingUsd: 0.5 } })).fareMinor))
})

test('bad input is clamped: never a free or absurd fare', () => {
  const cfg = normalizePricing({ mode: 'formula', costs: { fuelPriceUsdPerL: -5, platformFeePct: 99, driverIncomeUsdPerMonth: 'abc' }, multipliers: { demand: 1000 }, fees: { roundingUsd: 0 } })
  assert.equal(cfg.costs.fuelPriceUsdPerL, DEFAULT_COSTS.fuelPriceUsdPerL)
  assert.equal(cfg.costs.platformFeePct, DEFAULT_COSTS.platformFeePct)
  assert.equal(cfg.multipliers.demand, legacyConfig().multipliers.demand)
  assert.ok(cfg.fees.roundingUsd >= 1)
  for (const c of SR_CATEGORIES) assert.ok(cfg.rates[c].perKmUsd > 0)
})

test('storable config holds inputs only; rates are re-derived on load', () => {
  const stored = storableConfig(normalizePricing(recommendedConfig()))
  assert.equal(stored.rates, undefined)
  assert.deepEqual(normalizePricing(stored).rates, normalizePricing(recommendedConfig()).rates)
})

test('minimum charge $10: a short ride never costs less, at any hour', () => {
  const cfg = normalizePricing(recommendedConfig())
  assert.equal(cfg.fees.minChargeUsd, 10)
  for (const c of SR_CATEGORIES) assert.ok(quote(cfg, { category: c, distanceKmOverride: 1, estimatedMinutesOverride: 3 }).fareMinor >= 10, c)
  const legacy = normalizePricing(null)
  assert.equal(legacy.fees.minChargeUsd, 0) // old behaviour untouched until saved
  const off = normalizePricing({ ...recommendedConfig(), fees: { ...recommendedConfig().fees, minChargeUsd: 0 } })
  assert.ok(quote(off, { distanceKmOverride: 1, estimatedMinutesOverride: 3 }).fareMinor < 10)
})

test('master reaches pricing only through the country seam: per-country key, unknown country fails closed', async () => {
  const { ridePricingForActiveCountry } = await import('../../server/lib/geo-adapter.mjs')
  const sy = ridePricingForActiveCountry({ SYBNB_COUNTRY: 'syria' })
  assert.equal(sy.settingKey, 'sr_syria')
  assert.equal(typeof sy.pack.normalizePricing, 'function')
  assert.throws(() => ridePricingForActiveCountry({ SYBNB_COUNTRY: 'lebanon' }), /not supported/)
  assert.throws(() => ridePricingForActiveCountry({}), /no country/)
})
