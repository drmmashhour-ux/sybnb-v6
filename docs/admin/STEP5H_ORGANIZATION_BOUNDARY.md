# STEP 5H -- organization boundary for security / audit / evidence records

Fixes the P1 review finding on PR #7: `orgResource()` in `server/routes/admin2/security.mjs` cached the **oldest**
organization for every authorization decision while the security-event, audit and evidence endpoints queried their tables
**globally**, so an admin authorized for organization A could list, read, review, export and verify organization B's records.

## What changed

| Area | Change |
|---|---|
| Schema (`prisma/migrations/083_security_record_organization_boundary`, **prepared, not applied**) | nullable `organization_id` (FK to `organizations`, `ON DELETE RESTRICT`) + index on `admin_audit_logs`, `security_events`, `authorization_evidence`. The audit / security guards make it **write-once** (set while NULL, never changed). Evidence stays fully append-only. |
| Migration gate | `083_...` is registered in `GATED_MIGRATIONS`; a deploy cannot apply it without `APPROVED_MIGRATIONS` naming it. |
| Writers | `writeAdminAudit`, `recordSecurityEvent` take `organizationId` (trusted server state only). Evidence is attributed centrally in `authorize()` from the resource facts; the organization is part of the evidence hash when present (historical hashes are unchanged). Every writer in `server/routes/admin2` and `server/lib/authz` passes it (a unit test enforces this). |
| Routes (`security.mjs`) | Every endpoint asks the **central evaluator** at which organizations the caller holds the permission (`org-boundary.mjs`: the caller's own ORGANIZATION-scoped assignments, each re-decided by `decide()`), then restricts the query to `organizationId IN (...)`. Single records are looked up only inside those organizations (anything else: plain 404) and re-authorized at the record's own organization. The organization is never read from the request. |
| Evidence verify | `verifyEvidenceChainForOrganization`: recomputes only the caller's rows and checks linkage by hash/sequence without reading other rows' content. `verifyEvidenceChain` (global) is unchanged for operators/tests. |
| Overview / privileged users | Counts and lists are restricted to staff whose assignments sit inside the caller's organizations. |
| Notifications | A CRITICAL event of an organization alerts only holders ORGANIZATION-scoped to it. An unattributed one alerts nobody (STEP 5I). |

## Fail-closed rules

* A row with `organization_id IS NULL` is **unattributed** and visible to nobody through these routes.
* No backfill is done: an actor or subject user may hold scopes in several organizations, so nothing can be proved for
  existing rows. After deploying 083 all historical audit / security / evidence rows are invisible to organization-scoped admins.
* Single-organization deployments may attribute legacy **audit and security** rows after review (see the comment in the migration).
  Legacy **evidence** cannot be attributed (the table is fully append-only) and cannot be verified through the route; use the
  global verifier from a script.
* Break-glass requests and other actions whose organization is ambiguous (several candidate organizations) are refused (409) or left unattributed.

## Round 2 (independent re-review)

* `GET /access/users/:id`: the recent-audit list is restricted to organizations where the caller holds `user.view` (centrally decided); no such organization means an empty list.
* Command Center `securityEvents7d` tile: counted audit rows globally; now organization-bound like `/security/overview`, and omitted when the caller has no organization-level grant.
* `verifyEvidenceChainForOrganization`: a chain longer than the limit returns `ok:false, truncated:true, reason:VERIFICATION_LIMIT_REACHED` instead of a false "verified".
* New static guard: every read of the three tables in `server/routes/admin2` must be organization-restricted.
* Deploy ordering: both deploy paths (`start:render`, Render `preDeployCommand`) run `migration-gate.mjs` and `prisma migrate deploy` before the server starts, so 083 is applied (once approved) before code that writes `organization_id` runs. Any other host that starts the server without that step must apply 083 first.
* Not changed: the legacy `server/routes/admin.mjs` audit reads (global ADMIN console), outside the admin2 organization model.

## Known limits / follow-ups (status after STEP 5I)

* ~60 audit writers outside `admin2`/`authz` (legacy `server/routes/admin.mjs`, host, bookings, SR rides, ...) still write
  unattributed rows, so those rows are not shown in the organization-scoped Audit Center until a decision is made which
  organization they belong to. **Still open.**
* ~~`access.mjs`, `scope.mjs` (`recordFacts`) and the records/work/config modules still authorize against the oldest organization.~~
  **Fixed in STEP 5I** -- see `docs/admin/STEP5I_MULTI_ORG_BOUNDARY.md`.
* ~~An unattributed CRITICAL event still notifies the previous (unscoped) recipient list.~~ **Fixed in STEP 5I**: no organization, no recipients; the event is kept and flagged `UNATTRIBUTED / MANUAL_OPERATOR_REVIEW`.
* Tests: `tests/unit/security-org-boundary.test.mjs` runs the real route handlers and the real evaluator against an in-memory
  Prisma fake. The DB-backed two-organization suite `tests/e2e/admin2-org-boundary.e2e.mjs` **was run against a throwaway database
  migrated through 083 and passes 9/9** (re-run in STEP 5I: 9/9). STEP 5I adds `tests/e2e/admin2-org-boundary-p2.e2e.mjs` (12/12) and
  `tests/e2e/migration-083-guards.e2e.mjs` (4/4).

## STEP 5K — grant escalation, last access administrator, Command Center (follow-up to review of cb05a4f)

- **Anti-escalation is evaluated at the destination place.** Granting a role requires the caller to hold every permission of that role at each scope being granted (central evaluator, `callerHoldsPermissionAt`); holding it in another organization no longer counts.
- **Last access administrator is per organization.** Revoking an `access.assign` assignment is refused if any organization it sits in would be left without another active holder inside that organization.
- **Command Center** tile `pendingAccessApprovals`, and the roles shown in the users list, are restricted to the caller's authorized places.
- **Sole-organization precondition.** Legacy accounts and records that carry no platform/organization attribution are only authorizable while the registry has exactly ONE organization. Creating a second organization makes them unattributed (invisible, fail closed) until `scripts/admin-attribute-legacy-records.mjs` has attributed them. Do not create a second organization in production before that has been reviewed.
- Tests: `tests/unit/org-boundary-grants.test.mjs`, `tests/e2e/admin2-org-boundary-p3.e2e.mjs` (throwaway database only; creates an organization that cannot be deleted).
