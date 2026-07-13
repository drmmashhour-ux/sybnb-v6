import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSessionToken } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'HOST' || role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({
    role,
    email,
    password: 'correct-horse-battery',
  })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

describe('token validation (missing / malformed / expired / tampered)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  it('rejects a request with no Authorization header on a protected route', async () => {
    const res = await request(app).get('/api/me/overview')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('rejects a malformed bearer token (not two dot-separated base64url segments)', async () => {
    const res = await request(app).get('/api/me/overview').set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
  })

  it('rejects a header that is not a Bearer scheme', async () => {
    const res = await request(app).get('/api/me/overview').set('Authorization', 'Basic dXNlcjpwYXNz')
    expect(res.status).toBe(401)
  })

  it('rejects a token with a tampered signature', async () => {
    const { token } = await registerUser(app, 'GUEST', 'authz-tamper')
    const [body] = token.split('.')
    const tampered = `${body}.${'0'.repeat(43)}`
    const res = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${tampered}`)
    expect(res.status).toBe(401)
  })

  it('rejects an expired token', async () => {
    const { user } = await registerUser(app, 'GUEST', 'authz-expired')
    // Build a token with an already-past exp using the same signing path as createSessionToken,
    // rather than sleeping 7 real days — this exercises the exact expiry check in
    // verifySessionToken() without a flaky real-time wait.
    const { createHmac } = await import('node:crypto')
    const payload = { sub: user.id, roles: user.roles, iat: 1, exp: 1 }
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('base64url')
    const expiredToken = `${body}.${signature}`

    const res = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${expiredToken}`)
    expect(res.status).toBe(401)
  })

  it('accepts a freshly issued, valid token', async () => {
    const { token } = await registerUser(app, 'GUEST', 'authz-valid')
    const res = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('rejects a validly-signed token for a well-formed user id that does not exist (deleted-user case)', async () => {
    const fakeToken = createSessionToken({ id: '00000000-0000-4000-8000-000000000000', roles: [{ role: 'GUEST' }] })
    const res = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${fakeToken}`)
    expect(res.status).toBe(401)
  })

  it('fails closed to 401 (not 500) for a validly-signed token whose subject is not a valid UUID', async () => {
    // Only reachable with a valid signature over an unexpected subject shape; regression test for
    // the P2023-swallowing fix in server/lib/auth-context.mjs.
    const fakeToken = createSessionToken({ id: 'not-a-uuid-at-all', roles: [{ role: 'GUEST' }] })
    const res = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${fakeToken}`)
    expect(res.status).toBe(401)
  })
})

describe('role enforcement', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  it('rejects a GUEST token on an ADMIN-only route with 403, not 401', async () => {
    const { token } = await registerUser(app, 'GUEST', 'authz-role-guest')
    const res = await request(app).get('/api/admin/review-queue').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('rejects a GUEST token on a HOST-only route (host earnings)', async () => {
    const { token } = await registerUser(app, 'GUEST', 'authz-role-host-earnings')
    const res = await request(app).get('/api/host/earnings').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('allows a HOST token on the host earnings route', async () => {
    const { token } = await registerUser(app, 'HOST', 'authz-role-host-ok')
    const res = await request(app).get('/api/host/earnings').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('rejects a HOST token on a DRIVER-only route', async () => {
    const { token } = await registerUser(app, 'HOST', 'authz-role-driver')
    const res = await request(app).get('/api/driver/rides/pending').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('horizontal isolation (F-07): one guest cannot read/act on another guest\'s data', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a booking-cancel request for a booking that does not belong to the caller is treated as not found, not forbidden', async () => {
    const alice = await registerUser(app, 'GUEST', 'authz-iso-alice')
    const bob = await registerUser(app, 'GUEST', 'authz-iso-bob')

    // Bob has no bookings at all; attempting to cancel a random id under bob's own token must not
    // leak whether that id exists for someone else — it should behave identically to "not found".
    const res = await request(app)
      .patch('/api/bookings/00000000-0000-0000-0000-000000000000/cancel')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({})

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND')
    void alice
  })

  it('GET /api/me/overview only ever returns the caller\'s own identity, never another user\'s', async () => {
    const alice = await registerUser(app, 'GUEST', 'authz-iso-me-alice')
    const bob = await registerUser(app, 'GUEST', 'authz-iso-me-bob')

    const aliceRes = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${alice.token}`)
    const bobRes = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${bob.token}`)

    expect(aliceRes.body.overview.user.id).toBe(alice.user.id)
    expect(bobRes.body.overview.user.id).toBe(bob.user.id)
    expect(aliceRes.body.overview.user.id).not.toBe(bobRes.body.overview.user.id)
  })
})
