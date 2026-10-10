-- Centris-parity Phase 1 (2026-10-10): favourites + saved searches with new-listing alerts.
-- UUID id/FK columns to match listings.id / users.id (this DB stores PKs as uuid).
CREATE TABLE "favourites" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "favourites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "favourites_user_id_listing_id_key" ON "favourites"("user_id","listing_id");
CREATE INDEX "favourites_user_id_idx" ON "favourites"("user_id");
CREATE INDEX "favourites_listing_id_idx" ON "favourites"("listing_id");

CREATE TABLE "saved_searches" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "label" TEXT,
  "division" TEXT NOT NULL,
  "filters" JSONB NOT NULL DEFAULT '{}',
  "notify_on_new" BOOLEAN NOT NULL DEFAULT true,
  "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saved_searches_user_id_idx" ON "saved_searches"("user_id");
CREATE INDEX "saved_searches_notify_on_new_last_checked_at_idx" ON "saved_searches"("notify_on_new","last_checked_at");

ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "listings" ADD COLUMN "approved_at" TIMESTAMP(3);
CREATE INDEX "listings_division_status_approved_at_idx" ON "listings"("division","status","approved_at");
