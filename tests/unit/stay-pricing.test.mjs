import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SYBNB_COUNTRY = process.env.SYBNB_COUNTRY || 'syria'
const { priceStayNights, normalizeStayPricingConfig, normalizeHostPricing } = await import('../../server/lib/stay-pricing.mjs')

const nightsFrom = (start, count) =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))

// 2026-11-02 is a Monday. Thu 2026-11-05 and Fri 2026-11-06 are the Syrian weekend nights.
const config = { weekendNights: [4, 5], seasons: [] }

test('no host rules, no seasons: every night is the base price (unchanged behaviour)', () => {
  const r = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-02', 5), config })
  assert.equal(r.totalMinor, 500)
  assert.equal(r.discountMinor, 0)
  assert.ok(r.perNight.every((n) => n.basis === 'base'))
})

test('weekend price applies on the configured weekend nights only', () => {
  const r = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-02', 7), hostPricing: { weekendPriceMinor: 150 }, config })
  assert.deepEqual(r.perNight.map((n) => n.priceMinor), [100, 100, 100, 150, 150, 100, 100])
  assert.equal(r.subtotalMinor, 800)
})

test('weekly discount on 7+ nights, monthly replaces it on 28+', () => {
  const host = { weeklyDiscountPct: 10, monthlyDiscountPct: 25 }
  const six = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-02', 6), hostPricing: host, config })
  assert.equal(six.discountMinor, 0)
  const week = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-02', 7), hostPricing: host, config })
  assert.equal(week.discountKind, 'WEEKLY')
  assert.equal(week.totalMinor, 630)
  const month = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-02', 28), hostPricing: host, config })
  assert.equal(month.discountKind, 'MONTHLY')
  assert.equal(month.totalMinor, 2100)
})

test('admin season uplifts the nightly price (weekend price too), highest overlap wins, never stacked', () => {
  const cfg = { weekendNights: [4, 5], seasons: [{ name: 'Eid', from: '2026-11-04', to: '2026-11-05', upliftPct: 20 }, { name: 'Peak', from: '2026-11-05', to: '2026-11-05', upliftPct: 50 }] }
  const r = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-03', 3), hostPricing: { weekendPriceMinor: 200 }, config: cfg })
  assert.deepEqual(r.perNight.map((n) => n.priceMinor), [100, 120, 300])
  assert.equal(r.perNight[2].season, 'Peak')
})

test('host can opt out of admin seasons', () => {
  const cfg = { weekendNights: [], seasons: [{ name: 'Eid', from: '2026-11-01', to: '2026-11-30', upliftPct: 30 }] }
  const r = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-02', 2), hostPricing: { seasonalOptOut: true }, config: cfg })
  assert.equal(r.totalMinor, 200)
})

test('a per-date calendar price wins over weekend price and is never uplifted', () => {
  const cfg = { weekendNights: [4, 5], seasons: [{ name: 'Eid', from: '2026-11-01', to: '2026-11-30', upliftPct: 30 }] }
  const r = priceStayNights({ basePriceMinor: 100, nights: ['2026-11-05'], overrides: new Map([['2026-11-05', 90]]), hostPricing: { weekendPriceMinor: 200 }, config: cfg })
  assert.equal(r.totalMinor, 90)
  assert.equal(r.perNight[0].basis, 'custom')
})

test('discount applies after the per-night prices, on the whole stay', () => {
  const cfg = { weekendNights: [4, 5], seasons: [{ name: 'Summer', from: '2026-11-02', to: '2026-11-08', upliftPct: 10 }] }
  const r = priceStayNights({ basePriceMinor: 100, nights: nightsFrom('2026-11-02', 7), hostPricing: { weekendPriceMinor: 150, weeklyDiscountPct: 10 }, config: cfg })
  assert.equal(r.subtotalMinor, 880) // (5 x 110) + (2 x 165)
  assert.equal(r.discountMinor, 88)
  assert.equal(r.totalMinor, 792)
})

test('bad input is clamped or dropped, never trusted', () => {
  const host = normalizeHostPricing({ weekendPriceMinor: -5, weeklyDiscountPct: 99, monthlyDiscountPct: 'x', seasonalOptOut: 'yes' }, 100)
  assert.deepEqual(host, { weekendPriceMinor: null, weeklyDiscountPct: 50, monthlyDiscountPct: 0, seasonalOptOut: false })
  assert.equal(normalizeHostPricing({ weekendPriceMinor: 100000 }, 100).weekendPriceMinor, null) // > 10x base: a typo
  const cfg = normalizeStayPricingConfig({ weekendNights: [9, 4, 4, 'a'], seasons: [{ from: '2026-02-30', to: '2026-03-01', upliftPct: 10 }, { from: '2026-05-01', to: '2026-04-01', upliftPct: 10 }, { from: '2026-06-01', to: '2026-06-10', upliftPct: 500 }] })
  assert.deepEqual(cfg.weekendNights, [4])
  assert.equal(cfg.seasons.length, 1)
  assert.equal(cfg.seasons[0].upliftPct, 100)
})

test('country profile supplies the default weekend nights', () => {
  assert.deepEqual(normalizeStayPricingConfig(undefined).weekendNights, [4, 5])
})
