-- Electronic payment intents + auditable idempotent provider event history.
DO $$ BEGIN
  CREATE TYPE "payment_intent_status" AS ENUM ('REQUIRES_PAYMENT','PROCESSING','SUCCEEDED','FAILED','CANCELED','REFUNDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "payment_intents" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL,
  "reference"    TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency"     TEXT NOT NULL,
  "status"       "payment_intent_status" NOT NULL DEFAULT 'REQUIRES_PAYMENT',
  "provider"     TEXT NOT NULL DEFAULT 'stripe',
  "provider_ref" TEXT,
  "booking_id"   UUID,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_reference_key" ON "payment_intents" ("reference");
CREATE INDEX IF NOT EXISTS "payment_intents_user_idx" ON "payment_intents" ("user_id");

CREATE TABLE IF NOT EXISTS "payment_events" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "intent_id"         UUID NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "amount_minor"      INTEGER,
  "currency"          TEXT,
  "received_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_events_intent_fkey" FOREIGN KEY ("intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_provider_event_id_key" ON "payment_events" ("provider_event_id");
CREATE INDEX IF NOT EXISTS "payment_events_intent_idx" ON "payment_events" ("intent_id");
