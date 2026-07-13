import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

describe('POST /api/auth/register', () => {
  let app

  beforeAll(() => {
    app = testApp()
    __resetRateLimitsForTests()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('creates a GUEST account with a valid email + password, after verifying the email code', async () => {
    const email = uniqueTestEmail('register-ok')
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
      displayName: 'Test Guest',
    })

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.user.email).toBe(email)
    expect(res.body.user.roles).toContain('GUEST')
    expect(typeof res.body.token).toBe('string')
    trackTestUser(res.body.user.id)
  })

  it('rejects a GUEST registration whose email was never verified (F-EMAIL-01)', async () => {
    const email = uniqueTestEmail('register-unverified')
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('rejects a role that cannot be self-registered', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'ADMIN',
      email: uniqueTestEmail('register-admin'),
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ROLE_REGISTRATION_FORBIDDEN')
  })

  it('rejects a malformed email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: 'not-an-email',
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_INVALID_EMAIL')
  })

  it('rejects an unknown field in the request body (F-09 defense-in-depth)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: uniqueTestEmail('register-unknown-field'),
      password: 'correct-horse-battery',
      isAdmin: true,
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_UNKNOWN_FIELDS')
  })

  it('rejects a password shorter than the minimum', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: uniqueTestEmail('register-short-password'),
      password: 'short1',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_PASSWORD_TOO_SHORT')
  })

  it('rejects a password longer than the maximum', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: uniqueTestEmail('register-long-password'),
      password: 'x'.repeat(257),
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_PASSWORD_TOO_LONG')
  })

  it('rejects a missing password', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: uniqueTestEmail('register-no-password'),
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_PASSWORD_REQUIRED')
  })

  it('rejects a displayName over the length bound', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: uniqueTestEmail('register-long-name'),
      password: 'correct-horse-battery',
      displayName: 'x'.repeat(121),
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_TOO_LONG')
  })

  it('falls back to a combined firstName + lastName as displayName when no explicit displayName is given', async () => {
    const email = uniqueTestEmail('register-first-last')
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
      firstName: 'Layla',
      lastName: 'Haddad',
    })

    expect(res.status).toBe(201)
    expect(res.body.user.displayName).toBe('Layla Haddad')
    trackTestUser(res.body.user.id)
  })

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueTestEmail('register-dup')
    await verifyEmailForTest(app, email)
    const first = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
    })
    trackTestUser(first.body.user.id)

    const second = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'a-different-password',
    })

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('ACCOUNT_ALREADY_EXISTS')
  })
})

describe('POST /api/auth/login', () => {
  let app
  let registeredEmail

  beforeAll(async () => {
    app = testApp()
    __resetRateLimitsForTests()

    registeredEmail = uniqueTestEmail('login-target')
    await verifyEmailForTest(app, registeredEmail)
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: registeredEmail,
      password: 'correct-horse-battery',
    })
    trackTestUser(res.body.user.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: registeredEmail,
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.token).toBe('string')
  })

  it('rejects a wrong password with a generic 401', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: registeredEmail,
      password: 'totally-wrong',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a nonexistent account with the identical status/code as a wrong password (F-03)', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: uniqueTestEmail('login-nonexistent'),
      password: 'irrelevant-password',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(res.body.error.message).toBe('Invalid login credentials.')
  })

  it('rejects a request with neither email nor phone', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'irrelevant-password' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('LOGIN_IDENTIFIER_REQUIRED')
  })

  it('rejects an unknown field in the login body', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: registeredEmail,
      password: 'correct-horse-battery',
      rememberMe: true,
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_UNKNOWN_FIELDS')
  })

  it('rejects GET on the login route with 405', async () => {
    const res = await request(app).get('/api/auth/login')
    expect(res.status).toBe(405)
    expect(res.headers.allow).toContain('POST')
  })

  it('logs in successfully with a different letter-case email than was registered (regression: login now normalizes like registration)', async () => {
    const mixedCaseEmail = registeredEmail
      .split('')
      .map((char, i) => (i % 2 === 0 ? char.toUpperCase() : char))
      .join('')
    expect(mixedCaseEmail).not.toBe(registeredEmail) // sanity: the transform actually changed something
    expect(mixedCaseEmail.toLowerCase()).toBe(registeredEmail) // ...but is still the same address

    const res = await request(app).post('/api/auth/login').send({
      email: mixedCaseEmail,
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('rejects a login request supplying both email and phone as ambiguous', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: registeredEmail,
      phone: '+963900000000',
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('LOGIN_IDENTIFIER_AMBIGUOUS')
  })

  it('rejects a missing password at login', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: registeredEmail })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_PASSWORD_REQUIRED')
  })

  it('rejects a malformed email at login before ever touching the database (same error for any account)', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'not-an-email',
      password: 'irrelevant-password',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_INVALID_EMAIL')
  })
})

