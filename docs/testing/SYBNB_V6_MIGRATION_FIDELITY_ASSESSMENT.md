# SYBNB V6 — Migration Fidelity Assessment

**RESOLVED 2026-07-12.** `prisma/migrations/011_listing_availability/migration.sql` was added,
creating the previously-missing `listing_availability` table and `availability_status` enum.
Re-verified with the same method as below: a fresh disposable database
(`sybnb_v6_migration_check_2`), `prisma migrate deploy` (all 11 migrations applied with zero
errors), then diffed its table list against the development database. Every table `migrate
deploy` produces now matches every model in `prisma/schema.prisma` exactly — the 9 remaining
tables present only in the development database (`agreement_acceptances`, `ai_brain_signals`,
`booking_drafts`, `disputes`, `guest_id_verifications`, `host_profiles`, `listing_declarations`,
`room_types`, `verification_codes`) have no corresponding model in `schema.prisma` and are
confirmed dead/legacy tables from earlier prototype iterations, not a fidelity gap. `migrate
deploy` can now be used to bootstrap a fresh production/staging database. Disposable database
dropped after verification; development database untouched throughout.

---

Date: 2026-07-11. Written in response to an independent-review finding: the isolated test database
(`sybnb_v6_test`) is bootstrapped via `prisma db push`, not `prisma migrate deploy`, and no prior
document had actually proven *why*, or precisely *what* the difference is. This assessment does
that with a real, disposable experiment — not just the earlier `prisma migrate status` read against
the development database.

**This does not change the isolated test database's bootstrap strategy.** `db push` remains how
`sybnb_v6_test` is built (see `docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md`). This document only
answers the separate question: could `migrate deploy` do the same job, and if not, exactly how does
it differ?

## Method

1. Created a brand-new, disposable database (`sybnb_v6_migration_check_test` — deleted at the end
   of this assessment, never reused, never touched by anything else).
2. Enabled PostGIS on it (required by the schema regardless of bootstrap method).
3. Ran `prisma migrate deploy` against it — a genuinely blank target, not the development or the
   `sybnb_v6_test` database.
4. Compared its resulting table list and representative column types against `sybnb_v6_test`
   (already bootstrapped via `db push` from the same `prisma/schema.prisma`).
5. Dropped the disposable database. No production or development database was touched at any point.

## Inventory: current Prisma migrations

7 migration folders exist under `prisma/migrations/`:

```
001_platform_foundation
002_booking_metadata
003_reviews_messages_checkin
004_instant_book
005_listing_inquiries_and_seller_plan
006_listing_expiration
007_real_id_document_review
```

## Result: `prisma migrate deploy` against a blank database

**All 7 migrations applied successfully, with zero errors.** The migration chain is internally
consistent and can build a schema from nothing — this is a meaningfully different (and more
positive) finding than the earlier one recorded in `SYBNB_V6_TEST_DATABASE_SETUP.md`, which only
established that 6 of the 7 migrations were never *applied to the existing development database*
(because that database's schema predates/bypassed them, having been built by hand before the
migration files existed) — not that the migrations themselves are broken. Both facts are true
simultaneously and aren't in tension: the migrations work fine on a blank target; they just don't
match the development database's specific history.

## Schema comparison: `migrate deploy` vs. `db push`

| | `prisma migrate deploy` | `prisma db push` (current `sybnb_v6_test` bootstrap) |
|---|---|---|
| Application tables | 19 | 20 |
| `_prisma_migrations` tracking table | Present (expected — this is what enables `migrate status`/future incremental migrations) | Absent (expected — `db push` never uses migration tracking) |
| `listing_availability` table | **Missing entirely** | Present |
| `users.id` (and other `id` columns) physical type | Native `uuid` (matches the development database's actual physical type) | `text` (schema.prisma's `id String @id @default(uuid())` has no `@db.Uuid` annotation, so `db push` doesn't know to use the native type) |
| `ride_requests.pickup_geo` / `dropoff_geo` GiST spatial indexes | Present (`ride_requests_pickup_geo_gix`, `ride_requests_dropoff_geo_gix`) | **Absent** |

### What this means, concretely

- **`migrate deploy` is missing a whole table** (`listing_availability`) that exists in the current
  `prisma/schema.prisma` and therefore in every database bootstrapped from it. This confirms, with
  direct evidence (not just historical notes), that this table was added to the live schema without
  ever being captured as a migration file — the migration chain does not fully describe the current
  schema. **`migrate deploy` cannot currently reproduce the complete, current application schema.**
- **`migrate deploy` gets some physical details *more* correct than `db push`**: native `uuid`
  columns (matching the development database's real physical types — relevant to the `id::text`
  portability fix made in `server/routes/sr-rides.mjs` during test-database setup, which exists
  *because* `db push` produces `text` instead) and the spatial GiST indexes on the geometry columns
  (which `db push` does not create, since `schema.prisma`'s model-level `@@index` declarations don't
  currently express a GiST index type for these columns — a query-performance gap on the isolated
  test database specifically, not a correctness gap, since the geometry columns themselves are
  still queryable without the index, just without index-accelerated proximity queries).

## Conclusion

**Neither bootstrap method alone fully and correctly reproduces the current application schema.**
`db push` covers every table the application actually uses (matching `schema.prisma` table-for-
table) but with two known physical-fidelity gaps (`id` column type, missing GiST indexes).
`migrate deploy` gets those two things right but is missing an entire table.

**Classified: migration fidelity is a release blocker for ever using `migrate deploy` as the sole
schema-bootstrap method for a fresh (e.g. production or staging) database, until the missing
`listing_availability` migration is written.** This does not block continued use of the isolated
test database, since `db push` — while not migration-tracked — does correctly cover every table the
application uses.

## Recommendation (not implemented here — broad migration-history repair is explicitly out of scope
for this narrow assessment, per the instruction not to repair broad migration history in this PR)

1. Write a new migration folder (e.g. `008_listing_availability_and_uuid_fidelity`) that: creates
   `listing_availability` if a fresh database doesn't have it (idempotent `CREATE TABLE IF NOT
   EXISTS`, matching this project's established pattern of hand-written, idempotent-where-possible
   migration SQL — see the existing 001-007 files for the convention), and adds the GiST indexes on
   `ride_requests`'s geometry columns.
2. Separately (a real, non-trivial decision, not bundled into the above): decide whether to
   annotate `id String @id @default(uuid())` fields with `@db.Uuid` in `schema.prisma` to make
   `db push` produce native `uuid` columns going forward, matching the development database's
   existing physical type. This is a schema-definition change with real migration implications for
   any database that already has `text`-typed id columns (would need its own migration to convert
   column types) — **owner decision required**, not something to change unilaterally.
3. Once (1) is done, re-run this exact assessment (create a fresh disposable database, run
   `migrate deploy`, diff against `db push`) to confirm the gap is closed before ever relying on
   `migrate deploy` for a production/staging database.
