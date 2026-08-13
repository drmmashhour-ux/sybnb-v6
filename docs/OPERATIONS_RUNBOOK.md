# SYBNB V6 — Operations Runbook

Operational procedures for running the V6 API in production. This document is code-adjacent
process; it does not provision or mutate any production infrastructure.

## Configuration (fails closed)

`server/lib/env.mjs#validateEnv()` runs at startup and the process **exits(1)** if required config
is missing. See `.env.example` for the full list. Required everywhere: `AUTH_SECRET`,
`PHONE_HASH_SECRET`, `DATABASE_URL`. Additionally required when `NODE_ENV=production`:
`CORS_ORIGIN`; a durable `STORAGE_PROVIDER` (not `local`); `STORAGE_S3_BUCKET`+`STORAGE_S3_REGION`
when `STORAGE_PROVIDER=s3`. Production also refuses `OTP_EXPOSE_FOR_TEST=true` and
`STORAGE_ALLOW_LOCAL=true`.

## Health & readiness

- `GET /api/health/live` — liveness: process is up (no dependency check). Use for the container
  liveness probe.
- `GET /api/health/ready` (alias `GET /api/health`) — readiness: returns 200 only when the database
  is reachable, else 503. Use for the load-balancer/readiness probe so traffic is withheld until
  dependencies are usable.

## Logging & monitoring

Structured JSON logs (`server/lib/logger.mjs`), one line per event, with a `requestId`
(`x-request-id`, echoed on the response). Sensitive keys (password/secret/token/authorization/
otp/code/proof/card/…) are redacted; Authorization headers and request bodies are never logged;
raw error objects are never dumped (only a redacted `errorSummary`). Ship stdout/stderr to the log
sink and alert on `level:"error"` and on `event:"http_request"` with `status>=500`.
**Monitoring destination is an owner activation item** (see checklist).

## Database migrations

Migrations live in `prisma/migrations/` with `migration_lock.toml`. Apply in production with:

```bash
DATABASE_URL="postgresql://…" npm run db:migrate:deploy   # prisma migrate deploy (no dev reset)
npm run db:migrate:status                                 # verify applied state
```

Never run `migrate dev`/`db push` against production. Take a backup (below) before applying.

## Backup & restore

**Backup** (schedule via the managed DB provider or cron):

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > sybnb-$(date +%Y%m%dT%H%M%S).dump
```

Store encrypted, off-host, with retention (e.g. 30 daily / 12 monthly). Object-storage buckets
(KYC/proof/media) must have versioning + lifecycle retention enabled at the bucket level.

**Restore verification** (prove restores actually work — do NOT restore onto production):

```bash
createdb sybnb_restore_check
pg_restore --no-owner --dbname sybnb_restore_check sybnb-<ts>.dump
DATABASE_URL="postgresql://…/sybnb_restore_check" npm run db:migrate:status   # expect: up to date
# smoke: SELECT counts on users/listings/wallet_entries; confirm non-zero and consistent
dropdb sybnb_restore_check
```

Run a restore drill on a schedule and record the timestamp + row-count deltas.

## Incident response

1. **Triage** — check `/api/health/ready`; scan logs for `level:"error"` and 5xx `http_request`.
2. **Database down** — readiness returns 503 and traffic is withheld automatically; restore DB
   connectivity or fail over; do not force-serve.
3. **Suspected data issue** — take a fresh backup before any corrective action; never mutate
   production data without a backup and a written change record.
4. **Credential/secret exposure** — rotate the affected secret (`AUTH_SECRET`, provider keys),
   redeploy, and invalidate sessions if `AUTH_SECRET` rotated (tokens become invalid on rotation).
5. **Rollback** — redeploy the prior release SHA. Migrations are additive; a schema rollback needs
   a reviewed down-migration + a verified backup.
6. **Graceful shutdown** — SIGTERM drains connections, releases the DB, and hard-exits after 10s.

## Owner activation items (external)

Monitoring/alerting destination, log sink, backup schedule + storage, production DB provisioning,
object-storage bucket + IAM, SMS provider, payment provider live credentials, and final legal
content are owner/external actions — see the launch certification checklist.
