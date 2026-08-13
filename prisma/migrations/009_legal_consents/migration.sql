-- Versioned legal consent. Binds a user's acceptance to a specific document version so re-consent
-- can be required after a republish. Document text is owner/legal-supplied, not stored here.
CREATE TABLE IF NOT EXISTS "legal_consents" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL,
  "document_key" TEXT NOT NULL,
  "version"      TEXT NOT NULL,
  "accepted_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "legal_consents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "legal_consents_user_doc_version_key"
  ON "legal_consents" ("user_id", "document_key", "version");
CREATE INDEX IF NOT EXISTS "legal_consents_user_idx" ON "legal_consents" ("user_id");
