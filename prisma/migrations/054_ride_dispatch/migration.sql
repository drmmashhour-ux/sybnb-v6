-- Full auto-dispatch (2026-10-10): a ride is auto-offered to the nearest eligible online driver with
-- a short expiry; on decline/expiry it escalates to the next nearest driver. These columns carry the
-- live outstanding offer (offered_driver_id + offer_expires_at), the escalation round counter
-- (offer_seq, capped in code so a ride can't be offered forever), and the set of drivers who declined
-- or let an offer lapse (declined_by_ids) so they're skipped on re-offer. No data migration: every
-- existing row gets the column defaults (null offer, seq 0, empty declined list).
ALTER TABLE "ride_requests" ADD COLUMN "offered_driver_id" UUID, ADD COLUMN "offer_expires_at" TIMESTAMP(3), ADD COLUMN "offer_seq" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "declined_by_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
CREATE INDEX "ride_requests_offered_driver_id_status_idx" ON "ride_requests" ("offered_driver_id", "status");
