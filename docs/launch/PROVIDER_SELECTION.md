# SYBNB — Infrastructure Provider Selection (evaluation only)

Evaluation + recommendation. **Nothing provisioned; no projects, DBs, buckets, DNS, secrets, webhooks,
or deployments created. No code changed.** Preserves runtime `d1fd5b9`, docs `7a932ee`, Resend Phase 11
CLOSED/PASSED, payments OFF, public access CLOSED, verdict CONDITIONAL GO.

> **Gating caveat (applies to every US-based option below):** Syria-service permission is a hard
> external gate. Render, Google Cloud, Fly.io, AWS, Cloudflare, Neon, and Supabase are all
> US-jurisdiction providers with sanctions/export exposure for Syria-connected services. **No option
> here is "accepted" until the provider gives written confirmation it permits the intended lawful
> Syria-facing use, and counsel signs off.** If none will, use the **Syria-flexibility fallback** (§Fallback).

## Established constraints
Raw persistent Node HTTP API · Vite SPA frontend · no Redis · no worker · Postgres via `DATABASE_URL` ·
S3-compatible storage (`STORAGE_S3_*`, SigV4, supports `STORAGE_S3_ENDPOINT`+path-style) · `sybnb.app`
DNS on Vercel · `notifications.sybnb.app` Resend-verified (untouched) · payments disabled.

---

## 1. API hosting
All three run the existing raw Node server in a container with **no architectural rewrite**, provided
two small config changes (see "Required repo changes"): bind `0.0.0.0` and honor the host-injected `PORT`.

| Criterion | **Render** | **Fly.io** | **Google Cloud Run** |
|---|---|---|---|
| Raw Node compat | ✅ native (Node or Docker), always-on instance | ✅ container/VM, always-on | ✅ container; must listen on `$PORT` (8080) + `0.0.0.0` |
| Build reqs | Nixpacks or `Dockerfile.template` | `Dockerfile` + `fly.toml` | `Dockerfile` + Cloud Build/Artifact Registry |
| Secret mgmt | env vars / secret files per service | `fly secrets` | Secret Manager + service-account |
| Custom domain/TLS | ✅ managed certs, add `api.sybnb.app` | ✅ managed certs | ✅ managed certs (domain mapping) |
| Health checks | ✅ HTTP path (`/api/health/ready`) | ✅ TCP/HTTP checks | ✅ startup/liveness probes |
| Autoscaling | vertical + horizontal (paid) | horizontal (regions/machines) | ✅ strong, scale-to-zero → N |
| Cold start | minimal (always-on) | minimal (min machines) | **scale-to-zero cold start**; mitigate with min-instances=1 (removes the cost benefit) |
| Logs/monitoring | built-in logs/metrics | built-in + Grafana | Cloud Logging/Monitoring |
| Network to managed PG | ✅ private network to **Render Postgres** | Fly PG / external over TLS | Cloud SQL via connector/proxy or external over TLS |
| Operational complexity | **lowest** | medium (fly.toml/volumes/regions) | medium–high (GCP IAM/registry/proxy) |
| Syria policy | ⚠️ confirm in writing | ⚠️ confirm in writing | ⚠️ confirm in writing |
| Cost structure (no guessing) | per-instance monthly tier + PG add-on | per-machine + volume usage | per-request/CPU-time; scale-to-zero can be cheap; **confirm current pricing on each site** |

**Assessment:** Render gives the **lowest operational overhead** and co-locates a managed Postgres on a
private network — best fit for "minimum ops + straightforward deploy + predictable rollback." Cloud Run
is the most elastic but adds GCP setup, needs the `PORT`/`0.0.0.0` change, and its scale-to-zero cold
start plus per-instance Prisma pools argue for a pooler + min-instances. Fly.io is capable but more
hands-on (fly.toml, volumes, regions).

## 2. Managed PostgreSQL
Prisma uses a single long-lived `PrismaClient` (one pool per instance) over `DATABASE_URL`. Any of these
are migration-compatible (`prisma migrate deploy`, standard PG). Autoscaling hosts (Cloud Run) should use
a **pooled** connection string.

