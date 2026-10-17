-- One-time emailed "open my booking" links for guests who started checkout without a code.
CREATE TABLE "email_login_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_login_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_login_links_token_hash_key" ON "email_login_links"("token_hash");
CREATE INDEX "email_login_links_user_id_idx" ON "email_login_links"("user_id");
