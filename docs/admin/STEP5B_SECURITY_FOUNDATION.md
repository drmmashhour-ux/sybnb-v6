# Step 5B — Security foundation closure

Scope: close the Step 5A gaps. No product modules were added.

## 1. One-time Owner bootstrap (`server/lib/authz/bootstrap.mjs`)
State machine per organization, table `security_bootstrap`: `SECURITY_BOOTSTRAP_REQUIRED` → `SECURITY_BOOTSTRAP_COMPLETED` (terminal).
Endpoint: `POST /api/admin2/security/bootstrap/owner` (header `x-bootstrap-secret`, body `reason`); `GET /security/bootstrap` shows state.

Preconditions (all checked inside one transaction, state row locked `FOR UPDATE`):
- deployment secret `ADMIN_BOOTSTRAP_SECRET` set (>= 32 chars, otherwise bootstrap is disabled: fail closed) and supplied by the operator (constant-time compare)
- session signed in with password + emailed code (`PASSWORD_PLUS_EMAIL_CODE`), fresh step-up (route requires tier-4 `access.assign`)
- reason of at least 20 characters
- state is REQUIRED and no valid holder of the latest Owner version exists
- the caller is the target: an active Owner of THIS organization on an OLDER Owner version (cannot create or promote anyone else)
- result must leave a valid holder of `access.assign`, `access.approve`, `user.reactivate`

Effects: old assignment SUPERSEDED, new assignment on the latest Owner version ACTIVE immediately, assignment events (old/new version recorded), immutable audit row, hash-chained authorization evidence (with rule-set version), CRITICAL security event with in-app notifications, state row filled with old/new role versions, reason and the statement that the multi-party workflow was unavailable.
Every denied attempt writes a WARNING security event and audit row (never the secret).

### Replay prevention
1. state row locked, COMPLETED => 409 `BOOTSTRAP_CLOSED`
2. trigger `security_bootstrap_guard`: no delete, COMPLETED is immutable, insert only as REQUIRED (direct SQL cannot reopen it without dropping the trigger)
3. "no latest-version holder" re-evaluated in the same transaction
4. old assignment superseded in the same transaction (nothing left to migrate)
5. conditional `UPDATE ... WHERE state = REQUIRED` must change exactly one row
6. operator secret from the deployment environment (rotate/unset after use)

### 48 h exception
Only inside `completeOwnerBootstrap`. `createAssignment`/`approveAssignment` have no flag for it and always apply the policy delay (>= 48 h). Hard conditions: first bootstrap, target is an existing legitimate Owner, no latest-version Owner, never completed before, evidence + CRITICAL event written. After completion every high-risk grant takes 48 h (test F).

## 2. Activation worker (`activation-worker.mjs`)
`runActivationCycle` finds PENDING_ACTIVATION rows with `activation_at <= now`, claims each with `SELECT ... FOR UPDATE SKIP LOCKED`, revalidates (not revoked, approved, role version valid, not expired, target ACTIVE, no open suspension, scopes exist), then conditional `UPDATE ... WHERE status='PENDING_ACTIVATION'`, writes ACTIVATED event, audit row and HIGH security event, supersedes the replaced assignment (continuity-checked). Blocked rows stay pending; a block is recorded once per reason.
Hooks: in-process interval in `server/index.mjs` (`ADMIN_ACTIVATION_INTERVAL_MS`, min 5000, default 60000; `ADMIN_ACTIVATION_JOB=off` disables); external cron / multi-replica: `node scripts/admin-activation-run.mjs`. The lazy page-view sweeper was removed.
State model: the evaluator remains the boundary — it allows a due approved PENDING_ACTIVATION assignment and denies anything before `activation_at`, whether or not the worker has run (tests G/H/L). The worker only normalizes state.
Idempotency/concurrency: skip-locked claim + conditional update + events only when one row changed; tested with three concurrent cycles (test K).

## 3. Prisma UUID drift
`@db.Uuid` (and `dbgenerated("gen_random_uuid()")` where the DB has that default) added to 134 fields of Step 3A–5A models; `AdminAuditLog` timestamptz/FK actions/index names aligned. Migration 082 adds `security_bootstrap`, `authorization_evidence.ruleset_version`, `security_events.delivery`. `prisma migrate diff --from-schema-datasource --to-schema-datamodel` against the test DB: zero differences on any Step 3A–5B table. Remaining drift is legacy (64 pre-existing tables, unrelated to this work, untouched).

## 4. noSelf decision
Stays in `catalogue.mjs` (single place, not duplicated in routes). Versioned: `PERMISSION_RULESET_VERSION` + SHA-256 fingerprint registry; a unit test fails if any tier/high-risk/noSelf/reserved flag changes without a new registered version. Every authorization evidence row stores `ruleset_version`. Not moved to the database (tier/high_risk already are, enforced by trigger).

## 5. Notification policy `CRITICAL_SECURITY_RECIPIENTS` (`notifications.mjs`)
Resolves active Owner-role holders plus active users holding `security_event.review`. Notification only; it confers no permission (test: Owner-v1 holder is notified but does not hold `security_event.review`). Authorization never uses role names.
Transport interface: `registerTransport({name, deliver})`; `in_app` built in; email/push/SMS plug in later without touching event generation. Each transport runs in a SAVEPOINT; failures are recorded in `security_events.delivery` and never roll back the event.

## 6. Last-authority protection (`continuity.mjs`)
Capabilities `access.assign`, `access.approve`, `user.reactivate`: suspension (standard and emergency), revocation and supersede/auto-migration fail with 409 `LAST_AUTHORITY` if they would remove the last valid holder in an organization that currently has one. Not immunity: an Owner can be suspended once another valid holder exists. Recovery/transfer path: grant a second holder (ordinary 48 h workflow, or the one-time bootstrap), then remove/suspend the first; a suspended holder can be reactivated by a different authorized person.