| Criterion | **Render Postgres** | **Neon** | **Supabase Postgres** | **Cloud SQL** |
|---|---|---|---|---|
| PG compatibility | standard PG | standard PG (serverless) | standard PG | standard PG |
| Connection pooling | basic; add PgBouncer if needed | ✅ built-in pooler | ✅ Supavisor pooler | via PgBouncer/proxy |
| TLS | ✅ | ✅ | ✅ | ✅ (Auth Proxy) |
| Backups | ✅ managed | ✅ | ✅ | ✅ |
| PITR | higher tiers | ✅ (paid) | ✅ (paid) | ✅ |
| HA options | tiered | branch/replica | tiered | ✅ regional HA |
| Migration compat | ✅ | ✅ (use pooled URL; `directUrl` optional) | ✅ | ✅ |
| Operational burden | **low (same platform as Render)** | low (host-agnostic) | low–medium (extra features) | medium (GCP/proxy) |
| Network placement | private w/ Render API | network TLS (pairs with any host, incl. Cloud Run) | network TLS | best co-located w/ Cloud Run |

**Assessment:** If API on **Render → Render Postgres** (private network, one platform, managed backups;
PITR on higher tier). Host-agnostic alternative: **Neon** (built-in pooler + PITR) — the best pairing for
Cloud Run. Cloud SQL is strongest for HA but only worth its ops cost if the whole stack is GCP.

