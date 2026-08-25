-- 018_payment_event_canonical_identity
-- Closes two real defects found by independent review of 6b19120:
--
-- 1. providerEventId was globally @unique with no provider/account/environment scoping -- a
-- same-string event id from two different providers (or environments) would collide, letting a
-- second delivery resolve to an event durably owned by a completely different provider/account/
-- rail/subject/payload. Replaced with a composite identity: (provider, provider_account,
-- environment, provider_event_id).
--
-- 2. Neither webhook route stored the RAW, unvalidated local reference from the payload -- only a
-- validated live/permanent id, populated AFTER a successful local lookup. That meant an
-- authenticated event with an unresolvable reference (unknown, malformed, or pointing at an
-- already-deleted parent) had nothing durable to fall back to. provider_reference is that
-- always-populated, non-FK snapshot, written unconditionally at intake before any local
-- interpretation is attempted.
--
-- Also extends the processing-status enum with QUARANTINED (authenticated but locally
-- unresolvable, or a genuine identity conflict) and POLICY_DEFERRED (a real stored status for "the
-- webhook_apply policy denied this," replacing the prior behavior of silently leaving the row at
-- RECEIVED).
--
-- Hand-written per this repo's established convention. Applied via `psql -f`, then `npx prisma generate`.

-- 1. The raw, always-populated local-reference snapshot.
ALTER TABLE payment_events ADD COLUMN provider_reference text;

-- Backfill: payment_intent rows get their intent's own reference via a join. Where the intent no
-- longer exists (rows already orphaned by the prior round's own destructive-parent test), fall back
-- to the permanent original_intent_id snapshot -- the best available identifier, not a guess.
UPDATE payment_events pe SET provider_reference = pi.reference
FROM payment_intents pi
WHERE pe.rail = 'payment_intent' AND pe.intent_id = pi.id;

UPDATE payment_events SET provider_reference = original_intent_id::text
WHERE rail = 'payment_intent' AND provider_reference IS NULL;

-- stripe_checkout rows: original_booking_id is already the raw snapshot -- direct copy.
UPDATE payment_events SET provider_reference = original_booking_id::text
WHERE rail = 'stripe_checkout';

ALTER TABLE payment_events ALTER COLUMN provider_reference SET NOT NULL;

-- 2. provider_account is required going forward -- confirmed 100% populated already (527/527 rows).
ALTER TABLE payment_events ALTER COLUMN provider_account SET NOT NULL;

-- 3. Extend the processing-status enum. Must run as its own statement (not combined with anything
-- that uses the new value in the same transaction) -- this migration script never does that.
ALTER TYPE payment_event_processing_status ADD VALUE IF NOT EXISTS 'QUARANTINED';
ALTER TYPE payment_event_processing_status ADD VALUE IF NOT EXISTS 'POLICY_DEFERRED';

-- 4. Replace the provider-blind global unique constraint with the canonical composite identity.
-- Prisma's `@unique` on a single field generates a plain UNIQUE INDEX, not a table CONSTRAINT --
-- DROP INDEX is the correct verb here (an earlier attempt at DROP CONSTRAINT correctly failed with
-- "constraint does not exist", which is how this was caught).
DROP INDEX payment_events_provider_event_id_key;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_identity_key
  UNIQUE (provider, provider_account, environment, provider_event_id);

-- 5. Drop the migration-016 traceability CHECK. It required original_intent_id/original_booking_id
-- IS NOT NULL per rail -- which is now too strict: durable intake must succeed even when the local
-- reference is unresolvable (unknown, malformed, or the parent was deleted before first delivery),
-- meaning original_intent_id/original_booking_id may legitimately stay null forever for such a row.
-- Traceability is now guaranteed structurally instead, by provider_reference being NOT NULL (set
-- unconditionally at intake, even as an empty string for an event type this rail doesn't track) --
-- a plain column constraint already enforces this, so no separate CHECK is needed.
ALTER TABLE payment_events DROP CONSTRAINT payment_events_traceable_chk;
