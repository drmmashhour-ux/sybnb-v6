import test from 'node:test'
import assert from 'node:assert/strict'
import { planSplitStays, nightsBetween } from '../../server/lib/split-stay.mjs'

const nights = nightsBetween('2026-12-01', '2026-12-09') // 8 nights
const set = (...n) => new Set(n.map((i) => nights[i]))
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i)

test('nightsBetween is end-exclusive', () => {
  assert.equal(nights.length, 8)
  assert.equal(nights[0], '2026-12-01')
  assert.equal(nights[7], '2026-12-08')
})

test('a single listing free for the whole range means no split is needed', () => {
  const free = new Map([['a', set(...range(0, 8))], ['b', set(0, 1)]])
  const r = planSplitStays(nights, [{ id: 'a', priceMinor: 100 }, { id: 'b', priceMinor: 50 }], free)
  assert.deepEqual(r.singles, ['a'])
  assert.deepEqual(r.pairs, [])
})

test('two listings stitch together back to back, covering every night exactly once', () => {
  const free = new Map([['a', set(...range(0, 5))], ['b', set(...range(3, 8))]])
  const r = planSplitStays(nights, [{ id: 'a', priceMinor: 100 }, { id: 'b', priceMinor: 100 }], free)
  assert.equal(r.singles.length, 0)
  assert.equal(r.pairs.length, 1)
  const p = r.pairs[0]
  assert.equal(p.firstId, 'a')
  assert.equal(p.secondId, 'b')
  assert.equal(p.firstNights + p.secondNights, 8)
  assert.ok(p.firstNights <= 5 && p.secondNights <= 5)
  assert.equal(p.estimateMinor, 800)
})

test('a gap in the middle means no pair is offered', () => {
  const free = new Map([['a', set(0, 1, 2)], ['b', set(5, 6, 7)]])
  const r = planSplitStays(nights, [{ id: 'a', priceMinor: 1 }, { id: 'b', priceMinor: 1 }], free)
  assert.deepEqual(r.pairs, [])
})

test('cheapest pair first, and a listing is never paired with itself', () => {
  const free = new Map([
    ['a', set(...range(0, 5))], ['b', set(...range(3, 8))], ['c', set(...range(3, 8))],
  ])
  const r = planSplitStays(nights, [
    { id: 'a', priceMinor: 100 }, { id: 'b', priceMinor: 300 }, { id: 'c', priceMinor: 100 },
  ], free)
  assert.equal(r.pairs[0].secondId, 'c')
  assert.ok(r.pairs.every((p) => p.firstId !== p.secondId))
})
