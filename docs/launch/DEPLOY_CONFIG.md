# SYBNB — Private Production Deployment Configuration (candidate `c0fb3bb`)
Exact, copy-paste settings for the frozen stack. **Payments OFF · publicAccess CLOSED.** Secret *values* are never in this file — only variable **names**. Do not paste secret values into chat.

Stack: **Vercel** (frontend) → **Render** (API + PostgreSQL) → **Cloudflare R2** (media) → **Resend** (email).

---

## Owner account actions (ordered) — each is one exact click-path
1. **Render → New → PostgreSQL** — `sybnb-production`, DB `sybnb`, **Frankfurt**, PG 16/17, **paid plan with backups**, PITR if offered. *(in progress)*
2. **Cloudflare → R2 → Create bucket** — name `sybnb-media`, same/EU region; create an **R2 API token** (Object Read & Write) → gives Access Key ID + Secret + S3 endpoint.
3. **Resend** — the domain `notifications.sybnb.app` is already verified; **create a new Production API key**; add the webhook (step below).
4. **Render → New → Web Service** (the API) — connect this repo, **same region as the DB (Frankfurt)**; settings in §B.
5. **Vercel → New Project** (the frontend) — import this repo; settings in §D.
6. Set the **environment variables** (§E) in each service's secret store.
7. Tell me each service is up (screenshots, secrets blurred). I run migrations, storage/email verification, smoke, backup rehearsal, and load test.

---

## §A. Render PostgreSQL
As specified: `sybnb-production` / DB `sybnb` / Frankfurt / PG 16 or 17 / paid + backups / PITR if available. Note the **Internal Database URL** (API uses this) and the plan's **max connections**.

## §B. Render Web Service — SYBNB API
- **Runtime:** Node · **Region:** **Frankfurt** (must match the DB) · **Instance:** Starter/Standard (single instance for controlled launch).
- **Build Command:** `npm install && npx prisma generate`
- **Pre-Deploy Command:** `npx prisma migrate deploy`   ← applies the 11 migrations with the internal DB URL; keeps the password in Render's secret store (never pasted).
- **Start Command:** `node server/index.mjs`
- **Health Check Path:** `/api/health/ready`
- **Auto-Deploy:** off (deploy the pinned `c0fb3bb` manually for a controlled cutover).
- Binds to Render's `PORT` automatically; `HOST` becomes `0.0.0.0` in production.

## §C. Cloudflare R2
- Bucket `sybnb-media` (private). Create an **R2 API token** (Object Read & Write) → note **Access Key ID**, **Secret**, and the **S3 API endpoint** (`https://<account>.r2.cloudflarestorage.com`).
- **CORS (bucket):** allow `PUT, GET` from the Vercel frontend origin only (added after the frontend domain exists). Media is served via presigned URLs, so no public bucket.
- ⚠️ Jurisdiction note (recorded, non-blocking for review): default/EEUR R2 buckets are **not** formal EU-jurisdiction buckets — fine for a private authority-review environment; formal EU-jurisdiction is a separate future decision.

## §D. Vercel — SYBNB frontend
- **Framework preset:** Vite · **Build Command:** `npm run build` · **Output Directory:** `dist` · **Install:** `npm install`.
- **Environment variable (build-time):** `VITE_API_BASE_URL = https://<render-api-domain>` (the Render API's public URL). *(Leave `VITE_STRIPE_PUBLISHABLE_KEY` unset — payments off.)*
- **Deployment protection:** enable **Vercel Password Protection / Preview Protection** so the frontend is **private (owner/authority review only)** — this keeps `publicAccess=CLOSED` at the edge.

## §E. Production environment variables (NAMES ONLY — set in each service's secret store)
**Render API:**
- `SYBNB_COUNTRY=syria` · `NODE_ENV=production`
- `AUTH_SECRET` (fresh long random) · `PHONE_HASH_SECRET` (fresh long random)
- `DATABASE_URL` = Render **Internal** URL, append `&connection_limit=<~ plan_max/replicas>&pool_timeout=20`
- `CORS_ORIGIN` = the Vercel frontend URL (exact origin)
- `STORAGE_PROVIDER=s3` · `STORAGE_S3_ENDPOINT` · `STORAGE_S3_REGION=auto` · `STORAGE_S3_BUCKET=sybnb-media` · `STORAGE_S3_ACCESS_KEY_ID` · `STORAGE_S3_SECRET_ACCESS_KEY` · `STORAGE_S3_FORCE_PATH_STYLE=true`
- `EMAIL_PROVIDER=resend` · `EMAIL_FROM=no-reply@notifications.sybnb.app` · `RESEND_API_KEY` (new prod) · `RESEND_WEBHOOK_SECRET`
- **Never set:** `OTP_EXPOSE_FOR_TEST`, `STORAGE_ALLOW_LOCAL` (the server fails closed on these in production).

**Vercel frontend:** `VITE_API_BASE_URL`.

**Resend webhook:** register `https://<render-api-domain>/api/webhooks/resend`; set `RESEND_WEBHOOK_SECRET` in the Render API to match.

## §F. Order of operations once resources exist (what I execute)
1. Confirm env manifest complete → API boots (fails closed if anything's missing).
2. **Migrations:** pre-deploy `prisma migrate deploy` → verify **0 pending** (`prisma migrate status`).
3. **Storage:** R2 upload/retrieve round-trip with a synthetic object.
4. **Email:** Resend end-to-end to an owner inbox → confirm **delivered** (not just accepted); webhook signature verifies.
5. **Clean data:** import only owner-approved inventory; reject `*.local`/`example.com`/test/demo/sample/isolation/duplicate/placeholder-price → import/rejection report. **No synthetic data enters the authority-facing env.**
6. **Smoke matrix (AR/EN × mobile/tablet/desktop):** signup→OTP→login→search→listing→booking to pre-payment; host/seller authz + tenant isolation; 404/recovery; calendar past-date; rate limits/CORS/headers/upload limits/error redaction/fail-closed; scan for any test creds/OTP/bypass/secret in prod.
7. **Backup/PITR rehearsal** on the managed DB (non-destructive).
8. **Conservative private load test** → RPS, concurrency, p50/p95/p99, error rate, DB connections/CPU/mem, bottleneck. **No 1M claim without evidence.**
9. Final **READY / NOT READY FOR SYRIAN AUTHORITY REVIEW** report.

Gates stay: `publicAccess=CLOSED` (edge password protection) · `payments=DISABLED`.