describe('POST /api/auth/logout (F-02 session revocation)', () => {
  let app

  beforeAll(() => {
    app = testApp()
    __resetRateLimitsForTests()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerAndLogin() {
    const email = uniqueTestEmail('logout')
    await verifyEmailForTest(app, email)
    const registerRes = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
    })
    trackTestUser(registerRes.body.user.id)
    return { email, token: registerRes.body.token }
  }

  it('a token works for authenticated requests before logout', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app).get('/api/me/overview').set('authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('the same token is rejected after logout, even though it has not expired (F-02)', async () => {
    const { token } = await registerAndLogin()

    const logoutRes = await request(app).post('/api/auth/logout').set('authorization', `Bearer ${token}`)
    expect(logoutRes.status).toBe(200)
    expect(logoutRes.body.ok).toBe(true)

    const res = await request(app).get('/api/me/overview').set('authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('a new login after logout issues a fresh, working token', async () => {
    const { email, token } = await registerAndLogin()
    await request(app).post('/api/auth/logout').set('authorization', `Bearer ${token}`)

    const loginRes = await request(app).post('/api/auth/login').send({
      email,
      password: 'correct-horse-battery',
    })
    expect(loginRes.status).toBe(200)

    const res = await request(app).get('/api/me/overview').set('authorization', `Bearer ${loginRes.body.token}`)
    expect(res.status).toBe(200)
  })

  it('rejects logout without a token', async () => {
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('rejects GET on the logout route with 405', async () => {
    const res = await request(app).get('/api/auth/logout')
    expect(res.status).toBe(405)
    expect(res.headers.allow).toContain('POST')
  })
})

describe('POST /api/auth/password-reset also revokes existing sessions (F-02)', () => {
  let app

  beforeAll(() => {
    app = testApp()
    __resetRateLimitsForTests()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a token issued before a password reset stops working after the reset', async () => {
    const email = uniqueTestEmail('reset-revoke')
    await verifyEmailForTest(app, email)
    const registerRes = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'original-password-1',
    })
    trackTestUser(registerRes.body.user.id)
    const oldToken = registerRes.body.token

    const preCheck = await request(app).get('/api/me/overview').set('authorization', `Bearer ${oldToken}`)
    expect(preCheck.status).toBe(200)

    await verifyEmailForTest(app, email, 'password-reset')
    const resetRes = await request(app).post('/api/auth/password-reset').send({
      email,
      newPassword: 'new-password-2',
    })
    expect(resetRes.status).toBe(200)
    expect(resetRes.body.ok).toBe(true)

    const postCheck = await request(app).get('/api/me/overview').set('authorization', `Bearer ${oldToken}`)
    expect(postCheck.status).toBe(401)
    expect(postCheck.body.error.code).toBe('AUTH_REQUIRED')

    const loginRes = await request(app).post('/api/auth/login').send({
      email,
      password: 'new-password-2',
    })
    expect(loginRes.status).toBe(200)
  })
})
