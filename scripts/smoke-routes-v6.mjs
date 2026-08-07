// Route-contract smoke: verifies the API's public surface responds with the
// expected status codes (health/contracts open, unknown 404, protected route 401).
import { loadEnv } from '../server/lib/env.mjs'

loadEnv()

const base =
  process.env.SMOKE_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  `http://${process.env.API_HOST || '127.0.0.1'}:${process.env.API_PORT || 3051}`

const cases = [
  { path: '/api/health', method: 'GET', expect: [200, 503] },
  { path: '/api/contracts', method: 'GET', expect: [200] },
  { path: '/api/does-not-exist', method: 'GET', expect: [404] },
  { path: '/api/wallet', method: 'GET', expect: [401] },
]

let failed = 0
for (const c of cases) {
  const status = await fetch(`${base}${c.path}`, { method: c.method })
    .then((r) => r.status)
    .catch(() => 0)
  const ok = c.expect.includes(status)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.method} ${c.path} -> ${status} (expected ${c.expect.join('/')})`)
  if (!ok) failed += 1
}

if (failed > 0) {
  console.error(`smoke:routes FAIL — ${failed} route(s) off-contract`)
  process.exit(1)
}
console.log('smoke:routes PASS')
