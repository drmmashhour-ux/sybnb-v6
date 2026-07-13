# SYBNB V6 — Security Branch Independent Review Package

Date: 2026-07-10. Branch: `security/sybnb-v6-predeployment`. **Not merged to `main`. Not deployed.**

- **Base commit:** `f4a395c87fc8d766279c1f617ffd7dad6802f8be` (`main`, unchanged)
- **Head commit:** `32c0a302d751616a1d2e3232708859d34e9bfa62`
- **Commits ahead of base:** 5
- **`main` verified unchanged:** local `main` and `origin/main` both resolve to `f4a395c...` as of this review.
- **Secure baseline tag verified unchanged:** `sybnb-v6-secure-baseline-2026-07-10` still resolves to `9de21dd...`, which dereferences to `f4a395c...` — identical to `main`.

## ✅ Update: the release blocker below is now resolved

The database-isolation gap described in this section (and classified HIGH below) has been closed
in a follow-up commit on this same branch. A dedicated `sybnb_v6_test` database, owned by a
dedicated `sybnb_v6_test_role` Postgres role, now backs every database-touching test/smoke/browser
command, enforced by a fail-closed application-level guard
(`server/lib/test-db-guard.mjs`, wired into `server/lib/prisma.mjs`'s `db()`) that refuses to
construct a database connection unless the target is unmistakably the isolated test database.
Full design, the reasoning for why Postgres-ACL-level blocking was attempted and found
ineffective, and the repeatability proof (development database confirmed byte-identical across two
full suite runs, MD5-verified row counts + unmoved timestamps) are in
`docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md`. The original finding is left intact below,
unedited, as the accurate historical record of what was found and why it mattered — only this note
was added above it.

## ✅ Round 2: independent-review findings on PR #1, and what was corrected

After the database-isolation resolution above, PR #1 was reviewed independently by the owner and
returned **REQUEST CHANGES** with 8 findings. All 8 were addressed on this same branch (no new PR,
no merge). Summary — full detail in each area's own doc:

1. **Frontend CSP overclaim** — corrected. `SYBNB_V6_THREAT_MODEL.md` (F-06) and
   `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md` previously said the API's CSP contained frontend XSS
   risk; it doesn't (the API never serves the frontend). Both corrected in place. A real frontend
   CSP now exists (`<meta>` tag in `index.html`), documented with evidence in
   `docs/security/SYBNB_V6_FRONTEND_CSP_PLAN.md` — `frame-ancestors` (impossible via `<meta>`) and
   the production `connect-src` origin (no production environment exists yet) are both classified
   EXTERNAL INFRASTRUCTURE REQUIRED / OWNER DECISION REQUIRED, not silently treated as solved.
2. **Test-role database permissions** — proven, not just asserted. `scripts/audit-test-role-
   privileges.mjs` checks role attributes, memberships, schema-create privilege, table ownership,
   every explicit table/function privilege, and — going further than a catalog check — actually
   attempts a real `INSERT` against the development `users` table inside a rolled-back transaction.
   Result: genuinely blocked by Postgres with a real permission-denied error, confirmed alongside
   the metadata checks all reporting zero privilege of any kind.
3. **`TRUST_PROXY` read at import time** — real bug, fixed. `server/lib/rate-limit.mjs` captured
   `process.env.TRUST_PROXY` in a module-level constant, before `server/index.mjs`'s own
   `loadEnv()` call had populated `process.env` from `.env` — silently ignoring a `.env`-only
   setting. Now read lazily on every call. Covered by 9 new unit tests and 2 new HTTP-level tests
   (direct connections ignoring a spoofed header vs. trusted-proxy mode honoring it, through the
   real request pipeline, not just the unit function).
4. **No numeric validation on rate-limit overrides** — fixed. A non-numeric, zero, negative, or
   non-integer `RATE_LIMIT_<NAME>_MAX`/`_WINDOW_MS` now falls back to the coded default instead of
   silently producing "no limit" (`NaN` comparisons) or "block everything" (`0`).
   `validateProductionConfig()` also now scans every configured `RATE_LIMIT_*` variable at startup
   and refuses to start in production with an invalid one. 10 new unit tests, 1 new HTTP regression
   test.
5. **Incomplete auth input validation** — fixed. Registration now enforces password
   presence/min/max length and bounds `displayName`/`firstName`/`lastName`. **A real bug was found
   and fixed in the process**: login compared the raw, un-normalized request email against the
   always-lowercased stored value — a legitimate user logging in with different letter case than
   they registered with would have been rejected as "invalid credentials." Login now normalizes
   identically to registration, rejects simultaneous email+phone as ambiguous, and requires a
   password. 12 new tests, including a regression test that would have failed against the old code.
6. **Genuine 320px header overflow** — fixed, not just documented. Root cause: `.nav-actions` had
   no wrap capability at the breakpoint that actually applies at narrow widths (a more specific,
   later `display: contents` rule that flattens it into `.top-nav`'s grid — an earlier attempted
   fix targeted the wrong, overridden rule), and a scaled logo image visually bled 26px past its
   own box. Both fixed narrowly (a new `max-width: 400px` breakpoint restoring wrap, and clipping
   the logo's transform-bleed) without hiding any navigation, changing desktop, or touching Arabic
   RTL/English LTR rendering — verified visually in both languages. Chromium: 18/18, zero
   unexplained failures (was 14/15). WebKit: 16/18 (the 2 remaining failures are the
   already-documented, genuine WebKit/Safari keyboard-navigation platform default, not this bug).
7. **Unverified migration fidelity** — actually tested, not just inferred. A real, disposable
   database had `prisma migrate deploy` run against it and its resulting schema was diff'd against
   the `db push`-built `sybnb_v6_test`. Result documented in
   `docs/testing/SYBNB_V6_MIGRATION_FIDELITY_ASSESSMENT.md`: migrations apply cleanly to a blank
   database (they aren't broken) but are missing one entire table (`listing_availability`) relative
   to the current schema, while getting `id` columns' native `uuid` type and `ride_requests`'s
   spatial indexes more physically correct than `db push`. Neither method alone is a perfect match;
   classified as a release blocker for ever using `migrate deploy` alone for a fresh
   production/staging database until that gap is closed (not attempted here — broad migration-
   history repair is out of scope for this pass).
8. **Password reset / session revocation** — unchanged, correctly still deferred. Confirmed these
   remain documented as launch-relevant, staging/production blockers (not merge blockers) in
   `SYBNB_V6_AUTH_DECISIONS_REQUIRED.md`; nothing implemented, consistent with every prior pass.

## ⚠ Original finding (historical — see resolution above)

**The 93 automated tests added on this branch run against the same database used for ordinary
local development/QA (`.env`'s `DATABASE_URL`, redacted parse: an 8-character database name at
host `127.0.0.1:5432` — full name intentionally not printed in this report). There is no
`.env.test`, no `NODE_ENV`-based env-file switching, and no test script overrides
`DATABASE_URL`.** `server/lib/env.mjs`'s `loadEnv()` unconditionally reads plain `.env` regardless
of how it's invoked. This is classified **HIGH — release blocker**. See "Test-database isolation"
below for full detail and the proposed remediation (not yet implemented, pending approval).

---

## Commits in order

| # | Hash | Subject | Files changed | +/- |
|---|---|---|---|---|
| 1 | `6fe07e8` | test: establish SYBNB automated test foundation | `package.json`, `package-lock.json`, `vitest.config.ts`, `test/support/setup.mjs`, `test/support/testServer.mjs` | +1048/-5 |
| 2 | `91e6f25` | security: add configurable abuse protection and secure headers | `.env.example`, `server/index.mjs`, `server/lib/env.mjs`, `server/lib/rate-limit.mjs`, `server/lib/security-headers.mjs` | +263/-12 |
| 3 | `acecad0` | security: strengthen validation and authorization coverage | `server/lib/auth-context.mjs`, `server/lib/responses.mjs`, `server/lib/validate.mjs`, `server/routes/auth.mjs` | +102/-9 |
| 4 | `dcd758e` | test: add mandatory Phase 5 coverage | 10 files under `test/api/`, `test/security/`, `test/unit/` | +1382/-0 |
| 5 | `32c0a30` | docs: record SYBNB security audit, threat model, and release readiness | 6 files under `docs/security/`, `scripts/smoke-v6.mjs`, `scripts/smoke-routes-v6.mjs` | +920/-0 |

All commit authorship: `drmmashhour-ux <263474322+drmmashhour-ux@users.noreply.github.com>` (GitHub
private noreply identity, per the identity-rewrite work earlier in this engagement).

## Security finding → fix mapping

| Finding | Severity | Fix location | Commit |
|---|---|---|---|
| F-08 — no rate limiting anywhere | High | `server/lib/rate-limit.mjs`, `server/index.mjs` | `91e6f25` |
| F-13 — zero security headers | High | `server/lib/security-headers.mjs`, `server/index.mjs` | `91e6f25` |
| F-14 — CORS falls back to first allowed origin | Low | `server/index.mjs` `setCors()` | `91e6f25` |
| F-15 — error exposure gated on `statusCode` instead of `expose` | Low | `server/lib/responses.mjs` `handleRouteError()` | `acecad0` |
| F-16 — no `.env.example` | Low | `.env.example` | `91e6f25` |
| F-03 — login timing side-channel | Low | `server/routes/auth.mjs` (`DUMMY_PASSWORD_HASH`) | `acecad0` |
| F-09 — no centralized input validation (partial) | Low-Medium | `server/lib/validate.mjs`, applied in `server/routes/auth.mjs` | `acecad0` |
| Production config validation (Phase 6 minimum repair) | — | `server/lib/env.mjs` `validateProductionConfig()` | `91e6f25` |
| F-18 — malformed session subject → 500 instead of 401 (found writing tests) | Low | `server/lib/auth-context.mjs` (`P2023` catch) | `acecad0` |
| F-01 — no password reset | Medium | **Deferred** — comparison only in `docs/security/SYBNB_V6_AUTH_DECISIONS_REQUIRED.md` | none |
| F-02 — no session revocation | Medium | **Deferred** — comparison only in `docs/security/SYBNB_V6_AUTH_DECISIONS_REQUIRED.md` | none |

## Test → requirement mapping

| Requirement (Phase 5) | Test file(s) | Count |
|---|---|---|
| Authentication | `test/api/auth.test.mjs` | 11 |
| Authorization / isolation / token validation | `test/api/authorization.test.mjs` | 15 |
| Rate limiting (algorithm) | `test/unit/rate-limit.test.mjs` | 9 |
| Rate limiting (HTTP wiring) | `test/security/rate-limit-http.test.mjs` | 2 |
| Verification states (ID document review) | `test/api/verification-states.test.mjs` | 10 |
| Booking/finance invariants (split math, payout status) | `test/unit/finance-ledger.test.mjs` | 12 |
| Wallet idempotency | `test/api/wallet-idempotency.test.mjs` | 2 |
| Driver / SR ride lifecycle | `test/api/driver-sr-ride.test.mjs` | 10 |
| Messaging (booking + listing threads) | `test/api/messaging.test.mjs` | 13 |
| Headers / CORS / error shape | `test/security/headers-and-cors.test.mjs` | 10 |

Total: 93 (last confirmed passing in the prior review pass on this branch — **not re-run in this
pass**, per the open database-isolation blocker; see below).

## Database changes

**None to the schema.** No new Prisma migration, no `schema.prisma` edits, no new tables/columns.
All 5 commits are application-code, test-code, and documentation only. `git diff f4a395c..HEAD --
prisma/` returns no changes.

## Migration changes

**None.** No migration files added or modified on this branch.

## Environment changes

- `.env.example` added (`91e6f25`) — placeholder values only, no real secrets. Documents the new
  variables this phase introduced: `TRUST_PROXY`, `DISABLE_RATE_LIMIT`, `NODE_ENV`, `FORCE_HTTPS`,
  plus the pre-existing `AUTH_SECRET`, `PHONE_HASH_SECRET`, `DATABASE_URL`, `CORS_ORIGIN`.
- No change to the actual `.env` file (untracked, not part of this branch).
- `validateProductionConfig()` (new, `server/lib/env.mjs`) only runs when `NODE_ENV=production` —
  zero behavior change for local/dev/test unless that variable is explicitly set.

## Financial-code changes

**None to financial logic.** `server/lib/finance-ledger.mjs` (the module containing
`bookingFinanceSplit`, `recordWalletEntry`, `approvePaymentProof`, `buildPayoutRow`) is
**untouched** by this branch — `git diff f4a395c..HEAD -- server/lib/finance-ledger.mjs` is empty.
The finance-related additions on this branch are **test-only**:
`test/unit/finance-ledger.test.mjs` (asserts existing split-math invariants) and
`test/api/wallet-idempotency.test.mjs` (asserts existing idempotency behavior). No production
financial code path changed.

## Authorization changes

Two real authorization-adjacent code changes, both narrow:
1. `server/lib/auth-context.mjs` — a validly-signed token with a malformed (non-UUID) subject now
   fails closed to `401` instead of throwing into an unhandled `500` (Prisma `P2023`). This only
   changes behavior for an edge case that requires `AUTH_SECRET` possession to reach in the first
   place (see F-18 above) — no change to who is authorized for what.
2. `server/routes/auth.mjs` — registration/login now reject unknown body fields
   (`assertNoUnknownFields`) and validate email/phone format before use. This is stricter input
   validation, not a change to the authorization model itself.

No change to `requireAuth()`, role definitions, or any route's role-gating logic.

## Known limitations (carried forward, not fixed this phase)

- **HIGH — test-database isolation not proven** (see above and the dedicated section below).
- Rate limiter is single-instance/in-memory (documented, not a defect at current deployment scale).
- Sessions remain in `sessionStorage`, not migrated to httpOnly cookies (F-06, explicitly out of
  scope per the original order).
- Password reset (F-01) and session revocation (F-02) remain unimplemented — comparison-only
  documentation added this pass in `SYBNB_V6_AUTH_DECISIONS_REQUIRED.md`.
- No skip-navigation link; no ARIA error-association anywhere in the frontend (both confirmed via
  `grep`, both platform-wide patterns, neither fixed this phase — see
  `SYBNB_V6_MANUAL_ACCESSIBILITY_CHECKLIST.md`).
- Primary CTA button contrast measures 4.39:1 against a 4.5:1 AA requirement — not fixed (brand
  color decision, out of scope without approval).
- No lint tooling configured in this repository (pre-existing, not introduced or resolved here).
- No CI pipeline found or added — `npm run test:ci` exists and passes locally (as of the prior
  pass) but nothing runs it automatically on push/PR.
- Browser-level regression testing to date has been performed via Claude Code's preview tooling,
  which is **not** repository-owned/reproducible-by-another-developer automation. Playwright was
  considered this pass and deliberately deferred (see `SYBNB_V6_TEST_STRATEGY.md`) rather than
  added, because it would add new tests against the same unisolated database flagged above —
  marked a staging prerequisite instead.

## Rollback method

Nothing on `main` requires rollback — `main` was never touched by this work (verified above). If
this branch needs to be abandoned entirely: delete the local and remote branch
(`git push origin --delete security/sybnb-v6-predeployment` — **not executed, requires separate
explicit approval**, this is a destructive remote operation). If only specific commits need
reverting after further review, standard `git revert <hash>` on this branch (not `main`) is
sufficient since nothing has been merged anywhere yet. No database rollback is needed — no schema
or migration changes exist on this branch.

---

## Reviewer checklist

- [ ] Confirm `git rev-parse main` and `git rev-parse origin/main` both equal `f4a395c87fc8d766279c1f617ffd7dad6802f8be`.
- [ ] Confirm `git status --short` on this branch is clean.
- [ ] **Resolve the test-database isolation finding before running the test suite again** — see below.
- [ ] Review `server/lib/finance-ledger.mjs` — confirm it is genuinely untouched (`git diff f4a395c..HEAD -- server/lib/finance-ledger.mjs` should be empty).
- [ ] Review booking rejection/reversal logic (`server/routes/bookings.mjs`, `originalAdminShareRecipient()` in `finance-ledger.mjs`) — confirm this branch did not alter it (it did not; review to independently confirm).
- [ ] Review the authentication timing fix (`server/routes/auth.mjs`, `DUMMY_PASSWORD_HASH`) — confirm `verifyPassword()` genuinely runs unconditionally on both the "user exists" and "no such user" paths.
- [ ] Review malformed-token handling (`server/lib/auth-context.mjs`) — confirm the `P2023` catch is scoped narrowly (only that error code) and does not swallow other Prisma errors.
- [ ] Review CORS (`server/index.mjs` `setCors()`) — confirm the header is only ever set for origins in the configured allow-list, and confirm the omit-on-disallow behavior doesn't regress the previously-working allowed-origin case.
- [ ] Review trusted-proxy and rate-limit key construction (`server/lib/rate-limit.mjs` `clientIp()`) — confirm `TRUST_PROXY` truly defaults off, and confirm `byUser` rules key on user id, not IP, when authenticated.
- [ ] Review production environment validation (`server/lib/env.mjs` `validateProductionConfig()`) — confirm it is only invoked when `NODE_ENV=production` and does not affect any other environment.
- [ ] Confirm audit-record preservation — no `admin_audit_logs` rows were deleted or altered by this branch's code or by running its tests (`test/support/testServer.mjs`'s cleanup logic explicitly excludes audit-log-referenced users; confirm this by reading the code, not by re-running tests against the shared database).
- [ ] Read `SYBNB_V6_AUTH_DECISIONS_REQUIRED.md` and make (or defer, explicitly) a decision on password reset and session revocation.
- [ ] Read `SYBNB_V6_MANUAL_ACCESSIBILITY_CHECKLIST.md` and decide whether the skip-navigation and error-association gaps block anything for this stage.
- [ ] Decide on the proposed `sybnb_v6_test` database (see below) before authorizing any further test runs.

---

## Test-database isolation — full detail

**Method used to verify without printing the connection string:** parsed `.env`'s `DATABASE_URL`
with Node's `URL` class and printed only redacted fields.

Confirmed (redacted):
- **Environment type:** local (`hostname: "127.0.0.1"`, `isLocalHost: true`) — not a remote/cloud
  host.
- **Database name:** 8 characters (redacted parse only — full name intentionally not printed, per
  this order's redaction instruction). Cross-referenced against this engagement's own history:
  the only 8-character database name ever referenced for this project's local Postgres is the one
  used throughout for manual dev/QA work, strongly indicating this is that same database, not a
  separate one.
- **It is not production.** No production environment exists for this project yet at all (confirmed
  earlier in this engagement — `validateProductionConfig()` has never been exercised against a real
  production deployment).
- **It is shared with ordinary development/QA records.** Direct evidence: querying for
  `@sybnb.test`-suffixed users after the last test run found, alongside expected test artifacts,
  pre-existing rows named `qa-seller@sybnb.test`, `qa-strguest@sybnb.test`, `qa-admin@sybnb.test`,
  `qa-host@sybnb.test` — manually-created fixtures from earlier manual QA work in this same
  database, not created by the automated suite.

Confirmed by code review (not by re-running tests, per this order's instruction):
- **Fixtures cannot modify ordinary development records.** Every test-created domain object (user,
  listing, booking, thread, message, ride request) is either freshly created within the test itself
  or accessed strictly by the id of a freshly-created row. No test query matches existing rows by
  non-unique criteria (e.g. no test queries "any listing" or "any booking" without an id filter
  scoped to that test's own fixtures). `cleanupTestUsers()` in `test/support/testServer.mjs` only
  deletes rows scoped to `createdUserIds`, populated exclusively via `trackTestUser()` calls on
  freshly-registered test accounts.
- **Parallel tests cannot collide** — `vitest.config.ts` sets `fileParallelism: false`; all test
  files run sequentially in one worker.
- **Cleanup preserves audit integrity** — `cleanupTestUsers()` explicitly excludes any user
  referenced by `admin_audit_logs.actorUserId` from deletion (see the design note in
  `test/support/testServer.mjs`), consistent with this order's prohibition on audit-history
  deletion.
- **Repeated runs should produce the same pass/fail result** — every test-created email/phone is
  generated via a fresh `Date.now()`-based run id plus an in-process counter
  (`uniqueTestEmail`/`uniqueTestPhone` in `test/support/testServer.mjs`), so no test run depends on
  state left over from a previous run. (Row-count growth over time from
  audit-log-referenced, never-deleted test users is a separate, slower-moving concern — not a
  correctness risk, but a real accumulation in a database that is also used for manual QA.)

**Residual risk not fully ruled out without live testing (which this order prohibits doing again
right now):** a manual QA session running concurrently with an automated test run shares the same
database. Email/phone uniqueness generation makes an actual collision very unlikely in practice,
but "very unlikely" is not the same guarantee as a genuinely isolated database would provide.

### Classification: HIGH — release blocker

Per this order's explicit instruction: **this is classified as a HIGH release blocker. The test
suite was not run again during this review pass.** All test-count/pass-rate figures cited in this
package and in `SYBNB_V6_RELEASE_GATE.md` reflect the **prior** run on this branch, before this
finding was identified — they are historical evidence of the code's correctness, not current
proof of a safe, isolated test environment.

### Proposed remediation (NOT implemented — requires explicit approval)

1. Create a dedicated local Postgres database with a name clearly distinguishing it as
   test-only and distinct from the existing manual-dev/QA database (exact naming left to the
   owner; not specified here to avoid implying the existing database's name).
2. Apply the same schema to it (via whatever mechanism this project's Prisma migration history
   already uses — this project's own migration history is itself non-standard, hand-applied SQL
   plus manually-maintained `schema.prisma` blocks per earlier engagement notes, not
   `prisma migrate dev`/`db push`; the test database's setup should follow that same established
   pattern rather than introducing a new one).
3. Add a `.env.test` (or equivalent) that only the test-running commands load, pointing
   `DATABASE_URL` at `sybnb_v6_test` — e.g. via a `dotenv-cli`-style prefix on the `test:*` npm
   scripts, or a small wrapper that sets `DATABASE_URL` before invoking `vitest`, without changing
   `loadEnv()`'s behavior for normal `npm run dev`/`npm run api:dev` usage.
4. Re-run the full suite once against the new database and confirm identical pass/fail results to
   the last known-good run on the shared database, before treating it as the new baseline.
5. Update `SYBNB_V6_TEST_STRATEGY.md` and `vitest.config.ts`'s comments to reflect the new,
   isolated setup.

**None of the above has been created or migrated.** This is a proposal for the owner to approve,
per this order's explicit instruction not to create or migrate it unilaterally.
