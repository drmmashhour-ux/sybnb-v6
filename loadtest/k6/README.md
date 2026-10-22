# Rezekme Rides — k6 load tests (local smoke, then staging)

`rides.js` simulates real app traffic with **synthetic accounts only**:

| Scenario | What a VU does |
|---|---|
| `drivers` | One VU = one driver phone. It sends its location every 8 s and polls for offers every 4 s. When it gets an offer it accepts it, then follows that ride (polls every 4 s) until the ride ends. |
| `browse` | Riders on the home screen. Each check is driver availability plus a fare estimate; each browsing rider does one every 20 s. |
| `rides` | Ride requests, measured **per minute**. Each request runs a full lifecycle: fare estimate → request → wait for a driver. Outcomes: about 10% cancelled while waiting, about 20% cancelled after a driver accepts, and the rest **completed**. A completed ride goes: arriving → pickup code → trip → completed, and the fare settles to the driver's synthetic wallet. |
| `monitor` | Reads `/api/metrics` every 10 s: database up, connections, longest query, event-loop delay, riders waiting over 2 minutes, payment failures. |

**Payments are test-only.** The seed gives every synthetic rider a synthetic wallet credit, and rides are paid from that wallet. The scripts never call Stripe and never send a card number, and the target API refuses to identify itself as a test target when a live Stripe key is configured.

## Safety: why it cannot run against production

The script refuses to run unless all of these checks pass.

**1. URL rules, checked before any request** (`lib/target-rules.js`, unit-tested in `tests/unit/k6-target-safety.test.mjs`):
- `LOADTEST_ENV` must be `local` or `staging`.
- `local` mode only allows `127.0.0.1` and `localhost`.
- `staging` mode requires all of the following:
  - https
  - the host name contains "staging"
  - the host is not a known production host (`rides.rezekme.com`, `rezekme-api.onrender.com`, `*.rezekme.com`, `sybnb.app`, …, plus anything you add in `EXTRA_PRODUCTION_HOSTS`)
  - `STAGING_CONFIRM=staging-only-no-real-payments`
  - a `METRICS_TOKEN`

**2. Server confirmation, one request before any load.** `setup()` reads `GET /api/health` and aborts unless it returns `loadTestTarget: true`. The API (`server/lib/loadtest-target.mjs`) only returns true when all of these hold:
- `LOADTEST_TARGET_ENABLED=1` is set on that service;
- no live Stripe key (`sk_live_…` / `rk_live_…`) is configured;
- its database contains the table `loadtest_target_marker`.

Production has none of these. If someone sets the flag on production by mistake, the missing marker table still makes it answer false.

**3. Seed, verify and cleanup scripts** (`scripts/ride-loadtest-*.mjs`) only write to:
- a local database, or
- a remote database that has the marker table, when you also set `LOADTEST_REMOTE_DB_CONFIRM=staging-branch-only`.

## Install k6 (free, open source)

- **macOS:** `brew install k6`
- **Debian/Ubuntu:** add the official repo from https://dl.k6.io, then `apt-get install k6`.

These scripts were tested with k6 v2.3.0.

## A. Local smoke test (no cloud resources, about 6 minutes)

```bash
# 1. local Postgres+PostGIS with the schema (npx prisma migrate deploy), then mark it as a load-test DB:
psql "$DATABASE_URL" -c "create table if not exists loadtest_target_marker (created_at timestamptz not null default now(), note text not null); insert into loadtest_target_marker(note) values ('local k6')"

# 2. synthetic drivers/riders + session tokens (the token file is a secret; keep it out of git)
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/rezekme_load AUTH_SECRET=<local> PHONE_HASH_SECRET=<local> \
  REGISTERED=0 DRIVERS=60 RIDERS=300 OUT=/tmp/k6-tokens.json node scripts/ride-loadtest-seed.mjs

# 3. local API marked as a load-test target
LOADTEST_TARGET_ENABLED=1 METRICS_TOKEN=<16+ chars> SR_REQUIRE_PREPAY=1 DB_POOL_SIZE=20 \
  DATABASE_URL=... AUTH_SECRET=<same as step 2> PHONE_HASH_SECRET=... API_PORT=3061 node server/index.mjs

# 4. run
LOADTEST_ENV=local BASE_URL=http://127.0.0.1:3061 TOKENS_FILE=/tmp/k6-tokens.json METRICS_TOKEN=<same> \
  k6 run loadtest/k6/rides.js

# 5. correctness check (double assignment, double charge/refund/payout, wallet drift)
DATABASE_URL=... node scripts/ride-loadtest-verify.mjs
```

## B. Staging (only after the cost estimate is approved)

**1. Database.** Use a separate, empty Neon database, for example a new free project called `rezekme-staging`. Do **not** branch production: a branch copies real riders and drivers, and on the Free plan it also uses up production's monthly compute allowance.
- Run `npx prisma migrate deploy` against it.
- Create the `loadtest_target_marker` table (same SQL as in section A).
- Seed it:
  ```bash
  LOADTEST_REMOTE_DB_CONFIRM=staging-branch-only DATABASE_URL=<staging url> \
    REGISTERED=200000 DRIVERS=1300 RIDERS=1100 OUT=~/k6-staging-tokens.json \
    node scripts/ride-loadtest-seed.mjs
  ```
