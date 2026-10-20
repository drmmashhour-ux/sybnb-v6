# Prisma schema drift inventory (Step 5C)

Method: `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` against the TEST database only (no shadow database, nothing applied). **The generated SQL must not be applied**: it would convert uuid/timestamptz columns to text/timestamp(3) and drop/re-create foreign keys. Every item is a difference in how the Prisma schema *describes* the database, except the single category-E item.

Step 5B state: 64 tables with native-type drift. Step 5C state: the identity/auth tables are fixed (below); **55 legacy product tables remain**, 1,211 lines of diff (was 1,346).

## Fixed now (touch authentication / users / sessions / roles)
`users`, `user_sessions`, `user_roles`, `verification_codes`, `otp_attempt_locks`, `rate_limit_buckets`, `suppressed_emails`, `legal_consents`, `host_activation_codes`: `@db.Uuid`, `@db.Timestamptz(6)`, `@default(dbgenerated("gen_random_uuid()"))` where the database has that default, `@default(now())` on `@updatedAt` columns where the database has it, `onUpdate: NoAction` on their foreign keys (the database has no ON UPDATE action), `map:` on 4 index names. Re-diff: zero lines for these tables. Representation only; no database change. Admin foundation tables (roles, role versions, assignments, scopes, permissions, evidence, security events, suspensions, retention, bootstrap, audit, parties, documents, platform registry, work, approvals, support, config): zero drift.

## Remaining (deferred), by category
| Cat | Meaning | Count | Tables / items |
|---|---|---|---|
| A | harmless representation | 7 | DB-only indexes Prisma cannot express or does not declare: `listings_division_status_approved_at_idx`, `driver_profiles_location_gix`, `locations_geo_gix`, `ride_requests_pickup_geo_gix`, `ride_requests_dropoff_geo_gix` (GiST), `listings_metadata_gin_idx` (GIN), `business_account_members_user_id_idx` (redundant) |
| B | missing native type annotation (`uuid`→TEXT, `timestamptz`→timestamp(3), `updated_at` default) | 55 tables | agent_reviews auctions bids bookings business_account_members business_accounts driver_car_care driver_documents driver_profiles favourites food_order_items food_order_messages food_orders host_payout_methods host_profiles incidents listing_ai_reviews listing_availability listing_media listing_reports listing_reviews listings locations loyalty_accounts loyalty_entries menu_items merchants message_threads messages open_houses payment_event_conflicts payment_events payment_intents payment_proofs payout_requests promo_codes promo_redemptions push_subscriptions refund_attempts refund_observation_consumptions refund_provider_observations refunds ride_events ride_recordings ride_requests ride_reviews ride_stops sanctions_screening_results saved_places saved_searches seller_profiles visit_requests wallet_entries wallet_gifts wallets |
| C | index name differences | 16 renames | bookings(2), driver_car_care, loyalty_entries(2), payment_events, payment_intents(2), payment_proofs, ride_requests(2), sanctions_screening_results, wallet_entries(2), wallet_gifts(2) |
| D | foreign-key action (DB has ON UPDATE NO ACTION; schema default is CASCADE) | 94 FKs re-created in the diff (188 statements) | same legacy tables |
| E | actual database/schema mismatch | 1 | `promo_redemptions`: schema declares `ride_id` unique, the database has no unique index (current data has 0 duplicates). Decide: add the unique index by a reviewed migration, or drop `@unique` from the schema |
| F | needs investigation | 4 | `listings_division_status_created_at_id_idx`, `listings_division_status_price_minor_id_idx`, `message_threads_guest_id_updated_at_idx` (same name, the database has `DESC` ordering the schema omits: probably intended, needs a schema-side declaration) and the `payment_events` provider/endpoint/event index (name looks truncated by the 63-character limit, to be confirmed) |

Touches: authentication/users/roles — fixed; parties, documents, audit, platform registry, tax foundations — none; financial: only legacy payment/refund/wallet/payout tables (type, FK-action, index-name items only, plus the E item on promo redemptions). None of these is read or written by the admin/security foundation.

## Remediation plan (not done now)
1. Run the same helper (annotate `@db.Uuid` / `@db.Timestamptz(6)` from `information_schema`) per domain in small PRs, re-diffing after each; verify with the domain's e2e suite.
2. Add `onUpdate: NoAction` and `map:` index names in the same PRs.
3. Resolve E and F by reading the owning migration; any DDL goes through a reviewed numbered migration, never through the diff output.
4. Goal: `migrate diff` empty. Order: marketplace/listings, food, rides, payments/refunds/wallet (last, financially sensitive, needs sign-off).
