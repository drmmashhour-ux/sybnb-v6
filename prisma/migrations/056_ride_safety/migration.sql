-- Safety Phase 1 (2026-10-10): an immutable trip "black box" + SOS/panic + an admin incident/trail
-- console, so a trip that goes wrong can be reconstructed exactly (who, which car, every timestamp
-- and location) and followed up. Two new areas, no change to any existing table's columns.
--
-- Physical style follows the table-CREATION precedent in this tree (024_ride_reviews,
-- 033_ride_stops, 038_sanctions_screening), NOT the ADD-COLUMN style of 055: ride_requests.id and
-- users.id are native `uuid`, so ride_events.ride_id MUST be `uuid` for its FK to ride_requests(id)
-- to be creatable at all (a text column cannot reference a uuid column). For consistency the uuid
-- PKs, timestamptz/now() and text loose-refs mirror ride_reviews / sanctions_screening_results,
-- which store the very same Prisma `String` fields this schema declares.
--
--   ride_events -- an append-only per-ride event stream (created, offered, accepted, every driver
--   status change, SOS, location pings). FK to ride_requests(id) ON DELETE CASCADE so events never
--   outlive their ride. Indexed by (ride_id, created_at) for the ordered trail read.
--
--   incidents -- an SOS pull or a rider/driver report. Loose refs (ride_id / reporter_id /
--   resolved_by_id are plain text, NO foreign keys), matching the sanctions_screening_results
--   subject_id style: an operational safety record must survive even if the referenced ride or
--   account is later removed. Indexed by (status, created_at) for the "open first, newest first"
--   console list and by (ride_id) for the per-ride trail.

CREATE TYPE ride_event_type AS ENUM ('CREATED', 'OFFERED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'SOS', 'LOCATION_PING', 'PICKUP_VERIFIED');

CREATE TABLE ride_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  type       ride_event_type NOT NULL,
  actor_id   text,
  actor_role text,
  lat        double precision,
  lng        double precision,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ride_events_ride_id_created_at_idx ON ride_events(ride_id, created_at);

CREATE TYPE incident_type AS ENUM ('SOS', 'REPORT');
CREATE TYPE incident_status AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE incidents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id        text,
  reporter_id    text NOT NULL,
  reporter_role  text NOT NULL,
  type           incident_type NOT NULL,
  status         incident_status NOT NULL DEFAULT 'OPEN',
  lat            double precision,
  lng            double precision,
  note           text,
  meta           jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by_id text
);

CREATE INDEX incidents_status_created_at_idx ON incidents(status, created_at);
CREATE INDEX incidents_ride_id_idx ON incidents(ride_id);
