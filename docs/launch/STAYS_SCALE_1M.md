# Rezekme Stay (STR): scale readiness toward 1 million users

Branch `scale/stays-1m`, built on `scale/rides-1m`. Measured in October 2026 on the same **isolated local environment** used for Rides: synthetic data, one 2-vCPU VM shared by the API, PostgreSQL 16 + PostGIS and the load generator.

- Production was never load-tested.
- No production setting, deployment or migration was changed.
- No schema migration is needed for these changes.

## 1. Verdict

| Target | Supported by evidence? |
|---|---|
| **1,000,000 registered accounts** | **Yes for storage and lookups.** The users table held about 1.04M rows during every run below. Sign-in and session lookups are primary-key or unique-index lookups (see the Rides report). |
| **Large catalogue** | **Tested up to 100,000 approved stays** (plus 20,000 removed ones, 500,000 photo rows and 60,000 bookings). Search latency barely changes from 20k to 100k: p50 41 → 46 ms at the same load, because search now walks an index instead of scanning the city. |
| **1,000,000 simultaneous users** | **No.** Not tested, and not credible on one process. |
| **Concurrency demonstrated (100k listings, final code)** | **1,000 browsing guests + 100 booking requests/min ≈ 152 HTTP req/s with 0 errors.** p95 was ≤ 305 ms on every endpoint, with 0 double bookings. At 1,200 guests (181 req/s) there were still 0 errors but p95 rose to about 1 s. At 1,500 guests (225 req/s) requests started failing as the single API process saturated. |
| **Before these changes** | On the same box with 100k listings, **300 guests (44 req/s) already failed**: 7% errors, p50 12 s, database CPU 100%. With 20k listings, 300 guests worked but search p95 was 749 ms, and 1,000 guests gave 9% errors. |

Why Stays carries less traffic than Rides on the same box (152 vs 429 req/s): a search returns 50 full listings, **about 130 KB of JSON** per page. That costs far more CPU than a driver's 4-second poll. See section 5, item 1.

## 2. How a guest uses the API (the load model)

A browsing guest:
- searches every ~30 s: city weighted by demand (Damascus 35%, Aleppo 14%, Latakia 14%, Tartus 10%, …); a third of searches add filters (bedrooms, amenities, price) or a price sort; 30% load page 2;
- opens a listing every ~20 s; for half of those, also reads the calendar (availability) and a price quote.

That is about **0.15 requests/s per browsing guest**.

Booking requests run at a separate rate per minute. Each request runs:
1. calendar
2. quote
3. `POST /api/bookings`
4. view the booking
5. cancel after 10 s, which frees the dates

20% of booking requests target 10 "hot" listings on the same dates, so requests really collide. Bookings stay unpaid and are cancelled; no payment is attempted.

## 3. Measured bottlenecks and fixes

| # | Bottleneck (evidence) | Change |
|---|---|---|
| 1 | **The search query read and sorted every approved stay in the city.** Hiding unverified hosts was a join to `users` in the same SQL. With ~1M users and few verified hosts, Postgres expected almost no rows to survive, so it dropped the `(division, status, created_at, id)` index and read, joined and sorted all listings. EXPLAIN: 76 ms vs 2.5 ms for the same page at 20k listings, growing linearly; it saturated the database at 100k. | Host verification is checked per row in the scan loop with `isListingPubliclyVisible()`, the same rule the detail page uses. The owner's verification time is loaded with the batch and never returned. (`server/routes/listings.mjs`) |
| 2 | **Search filters (bedrooms, amenities, property type) caused the same full scan.** They are JSON-path conditions Postgres cannot estimate: 60–120 ms per search under load. | The scan walks candidates in sort order using only indexable conditions, then applies the JSON filters in a second query bounded by the batch's ids. Same rows, same order, same filter semantics. The cap is 2,000 candidates per request with filters (1,000 without). A very selective filter can return a short page; it still has `nextCursor`, and the app already shows "load more". |
| 3 | **Every search ran an `UPDATE` over all approved listings** to expire lapsed ones. | That sweep now runs at most once a minute per process, in the background. Search itself excludes rows whose `expiresAt` has passed, so results are exact without it. (`expireOldListingsThrottled`, `server/lib/listing-lifecycle.mjs`) |
| 4 | **Search loaded photos and locations for 250 rows to return 50.** | The scan reads only the sort key, flags and visibility. Full rows, locations and photos are loaded for the ≤ 50 rows returned. The first batch is 100 rows. Photos are returned in a defined order (`sortOrder`, then creation). |
| 5 | **Booking requests for one listing could fail with HTTP 500 instead of 409.** Booking creation holds a per-listing advisory lock on its transaction, but read price overrides on a **second** pooled connection. With several guests racing, every connection could be held by transactions waiting for the lock while the lock holder waited for a connection. Measured on the old code: `concurrent-booking` e2e gave **10 of 10 → 500** (P2024/P2028 after 2–10 s). | The price read uses the transaction's own connection (`computeStayTotalMinor(..., tx)`). The same e2e now passes 3/3 runs: exactly one 201 and nine clean 409s. |
| 6 | **The listing calendar returned every booking the listing ever had**, so the payload grew forever. | It returns only stays that are not over yet. Past stays never block a date. |

**Already correct, and verified rather than changed:**
- **No double booking:** a database exclusion constraint (migration 070) plus the per-listing advisory lock.
- **Stripe confirmation and webhook for bookings** are idempotent through the unique `(provider, providerRef)` constraint and the race handler in `stripe-checkout-apply.mjs`.
- **Every load run's verifier found 0 overlapping active bookings, 0 double-approved payment proofs and 0 double-succeeded payment intents**, including the overloaded runs.

## 4. Load-test results

