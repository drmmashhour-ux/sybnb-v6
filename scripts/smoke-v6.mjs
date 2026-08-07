// API smoke test: health + a full register -> login round-trip against a running
// V6 API. Base URL from SMOKE_BASE_URL or VITE_API_BASE_URL or API_HOST/PORT.
import { loadEnv } from '../server/lib/env.mjs'

loadEnv()

const base =
  process.env.SMOKE_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  `http://${process.env.API_HOST || '127.0.0.1'}:${process.env.API_PORT || 3051}`

function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  process.exit(1)
}

const health = await fetch(`${base}/api/health`).then((r) => r.json()).catch((e) => fail(e.message))
if (!health?.ok) fail(`health not ok: ${JSON.stringify(health)}`)

const phone = `+96390000${String(Date.now()).slice(-4)}`
const password = 'SmokeTest123!'
const register = await fetch(`${base}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'GUEST', phone, password, displayName: 'Smoke Guest' }),
}).then((r) => r.json()).catch((e) => fail(e.message))
if (!register?.ok || !register?.token) fail(`register failed: ${JSON.stringify(register)}`)

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone, password }),
}).then((r) => r.json()).catch((e) => fail(e.message))
if (!login?.ok || !login?.token) fail(`login failed: ${JSON.stringify(login)}`)

console.log(`smoke: PASS — health + register + login OK against ${base}`)
