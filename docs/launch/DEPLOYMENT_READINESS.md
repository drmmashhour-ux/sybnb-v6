# SYBNB — Deployment Readiness Assessment (RC `d1fd5b9`)

Assessment only — **no infrastructure change, no deploy, no payments, no public access, no webhook
rotation.** Preserves: runtime `d1fd5b9`, docs `4a970fa`, Resend Phase 11 CLOSED/PASSED, verdict
CONDITIONAL GO. Resend outbound config is **not** reopened.

## 1. Deployment architecture (inspected)
| Concern | Finding |
|---------|---------|
| Frontend | Vite SPA (React 19), hash routing. Build `tsc && vite build` → static `dist/`. |
| API | Dependency-free Node `http` server (`server/index.mjs`), long-lived process; `API_HOST`/`API_PORT`. **Not** a serverless handler — needs a host that runs a persistent Node process (VM / container / Fly / Render / a Node service), **not** Vercel Functions as-is. |
| Runtime services | API process + PostgreSQL only. **No Redis/cache/queue** (only HTTP `cache-control` headers). No schedulers/workers (expiry is opportunistic-on-read). |
| API deploy target | **Not yet chosen** — no `vercel.json`, `Dockerfile`, or CI in repo (only `templates/` + `deploy-simulation.sh`). BLOCKED-OWNER. |
| Database target | PostgreSQL via `DATABASE_URL`; Prisma. Managed PG to be selected (`PROVIDER_RECOMMENDATIONS.md`). BLOCKED-OWNER. |
| DNS / domain | `sybnb.app` DNS is on **Vercel** (confirmed via Resend provider detection). `notifications.sybnb.app` verified for email (eu-west-1). Frontend could serve from Vercel; **API host + its domain/subdomain still to be decided** (e.g. `api.sybnb.app`). |
| Health/readiness | `GET /api/health/live` (liveness), `GET /api/health` + `/api/health/ready` (readiness incl. DB). |
| Migration/deploy cmds | `prisma migrate deploy` (11 migrations); `prisma migrate status`; `npm run build`; start `node server/index.mjs`. Templates: `templates/{production.env,sybnb-api.service,Dockerfile}.template`. |
| Webhook endpoints | Payments: `/api/payments/webhook`, `/api/payments/stripe/webhook` (payments OFF). **Resend bounce/complaint webhook route does NOT exist yet** — only the verifier/suppression library is built (see §5). |

