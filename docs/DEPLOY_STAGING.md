# SYBNB V6 — Staging Deploy & Provisioning

Single-node staging bring-up. **Staging only** — do not enable live Stripe / Sham Cash
/ SMS or move real money. Use synthetic data.

## What you must provision

1. **PostgreSQL 16 + PostGIS** database (managed or self-hosted). The schema needs the
   `postgis` and `pgcrypto` extensions (created by migration `001`).
2. **Secrets** (generate with `openssl rand -hex 32`):
   - `AUTH_SECRET` — session-token HMAC key.
   - `PHONE_HASH_SECRET` — phone-number HMAC key.
   The API hard-fails if these are unset.
3. **API host** — any container platform (Cloud Run, Fly, Render, a VM). Serves the
   Node API on `API_PORT` (default 3051).
4. **Frontend static host** — the Vite build is static (`dist/`); serve on any static
   host / CDN (Vercel, Netlify, nginx, GCS+CDN).
5. *(Optional, card path)* Stripe test keys: `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`. Leave unset to disable card payments (routes return 503).

## Steps

1. `cp .env.example .env` and fill `DATABASE_URL`, `AUTH_SECRET`, `PHONE_HASH_SECRET`,
   `CORS_ORIGIN` (the frontend origin), `VITE_API_BASE_URL` (the deployed API origin).
2. **Pre-deploy gate:** `npm run preflight` (fails if required env is missing).
3. **API (Docker):**
   ```bash
   docker build -t sybnb-v6-api .
   docker run -p 3051:3051 --env-file .env sybnb-v6-api
   ```
   The container runs `prisma migrate deploy` (applies `001..007`) then serves.
   Or use `docker compose up` (brings up PostGIS + API together; set `.env` first).
4. **Frontend:** build with the API origin baked in, then upload `dist/` to the static host:
   ```bash
   VITE_API_BASE_URL="https://your-api-domain" npm run build
   ```
5. **Smoke test** against the deployed API:
   ```bash
   SMOKE_BASE_URL="https://your-api-domain" npm run smoke
   SMOKE_BASE_URL="https://your-api-domain" npm run smoke:routes
   ```

## Rate limiting

Auth (`/api/auth/login|register`) and payment (`/api/payments/*`) endpoints are
rate-limited per IP (in-memory). Tune with `RATE_LIMIT_AUTH_MAX`,
`RATE_LIMIT_PAYMENT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`. The in-memory store is
**single-node**; a multi-node deployment must move this to Redis/Postgres.

## Known gaps before a real (non-staging) launch

These are intentionally NOT production-ready and must be closed before real users/money:

- **Auth is password-only** — no phone OTP/SMS (the `OtpAttemptLock` model is unused).
- **Sham Cash reconciliation is manual** (admin-entered), not a live feed.
- **Stripe FX is a hardcoded placeholder** (`SYP_PER_USD`), and card captures auto-approve.
- **Notifications are an in-app outbox prototype** — nothing is actually delivered.
- **Uploads are local disk** (`server/uploads`) — not durable/multi-node; use object storage.
- Only the **STR (stays)** vertical has a full booking/payment/payout lifecycle; other
  verticals are listing+inquiry or placeholder.
