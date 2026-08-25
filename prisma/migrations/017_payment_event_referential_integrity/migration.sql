-- 017_payment_event_referential_integrity
-- Closes a real durability defect found by independent review of migration 016: payment_events.
-- intent_id carried ON DELETE CASCADE (inherited unchanged from before that migration -- confirmed
-- live in the DB, not merely declared), and the Prisma schema declared the SAME (wrong) Cascade
-- behavior for the new booking_id relation, even though the actual booking_id FK as written in 016
-- had no explicit ON DELETE clause (defaulting to NO ACTION) -- a real drift between the schema
-- declaration and the live constraint. Both are wrong for a table whose entire purpose is to be a
-- durable, append-only financial event inbox: deleting a PaymentIntent or Booking must never delete
-- the webhook history, attempts, or dead-letter status that reference it.
--
-- Fix: both relations become ON DELETE SET NULL (the reviewer's own recommended model for "the
-- application must preserve events even when the associated object no longer exists" -- exactly this
-- table's purpose). RESTRICT was considered and rejected: this codebase has no current hard-delete
-- path for bookings/payment_intents, but SET NULL is strictly safer going forward (it can never block
-- an unrelated, legitimate deletion elsewhere) while still preserving 100% of the event's own data.
--
-- Because the live FK becomes nullable-on-delete, this migration ALSO adds permanent, non-FK
-- "snapshot" columns (provider, provider_account, environment, subject_type, original_intent_id,
-- original_booking_id) that are populated once at receipt time and never cleared by any deletion --
-- so an orphaned event (its live intent_id/booking_id now NULL) remains fully self-describing and
-- reconcilable on its own, without depending on the parent record still existing.
--
-- Hand-written per this repo's established convention. Applied via `psql -f`, then `npx prisma generate`.

-- 1. New permanent, non-FK identity columns.
ALTER TABLE payment_events ADD COLUMN provider text;
ALTER TABLE payment_events ADD COLUMN provider_account text;
ALTER TABLE payment_events ADD COLUMN environment text;
ALTER TABLE payment_events ADD COLUMN subject_type text;
ALTER TABLE payment_events ADD COLUMN original_intent_id uuid;
ALTER TABLE payment_events ADD COLUMN original_booking_id uuid;

-- 2. Backfill every existing row. All 452 payment_intent-rail rows use the sandbox provider
-- (the only provider this rail has ever used); all 6 stripe_checkout-rail rows use stripe.
-- 'unknown' for environment is an honest gap, not a guess: this column did not exist before this
-- migration, so no historical row's receipt-time environment was ever recorded -- 'unknown' says
-- exactly that, rather than fabricating a plausible-looking value.
UPDATE payment_events SET
  provider = 'sandbox',
  provider_account = 'sandbox-test-account',
  environment = 'unknown',
  subject_type = 'PAYMENT_INTENT',
  original_intent_id = intent_id
WHERE rail = 'payment_intent';

-- payment_intent-rail rows can also snapshot the booking they were ultimately for, where the
-- linked intent has one -- strengthens the audit trail (join once, at migration time, while the
-- relation still exists for every current row).
UPDATE payment_events pe SET original_booking_id = pi.booking_id
FROM payment_intents pi
WHERE pe.rail = 'payment_intent' AND pe.intent_id = pi.id AND pi.booking_id IS NOT NULL;

UPDATE payment_events SET
  provider = 'stripe',
  provider_account = 'stripe-checkout',
  environment = 'unknown',
  subject_type = 'BOOKING',
  original_booking_id = booking_id
WHERE rail = 'stripe_checkout';

-- 3. Every row must now have its identity snapshot populated -- enforced going forward.
ALTER TABLE payment_events ALTER COLUMN provider SET NOT NULL;
ALTER TABLE payment_events ALTER COLUMN environment SET NOT NULL;
ALTER TABLE payment_events ALTER COLUMN subject_type SET NOT NULL;

-- 4. Fix the referential action on both relations: SET NULL, not CASCADE, and not silently
-- undeclared (the prior booking_id FK had no explicit ON DELETE at all).
ALTER TABLE payment_events DROP CONSTRAINT payment_events_intent_fkey;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_intent_fkey
  FOREIGN KEY (intent_id) REFERENCES payment_intents(id) ON DELETE SET NULL;

ALTER TABLE payment_events DROP CONSTRAINT payment_events_booking_id_fkey;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

-- 5. The traceability CHECK from migration 016 referenced the LIVE (now nullable-on-delete)
-- intent_id/booking_id columns -- under ON DELETE SET NULL, deleting a parent would try to null the
-- live FK and immediately violate this CHECK, which would abort the parent's DELETE entirely
-- (verified empirically: it does, in a rolled-back transaction, before this fix). That defeats the
-- whole point of SET NULL. Traceability must be checked against the PERMANENT snapshot columns
-- instead, which are populated once at receipt and never cleared by any deletion.
ALTER TABLE payment_events DROP CONSTRAINT payment_events_traceable_chk;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_traceable_chk
  CHECK (
    (rail = 'payment_intent' AND original_intent_id IS NOT NULL) OR
    (rail = 'stripe_checkout' AND original_booking_id IS NOT NULL)
  );
