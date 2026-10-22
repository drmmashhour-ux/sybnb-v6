# Rezekme Rides: scale readiness toward 1 million users

Branch `scale/rides-1m`, measured in October 2026. Everything below was measured on an **isolated local environment with synthetic data**. Production was never load-tested, and no production setting, deployment or migration was changed.

## 1. Verdict

| Target | Supported by evidence? |
|---|---|
| **1,000,000 registered accounts** (stored, signing in, looked up) | **Yes for the database and the hot paths.** The load database held 1,007,017 users (486 MB). Every hot-path lookup is a primary-key or unique-index lookup: email lookup took 0.14 ms and session+user lookup 0.5 ms with the 1M rows present. All load tiers below ran with the 1M-row users table. This says nothing about how many of those users are active at once. |
| **1,000,000 simultaneous active users** | **No.** Not tested, and not credible on the current design without many API processes, a larger database tier and a push channel instead of polling (section 6). |
| **Concurrency actually demonstrated** | **About 2,000 concurrent app users at 0 errors**, on one API process: 800 online drivers, 1,200 browsing riders and 160 ride requests per minute (~429 requests/s). p95 was 234 ms on the driver poll and 356 ms on ride create. Ride matching p50 was 2.4 s. There were 0 correctness violations. |
| **Damascus launch (20–50 drivers, a few hundred riders)** | **Yes, with a wide margin.** That is tier d50, where p95 is at most 34 ms and 0 errors. It is about 15× below the measured ceiling of one process. |

## 2. Architecture (as found)

- **API:** a single Node 24 process using plain `node:http`. Routing is done in `server/index.mjs`. Docker runs on Render (Frankfurt, `starter` plan), with no cluster mode.
- **Database:** PostgreSQL with PostGIS on Neon, accessed through Prisma 6. Prisma's default pool is CPUs×2+1, which is 3–5 connections on a small instance.
- **Clients:** the rider and driver web apps on Vercel poll the API, and nothing is pushed to them:
  - **Rider:** ride status every 4 s, availability every 20 s, chat every 5 s.
  - **Driver:** pending rides every 4 s, location every 8 s, dashboard every 6 s.
- **Matching:**
  - A ride is offered to the nearest eligible online driver. The offer lasts 30 s, then escalates up to 10 rounds.
  - Escalation runs in `runDispatchSweep()`, triggered from every driver pending-list poll and from a 60 s heartbeat.
  - A claim is a guarded `updateMany` (driverId IS NULL).
- **Money:**
  - The prepaid wallet is an idempotent ledger: `wallet_entries.idempotency_key` is unique, and debits are balance-guarded.
  - Stripe webhooks are deduplicated by provider event identity.
  - Sham Cash proofs are reviewed by an admin.
- **Shared state:** rate limits are already stored in Postgres, so they are correct across replicas.

## 3. Measured bottlenecks, and what was changed

