# SYBNB — Render + Cloudflare R2 Deploy Prep (no resources created)

Repository prep for the chosen stack: **Render (API) + Render Postgres (fallback Neon) + Cloudflare R2
(storage) + Vercel (frontend) + Resend (email, untouched)**. This documents how to deploy; **nothing is
provisioned** — no Render service, database, R2 bucket, DNS, secret, or webhook is created here.

> **Provisioning gate (unchanged):** do NOT create the Render service, database, or R2 bucket until
> **Render, the Postgres provider, Cloudflare, and Resend each give written confirmation** that the
> intended lawful Syria-facing service is permitted, and counsel signs off (sanctions/export + data region).

## What changed in the repo (this phase)
- `server/index.mjs`: binds `0.0.0.0` in production and honors the host-injected `PORT`
  (`API_PORT || PORT || 3051`); dev/test stay on `127.0.0.1`. **Verified:** prod boot logs
  `host:"0.0.0.0"`, listens on `*:PORT`, health 200; governed suites + deploy-sim still 0 failures.
- `Dockerfile` (+ `.dockerignore`): builds the **API only** (SPA stays on Vercel). Includes
  `node_modules` (with generated Prisma client), `server/`, **`countries/`** (required by
  `server/lib/country.mjs`), and `prisma/`. openssl installed for the Prisma engine. No secrets baked in.
- **Container validated locally:** `docker build` succeeds; `docker run` (NODE_ENV=production, injected
  PORT) logs `server_listening host:"0.0.0.0"` and serves `GET /api/health/live` → **200**. First boot
  takes ~10s (Node + Prisma client import) → **set the Render health-check initial delay accordingly**
  (`/api/health/ready` after startup grace). Image is not pushed anywhere.

## Render service (Web Service) — settings to use at provisioning time
- **Runtime:** Docker (repo `Dockerfile`) — or Node (Build `npm ci && npx prisma generate`, Start `node server/index.mjs`).
- **Start command:** `node server/index.mjs` (Render injects `PORT`; the app now binds `0.0.0.0:$PORT`).
- **Health check path:** `/api/health/ready` (readiness incl. DB). Liveness: `/api/health/live`.
- **Custom domain:** `api.sybnb.app` (managed TLS). CORS: set `CORS_ORIGIN` to the frontend origin(s).
- **Migrations (separate deploy step, not in the image):**
  `npx prisma migrate deploy` then `npx prisma migrate status` (expect "up to date"; 11 migrations, all additive).
- **Graceful shutdown:** app handles SIGTERM (logs `server_shutdown`) — Render rolling deploys are clean.

## Cloudflare R2 configuration (S3-compatible — no code change)
The existing SigV4 client supports R2 via a custom endpoint. Set (names only; values in the secret store):
- `STORAGE_PROVIDER=s3`
- `STORAGE_S3_BUCKET` = the R2 bucket name
- `STORAGE_S3_REGION` = `auto` (R2)
- `STORAGE_S3_ENDPOINT` = `https://<accountid>.r2.cloudflarestorage.com`
- `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` = R2 API token (S3 credentials)
- `STORAGE_S3_FORCE_PATH_STYLE` = `true` (recommended for R2)
Presigned GET is already implemented (`presignGetS3`). Uploads go through the API (no direct-to-bucket
browser CORS needed today). **Compatibility to confirm at provisioning:** run `scripts/certify-providers.mjs`
with the R2 vars set — it does a real put/get/delete round-trip. Until then, R2 compatibility is
"config-ready, provider-cert pending."

## Environment variables to set in Render (NAMES ONLY — values never in git)
Required: `SYBNB_COUNTRY=syria`, `AUTH_SECRET`, `PHONE_HASH_SECRET`, `DATABASE_URL` (from Render PG/Neon),
`NODE_ENV=production`, `CORS_ORIGIN`. Storage: the `STORAGE_*` set above. Email: `EMAIL_PROVIDER=resend`,
`RESEND_API_KEY` (new production key — not the local cert key), `EMAIL_FROM=no-reply@notifications.sybnb.app`,
later `RESEND_WEBHOOK_SECRET`. **Keep UNSET (payments OFF):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`PAYMENT_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `SYP_PER_USD`. **Never set:** `OTP_EXPOSE_FOR_TEST`,
`STORAGE_ALLOW_LOCAL` (both rejected in production).

## Database (Render Postgres or Neon)
Standard PG; `prisma migrate deploy` compatible. Take a `pg_dump` **before** the first migrate as the
rollback point. If a pooled provider (Neon) is used with an autoscaling host, use the pooled
`DATABASE_URL` (and optionally a `directUrl` for migrations). No DB created here.

## Rollback
Code: redeploy the prior image / `git revert` the candidate. DB: restore the pre-deploy `pg_dump`
(migrations are additive; 011 is index-only — safe to leave on a code rollback). Deployed rollback
drill remains part of the deployment gate.

## Still NOT done (deployment-authoritative / external)
- Actual `docker build` on a running daemon / Render's builder (daemon not running locally).
- Create Render service / Postgres / R2 bucket · set production secrets · add `api.sybnb.app` DNS ·
  run deployed smoke + rollback · R2 provider cert · Resend production key + webhook route.
- **Written Syria-service confirmation + DPA** from Render, Postgres provider, Cloudflare, Resend + counsel.

## Charge-creating actions (none taken)
Creating the Render service (paid instance) · Render/Neon Postgres (paid tier for PITR/HA) · R2 bucket
(usage-based). All deferred until the stack is authorized.

**Payments OFF · public access CLOSED · Resend outbound untouched · verdict CONDITIONAL GO (unchanged).**
