-- SR Ride vs Uber gap-closure, capsule 31 (last item, previously assessed out of scope): ride-
-- pooling. Real MVP, not a fake "Share" label: a rider opts in for a flat discount (placeholder
-- rate, disclosed) and accepts a driver may pick up a second, geographically compatible shareable
-- rider along the way -- an actual second real passenger, matched by real proximity, not a
-- decorative toggle nobody honors. Purely additive.

ALTER TABLE ride_requests ADD COLUMN shareable boolean NOT NULL DEFAULT false;
