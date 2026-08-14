# SYBNB — Go-Live Command Runbook (prepared, not executed)

Copy-ready command checklists for the deployed candidate. **Nothing here has been run against
production** — there is no authenticated deploy target in this environment. Runtime RC **`c89c495`**.
Secrets are shown as variable **names** only. Reserved actions (live payments, DNS cutover, real
customer SMS/KYC, destructive prod mutation) require a separate explicit owner authorization and are
**out of scope of this runbook**.

Legend: `#` = run on the deploy host once credentials/target exist.

---

## 0. Pre-flight (local, already PASSING at `c89c495`)
```bash
git rev-parse --short HEAD           # expect c89c495 (runtime) — docs may sit ahead
npm ci
npm run build                        # tsc && vite build — clean
npx prisma validate                  # schema valid
bash scripts/run-all-e2e.sh          # 21 E2E suites + isolation + bundle scan → "suites with failures: 0"
npm audit --omit=dev                 # 0 vulnerabilities
```

## 1. Deploy (payments OFF, public access CLOSED)
```bash
# On the deploy host, with production env vars set (see ACTIVATION_RUNBOOK.md §1):
#   NODE_ENV=production, AUTH_SECRET, PHONE_HASH_SECRET, DATABASE_URL,
#   CORS_ORIGIN, STORAGE_PROVIDER=s3 + STORAGE_S3_*, PAYMENT_WEBHOOK_SECRET (test)
#   NOT SET: OTP_EXPOSE_FOR_TEST, STORAGE_ALLOW_LOCAL, live STRIPE keys
# git checkout c89c495
# npm ci && npm run build
# npx prisma migrate deploy            # applies 11 migrations; idempotent
# npx prisma migrate status            # expect "Database schema is up to date!"
# start the API process manager (systemd/pm2/container) → server/index.mjs
```
Fail-closed proof (already verified locally): production start with missing/invalid config logs
`env_validation_failed` and exits — a misconfigured deploy refuses to serve rather than run insecure.

## 2. Smoke test (deployed, before any traffic)
```bash
# BASE=https://<deployed-host>
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/api/health/live      # expect 200
curl -s $BASE/api/health/ready                                        # expect status:"ready", database.ok:true
curl -s -D - -o /dev/null $BASE/api/health/live | grep -iE \
  "x-content-type-options|x-frame-options|content-security-policy|x-request-id"   # headers present
curl -s -w " [%{http_code}]\n" $BASE/api/does-not-exist             # expect 404 NOT_FOUND JSON
# Rate limit: >20 rapid POST /api/auth/login from one IP → 429 after 20
# Confirm NO secret values appear in the process logs (redaction).
```

## 3. Rollback (procedure prepared; deployed drill PENDING the deploy gate)
> Prior RC `0717fa3` is a **build-verified rollback artifact**. That is not a deployed rollback
> drill — executing checkout+restart+restore against the deployed target, and confirming service +
> data recovery, is part of the deployment gate (Section E) and has not been performed.
```bash
# Code rollback — prior RC 0717fa3 is build-verified as a rollback target:
# git checkout 0717fa3 && npm ci && npm run build && restart
#
# DB rollback — restore from the pre-deploy dump (drill verified: exact row counts + FKs + unique idx):
# pg_dump  -Fc -d "$PROD_DB" -f pre_deploy.dump     # taken BEFORE step 1
# createdb sybnb_restore && pg_restore -d sybnb_restore pre_deploy.dump
#   (migration 011 adds an index only; NULL provider_ref rows are unaffected, so 010→011 is safe to
#    re-run and safe to leave in place on a code rollback.)
```

## 4. Incident response — ref `docs/INCIDENT_PRIVACY_RUNBOOK.md`
```
Trigger → 1) capture x-request-id from the report / logs (no PII in logs by design)
         2) health/ready to check DB; process-manager status
         3) if degraded: roll back per §3; if data event: privacy runbook (contain, document,
            counsel sets notification recipients/deadlines — Law 25)
         4) payments incidents: live payments are OFF until explicitly authorized — no charge path
```

## 5. Launch-day checklist (gated on OWNER_ACTIONS.md)
```
☐ Mailboxes verified (OWNER_ACTIONS §1)
☐ Vendors + regions recorded, DPAs signed (§2)
☐ Providers certified vs real test endpoints (§3, PROVIDER_CERTIFICATION.md)
☐ Counsel-approved Terms/Privacy wired DRAFT→PUBLISHED, legal suite re-run green (§4)
☐ Deployed at c89c495, smoke §2 green, rollback §3 certified (§5)
☐ Backup schedule live on the real DB (OPERATIONS_RUNBOOK.md)
—— reserved, explicit authorization each ——
☐ Enable live payments   ☐ DNS / public cutover
```

---
**Status:** §0 verified locally at `c89c495`. §1–§5 are prepared command sheets awaiting an
authenticated deploy target and the owner inputs in `OWNER_ACTIONS.md`. No production action taken.
