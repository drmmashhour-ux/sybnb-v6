import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePoints, thinPoints, MAX_BATCH_POINTS } from '../../server/lib/location-batch.mjs'

const NOW = Date.parse('2026-10-17T12:00:00Z')
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()

test('valid points are sorted oldest to newest', () => {
  const r = normalizePoints([{ lat: 33.5, lng: 36.3, at: iso(10_000) }, { lat: 33.4, lng: 36.2, at: iso(60_000) }], NOW)
  assert.deepEqual(r.map((p) => p.lat), [33.4, 33.5])
})

test('invalid coordinates, bad times, future and too-old fixes are dropped', () => {
  const r = normalizePoints([
    { lat: 91, lng: 0, at: iso(1000) }, { lat: 0, lng: 181, at: iso(1000) }, { lat: 'x', lng: 0, at: iso(1000) },
    { lat: 1, lng: 1, at: 'not a date' }, { lat: 1, lng: 1, at: new Date(NOW + 10 * 60_000).toISOString() },
    { lat: 1, lng: 1, at: iso(3 * 60 * 60_000) }, { lat: 2, lng: 2, at: iso(5000) },
  ], NOW)
  assert.equal(r.length, 1)
  assert.equal(r[0].lat, 2)
})

test('non-array input and oversize batches are safe', () => {
  assert.deepEqual(normalizePoints(null, NOW), [])
  const many = Array.from({ length: MAX_BATCH_POINTS + 50 }, (_, i) => ({ lat: 1, lng: 1, at: iso(1000 + i) }))
  assert.ok(normalizePoints(many, NOW).length <= MAX_BATCH_POINTS)
})

test('thinning keeps one point per gap and the newest when capped', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ lat: i, lng: i, at: NOW - (10 - i) * 5000 })) // every 5 s
  const thin = thinPoints(pts, 20_000, 100)
  assert.ok(thin.length < pts.length)
  for (let i = 1; i < thin.length; i++) assert.ok(thin[i].at - thin[i - 1].at >= 20_000)
  const capped = thinPoints(pts, 0, 3)
  assert.deepEqual(capped.map((p) => p.lat), [7, 8, 9])
})
