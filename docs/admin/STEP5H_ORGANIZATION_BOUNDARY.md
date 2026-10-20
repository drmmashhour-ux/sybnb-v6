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
| Notifications | A CRITICAL event of an organization alerts only holders ORGANIZATION-scoped to it. |

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

## Known limits / follow-ups (not part of this fix)

* ~60 audit writers outside `admin2`/`authz` (legacy `server/routes/admin.mjs`, host, bookings, SR rides, ...) still write
  unattributed rows, so those rows are not shown in the organization-scoped Audit Center until a decision is made which
  organization they belong to.
* `access.mjs`, `scope.mjs` (`recordFacts`) and the records/work/config modules still authorize against the oldest organization.
  Their audit rows are attributed to that same organization, so attribution and authorization agree, but they are not yet multi-organization.
* An unattributed CRITICAL event still notifies the previous (unscoped) recipient list.
* Tests: `tests/unit/security-org-boundary.test.mjs` runs the real route handlers and the real evaluator against an in-memory
  Prisma fake. The DB-backed e2e suites (`tests/e2e/admin2-*.e2e.mjs`) need migration 083 on a TEST database and were not run.
