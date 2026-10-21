# STEP 5I -- legacy row attribution runbook (PREPARED -- NOT RUN, NOT APPROVED)

**Do not run this against production without a signed-off change ticket.** Nothing in STEP 5I runs it. Migration 083 is not applied to production either.

## Policy

* Migration 083 does **no backfill**. Every `admin_audit_logs`, `security_events` and `authorization_evidence` row that exists when 083 is applied keeps `organization_id IS NULL`.
* `organization_id IS NULL` means **unattributed**, and an unattributed row is **invisible to every organization-scoped admin** (Security Center, Audit Center, evidence list/verify, user-detail audit history). It is not "global" and not "everyone's".
* Why nothing can be proved from the data: an actor or subject user may hold scopes in several organizations, a legacy writer recorded no organization, and "the oldest organization" is a guess, not evidence.

## What may be attributed, and what may not

| Table | May be attributed? | Why |
|---|---|---|
| `admin_audit_logs` | yes, by this runbook, **only** if exactly one organization existed for the whole historical period | write-once guard allows NULL -> value once |
| `security_events` | yes, same condition | same guard |
| `authorization_evidence` | **never** | the table is fully append-only and hash-chained; `UPDATE` is refused by trigger, and rewriting history would break the chain's integrity guarantee. Its legacy rows stay unattributed forever. They remain verifiable by the operator-only global verifier (`verifyEvidenceChain`), which is not exposed through any organization-scoped route. |

## Proof required BEFORE running (all of it, attached to the change ticket)

1. `SELECT count(*) FROM organizations;` is **1** today.
2. Evidence that no other organization has ever existed in this database for the period covered by the legacy rows: earliest `organizations.created_at` is **before** the oldest row of `admin_audit_logs` / `security_events` (`SELECT min(created_at) ...`), and no organization was ever deleted (organizations cannot be deleted while audit rows reference them; confirm from backups / the migration history that none was created and removed).
3. A named reviewer signs the ticket. Without proof the correct outcome is to leave the rows unattributed.
4. A database recovery point exists.

## Procedure

```
# 1. dry run (default): prints counts, writes legacy-attribution-report-<timestamp>.json, changes nothing
DATABASE_URL=... node scripts/admin-attribute-legacy-records.mjs --organization-id=<the one organization id>

# 2. apply (all three flags required)
DATABASE_URL=... node scripts/admin-attribute-legacy-records.mjs --organization-id=<id> --apply \
    --confirm-single-organization-history=<same id> --proof-ref=<ticket>
```

* The script refuses (exit 2) when more than one organization exists, unless a reviewer signs `--allow-multiple-organizations-reviewed=<reviewer>` **and** the proof shows the rows really belong to that one organization.
* It only updates rows `WHERE organization_id IS NULL`, in batches, audit + security tables only, never `authorization_evidence` (an `evidence` selector is refused). It is idempotent: a second run attributes 0 rows. The report lists the table counts before/after and the affected row ids (capped at 200,000 per table, `truncated` is set beyond that). Attach the report to the ticket.
* Rollback: none by design (the column is write-once). That is why the proof comes first.
