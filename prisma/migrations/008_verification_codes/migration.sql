-- Server-authoritative phone/identity verification (OTP). Codes are generated, hashed, and
-- verified entirely on the backend; the plaintext code is never stored or returned to production
-- clients. (This DDL is the canonical form for a fresh database; the staging DB already carried
-- an out-of-band copy of this table + enum.)
DO $$ BEGIN
  CREATE TYPE "verification_status" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "verification_codes" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "identifier_hash"     TEXT NOT NULL,
  "purpose"             TEXT NOT NULL,
  "code_hash"           TEXT NOT NULL,
  "status"              "verification_status" NOT NULL DEFAULT 'PENDING',
  "attempts"            INTEGER NOT NULL DEFAULT 0,
  "max_attempts"        INTEGER NOT NULL DEFAULT 5,
  "expires_at"          TIMESTAMPTZ NOT NULL,
  "sent_provider"       TEXT,
  "provider_message_id" TEXT,
  "verified_at"         TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "channel"             TEXT NOT NULL DEFAULT 'sms',
  CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "verification_codes_identifier_purpose_status_idx"
  ON "verification_codes" ("identifier_hash", "purpose", "status");
CREATE INDEX IF NOT EXISTS "verification_codes_expires_idx" ON "verification_codes" ("expires_at");
CREATE INDEX IF NOT EXISTS "verification_codes_channel_idx" ON "verification_codes" ("channel");
