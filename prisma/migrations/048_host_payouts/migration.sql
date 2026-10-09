-- Money-flow decision 2 (owner, 2026-10-08): host payout methods + withdrawal requests.
-- A host saves one payout method (type + per-type details, validated against the active country
-- profile) and requests withdrawals of released wallet earnings. Creating a request moves no money;
-- an admin pays outside the platform and marks it PAID (one DEBIT wallet entry, wallet_entry_id) or
-- REJECTED with a note.
CREATE TABLE host_payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE payout_request_status AS ENUM ('REQUESTED', 'PAID', 'REJECTED');

CREATE TABLE payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL,
  currency text NOT NULL,
  status payout_request_status NOT NULL DEFAULT 'REQUESTED',
  method jsonb NOT NULL DEFAULT '{}',
  reference text,
  note text,
  decided_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  wallet_entry_id uuid UNIQUE REFERENCES wallet_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_requests_amount_positive CHECK (amount_minor > 0),
  -- A PAID request always carries the admin's external payment reference.
  CONSTRAINT payout_requests_paid_has_reference CHECK (status <> 'PAID' OR reference IS NOT NULL)
);

CREATE INDEX payout_requests_host_id_status_idx ON payout_requests (host_id, status);
CREATE INDEX payout_requests_status_created_at_idx ON payout_requests (status, created_at);