| # | Bottleneck (evidence) | Change |
|---|---|---|
| 1 | **Every driver poll ran a full dispatch sweep.** With 500 drivers that is about 125 sweeps/s. In 60 s they made 7,385 offer writes, 6,293 offer clears and 4,889 decline writes for about 100 rides. Concurrent sweeps overwrote each other's offers, so drivers got "not offered to you" on accept. Result: 41% errors, and only 4 of 97 rides matched. | The sweep is single-flight per process, plus a **shared Postgres lease** (one sweep per 2 s across all replicas, via `rate_limit_buckets`). Scheduled-ride activation moved inside it. (`server/lib/ride-dispatch.mjs`) |
| 2 | **Offers were plain `update`s.** Concurrent dispatchers clobbered each other: 8 parallel calls produced 8 offers and `offerSeq` 0→8. | **Compare-and-set** on `offerSeq`: exactly one dispatcher wins and the others back off. An existing live offer is never overwritten. Unmatched rides no longer write a no-op update on every sweep. |
| 3 | **A driver could be offered several rides at once.** | Candidates exclude drivers who hold a live offer for another ride. |
| 4 | **The KNN distance query used `geometry::geography <->`.** No index can serve that, so it was a sequential scan sorting every driver: 22 ms at 2,000 drivers, growing linearly. | KNN on the raw geometry column with a scalar pickup point, so the GIST index is used: 0.2 ms index scan vs 22 ms seq scan, same data. It also uses an index-assisted bounding box plus an exact metre radius (`SR_DISPATCH_RADIUS_M`, default 15 km). The final ordering and reported distance are true metres. |
| 5 | **Availability ran a spatial aggregate over all online drivers on every call.** This was the top DB consumer at 1,000 drivers (18 ms average). | Each process keeps a snapshot of eligible online drivers, refreshed at most every 3 s (single-flight), and answers from memory. Dispatch never uses this snapshot; it always reads live state. (`server/lib/ride-no-driver.mjs`) |
| 6 | **The same driver could hold two live rides.** `poolClaimEligibility` was checked outside the claim transaction. Reproduced: two simultaneous claims by one driver both returned 200. | Inside the claim transaction, the driver's profile row is locked (`FOR UPDATE`) and live rides are re-checked. The second claim gets `409 DRIVER_ALREADY_ON_RIDE`. Pooled pairs (up to 2 rides) still work: the pooling e2e passes 10/10. |
| 7 | **Concurrent card credits for one PaymentIntent.** This happens on webhook redelivery or when the rider's browser returns at the same moment. 8 of 10 parallel calls failed with P2002, the webhook then marked a valid payment `QUARANTINED`, and the rider saw an error. | `recordCardPrepayCreditOnce()` recognises a lost race as already credited. It is used by the webhook, ride-create and top-up confirm. Proven: 10 parallel calls give 1 credit, 0 failures and the balance raised once. |
| 8 | **One Stripe Checkout session could be re-sent for a second ride.** The second request skipped the wallet-balance check. | A session pays for one ride only (`409 STRIPE_SESSION_ALREADY_USED`). |
| 9 | **The Prisma pool (5 connections) was exhausted under load.** Requests failed with `P2024` after 10 s. | `DB_POOL_SIZE` and `DB_POOL_TIMEOUT_S` set `connection_limit` and `pool_timeout`, never overriding a URL that already has them. (`server/lib/prisma.mjs`) |
| 10 | **Every 500 was logged as `"code":"[redacted]","statusCode":"[redacted]"`.** The redaction pattern matched "code", so the cause of failures was invisible. | `errorCode` and `statusCode` are logged. Only machine codes are allowed (`UPPER_SNAKE`, `Pxxxx`, SQLSTATE); anything else becomes `UNRECOGNISED`. |
| 11 | **Each GPS fix ran 2 statements plus an active-ride lookup**, and two in-memory maps were never pruned. | One `UPDATE` per fix. The active-ride lookup is throttled to once per 15 s per driver. The maps are pruned. |
| 12 | **The service was single-process only.** | Optional `server/cluster.mjs` (`WEB_CONCURRENCY=N`). Background timers run in one worker only (`BACKGROUND_JOBS=0` on the others). Default behaviour is unchanged. |

**H3 was evaluated and not adopted.** Candidate lookup is already logarithmic through the PostGIS GIST index; after fix #4 the dispatch query is about 0.2–10 ms. Adding H3 would add an extension or library, and a second spatial representation to keep consistent, without a measured gain. H3 remains a good fit later for:
- demand heatmaps
- surge zones
- city-level aggregation in analytics

Neon supports `h3_pg`. Hexagons would only ever narrow candidates; final selection would still use distance or travel time.

## 4. Load tests

### Tools (all new, local only; they refuse production hosts and non-local databases)

| Script | What it does |
|---|---|
| `scripts/ride-loadtest-seed.mjs` | Synthetic seed: N registered accounts (default 1,000,000, set-based insert, about 21 s), approved on-duty drivers spread over Damascus, riders with funded wallets, and real session tokens. |
| `scripts/ride-loadtest-run.mjs` | Open-loop simulation of the real app timers. See the scenarios below. |
| `scripts/ride-loadtest-verify.mjs` | Correctness checks after each run. Exits 1 on any violation. |

The runner simulates:
- **Drivers:** location every 8 s and pending poll every 4 s. A driver accepts its offers and is then busy.
- **Browsing riders:** availability and quote every 20 s each.
- **Ride requests:** created at `RIDE_RATE` per minute, polled every 4 s, and cancelled by the rider 15 s after acceptance. Cancellation exercises the refund path.

