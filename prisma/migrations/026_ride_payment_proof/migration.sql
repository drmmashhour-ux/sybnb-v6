-- 026_ride_payment_proof
--
-- SR Ride vs. Uber gap-closure, capsule 19 (P1 #5 of the benchmark, owner-approved via
-- AskUserQuestion: "Build it, same as STAYS"): SR Ride has zero in-app payment-collection
-- mechanism -- fares are informational only, presumably cash-in-person. Adds ride_id to
-- payment_proofs as a direct mirror of the existing booking_id column: same nullable FK shape,
-- same "one of several possible linkage columns" pattern payment_proofs already uses for
-- seller_plan/advertising submissions that have no booking either.
--
-- Purely additive. No other table touched. payments=DISABLED and PAYMENT_RAIL_MANUAL_PROOF_ENABLED
-- stay untouched by this migration -- this only makes the column exist; server/lib/payment-policy.mjs
-- still gates whether the operation is ever actually reachable.

ALTER TABLE payment_proofs ADD COLUMN ride_id uuid REFERENCES ride_requests(id);
