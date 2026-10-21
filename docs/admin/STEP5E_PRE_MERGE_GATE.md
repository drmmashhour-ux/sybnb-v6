# STEP 5E -- pre-merge security gate

> **DEPLOYING THIS BRANCH TO A PRODUCTION-CONNECTED RENDER SERVICE WILL APPLY MIGRATIONS 078-083** (082 = security foundation closure, 083 = organization boundary for security records). Production has never received any of them: its deployed commits stop at migration 077. Do not treat this branch as a harmless admin preview.

## 1. Organization binding of the Owner bootstrap
- The 5D `?organizationId=` override is REMOVED. `POST /api/admin2/security/bootstrap/owner` takes no organization from the query, body, header or route.
- The organization is resolved server-side by `resolveBootstrapOrganization` (bootstrap-context.mjs) from the caller's OWN active OWNER assignments that have an ORGANIZATION scope:
  - none (no Owner, or Owner only at PLATFORM / legal-entity / business-unit scope) -> plain 403 `PERMISSION_DENIED`, nothing recorded or changed;
  - exactly one -> that organization;
  - several -> 409 `ORGANIZATION_CONTEXT_REQUIRED` (fail closed; choosing among organizations must use the future standard organization-context mechanism, not a bootstrap-specific selector).
- Fixed a latent defect found by the new tests: the route authorized `access.assign` against the shared "oldest organization" default instead of the resolved organization. The resource now carries the resolved organization.
- Defence in depth is unchanged: authorization (tier 4 + step-up + evidence), closed-first check, secret, strong auth, and the core's own `NOT_LEGITIMATE_OWNER` check (Owner of THIS organization on an older Owner version).
- Test capability stays outside the HTTP surface: the HTTP closed-first test now logs in as the completed organization's own Owner; guard tests use `tests/support/bootstrap-test-adapter.mjs`.
- Static test: the bootstrap route section reads no `r.query`, `r.params` or body/header organization; the only header read is `x-bootstrap-secret`.

## 2. Deployment migration safety
- `server/lib/migration-gate.mjs` runs BEFORE `prisma migrate deploy` (in `render.yaml` preDeployCommand and `npm run start:render`). It reads `_prisma_migrations` (read-only) and, if any of 078-083 is pending and `APPROVED_MIGRATIONS` does not include `083_security_record_organization_boundary` (approval is "through": it covers the earlier pending gated migrations), prints a banner and exits 1: the deploy stops with no schema change. It also fails closed if the history cannot be read. It lives under `server/` so the existing Docker image already contains it. No new infrastructure.
- Live services (read from Render, not changed): `rezekme-api` (docker, dashboard pre-deploy `npx prisma migrate deploy`, branch main) and `sybnb-backend` (docker command `npm run start:render`, branch main), both autoDeploy off. `sybnb-backend` is gated automatically after the merge. `rezekme-api`'s pre-deploy command lives in the dashboard: an operator must change it to `node server/lib/migration-gate.mjs && npx prisma migrate deploy` BEFORE deploying merged code.
- Before approving: approved migration 082, database recovery point/backup, environment verification, `ADMIN_ACTIVATION_MODE` decision (EXTERNAL recommended), Owner bootstrap runbook ready.

## 3. Final migration 082 review
Contains: `security_bootstrap` (terminal state via guard trigger; state and strict REQUIRED/COMPLETED shape checks); 10 FKs, all RESTRICT/RESTRICT; automatic REQUIRED row for new organizations (AFTER INSERT) and safe delete (only a REQUIRED row goes with its organization; COMPLETED is permanent); 7-year retention default plus `retention_no_shorten` trigger; `authorization_evidence.ruleset_version` filled with `LEGACY_PRE_VERSIONED`, then NOT NULL with the default dropped and a non-blank check; `security_events.delivery` JSONB. Single atomic migration (no transaction statements; the injected-failure dry-run in 5D left no partial schema). Unchanged by 5E.
Never applied to production: production deploys are main-branch commits ending at migration 077 (the latest live deploy is main commit `fa0d9fbd`, whose migration directory ends at 077); this session had access only to the test database. See `docs/admin/MIGRATION_082_RUNBOOK.md` for the read-only verification query an operator can run: `SELECT migration_name FROM _prisma_migrations WHERE migration_name >= '078' ORDER BY 1;` (expect no rows).

## 4. Test-surface audit (production runtime)
- Bootstrap test adapter exists only at `tests/support/`. The generic role runner (`bootstrap-core.mjs`) is imported only by `bootstrap.mjs`, `bootstrap-context.mjs` (a constant) and the test adapter; it is not re-exported and no route reaches it.
- No `TestOnly` symbol, no dynamic import, no fixture/dev endpoint in `server/`; no environment switch changes bootstrap behavior (the only bootstrap variable is `ADMIN_BOOTSTRAP_SECRET`, which is inert once COMPLETED).
- The production API cannot choose role or organization for the bootstrap.
- Pre-existing, outside Step 5 (noted only): `OTP_EXPOSE_FOR_TEST` (refused in production by `server/lib/env.mjs`) and two `PAYMENT_POLICY_TEST_*` overrides in `payment-policy.mjs` (already gated to non-production environments).
