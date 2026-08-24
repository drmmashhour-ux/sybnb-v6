-- 015_payment_intent_one_active_per_booking
-- Closes a real, verified race left open by the payment-intents review: two concurrent
-- POST /api/payments/intents calls for the same booking could both pass the app-level "no active
-- intent" pre-check and both create a REQUIRES_PAYMENT payment_intents row, since that
-- check-then-create was not backed by any DB constraint (unlike payment_proofs' own
-- (provider, provider_ref) unique index). If both sibling intents later had their success webhook
-- processed with sufficient concurrency, both could pass applyPaymentIntentSuccess's own unguarded
-- booking-status check and both apply -- producing genuinely duplicated wallet HOLD/admin-share
-- CREDIT entries for one booking.
--
-- A partial unique index makes it impossible for two intents to be simultaneously "active" for the
-- same booking at all -- closing the root cause rather than patching the downstream symptom, and
-- without touching approvePaymentProof (server/lib/finance-ledger.mjs), which is shared by every
-- payment rail (Stripe, local wallet, seller plan, PaymentIntent) and too risky to modify here.
--
-- Not expressible in prisma/schema.prisma -- Prisma's schema DSL has no partial/filtered unique
-- index syntax. DB-only, applied via this hand-written migration per this repo's established
-- convention (migrations here are hand-written, not `prisma migrate dev`-generated).

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_per_booking
  ON payment_intents (booking_id)
  WHERE booking_id IS NOT NULL AND status IN ('REQUIRES_PAYMENT', 'PROCESSING');
