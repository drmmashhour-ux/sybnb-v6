# STEP 5I -- multi-organization boundary for the rest of admin2 (P2)

Follows STEP 5H (P1: security / audit / evidence). Nothing here is deployed; migration 083 is **not applied to production**; Owner bootstrap is **not run**.

## A. "Oldest organization" occurrences removed

| Where | What it did |
|---|---|
| `scope.mjs` `registryContext().org` + 15 s cache, `auditOrganizationId()`, `recordFacts()` | every record decision and every audit row used the oldest organization |
| `access.mjs` `theOrg()` / `orgResource()` (~35 call sites), `authorizeScopes` fallback, suspend / reactivate / service-account `organizationId` | every Users & Access decision, audit row and new service account used it |
| `work.mjs` (5 audit sites), `records.mjs` (10), `config.mjs` (3 + org-level `requireRecord(..., null, ...)`) | audit rows + org-level record checks |
| `config.mjs` global search `users` section | listed all staff users |
| `notifications.mjs` | an unattributed CRITICAL event used a global recipient list |

`security.mjs` / `core.mjs` were already fixed in 5H. `grep` for `organization.findFirst`, `theOrg`, `registryContext().org` in `server/routes/admin2` and `server/lib/authz` now finds nothing, and a static test keeps it that way.

## B/C. The model: every decision is made at a *place*

A **place** is the most specific point of the organization tree: organization / legal entity / business unit / platform (`org-boundary.mjs`: `placeOfScopeRow`, `placesOfScopeRows`, `factsOfPlace`). One central derivation:

* a **scope row** -> its place through the tree (LEGAL_ENTITY, BUSINESS_UNIT, PLATFORM reach their parent organization; DEPARTMENT / PROPERTY / VEHICLE / PROJECT / SELF cannot be placed);
* a **record** -> its platform's organization; a record with no platform and no organization column belongs to the registry's **sole** organization when there is exactly one, otherwise to nobody (unattributed -> denied). Never "the oldest";
* a **user / assignment / session** -> the places of the user's assignment scopes; every one of them must authorize a change;
* a **service account** -> its own `organization_id`;
* a **global catalogue** (roles, permissions, settings, feature flags: no organization column) -> *view*: the evaluator must allow it at some place the caller sits at; *change*: allowed at **every** organization of the registry, and audited in every organization. (One organization's administrator cannot change what all share.)

The caller's candidate places come from their **own** assignments (all four placeable scope kinds), then the **normal central evaluator** decides at each place (`authorizedPlaces`). A candidate grants nothing: a child scope never matches organization-level facts, so a legal-entity or platform administrator gets no organization-wide permission, no sibling legal entity, no sibling platform, no other organization. They keep access at their own place (lists are filtered with `scopesWithinPlaces`, descendants included, parents excluded). Organization-level resources (security events, audit rows, evidence, service accounts) are visible only through organization-level grants.

The organization is never read from the request (query, body, header, route parameter). The one body field that names an organization (`POST /access/service-accounts`) must be among the organizations the central evaluator already authorized for the caller.

## D. CRITICAL notification recipients

* Event with `organization_id`: recipients are active holders of an Owner role or `security_event.review` whose assignment is **ORGANIZATION-scoped to that organization**. Legal-entity / platform holders are not organization security recipients.
* `organization_id IS NULL`: **no recipients, no transport call, no global fallback.** The event is persisted and `delivery._notification = { state: 'UNATTRIBUTED', action: 'MANUAL_OPERATOR_REVIEW' }`; `notifiedCount = 0`; the retry worker never re-sends it. Nothing about it is shown through any organization-scoped route.
* Operator channel (outside tenant / admin2 scope, nothing sends it automatically): the API logs one identifier-only line (`[security] CRITICAL event <id> (<type>) has no organization: manual operator review required`), and the platform operator finds them with `SELECT id, event_type, created_at FROM security_events WHERE severity='CRITICAL' AND organization_id IS NULL AND status='OPEN';`. No summary or detail is logged.

## E. Legacy rows
No backfill. `organization_id IS NULL` = unattributed = invisible to organization-scoped admins. `authorization_evidence` legacy rows are never modified: the table is append-only and hash-chained, so attributing them would rewrite history; they stay unattributed (operators can still verify the whole chain). See **F**.

## F. Attribution script (prepared, NOT run)
`scripts/admin-attribute-legacy-records.mjs` + `docs/admin/STEP5I_LEGACY_ATTRIBUTION_RUNBOOK.md`: dry run by default; prints counts; needs an explicit `--organization-id`, `--apply`, `--confirm-single-organization-history=<same id>` and `--proof-ref`; refuses when more than one organization exists unless a reviewer-signed override is given; audit + security rows only, never evidence; writes a JSON report with row ids and counts; idempotent.

## G. Migration gate
Wording is derived from `GATED_MIGRATIONS` (`reviewedChainLabel()` -> `078-083`); the example is `APPROVED_MIGRATIONS=083_security_record_organization_boundary`. Tests: 082 does not approve 083; 083 approves the reviewed chain only; a future 084 not in `GATED_MIGRATIONS` still blocks the deploy.

## Known limits (honest list)
1. Role catalogue, settings and feature flags are global: change needs permission at every organization. Per-organization catalogues are a later design.
2. Approval requests for `role_assignment` subjects carry no platform, so in a registry with several organizations they are unattributed and cannot be created / decided until an organization is recorded on the request (single-organization deployments are unaffected).
3. In a registry with several organizations, org-level party records, org-level work items and users without any placeable assignment belong to nobody and are not visible / editable. Legacy `ADMIN` / `SUPPORT` accounts without assignments are listed only in a single-organization registry.
4. DEPARTMENT / PROPERTY / VEHICLE / PROJECT scopes cannot be placed on their own: a department belongs to its organization; the others are refused as grant targets when several organizations exist.
5. A user whose assignments span several organizations is visible to each organization (only the part inside the caller's places is shown) and needs authorization at every one of their places to suspend.
6. Legacy audit writers outside admin2 / authz still write unattributed rows (unchanged from 5H).

## Tests
Unit `tests/unit/org-boundary-places.test.mjs` (19; evaluator, places, legal-entity / platform / organization admins, cross-org both ways, notifications, attribution script, static guards) and the updated 5H / gate tests. DB e2e `tests/e2e/admin2-org-boundary-p2.e2e.mjs` (12: Work Queue, records, users & access, assignments, scopes, sessions, MFA, suspend, role catalogue, service accounts, config / platform registry, search, CRITICAL isolation, anonymous), `tests/e2e/admin2-org-boundary.e2e.mjs` (9), `tests/e2e/migration-083-guards.e2e.mjs` (4). Run the e2e only against a throwaway database migrated through 083 (they create organizations that cannot be deleted).
