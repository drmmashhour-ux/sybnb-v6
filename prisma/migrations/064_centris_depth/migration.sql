-- Centris-depth features (2026-10-11): map coordinates, open houses, agent reviews.
-- UUID id/FK columns to match listings.id / users.id (established DB convention).

-- 1) Map coordinates on locations. Plain lat/lng so the map works without PostGIS function calls
--    (the geometry `geo` column stays for future spatial queries). Captured by the seller wizard's
--    location pin; existing rows stay NULL until a listing is re-saved.
ALTER TABLE "locations" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN "lng" DOUBLE PRECISION;

-- 2) Open houses: a seller-published viewing window buyers can see on a listing (vs 1:1 visits).
CREATE TABLE "open_houses" (
  "id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "open_houses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "open_houses_listing_id_idx" ON "open_houses"("listing_id");
CREATE INDEX "open_houses_starts_at_idx" ON "open_houses"("starts_at");
ALTER TABLE "open_houses" ADD CONSTRAINT "open_houses_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Agent reviews: a buyer rates a verified agent/broker (1-5 + comment). One review per author per
--    agent (upserted). Aggregate shown on the agent profile.
CREATE TABLE "agent_reviews" (
  "id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_reviews_agent_id_author_id_key" ON "agent_reviews"("agent_id","author_id");
CREATE INDEX "agent_reviews_agent_id_idx" ON "agent_reviews"("agent_id");
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