## 2. Production secret inventory (NAMES ONLY — values never printed/committed)
**Required (all environments):** `SYBNB_COUNTRY` (=`syria`, fail-closed), `AUTH_SECRET`, `PHONE_HASH_SECRET`, `DATABASE_URL`.
**Required in production:** `NODE_ENV=production`, `CORS_ORIGIN`, `STORAGE_PROVIDER=s3` + `STORAGE_S3_BUCKET` / `STORAGE_S3_REGION` / `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` (optional `STORAGE_S3_ENDPOINT` / `STORAGE_S3_FORCE_PATH_STYLE`).
**Email (Resend):** `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (production key — separate from the local cert key), `EMAIL_FROM=no-reply@notifications.sybnb.app`, `RESEND_WEBHOOK_SECRET` (for the future live webhook — §5).
**Payments (KEEP UNSET → payments OFF):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `SYP_PER_USD`. Leaving `STRIPE_SECRET_KEY` unset means no Stripe client is constructed (fail-closed).
**Must NOT be set in production:** `OTP_EXPOSE_FOR_TEST`, `STORAGE_ALLOW_LOCAL`.
**Not used (email-only):** `SMS_PROVIDER` stays `sandbox`; `SMS_HTTP_ENDPOINT` / `SMS_API_KEY` / `SMS_SENDER_ID` not required.
- **`.env.resend.local` is NOT to be moved to production** — it's a local cert file (gitignored). Provision the production `RESEND_API_KEY` directly in the deploy secret store.

## 3. Deployment package / readiness (locally proven 2026-08-14)
| Gate | Result |
|------|--------|
| Build + typecheck (`tsc && vite build`) | **PASS** (clean) |
| Lint | **N/A** — no eslint/prettier configured; `tsc` strict is the static gate |
| Schema validate | **PASS** |
| Governed suites (24 E2E) + isolation + bundle-safety | **PASS** — 0 failures |
| Secret scan (tracked tree) | **PASS** — no secret-like values; `.env.resend.local` untracked |
| Migration validation (fresh DB) | **PASS** — 11 applied, up-to-date, 26 tables |
| Deploy-config sim (`deploy-simulation.sh`) | **PASS** — 13/13 (fail-closed + health + shutdown + redaction) |
| Reproducible source archive | **PASS** — preserved `RELEASES/d1fd5b9/` (sha256 `b5c7ca1c…416e`) |

**Locally proven vs deployment-authoritative:** everything above is **locally proven** on this machine.
**Deployment-authoritative** checks (require a real target, not done): deployed smoke, deployed
rollback drill, real managed-PG migrate, real S3 round-trip, real Resend production key send, live
webhook receipt.

## 4. Database readiness
- **Migrations:** 11, additive. **Scanned — zero destructive statements** (no DROP TABLE/COLUMN, TRUNCATE, DELETE, ALTER…DROP). Migration 011 adds a UNIQUE index only.
- **Schema state:** valid; fresh-DB `migrate deploy` → up-to-date (26 tables).
- **Expected prod DB:** PostgreSQL (version per the chosen managed provider; Prisma 6 supports modern PG).
- **Backup/restore:** procedure verified locally (pg_dump→pg_restore, exact row counts) — needs a real DB + scheduled backups (`OPERATIONS_RUNBOOK.md`). BLOCKED-OWNER.
- **Rollback:** code = `git revert`/checkout prior candidate; DB = restore pre-deploy dump. Because 011 is index-only, a code rollback can leave the index in place safely. **No destructive migration to reverse.**
- **Do not apply production migrations** — not done.

## 5. Webhook readiness (Resend)
- **Built + tested:** `verifyResendWebhook` (Svix HMAC signature + timestamp/replay window), `createWebhookReplayGuard` (duplicate-event), `createSuppressionList` (bounce/complaint) — `email-security` 11/11.
- **Not built yet:** the **HTTP route** that receives Resend events. Exact endpoint to configure after deploy: **`POST /api/webhooks/resend`** (to be added), verifying with `RESEND_WEBHOOK_SECRET` and feeding the suppression store. Requires a small route + a persistent suppression store at deploy time.
- **Do not create/rotate the Resend webhook secret yet** — not done. Outbound email config untouched.

## 6. Payments — remain OFF
- Enforced: `STRIPE_SECRET_KEY` unset → no Stripe client (fail-closed). No payment change made.
- **Still required before payments could be enabled (not done):** owner authorization; a Syria-viable processor selected + certified (sandbox→live); real FX handling for SYP/USD; `STRIPE_*`/`PAYMENT_WEBHOOK_SECRET` provisioned; counsel sign-off. See `PROVIDER_RECOMMENDATIONS.md`.

## 7. Public access — remain CLOSED
No traffic switch, no production DNS routing change, no access-control change, no public launch, no verdict change. All untouched.

## 8. External gates (remain open)
Resend written Syria-service confirmation · Resend DPA/privacy review · Syria legal/regulatory approval ·
production webhook wiring (`/api/webhooks/resend` + secret) · payment authorization · final production
cutover approval · **deploy target + managed-PG + S3 selection** (infra not yet chosen).

## 9. Verdict
Application is **deployment-ready to the limit of local verification**; no code blocker. Remaining work
is infrastructure selection + provisioning + deployed-authoritative certification + the external gates.
**Verdict unchanged: CONDITIONAL GO.**
