-- Guests may start a booking from checkout without an emailed code. Their account is flagged until the
-- email is verified. Additive, defaults false so every existing account is unchanged.
ALTER TABLE "users" ADD COLUMN "email_unverified" BOOLEAN NOT NULL DEFAULT false;
