// API smoke test: starts the exported server on an ephemeral port (no dependency on a dev server
// already running on 3051) and hits a representative set of endpoints, checking status codes only
// (deep behavioral coverage lives in test/api and test/security — this script is the fast,
// no-database-fixture-needed "is the API basically alive and routed correctly" check).
//
// Must load .env.test before server/index.mjs's own loadEnv('.env') gets a chance to run, so
// this smoke check runs against the isolated test database like every other automated check —
// never the development database. See scripts/require-test-env.mjs.
import './require-test-env.mjs'
import { server } from '../server/index.mjs'

let failures = 0

function report(name, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL'
  if (!ok) failures += 1
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  const checks = [
    ['GET /api/health', () => fetch(`${base}/api/health`), (r) => r.status === 200],
    ['GET /api/contracts', () => fetch(`${base}/api/contracts`), (r) => r.status === 200],
    ['GET /api/listings (public)', () => fetch(`${base}/api/listings?division=STAYS`), (r) => r.status === 200],
    ['GET /api/host/overview unauthenticated -> 401', () => fetch(`${base}/api/host/overview`), (r) => r.status === 401],
    ['GET /api/admin/review-queue unauthenticated -> 401', () => fetch(`${base}/api/admin/review-queue`), (r) => r.status === 401],
    ['GET /api/driver/rides/pending unauthenticated -> 401', () => fetch(`${base}/api/driver/rides/pending`), (r) => r.status === 401],
    ['GET /api/nonexistent-route -> 404', () => fetch(`${base}/api/nonexistent-route`), (r) => r.status === 404],
    ['POST /api/auth/login missing body -> 400', () => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), (r) => r.status === 400],
  ]

  for (const [name, run, assertFn] of checks) {
    try {
      const response = await run()
      report(name, assertFn(response), `status=${response.status}`)
    } catch (error) {
      report(name, false, error.message)
    }
  }

  await new Promise((resolve) => server.close(resolve))

  console.log('')
  console.log(failures === 0 ? `All ${checks.length} API smoke checks passed.` : `${failures}/${checks.length} API smoke checks FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