## 3. Object storage (S3-compatible)
The client is hand-rolled SigV4 with `STORAGE_S3_ENDPOINT` + `STORAGE_S3_FORCE_PATH_STYLE`; it already
does put/get/delete/**presign**.

| Criterion | **Cloudflare R2** | **AWS S3** | **Google Cloud Storage** |
|---|---|---|---|
| API compatibility with current `STORAGE_S3_*` | ✅ S3 API + SigV4; set `STORAGE_S3_ENDPOINT` to the R2 endpoint | ✅ native (default endpoint) | ⚠️ **Not guaranteed** — GCS "S3 interoperability" (XML+HMAC) exists but the hand-rolled SigV4 client is not verified against it; **would require a compatibility test, and possibly code changes** |
| Signed URL support | ✅ (SigV4 presign — `presignGetS3`) | ✅ | interop presign unverified here |
| Regional availability | global; location hints | many regions | many regions |
| CORS requirements | bucket CORS for browser GET/PUT if direct-to-storage; today uploads go via the API, so minimal | same | same |
| Operational complexity | low; **no egress fees** | low; egress costs | low; interop setup + risk |
| Required code changes | **none** (config only) | **none** (config only) | **unknown until tested** — do not assume |

**Assessment:** **Cloudflare R2** — S3-compatible, works with the current client via `STORAGE_S3_ENDPOINT`,
presign supported, no egress fees. Fallback **AWS S3** (native, zero code change, higher egress). **GCS
only if a round-trip test with the current SigV4 client passes** — otherwise it needs code changes; do
not assume compatibility.

---

## Recommended stack (preferred — conditional on written Syria confirmation)
- **Frontend:** **Vercel** (unchanged) — static SPA, already where `sybnb.app` DNS lives.
- **API:** **Render** (always-on Node service; managed TLS/domain, health check `/api/health/ready`, private PG network, simple secret store).
- **Postgres:** **Render Postgres** (co-located, managed backups; PITR on higher tier) — or **Neon** if a host-agnostic pooler/PITR is preferred.
- **Storage:** **Cloudflare R2** (S3-compatible, no egress, presign works, zero code change).
- **Email:** **Resend** (`notifications.sybnb.app`, already certified — untouched).

Why: lowest operational overhead, managed backups/PITR, private API↔DB network, strong per-service secret
isolation, straightforward container deploy, predictable rollback (revert image + restore dump),
compatible with existing code (config-only for storage), payments stay off (no `STRIPE_*`), and the
future Resend webhook is a simple route on the same API host.

## Fallback stacks
- **Managed fallback:** **Cloud Run (API) + Neon (Postgres, pooled) + Cloudflare R2** — more elastic; needs the `PORT`/`0.0.0.0` change + pooler + min-instances to tame cold start.
- **Syria-flexibility fallback (if no US major confirms Syria service):** self-managed VM on a Syria-permissive host + self-managed Postgres + MinIO or R2 — maximum policy control, higher ops (per `PROVIDER_RECOMMENDATIONS.md`).

## Architecture (text diagram)
```
                 ┌─────────────────────────── Vercel DNS (sybnb.app) ───────────────────────────┐
                 │                                                                               │
  Browser ──▶ sybnb.app / www.sybnb.app ──▶ [ Vercel: Vite SPA static ]                          │
     │                                                                                           │
     └──▶ api.sybnb.app ──▶ [ Render: Node HTTP API (persistent) ]                               │
                                   │   ├─ /api/health/live · /api/health/ready                    │
                                   │   ├─ (future) /api/webhooks/resend  ◀── Resend events        │
                                   │   ├─ TLS via host · secrets in host secret store             │
                                   │   ▼                                                           │
                                   ├─▶ [ Render Postgres / Neon ]  (private/TLS, DATABASE_URL)     │
                                   └─▶ [ Cloudflare R2 ]  (STORAGE_S3_* + endpoint, SigV4/presign) │
                                                                                                   │
  notifications.sybnb.app ──▶ [ Resend ] (email, VERIFIED — untouched) ◀── outbound email from API
  Payments: DISABLED (no STRIPE_*).   Public cutover: CLOSED.
```

## Domain plan (no DNS change made)
- `sybnb.app` / `www.sybnb.app` → **frontend** (Vercel).
- `api.sybnb.app` → **API** host (CNAME/records added in Vercel DNS at cutover).
- `notifications.sybnb.app` → **Resend** (untouched).

## Secret-store plan (variable NAMES only; values never printed)
Stored in the **API host secret store** (Render/Cloud Run): `SYBNB_COUNTRY`, `AUTH_SECRET`,
`PHONE_HASH_SECRET`, `DATABASE_URL` (from the PG provider), `CORS_ORIGIN`, `STORAGE_PROVIDER=s3`,
`STORAGE_S3_BUCKET`/`STORAGE_S3_REGION`/`STORAGE_S3_ACCESS_KEY_ID`/`STORAGE_S3_SECRET_ACCESS_KEY`
(+ `STORAGE_S3_ENDPOINT` for R2), `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (new production key),
`EMAIL_FROM`, later `RESEND_WEBHOOK_SECRET`, `NODE_ENV=production`.
**Kept UNSET (payments off):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_WEBHOOK_SECRET`,
`STRIPE_CURRENCY`, `SYP_PER_USD`. **Never set:** `OTP_EXPOSE_FOR_TEST`, `STORAGE_ALLOW_LOCAL`.
- **DB provider** issues `DATABASE_URL`; **R2** issues the `STORAGE_S3_*` keys; both are copied into the
  **API host** secret store. **Vercel** holds no runtime secrets (static SPA). `.env.resend.local` is
  local-only and **not** promoted to production.

## Required repository changes (NOT made — for the chosen host)
1. **Container bind (required):** default `API_HOST` to `0.0.0.0` in production and read the injected
   port (`API_PORT || PORT || 3051`) — the current `127.0.0.1` default won't accept traffic in a container.
2. **Dockerfile** finalized from `templates/Dockerfile.template`.
3. **Storage config** = env only (R2/S3); **GCS would need a verified compat test / possible code change**.
4. **Pooled `DATABASE_URL`** if the host autoscales (Cloud Run + Neon/PgBouncer); optional `directUrl` for migrations.
5. **Resend webhook route** `/api/webhooks/resend` — later, separate authorization.

## Provider-policy / legal — written confirmation required (per selected provider)
Written Syria-service permission from the chosen **API host**, **PG provider**, **storage provider**, and
Resend; each provider's **data region** + **DPA**; counsel sanctions/export + data-transfer review.

## Owner actions that would create charges (none taken)
Creating a Render service (paid instance) · Render/Neon/Supabase Postgres (paid tier for PITR/HA) ·
Cloudflare R2 bucket (usage-based) · any Cloud Run/Cloud SQL/AWS S3 resource · a new production Resend key
(no charge to create). **All deferred until you choose the stack.**

## Verdict
Evaluation complete; recommendation ready. No resource created, no code changed.
**CONDITIONAL GO — unchanged.**
