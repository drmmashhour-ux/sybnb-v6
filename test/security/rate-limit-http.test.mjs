import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { testApp } from '../support/testServer.mjs'

// End-to-end wiring check for F-08: confirms the RATE_LIMIT_RULES table in server/index.mjs is
// actually connected to a real route (unit/rate-limit.test.mjs already covers the limiter
// algorithm itself in isolation). Overrides the AUTH_LOGIN limit via env so this runs in
// milliseconds instead of needing 10 real requests against the production default.
describe('rate limiting wired to POST /api/auth/login', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  beforeEach(() => {
    __resetRateLimitsForTests()
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '3'
    process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS = '60000'
  })

  afterEach(() => {
    // Restore the generous test-wide default (see test/support/setup.mjs) rather than deleting
    // the override outright, so later test files aren't affected by this file's run order.
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1000'
    delete process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS
    __resetRateLimitsForTests()
  })

  it('returns 429 with a retry-after header once the per-IP limit is exceeded', async () => {
    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: 'nobody@sybnb.test', password: 'wrong-password' })

    const responses = []
    for (let i = 0; i < 4; i += 1) {
      responses.push(await attempt()) // eslint-disable-line no-await-in-loop
    }

    expect(responses[0].status).toBe(401) // invalid credentials, but under the limit
    expect(responses[1].status).toBe(401)
    expect(responses[2].status).toBe(401)
    expect(responses[3].status).toBe(429)
    expect(responses[3].body.error.code).toBe('RATE_LIMITED')
    expect(Number(responses[3].headers['retry-after'])).toBeGreaterThan(0)
  })

  it('still applies the standard security headers to a 429 response', async () => {
    let last
    for (let i = 0; i < 4; i += 1) {
      last = await request(app) // eslint-disable-line no-await-in-loop
        .post('/api/auth/login')
        .send({ email: 'nobody2@sybnb.test', password: 'wrong-password' })
    }
    expect(last.status).toBe(429)
    expect(last.headers['x-content-type-options']).toBe('nosniff')
  })

  it('an invalid RATE_LIMIT_AUTH_LOGIN_MAX env value falls back to the rule\'s coded default instead of breaking the route', async () => {
    // Regression check for the numeric-validation fix in server/lib/rate-limit.mjs: a garbage
    // override must not silently produce "no limit" (NaN comparisons) or "block everything" (0).
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = 'not-a-number'
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody3@sybnb.test', password: 'wrong-password' })
    // The rule's coded default is 10 (server/index.mjs's RATE_LIMIT_RULES) — a single request
    // must still be allowed through (401 for bad credentials), not immediately 429.
    expect(res.status).toBe(401)
  })
})

// Separate describe block: exercises TRUST_PROXY through the real HTTP pipeline (not just the
// unit-level clientIp() checks in test/unit/rate-limit.test.mjs), confirming the call-time-read
// fix actually takes effect when a request is rate-limited by IP.
describe('TRUST_PROXY is honored end-to-end when rate-limiting by IP', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  beforeEach(() => {
    __resetRateLimitsForTests()
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1'
    process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS = '60000'
  })

  afterEach(() => {
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1000'
    delete process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS
    delete process.env.TRUST_PROXY
    __resetRateLimitsForTests()
  })

  it('two different X-Forwarded-For values are NOT trusted (share one bucket) when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const first = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '1.1.1.1')
      .send({ email: 'xff-a@sybnb.test', password: 'wrong-password' })
    const second = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '2.2.2.2') // different spoofed header, but ignored -> same real socket -> same bucket
      .send({ email: 'xff-b@sybnb.test', password: 'wrong-password' })

    expect(first.status).toBe(401)
    expect(second.status).toBe(429) // both hit the same actual connection's bucket
  })

  it('two different X-Forwarded-For values ARE trusted (separate buckets) when TRUST_PROXY=1', async () => {
    process.env.TRUST_PROXY = '1'
    const first = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.10')
      .send({ email: 'xff-c@sybnb.test', password: 'wrong-password' })
    const second = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.11')
      .send({ email: 'xff-d@sybnb.test', password: 'wrong-password' })

    expect(first.status).toBe(401)
    expect(second.status).toBe(401) // independent bucket, not rate-limited despite max=1
  })
})
