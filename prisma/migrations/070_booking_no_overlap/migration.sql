-- Defense in depth for double-booking: the application serializes bookings with a per-listing lock,
-- and this makes the database itself refuse two CONFIRMED bookings whose stay ranges overlap on the
-- same listing. Back-to-back stays (check-out day = next check-in day) stay allowed because the
-- range is half-open [check_in, check_out). Production was checked beforehand: 0 existing overlaps.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlapping_confirmed
  EXCLUDE USING gist (
    listing_id WITH =,
    tstzrange(check_in, check_out, '[)') WITH &&
  )
  WHERE (status = 'CONFIRMED' AND check_in IS NOT NULL AND check_out IS NOT NULL);
