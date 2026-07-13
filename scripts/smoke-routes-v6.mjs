// Route smoke test, restoring the previously-dangling `smoke:routes` script reference.
//
// Honest scope note: SYBNB's frontend is a single-page app using hash-based client routing —
// every route (`/stays`, `/listing/:id`, `/sell/*`, `/terms`, etc.) is served the *same*
// `index.html` shell; the actual page content only exists after React renders in a browser.
// A Node script without a browser cannot meaningfully verify per-route rendered content — that
// requires the Claude Code preview browser tooling (used extensively and repeatedly throughout
// this engagement for every page listed below) or a real Playwright/browser run. This script
// verifies what a Node-only script legitimately can: that the frontend shell is served
// successfully, and that every backend route those pages depend on responds with the correct
// status code (particularly the auth-denial paths, which are the highest-value thing to catch a
// regression on automatically).
//
// Loads .env.test before server/index.mjs's own loadEnv('.env') runs — see
// scripts/require-test-env.mjs — so this runs against the isolated test database.
import './require-test-env.mjs'
import { server } from '../server/index.mjs'

let failures = 0
let skipped = 0

function report(name, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL'
  if (!ok) failures += 1
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function skip(name, reason) {
  skipped += 1
  console.log(`[SKIP] ${name} — ${reason}`)
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  const frontendUrl = process.env.SMOKE_FRONTEND_URL
  if (frontendUrl) {
    try {
      const response = await fetch(frontendUrl)
      report('Frontend shell reachable', response.status === 200, `${frontendUrl} -> ${response.status}`)
    } catch (error) {
      report('Frontend shell reachable', false, error.message)
    }
  } else {
    skip('Frontend shell reachable (landing/search/listing detail/seller wizard/legal pages)', 'SMOKE_FRONTEND_URL not set — set it to the running Vite dev/preview URL to check the shell responds; per-route content is verified via browser tooling, not this script')
  }

  const backendChecks = [
    ['Auth denial: host overview without token', () => fetch(`${base}/api/host/overview`), (r) => r.status === 401],
    ['Auth denial: driver pending rides without token', () => fetch(`${base}/api/driver/rides/pending`), (r) => r.status === 401],
    ['Auth denial: admin review-queue without token', () => fetch(`${base}/api/admin/review-queue`), (r) => r.status === 401],
    ['Auth denial: admin metrics without token', () => fetch(`${base}/api/admin/platform-metrics`), (r) => r.status === 401],
    ['Auth denial: admin payouts without token', () => fetch(`${base}/api/admin/payouts`), (r) => r.status === 401],
    ['Public: listings search reachable', () => fetch(`${base}/api/listings?division=STAYS`), (r) => r.status === 200],
    ['Public: Stripe status reachable (backs booking detail/payment)', () => fetch(`${base}/api/payments/stripe/status`), (r) => r.status === 200],
  ]

  for (const [name, run, assertFn] of backendChecks) {
    try {
      const response = await run()
      report(name, assertFn(response), `status=${response.status}`)
    } catch (error) {
      report(name, false, error.message)
    }
  }

  await new Promise((resolve) => server.close(resolve))

  console.log('')
  console.log(`${backendChecks.length + (frontendUrl ? 1 : 0)} checks run, ${skipped} skipped, ${failures} failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
