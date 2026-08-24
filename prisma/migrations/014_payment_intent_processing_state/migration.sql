-- 014_payment_intent_processing_state
-- Wires the electronic PaymentIntent/webhook system into the real booking/wallet flow
-- (server/routes/payment-intents.mjs). Two changes:
--
-- (1) payment_intents.booking_id becomes a real FK. It was previously an unvalidated,
-- client-supplied string with no DB-level integrity at all.
--
-- (2) payment_events gains durable attempt/dead-letter tracking, separate from
-- payment_intents.status (the business state the provider reports). Previously, a webhook
-- whose booking/wallet side effects failed rolled back the WHOLE transaction, including the
-- payment_events row itself -- a persistently-failing delivery left zero trace. These columns
-- let a delivery be durably "received" even when applying it later fails, and give a bounded
-- retry/dead-letter path instead of an invisible black hole.

-- (1) Real FK payment_intents.booking_id -> bookings.id.
-- Null out any orphaned values first -- the old unvalidated create path may have stored ids
-- that don't correspond to any real booking, and ADD CONSTRAINT would otherwise fail outright.
UPDATE payment_intents
SET booking_id = NULL
WHERE booking_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE bookings.id = payment_intents.booking_id);

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_booking_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);

CREATE INDEX IF NOT EXISTS payment_intents_booking_idx ON payment_intents (booking_id);

-- (2) Attempt/dead-letter tracking on payment_events.
DO $$ BEGIN
  CREATE TYPE "payment_event_processing_status" AS ENUM
    ('RECEIVED', 'APPLYING', 'APPLIED', 'IGNORED', 'FAILED', 'DEAD_LETTERED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE payment_events
  ADD COLUMN provider_object_id text,
  ADD COLUMN processing_status payment_event_processing_status NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN last_error text,
  ADD COLUMN applied_at timestamptz;

-- Backfill: every existing row was, by construction, successfully applied under the old code --
-- a payment_events row only ever got created inside the same transaction that updated
-- payment_intents.status, and that code never had any booking/wallet side effect that could fail.
-- Mark them APPLIED (not the new-row default RECEIVED) so they don't show up as stuck/unprocessed
-- in the new admin reconciliation view.
UPDATE payment_events SET processing_status = 'APPLIED', attempts = 1, applied_at = received_at;

CREATE INDEX IF NOT EXISTS payment_events_processing_status_idx ON payment_events (processing_status);
