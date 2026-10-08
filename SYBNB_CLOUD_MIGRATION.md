# SYBNB V6 — Cloud Migration Runbook (Managed Stack)

Goal: move SYBNB off the current host onto a managed cloud stack, the same spirit as the JobLop
move but sized for a real app (API + Postgres/PostGIS + object storage can't run on free Cloudflare).

## Target architecture

| Piece      | Provider                     | Notes |
|------------|------------------------------|-------|
| Frontend   | **Cloudflare Pages** (free)  | Vite/React SPA, hash routing (no rewrite rules needed). |
| API        | **Render** (Docker, ~$7/mo)  | Uses the repo `Dockerfile`; `render.yaml` blueprint included. |
| Database   | **Neon** (Postgres 16 + PostGIS; free tier ok to start) | PostGIS is REQUIRED (migration 001 does `CREATE EXTENSION postgis`). |
| Storage    | **Cloudflare R2** (S3-compatible) | `STORAGE_PROVIDER=s3` + R2 endpoint, `FORCE_PATH_STYLE=true`, region `auto`. |
| Email      | **Resend** (already used for JobLop) | Primary auth channel for Syria. Verify the sybnb.app sender domain. |
| DNS        | **Cloudflare** (sybnb.app zone) | `sybnb.app` → Pages; `api.sybnb.app` → Render. |

Everything the code needs is already wired through env vars (`.env.example`); nothing in the app
code has to change for the move.

---

## What you do vs. what I prepared

I can't create accounts or type credentials into third-party dashboards (safety rule). So the
account sign-ups and secret entry below are **your** steps; I've made the repo one-click ready
(`Dockerfile`, `render.yaml`, PostGIS migration, fail-closed prod guards, health checks) and will
verify each stage with you as you go.

---

## Step 1 — Database (Neon)
1. Create a Neon project (region closest to the API, e.g. EU/Frankfurt). Postgres 16.
2. In the Neon SQL editor run: `CREATE EXTENSION IF NOT EXISTS postgis;` (migration 001 also does
   this, but enabling it first avoids first-deploy ordering surprises on some plans).
3. Copy the **pooled** connection string. Append `?schema=public&sslmode=require` and, because Neon
   pools via PgBouncer, `&pgbouncer=true&connection_limit=10&pool_timeout=20`.
4. Keep it for `DATABASE_URL`.

## Step 2 — Object storage (Cloudflare R2)
1. Cloudflare dashboard → R2 → Create bucket `sybnb-media` (or similar).
2. R2 → Manage API Tokens → create an S3 token (Read & Write). Note Access Key ID + Secret.
3. Your endpoint is `https://<accountid>.r2.cloudflarestorage.com`.
4. Keep: `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY_ID`,
   `STORAGE_S3_SECRET_ACCESS_KEY`. Region is `auto`, `STORAGE_S3_FORCE_PATH_STYLE=true`.
   (Optional: a public R2.dev or custom-domain binding if media must be publicly served.)

## Step 3 — Email (Resend)
1. Reuse the Resend account from JobLop. Add & verify the **sybnb.app** domain (SPF/DKIM records
   go in the Cloudflare DNS zone — same as JobLop).
2. Create an API key. Set `EMAIL_FROM=no-reply@sybnb.app`, `RESEND_API_KEY`, and a
   `RESEND_WEBHOOK_SECRET` for the inbound/bounce webhook.

## Step 4 — API (Render)
1. Render → New → Blueprint → connect the sybnb-v6 repo → it reads `render.yaml`.
2. Fill the `sync:false` secrets in the Render dashboard: `DATABASE_URL` (Step 1),
   `AUTH_SECRET` + `PHONE_HASH_SECRET` (generate: `openssl rand -hex 32` each),
   `CORS_ORIGIN=https://sybnb.app`, the R2 keys (Step 2), the Resend keys (Step 3).
3. Deploy. The pre-deploy step runs `prisma migrate deploy` (expect ~11+ migrations on a fresh DB),
   then the service boots and must pass `/api/health/ready`.
4. Add a custom domain `api.sybnb.app` in Render; it gives you a CNAME target.
5. Bootstrap the first admin once: Render Shell → `npm run bootstrap:admin`.

## Step 5 — Frontend (Cloudflare Pages)
1. Cloudflare → Workers & Pages → Create → Pages → connect the repo.
2. Build command: `npm run build`   •   Output dir: `dist`   •   Node 20+.
3. Environment variable: `VITE_API_BASE_URL=https://api.sybnb.app` (build-time).
4. Deploy → you get a `*.pages.dev` URL to smoke-test before DNS.

## Step 6 — DNS cutover (Cloudflare zone for sybnb.app)
1. `api.sybnb.app` → CNAME → the Render target (proxied/grey per Render's guidance).
2. `sybnb.app` + `www` → the Pages project (Pages → Custom domains).
3. Confirm `CORS_ORIGIN` on Render = `https://sybnb.app` (add `https://www.sybnb.app` if you keep www).
4. Verify end to end: open sybnb.app, run the real-user flows (search, account/email OTP, listing,
   a ride quote), confirm media uploads land in R2 and emails arrive via Resend.

## Rollback
- Pages and Render both keep every deployment — roll back in one click.
- DNS: lower the record TTLs before cutover so a revert propagates fast. Keep the old host running
  until the new stack passes the end-to-end check (same no-downtime approach as JobLop).

## Cost to start
Render API ~$7/mo + Neon free (upgrade when traffic grows) + R2 (free up to 10GB) + Pages free +
Resend free tier. Roughly **$7–15/mo** at launch, scaling with usage.

## Not included (deliberately)
Live Stripe payments stay OFF (`PAYMENTS_ENABLED` unset) until you explicitly authorize them; the
Syrian local-wallet/QR manual-proof flow works without Stripe.
