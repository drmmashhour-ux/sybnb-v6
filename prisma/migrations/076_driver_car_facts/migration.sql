-- 076 — Driver car facts (2026-10-19). Riders must know what a car can carry and how it is kept:
-- how many large bags (23 kg) and hand bags fit, seats, smoking policy and tyre type. Nullable so
-- existing drivers keep working; the rider app treats a missing capacity as "unknown" and only
-- filters on known values.
DO $$ BEGIN
  CREATE TYPE tyre_type AS ENUM ('WINTER', 'ALL_SEASON');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS large_bag_capacity INTEGER,
  ADD COLUMN IF NOT EXISTS hand_bag_capacity  INTEGER,
  ADD COLUMN IF NOT EXISTS seat_count         INTEGER,
  ADD COLUMN IF NOT EXISTS smoking_allowed    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tyre_type          tyre_type,
  ADD COLUMN IF NOT EXISTS tyres_fitted_on    DATE;
