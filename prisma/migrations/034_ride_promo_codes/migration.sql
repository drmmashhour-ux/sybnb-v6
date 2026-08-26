-- SR Ride vs Uber gap-closure, capsule 28 (P2 #12): promo codes.
-- Owner-approved scope (2026-08-26, via AskUserQuestion): "Simple % or flat-off, admin-created" --
-- admins create codes in the admin panel; each code redeems once per rider; no referral system,
-- no auto-generated codes. Purely additive.

CREATE TYPE promo_discount_type AS ENUM ('PERCENT', 'FLAT');

CREATE TABLE promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  discount_type promo_discount_type NOT NULL,
  discount_value integer NOT NULL,
  max_discount_minor integer,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_admin_id uuid REFERENCES users(id)
);

-- Applied once, at ride-creation time, directly against the ride's own locked fareMinor -- the
-- same "never a client-supplied amount, always server-derived from a real locked figure" discipline
-- every other money-adjacent field in this codebase already follows.
ALTER TABLE ride_requests ADD COLUMN promo_code_id uuid REFERENCES promo_codes(id);
ALTER TABLE ride_requests ADD COLUMN discount_minor integer;

-- The unique constraint IS the single-redemption-per-rider enforcement -- a second concurrent
-- redemption attempt fails atomically at the database level, not via a read-then-write race.
CREATE TABLE promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  discount_applied_minor integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, user_id)
);
