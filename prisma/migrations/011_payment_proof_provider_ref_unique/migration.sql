-- Close the PaymentProof duplicate-reference race with a DB-level unique constraint on
-- (provider, provider_ref). Postgres treats NULLs as distinct, so proofs without a providerRef
-- (internally generated) are unaffected; only real duplicate references are rejected. On a fresh
-- production DB there are no duplicates; if any exist they must be resolved before this applies
-- (that is the correct fail-closed behavior for an integrity violation).
CREATE UNIQUE INDEX IF NOT EXISTS "payment_proofs_provider_provider_ref_key"
  ON "payment_proofs" ("provider", "provider_ref");
