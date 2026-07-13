# SYBNB V6 — Automated Test Strategy

Date: 2026-07-10 (updated same-day: test-database isolation implemented). Companion to
`SYBNB_V6_SECURITY_AUDIT_2026_07_10.md`, `SYBNB_V6_THREAT_MODEL.md`, and
`docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md` — describes the test foundation added on the
`security/sybnb-v6-predeployment` branch.

**Update:** the database-isolation gap described lower in this document (in the "No Playwright"
and "Reproducibility" sections below) has been resolved — the suite now runs against a dedicated
`sybnb_v6_test` database, never the development database. See
`docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md` for the full design and
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md` for the proof (dev-database row counts and
timestamps confirmed byte-identical before/after two full suite runs). The historical framing
below is left intact rather than rewritten, since it accurately describes the state at the time it
was written and the reasoning that led to the fix.

## Stack and why

- **Vitest** (`vitest.config.ts`) — the project already uses Vite; Vitest shares its config/module
  resolution instead of introducing a second bundler-config surface (Jest would need its own).
- **Supertest** — binds directly to the exported `http.Server` instance from `server/index.mjs`
  (never auto-listens when imported — see the `isMainModule` guard) on an ephemeral port. Tests
  exercise real HTTP request/response handling, real routing, and real middleware ordering
  (CORS → security headers → rate limiting → auth context → dispatch), not a mocked subset of it.
- **Real local Postgres**, not a mocked Prisma client. This project's own architecture leans on
  database-level guarantees (WHERE-guarded `updateMany` for optimistic concurrency, unique
  constraints, real transactions) that a mock would either have to reimplement or silently skip —
  either way defeating the point of testing them.
- **No Playwright (revised 2026-07-10, independent-review pass).** Browser-level verification to
  date has been performed via the `mcp__Claude_Preview__*` tooling during interactive development
  sessions. **Correction to the original framing of this section:** that tooling is a Claude Code
  session capability, not a repository-owned, `npm`-invocable command — another developer running
  only `git clone` + the commands in this repo cannot reproduce those checks. It does not count as
  committed CI automation and this doc previously implied otherwise. `npm run test:e2e` remains a
  documented no-op (not a broken/empty suite), but should be read as "browser regression testing
  is currently a manual, tool-assisted step outside this repository," not "covered by an
  equivalent automated suite."
  Playwright was considered for the minimum smoke list (landing, search, login, unauthorized
  host/admin access, responsive overflow, verification-status labels, legal draft badge) during
  this review pass and **deliberately deferred**, not added, for one concrete reason: this same
  review pass found that the existing 93 Vitest tests run against the shared local development
  database (name intentionally redacted — see the database-isolation finding in
  `docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md`), not an isolated test database. Adding a new
  browser-test suite that would also exercise that same shared database, before that isolation
  gap is resolved, would compound the exact problem just flagged as a release blocker rather than
  help close it. Browser
  automation is marked a **staging prerequisite**, to be added once a dedicated test database
  exists for it to run against.

## Directory layout

- `test/unit/` — pure-function and isolated-module tests with no HTTP layer: `rate-limit.mjs`'s
  algorithm, `finance-ledger.mjs`'s split math and payout-status derivation.
- `test/api/` — full-stack tests against the real server + real DB: auth, authorization/isolation,
  verification states, driver/SR ride lifecycle, messaging, wallet idempotency.
- `test/security/` — cross-cutting security properties: headers, CORS, rate-limit HTTP wiring.
- `test/support/testServer.mjs` — shared fixtures: `testApp()`, unique email/phone generators,
  test-user tracking + cleanup.
- `test/support/setup.mjs` — global Vitest setup; currently raises the login/register rate limits
  for the whole run so functional tests aren't incidentally rate-limited (rate limiting itself is
  tested deliberately, with its own narrow overrides, in `test/security/`).

`fileParallelism: false` in `vitest.config.ts`: tests share one local Postgres database via real
HTTP requests, so parallel workers would race on the same rows.

## Coverage map (Phase 5 requirement)

| Area | File(s) |
|---|---|
| Authentication | `test/api/auth.test.mjs` |
| Authorization / isolation | `test/api/authorization.test.mjs` |
| Rate limiting | `test/unit/rate-limit.test.mjs`, `test/security/rate-limit-http.test.mjs` |
| Verification states (ID document review) | `test/api/verification-states.test.mjs` |
| Booking / finance invariants | `test/unit/finance-ledger.test.mjs`, `test/api/wallet-idempotency.test.mjs` |
| Driver / SR ride | `test/api/driver-sr-ride.test.mjs` |
| Messaging | `test/api/messaging.test.mjs` |
| Headers / CORS | `test/security/headers-and-cors.test.mjs` |
| Smoke / routes | `scripts/smoke-v6.mjs`, `scripts/smoke-routes-v6.mjs` (pre-existing, restored; not Vitest — plain Node scripts run via `npm run test:smoke`) |
| Test-database safety guard | `test/unit/test-db-guard.test.mjs`, `test/security/test-db-guard-integration.test.mjs` (`npm run test:guard`) |
| Browser smoke (Chromium + WebKit) | `test/browser/smoke.spec.ts` (`npm run test:browser`) — landing, search, login/invalid-login, unauthorized host/admin routes, legal draft badge, verification-status label, keyboard nav/focus, responsive overflow at 320/390/768/1280px |

114 Vitest tests across 12 files (93 from the original test-foundation phase + 21 new
test-database-guard tests), plus 16 smoke checks (8 API + 8 route) and 15 Playwright checks per
browser project, all passing as of this phase (Playwright: 2 genuine findings left honestly
failing rather than hidden — see `docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md`'s "Browser smoke
suite" section) — see `SYBNB_V6_RELEASE_GATE.md` for the full validation matrix.

## Test-user cleanup and the audit-log constraint

Every test-created user is tracked (`trackTestUser`) and cleaned up in `afterAll` via
`cleanupTestUsers()`, which deletes dependent rows (payment proofs, ride requests, bookings,
listings) and then the user row itself — **except** for users that ever appear as
`admin_audit_logs.actorUserId` (e.g. a test admin who approved a review, or a test driver who
claimed a ride). Those rows are left in place permanently: the security-hardening order this suite
was built under explicitly prohibits audit-history deletion, and there is no cascade from
`admin_audit_logs` to `users`, so deleting such a user would require deleting their audit rows
first — exactly what's prohibited. These are harmless, clearly-identifiable (`@sybnb.test` email
domain) artifacts left behind by running the suite; there is deliberately no cleanup path for them,
automated or human-run. See `test/support/testServer.mjs` for the in-code version of this note.

## Reproducibility by another developer

The Vitest suite (`npm run test:unit` / `test:api` / `test:security` / `test:ci`) and the smoke
scripts (`npm run smoke:api` / `smoke:routes`) depend only on repository-committed `devDependencies`
(`vitest`, `supertest`, `@types/supertest`) and a reachable Postgres instance via `DATABASE_URL` —
nothing in the test invocation path calls out to Claude Code, an MCP server, or any tool outside
`npm`/`node`. Another developer with Node installed, `npm ci`, and a Postgres instance reachable at
their own `DATABASE_URL` can run the same commands and get the same pass/fail result. **This is
independent of, and does not resolve,** the database-isolation finding above: the commands are
mechanically reproducible by anyone, but currently point at whichever database `.env` names — see
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md` for why that matters before running them again.

## What is not covered

- **Real-time/webhook payment provider integration** — there is no live payment provider wired up
  in this environment; payment-proof approval is tested via the manual admin-review path only.
- **Multi-instance rate-limiter behavior** — the limiter is explicitly single-instance (see
  `SYBNB_V6_RATE_LIMIT_POLICY.md`); no test simulates a multi-process deployment.
- **Real keyboard-driven `:focus-visible` behavior — now resolved.** The original manual pass
  couldn't confirm this via script-dispatched (non-trusted) `.focus()` calls, which don't reliably
  trigger Chromium's focus-visible heuristic. `test/browser/smoke.spec.ts`'s Playwright suite uses
  `page.keyboard.press('Tab')`, a real trusted input event, and confirms a visible outline appears
  on Chromium. (On WebKit, Tab doesn't reach the button at all by default — a genuine, documented
  WebKit/Safari platform behavior, not a focus-visible-styling gap; see
  `docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md`.)
- **A genuine, newly-discovered responsive bug**: the header overflows at a 320px viewport width
  (`test/browser/smoke.spec.ts`'s responsive-overflow suite). Left failing rather than fixed — not
  one of the four accessibility repairs this phase's order authorized (skip-navigation,
  error-association, visible focus, contrast).
