-- 016_payment_event_rail_generalization
-- Closes a real, structural gap found while preparing the payment-policy work for independent
-- review: payment_events.intent_id was NOT NULL, so this table could only ever hold events for the
-- payment_intent rail (server/routes/payment-intents.mjs). The older Stripe Checkout rail
-- (server/routes/payments.mjs) has never had any durable event inbox at all -- its webhook handler
-- relied solely on Stripe's own 5xx-triggered redelivery as "history", which is not durable
-- platform-side storage and is lost the moment Stripe gives up retrying.
--
-- This generalizes payment_events into a shared inbox for BOTH rails, so the same
-- receive -> verify -> durably persist/dedupe -> gate application -> apply-with-attempts/dead-letter
-- pipeline (and the existing admin replay endpoint) covers both, rather than duplicating that
-- machinery in a second table.
--
-- Hand-written per this repo's established convention (migrations here are not
-- `prisma migrate dev`-generated). Applied via `psql -f`, then `npx prisma generate`.

ALTER TABLE payment_events
  ADD COLUMN rail text NOT NULL DEFAULT 'payment_intent';

-- Every existing row genuinely is a payment_intent-rail event -- the DEFAULT above backfills them
-- correctly with no further UPDATE needed. Drop the default going forward so every new row must
-- state its rail explicitly (Prisma's generated client already always sets it).
ALTER TABLE payment_events
  ALTER COLUMN rail DROP DEFAULT;

-- intent_id can no longer be unconditionally required -- a stripe_checkout-rail event has no
-- payment_intents row to reference at all.
ALTER TABLE payment_events
  ALTER COLUMN intent_id DROP NOT NULL;

-- stripe_checkout-rail events are traced to a booking instead (via the Checkout Session's own
-- metadata.bookingId, the same field server/routes/payments.mjs's finalizeStripeSession already
-- uses to locate the booking -- not new client-supplied trust).
ALTER TABLE payment_events
  ADD COLUMN booking_id uuid NULL REFERENCES bookings(id);

-- SHA-256 of the raw, already-signature-verified webhook body -- lets an admin replay/reconciliation
-- view confirm which payload produced a stored event without persisting the raw payload itself (no
-- card data, no secrets, no PII beyond what amount_minor/currency/provider_object_id already store).
ALTER TABLE payment_events
  ADD COLUMN payload_digest text NULL;

-- Every row must be traceable to something real -- either a payment_intent row (existing rail) or a
-- booking row (Stripe Checkout rail). This is enforced by the schema itself, not just by convention
-- in application code.
ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_traceable_chk
  CHECK (
    (rail = 'payment_intent' AND intent_id IS NOT NULL) OR
    (rail = 'stripe_checkout' AND booking_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS payment_events_rail_idx ON payment_events (rail);
CREATE INDEX IF NOT EXISTS payment_events_booking_id_idx ON payment_events (booking_id);
