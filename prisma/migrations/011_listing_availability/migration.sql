-- Captures listing_availability as a real migration: this table (host per-date calendar
-- overrides — BLOCKED/AVAILABLE status, optional price override) was added to the live schema
-- via `prisma db push` and never previously recorded as a migration file, so `prisma migrate
-- deploy` could not build it on a fresh database. See
-- docs/testing/SYBNB_V6_MIGRATION_FIDELITY_ASSESSMENT.md for the full gap analysis.
CREATE TYPE availability_status AS ENUM ('BLOCKED', 'AVAILABLE');

CREATE TABLE listing_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  date date NOT NULL,
  status availability_status NOT NULL DEFAULT 'BLOCKED',
  price_override_minor integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX listing_availability_listing_id_date_key ON listing_availability (listing_id, date);
CREATE INDEX listing_availability_listing_id_date_idx ON listing_availability (listing_id, date);
