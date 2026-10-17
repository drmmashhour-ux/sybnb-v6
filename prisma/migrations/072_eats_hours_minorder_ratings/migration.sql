-- Eats: restaurant opening hours, minimum order, and customer ratings of delivered orders.
-- All columns are nullable/additive, so existing rows keep working unchanged.
ALTER TABLE "merchants" ADD COLUMN "opening_hours" JSONB;
ALTER TABLE "merchants" ADD COLUMN "min_order_minor" INTEGER;
ALTER TABLE "food_orders" ADD COLUMN "rating_stars" INTEGER;
ALTER TABLE "food_orders" ADD COLUMN "rating_comment" TEXT;
ALTER TABLE "food_orders" ADD COLUMN "rated_at" TIMESTAMP(3);
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_rating_stars_range" CHECK ("rating_stars" IS NULL OR ("rating_stars" >= 1 AND "rating_stars" <= 5));
CREATE INDEX "food_orders_merchant_id_rating_stars_idx" ON "food_orders"("merchant_id", "rating_stars");
