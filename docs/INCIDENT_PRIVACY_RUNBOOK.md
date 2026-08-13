# SYBNB — Incident, Privacy-Request & Breach-Response Runbook

Operational procedures. **Legal thresholds/deadlines are for counsel** — as a Québec enterprise
(operator 9375-7649 QUÉBEC INC.), **Law 25** breach-notification and data-subject-rights rules
likely apply; this runbook is the operational skeleton, not the legal determination.

## Monitoring signals & alerts (wire to the chosen sink)
- **Error rate:** alert on `level:"error"` log lines and on `http_request` with `status>=500`.
- **Readiness:** alert if `GET /api/health/ready` returns non-200 (DB unreachable); liveness via
  `GET /api/health/live`.
- **Auth abuse:** watch spikes of `RATE_LIMITED`, `OTP_LOCKED`, `INVALID_CREDENTIALS`, and gift/
  payment-webhook rejections (`PAYMENT_SIGNATURE_INVALID`, `PAYMENT_SIGNATURE_EXPIRED`).
- **Payments:** watch `PAYMENT_AMOUNT_MISMATCH` / `PAYMENT_CURRENCY_MISMATCH` and reconciliation
  mismatches (`reconciliation.reconciled=false` from `GET /api/payments/intents/:id`).
- Every log line carries `requestId` (echoed as `x-request-id`) for correlation. Secrets are
  redacted; bodies/headers are never logged.

## Incident response (severity-agnostic skeleton)
1. **Detect & correlate** — capture `requestId`s, endpoints, timeframe.
2. **Assess** — user-facing outage? data exposure? financial anomaly?
3. **Contain** — for a compromised secret rotate it (`AUTH_SECRET` rotation invalidates sessions),
   redeploy; for a bad actor, suspend the account (admin); for a dependency, pin/patch.
4. **Preserve** — snapshot logs + take a fresh DB backup **before** any corrective data action.
5. **Recover** — restore service; if DB corruption, restore from backup to a new DB and cut over
   (never mutate prod data without a backup + written change record).
6. **Review** — post-incident write-up; add a regression test if a defect was involved.

## Escalation / support
- User support: `support@sybnb.app`, WhatsApp `+963 998 191 422`.
- Legal notices: `legal@sybnb.app`. Privacy requests: `privacy@sybnb.app`.
- `[[OWNER: on-call owner/operator + escalation order + response-time targets]]`

## Privacy-request handling (Law 25 / applicable law → counsel confirms specifics)
Requests arrive at `privacy@sybnb.app`. Operational steps:
1. **Verify identity** of the requester (avoid disclosing to the wrong person).
2. **Access:** compile the person's data — account, listings, messages, payment refs, wallet/gift
   records, ride history, KYC document (stored privately). Retrieve KYC via a short-lived signed URL.
3. **Correction:** update the stored fields.
4. **Deletion:** delete the account's KYC object (storage supports delete) and personal fields,
   **subject to** records that must be retained (payment/audit/legal-hold) — the wallet ledger and
   admin audit log are append-only for integrity; counsel sets what is retained vs erased.
5. **Respond** within the statutory period. `[[COUNSEL: rights offered + deadlines]]`
> Note: a self-service data-export/delete UI is **not** built; requests are handled operationally by
> an admin today. Building self-service is a post-launch improvement (P2), not a launch blocker.

## Breach response (operational; legal specifics → counsel)
1. **Contain** the exposure (rotate secrets, revoke access, patch).
2. **Scope** — what data, whose, how many, timeframe (use logs/audit).
3. **Preserve** evidence + backup.
4. **Notify** — `[[COUNSEL determines: notification to the Québec regulator (CAI) and affected
   individuals, thresholds, and deadlines under Law 25; plus any Syrian-market obligations]]`.
5. **Remediate & document.**

## Backup / restore (evidence)
Backup + **restore drill verified locally**: `pg_dump --format=custom` → `pg_restore` into a
disposable DB restored **exact row counts** with FK constraints and idempotency/unique indexes
intact. Production must schedule encrypted off-host dumps + periodic restore drills (see
`docs/OPERATIONS_RUNBOOK.md`). Object-storage buckets need versioning + lifecycle retention.
