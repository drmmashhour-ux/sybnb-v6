# SYBNB — Provider Sandbox Certification Procedures

How to certify each production provider against its **real sandbox/test endpoint** once credentials
exist. **No secret values appear here or in the repo** — only variable names. Each provider's code
path is already certified against a mock (see the governed suites); this is the "real endpoint"
step. Reserved actions (live charges/payouts, production SMS to customers, public cutover) are out
of scope.

## Credential handling (never commit or print secrets)
- Put values only in the server's environment or an untracked `.env` (git-ignored). `.env.example`
  lists the required **names** with placeholders.
- Rotate any credential that is ever exposed. The logger redacts secrets and never logs request
  bodies/headers; keep it that way.

## 1. Object storage (S3-compatible)
Set (names only): `STORAGE_PROVIDER=s3`, `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`,
`STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` (+ `STORAGE_S3_ENDPOINT`,
`STORAGE_S3_FORCE_PATH_STYLE` for non-AWS).
Certify against the **real** bucket (test objects only):
- put→signed-retrieve→delete round-trip on the `kyc` bucket; confirm the object is **not** publicly
  readable; MIME/size rejection; traversal rejection; production refuses local disk.
- Evidence: certified code path `npm run test:e2e:storage` (23/23) + `npm run test:e2e:storage-s3`
  (6/6, SigV4). Re-run the round-trip pointed at the real bucket and capture the result.

## 2. SMS / OTP
Set: `SMS_PROVIDER=http`, `SMS_HTTP_ENDPOINT`, `SMS_API_KEY` (+ `SMS_SENDER_ID`).
Certify against the provider **sandbox**:
- `send → verify → registration-binding → expiry → replay/attempt limits`; deliver one code to a
  **test** number and confirm via the provider dashboard. `OTP_EXPOSE_FOR_TEST` stays unset.
- Evidence: `npm run test:e2e:otp` (20/20) + `npm run test:e2e:sms` (7/7).
- Do **not** send to real customers in this gate.

## 3. Payments (Stripe TEST mode)
Set: `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` (test), `PAYMENT_WEBHOOK_SECRET`; register
the webhook (`/api/payments/webhook`) in the Stripe **test** dashboard.
Certify against Stripe **test** mode:
- server-authoritative amount/currency; webhook signature verification; replay/idempotency;
  success/failure/cancel; refund; reconciliation; no duplicate ledger effect.
- Evidence: `npm run test:e2e:payment` (21/21, re-run ×3).
- **No live keys.** Wallet/Gift stays promotional credit — accounting model unchanged.

## 4. Database
Set `DATABASE_URL` (prod). `npm run db:migrate:deploy` → `npm run db:migrate:status` = up to date →
`GET /api/health/ready` = 200. Certified vs a fresh disposable DB (10 migrations apply). Never
`migrate dev`/`db push` in prod; never delete/reset data.

## 5. Monitoring / logs / backups
Point stdout/stderr (structured, redacted) at the chosen sink; alert on `level:"error"` + 5xx
`http_request`. Wire probes: `GET /api/health/live` (liveness), `GET /api/health/ready` (readiness).
Schedule `pg_dump`; run a **restore drill** onto a disposable DB (procedure: `docs/OPERATIONS_RUNBOOK.md`).

## Env validation (fails closed)
On startup `validateEnv()` rejects missing required config; in production it also requires
`CORS_ORIGIN` + a durable `STORAGE_PROVIDER` and refuses `OTP_EXPOSE_FOR_TEST` / `STORAGE_ALLOW_LOCAL`.
Confirm with `npm run test:e2e:operations` (14/14).
