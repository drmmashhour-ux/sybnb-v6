import test from 'node:test'
import assert from 'node:assert/strict'
import { readQueue, enqueueFix, clearQueue, GPS_QUEUE_MAX } from '../../src/shared/lib/gps-queue.ts'
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
test('enqueue, read, clear', () => {
  const s = mem()
  enqueueFix(s, { lat: 1, lng: 2, at: 'a' }); enqueueFix(s, { lat: 3, lng: 4, at: 'b' })
  assert.equal(readQueue(s).length, 2); clearQueue(s); assert.equal(readQueue(s).length, 0)
})
test('queue is capped, keeping newest; corrupt storage is safe', () => {
  const s = mem()
  for (let i = 0; i < GPS_QUEUE_MAX + 20; i++) enqueueFix(s, { lat: i, lng: 0, at: 't' })
  const q = readQueue(s); assert.equal(q.length, GPS_QUEUE_MAX); assert.equal(q.at(-1).lat, GPS_QUEUE_MAX + 19)
  s.setItem('sybnb.driver.gpsQueue.v1', '{bad'); assert.deepEqual(readQueue(s), [])
})
