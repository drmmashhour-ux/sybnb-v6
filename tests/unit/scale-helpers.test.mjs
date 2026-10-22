import test from 'node:test'
import assert from 'node:assert/strict'
import { databaseUrlWithPool } from '../../server/lib/prisma.mjs'
import { errorSummary } from '../../server/lib/logger.mjs'
import { routeOf, requestStarted, requestFinished, inc, renderMetrics, metricsAuthorized } from '../../server/lib/metrics.mjs'

test('pool settings are added only when configured and never override the URL', () => {
  const base = 'postgresql://u:p@db.example:5432/app?sslmode=require'
  assert.equal(databaseUrlWithPool(base, {}), base)
  const withPool = new URL(databaseUrlWithPool(base, { DB_POOL_SIZE: '15', DB_POOL_TIMEOUT_S: '10' }))
  assert.equal(withPool.searchParams.get('connection_limit'), '15')
  assert.equal(withPool.searchParams.get('pool_timeout'), '10')
  assert.equal(withPool.searchParams.get('sslmode'), 'require')
  const explicit = 'postgresql://u:p@db.example:5432/app?connection_limit=3'
  assert.equal(new URL(databaseUrlWithPool(explicit, { DB_POOL_SIZE: '15' })).searchParams.get('connection_limit'), '3')
  assert.equal(databaseUrlWithPool('not a url', { DB_POOL_SIZE: '15' }), 'not a url')
})

test('error summaries keep machine codes visible and drop free text', () => {
  assert.equal(errorSummary({ code: 'P2024' }).errorCode, 'P2024')
  assert.equal(errorSummary({ code: 'RIDE_ALREADY_CLAIMED', statusCode: 409 }).errorCode, 'RIDE_ALREADY_CLAIMED')
  assert.equal(errorSummary({ code: 'user@example.com leaked' }).errorCode, 'UNRECOGNISED')
  assert.equal(errorSummary({}).errorCode, 'INTERNAL_ERROR')
  assert.equal(errorSummary({ message: 'secret detail' }).message, 'internal error')
})

test('metrics normalise ids out of routes and require a token', async () => {
  assert.equal(routeOf('/api/sr/rides/3b7ad7d9-152d-4ff7-bef1-59c8c2b0c5b7/claim'), '/api/sr/rides/:id/claim')
  requestStarted()
  requestFinished({ method: 'GET', pathname: '/api/sr/rides/3b7ad7d9-152d-4ff7-bef1-59c8c2b0c5b7', status: 200, durationMs: 12 })
  inc('sr_ride_requests_total', { category: 'SR Economy' })
  const text = await renderMetrics({ sr_dispatch_queue_depth: 3 })
  assert.match(text, /http_request_duration_ms_bucket\{method="GET",route="\/api\/sr\/rides\/:id",le="25"\} 1/)
  assert.match(text, /sr_ride_requests_total\{category="SR Economy"\} 1/)
  assert.match(text, /sr_dispatch_queue_depth 3/)
  assert.doesNotMatch(text, /3b7ad7d9/)
  assert.equal(metricsAuthorized({ headers: { authorization: 'Bearer x' } }, {}), false)
  assert.equal(metricsAuthorized({ headers: { authorization: 'Bearer 0123456789abcdef' } }, { METRICS_TOKEN: '0123456789abcdef' }), true)
  assert.equal(metricsAuthorized({ headers: {} }, { METRICS_TOKEN: '0123456789abcdef' }), false)
})
