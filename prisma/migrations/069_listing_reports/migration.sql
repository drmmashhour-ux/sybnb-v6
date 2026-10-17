-- 069 — Listing reports (2026-10-17). Guests and visitors who are signed in can report a listing
-- (scam / wrong information / unavailable at check-in / inappropriate / other). Admin and support
-- review them. Additive only: one new table, no change to any existing table.
-- Loose references (no foreign keys), like "incidents": a report must survive even if the listing or
-- account it names is later removed. `reason` and `status` are constrained by CHECK, not enums, so a
-- later reason needs no ALTER TYPE.

CREATE TABLE "listing_reports" (
  "id"             text PRIMARY KEY,
  "listing_id"     text NOT NULL,
  "reporter_id"    text NOT NULL,
  "reason"         text NOT NULL,
  "note"           text,
  "status"         text NOT NULL DEFAULT 'OPEN',
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "resolved_at"    timestamptz,
  "resolved_by_id" text,
  "resolution_note" text,
  CONSTRAINT "listing_reports_reason_check"
    CHECK ("reason" IN ('SCAM_OR_FAKE', 'WRONG_INFO', 'UNAVAILABLE_AT_CHECKIN', 'INAPPROPRIATE', 'OTHER')),
  CONSTRAINT "listing_reports_status_check"
    CHECK ("status" IN ('OPEN', 'RESOLVED', 'DISMISSED'))
);

CREATE INDEX "listing_reports_status_created_at_idx" ON "listing_reports" ("status", "created_at");
CREATE INDEX "listing_reports_listing_id_idx" ON "listing_reports" ("listing_id");
-- One OPEN report per reporter per listing (a second click is a no-op, not a flood).
CREATE UNIQUE INDEX "listing_reports_one_open_per_reporter_idx"
  ON "listing_reports" ("listing_id", "reporter_id") WHERE "status" = 'OPEN';
