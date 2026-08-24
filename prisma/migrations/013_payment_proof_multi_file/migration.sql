-- 013_payment_proof_multi_file
-- Adds proof_asset_urls (text[]) to payment_proofs. Several upload flows (seller-plan documents,
-- advertising payment files) genuinely upload multiple real files via the storage-backed upload
-- endpoint, but PaymentProof.proof_asset_url is a single string, so only the first uploaded file's
-- URL ever reached the record admin actually reviews — the rest were stored (real bytes, real
-- object-storage keys) but permanently invisible to review. This adds the full-list column;
-- proof_asset_url is untouched and stays populated with the first URL for every existing
-- single-file consumer (Stripe, local-wallet, etc.).

ALTER TABLE payment_proofs ADD COLUMN proof_asset_urls text[] NOT NULL DEFAULT '{}';

-- Backfill: any existing row with a real proof_asset_url (not the legacy filename-only
-- session://... reference) gets it as the sole entry in proof_asset_urls, so already-submitted
-- proofs don't regress to an empty list.
UPDATE payment_proofs
SET proof_asset_urls = ARRAY[proof_asset_url]
WHERE proof_asset_url IS NOT NULL AND proof_asset_url LIKE 'payment-proof://%';