The verify script checks that:
- no driver holds two live rides
- no ride was debited (prepaid) twice
- no ride was refunded twice
- every wallet's cached balance equals its ledger
- no cancelled ride still holds a live offer

Commands:

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/rezekme_load AUTH_SECRET=<test> PHONE_HASH_SECRET=<test> \
  REGISTERED=1000000 DRIVERS=2000 RIDERS=5000 node scripts/ride-loadtest-seed.mjs
# API on :3061 with DB_POOL_SIZE=20, SR_REQUIRE_PREPAY=1, then per tier:
BASE=http://127.0.0.1:3061 DRIVERS=800 BROWSERS=1200 RIDE_RATE=160 DURATION=60 node scripts/ride-loadtest-run.mjs
node scripts/ride-loadtest-verify.mjs
```

### Environment and its limits (read before using the numbers)

- **One VM with 2 vCPU and 7 GB RAM**, shared by the API process, PostgreSQL 16 with PostGIS 3.4, and the load generator itself. At the top tiers the load average was about 6, so the generator competed with the API for CPU.
- **The database was local, with no network round trip**, unlike Neon. Each production query adds roughly 1–3 ms of latency.
- **Neither direction is safe to assume:**
  - Latency is optimistic, because there is no DB network hop.
  - Throughput is pessimistic, because three heavy processes shared two cores.
  - Treat the results as relative evidence, not as production capacity.
- **Each tier ran for 60 s.** Longer soak tests were not run.
- **The two-worker cluster mode could not be validated here.** It was slower, because the cores were already saturated.

### Results (one API process; the users table holds 1M rows throughout)

| Run | Online drivers | Browsing riders | Rides/min | Achieved req/s | Errors | Driver poll p95 (ms) | Ride create p95 (ms) | Ride poll p95 (ms) | Matched | Match p50 / p95 | API CPU | Correctness violations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before, d50 | 50 | 75 | 10 | 26.7 | 0.0% | 16 | 31 | 10 | 9/9 | 2.3 s / 4.0 s | 13% | 0 |
| before, d200 | 200 | 300 | 40 | 107 | 0.0% | 30 | 36 | 17 | 37/39 | 2.0 s / 3.6 s | 19% | 0 |
| **before, d500** | 500 | 750 | 100 | 268 offered | **41.3%** | **27,348** | **12,110** | **20,794** | **4/97** | 21.7 s / 29.6 s | 39% | 0 |
| after, d50 | 50 | 75 | 10 | 26.8 | 0.0% | 15 | 34 | 14 | 9/9 | 2.6 s / 3.4 s | 18% | 0 |
| after, d200 | 200 | 300 | 40 | 107 | 0.0% | 22 | 47 | 18 | 37/39 | 2.5 s / 3.9 s | 22% | 0 |
| after, d500 | 500 | 750 | 100 | 268 | **0.0%** | 31 | 58 | 35 | 95/99 | 2.3 s / 3.9 s | 38% | 0 |
| after, d650 | 650 | 975 | 130 | 349 | 0.0% | 58 | 90 | 60 | 125/130 | 2.2 s / 3.9 s | 53% | 0 |
| **after, d800 (highest clean tier)** | **800** | **1,200** | **160** | **429** | **0.0%** | 234 | 356 | 220 | 153/159 | 2.4 s / 4.1 s | 65% | 0 |
| after, d1000 | 1,000 | 1,500 | 200 | 528 offered | 18.7% | 29,313 | 29,378 | 28,247 | 3/181 | — | 76% | 0 |
| after, d1200 | 1,200 | 1,800 | 240 | 619 offered | 44.4% | — | — | — | 0/180 | — | 87% | 0 |

Notes on the results:
- **"Matched" counts:** rides created in the last few seconds of a run had no time to match, so they show as unmatched.
- **The "before" runs** used Prisma's default pool of 5 connections; the "after" runs used `DB_POOL_SIZE=20`. With the dispatch fixes alone, still at pool 5, d500 already went from 41% errors to 0% (run `after-d500`: p95 ≤ 121 ms).
- **What fails beyond d800:** CPU saturation of the shared box, with the API process's Prisma engine plus Postgres plus the generator all on two cores. Requests then queue for a pool connection and fail with `P2024`.
- **The API CPU column** is `ps %cpu` sampled during the run, which is the process's average since it started. Treat it as indicative only.
- **Correctness held at every tier, including overload:** 0 double assignments, 0 double debits or refunds, and 0 wallet drift.

## 5. Traffic model: from users to load

From the simulation, one concurrent app user generates about **0.21 requests/s**. That covers polling, availability, quotes and ride requests. The model also assumes:
- Peak concurrency is about 1–3% of registered users, which is typical for ride-hailing at peak hour.
- Drivers make up about 30–40% of concurrent users in a young market.

These are planning assumptions, not measurements.

| Registered | Peak concurrent users (1–3%) | Est. peak req/s | API processes needed (≈300 req/s each, with headroom) | Status |
|---|---|---|---|---|
| Damascus launch (~1–5k) | 50–300 | 10–65 | 1 | **Measured: OK, large margin** |
| 10k | 100–300 | 20–65 | 1 | Within measured |
| 100k | 1k–3k | 210–630 | 1–3 | Upper end beyond the measured single process. Needs 2–3 processes and a staging test. |
| 1M | 10k–30k | 2,100–6,300 | 8–25 | **Not proven.** Needs the stage 3 changes and a test on production-like infrastructure. |

## 6. Scaling path, applied only when the metrics show the need

All costs are list-price estimates in USD per month. Verify current Render and Neon pricing before buying.

| Stage | Trigger (from the new metrics) | Change | Est. infrastructure |
|---|---|---|---|
| **0 Launch** | — | **Render:** Standard (1 CPU, 2 GB) instead of Starter, which has 0.5 CPU. **Neon:** pooled connection string with `pgbouncer=true`. **Pool:** `DB_POOL_SIZE` around 10. **Metrics:** `METRICS_TOKEN` set and scraped (Grafana Cloud free tier or Better Stack). | ~$25 API + ~$20–70 Neon + $0–20 monitoring ≈ **$50–110** |
| **1 (~100k registered)** | p95 > 500 ms or API CPU > 70% sustained | Render Pro (2 CPU) with `node server/cluster.mjs`, `WEB_CONCURRENCY=2`. Or 2–3 Standard instances behind Render's load balancer; shared state is already in Postgres. Neon compute 2–4 CU. | ~$85–175 API + ~$70–200 Neon ≈ **$150–400** |
| **2 (~250k)** | DB CPU > 60%, or the dispatch sweep takes > 1 s | 4–6 API processes. Neon read replica for admin and analytics reads. Move dispatch to a dedicated worker; the shared lease is already in place. Reduce driver polling to 6–8 s, or long-poll. | ≈ **$500–1,200** |
| **3 (1M registered, 10k–30k concurrent)** | — | **Replace polling with a push channel** (WebSocket or SSE): at 30k concurrent clients, polling alone is about 6k req/s. **Partition `ride_events`** by month. **Move live driver locations to an in-memory store** (Redis with GEO commands) and write a 15 s sample to Postgres. Autoscaled API (8–25 processes). A larger Neon tier or dedicated Postgres. Load-test this design on staging before claiming it. | ≈ **$2,000–6,000** (estimate) |

## 7. Observability added

`GET /api/metrics` serves Prometheus text format. It is off unless `METRICS_TOKEN` (16 or more characters) is set, and requires `Authorization: Bearer <token>`. It contains no personal or payment data: route ids are replaced with `:id`, and only counts, durations and machine codes are recorded.

| Area | Metrics |
|---|---|
| Requests | `http_request_duration_ms` (histogram by method and route), `http_requests_total` (by status class), `http_in_flight_requests`, `event_loop_delay_p99_ms`, `process_resident_memory_bytes` |
| Database | `db_up`, `db_connections`, `db_active_queries`, `db_longest_active_query_seconds` |
| Rides | `sr_online_drivers`, `sr_open_rides`, `sr_open_rides_waiting_over_2m`, `sr_live_rides`, `sr_ride_requests_last_5m`, `sr_ride_requests_total`, `sr_ride_claims_total{result}`, `ride_match_seconds` (histogram) |
| Dispatch | `sr_dispatch_queue_depth`, `sr_dispatch_sweeps_total`, `sr_dispatch_last_sweep_ms`, `sr_dispatch_offers_total` |
| Payments | `payment_failures_total`, `payment_events_failed` (failed, dead-lettered or quarantined webhook events) |

Suggested alert rules are in `docs/launch/rides-alerts.yml`.

## 8. Tests and verification (exact results)

**New tests:**
- **`tests/e2e/sr-ride-concurrency.e2e.mjs`: 12/12 pass.** It covers:
  - two drivers accepting the same ride (one wins, the other gets 409)
  - one driver claiming two rides at once (one wins, the other gets `DRIVER_ALREADY_ON_RIDE`)
  - 8 concurrent dispatchers (one offer, `offerSeq` +1)
  - no second live offer for a driver
  - single-flight sweeps
- **The same suite against the previous code fails 8 assertions**, reproducing each bug: double assignment, 8 offers, `offerSeq` 0→8, a driver holding two offers, and 10 concurrent sweeps.
- **`tests/e2e/preride-credit-race.e2e.mjs`: 7/7 pass.** The old path rejected 8 of 10 concurrent calls with P2002.
- **`tests/unit/scale-helpers.test.mjs`:** 3/3 pass. Full unit suite: **350/350 pass**.

**Existing suites, run locally against a fresh migrated database, on the new and old code:**

| Result | Suites |
|---|---|
| Pass, unchanged | `dispatch-duty-gate`, `driver-self-signup`, `sr-anonymous-browse`, `sr-ride-auto-expire` 11/11, `sr-ride-money-flow` 12/12 (its fixture helper now also lowers a leftover balance, so repeated runs pass; before, a second run failed on old and new code alike), `sr-ride`, `sr-geocoding` 49/49, `sr-pricing-admin` 7/7, `syria-wallet` 21/21, `payment-proof-race` 4/4, `payment-event-supersession` 38/38 |
| Pass when run with their required environment | `rezekme-wallet-card-topup` 6/6 (fake-Stripe preload), `sr-ride-full-loop` 13/13 (prepay off), `sr-ride-pooling-discount` 10/10 (drivers on duty) |
| Fail identically on old and new code (local fixtures they need are missing here) | `sr-vip-bonus` 14/16, `payment-event-identity`, `payment-event-durability`, `payment-event-claim-recovery`, `payment-webhook-durability` |

**Builds:** `npm run build:rezekme-rides` and `npm run build:rezekme-admin` both pass, and include `tsc`.

## 9. Remaining blockers and risks

1. **No production-like test yet.**
   - Run the same scripts on a staging copy: a Render service of the planned size plus a Neon branch.
   - Then set real `DB_POOL_SIZE`, instance size and alert thresholds from what that shows.
2. **Polling is the long-term ceiling.** Most traffic is idle polls. Push (SSE or WebSocket) is the main change before going beyond about 3k concurrent users.
3. **Auth costs 3 DB round trips per request**, for the session, the user and the roles. Prisma's `relationJoins` or one raw join would cut that to 1. It was deferred because it touches every request.
4. **The platform house wallet row is updated on every prepaid completion.** That is a hot row at high completion rates; batch or shard it at stage 2.
5. **Admin manual assignment** (`/assign-driver`) does not use the new one-live-ride lock. It is operator-only, but should get the same check.
6. **`ride_events` grows by one row per driver per 15 s** while a trip is live. Plan partitioning or retention at stage 2.
7. **The public OSRM demo router** is used for route lines. Run your own router before real traffic.
8. **The repository is public.** I found no secrets in the paths I changed, but a secret scan of the whole history is recommended.

## 10. Configuration introduced (all optional; defaults keep current behaviour)

| Variable | Default | Purpose |
|---|---|---|
| `DB_POOL_SIZE` / `DB_POOL_TIMEOUT_S` | unset | Prisma `connection_limit` / `pool_timeout` |
| `METRICS_TOKEN` | unset (endpoint off) | Enables `/api/metrics` |
| `SR_DISPATCH_SWEEP_MIN_MS` | 2000 | Minimum interval between dispatch sweeps, across all replicas |
| `SR_DISPATCH_RADIUS_M` | 15000 | Dispatch candidate radius |
| `SR_AVAILABILITY_SNAPSHOT_MS` | 3000 | Availability snapshot age (0 = always live) |
| `WEB_CONCURRENCY` / `BACKGROUND_JOBS` | 1 / 1 | Worker processes when started with `server/cluster.mjs` |
