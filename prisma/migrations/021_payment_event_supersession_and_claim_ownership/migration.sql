-- 021_payment_event_supersession_and_claim_ownership
-- Closes two real defects found by independent review of 778078f:
--
-- 1. Migration 020 rewrote the losing rows' provider_event_id (appending '#env_dedup_loser:<id>') to
-- resolve a duplicate-identity collision. That altered the most important provider-originated
-- identifier on those rows -- "recoverable by stripping a suffix" is a convention, not preservation
-- of the original evidence, and it broke direct reconciliation by the provider's real event id. This
-- migration UNDOES that rewrite (restores the true, original provider_event_id byte-for-byte on both
-- affected rows) and replaces the mechanism entirely with a canonical/superseded relationship: a
-- losing row keeps its real provider_event_id forever; a new superseded_by_event_id column (plus
-- superseded_at/superseded_reason) records which row is the canonical survivor and why. Uniqueness is
-- now enforced by a PARTIAL unique index scoped to canonical (non-superseded) rows only, so a
-- superseded historical duplicate can coexist with its survivor under the identical
-- (provider, provider_endpoint_key, provider_event_id) triple without violating anything, and both
-- remain independently queryable by their real, unaltered event id.
--
-- 2. applyPaymentEvent()'s CAS claim (added 778078f) had no ownership token: a crashed, killed, or
-- disconnected worker leaves a row at APPLYING forever (APPLYING is deliberately excluded from
-- CLAIMABLE_STATUSES, so nothing could ever reclaim it) -- a payment-loss condition, since the
-- provider may stop retrying once it received an HTTP 200 acknowledgement for the durable intake. This
-- migration adds claim_token (a random per-claim identity) and claim_expires_at (a bounded lease) so a
-- claim can safely expire and be reclaimed by a later delivery, and so a stale worker that wakes up
-- late can never overwrite a newer claimant's state (its write is bound to a token that is no longer
-- current, so it matches zero rows instead of corrupting anything).
--
-- Hand-written per this repo's established convention. Applied via `psql -f`, then `npx prisma generate`.

-- 1a. Drop the flat, full-table unique constraint migration 020 created -- it must go before the
-- restore below, since restoring the true (colliding) provider_event_id values would otherwise
-- violate it immediately.
ALTER TABLE payment_events DROP CONSTRAINT payment_events_identity_key;

-- 1b. Add the supersession columns. supersededByEventId is RESTRICT, not SET NULL/CASCADE like the
-- intent/booking relations -- unlike those (a business record that may legitimately be deleted while
-- its audit trail survives), a canonical PaymentEvent must never be deletable out from under
-- historical duplicates that still point to it as their resolution; nothing in this codebase deletes
-- PaymentEvent rows today, and this makes it structurally impossible to start doing so unsafely.
ALTER TABLE payment_events ADD COLUMN superseded_by_event_id uuid REFERENCES payment_events(id) ON DELETE RESTRICT;
ALTER TABLE payment_events ADD COLUMN superseded_at timestamptz;
ALTER TABLE payment_events ADD COLUMN superseded_reason text;

-- 1c. Restore the true provider_event_id on both rows migration 020 altered, and mark them superseded
-- (in the SAME statement, so there is never a moment where the true, colliding value exists on a row
-- that is not simultaneously excluded from the new partial unique index below). The survivor for each
-- pair is located by its own real provider_event_id, which migration 020 never touched.
UPDATE payment_events loser
SET
  provider_event_id = regexp_replace(loser.provider_event_id, '#env_dedup_loser:.*$', ''),
  superseded_by_event_id = survivor.id,
  superseded_at = now(),
  superseded_reason = 'environment_removed_from_identity (migration 020): this row and its survivor were the same real event, delivered and durably persisted as two independent rows before migration 020 removed the mutable environment label from canonical identity. Both rows are preserved with their true, original provider_event_id; this row is marked superseded rather than deleted or renamed.'
FROM payment_events survivor
WHERE loser.provider_event_id LIKE '%#env_dedup_loser:%'
  AND survivor.provider = loser.provider
  AND survivor.provider_endpoint_key = loser.provider_endpoint_key
  AND survivor.provider_event_id = regexp_replace(loser.provider_event_id, '#env_dedup_loser:.*$', '')
  AND survivor.id != loser.id;

-- 1d. Uniqueness is enforced only among CANONICAL (non-superseded) rows -- a historical superseded
-- duplicate keeps its real provider_event_id and may legitimately share it with its survivor. Same
-- name as before (payment_events_identity_key) -- isPaymentEventIdentityConflict()'s P2002 target
-- check in payment-event-pipeline.mjs needs no code change as a result. This is a raw partial index,
-- not representable as a Prisma @@unique -- schema.prisma documents this explicitly at the field.
CREATE UNIQUE INDEX payment_events_identity_key ON payment_events (provider, provider_endpoint_key, provider_event_id) WHERE superseded_by_event_id IS NULL;

-- 1e. provider_event_id is no longer covered by an implicit index from the (now partial) unique
-- constraint for a lookup that doesn't filter by superseded_by_event_id -- add a plain index so an
-- investigation/reconciliation lookup by the raw provider event id (across canonical AND superseded
-- rows) stays efficient.
CREATE INDEX payment_events_provider_event_id_idx ON payment_events (provider_event_id);
CREATE INDEX payment_events_superseded_by_event_id_idx ON payment_events (superseded_by_event_id);

-- 2. Claim ownership: a random per-claim token plus a bounded expiry. NULL claim_token means no
-- active claim. A claim is reclaimable once claim_expires_at is in the past, regardless of whether
-- the original worker ever comes back -- see applyPaymentEvent() in payment-event-pipeline.mjs.
ALTER TABLE payment_events ADD COLUMN claim_token text;
ALTER TABLE payment_events ADD COLUMN claim_expires_at timestamptz;
CREATE INDEX payment_events_claim_expires_at_idx ON payment_events (claim_expires_at) WHERE processing_status = 'APPLYING';
