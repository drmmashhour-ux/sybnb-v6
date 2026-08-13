# SYBNB — Production Activation Runbook

Activation + certification steps for RC `63f9854`. **No secret values appear in this file** — only
variable names. Each provider has an already-certified code path and a governed test to run against
its real test/sandbox endpoint once credentials exist. Reserved actions (live charges/payouts,
production customer SMS, destructive data ops, DNS/public cutover) are **not** part of this runbook.

## 1. Environment variable checklist (names only)

Startup validation (`server/lib/env.mjs#validateEnv`) fails closed if required vars are missing.

**Required in every environment**
- `AUTH_SECRET` — session-token + OTP/gift/storage HMAC secret (long random).
- `PHONE_HASH_SECRET` — phone-hash salt (long random).
- `DATABASE_URL` — Postgres connection string.

**Required in production (`NODE_ENV=production`)**
- `CORS_ORIGIN` — exact frontend origin(s), comma-separated (no wildcard).
- `STORAGE_PROVIDER=s3` — local disk is refused in production.
- `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`
  — object storage; optional `STORAGE_S3_ENDPOINT`, `STORAGE_S3_FORCE_PATH_STYLE` for GCS/MinIO/R2.
- Must **NOT** be set in production: `OTP_EXPOSE_FOR_TEST`, `STORAGE_ALLOW_LOCAL` (validation rejects).

**SMS (server-side OTP delivery)**
- `SMS_PROVIDER` — `sandbox` (default, sends nothing) or `http`.
- `SMS_HTTP_ENDPOINT`, `SMS_API_KEY`, optional `SMS_SENDER_ID` — required when `SMS_PROVIDER=http`.

**Payments (TEST/sandbox first)**
- `PAYMENT_WEBHOOK_SECRET` — webhook signature secret for the certified webhook path.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — **test-mode keys only** for this gate; the live
  Stripe SDK path stays gated until owner authorizes live activation. Optional `STRIPE_CURRENCY`,
  `SYP_PER_USD` (FX placeholder — replace with a real feed before any live money).

**Bind / ops**
- `API_HOST`, `API_PORT`, `NODE_ENV`.

> See `.env.example` for the same list with placeholder (non-secret) values.

## 2. Production database (do not rewrite migrations 001–007)
1. Provision Postgres; set `DATABASE_URL`. **Verify you are pointed at the intended environment**
   (not staging/prod cross-wire) before any write.
2. Confirm backup/recovery is available on the provider first.
3. Inspect the plan: `npm run db:migrate:status` (expect pending migrations on a fresh DB).
4. Apply: `npm run db:migrate:deploy` (never `migrate dev`/`db push` in prod).
5. Verify: `npm run db:migrate:status` → "up to date"; app readiness `GET /api/health/ready` → 200.
   *(Certified this gate against a fresh disposable DB: all 10 migrations apply, status up-to-date,
   ids uuid.)* Never delete/reset production data.

## 3. S3 private object storage (SigV4 already certified)
1. Create a **private** bucket; enable **versioning** + a **lifecycle/retention** policy; block all
   public access.
2. Create a **least-privilege IAM** principal limited to Put/Get/Delete on this bucket's prefixes
   (`kyc/`, `payment-proof/`, `listing-media/`).
3. Set the `STORAGE_S3_*` vars; keep `STORAGE_PROVIDER=s3`.
4. Verify against the real bucket (test objects only): a `putObject`→signed retrieval→`deleteObject`
   round-trip on the `kyc` bucket; confirm no public read, MIME/size rejection, traversal rejection,
   and that production refuses local disk. Reference path proven by `npm run test:e2e:storage` (23/23,
   local) and `npm run test:e2e:storage-s3` (6/6, real SigV4 against a mock endpoint). Re-run the
   round-trip pointed at the real bucket and record evidence. **KYC objects must never be public.**

## 4. SMS provider (sandbox/test first — no customer SMS)
1. Obtain provider **sandbox/test** credentials; set `SMS_PROVIDER=http` + `SMS_HTTP_ENDPOINT` +
   `SMS_API_KEY` (+ `SMS_SENDER_ID`).
2. Verify: `send → verify → registration-binding → expiry → replay/attempt limits` — proven by
   `npm run test:e2e:otp` (20/20) and the adapter by `npm run test:e2e:sms` (7/7). Re-run `send` to a
   **test** number and confirm delivery via the provider dashboard. Do **not** send to real
   customers in this gate. `OTP_EXPOSE_FOR_TEST` stays **unset** (code never returned to clients).

## 5. Stripe test mode (no live charges/payouts)
1. Set **test** `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` and `PAYMENT_WEBHOOK_SECRET`; register
   the webhook endpoint (`/api/payments/webhook`) in the Stripe test dashboard.
2. Certify against Stripe **test** mode: server-authoritative amount/currency, webhook signature
   verification, replay/idempotency, success/failure, refund, reconciliation, no duplicate ledger
   effect — architecture proven by `npm run test:e2e:payment` (21/21, re-run ×3). Drive real test
   events and record evidence. **Do not enable live keys** until the deployed environment passes test
   mode and you separately authorize live activation. Wallet/Gift remains promotional credit (not a
   money transfer) — do not change that accounting model.

## 6. Operations / monitoring / backups
1. Ship stdout/stderr (structured JSON, secrets redacted) to a log sink; alert on `level:"error"`
   and 5xx `http_request`. `[[OWNER: choose sink/alert destination]]`
2. Wire probes: liveness `GET /api/health/live`, readiness `GET /api/health/ready`.
3. Confirm security headers, body limits, CORS, graceful shutdown (all present; `npm run
   test:e2e:operations` 14/14).
4. Schedule encrypted off-host `pg_dump`; run a **restore drill** onto a disposable DB and verify
   `migrate status` + row counts (procedure in `docs/OPERATIONS_RUNBOOK.md`). Record the drill result.

## 7. Deployment + deployed certification (pre-cutover)
1. Deploy the immutable `63f9854` build to a **production-like, non-public** environment; show the
   plan/diff and reject any destructive/unrelated infra change first.
2. Verify the exact release SHA and health of every component.
3. Run the full governed suite + desktop/mobile browser certification **against the deployed
   candidate** (not a local repo).
4. Re-run the authorization/IDOR checks (wallet/gifts, KYC, listings, seller/admin, payment
   intents/proofs, OTP/account).
5. **STOP** at DNS/public cutover — reserved for explicit owner authorization.
