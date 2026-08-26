-- SR Ride vs Uber gap-closure, capsule 27 (P2 #14): multi-stop rides.
-- New child table, purely additive. Plain float lat/lng (not PostGIS), same reasoning as
-- saved_places: a stop is resolved once at ride-creation time and only ever played back for
-- display, never spatially queried after that.

CREATE TABLE ride_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  address text NOT NULL,
  lat double precision,
  lng double precision
);

CREATE INDEX ride_stops_ride_id_sequence_idx ON ride_stops(ride_id, sequence);
