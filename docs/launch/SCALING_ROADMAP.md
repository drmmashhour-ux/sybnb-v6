# SYBNB — Scaling Roadmap (10K → 100K → 1M registered users)
Measure-driven, cost-conscious. **Scale the bottleneck the metrics show — not the calendar.** 1M *registered* ≠ 1M concurrent (compute scales with peak concurrent / RPS, typically ~1–5% of registered). Bottleneck order for SYBNB: **DB connections/queries → app compute → cache/CDN → storage** (R2 is edge-served + free-egress, rarely the limit).

Move to the next stage when any of these sit **>70% sustained**: API CPU/mem, DB CPU, DB connections vs. limit, or p95 latency trending up / error rate rising.

## Stage 0 — Launch (single instance)
1× Render API + 1× Postgres (Pro-4gb) + R2 + Resend + Vercel. Good for low-thousands registered / tens concurrent. **Action:** watch Render Metrics; enable alerts.

## Stage 1 — ~10,000 registered
- API → **Standard (2 GB/1 CPU)**; Postgres Pro-4gb still ample.
- **Enable Render Connection Pool** + set `connection_limit` in `DATABASE_URL`.
- Cache hot reads (division listings, short TTL); media already on Cloudflare CDN.
- Alerts: p95, error rate, DB connections. Load-test Stage A/B.

## Stage 2 — ~100,000 registered (horizontal) — REQUIRES these code changes first
Multi-replica can't share in-process state, so land these **before** scaling out (seams already exist in the code):
1. **DB pooler** (PgBouncer / Render pool / Prisma Accelerate) + per-replica `connection_limit`.
2. **Rate limiting → Redis** (today per-process; weakens with replicas).
3. **Email replay-guard + suppression → shared store** (Redis/Postgres; restart-durable, injectable-store seam present in `server/lib/email.mjs`).
4. **Background queue** for OTP/email sends + expiry jobs (off the request path).
5. **Cursor pagination** on search; **cron** `scripts/prune-expired-otps.mjs`.
Then: **2–4 autoscaled API replicas**, a **Postgres read replica** for search/browse, **Redis** cache. Load-test Stage C (10× expected).

## Stage 3 — ~1,000,000 registered (scale-out + resilience)
- **Autoscaling API** (N replicas). If Render's ceiling is hit, lift-and-shift compute to **Cloud Run** (usage-based autoscale; app is stateless).
- **Postgres:** vertical scale (Pro-16gb+) **+ multiple read replicas**; partition hot tables (`bookings`, `verification_codes`, `messages`); evaluate **Cloud SQL**.
- **Redis cluster** (cache + rate-limit + queue); **queue workers** scaled independently.
- **CDN** for all media/static; full observability (dashboards, error monitoring, slow-query, cost).
- **Backups/PITR + DR runbook + tested rollback.** Prove Stage D load tests; publish measured p50/p95/p99, RPS, DB connections, cost — **only then claim the number.**

## Capacity targets to define + measure (never claim un-measured)
registered · MAU · DAU · peak concurrent sessions · RPS · search RPS · DB connections · uploads/s · messaging · OTP/email throughput.

## SYBNB status today
- ✅ Foundation scale-ready: stateless HMAC auth, OTP state in DB, hot-path indexes, object storage (prod fail-closed), health/readiness, structured logging, HTTP timeouts + OTP retention (`c0fb3bb`).
- ⏳ Stage-2 code changes identified, seams in place, deferred until multiple replicas are actually needed.
- ❗ No capacity proven yet — needs load tests once staging exists. Until then, 1M is a **design target, not a claim.**
