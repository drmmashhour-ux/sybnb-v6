-- 022_payment_event_payment_status
-- Closes one real defect found by independent review of 24826e1:
--
-- Admin replay of a stripe_checkout-rail event had no durably-stored source of truth for the
-- original webhook's payment_status. round 6 deliberately did NOT extend "recover an event stuck at
-- APPLYING past its claim expiry" to admin replay for this rail, disclosing that its reconstruction
-- would otherwise have to assume 'paid' for a row that might have crashed before that was ever
-- established -- a real risk of confirming a booking that was never actually paid.
--
-- Fix: a new payment_status column, populated unconditionally at intake (before any claim/apply logic
-- ever runs) for the stripe_checkout rail from the raw, already-signature-verified event's own
-- data.object.payment_status string. This lets admin replay reconstruct the ORIGINAL session's real
-- paid-ness accurately regardless of when a crash happened, closing the disclosed gap.
--
-- Hand-written per this repo's established convention. Applied via `psql -f`, then `npx prisma generate`.

ALTER TABLE payment_events ADD COLUMN payment_status text;
