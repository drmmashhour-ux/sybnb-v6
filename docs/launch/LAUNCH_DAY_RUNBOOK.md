# SYBNB — Launch-Day Runbook (turnkey; executes only after gates clear)

The exact ordered sequence to take `8c5c2c3` from "technically ready" to a **deployed, certified,
non-public** production environment — and the reserved final steps that need their own authorization.
**Nothing here runs until the preconditions below are all true.** Payments stay OFF and public Syria
access stays CLOSED through the entire deployed-certification stage.

Legend: **[OWNER]** = you (access/payment/DNS/authorization) · **[AGENT]** = I run it with you.

## Preconditions (ALL required before Step 1)
- [ ] **Provider clearance CONFIRMED in writing** — Render, Render Postgres (or Neon), Cloudflare R2, Resend (`PROVIDER_CLEARANCE.md` all CONFIRMED, or RESTRICTED with counsel-accepted, meetable conditions).
- [ ] **Counsel sign-off** — sanctions/export, Syria permissibility, privacy/data-transfer, chosen regions.
- [ ] **Authenticated provider access + payment method** ready (Render, Cloudflare, PG provider).
- [ ] Candidate `8c5c2c3` frozen; rollbacks `bf8341f`/`d1fd5b9` reachable.
> If any precondition is not met, **stop** — do not provision. This is the standing gate.

## Stage A — Provision (minimum resources) **[OWNER]**
1. **Postgres** (Render PG or Neon): create instance in the counsel-approved region; enable backups + PITR (tier permitting); record **DB version**; take a **pre-migration recovery point / `pg_dump`**. Capture `DATABASE_URL` (pooled if the host autoscales).
2. **Cloudflare R2**: create the private production bucket; create an S3 API token (access key id/secret); note the account R2 endpoint + region (`auto`).
3. **Render**: create the API **Web Service** from the repo `Dockerfile` (or Node: build `npm ci && npx prisma generate`, start `node server/index.mjs`).

## Stage B — Secrets (host secret store; values never in git) **[OWNER, AGENT assists names/format]**
4. In Render's secret store set (names only): `SYBNB_COUNTRY=syria`, `NODE_ENV=production`, `AUTH_SECRET` (fresh long random), `PHONE_HASH_SECRET` (fresh long random), `DATABASE_URL`, `CORS_ORIGIN` (frontend origin(s)), `STORAGE_PROVIDER=s3`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION=auto`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_S3_FORCE_PATH_STYLE=true`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (NEW production key — not `.env.resend.local`), `EMAIL_FROM=no-reply@notifications.sybnb.app`.
   - **Keep UNSET (payments OFF):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `SYP_PER_USD`.
   - **Never set:** `OTP_EXPOSE_FOR_TEST`, `STORAGE_ALLOW_LOCAL`.

## Stage C — Deploy + migrate (payments OFF, public CLOSED) **[AGENT with OWNER]**
5. Deploy the image/service. Set the Render **health-check path** `/api/health/ready` with an **initial-delay/grace sized to the real observed cold start** (locally ~10s — verify against the deployed service, don't hard-code blind).
6. **Migrations (once):** confirm the target DB, `npx prisma migrate status` → then `npx prisma migrate deploy` → `npx prisma migrate status` (expect "up to date"). Verify: **11 migrations**, schema current. **If output differs from the locally certified state, STOP.**

## Stage D — Deployed certification **[AGENT]**
7. **API:** `/api/health/live` 200; `/api/health/ready` 200 + `database.ok:true`; security headers; 404 JSON; rate-limit 20→429; country config = syria (email-only; phone OTP refused).
8. **Database:** connectivity; migration count; a safe governed read/write; restart/reconnect behavior.
9. **Storage (R2):** run `node scripts/certify-providers.mjs` with the R2 vars → real put/get/**presign**/delete round-trip PASS. Configure bucket CORS only if browser-direct access is later needed.
10. **Email:** one production transactional send to an owned inbox → Resend **Delivered**; idempotency holds.
11. **Webhook:** create `RESEND_WEBHOOK_SECRET`, register `https://api.sybnb.app/api/webhooks/resend` in Resend, send a test event → signature verifies, dedup + suppression act, 503 if secret unset. (`resend-webhook` already 9/9 locally.)
12. **Security:** no secret exposure in logs; `OTP_EXPOSE_FOR_TEST`/`STORAGE_ALLOW_LOCAL` absent; local storage disabled; payment creds absent; no public admin/debug endpoints.
13. **Observability:** startup/error logs visible; health monitoring on `/api/health/ready`; provider logs sufficient for incident diagnosis.

## Stage E — DNS + TLS (after the service is healthy) **[OWNER + AGENT]**
14. Add `api.sybnb.app` → the Render service (record in Vercel DNS). **Do not touch** `notifications.sybnb.app` (Resend) or the root `@`/Google Workspace MX. Do not change nameservers.
15. After propagation: verify TLS on `api.sybnb.app`; re-run Step 7 against the public API hostname.

## Stage F — Rollback drill (non-destructive) **[AGENT]**
16. Prove: identify prior candidate (`bf8341f`); redeploy/restore the prior revision; DB integrity preserved (restore uses the Stage-A recovery point; migration 011 is index-only, safe to leave); recover from a simulated failed deploy. **Document the exact steps performed.** No production data destroyed.

## Reserved — NOT part of launch-day (each a separate explicit authorization)
- **Enable live payments** — separate owner-authorized phase (provision `STRIPE_*`, certify sandbox→live, FX, counsel).
- **Public Syria cutover** — announce launch / broadly onboard Syria users / remove access gating. **Only** after every provider is CONFIRMED, counsel approves, and you explicitly authorize the cutover.

## Verdict discipline
Through Stages A–F the platform is **deployed but CLOSED** — verdict stays **CONDITIONAL GO**. When all
providers are CONFIRMED, counsel approves, and Stages A–F pass on the real host, I report
**READY FOR FINAL OWNER CUTOVER** — and you (not I) authorize the public Syria launch and payments.
