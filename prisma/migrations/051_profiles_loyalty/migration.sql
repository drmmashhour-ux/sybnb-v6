-- Profiles + loyalty (owner request 2026-10-09): a personal profile photo (avatar) for every
-- account, and a points-and-tiers loyalty program for guests and hosts. Points are earned when a
-- booking completes and can be redeemed for SYBNB wallet credit; tier is derived from lifetime
-- points and raises the earn multiplier. Country-neutral: earn rates / thresholds live in
-- server/lib/loyalty.mjs, not in the schema.

ALTER TABLE users ADD COLUMN avatar_ref text;
ALTER TABLE users ADD COLUMN avatar_mime_type text;

CREATE TYPE loyalty_tier AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');
CREATE TYPE loyalty_entry_type AS ENUM ('EARN', 'REDEEM', 'ADJUST');

CREATE TABLE loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  points_balance integer NOT NULL DEFAULT 0,
  lifetime_points integer NOT NULL DEFAULT 0,
  tier loyalty_tier NOT NULL DEFAULT 'BRONZE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_accounts_points_nonneg CHECK (points_balance >= 0),
  CONSTRAINT loyalty_accounts_lifetime_nonneg CHECK (lifetime_points >= 0)
);

-- Append-only ledger. EARN raises balance + lifetime; REDEEM lowers balance (points negative);
-- ADJUST is an admin correction. idempotency_key makes the completion-sweep award safe to re-run.
CREATE TABLE loyalty_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  type loyalty_entry_type NOT NULL,
  points integer NOT NULL,
  reason text,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loyalty_entries_account_created_idx ON loyalty_entries (account_id, created_at);
CREATE INDEX loyalty_entries_reference_idx ON loyalty_entries (reference_type, reference_id);
