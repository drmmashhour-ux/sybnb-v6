-- 019_payment_event_conflict_record_and_honest_naming
-- Closes two real defects found by independent review of 3fca26d:
--
-- 1. intakeEvent() mutated the ORIGINAL event row's processingStatus/lastError on a genuine identity
-- conflict (a redelivery under the same canonical identity but with different immutable fields).
-- This could silently overwrite a legitimate APPLIED/IGNORED/FAILED/DEAD_LETTERED row's true,
-- authoritative outcome with QUARANTINED -- destroying the audit trail this whole table exists to
-- protect. Fixed by never writing to the original row on conflict at all: a new, append-only
-- payment_event_conflicts table records the conflicting delivery's safe, non-sensitive metadata
-- (digest + immutable-field snapshot, never the raw payload) referencing the original event by id.
--
-- 2. provider_account stored a hardcoded, per-rail literal ('sandbox-test-account'/'stripe-checkout')
-- -- an application configuration label, not an identity derived from any verified provider/account
-- context (this codebase has no multi-account/Connect support). Documented and named honestly:
-- renamed to provider_endpoint_key. If real multi-account support is ever added, this field must be
-- derived from the verified account context (e.g. Stripe Connect's event.account), not a literal.
--
-- Hand-written per this repo's established convention. Applied via `psql -f`, then `npx prisma generate`.

-- 1. Rename provider_account -> provider_endpoint_key (honest naming; same column, same data, same
-- role in the composite identity constraint -- the constraint itself (payment_events_identity_key)
-- is left unrenamed to avoid unnecessary churn to an internal DB object name).
ALTER TABLE payment_events RENAME COLUMN provider_account TO provider_endpoint_key;

-- 2. Append-only conflict record. No FK ON DELETE CASCADE concern here the way PaymentEvent's own
-- parent relations had: this table's whole purpose is a child audit record of the PARENT PaymentEvent
-- row, not an independent durable record in its own right -- if the PaymentEvent row itself were ever
-- deleted (never happens in this codebase today), its conflict history going with it is correct, not
-- a durability defect.
CREATE TABLE payment_event_conflicts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_event_id    uuid NOT NULL REFERENCES payment_events(id) ON DELETE CASCADE,
  received_at         timestamptz NOT NULL DEFAULT now(),
  payload_digest      text NOT NULL,
  type                text NOT NULL,
  provider_reference  text NOT NULL,
  subject_type        text NOT NULL,
  provider_object_id  text,
  amount_minor        integer,
  currency             text
);

CREATE INDEX payment_event_conflicts_payment_event_id_idx ON payment_event_conflicts (payment_event_id);
