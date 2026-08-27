-- SR Ride vs Uber gap-closure, capsule 22 (P0 #1): live map.
-- driver_profiles.last_location_geo already existed but was completely unused. This adds the one
-- missing piece: a freshness timestamp, so a stale or never-reported location can be told apart
-- from a genuinely live one -- the rider's map must never show a fake "live" dot for a driver who
-- stopped reporting position (CAPSULE_RULES.noFakeTrustSignal).

ALTER TABLE driver_profiles ADD COLUMN last_location_updated_at timestamptz;
