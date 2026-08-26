-- 025_driver_photo
--
-- SR Ride vs. Uber gap-closure, capsule 16 (P0 #2 of the benchmark): no driver photo exists
-- anywhere in the schema, so a rider identifies their driver by name + vehicle text only.
--
-- Purely additive. photo_ref points into the new private 'driver-photo' storage bucket
-- (server/lib/storage.mjs), retrieved only via a short-lived signed URL -- same pattern already
-- used for KYC documents and listing media, not a bare public path.

ALTER TABLE driver_profiles ADD COLUMN photo_ref text;
ALTER TABLE driver_profiles ADD COLUMN photo_mime_type text;
