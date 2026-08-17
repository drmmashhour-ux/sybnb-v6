# SYBNB — 1,000,000-User Scale Readiness Report
**Read-only assessment. No production infrastructure was changed. Load tests ran on an ISOLATED local environment with synthetic data only — production was never load-tested.** Guards held throughout: `payments=DISABLED`, `publicAccess=CLOSED`, Vercel Require-Log-In ON, authority-review synthetic inventory isolated + removable.

Assessed at frozen commit `d2dcfa6`. Evidence: code audit (`file:line`), measured load tests (25k-listing isolated env), and `EXPLAIN ANALYZE`.

> **Bottom line:** SYBNB is **architecturally sound but single-replica-bound today**. It is not proven for 1M and cannot horizontally scale as-is (two in-memory subsystems break correctness on replica #2). It can realistically serve **low-tens-of-thousands of registered users on one well-sized replica** once a connection pooler + session cache are added. Reaching 100k → 1M requires the staged changes below — none are rewrites; the seams already exist.

---

## 1. Workload assumptions (registered ≠ concurrent ≠ RPS)
Marketplace browse-heavy pattern. Peak concurrent ≈ 1–3% of registered; peak RPS ≈ concurrent × ~0.5 req/s/active session.

| Registered | Peak concurrent sessions | Peak RPS (est.) | Write mix |
|---|---|---|---|
| 10k | 100–300 | 50–150 | ~5–10% |
| 50k | 500–1,500 | 250–750 | ~5–10% |
| 100k | 1k–3k | 500–1,500 | ~8–12% |
| 250k | 2.5k–7.5k | 1.25k–3.75k | ~8–12% |
| 500k | 5k–15k | 2.5k–7.5k | ~10–15% |
| 1M | 10k–30k | 5k–15k | ~10–15% |

---

## 2. Measured baseline (isolated load test — evidence)
Isolated env: single Node API process, local PostgreSQL 18, **25,000 APPROVED listings** seeded (`scripts/loadtest-seed.mjs`), read-heavy journey mix (40% division search, 15% filtered search, 20% detail, 17% availability, 8% health) via `scripts/loadtest-run.mjs`, 8s per level.

| Concurrency | Throughput | Search p50/p95/p99 | Detail p95 | Availability p95 | Error rate |
|---|---|---|---|---|---|
| 25 | **1,530 rps** | 20 / 41 / 63 ms | 27 ms | 15 ms | **0.00%** |
| 50 | **1,693 rps** (peak) | 31 / 78 / 125 ms | 55 ms | 25 ms | **0.00%** |
| 100 | 1,250 rps | 76 / 205 / 313 ms | 163 ms | 79 ms | **0.00%** |
| 200 | 1,419 rps | 138 / 320 / 378 ms | 300 ms | 171 ms | **0.00%** |

**First observed bottleneck: single Node event-loop CPU saturation.** Throughput peaks at concurrency ~50 (~1,700 rps) then latency climbs ~4× while throughput falls — classic single-core saturation (Node runs one event loop; no clustering, `index.mjs`). Zero errors throughout — the server degrades gracefully, it does not fail.

**`EXPLAIN ANALYZE` evidence (25k rows):**
- Division browse: `Bitmap Index Scan on listings_division_status_idx` → **in-memory top-N sort on `created_at`** (8.0 ms). Scales with division size — at millions this scans every matching row before sorting.
- Metadata filter (`visualFilters.propertyType`): **post-scan `Filter`, NOT indexed** — `Rows Removed by Filter: 4167`. Confirms search is inventory-bound.
- Idle single process held **22 Postgres connections** (pool = `CPUs×2+1`, uncapped).

> **Production caveat (honest):** these numbers are *optimistic* vs production — local DB has no network latency and a large pool (22). A small Render instance has ~1 CPU (~3-connection pool) and network round-trips to Postgres; expect **materially lower per-replica RPS (order ~200–600 rps)** and the **connection pool to bottleneck before CPU**. Treat the local test as *relative scaling evidence*, not an absolute prod capacity claim.

---

## 3. Per-area capacity assessment (PASS / CONDITIONAL / FAIL by scale)
`P`=PASS, `C`=CONDITIONAL (works only with the listed change), `F`=FAIL.

| Area | 10k | 100k | 500k | 1M | First-bite & required change |
|---|---|---|---|---|---|
| **DB connections / pooling** (`prisma.mjs:5-10`, no pooler; `auth-context.mjs:10` per-request user+roles DB lookup) | C | F | F | F | ~5–20k. **PgBouncer/Accelerate + `connection_limit` + cache session lookup.** |
| **Rate-limit / email guards** (in-memory `Map`/`Set`, not shared — `auth.mjs:20`, `otp.mjs:24`, `email.mjs:102`) | P(1 replica) | F | F | F | The instant a 2nd replica runs. **Move to Redis.** |
| **Search / filter** (JSON metadata post-filter, no GIN; `created_at` unindexed) | P | C | F | F | ~100–500k listings. **GIN/promoted columns + `(division,status,created_at)` index.** |
| **Pagination** (first-page-only, `take:50` no cursor — `listings.mjs:91`) | C | C | F | F | UX at ~10k listings. **Cursor pagination.** |
| **Booking double-booking guard** (`bookings.mjs:322-351` advisory-lock txn) | P | P | P | P | Sound + multi-replica-safe. Optional: `btree_gist` exclusion backstop. |
| **Async queue** (none; sends + expiry on request path — `otp.mjs:73`, `listings.mjs:45`) | P | C | F | F | ~50k / signup spikes. **Queue + retry/DLQ; cron the expiry.** |
| **Media fan-out on list** (`media:true` unbounded, `listings.mjs:88`) | P | C | F | F | ~10k listings. **Cover-image-only on list.** |
| **HTTP server** (timeouts set; no `maxConnections`, single process — `index.mjs:170`) | P | C | F | F | **Replicas + `maxConnections` + body cap; 1 proc/CPU.** |
| **Observability** (structured logs + health; no metrics/tracing/SLO — `logger.mjs`) | C | F | F | F | **`/metrics` + latency histograms + error monitor + slow-query log.** |
| **Retention** (OTP prune script exists but **no cron wired**; audit_logs/messages unbounded) | C | F | F | F | **Register cron; partition audit_logs/messages.** |
| **Multi-region / DR** (single Postgres, no PITR config in repo) | C | F | F | F | **Enable PITR now; read replica; DR runbook.** |
| **Auth (HMAC verify)** (`security.mjs:95`) | P | P | P | P | Negligible CPU; sound. |

---

## 4. Capacity & Cost Matrix (10k → 1M) — indicative monthly infra
Order-of-magnitude for planning (Vercel + Render + Cloudflare R2 + Resend + Redis). Actuals depend on measured RPS and media volume; **not a quote.**

| Registered | Frontend (Vercel) | API (Render) | PostgreSQL | Redis | R2 storage/egress | Email (Resend) | Observability | **~ Monthly total** |
|---|---|---|---|---|---|---|---|---|
| **10k** | Pro | 1× Standard (2GB) | Pro-4gb + **pooler** | — (opt.) | ~50 GB, free egress | ~50k emails | logs | **~$120–250** |
| **50k** | Pro | 2× Standard + autoscale | Pro-4gb + pooler | 1× small | ~250 GB | ~250k | + metrics | **~$350–600** |
| **100k** | Pro | 2–4× autoscaled | Pro-8gb + pooler + **read replica** | 1× | ~0.5 TB | ~500k | metrics+alerts | **~$700–1.3k** |
| **250k** | Pro/Ent | 4–8× autoscaled | Pro-16gb + 1–2 replicas | cluster (small) | ~1–2 TB | ~1.5M | full APM | **~$1.8–3.5k** |
| **500k** | Ent + CDN | 8–16× (or Cloud Run) | 16gb+ + 2–3 replicas + partitioning | cluster | ~3–5 TB | ~3M | full APM+tracing | **~$4–8k** |
| **1M** | Ent + CDN | autoscale N (Cloud Run) | large + read replicas + partitioned hot tables | cluster (HA) | ~6–10 TB | ~6M | full o11y + on-call | **~$9–18k** |

R2 is edge-served with free egress → rarely the cost driver. The dominant cost curve is **API compute + Postgres** as concurrency rises.

---

## 5. Bottleneck & remediation roadmap (required vs premature)
### Top 5 blocking bottlenecks (ranked)
1. **No DB pooler + per-request session DB lookup** — hard ceiling on replicas; bites ~5–20k. *(Stage-1)*
2. **In-memory rate-limit + email suppression/replay** — breaks correctness on replica #2 (bypassable limits, broken bounce-suppression). *(Stage-2, MUST precede horizontal scale)*
3. **Unindexed JSON-metadata search + unindexed `created_at` sort** — DB CPU climbs with inventory ~100–500k listings. *(Stage-2)*
4. **No async queue; sends + expiry on request path** — provider latency couples to request latency; bites ~50k / signup spikes. *(Stage-2)*
5. **First-page-only lists + full media fan-out** — UX gap + payload bloat from ~10k listings. *(Stage-1/2)*

### Required BEFORE each milestone
- **Before 100k:** DB pooler + `connection_limit`; cache/trust session roles (stop per-request user fetch); Redis-backed rate-limit + email guard; GIN/promoted search columns + `(division,status,created_at)` index; cursor pagination; cover-image-only list; register OTP-prune cron; enable PITR/backups; add `/metrics` + error monitor.
- **Before 250k:** 4–8 autoscaled replicas behind pooler; 1 Postgres read replica routing browse/search; async queue (retry+DLQ) for OTP/email; `server.maxConnections` + body cap; alerting + SLOs.
- **Before 500k:** 2–3 read replicas; partition `bookings`, `messages`, `admin_audit_logs`, `verification_codes`; Redis cluster; tracing/APM; evaluate Cloud Run for API autoscale.
- **Before 1M:** N-replica autoscale; large Postgres + multiple read replicas + partitioned hot tables; HA Redis; full observability + on-call; tested DR runbook (RPO/RTO); prove Stage-D load tests on staging and **publish measured p50/p95/p99 before claiming the number.**

### Premature optimization (do NOT do yet)
Sharding/microservices split, multi-region active-active writes, `btree_gist` exclusion constraint (advisory lock already correct), custom caching layers beyond Redis, GraphQL/edge-compute rewrites. Scale the measured bottleneck, not the calendar.

---

## 6. Scale verdict
### NOT READY for 1,000,000 users today — CONDITIONAL to low-tens-of-thousands on one replica.
- **Proven now (measured):** stable, **0% error** up to 200 concurrent on 25k listings; correct double-booking prevention; graceful degradation; sound stateless auth. Good single-replica foundation.
- **Blocks horizontal scale (correctness, not just perf):** in-memory rate-limit + email guards — **must** move to a shared store before replica #2.
- **Blocks large inventory:** unindexed JSON search + no cursor pagination.
- **Not yet proven:** no staging load test at target RPS, no metrics to compute prod p95/p99, no DR. **1M remains a design target, not a claim, until Stage-D load tests on staging publish the numbers.**

**Recommended next infra step (owner-authorized, non-destructive):** add the DB connection pooler + `connection_limit` and register the OTP-prune cron — the two lowest-risk, highest-leverage Stage-1 items — then re-measure on a staging replica.
