# SYBNB — Launch Finalization Runbook
Two owner-actions that remain before public launch, plus the gates that stay separate. Candidate merged at `main`/`origin/main` = `bff2bf2`. **Keep payments OFF and public access CLOSED until an explicit, separate decision.** No secret values appear in this doc.

---

## A. Vercel — deploy the frontend (~30 seconds)
Goal: replace the old bundle (`index-DnH0_lp7.js`) with the merged-`main` build, keeping the site private.

1. vercel.com → project **`sybnb-v6`** → **Deployments**.
2. Latest deployment for branch **`main`** (commit `bff2bf2`):
   - If present but not Production → **⋯ → Promote to Production**.
   - If no new deployment → **⋯ → Redeploy** (uncheck "use existing build cache"), target **Production**.
   - If no `bff2bf2` deployment exists at all → Settings → **Git**: confirm repo connected + Production Branch = `main`, then **Redeploy**.
3. **Do NOT touch** Settings → Deployment Protection — leave **Vercel Authentication / Require Log In = ON**.
4. Wait for "Ready", then notify. Verify: bundle filename changed (≠ `index-DnH0_lp7.js`) AND logged-out visitors still hit the login wall.

---

## B. Credential-rotation runbook (§G — mandatory before public access)
**Order for every secret: create new → update store → verify → revoke old.** Never revoke first (downtime). Safe to do now; environment stays private.

### B1. Cloudflare R2 token
1. Cloudflare → R2 → **Manage R2 API Tokens → Create API token** (Object Read & Write, bucket `sybnb-media`). Copy new Access Key ID + Secret.
2. Render → `sybnb-api` → **Environment → Edit**: set `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` = new values. Save → deploy.
3. Verify: run `scripts/verify-r2.mjs` (PUT→GET→DELETE round-trip).
4. Cloudflare → **delete/revoke the OLD token.**

### B2. Render PostgreSQL password
1. Connect as owner and rotate:
   ```sql
   ALTER ROLE sybnb_production_user WITH PASSWORD '<new-strong-password>';
   ```
2. Render → `sybnb-api` → **Environment → Edit**: update `DATABASE_URL` with new password (same host/db). Save → redeploy.
3. Verify: `scripts/preflight-prod-db.mjs` (connectivity + migration parity + real-data guard) and `/api/health/ready` → 200.
4. Update local `.env.production.local` `DATABASE_URL`. Old password is invalidated by the ALTER — nothing else to revoke.

### B3. (Optional, recommended) other secrets
- `RESEND_API_KEY`: Resend → new key → update Render → verify a send → delete old.
- `AUTH_SECRET` / `PHONE_HASH_SECRET`: rotating logs out existing sessions — acceptable pre-launch.

### B4. Final secret-leak scan
After rotation: repo/tracked-files/config scan + deployed-API no-leak check (`prod-smoke.mjs`).

---

## Gates that remain SEPARATE (owner / third-party — not completed by these steps)
- **Legal:** Terms/Privacy DRAFT → counsel sign-off.
- **Syrian authority review** (package ready: `docs/regulatory/SYRIA_NOTIFICATION_PACKAGE.md`).
- **Explicit public-access decision** (flip `publicAccess` / remove Require-Log-In) — owner alone.
- **Payments** — last, separate authorization.
- **Stage-1 infra** before scaling traffic: DB pooler + `connection_limit` + OTP-prune cron (`SCALE_READINESS_1M.md`).

## After A + B
Notify and the assistant will: verify R2, verify DB, re-run the full deployed smoke, and produce a clean go/no-go — payments OFF, public access CLOSED, until the owner explicitly decides otherwise.

## References
- `FINAL_LAUNCH_MANIFEST.md` (candidate SHA/tag, rollback, env-var names, removal procedure)
- `PRIVATE DEPLOYMENT` state: backend deployed (`bff2bf2`), frontend pending step A. Deploy rollback ref `3879fcd`; git rollback ref `cd891a8`.
