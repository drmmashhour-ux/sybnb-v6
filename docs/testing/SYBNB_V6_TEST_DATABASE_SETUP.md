# SYBNB V6 — Isolated Test Database Setup

Date: 2026-07-10. Closes the release blocker identified in
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md`: the automated test suite previously ran against
the same database used for ordinary local development/QA. This document describes the isolated
replacement, the safety guards protecting it, and how to reproduce the setup on another machine.

**Scope: local development only.** Nothing here is CI-ready as-is — see "CI-compatible future
design" below for what a shared/CI environment would additionally need.

---

## Why a whole document, not just a `DATABASE_URL` swap

A wrong or missing test database configuration should be impossible to silently get away with.
Three independent layers exist so that a mistake at any one layer still fails safely:

1. **Separate database, separate role, separate credentials.** `sybnb_v6_test` is a distinct
   Postgres database owned by a dedicated `sybnb_v6_test_role` login role — not the same role the
   development `.env` uses.
2. **A fail-closed application-level guard** (`server/lib/test-db-guard.mjs`), checked inside
   `server/lib/prisma.mjs`'s `db()` — the single real connection choke-point — whenever
   `NODE_ENV=test`. No PrismaClient is ever constructed unless every safety condition holds.
3. **A dedicated `.env.test` file**, never `.env`, loaded explicitly by every test/smoke/browser
   command via `scripts/require-test-env.mjs` (Vitest) or `node --env-file=.env.test` (Playwright's
   spawned servers) — with no fallback path to the development environment if it's missing.

### Why database-level Postgres ACLs are *not* the enforcement mechanism

An attempt was made to also `REVOKE CONNECT ON DATABASE sybnb_v6 FROM sybnb_v6_test_role` as
defense-in-depth. This turned out to be a no-op: PostgreSQL grants `CONNECT` to the `PUBLIC`
pseudo-role by default on every database, and revoking a privilege from one specific role has no
effect when that role's actual access comes from the `PUBLIC` grant instead of a role-specific one
— there is no "deny" override layered on top. The only way to truly block this at the database
layer would be to revoke `CONNECT` from `PUBLIC` on the *development* database itself, which is
exactly the kind of development-database modification this setup must never perform. **The
application-level guard in `test-db-guard.mjs` is therefore the real, load-bearing protection —
not a redundant extra.**

---

## Safety guards (`server/lib/test-db-guard.mjs`)

Before any test connects to Postgres, all of the following must hold, or `assertTestDatabaseSafe()`
throws before a `PrismaClient` is ever constructed:

- `NODE_ENV` is exactly `"test"`.
- `DATABASE_URL` is set and parses as a valid URL.
- The host is `127.0.0.1` / `localhost` / `::1` — unless a not-yet-approved CI flag
  (`CI_TEST_DB_APPROVED=1`, only honored when a caller explicitly opts in via `allowCI: true`) is
  set.
- The database name ends in `_test`.
- The database name does not contain a `prod` substring.
- The host does not match a known managed-cloud/production hosting pattern (AWS RDS, Azure,
  GCP, Render, Railway, Heroku, Supabase, Neon, PlanetScale).
- The URL is not identical to, and does not share host+port+database-name with, whatever
  `DATABASE_URL` is configured in the plain `.env` file (compared without ever printing either
  value).

On any failure: the error message names *which* checks failed in generic terms (e.g. "Database
name does not end with `_test`") — it never includes the actual URL, host, username, or password.
Zero connection is opened, zero tests run, zero cleanup or migration is attempted.

`test/support/resetTestDatabase.mjs` (the destructive full-reset helper) re-validates this guard
independently on every call, rather than trusting that a connection opened safely once earlier in
the process is still safe now.

Tested directly in `test/unit/test-db-guard.test.mjs` (pure-function checks, no real connection)
and `test/security/test-db-guard-integration.test.mjs` (the actual `db()` wiring, confirming it
refuses to construct a client on unsafe configurations — run via `npm run test:guard`).

---

## Safe local setup, from a blank database

1. **Create the database and a dedicated role.** As a Postgres superuser (adjust names/password):

   ```sql
   CREATE ROLE sybnb_v6_test_role WITH LOGIN PASSWORD '<a-strong-random-password>';
   CREATE DATABASE sybnb_v6_test OWNER sybnb_v6_test_role;
   ```

2. **Enable PostGIS on the test database** (required — `ride_requests.pickup_geo`/`dropoff_geo`
   are `geometry` columns):

   ```sql
   \c sybnb_v6_test
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```

3. **Copy the template and fill in your values:**

   ```bash
   cp .env.test.example .env.test
   # edit .env.test — set DATABASE_URL to the role/database you just created
   ```

   `.env.test` is already covered by `.gitignore`'s `.env.*` pattern — **verify this yourself**
   (`git check-ignore -v .env.test`) before ever putting a real password in it.

4. **Bootstrap the schema:**

   ```bash
   npm run db:test:push
   ```

   This loads `.env.test`, re-checks the safety guard, and runs `prisma db push --skip-generate`
   (no `--accept-data-loss` baked in — see "Schema-creation method" below for why).

5. **Verify isolation before trusting it:**

   ```bash
   npm run test:guard
   ```

## CI-compatible future design (not implemented)

For a real CI pipeline: provision a fresh, ephemeral Postgres + PostGIS instance per run (a
service container is the standard pattern), set `DATABASE_URL` to point at it plus
`CI_TEST_DB_APPROVED=1`, and pass `{ allowCI: true }` into the one or two call sites that need to
accept a non-loopback host in that environment. The guard's other checks (`_test` suffix, not
identical to dev, no production-host pattern match) still apply unchanged — CI should not get a
weaker safety net, only a relaxed loopback requirement.

## Schema-creation method

**Method used: `prisma db push`, not `prisma migrate deploy`.** This project's own migration
history (`prisma/migrations/001` through `007`) is not authoritative — checked via
`prisma migrate status` against the development database: **6 of the 7 migration folders have
never actually been applied there.** The real development schema was built through a mix of
hand-applied raw SQL and direct schema edits, predating and outside of what the migration folders
describe. `db push` derives the schema directly from the current `prisma/schema.prisma`, which —
after verification below — matches the tables the running application code actually reads and
writes.

**Independent-review follow-up:** `docs/testing/SYBNB_V6_MIGRATION_FIDELITY_ASSESSMENT.md` actually
ran `migrate deploy` against a disposable blank database to prove this precisely rather than infer
it. Result: the migration chain applies cleanly (it isn't broken), but is missing one entire table
(`listing_availability`) relative to the current schema — while getting `id` columns' native
`uuid` type and `ride_requests`'s spatial GiST indexes *more* physically correct than `db push`
does. Neither method alone is a perfect match for the current schema; see that document for the
full comparison and the proposed (not yet implemented) fix.

**Tables created:** every model in `prisma/schema.prisma` (verified: 21 application tables,
matching table-for-table between the freshly-bootstrapped test database and the development
database, once you account for 9 tables that exist in the development database but were never
added to `schema.prisma` at all — `agreement_acceptances`, `ai_brain_signals`, `booking_drafts`,
`disputes`, `guest_id_verifications`, `host_profiles`, `listing_declarations`, `room_types`,
`verification_codes`. These are unreachable by Prisma Client / the running application regardless
of which database you point at — informational, not a bootstrap defect. `_prisma_migrations`
itself is also absent from the test database, since `db push` doesn't use the migration-tracking
mechanism — also expected, not a gap in coverage of anything the application uses).

**Required reference data:** `CREATE EXTENSION postgis` populates its own `spatial_ref_sys`
system table (~8,500 rows of coordinate-system reference data) automatically — this is PostGIS's
own built-in data, not application seed data, and is owned by the Postgres superuser who ran
`CREATE EXTENSION`, not by `sybnb_v6_test_role`. No application-level seed/reference data is
required for the current test suite (every fixture is created fresh by the tests themselves).

**Migration gap found and fixed:** `server/routes/sr-rides.mjs` had one raw-SQL statement
(`WHERE id = ${ride.id}::uuid`) that assumed `id` columns are natively typed `uuid` in Postgres.
The development database's `id` columns genuinely are native `uuid` (created via historical
hand-written SQL); `schema.prisma`'s `id String @id @default(uuid())` (no `@db.Uuid` annotation)
makes `db push` create `text`-typed columns instead. The comparison was changed to
`WHERE id::text = ${ride.id}` — logically identical whenever `id` really is a `uuid` column (as on
the development database), but no longer dependent on that physical type being true everywhere.
This was the one genuine schema-fidelity gap found; searched for and confirmed no other `::uuid`
casts exist anywhere else in `server/`.

**Reproducible from a blank database: yes**, confirmed end-to-end — `npm run db:test:push` against
a freshly `DROP DATABASE`-then-`CREATE DATABASE`d target, followed by the full test suite run
twice in a row, produced identical results both times (see the repeatability proof in
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md`).

