-- Ride dispute workflow (2026-10-09): a first-class DISPUTED ride state so a contested completed
-- ride has a structured hold/resolve path instead of ad-hoc handling. Postgres allows adding an
-- enum value inside the migration transaction as long as it is not used in the same transaction
-- (it isn't here).
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'DISPUTED';
