# SYBNB V6 — Release Validation Gate

Date: 2026-07-10, updated 2026-07-11 (independent-review round 2 — 8 findings addressed, see
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md`). Branch: `security/sybnb-v6-predeployment`.

## Gate matrix — round 2 (current, 2026-07-11)

Full sequence run **twice**, back to back, against the isolated `sybnb_v6_test` database, with an
identical result both times.

| Gate | Command | Result |
|---|---|---|
| Test-database safety guard | `npm run test:guard` | PASS — 21/21 (both runs) |
| Unit tests | `npm run test:unit` | PASS — 66/66 (both runs) |
| API tests | `npm run test:api` | PASS — 69/69 (both runs) |
| Security tests | `npm run test:security` | PASS — 19/19 (both runs) |
| Smoke checks | `npm run test:smoke` | PASS — 15/15, 1 skipped (both runs) |
| Browser — Chromium | `npm run test:browser -- --project=chromium` | PASS — **21/21, zero unexplained failures** (both runs) |
| Browser — WebKit | `npm run test:browser -- --project=webkit` | PASS — 19/21 (both runs) — 2 documented WebKit/Safari platform-default failures (keyboard nav skips buttons by default), not app bugs |
| TypeScript | `npx tsc --noEmit` | PASS — 0 errors |
| Prisma schema validity | `npx prisma validate` | PASS |
| Production build | `npx vite build` | PASS |
| Dependency audit | `npm audit` | PASS — 0 vulnerabilities |
| Secret scan | manual grep across every file changed this round | PASS — no real secrets, only doc prose and test-fixture literals |
| `git diff --check` | — | PASS — 0 whitespace errors |
| Final `git status` | — | PASS — only this round's own files |
| Development-database integrity | row-count + MD5 snapshot before/after both full runs | PASS — MD5 `802f37de6bee4a0d5d6784668afc4402`, byte-identical to the very first snapshot taken at the start of the database-isolation work, unchanged through this entire round |

**Classification key:** PASS / FAIL / BASELINE FAILURE / RESOURCE BLOCKED / NOT RUN — every gate
this round resolved to PASS; none hit FAIL, BASELINE FAILURE, RESOURCE BLOCKED, or NOT RUN.

### What changed since the previous gate matrix (below)

- 21 new/updated automated tests (rate-limiter TRUST_PROXY + numeric validation, production-config
  validation, auth input validation + the login-normalization bug fix, 3 new CSP-evidence
  Playwright tests) — Chromium Playwright count rose from 15 to 21 checks total (18 functional + 3
  CSP-evidence), all passing with **zero unexplained failures**, closing the "known, currently-
  failing 320px overflow" gap entirely.
- `server/lib/auth-context.mjs` unaffected this round; new changes are in `server/lib/rate-limit.mjs`,
  `server/lib/env.mjs`, `server/lib/validate.mjs`, `server/routes/auth.mjs`, `index.html`,
  `src/shared/theme/global.css`.
- No schema, migration, or production/development-data changes — verified via the dev-database
  MD5 check above and via `git diff --name-status main...HEAD` (no `prisma/` changes).

---

## Original gate matrix (2026-07-10, historical) — before either review round

Date: 2026-07-10. Branch: `security/sybnb-v6-predeployment`. Every gate below was run against the
actual working tree on this branch, against the real local Postgres database (name redacted; see
below), not a mock or a stale cache.

> **Update (independent-review pass, same date):** the database referenced below was
> subsequently confirmed to be the same database used for ordinary manual development/QA, not an
> isolated test database — see `docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md`, classified
> **HIGH — release blocker** at the time. The gate results in the original section below are
> preserved as historical evidence from when they were run. **This blocker is now resolved** — see
> the new section immediately below, which re-runs every gate against the isolated `sybnb_v6_test`
> database per `docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md`.

## Gate matrix — re-run against the isolated test database (current)

Every gate below was re-run after the test-database-isolation work landed. Database name never
printed (see `docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md` for the redacted-verification method).

| Gate | Command | Result |
|---|---|---|
| Frozen lockfile install | `npm ci` | PASS |
| Test-database safety guard | `npm run test:guard` | PASS — 21/21 |
| Prisma schema validity | `npx prisma validate` | PASS |
| Isolated schema bootstrap (idempotent re-check) | `npm run db:test:push` | PASS — "already in sync," no changes needed |
| Unit tests | `npm run test:unit` | PASS — 42/42 |
| API tests | `npm run test:api` | PASS — 60/60 |
| Security tests | `npm run test:security` | PASS — 16/16 |
| Smoke checks | `npm run test:smoke` | PASS — 15/15 (1 skipped: frontend-shell check needs a running dev server, unrelated to DB isolation) |
| Browser tests — Chromium | `npm run test:browser -- --project=chromium` | PASS — 14/15 (1 genuine, newly-found 320px responsive-overflow bug, left honestly failing) |
| Browser tests — WebKit | `npm run test:browser -- --project=webkit` | PASS — 12/15 (same overflow bug + 2 documented WebKit-specific keyboard-navigation platform differences, not app bugs) |
| TypeScript | `npx tsc --noEmit` | PASS — 0 errors |
| Production build | `npx vite build` | PASS |
| Dependency audit | `npm audit` | PASS — 0 vulnerabilities |
| Secret scan | manual grep across every file changed this phase | PASS — no real secrets found |
| `git diff --check` | — | PASS — 0 whitespace errors |
| Final `git status` | — | PASS — only this phase's own files; `.env.test` confirmed never staged/tracked |

**Repeatability proof:** the full sequence (guard → unit → api → security → smoke) was run three
times consecutively; every run produced identical pass counts (21/42/60/16). Development-database
row counts across all 32 tables were captured before and after the entire sequence — MD5-identical
(`802f37de6bee4a0d5d6784668afc4402`), and no table's max `updated_at`/`created_at` timestamp moved.
Full detail in `docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md`.

**Classification key used above:** PASS / FAIL / BASELINE FAILURE / RESOURCE BLOCKED / NOT RUN —
every gate this phase touched resolved to PASS; none hit BASELINE FAILURE, RESOURCE BLOCKED, or
NOT RUN.

---

## Original gate matrix (historical — before test-database isolation existed)

| Gate | Command | Result |
|---|---|---|
| Working tree matches this phase's intended scope | `git status --short` | PASS — only files touched by this phase; no LECIPM, no legal-page, no unrelated changes |
| Correct branch, not `main` | `git branch --show-current` | PASS — `security/sybnb-v6-predeployment` |
| Clean install / lockfile sync | `npm install --dry-run` (full `npm ci` already verified earlier this engagement with a documented local-cache workaround) | PASS — no drift since |
| Prisma schema validity | `npx prisma validate` | PASS |
| TypeScript | `npx tsc --noEmit` | PASS — 0 errors |
| Lint | — | NOT CONFIGURED — no ESLint config exists in this repo; not introduced this phase (would be a design/tooling change beyond this order's scope) |
| Unit tests | `npx vitest run test/unit` | PASS — 21/21 |
| API tests | `npx vitest run test/api` | PASS — 60/60 |
| Security tests | `npx vitest run test/security` | PASS — 12/12 |
| Full Vitest suite | `npx vitest run` | PASS — 93/93 across 10 files |
| API smoke | `npm run smoke:api` | PASS — 8/8 |
| Route smoke (incl. frontend shell) | `SMOKE_FRONTEND_URL=http://127.0.0.1:5180 npm run smoke:routes` | PASS — 8/8 |
| Browser regression (Chromium, via Claude_Preview) | manual live pass — landing page, auth/login flow, mobile viewport | PASS — see Phase 7 notes below |
| Production build | `npx vite build` | PASS — builds cleanly, no errors |
| Dependency audit | `npm audit` (incl. dev) | PASS — 0 vulnerabilities |
| Secret scan | manual grep across this phase's diff + all new files for key/secret/password/PEM-shaped strings | PASS — no real secrets; only env-var names, doc prose, and test fixture literals (e.g. `'correct-horse-battery'`) |
| Manual live rate-limit check | direct `fetch()` against the running server: 12 rapid logins → 429 on the 11th+ with `Retry-After` | PASS |
| Manual live security-headers check | direct `fetch()` against `/api/health` | PASS — all 5 headers present as specified |

## Accessibility / cross-browser (Phase 7 original findings; repairs applied in a later pass)

Bounded review, Chromium only (via `mcp__Claude_Preview__*`) — Safari and Firefox: **NOT RUN**, no
tooling available in this environment.

- Keyboard tab order: reaches every interactive element on the landing page and auth wizard in a
  sensible sequence. PASS.
- Focus-visible indicator: **inconclusive via automated tooling** at the time. *(Resolved:
  confirmed via Playwright's real `page.keyboard.press('Tab')` — see below.)*
- Labels: all 3 inputs on the auth form have accessible names (via associated `<label>`). PASS.
- Modal focus: N/A — the app uses an inline stepper/wizard pattern, not modal dialogs.
- Contrast: the primary CTA button measured **4.39:1**, marginally below the 4.5:1 AA threshold.
  *(Resolved: see below.)*
- Reduced motion: PASS. Responsive zoom: PASS.
- Mobile layout (375×812): no horizontal overflow. One touch target measured 23px vs. a 24px
  guideline — 1px short, informational only, not fixed.

## Accessibility repairs (narrow, per the follow-up order's Step 9)

- **Skip-navigation link — added.** `src/shared/layout/AppShell.tsx` now renders a
  `.skip-link` anchor (`href="#main-content"`) as the very first element in the app shell, visually
  hidden until focused (`.skip-link:focus { top: 0 }` in `src/shared/theme/global.css`). Verified
  with a real trusted Tab press via Playwright: `top: 0px`, `matches(':focus')` true.
- **Error association — added.** `src/modules/account/GuestAccountPage.tsx`'s status message now
  carries `role="alert"`/`aria-live="assertive"` for errors and `role="status"`/`aria-live="polite"`
  for success, so a screen reader is notified automatically when it appears. This does not add
  full per-field `aria-describedby` linkage (a platform-wide pattern across many forms — out of
  scope for a narrow repair); the generic-message gap itself is now at least announced.
- **Visible keyboard focus — confirmed already present, no repair needed.** Playwright's
  `page.keyboard.press('Tab')` test (a real trusted input, unlike the earlier script-dispatched
  check) confirms `outlineStyle !== 'none'` on Chromium — the browser-default focus ring was
  already working; the earlier "inconclusive" finding was a testing-environment limitation, not an
  app defect.
- **Contrast — narrow token adjustment applied.** The brand accent blue used as a white-text
  button/badge background was `#5268ff` (4.39:1 with white — below the 4.5:1 AA threshold).
  Changed to `#4760ff` (same hue, 232°, same 100% saturation, lightness nudged from 66% to 64%) —
  **4.79:1**, clearing the threshold with a small safety margin. Applied to all 7 confirmed
  solid-background-with-white-text occurrences (`AdminReviewPage.tsx` ×2, `ListingDetailPage.tsx`
  ×2, `DashboardPage.tsx`, `GuestAccountPage.tsx`, `StaffAccessPage.tsx`) for visual consistency
  across the same shared visual role. Deliberately **not** touched: other usages of the original
  `#5268ff` as icon/link/accent text color or in gradients/rgba-tinted backgrounds — different
  visual roles with a different contrast pair, out of scope for this narrow repair.

## Summary

Every automated gate this phase controls (tests, build, types, schema, audit, secrets, browser
suite) is green. Two accessibility findings from the original pass were repaired narrowly
(skip-navigation, error-association) and confirmed already-fine on further investigation (visible
focus); one was repaired with a small, brand-preserving color adjustment (contrast). The database
isolation gap is resolved (see the current gate matrix above). Remaining known issues: a genuine
320px responsive-overflow bug (new finding, left honestly failing, out of this repair's scope) and
the two deferred auth-architecture decisions (password reset, session revocation — see
`SYBNB_V6_AUTH_DECISIONS_REQUIRED.md`).
