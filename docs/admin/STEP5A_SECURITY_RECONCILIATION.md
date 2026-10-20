# STEP 5A -- Security reconciliation with the locked Step 3A decisions

Scope: align the Step 5 foundation with 3A-4 (48 h activation delay), 3A-6 (>= 7 y retention) and 3A-10
(emergency suspension authority, dedicated SECURITY_ADMIN). Test database only. Nothing here was applied to
production; production receives migration 081 and the seed only after management review.

## Reconciliation (requirement / current / status / change)

| Requirement | Current (pre-5A) | Status | Change |
|---|---|---|---|
| Canonical permission namespace | First-cut names (`iam.role_assignment.assign`, `sec.event.read`...) | MISMATCH | 46 codes renamed in place (same ids), old names kept in `permission_code_aliases` |
| High-risk registry is data | `permission_definitions.high_risk` existed; routes had `highRisk` flag checks | PARTIAL | `risk.mjs` is the only reader; seed writes the flag (tier 4 always high-risk) |
| 48 h activation delay | High-risk grant: PENDING_APPROVAL -> ACTIVE on 2nd approval (instant) | MISSING | Workflow REQUESTED -> UNDER_REVIEW -> PENDING_ACTIVATION (`activation_at = approved_at + 48h`) -> ACTIVE; evaluator denies before `activation_at` |
| Immediate removal | Revoke immediate | OK | Kept; now also covers UNDER_REVIEW / PENDING_ACTIVATION; a revoked pending grant never activates |
| Role-version safety | Immutable versions, policy B | PARTIAL | Expansions never migrate holders; REDUCING versions move holders at once; explicit migrate endpoint uses the high-risk workflow |
| SECURITY_ADMIN | Read-mostly role | MISMATCH | v2 adds security.view/manage, user.suspend_emergency, user.reactivate, privileged_access.review, break_glass.review, security_event.review, permission.view; no financial authority |
| Emergency suspension | Single `iam.user.suspend` | MISSING | `user.suspend_emergency` (T4, high-risk, no-self) + service; SUPER_ADMIN only through the explicit SECURITY_AUTHORITY add-on |
| Owner / SUPER_ADMIN safety | Last access admin guard | PARTIAL | Last approval authority cannot be suspended; SUPER_ADMIN role defined without high-risk or security-review authority |
| Reactivation | Same endpoint as suspend | MISSING | Separate `user.reactivate`, different actor, reason, assignment-review acknowledgement; never restores sessions or closed roles |
| Security events | Derived from audit rows | MISSING | `security_events` (INFO/WARNING/HIGH/CRITICAL), separate from audit events |
| Notifications | none | MISSING | CRITICAL events create in-app `admin_notifications` (type SECURITY) for Owners and `security_event.review` holders |
| Authorization evidence for high-risk changes | tier >= 3 writes evidence | PARTIAL | Emergency suspend, reactivate, review, approve, publish all force evidence |
| Retention | none | MISSING | `retention_category` + `retain_until` on evidence, assignments, assignment events, role versions, audit, security events, suspensions; policy table with a 7-year floor; no purge job |
| Scope kinds | nine | OK | Unchanged; unit tests added for PROPERTY / VEHICLE / PROJECT / SELF |
| noSelf (SoD) | Used `relations: SELF_USER` (never triggered the evaluator) | BUG | Routes pass `subjectUserId`; evaluator denies SOD_SELF_ACTION |
| Session revocation | Epoch + session rows | OK | Used by suspension; reactivation does not undo it |
| Break-glass | audit row only | PARTIAL | Records a CRITICAL event + notifications; grants nothing; never edits roles |
| DB changes | -- | -- | Additive only (migration 081) |

## Deliverables
- Migration `081_security_reconciliation` (additive; the single trigger-disabled block renames codes in place).
- `server/lib/authz`: `permission-aliases`, `catalogue` (versioned roles), `risk`, `retention`, `security-events`, `emergency`, `assignment-workflow`, `errors`; evaluator + loader changes.
- Routes: `/access/users/:id/{suspend,emergency-suspend,reactivate}`, `/access/assignments/:id/{review,approve,reject,revoke,migrate}`, `/security/events*`.
- Seed is version-aware and idempotent.

## Seed / migration plan
- Test DB: migration 081 applied, seed re-run (adds OWNER v2, SECURITY_ADMIN v2, SECURITY_AUTHORITY v1, SUPER_ADMIN v1, policy v2).
- Persistent DBs: apply 081, run the seed. IDs and history are kept: permissions are renamed in place, role v1 rows are untouched, existing holders stay pinned to v1.
- Existing OWNER holders reach v2 only through the migrate workflow (review, Owner approval, 48 h). See limitations.

## Legacy -> canonical map
See `server/lib/authz/permission-aliases.mjs` (46 entries) and table `permission_code_aliases`.
