-- SR Ride vs Uber gap-closure, capsule 25 (P2 #16): accessibility ride options.
-- Purely additive. Deliberately two REAL columns, not a decorative entry in the existing
-- srRideFeatures multi-select (which is explicitly documented elsewhere as recorded-but-never-
-- matched -- fine for a soft preference like A/C, wrong for an actual accessibility need, where
-- promising a matched vehicle without enforcing it would repeat the exact fake-trust-signal
-- mistake already found and removed once in this codebase, see visualFilterDefinitions.ts).

ALTER TABLE driver_profiles ADD COLUMN accessibility_capable boolean NOT NULL DEFAULT false;
ALTER TABLE ride_requests ADD COLUMN accessibility_required boolean NOT NULL DEFAULT false;
