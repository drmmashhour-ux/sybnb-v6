# STEP 5D -- production security gate (migration 082 + trusted time)

Status: reviewed on the TEST database only. Migration 082 has NOT been applied to production. Not merged to main.

## 1. Trusted-time readiness
- `server/lib/authz/clock.mjs`: security time is READY only after the first database clock sample and while the newest sample is younger than the maximum age. Start-up samples immediately and retries every 2 s until it succeeds; afterwards every 60 s.
- `trustedNow()` (strict) throws `SECURITY_TIME_NOT_READY` (503). `approxNow()` is best effort and is used only for harmless/housekeeping paths (session listings, notification defaults, retention defaults, policy lookup default).
- Evaluator: when time is untrusted, every time-sensitive permission (tier >= 3, high-risk, or with a step-up window) is DENIED with `SECURITY_TIME_NOT_READY` (and, being tier 3/4, the denial is written as evidence). Harmless reads continue, but only on plain assignments (ACTIVE, no activation window, no expiry, not revoked); any non-lifted suspension is treated as in force.
- Callers that inject `now` (read from their own DB transaction via `dbNow`) are trusted by construction.
- Health: `GET /api/health` returns `securityTimeReady: true|false` (boolean only). `/api/admin2/health` shows the detailed clock status to authorized staff.

### Stale-sample policy
Maximum sample age 5 min (`ADMIN_SECURITY_TIME_MAX_AGE_MS`, clamped 30 s..15 min, never unbounded). Rationale: 60 s resample interval tolerates ~4 missed samples; 100 ppm host drift is ~30 ms in 5 min. Beyond the bound: privileged time-sensitive authorization fails closed until a new sample succeeds (recovery is automatic). Samples older than the bound never contribute to the offset.

## 2. Migration 082 referential integrity (individual decisions)
| column | references | ON DELETE / ON UPDATE | reason |
|---|---|---|---|
| organization_id | organizations | RESTRICT / RESTRICT (was RESTRICT / CASCADE) | ids are immutable; evidence must never be re-keyed |
| completed_by_id, target_user_id | users | RESTRICT / RESTRICT | historical identity preserved; matches role_assignments -> users (RESTRICT) |
| old_assignment_id, new_assignment_id | role_assignments | RESTRICT / RESTRICT | assignments are append-only |
| old_role_version_id, new_role_version_id | role_versions | RESTRICT / RESTRICT | immutable versions |
| security_event_id | security_events | RESTRICT / RESTRICT | append-only |
| audit_event_id | admin_audit_logs | RESTRICT / RESTRICT | append-only |
| evidence_id | authorization_evidence | RESTRICT / RESTRICT | append-only hash chain |

No cycle: none of the referenced tables references `security_bootstrap`; the completing transaction creates the event/audit/evidence rows before updating the bootstrap row. Deployment order is a single migration transaction; the Prisma schema carries the same relations (`onDelete: Restrict, onUpdate: Restrict`).

## 3. Shape constraint
REQUIRED: completed_at, completed_by_id, target_user_id, old/new assignment, old/new role version, reason, workflow_unavailable_reason, security_event_id, audit_event_id, evidence_id must ALL be NULL. COMPLETED: all NOT NULL (target = completer). Each field is tested individually.

## 4. Organization provisioning
Database trigger `organizations_bootstrap_provision_trg` (AFTER INSERT) creates the REQUIRED row in the same transaction, for every code path (service, script, bulk, SQL). A rolled-back organization leaves no row. `organizations_bootstrap_cleanup_trg` removes only a still-REQUIRED (evidence-free) row when its organization is deleted; a COMPLETED row can never be deleted (guard + FK). No repair job is needed; the seed's insert is now a harmless no-op.

## 5. ruleset_version
Column is `NOT NULL`, no default, CHECK non-blank. Every row existing at migration time is marked `LEGACY_PRE_VERSIONED` (added with a temporary DEFAULT, which fires no append-only trigger). The marker is excluded from the evidence hash, so historical hashes still verify; the writer refuses missing/blank/legacy values (`EVIDENCE_RULESET_REQUIRED`).

## 6. Test-only export
Removed from production. `bootstrap.mjs` re-exports only the OWNER entry point, constants and diagnostics. The generic runner lives in `bootstrap-core.mjs`, imported only by `bootstrap.mjs` and by `tests/support/bootstrap-test-adapter.mjs`. Static test `authz-bootstrap-surface` enforces: exact export list, no other importer, no `TestOnly` symbol, no dynamic import, route cannot choose a role.

## 7. HTTP closed-first
`POST /api/admin2/security/bootstrap/owner`. For an Owner of a COMPLETED org: wrong secret, correct secret, missing reason and no header all get 409 `BOOTSTRAP_CLOSED`; the record is unchanged and each attempt is recorded. (5D briefly added an `?organizationId=` override for this test; STEP 5E REMOVED it -- see STEP5E_PRE_MERGE_GATE.md.)

## 8. Dry-run results (Neon scratch DBs in the test project, never production)
- Fresh DB (`migration_fresh_5d`): all 82 migrations apply; 10 RESTRICT FKs, checks, 4 triggers present; new org -> REQUIRED row; partial REQUIRED updates, COMPLETED insert, row delete, retention shortening, duplicate row, evidence without/blank ruleset all rejected; org delete removes REQUIRED row.
- Upgrade DB (`migration_upgrade_5d`): 081-state data (6 orgs, 6 hash-chained evidence rows without ruleset_version) -> 082 applied; 6/6 orgs REQUIRED; 6/6 evidence preserved and marked LEGACY; hash chain verifies; evidence UPDATE/DELETE still blocked.
- Failure/rollback: 082 with an injected error at the end left NO table, column, function or trigger; only a failed `_prisma_migrations` row, cleared with `migrate resolve --rolled-back`, then the real 082 applied.
- Prisma: `migrate diff` (datasource vs datamodel) is identical on both DBs (1,211 lines, same legacy-table drift as 5C); zero lines touch security_bootstrap, authorization_evidence, security_events, organizations, users or any admin foundation table.
- Persistent test DB received an equivalent delta (the test DB had the old 082); its 290 NULL evidence rows were back-filled with the legacy marker with the append-only trigger suspended for that one statement (test DB only).

## 9. Unresolved production blockers
1. Deploying this branch applies migrations 078-082 automatically (`start:render` and the Render pre-deploy command run `prisma migrate deploy`). 5E added an approval gate (see STEP5E_PRE_MERGE_GATE.md).
2. `ADMIN_BOOTSTRAP_SECRET` must be provisioned by an operator and removed/rotated after bootstrap.
3. Production should run `ADMIN_ACTIVATION_MODE=EXTERNAL` with a scheduled `scripts/admin-activation-run.mjs`.
4. Legacy Prisma drift (55 product tables) remains documented, not security-relevant.
5. Multi-replica deployments: each instance samples the clock itself; a DB outage > 5 min makes all privileged actions fail closed (intended).
