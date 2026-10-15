-- Menu Studio (2026-10-15): verified photos + promotions for SE (Eats).
--
-- Photos are moderated content: every upload (menu item photo, merchant cover photo) starts
-- PENDING_REVIEW and only an ADMIN approval makes it customer-visible — the same fail-closed
-- review discipline as merchants, vehicles and ID documents. photo_meta records the server-side
-- standards check (dimensions, size, editing-software signature heuristics) so the reviewer sees
-- the evidence, not just the image.
--
-- Promotions change what an order costs, so per AGENTS.md §6 this is an EXPLICIT money-semantics
-- change: the effective (promo) price is computed server-side at order time and snapshotted into
-- food_order_items.price_minor_snapshot exactly like the base price — covered by
-- tests/e2e/food-menu-studio.e2e.mjs.

CREATE TYPE "FoodPhotoStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "menu_items"
  ADD COLUMN "photo_ref" text,
  ADD COLUMN "photo_mime_type" text,
  ADD COLUMN "photo_status" "FoodPhotoStatus",
  ADD COLUMN "photo_review_note" text,
  ADD COLUMN "photo_meta" jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN "photo_submitted_at" timestamptz,
  ADD COLUMN "photo_reviewed_at" timestamptz,
  ADD COLUMN "promo_price_minor" integer,
  ADD COLUMN "promo_label" text,
  ADD COLUMN "promo_starts_at" timestamptz,
  ADD COLUMN "promo_ends_at" timestamptz;

ALTER TABLE "merchants"
  ADD COLUMN "photo_ref" text,
  ADD COLUMN "photo_mime_type" text,
  ADD COLUMN "photo_status" "FoodPhotoStatus",
  ADD COLUMN "photo_review_note" text,
  ADD COLUMN "photo_meta" jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN "photo_submitted_at" timestamptz,
  ADD COLUMN "photo_reviewed_at" timestamptz;

-- The admin photo-review queue reads by status.
CREATE INDEX "menu_items_photo_status_idx" ON "menu_items" ("photo_status");
CREATE INDEX "merchants_photo_status_idx" ON "merchants" ("photo_status");
