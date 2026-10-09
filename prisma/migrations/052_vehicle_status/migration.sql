-- Vehicle verification (2026-10-09): a driver's self-declared vehicle must be reviewed before they
-- can carry a passenger, mirroring the ID-document review gate. New/changed profiles start
-- PENDING_REVIEW; an admin approves. No real drivers exist yet, so no grandfathering is needed.
DO $$ BEGIN
  CREATE TYPE vehicle_status AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_status vehicle_status NOT NULL DEFAULT 'PENDING_REVIEW';
