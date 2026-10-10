-- Stripe-for-SR Option B (saved-card auto-charge), 2026-10-10. The rider saves one card once via a
-- Stripe Checkout session in setup mode; we keep their Stripe Customer id, the saved payment-method
-- id, and non-sensitive descriptors (brand + last4) to show "Visa ****4242". The card data itself
-- never touches our database -- it lives at Stripe, referenced by default_card_pm_id. All nullable:
-- a rider with no saved card simply has nulls and is charged via cash/wallet/Checkout as before.
ALTER TABLE "users"
  ADD COLUMN "stripe_customer_id" TEXT,
  ADD COLUMN "default_card_pm_id" TEXT,
  ADD COLUMN "default_card_brand" TEXT,
  ADD COLUMN "default_card_last4" TEXT;
