-- SR Ride vs Uber gap-closure, capsule 30 (out-of-benchmark-list, previously assessed and now
-- being built for real): business/corporate accounts.
-- MVP scope: a company entity with a designated admin (an existing real user, no new auth role --
-- authorized purely by businessAccount.adminUserId === the caller, the same ownership-check
-- pattern already used everywhere else in this codebase), members who are existing riders, and a
-- ride attribution flag. Billing itself still goes through the existing manual-proof payment rail
-- per-ride -- this does NOT invent new money-movement/invoicing logic, only real usage attribution
-- and a real usage report. Purely additive.

CREATE TABLE business_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  billing_contact_email text NOT NULL,
  admin_user_id uuid NOT NULL REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_account_id, user_id)
);

CREATE INDEX business_account_members_user_id_idx ON business_account_members(user_id);

ALTER TABLE ride_requests ADD COLUMN business_account_id uuid REFERENCES business_accounts(id);
