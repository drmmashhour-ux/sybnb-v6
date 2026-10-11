-- Schedule-a-visit (2026-10-11). A date/time viewing request a buyer/renter sends and the owner
-- confirms or declines. UUID id/FK columns to match listings.id / users.id.
CREATE TYPE "visit_status" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'CANCELLED');

CREATE TABLE "visit_requests" (
  "id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "requester_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "proposed_at" TIMESTAMP(3) NOT NULL,
  "status" "visit_status" NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "response_note" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visit_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visit_requests_requester_id_idx" ON "visit_requests"("requester_id");
CREATE INDEX "visit_requests_owner_id_status_idx" ON "visit_requests"("owner_id","status");
CREATE INDEX "visit_requests_listing_id_idx" ON "visit_requests"("listing_id");

ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
