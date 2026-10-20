// STEP 5 e2e harness: starts the real API as a child process on a free port against the TEST
// database, creates synthetic staff users, signs them in through the REAL /api/auth/login (including
// the admin emailed-code rule), and offers a tiny HTTP client. Refuses to run against production.
process.env.AUTH_SECRET ||= 'dev-e2e-secret'
process.env.PHONE_HASH_SECRET ||= 'dev-e2e-phone'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { db } from '../../../server/lib/prisma.mjs'
import { hashPassword, hashEmail, hashOtpCode } from '../../../server/lib/security.mjs'

export function assertTestDatabase() {
  const url = process.env.DATABASE_URL || ''
  if (!url || /production/i.test(url)) {
    console.error('Refusing to run: DATABASE_URL missing or looks like production.')
    process.exit(2)
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
    s.on('error', reject)
  })
}

export async function startApi(extraEnv = {}) {
  assertTestDatabase()
  const port = await freePort()
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env, API_PORT: String(port), API_HOST: '127.0.0.1', SYBNB_COUNTRY: process.env.SYBNB_COUNTRY || 'syria',
      AUTH_SECRET: process.env.AUTH_SECRET || 'dev-e2e-secret', PHONE_HASH_SECRET: process.env.PHONE_HASH_SECRET || 'dev-e2e-phone',
      NODE_ENV: 'test', ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', (d) => { logs += d })
  child.stderr.on('data', (d) => { logs += d })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${base}/api/health/live`); if (r.ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
    if (i === 79) { child.kill(); throw new Error(`API did not start:\n${logs.slice(-1500)}`) }
  }
  return { base, child, logs: () => logs, stop: () => child.kill() }
}

export function client(base, token = null) {
  const call = async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* binary or empty */ }
    return { status: res.status, json, text, headers: res.headers }
  }
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b = {}) => call('PATCH', p, b), put: (p, b = {}) => call('PUT', p, b), delete: (p) => call('DELETE', p), call, withToken: (t) => client(base, t) }
}

export const PASSWORD = 'S5-test-password-1!'

export async function createStaffUser(label, run) {
  const p = db()
  return p.user.create({ data: { email: `s5t-${run}-${label}@example.invalid`, displayName: `S5 ${label}`, passwordHash: hashPassword(PASSWORD), status: 'ACTIVE' } })
}

/** Plant a VERIFIED single-use admin sign-in code (what POST /api/otp/verify would leave behind). */
export async function plantAdminLoginCode(user) {
  const identifierHash = hashEmail(user.email)
  await db().verificationCode.create({
    data: { identifierHash, purpose: 'admin-login', codeHash: hashOtpCode(identifierHash, 'admin-login', '000000'), status: 'VERIFIED', verifiedAt: new Date(), expiresAt: new Date(Date.now() + 600_000), channel: 'email' },
  })
}

export async function loginAsStaff(api, user) {
  await plantAdminLoginCode(user)
  const res = await client(api.base).post('/api/auth/login', { email: user.email, password: PASSWORD })
  if (res.status !== 200) throw new Error(`login failed ${res.status}: ${res.text.slice(0, 200)}`)
  return { token: res.json.token, sessionId: res.json.sessionId, http: client(api.base, res.json.token) }
}

export async function assignRole(user, roleCode, scopes, over = {}) {
  const p = db()
  const role = await p.role.findUnique({ where: { code: roleCode } })
  const rv = await p.roleVersion.findFirst({ where: { roleId: role.id, status: 'EFFECTIVE' } })
  return p.roleAssignment.create({ data: { userId: user.id, roleVersionId: rv.id, grantReason: 's5 e2e', scopes: { create: scopes }, ...over } })
}

/** Assign a SPECIFIC role version (used to prove that holders stay pinned to the version they were granted). */
export async function assignRoleVersion(user, roleCode, versionNumber, scopes, over = {}) {
  const p = db()
  const role = await p.role.findUnique({ where: { code: roleCode } })
  const rv = await p.roleVersion.findUnique({ where: { roleId_versionNumber: { roleId: role.id, versionNumber } } })
  return p.roleAssignment.create({ data: { userId: user.id, roleVersionId: rv.id, grantReason: 's5 e2e pinned', scopes: { create: scopes }, ...over } })
}

export function makeRunner() {
  let passed = 0
  const failures = []
  return {
    async t(name, fn) {
      try { await fn(); passed += 1; console.log('PASS', name) } catch (e) { failures.push(name); console.log('FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 5).join('\n    ')) }
    },
    summary() { console.log(`\n${passed} passed, ${failures.length} failed`); return failures.length },
  }
}

export { randomUUID }