## Fixture lifecycle

- Every test-created email/phone is generated from a fresh process-start-time-based run id plus an
  in-process counter (`test/support/testServer.mjs`), so no test run depends on state left over
  from a previous one.
- `test/support/setup.env.mjs` calls `resetTestDatabase()` — a full `TRUNCATE ... RESTART IDENTITY
  CASCADE` scoped to tables owned by the connecting role (naturally excluding PostGIS's
  `spatial_ref_sys`, which the test role doesn't own and would get a permission error trying to
  touch) — once, at the very start of every `test:api`/`test:security` Vitest run.
- Individual test files still track and clean up their own users via
  `trackTestUser`/`cleanupTestUsers()` within their own `afterAll` hooks, for readable per-file
  isolation — this is no longer load-bearing for safety (unlike when this same logic ran against
  the shared development database and had to preserve audit-log-referenced rows to avoid deleting
  real audit history), just a tidiness convenience now that the whole database resets between full
  suite runs anyway.
- **Full reset is safe here specifically because this is the isolated `_test` database** —
  `resetTestDatabase()` re-validates the safety guard on every call and would refuse to run against
  anything else.

## Commands

| Command | What it does |
|---|---|
| `npm run test:guard` | Verifies the safety guard itself (both the pure logic and the real `db()` wiring) — needs no `.env.test` to exist. |
| `npm run test:unit` | Pure-function tests, no database at all. |
| `npm run test:api` | API/integration tests against the isolated database. Fails clearly if `.env.test` is missing. |
| `npm run test:security` | Security/cross-cutting tests against the isolated database. |
| `npm run test:smoke` | The existing smoke scripts, now also pointed at the isolated database. |
| `npm run test:browser` | Playwright smoke suite (Chromium + WebKit) — see below. |
| `npm run test:ci` | All of the above, in order. |
| `npm run db:test:push` | (Re-)syncs the isolated database's schema from `prisma/schema.prisma`. Never auto-passes `--accept-data-loss` — if a future schema change needs it, you'll see the same warning this setup hit once and must re-run the command by hand with that flag typed explicitly. |

