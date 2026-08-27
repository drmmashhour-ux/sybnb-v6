-- SR Ride vs Uber gap-closure, capsule 24 (P1 #6): scheduled rides.
-- Purely additive: one nullable timestamp column. No enum change needed -- RideStatus.DRAFT
-- already exists (defined since migration 001) but was never used for any ride row (confirmed:
-- zero DRAFT rows in production data, no code references RideRequest.status='DRAFT' anywhere);
-- this capsule reuses it as the dormant "scheduled, not yet dispatched" state rather than adding
-- a new enum value.

ALTER TABLE ride_requests ADD COLUMN scheduled_for timestamptz;
