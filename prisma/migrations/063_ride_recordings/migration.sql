-- SR in-ride audio recording (2026-10-11). Lyft-parity safety feature. Recordings are private,
-- retained 7 days (expires_at), and reachable only once attached to an Incident. UUID ids/FKs.
ALTER TABLE "users" ADD COLUMN "sr_recording_mode" TEXT DEFAULT 'OFF';

CREATE TABLE "ride_recordings" (
  "id" UUID NOT NULL,
  "ride_id" UUID NOT NULL,
  "uploader_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "duration_sec" INTEGER,
  "size_bytes" INTEGER,
  "started_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'STORED',
  "attached_incident_id" UUID,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ride_recordings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ride_recordings_ride_id_idx" ON "ride_recordings"("ride_id");
CREATE INDEX "ride_recordings_uploader_id_idx" ON "ride_recordings"("uploader_id");
CREATE INDEX "ride_recordings_status_expires_at_idx" ON "ride_recordings"("status","expires_at");

ALTER TABLE "ride_recordings" ADD CONSTRAINT "ride_recordings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ride_recordings" ADD CONSTRAINT "ride_recordings_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
