-- Owner-approved business rule: one approved advertising payment = one campaign. A $19/$49
-- payment must not permanently unlock unlimited ad creation the way the CARS/MARKETPLACE/
-- NEW_CONSTRUCTION dealer plan model intentionally does (pay once, list unlimited real
-- inventory) -- that model is correct there and left untouched; advertising is different.
--
-- plan_code: which plan this SPECIFIC payment was submitted for. Previously only SellerProfile
-- carried planCode, which gets overwritten by every new proof submission -- there was no durable
-- per-payment record of what an already-reviewed proof was actually for, so admin (or code) could
-- never reliably tell one payment's plan from another's after the fact.
--
-- campaign_listing_id: set the moment an advertising payment is bound to a new campaign listing
-- at creation time (deterministic, not inferred from amount/uploader). Stays set forever once
-- that campaign is admin-approved (the payment is now genuinely "consumed" -- a second campaign
-- or a renewal after expiry needs a fresh payment). If the bound campaign is instead REJECTED, the
-- binding is released back to NULL so the same, still-valid payment can back a retry.
ALTER TABLE payment_proofs ADD COLUMN plan_code text;
ALTER TABLE payment_proofs ADD COLUMN campaign_listing_id uuid;
CREATE INDEX payment_proofs_campaign_listing_id_idx ON payment_proofs (campaign_listing_id);
