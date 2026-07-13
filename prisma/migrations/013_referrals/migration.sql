CREATE TYPE "referral_status" AS ENUM ('PENDING', 'REWARDED');

-- referral_code must end up NOT NULL + UNIQUE, but existing rows have none yet: add nullable,
-- backfill a value for any pre-existing row, then tighten the constraint. New rows going forward
-- always get a real, collision-checked code from server/lib/referrals.mjs at creation time -- this
-- backfill only ever runs once, against whatever rows already existed before this migration.
ALTER TABLE "users" ADD COLUMN "referral_code" TEXT;
UPDATE "users" SET "referral_code" = upper(substr(md5(random()::text || id::text), 1, 8)) WHERE "referral_code" IS NULL;
ALTER TABLE "users" ALTER COLUMN "referral_code" SET NOT NULL;
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- referrer_user_id/referee_user_id are uuid (matching users.id's real column type on a
-- migrate-deploy-provisioned database -- see migrations 009/010 for the same convention). An
-- earlier draft of this migration typed these as text, which would have failed with a
-- text/uuid FK type mismatch the first time it ran against a real database; caught and fixed
-- before ever being applied anywhere. qualifying_booking_id stays text/nullable/no-FK since it's a
-- loose reference that can point at either a booking or a payment-proof id (same convention as
-- wallet_entries.reference_id in migration 001), not a single consistently-typed foreign key.
CREATE TABLE "referrals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "referrer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "referee_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "status" "referral_status" NOT NULL DEFAULT 'PENDING',
    "qualifying_booking_id" TEXT,
    "rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "referrals_referee_user_id_key" ON "referrals"("referee_user_id");
CREATE INDEX "referrals_referrer_user_id_status_idx" ON "referrals"("referrer_user_id", "status");