## Browser smoke suite (Playwright)

`playwright.config.ts` spawns both the API server (`node --env-file=.env.test server/index.mjs`,
port 3061) and the Vite dev server (port 5190, `VITE_API_BASE_URL` pointed at the API server)
fresh for each run — no dependency on Claude Code's preview tooling, fully repository-owned.

Install once: `npx playwright install chromium webkit` (already run as part of this setup; browser
binaries are cached outside the repo, not committed).

**On the "webkit" project name:** this is Playwright's own bundled WebKit engine, reported here
exactly as "webkit" — it is **not equivalent to testing real Safari** (different build, no
Apple-specific integrations, no access to real macOS/iOS Safari-only behavior). Two tests are
expected to fail on this project specifically (`Tab reaches the login control...` and `...visible
outline`): WebKit's default keyboard-navigation behavior only tabs between text fields and links,
not buttons, mirroring real Safari's default (Full Keyboard Access is off by default on macOS) —
this is a genuine browser/platform difference, not an application bug, and is documented inline in
`test/browser/smoke.spec.ts` rather than hidden.

One test is expected to fail on **both** projects: `no horizontal overflow on the landing page at
320px` — a genuine, newly-discovered responsive-layout bug (the header doesn't fit within a
320px viewport). Left as an honestly-failing test rather than weakened, since fixing it is outside
this document's scope (not one of the four accessibility repairs this phase's order authorized).

Output (`test-results/`, `playwright-report/`) is gitignored.

## Troubleshooting (without exposing secrets)

- **"`.env.test` not found"** — copy `.env.test.example` to `.env.test` and fill in your local
  test-role password. Never copy real `.env` values into it.
- **"Refusing to run database tests: ... (N check(s) failed)"** — the guard printed which named
  conditions failed (e.g. "Database name does not end with `_test`"); it never prints the URL
  itself. Fix `.env.test` accordingly.
- **`prisma db push` asks for `--accept-data-loss`** — expected the first time a unique constraint
  is added to an empty database (Prisma warns regardless of whether data actually exists). Confirm
  the target is genuinely `sybnb_v6_test` and genuinely has zero application rows
  (`SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public'` as the test
  role) before re-running with the flag by hand.
- **PostGIS-related errors on `db push`** — the extension isn't enabled yet on the test database;
  see step 2 above.
- **Playwright can't find browsers** — run `npx playwright install chromium webkit`.
