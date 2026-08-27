-- SR Ride vs Uber gap-closure, capsule 20 (P1 #9): ride cancellation-fee policy.
-- Purely additive: one nullable column on ride_requests, populated only when a rider
-- cancels after a driver has already committed (DRIVER_ASSIGNED / DRIVER_ARRIVING).
-- Existing rows are unaffected (NULL = no fee ever assessed).

ALTER TABLE ride_requests ADD COLUMN cancellation_fee_minor integer;
