# Migrations 078-083 (082 closure + 083 organization boundary) -- production runbook (do NOT run until management approves)

> **DEPLOYING THIS BRANCH TO A PRODUCTION-CONNECTED RENDER SERVICE WILL APPLY MIGRATIONS 078-083** (production main stops at 077; 083 = organization boundary for audit / security / evidence rows). `npm run start:render` and the Render pre-deploy command both run `prisma migrate deploy`.
>
> Required before ANY production deploy of this code: approved migrations 078-083 - database recovery point/backup - environment verification - `ADMIN_ACTIVATION_MODE` decision - this runbook ready.
>
> Safety gate (STEP 5E): `node server/lib/migration-gate.mjs` runs before `prisma migrate deploy` and STOPS the deploy, changing nothing, while 078-083 are pending and `APPROVED_MIGRATIONS=083_security_record_organization_boundary` (the latest reviewed migration; an approval naming 082 does NOT approve 083) is not set on that service. The gate is already in `package.json` (`start:render`) and `render.yaml`. The LIVE Render service `rezekme-api` has its pre-deploy command set in the dashboard (`npx prisma migrate deploy`), which the repo cannot change: an operator must edit it to `node server/lib/migration-gate.mjs && npx prisma migrate deploy` BEFORE deploying this code. `sybnb-backend` (`npm run start:render`) is gated automatically.

Follow this runbook in order.

## PRECHECK
1. Backup / recovery point taken and its restore time confirmed (Neon branch/snapshot of the production database).
2. Branch/commit to deploy is the approved one (`step5-admin-foundation` at the reviewed commit, merged per management).
3. DB connectivity from the deploy host (`prisma migrate status` reachable).
4. Migration history: `prisma migrate status` shows 001..077 applied (production's current level) and 078-083 pending, nothing failed/rolled back. Read-only check that none of the Step 5 migrations has been applied yet: `SELECT migration_name FROM _prisma_migrations WHERE migration_name >= '078' ORDER BY 1;` (expect no rows).
5. No unexpected drift on these tables: `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` (read only; never use a shadow DB) shows no lines for security_bootstrap, authorization_evidence, security_events, organizations, users. Never apply the generated SQL.

## MIGRATION
1. Set `APPROVED_MIGRATIONS=083_security_record_organization_boundary` on the service, then `prisma migrate deploy` (082 and 083 are each one atomic transaction). After 083: legacy audit / security / evidence rows have `organization_id IS NULL` (unattributed, invisible to organization-scoped admins); see `docs/admin/STEP5I_LEGACY_ATTRIBUTION_RUNBOOK.md`.
2. Verify: table `security_bootstrap` with 10 FKs (all `r`/`r`), checks `security_bootstrap_shape_chk`/`state_chk`, triggers `security_bootstrap_guard_trg`, `security_bootstrap_retention_trg`, `organizations_bootstrap_provision_trg`, `organizations_bootstrap_cleanup_trg`; `authorization_evidence.ruleset_version` NOT NULL with no default.
3. Seed: `scripts/admin-foundation-seed.mjs` only if the permission catalogue changed; the bootstrap rows no longer need it.
4. Existing organizations: every organization has exactly one REQUIRED row (`SELECT count(*) FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM security_bootstrap b WHERE b.organization_id=o.id)` = 0). All pre-existing evidence reads `LEGACY_PRE_VERSIONED`; the evidence chain verifies.
5. Security time: `GET /api/health` returns `securityTimeReady: true` (retry for ~10 s after start).

## BOOTSTRAP
1. Set `ADMIN_BOOTSTRAP_SECRET` (>= 32 random characters) on the API service and restart.
2. Sign in as the legitimate existing Owner with the emailed code (PASSWORD_PLUS_EMAIL_CODE).
3. `POST /api/admin2/security/bootstrap/owner` with header `x-bootstrap-secret` and a reason (>= 20 chars). The organization is resolved server-side from your own Owner assignment; it cannot be chosen. An Owner of several organizations gets 409 `ORGANIZATION_CONTEXT_REQUIRED` (not supported by this endpoint).
4. Verify: CRITICAL `OWNER_BOOTSTRAP_COMPLETED` security event, `security.owner_bootstrap_completed` audit row, `owner_bootstrap` evidence row, bootstrap row COMPLETED with all fields set, and the Owner holds the latest OWNER version.
5. REMOVE or ROTATE `ADMIN_BOOTSTRAP_SECRET` immediately and restart.

## POSTCHECK
- `GET /api/admin2/security/bootstrap`: state COMPLETED, no secret warning; a second POST returns 409 `BOOTSTRAP_CLOSED`.
- Ordinary high-risk grants still pend 48 h (request -> review -> Owner approval -> activation_at = approval + 48 h).
- Scheduler: `ADMIN_ACTIVATION_MODE=EXTERNAL` with a cron running `node scripts/admin-activation-run.mjs`; `activation_mode` log line matches.
- Critical notifications reach the security recipients; failed deliveries are retried.
- Session and authorization health: staff sign-in works, `/api/admin2/health` shows clock ready, evidence chain verifies.

## ROLLBACK / RECOVERY
- After the migration, remove `APPROVED_MIGRATIONS` (or leave it: it only matters while gated migrations are pending).
- Migration fails (before bootstrap): 082 is one transaction, so no partial schema remains. Run `prisma migrate resolve --rolled-back 082_security_foundation_closure`, fix the cause, redeploy. If needed restore the pre-migration recovery point (nothing has been bootstrapped, no evidence is lost).
- Bootstrap fails: the whole bootstrap transaction rolls back; state stays REQUIRED; the denial is recorded. Fix the cause and retry.
- AFTER a successful bootstrap: no destructive rollback and no restore that would erase security events, audit rows or evidence. Use forward correction only: new migrations or new, audited, approved role/assignment changes through the normal workflow.
