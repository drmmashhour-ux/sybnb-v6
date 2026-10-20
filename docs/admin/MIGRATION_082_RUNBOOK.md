# Migration 082 -- production runbook (do NOT run until management approves)

WARNING: `npm run start:render` runs `prisma migrate deploy`; deploying main applies 082 automatically. Follow this runbook in order.

## PRECHECK
1. Backup / recovery point taken and its restore time confirmed (Neon branch/snapshot of the production database).
2. Branch/commit to deploy is the approved one (`step5-admin-foundation` at the reviewed commit, merged per management).
3. DB connectivity from the deploy host (`prisma migrate status` reachable).
4. Migration history: `prisma migrate status` shows 001..081 applied, 082 pending, nothing failed/rolled back.
5. No unexpected drift on these tables: `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` (read only; never use a shadow DB) shows no lines for security_bootstrap, authorization_evidence, security_events, organizations, users. Never apply the generated SQL.

## MIGRATION
1. `prisma migrate deploy` (one transaction; all-or-nothing).
2. Verify: table `security_bootstrap` with 10 FKs (all `r`/`r`), checks `security_bootstrap_shape_chk`/`state_chk`, triggers `security_bootstrap_guard_trg`, `security_bootstrap_retention_trg`, `organizations_bootstrap_provision_trg`, `organizations_bootstrap_cleanup_trg`; `authorization_evidence.ruleset_version` NOT NULL with no default.
3. Seed: `scripts/admin-foundation-seed.mjs` only if the permission catalogue changed; the bootstrap rows no longer need it.
4. Existing organizations: every organization has exactly one REQUIRED row (`SELECT count(*) FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM security_bootstrap b WHERE b.organization_id=o.id)` = 0). All pre-existing evidence reads `LEGACY_PRE_VERSIONED`; the evidence chain verifies.
5. Security time: `GET /api/health` returns `securityTimeReady: true` (retry for ~10 s after start).

## BOOTSTRAP
1. Set `ADMIN_BOOTSTRAP_SECRET` (>= 32 random characters) on the API service and restart.
2. Sign in as the legitimate existing Owner with the emailed code (PASSWORD_PLUS_EMAIL_CODE).
3. `POST /api/admin2/security/bootstrap/owner` with header `x-bootstrap-secret` and a reason (>= 20 chars). Add `?organizationId=<uuid>` only if there are several organizations.
4. Verify: CRITICAL `OWNER_BOOTSTRAP_COMPLETED` security event, `security.owner_bootstrap_completed` audit row, `owner_bootstrap` evidence row, bootstrap row COMPLETED with all fields set, and the Owner holds the latest OWNER version.
5. REMOVE or ROTATE `ADMIN_BOOTSTRAP_SECRET` immediately and restart.

## POSTCHECK
- `GET /api/admin2/security/bootstrap`: state COMPLETED, no secret warning; a second POST returns 409 `BOOTSTRAP_CLOSED`.
- Ordinary high-risk grants still pend 48 h (request -> review -> Owner approval -> activation_at = approval + 48 h).
- Scheduler: `ADMIN_ACTIVATION_MODE=EXTERNAL` with a cron running `node scripts/admin-activation-run.mjs`; `activation_mode` log line matches.
- Critical notifications reach the security recipients; failed deliveries are retried.
- Session and authorization health: staff sign-in works, `/api/admin2/health` shows clock ready, evidence chain verifies.

## ROLLBACK / RECOVERY
- Migration fails (before bootstrap): 082 is one transaction, so no partial schema remains. Run `prisma migrate resolve --rolled-back 082_security_foundation_closure`, fix the cause, redeploy. If needed restore the pre-migration recovery point (nothing has been bootstrapped, no evidence is lost).
- Bootstrap fails: the whole bootstrap transaction rolls back; state stays REQUIRED; the denial is recorded. Fix the cause and retry.
- AFTER a successful bootstrap: no destructive rollback and no restore that would erase security events, audit rows or evidence. Use forward correction only: new migrations or new, audited, approved role/assignment changes through the normal workflow.