**Tools** (new; they refuse non-local targets, or a remote database without the staging marker):
- `scripts/stay-loadtest-seed.mjs` — synthetic verified hosts, approved stays with locations, photos, calendars and history, and guests with session tokens. 100k listings take about 30 s.
- `scripts/stay-loadtest-run.mjs` — open-loop runner implementing the model in section 2.
- `scripts/stay-loadtest-verify.mjs` — correctness checks.
- `loadtest/k6/stays.js` — the same model for k6, local or staging, with the safety checks from `loadtest/k6/README.md`.

Commands:

```
REGISTERED=... LISTINGS=100000 GUESTS=3000 node scripts/stay-loadtest-seed.mjs
BROWSERS=1000 BOOK_RATE=100 DURATION=60 node scripts/stay-loadtest-run.mjs
node scripts/stay-loadtest-verify.mjs
```

**Results** (60 s per tier, one API process, `DB_POOL_SIZE=20`):

- p95 values are in ms.
- "Old" rows ran the code before these Stays changes. `stay-base-b300` ran the Rides branch (pool 20). `base-100k` ran `main` (Prisma default pool 5); its database CPU sat at 100%, so it was database-bound regardless of pool size.

| Run | Listings | Browsing guests | Booking req/min | HTTP req/s | Errors | Search p50 / p95 | Detail p95 | Quote p95 | Booking p95 | DB CPU |
|---|---|---|---|---|---|---|---|---|---|---|
| old, b300 | 20k | 300 | 30 | 45.5 | 0% | 188 / 749 | 412 | 362 | 708 | 51% |
| old, b300 | **100k** | 300 | 30 | 44.3 offered | **7.3%** | 12,762 / 18,522 | 18,027 | 17,889 | 17,882 | **102%** |
| fixes 1+3+4+6, b600 | 20k | 600 | 60 | 89.5 | 0% | 197 / 618 | 567 | 528 | 742 | 55% |
| fixes 1+3+4+6, b1000 | 20k | 1,000 | 100 | 149 offered | 9.1% | — | — | — | — | 54% |
| + fix 2, b600 | 20k | 600 | 60 | 91.0 | 0% | 41 / 108 | 73 | 63 | 109 | 28% |
| + fix 2, b1000 | 20k | 1,000 | 100 | 151.5 | **0%** | 112 / 335 | 294 | 268 | 346 | 38% |
| + fix 2, b600 | **100k** | 600 | 60 | 90.5 | 0% | 46 / 154 | 112 | 98 | 76 | 27% |
| **final, b1000 (highest clean tier)** | **100k** | **1,000** | **100** | **151.6** | **0%** | **83 / 305** | **278** | **255** | **265** | 29% |
| final, b1200 | 100k | 1,200 | 120 | 181.2 | 0% | 217 / 1,009 | 911 | 893 | 997 | 39% |
| final, b1500 | 100k | 1,500 | 150 | 225 offered | 0.6% (59 of 148 bookings failed) | 8,753 / 17,873 | 14,886 | 14,779 | 10,458 | 46% |

- **Correctness violations were 0 in every run**, including the overloaded ones.
- **Beyond b1200 the limit is the single API process.** Database CPU stays under 50%, so more API processes or instances raise the ceiling; the Rides report covers cluster mode and staging.
- **The database-CPU figure is a sampled sum of `postgres` processes from `top`**, so treat it as indicative only.

## 5. Next steps, in priority order

1. **Slim the search payload.** Each result page is ~130 KB because every card carries the full description, all photos and all metadata. A card needs a title, price, city, one or two photos and a few attributes.
   - This would cut the API CPU per search several-fold and is the largest remaining Stays cost.
   - It also cuts bandwidth, which Render bills at $0.15/GB over the plan allowance. 50,000 searches a day is about 200 GB a month.
   - It changes what the app receives, so it needs a coordinated front-end change (a `fields=card` parameter is the safe path). Not done here.
2. **Move search to a dedicated query** once the catalogue passes a few hundred thousand stays: normalised `city` and `bedrooms` columns, and amenities as a `text[]` with a GIN index. Today's search is bounded per request but still examines up to 2,000 candidates for rare filter combinations.
3. **Run the same staging test as Rides:** `loadtest/k6/stays.js`, profiles `staging-launch`, `staging-step`, `staging-soak`, using the cost estimate in `docs/launch/RIDES_K6_STAGING_COST.md`. It needs no extra services.
4. **Add HTTP caching for anonymous search and detail** once traffic justifies it. Results are public, so a short `Cache-Control` with a CDN in front would absorb repeated city searches.
5. **Host dashboard and messages were not load-tested.** They are low volume compared with guest browsing.

## 6. Tests (exact results)

| Test | Result |
|---|---|
| New `tests/e2e/stays-search-scale.e2e.mjs` | **26/26 pass**, on both old and new code, so the result set did not change. It covers every sort × 4 filter combinations, paged to the end and compared row by row with a direct computation; no duplicates across pages; unverified-host stays never shown; expired stays never shown even before the expiry sweep runs. |
| `concurrent-booking` | Old code 0/3 (all 10 racers got 500). New code **3/3 in each of 3 runs**. |
| Pass, unchanged | `listing-search-filters` 10/10, `host-verification` 61/61, `booking-no-overlap-db` 3/3, `split-stay` 13/13 |
| Fail identically on old and new code (local fixture or seed differences) | `listing-approval-activation` 50/52, `booking-money-flow` (3 finalize checks), `advertising-payment-tunnel` (3 checks), `payment-intents-booking` (exits with code 2 on both) |
| Unit tests | **354/354 pass** |
| Builds | `build:rezekme-stay`, `build:rezekme-rides` and `build:rezekme-admin` all **pass** (tsc + vite) |
