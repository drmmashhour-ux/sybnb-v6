-- Cars marketplace + auction (2026-10-10). A hybrid auction layer on the polymorphic listings table.
-- A CARS listing with an auctions row is sold by auction; without one it stays fixed-price/contact.
-- NOTE: this DB stores primary keys as UUID (listings.id, users.id are uuid), so the id + foreign-key
-- columns below are UUID to satisfy the FK type-match (Prisma models still declare them as String,
-- matching every existing table in this schema -- the client reads uuid columns as strings).
CREATE TYPE "auction_deposit_mode" AS ENUM ('NONE', 'REQUIRED');
CREATE TYPE "auction_status" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'SETTLED', 'CANCELLED');
CREATE TYPE "bid_status" AS ENUM ('ACTIVE', 'OUTBID', 'WON', 'LOST', 'RETRACTED');

CREATE TABLE "auctions" (
  "id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "start_minor" INTEGER NOT NULL,
  "reserve_minor" INTEGER,
  "min_increment_minor" INTEGER NOT NULL DEFAULT 5000,
  "deposit_mode" "auction_deposit_mode" NOT NULL DEFAULT 'NONE',
  "deposit_minor" INTEGER,
  "anti_snipe_seconds" INTEGER NOT NULL DEFAULT 120,
  "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "status" "auction_status" NOT NULL DEFAULT 'LIVE',
  "current_bid_minor" INTEGER,
  "current_bid_id" UUID,
  "bid_count" INTEGER NOT NULL DEFAULT 0,
  "winner_id" UUID,
  "winning_bid_minor" INTEGER,
  "reserve_met" BOOLEAN NOT NULL DEFAULT false,
  "settled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auctions_listing_id_key" ON "auctions"("listing_id");
CREATE INDEX "auctions_status_ends_at_idx" ON "auctions"("status","ends_at");
CREATE INDEX "auctions_seller_id_idx" ON "auctions"("seller_id");

CREATE TABLE "bids" (
  "id" UUID NOT NULL,
  "auction_id" UUID NOT NULL,
  "bidder_id" UUID NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "bid_status" NOT NULL DEFAULT 'ACTIVE',
  "max_proxy_minor" INTEGER,
  "deposit_pm_id" TEXT,
  "deposit_proof_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bids_auction_id_amount_minor_idx" ON "bids"("auction_id","amount_minor");
CREATE INDEX "bids_auction_id_created_at_idx" ON "bids"("auction_id","created_at");
CREATE INDEX "bids_bidder_id_idx" ON "bids"("bidder_id");

ALTER TABLE "auctions" ADD CONSTRAINT "auctions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