- For the full `staging-step` profile you need at least 1,200 drivers and 980 riders.
- Set `PRODUCTION_DATABASE_HOSTS=<prod neon host>` as an extra guard.

**2. API.** Create a separate Render web service. Its name must contain "staging", for example `rezekme-api-staging`. Use the same repo and the branch `scale/rides-1m`. Set **its own** environment, entered in the Render dashboard, never in git:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Staging database URL (pooled, `?pgbouncer=true`) |
| `AUTH_SECRET`, `PHONE_HASH_SECRET` | New random values, **different from production**. The seed must use the same `AUTH_SECRET` so its tokens are accepted. |
| `LOADTEST_TARGET_ENABLED` | `1` |
| `METRICS_TOKEN` | Random value, 16+ characters |
| `SR_REQUIRE_PREPAY` | `1` |
| `DB_POOL_SIZE` | e.g. `10` |
| `SYBNB_COUNTRY` | `syria` (same as production) |
| `CORS_ORIGIN` | Empty, or a staging front end only |
| `NODE_ENV` | `production`, to measure realistic behaviour |

**Leave these unset on staging**, so nothing real is charged or sent:
- `STRIPE_SECRET_KEY` (or use a `sk_test_` key)
- `STRIPE_WEBHOOK_SECRET`
- `SR_GUEST_STRIPE_ENABLED`
- `RESEND_API_KEY` / `EMAIL_PROVIDER`
- `SMS_*`, `TWILIO_*`
- `VAPID_*`
- `GOOGLE_MAPS_API_KEY`, `GOOGLE_ROUTES_API_KEY`
- `STORAGE_S3_*`
- `ADMIN_NOTIFY_EMAIL`

**3. Run gradually.** Stop as soon as thresholds fail. The highest tier held cleanly is the result.

```bash
export LOADTEST_ENV=staging BASE_URL=https://rezekme-api-staging.onrender.com \
  STAGING_CONFIRM=staging-only-no-real-payments METRICS_TOKEN=<staging token> \
  TOKENS_FILE=~/k6-staging-tokens.json DB_CONN_LIMIT=<pool size × instances + 10>
PROFILE=staging-launch k6 run loadtest/k6/rides.js   # ~19 min, 10 → 50 drivers
PROFILE=staging-step   k6 run loadtest/k6/rides.js   # ~44 min, 50 → 800 drivers
PROFILE=staging-soak   k6 run loadtest/k6/rides.js   # ~35 min at 100 drivers
LOADTEST_REMOTE_DB_CONFIRM=staging-branch-only DATABASE_URL=<staging url> node scripts/ride-loadtest-verify.mjs
```

The same runs in Grafana k6 Cloud are optional: `k6 cloud run loadtest/k6/rides.js`, with the token file uploaded and the env vars set as k6 Cloud secrets. Choose the Frankfurt load zone, near the API.

**4. Afterwards**, delete the staging Render service and the staging Neon project so no ongoing charges remain.

## Profiles and thresholds

| Profile | Tiers (drivers / browsing riders / ride requests per min) | Duration |
|---|---|---|
| `smoke` | 5 / 5 / 2 | ~6 min |
| `staging-launch` | 10/15/2 → 25/40/5 → 50/75/10 | ~19 min |
| `staging-step` | 50/75/10 → 100/150/20 → 200/300/40 → 400/600/80 → 600/900/120 → 800/1200/160, each held 5 min | ~44 min |
| `staging-soak` | 100/150/20 for 30 min | ~35 min |

Durations include the drain at the end, where drivers stay online so the last rides can finish.

Thresholds:

| Area | Limit |
|---|---|
| Errors | `http_req_failed` < 1%, aborting after 1 min if broken. A 409 race answer is not an error. |
| Response time (p95), driver location, pending poll, ride poll | < 500 ms |
| Response time (p95), availability | < 600 ms |
| Response time (p95), fare estimate | < 800 ms |
| Response time (p95), ride request, accept, cancel, trip status | < 1,000 ms |
| Ride creation | `ride_create_failed` < 1% |
| Matching | `ride_matched_rate` > 90%; match time p50 < 10 s and p95 < 30 s |
| Trip steps | `trip_step_failed` < 1% |
| Database | `db_up` stays 1; longest query < 5 s; connections < `DB_CONN_LIMIT` |
| API | event-loop p99 < 200 ms |
| Riders waiting | fewer than 5 riders waiting over 2 min |
| Payments | 0 new payment failures |

From a laptop in Canada to a Frankfurt API, every request also carries about 90–110 ms of network round trip. Compare like with like.

The summary prints **total HTTP requests/second** and **ride requests/minute** on separate lines, and writes everything to `k6-rides-<profile>-summary.json`.

**Limits to keep in mind:**
- `/api/metrics` reports the instance that answered. With several API instances, read the database numbers from Neon's monitoring as well.
- One machine running k6 means one source IP. Signed-in endpoints are not rate-limited per IP; anonymous browsing is.
