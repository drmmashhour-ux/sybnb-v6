-- SR Ride vs Uber gap-closure, capsule 26 (P2 #13): saved places.
-- New table, purely additive. Plain float lat/lng (not PostGIS geometry, unlike ride pickup/
-- dropoff) -- a saved place is never spatially queried, only stored and played back into the ride
-- request form, so the extra PostGIS machinery buys nothing here.

CREATE TABLE saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  address text NOT NULL,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_places_user_id_idx ON saved_places(user_id);
