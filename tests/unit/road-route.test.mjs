import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoutePoints, lookupRoadRoute, clearRoadRouteCache } from '../../server/lib/road-route.mjs'

const osrm = (coords, calls) => async (url) => {
  calls.push(String(url))
  return { ok: true, json: async () => ({ routes: [{ distance: 1200, duration: 180, geometry: { coordinates: coords } }] }) }
}

test('parseRoutePoints validates count, format and ranges', () => {
  assert.equal(parseRoutePoints('33.5,36.2'), null)
  assert.equal(parseRoutePoints('33.5,36.2;abc'), null)
  assert.equal(parseRoutePoints('95,36.2;33,36'), null)
  assert.equal(parseRoutePoints(Array(9).fill('33,36').join(';')), null)
  assert.deepEqual(parseRoutePoints('33.5,36.2;33.4,36.3'), [{ lat: 33.5, lng: 36.2 }, { lat: 33.4, lng: 36.3 }])
})

test('OSRM route is returned as lat/lng pairs and cached', async () => {
  clearRoadRouteCache()
  const calls = []
  const pts = parseRoutePoints('33.5,36.2;33.4,36.3')
  const fetchImpl = osrm([[36.2, 33.5], [36.25, 33.45], [36.3, 33.4]], calls)
  const a = await lookupRoadRoute(pts, { env: {}, fetchImpl })
  assert.equal(a.provider, 'osrm'); assert.equal(a.points.length, 3); assert.deepEqual(a.points[1], [33.45, 36.25])
  await lookupRoadRoute(pts, { env: {}, fetchImpl })
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/36\.2/)
})

test('ROUTING_OSRM_URL is honoured and a failing router yields null (no throw)', async () => {
  clearRoadRouteCache()
  const calls = []
  await lookupRoadRoute(parseRoutePoints('33.5,36.2;33.4,36.3'), { env: { ROUTING_OSRM_URL: 'http://router.local:5000/' }, fetchImpl: osrm([[36.2, 33.5], [36.3, 33.4]], calls) })
  assert.match(calls[0], /^http:\/\/router\.local:5000\/route\/v1\/driving\//)
  clearRoadRouteCache()
  const bad = await lookupRoadRoute(parseRoutePoints('33.5,36.2;33.4,36.3'), { env: {}, fetchImpl: async () => { throw new Error('down') } })
  assert.equal(bad, null)
})

test('Google is tried first when a server key is set, then falls back to OSRM', async () => {
  clearRoadRouteCache()
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    if (String(url).includes('googleapis')) return { ok: false, json: async () => ({}) }
    return { ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[36.2, 33.5], [36.3, 33.4]] } }] }) }
  }
  const r = await lookupRoadRoute(parseRoutePoints('33.5,36.2;33.4,36.3'), { env: { GOOGLE_ROUTES_API_KEY: 'k' }, fetchImpl })
  assert.equal(r.provider, 'osrm'); assert.ok(seen[0].includes('googleapis'))
})
