-- 012_listing_availability
-- Schema-correction only: the Prisma model `ListingAvailability` (@@map "listing_availability")
-- existed in schema.prisma but no migration ever created its table, so a clean `migrate deploy`
-- (production, fresh envs) lacked it and `/api/listings/:id/availability` failed with P2021.
-- This creates ONLY the missing enum + table + indexes, matching the model exactly and following
-- the existing hand-written migration conventions (uuid ids, timestamptz, enum types used directly).
-- No changes to bookings, payments, auth, inventory, or any other table.

CREATE TYPE availability_status AS ENUM ('BLOCKED', 'AVAILABLE');

CREATE TABLE listing_availability (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id           uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  date                 date NOT NULL,
  status               availability_status NOT NULL DEFAULT 'BLOCKED',
  price_override_minor integer,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX listing_availability_listing_id_date_key ON listing_availability(listing_id, date);
CREATE INDEX listing_availability_listing_id_date_idx ON listing_availability(listing_id, date);
