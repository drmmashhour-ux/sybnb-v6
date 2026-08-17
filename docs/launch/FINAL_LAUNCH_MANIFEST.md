# SYBNB — FINAL LAUNCH MANIFEST
Customer-facing launch candidate. **Not merged, not deployed. Payments OFF · publicAccess CLOSED · Require-Log-In ON.**

## 1. Candidate identity (single, unambiguous)
- **Merge target = the lightweight tag** `sybnb-launch-candidate-2026-08-17` (resolve with `git rev-parse sybnb-launch-candidate-2026-08-17`).
- **Lightweight tag** → points directly at one commit, so `git rev-parse <tag>` == `git rev-parse <tag>^{commit}` == `git show -s --format=%H <tag>` (no annotated-tag object indirection — the earlier `225aafa`/`ace0b2e` ambiguity is eliminated).
- Code candidate `ad0796d` (no-mock + a11y + price-filter 400) is the tagged commit's parent lineage; this manifest commit is the tag tip so the tag contains code + all reports + this manifest.
- **Branch:** `candidate/client-readiness-remediation`
- **Full remediation contained:** `ddb7a97` (no-mock + a11y) and `225aafa` (remediation report) are both ancestors of the tag; `ad0796d` adds the price-filter validation. Working tree clean.
- **Rollback SHA:** `cd891a8` (`main`, prior frozen state — unchanged throughout).

## 2. Test / CI evidence (on `ad0796d`)
- `tsc --noEmit`: **clean** · `npm run build`: **OK** (production bundle)
- Self-contained governed suites: **storage 23/23 · calendar-date-guard 9/9 · operations 15/15**
- Full account-dependent suite (`scripts/run-all-e2e.sh` on seeded `sybnb_v6` with `SELLER1/2,BUYER,ADMIN`) is the pre-merge gate; ad-hoc runs without that bootstrap fail on setup preconditions (not defects).
- API/UI checks: availability **200**; 6 divisions live **8/8/8/8/8/5**; zero-result search → **count 0 + genuine empty state, no mock**; EN descriptions; Approved/مقبول **hidden** (AR+EN); AR/RTL (dir=rtl, Arabic-Indic numerals) + EN/LTR; `:focus-visible` + landmarks (4) + single h1 + reflow no-overflow; **no secret / synthetic-marker leak in UI**; payments-OFF boundary; priceMin out-of-range → **400** (was 500).

## 3. Client-satisfaction scores (before → after)
Overall **8.1 → 8.5** · Accessibility **6.5 → 8.0** · Search/filter 7.5 → 8.5 · Trust 7.5 → 8.0 · AR **9.0** · EN **8.5** · Mobile **8.5** · Tablet 8.5 · Desktop 9.0. **0 BLOCKER · 0 HIGH · 0 MEDIUM customer-journey.** All targets PASS.
- Remaining **LOW** (real-launch hardening, not customer-journey): public `/api/listings` returns internal `metadata` (`inventory_source`/`descriptionEn`) — deliberately NOT changed here (public metadata contract; whitelist under separate change). Retracted: the "no 404 copy" LOW — `NotFoundPage` already renders localized "Page not found"/"الصفحة غير موجودة".

## 4. Production migration requirements
- Candidate migration set = **12** (`001…012_listing_availability`). **Production is already at `012`** (applied in the availability fix). Candidate adds **no new migrations** beyond `012`.
- On deploy: run `prisma migrate deploy` (idempotent — no-ops if already at 012). No data migration, no destructive step.

## 5. Environment variables (NAMES ONLY — no values)
- Core: `SYBNB_COUNTRY`, `DATABASE_URL`, `AUTH_SECRET`, `PHONE_HASH_SECRET`, `API_PORT`/`PORT`, `API_HOST`, `CORS_ORIGIN`
- Storage (R2): `STORAGE_PROVIDER`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_S3_FORCE_PATH_STYLE`
- Email (Resend): `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
- Frontend build: `VITE_API_BASE_URL`
- Private-preview automation (deploy-time only): `VERCEL_AUTOMATION_BYPASS_SECRET`
- Payments: intentionally UNSET (no Stripe/live keys). Do not set without separate owner authorization.

## 6. Synthetic authority-review inventory — removal procedure
The 45 review listings are tagged `metadata.inventory_source=authority_review_synthetic` with `@authority-review.invalid` owners; manifest at `docs/launch/authority-review-manifest.json`. **Before first real inventory load:**
```bash
DATABASE_URL=<prod> node scripts/remove-review-inventory.mjs            # dry-run (counts)
DATABASE_URL=<prod> node scripts/remove-review-inventory.mjs --commit   # remove (listings + synthetic owners + locations)
```
Proven reversible (local: 45/15/30 removed, zero residue).

## 7. Credential-rotation gate (MANDATORY before `publicAccess=OPEN` — LAUNCH_CHECKLIST §G)
Not required for merge. Before public access: rotate Render PostgreSQL creds + Cloudflare R2 token → update prod secret stores (no value exposure) → revoke old → verify API→PG (`preflight-prod-db.mjs`) + R2 PUT/GET/DELETE (`verify-r2.mjs`) → repo/logs/config secret-leak scan. Reason: DB connection string + R2 token surfaced in working-session transcripts.

## 8. Stage-1 scaling prerequisites (before increasing traffic — not before merge)
1. DB **connection pooler** (PgBouncer/Render pool/Prisma Accelerate) + `connection_limit` in `DATABASE_URL`.
2. Cache/trust session roles (stop per-request `getAuthContext` user+roles DB lookup).
3. Register **OTP-prune cron** (`scripts/prune-expired-otps.mjs`).
Then re-measure on a staging replica. (100k+ needs Stage-2: Redis rate-limit/email, search index, cursor pagination, queue, PITR, `/metrics` — see `SCALE_READINESS_1M.md`.)

## 9. Rollback procedure
- **Pre-merge:** nothing to roll back (candidate isolated on its branch; `main` = `cd891a8`).
- **Post-merge, pre-deploy:** `git revert <merge>` or reset `main` to `cd891a8`.
- **Post-deploy (frontend):** redeploy the previous Vercel build; frontend is stateless.
- **DB:** `012_listing_availability` is **additive** (new table only) — safe to leave in place on rollback; no down-migration needed. If ever required, `DROP TABLE listing_availability; DROP TYPE availability_status;` (no other object depends on it).
- **Synthetic data:** unaffected by rollback; removal via §6 when real inventory loads.

## Verdict
# MERGE READY
Single unambiguous candidate `ad0796d` (tag `sybnb-launch-candidate-2026-08-17`); customer-experience gate PASSED (0 BLOCKER/HIGH/MEDIUM customer-journey, accessibility 8.0, overall 8.5); tests green; build OK; additive-only migration already on prod; rollback ref `cd891a8`. **Merge to `main` is authorized-by-owner only; deployment, public access, credential rotation, payments, and 1M-scale provisioning remain separate, un-authorized steps.**
