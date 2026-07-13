import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { testApp } from '../support/testServer.mjs'

describe('security headers (F-13)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  it('applies the standard header set to a public JSON route', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers['permissions-policy']).toContain('geolocation=()')
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'")
  })

  it('applies the same header set to a 401 (unauthenticated) response', async () => {
    const res = await request(app).get('/api/host/overview')

    expect(res.status).toBe(401)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })

  it('applies the same header set to a 404 response', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist')

    expect(res.status).toBe(404)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('does not set Strict-Transport-Security outside of production+FORCE_HTTPS', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['strict-transport-security']).toBeUndefined()
  })
})

describe('CORS origin handling (F-14)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  it('reflects an allowed origin back in access-control-allow-origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5180')
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5180')
  })

  it('omits access-control-allow-origin entirely for a disallowed origin (no fallback grant)', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('sets vary: origin so caches do not conflate different requesters', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5180')
    expect(res.headers.vary).toBe('origin')
  })

  it('answers a CORS preflight OPTIONS request with 204 and no body', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'http://127.0.0.1:5180')
      .set('Access-Control-Request-Method', 'POST')

    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-methods']).toContain('POST')
  })
})

describe('error responses do not leak internal details (F-15)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  it('returns a generic message for an unrouted path instead of a stack trace', async () => {
    const res = await request(app).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('rejects malformed JSON bodies with a clean 400, not a 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('content-type', 'application/json')
      .send('{not valid json')

    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
  })
})
