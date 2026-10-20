# Step 5C — Security hardening

## 1. Trusted time policy (decision: the DATABASE clock is authoritative for security state)
Module: `server/lib/authz/clock.mjs`. Rules:
1. Inside a transaction that changes security state: read ONE timestamp with `dbNow(tx)` (Postgres `now()`, fixed for the transaction). Use it for every comparison and every written timestamp. Never mix it with `new Date()` / `Date.now()` in the same decision, and never rely on a column `DEFAULT now()` for a value that a decision compares.
2. On the request path (evaluator, session validity, step-up window) a database round trip per decision is too costly, so the app uses `trustedNow()`: the app clock corrected by the measured offset to the database clock (sampled at start-up and every 60 s; lowest-round-trip of the last 5 samples wins). It follows the database clock, not the host clock. Residual error is round-trip jitter (ms) and fails CLOSED (a value stamped a few ms "in the future" is denied for those ms; nothing is allowed early).
3. Evidence rows use `dbClock()` (`clock_timestamp()`) read under the chain lock, so the chain stays monotonic.
4. Continuity, bootstrap and the activation worker derive their own `now` from the database inside their transaction; nothing depends on the ordering of two clocks at millisecond level.
5. The 48 h delay is never reduced by clock handling: `activation_at = approved_at (database time) + delay`; the evaluator compares strictly (`now >= activation_at`), no tolerance.

Audit of time-sensitive items (before → after):
| Item | Before | After |
|---|---|---|
| role_assignments.effective_from (non-high-risk grant) | DB default now(), compared to app clock | `dbNow(tx)` written explicitly |
| activation_at / approved_at / reviewed_at / revoked_at | app `new Date()` | one `dbNow(tx)` per transaction |
| effective_to (temporary access) | validated against app clock | `trustedNow()` |
| bootstrap | app `now` (5B clock-skew bug) | `dbNow(tx)`; `effective_from = approved_at = activation_at` |
| activation worker scan + claim | app clock | `dbNow` |
| suspension / reactivation, session revocation timestamps | app clock | `dbNow(tx)` / `trustedNow()` |
| session expires_at / issued_at | app clock vs DB default | `trustedNow()` vs DB default (same clock family) |
| step-up (`step_up_at`) and its window check | app clock vs DB `issued_at` | `dbNow(tx)` written; window compared with `trustedNow()` |
| role version effective_from/effective_to on publish | app clock | `dbNow(tx)` |
| evaluator "now", policy lookup | app clock | `trustedNow()` |
| retention `retain_until` | app clock | `trustedNow()` (only ever lengthens; not a comparison) |
| break-glass | records a request only, grants nothing, no expiry exists yet | **requirement for when it is built:** expiry stored and compared on database time |
| delegation | not implemented | same rule applies when added |
Tests: unit boundary tests (activation_at, effective_from, effective_to, revoked_at at ±1 ms), clock-corrector unit tests, e2e with the application `Date` forced ±8 s / +10 s.

## 2. Bootstrap secret lifecycle
- `completeOwnerBootstrap` first reads the state; if COMPLETED it answers `409 BOOTSTRAP_CLOSED` (recorded as a WARNING event + audit row) BEFORE evaluating the reason, the secret or the session strength. A secret left in the environment is inert. The HTTP route does the same check before authorization.
- Diagnostics (never the value): `bootstrapSecretDiagnostics()`; startup logs `security_config_warning` ("BOOTSTRAP SECRET STILL CONFIGURED AFTER COMPLETION"); `GET /api/admin2/security/bootstrap` and `/api/admin2/health` (`securityFoundation.bootstrap`).
- **REMOVE OR ROTATE ADMIN_BOOTSTRAP_SECRET AFTER SUCCESSFUL BOOTSTRAP.** There is no master-secret mechanism.

## 3. Activation scheduler deployment mode
`ADMIN_ACTIVATION_MODE` = `IN_PROCESS` | `EXTERNAL` | `DISABLED`.
- IN_PROCESS: this API process runs the interval (development, single instance). Default when unset (warning in production).
- EXTERNAL: the API starts nothing; schedule `node scripts/admin-activation-run.mjs` (activation cycle + notification retry) every minute. **Recommended for production with more than one replica.**
- DISABLED: nothing runs (the evaluator still enforces `activation_at`).
Legacy `ADMIN_ACTIVATION_JOB=off` maps to DISABLED. An unknown value fails safe to DISABLED with a logged warning. Every mode stays correct because the worker is idempotent (skip-locked claim + conditional update). The chosen mode is logged at start-up and shown in `/health`.

## 4. Security-event delivery failure
Persistence, audit and the action result never depend on delivery. A failed transport is recorded in `security_events.delivery[transport] = {error, attempts, lastAttemptAt}`. `retryFailedDeliveries()` (run by the scheduler tick and `admin-activation-run.mjs`) re-sends only failed transports to the currently resolved recipients, `FOR UPDATE SKIP LOCKED`, max 10 attempts; transports not configured on the deployment are marked `abandoned`. Recovered events are never re-sent.

## 5. Continuity matrix
Hard requirement (enforced, 409 `LAST_AUTHORITY`): at least one valid holder per organization of
- `access.assign` — administer access
- `access.approve` — final approval of high-risk grants
- `user.reactivate` — recover a suspended account
Review of the three candidates (NOT added as hard requirements):
- `security_event.review`, `session.revoke`, `user.suspend_emergency`: losing them hurts oversight/containment speed but does not make the organization unrecoverable, because a holder of the three hard capabilities can still grant them (48 h) and Owner v2 holds all three. Making them hard would block ordinary role reductions.
- Recommendation: report them as **soft diagnostics** (health warning when an organization has zero valid holders) and keep them in the Owner version; revisit as hard requirements only if a role without them is introduced.
Approved transfer/recovery path: grant the capability to a second holder first (ordinary 48 h workflow, or the one-time bootstrap), then remove/suspend the first; a suspended holder is reactivated by a different authorized person (`user.reactivate`, separation of duties).

## 6. Last-authority transactions and locking
Every authority-removing path runs inside one transaction and calls `assertContinuity` / `assertCapabilitiesRetained`, which first takes `pg_advisory_xact_lock(hashtextextended('authz-continuity:<org>'))` (sorted order, held to commit), then counts holders (READ COMMITTED sees the previous committer's removal):
suspension (standard + emergency), revocation, supersede / migration, automatic reducing-version migration, activation-worker supersede, Owner bootstrap (also locks the organization). Tests race suspend-vs-suspend, revoke-vs-revoke and suspend-vs-revoke (exactly one succeeds); the same test fails when the lock is removed (verified by mutation).

## 7. Repository cleanup
See the Step 5C report: no merge/rebase/cherry-pick in progress, no live lock; leftover files are my own renamed lock files and git temp objects.
