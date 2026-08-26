-- 023_refund_item2_phase2a
--
-- Item 2 Phase 2a: data model only, per the independently-reviewed Revision 10 design
-- (10 review rounds; see the delivered design document and evidence package for the full
-- derivation of every choice below -- this migration implements it, it does not re-derive it).
--
-- No route, no library function, no application behavior changes as a result of this migration.
-- payments=DISABLED, publicAccess=CLOSED are untouched; nothing here enables any money movement.
-- Gate 4 (payment-policy.mjs's APPROVED_PROVIDER_CONFIGS) still has no 'stripe' entry and is
-- completely unaffected by anything in this file.
--
-- Contents:
--   1. Two new enums: refund_business_status, refund_attempt_status.
--   2. Four new tables: refunds, refund_attempts, refund_provider_observations,
--      refund_observation_consumptions.
--   3. Five new columns on payment_proofs (three refund counters + two typed refundable-object
--      identity columns) and their four CHECK constraints.
--   4. Four new columns on payment_events (refund-level and attempt-level resolved FK + permanent
--      snapshot, mirroring the existing intent_id/original_intent_id pattern exactly).
--   5. Two partial unique indexes (one active refund per payment proof; one active attempt per
--      refund).
--   6. The exhaustive, mutually-exclusive refund_attempt_status_shape CHECK constraint.
--   7. Two triggers: refund_attempt_supersession_once (a real, statement-independent
--      database-enforced "set at most once" invariant) and refund_attempt_immutable_fields
--      (protects every canonical-request and legacy-acceptance field once set).
--   8. The mandatory legacy-REFUNDED-proof classification is NOT in this file -- it requires the
--      real idempotencyKey() application function (Node crypto, not reproducible standalone in
--      SQL without risking drift from the real implementation) and is instead a separate, explicit
--      data-migration script (scripts/migrate-legacy-refunds-2a.mjs), run once immediately after
--      this schema migration, with its own full evidence capture. This file leaves every existing
--      REFUNDED payment_proof's new counters at their DEFAULT 0 -- the classification script is
--      what populates them correctly, per proof, per the six-way scheme, or aborts entirely rather
--      than guess.
--
-- Hand-written per this repo's established convention. Applied via `psql -f`, then
-- `npx prisma generate`.
--
-- CORRECTIVE NOTE (round 2, after independent review rejected round 1): this file is now wrapped
-- in an explicit BEGIN/COMMIT. Round 1 relied on `psql -v ON_ERROR_STOP=1 -f`, which stops psql
-- issuing further statements after the first error but does NOT roll back statements already
-- committed before it -- psql's default is autocommit-per-statement outside an explicit
-- transaction. A failure partway through (e.g. the last CREATE TRIGGER) would have left every
-- earlier CREATE TYPE/TABLE/ALTER TABLE permanently committed, a genuinely dangerous half-applied
-- state for a money-schema migration. Every statement in this file is ordinary transactional DDL
-- (Postgres supports transactional CREATE TYPE/TABLE/INDEX/FUNCTION/TRIGGER/ALTER TABLE), so
-- wrapping it costs nothing and makes the whole file succeed or fail as one atomic unit -- proven
-- in this round's evidence via a deliberately-broken variant of this file that fails partway
-- through, confirming zero of the earlier statements survive.

BEGIN;

-- ============================================================================
-- 1. Enums
-- ============================================================================

CREATE TYPE refund_business_status AS ENUM (
  'REQUESTED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'SUCCEEDED', 'ACCOUNTING_ACCEPTED', 'CANCELLED'
);

CREATE TYPE refund_attempt_status AS ENUM (
  'CLAIMED', 'OUTBOUND_STARTED', 'AWAITING_PROVIDER_CONFIRMATION', 'RESULT_UNKNOWN', 'RECONCILING',
  'SUCCEEDED', 'PROVIDER_DECLINED', 'SUPERSEDED', 'ABANDONED',
  'LEGACY_UNVERIFIED', 'LEGACY_PENDING_CONFIRMATION', 'LEGACY_ACCOUNTING_ACCEPTED'
);

-- ============================================================================
-- 2. Tables
-- ============================================================================

-- bookingId is a PERMANENT SNAPSHOT (deliberately no FK), mirroring payment_events'
-- original_booking_id/original_intent_id convention exactly -- it must survive regardless of
-- whatever happens to the live booking row. paymentProofId IS a live FK, RESTRICT: no code path
-- deletes a PaymentProof today, and RESTRICT is the honest "not designed for that" default rather
-- than a guess at future-proofing (same reasoning already used for payment_events' own relations).
CREATE TABLE refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_proof_id      uuid NOT NULL REFERENCES payment_proofs(id) ON DELETE RESTRICT,
  booking_id            uuid,
  requested_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor          integer NOT NULL,
  currency              text NOT NULL,
  reason                text NOT NULL,
  reason_code           text NOT NULL,
  rail                  text NOT NULL,
  status                refund_business_status NOT NULL DEFAULT 'REQUESTED',
  -- Explicit, DB-persisted answer to "is this refund's own reservation currently held" -- never
  -- inferred from `status` alone, which cannot distinguish a released-on-decline ACTION_REQUIRED
  -- from a held-pending-legacy-migration one.
  reservation_held      boolean NOT NULL DEFAULT true,
  migrated_from_legacy  boolean NOT NULL DEFAULT false,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  succeeded_at          timestamptz
);

CREATE INDEX refunds_payment_proof_id_status_idx ON refunds (payment_proof_id, status);
CREATE INDEX refunds_status_idx ON refunds (status);

-- refund_attempts: every canonical-request field is NULLABLE -- populated for a real, non-legacy
-- attempt; NULL for every migrated one (a migrated attempt never made a real provider request, and
-- inventing values here would fabricate a false audit trail -- the exact defect an earlier design
-- revision was rejected for). superseded_by_attempt_id is self-referential, RESTRICT (a canonical
-- attempt must never be deletable while a superseded one still points to it), and its "set at most
-- once" invariant is enforced by a real trigger below, not only by the guarded UPDATE statements
-- that use this column at the application layer.
CREATE TABLE refund_attempts (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id                       uuid NOT NULL REFERENCES refunds(id) ON DELETE RESTRICT,
  status                          refund_attempt_status NOT NULL DEFAULT 'CLAIMED',
  claim_token                     text,
  claim_expires_at                timestamptz,
  -- AWAITING_PROVIDER_CONFIRMATION's own eligibility deadline for reconciliation -- always
  -- populated the moment an attempt enters that state (claim_expires_at is cleared to null there
  -- instead, since no active ownership is needed during an expected async wait). RESULT_UNKNOWN
  -- keeps using claim_expires_at directly (always genuinely populated for that state, inherited
  -- unchanged from OUTBOUND_STARTED). Neither reconciliation eligibility rule ever treats a null
  -- expiry as "already expired" -- each state has its own, always-populated deadline field.
  reconcile_not_before            timestamptz,
  canonical_request_version       integer,
  provider                        text,
  provider_payment_object_type    text,
  provider_payment_object_id      text,
  provider_endpoint_key           text,
  amount_minor                    integer,
  currency                        text,
  idempotency_key                 text UNIQUE,
  request_fingerprint             text,
  started_at                      timestamptz NOT NULL DEFAULT now(),
  outbound_started_at             timestamptz,
  completed_at                    timestamptz,
  provider_status                 text,
  provider_refund_ref             text,
  error_classification            text,
  ambiguous                       boolean NOT NULL DEFAULT false,
  superseded_by_attempt_id        uuid REFERENCES refund_attempts(id) ON DELETE RESTRICT,
  migrated_from_legacy            boolean NOT NULL DEFAULT false,
  legacy_wallet_entry_id          uuid REFERENCES wallet_entries(id) ON DELETE RESTRICT,
  legacy_payment_event_id         uuid REFERENCES payment_events(id) ON DELETE RESTRICT,
  legacy_accepted_by_user_id      uuid REFERENCES users(id) ON DELETE RESTRICT,
  legacy_accepted_at              timestamptz,
  legacy_acceptance_reason        text,
  legacy_acceptance_evidence_digest text
);

CREATE INDEX refund_attempts_refund_id_status_idx ON refund_attempts (refund_id, status);

-- refund_provider_observations: genuinely append-only -- database-enforced via the
-- reject_all_mutations triggers added in section 7 below (round 2 correction: round 1 asserted
-- this only in prose, which independent review correctly rejected). There is no legitimate reason
-- to ever change an observation once recorded, and the real deduplication constraint below means a
-- repeated identical observation collapses to the same row rather than needing to be "corrected".
CREATE TABLE refund_provider_observations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_attempt_id         uuid NOT NULL REFERENCES refund_attempts(id) ON DELETE RESTRICT,
  observed_by_claim_token   text,
  provider_payment_object_id text NOT NULL,
  provider_refund_ref       text,
  provider_status           text,
  response_digest           text NOT NULL,
  observed_at               timestamptz NOT NULL DEFAULT now()
);

-- Real deduplication: a genuinely identical repeated observation for the same attempt collapses to
-- one row via this constraint.
CREATE UNIQUE INDEX refund_provider_observations_dedup ON refund_provider_observations (refund_attempt_id, response_digest);

-- refund_observation_consumptions: a SEPARATE table, not columns on the observation above -- this
-- is what makes BOTH tables genuinely insert-only, database-enforced via its own
-- reject_all_mutations triggers (section 7). Consuming an observation is recorded by INSERTING a
-- consumption row that references it, never by updating the observation itself. The UNIQUE on
-- observation_id is also the mechanism that resolves a race between two would-be consumers: exactly
-- one INSERT succeeds (Postgres's own unique-constraint enforcement is the CAS).
CREATE TABLE refund_observation_consumptions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id              uuid NOT NULL UNIQUE REFERENCES refund_provider_observations(id) ON DELETE RESTRICT,
  consumed_at                 timestamptz NOT NULL DEFAULT now(),
  consumed_by_transaction_ref text NOT NULL
);

-- ============================================================================
-- 3. payment_proofs: three refund counters + two typed refundable-object identity columns
-- ============================================================================

ALTER TABLE payment_proofs ADD COLUMN reserved_refund_minor integer NOT NULL DEFAULT 0;
ALTER TABLE payment_proofs ADD COLUMN succeeded_refund_minor integer NOT NULL DEFAULT 0;
-- A THIRD, separate bucket for LEGACY_ACCOUNTING_ACCEPTED amounts -- an owner's explicit
-- acceptance of incomplete historical evidence is never the same epistemic claim as genuine
-- provider/ledger confirmation, and is tracked separately here so no report or query can
-- accidentally conflate the two.
ALTER TABLE payment_proofs ADD COLUMN accepted_refund_minor integer NOT NULL DEFAULT 0;
-- Captured durably at ORIGINAL payment confirmation time (a future application change to
-- finalizeStripeSession, not part of this schema-only migration) -- 'charge' | 'payment_intent'.
-- NULL for every existing proof; stripe_checkout-rail refund creation refuses
-- (REFUND_TARGET_UNVERIFIED, application-level, not a DB constraint) when these are null.
ALTER TABLE payment_proofs ADD COLUMN provider_payment_object_type text;
ALTER TABLE payment_proofs ADD COLUMN provider_payment_object_id text;

ALTER TABLE payment_proofs ADD CONSTRAINT reserved_refund_minor_nonneg CHECK (reserved_refund_minor >= 0);
ALTER TABLE payment_proofs ADD CONSTRAINT succeeded_refund_minor_nonneg CHECK (succeeded_refund_minor >= 0);
ALTER TABLE payment_proofs ADD CONSTRAINT accepted_refund_minor_nonneg CHECK (accepted_refund_minor >= 0);
-- The hard, unconditional cap -- always payment_proofs.amount_minor, never a policy-dependent
-- stored ceiling (an earlier design revision's `refundableCeilingMinor` column was removed after
-- tracing bookings.mjs vs. host.mjs/admin.mjs and finding they genuinely disagree on whether a
-- purchased protection fee is refundable; this migration does not silently resolve that
-- disagreement -- see the design document's open owner decisions). A second, DATABASE-enforced
-- backstop underneath every application-level guarded-update check, never a substitute for them.
ALTER TABLE payment_proofs ADD CONSTRAINT refund_minor_within_amount CHECK (
  reserved_refund_minor + succeeded_refund_minor + accepted_refund_minor <= amount_minor
);

-- At most one non-terminal-or-ACTION_REQUIRED refund per payment proof -- a proof with an
-- unresolved ACTION_REQUIRED refund must be resolved (via /retry or /legacy_refund_accept) before
-- a brand-new, separate refund request against the same proof is permitted.
CREATE UNIQUE INDEX refunds_one_active_per_payment_proof ON refunds (payment_proof_id)
  WHERE status IN ('REQUESTED', 'IN_PROGRESS', 'ACTION_REQUIRED');

-- ============================================================================
-- 4. payment_events: refund-level and attempt-level resolved FK + permanent snapshot
-- ============================================================================
--
-- Mirrors the existing intent_id/original_intent_id and booking_id/original_booking_id pattern
-- exactly: refund_id/refund_attempt_id are LIVE, nullable, SET NULL FKs, populated once local
-- resolution succeeds; original_refund_id/original_refund_attempt_id are PERMANENT snapshots,
-- never cleared by any deletion. A refund can have several attempts over time, so both the
-- refund-level AND attempt-level pair are needed -- a late webhook must resolve to the SPECIFIC
-- attempt it concerns, not whichever attempt happens to be current (see the design document's
-- finding on this exact point).

ALTER TABLE payment_events ADD COLUMN refund_id uuid REFERENCES refunds(id) ON DELETE SET NULL;
ALTER TABLE payment_events ADD COLUMN original_refund_id uuid;
ALTER TABLE payment_events ADD COLUMN refund_attempt_id uuid REFERENCES refund_attempts(id) ON DELETE SET NULL;
ALTER TABLE payment_events ADD COLUMN original_refund_attempt_id uuid;

CREATE INDEX payment_events_refund_id_idx ON payment_events (refund_id);
CREATE INDEX payment_events_refund_attempt_id_idx ON payment_events (refund_attempt_id);

-- ============================================================================
-- 5. The exhaustive, mutually-exclusive refund_attempt_status_shape CHECK constraint
-- ============================================================================
--
-- Each branch names a SPECIFIC status value with its COMPLETE required shape -- no branch has an
-- early-exit condition like a bare `migrated_from_legacy = false OR (...)` (an earlier design
-- revision's version of this constraint had exactly that bug, making the whole CHECK trivially
-- true for every non-legacy row and defeating every constraint after it -- fixed here). A row
-- satisfies at most one branch by construction; any row matching zero branches is rejected by the
-- database outright.
--
-- supersededByAttemptId is deliberately NOT constrained by this CHECK for LEGACY_PENDING_
-- CONFIRMATION (starts null, transitions to the accepting attempt's id exactly once, later, when
-- an owner acts) or for ordinary non-legacy attempts (SUPERSEDED legitimately has it non-null;
-- every other ordinary status has it null through normal application logic, not a blanket CHECK,
-- since over-constraining live in-flight state at the database level would conflict with the
-- legitimate variety of states an ordinary attempt legally passes through).
--
-- CORRECTIVE NOTE (round 2): round 1 documented the LEGACY_PENDING_CONFIRMATION exception above but
-- never actually wrote the converse into the other three legacy branches -- independent review
-- correctly found superseded_by_attempt_id was left completely unconstrained for LEGACY_UNVERIFIED,
-- legacy SUCCEEDED, and LEGACY_ACCOUNTING_ACCEPTED too, meaning nothing at the database level
-- prevented any of them from acquiring a (nonsensical) superseding pointer. Fixed below: those three
-- branches now each require `superseded_by_attempt_id IS NULL` explicitly -- only
-- LEGACY_PENDING_CONFIRMATION may ever carry a non-null value, matching the approved design's own
-- stated exception exactly, not a superset of it.

ALTER TABLE refund_attempts ADD CONSTRAINT refund_attempt_status_shape CHECK (
  (migrated_from_legacy = false
    AND status IN ('CLAIMED','OUTBOUND_STARTED','AWAITING_PROVIDER_CONFIRMATION','RESULT_UNKNOWN','RECONCILING','SUCCEEDED','PROVIDER_DECLINED','SUPERSEDED','ABANDONED')
    AND provider IS NOT NULL AND provider_payment_object_type IS NOT NULL AND provider_payment_object_id IS NOT NULL
    AND provider_endpoint_key IS NOT NULL AND amount_minor IS NOT NULL AND currency IS NOT NULL
    AND idempotency_key IS NOT NULL AND request_fingerprint IS NOT NULL AND canonical_request_version IS NOT NULL
    AND legacy_wallet_entry_id IS NULL AND legacy_payment_event_id IS NULL
    AND legacy_accepted_by_user_id IS NULL AND legacy_accepted_at IS NULL
    AND legacy_acceptance_reason IS NULL AND legacy_acceptance_evidence_digest IS NULL
  )
  OR (migrated_from_legacy = true AND status = 'LEGACY_UNVERIFIED'
    AND provider IS NULL AND provider_payment_object_type IS NULL AND provider_payment_object_id IS NULL
    AND provider_endpoint_key IS NULL AND amount_minor IS NULL AND currency IS NULL
    AND idempotency_key IS NULL AND request_fingerprint IS NULL AND canonical_request_version IS NULL
    AND outbound_started_at IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL
    AND reconcile_not_before IS NULL AND provider_status IS NULL AND provider_refund_ref IS NULL
    AND error_classification IS NULL AND ambiguous = false AND completed_at IS NOT NULL
    AND superseded_by_attempt_id IS NULL
    AND legacy_wallet_entry_id IS NULL AND legacy_payment_event_id IS NULL
    AND legacy_accepted_by_user_id IS NULL AND legacy_accepted_at IS NULL
    AND legacy_acceptance_reason IS NULL AND legacy_acceptance_evidence_digest IS NULL
  )
  OR (migrated_from_legacy = true AND status = 'SUCCEEDED'
    AND provider IS NULL AND provider_payment_object_type IS NULL AND provider_payment_object_id IS NULL
    AND provider_endpoint_key IS NULL AND amount_minor IS NULL AND currency IS NULL
    AND idempotency_key IS NULL AND request_fingerprint IS NULL AND canonical_request_version IS NULL
    AND outbound_started_at IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL
    AND reconcile_not_before IS NULL AND provider_status IS NULL AND provider_refund_ref IS NULL
    AND error_classification IS NULL AND ambiguous = false AND completed_at IS NOT NULL
    AND superseded_by_attempt_id IS NULL
    AND legacy_wallet_entry_id IS NOT NULL AND legacy_payment_event_id IS NULL
    AND legacy_accepted_by_user_id IS NULL AND legacy_accepted_at IS NULL
    AND legacy_acceptance_reason IS NULL AND legacy_acceptance_evidence_digest IS NULL
  )
  OR (migrated_from_legacy = true AND status = 'LEGACY_PENDING_CONFIRMATION'
    AND provider IS NULL AND provider_payment_object_type IS NULL AND provider_payment_object_id IS NULL
    AND provider_endpoint_key IS NULL AND amount_minor IS NULL AND currency IS NULL
    AND idempotency_key IS NULL AND request_fingerprint IS NULL AND canonical_request_version IS NULL
    AND outbound_started_at IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL
    AND reconcile_not_before IS NULL AND provider_status IS NULL AND provider_refund_ref IS NULL
    AND error_classification IS NULL AND ambiguous = false AND completed_at IS NOT NULL
    AND legacy_wallet_entry_id IS NULL AND legacy_payment_event_id IS NOT NULL
    AND legacy_accepted_by_user_id IS NULL AND legacy_accepted_at IS NULL
    AND legacy_acceptance_reason IS NULL AND legacy_acceptance_evidence_digest IS NULL
  )
  OR (migrated_from_legacy = true AND status = 'LEGACY_ACCOUNTING_ACCEPTED'
    AND provider IS NULL AND provider_payment_object_type IS NULL AND provider_payment_object_id IS NULL
    AND provider_endpoint_key IS NULL AND amount_minor IS NULL AND currency IS NULL
    AND idempotency_key IS NULL AND request_fingerprint IS NULL AND canonical_request_version IS NULL
    AND outbound_started_at IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL
    AND reconcile_not_before IS NULL AND provider_status IS NULL AND provider_refund_ref IS NULL
    AND error_classification IS NULL AND ambiguous = false AND completed_at IS NOT NULL
    AND superseded_by_attempt_id IS NULL
    AND legacy_wallet_entry_id IS NULL AND legacy_payment_event_id IS NOT NULL
    AND legacy_accepted_by_user_id IS NOT NULL AND legacy_accepted_at IS NOT NULL
    AND legacy_acceptance_reason IS NOT NULL AND legacy_acceptance_evidence_digest IS NOT NULL
  )
);

ALTER TABLE refund_attempts ADD CONSTRAINT refund_attempt_legacy_acceptance_reason_bounded
  CHECK (legacy_acceptance_reason IS NULL OR (length(legacy_acceptance_reason) BETWEEN 1 AND 2000));
ALTER TABLE refund_attempts ADD CONSTRAINT refund_attempt_legacy_acceptance_digest_shape
  CHECK (legacy_acceptance_evidence_digest IS NULL OR legacy_acceptance_evidence_digest ~ '^[0-9a-f]{64}$');

-- Exactly one non-terminal attempt per refund.
CREATE UNIQUE INDEX refund_attempts_one_active_per_refund ON refund_attempts (refund_id)
  WHERE status IN ('CLAIMED','OUTBOUND_STARTED','AWAITING_PROVIDER_CONFIRMATION','RESULT_UNKNOWN','RECONCILING');

-- ============================================================================
-- 6. Triggers
-- ============================================================================

-- A REAL, database-enforced "set at most once" invariant for superseded_by_attempt_id -- an
-- earlier design revision claimed a guarded UPDATE ("WHERE superseded_by_attempt_id IS NULL")
-- alone made this a database-enforced guarantee; independent review correctly found that only
-- protects callers using that exact statement, not the invariant itself. This trigger rejects ANY
-- change to an already-non-null value, regardless of which statement attempts it.
CREATE OR REPLACE FUNCTION refund_attempt_supersession_once() RETURNS trigger AS $$
BEGIN
  IF OLD.superseded_by_attempt_id IS NOT NULL AND NEW.superseded_by_attempt_id IS DISTINCT FROM OLD.superseded_by_attempt_id THEN
    RAISE EXCEPTION 'refund_attempts.superseded_by_attempt_id may be set at most once (attempt %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refund_attempt_supersession_once_trg
  BEFORE UPDATE ON refund_attempts
  FOR EACH ROW EXECUTE FUNCTION refund_attempt_supersession_once();

-- Protects every canonical-request field AND every legacy-acceptance/evidence-linkage field, once
-- set, from ever being rewritten by any future UPDATE -- database-enforced, not only asserted by
-- application discipline plus a request-fingerprint re-check.
CREATE OR REPLACE FUNCTION refund_attempt_immutable_fields() RETURNS trigger AS $$
BEGIN
  IF NEW.refund_id IS DISTINCT FROM OLD.refund_id
     OR NEW.canonical_request_version IS DISTINCT FROM OLD.canonical_request_version
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_payment_object_type IS DISTINCT FROM OLD.provider_payment_object_type
     OR NEW.provider_payment_object_id IS DISTINCT FROM OLD.provider_payment_object_id
     OR NEW.provider_endpoint_key IS DISTINCT FROM OLD.provider_endpoint_key
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.legacy_accepted_by_user_id IS DISTINCT FROM OLD.legacy_accepted_by_user_id
     OR NEW.legacy_accepted_at IS DISTINCT FROM OLD.legacy_accepted_at
     OR NEW.legacy_acceptance_reason IS DISTINCT FROM OLD.legacy_acceptance_reason
     OR NEW.legacy_acceptance_evidence_digest IS DISTINCT FROM OLD.legacy_acceptance_evidence_digest
     OR NEW.legacy_payment_event_id IS DISTINCT FROM OLD.legacy_payment_event_id
     OR NEW.legacy_wallet_entry_id IS DISTINCT FROM OLD.legacy_wallet_entry_id
  THEN
    RAISE EXCEPTION 'refund_attempts: this field is immutable once set (attempt %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refund_attempt_immutable_fields_trg
  BEFORE UPDATE ON refund_attempts
  FOR EACH ROW EXECUTE FUNCTION refund_attempt_immutable_fields();

-- ============================================================================
-- 7. Append-only enforcement for the observation/consumption pair (round 2 correction)
-- ============================================================================
--
-- Round 1 asserted these two tables were "genuinely append-only" in comments only ("no column
-- here is ever UPDATEd", "we never issue UPDATE") -- independent review correctly rejected this as
-- the exact same "immutable in prose, not in the database" mistake the design phase (Revision 9->10)
-- already caught and fixed for refund_attempts. Fixed here with real, unconditional
-- BEFORE UPDATE / BEFORE DELETE triggers on both tables -- there is no legitimate application path
-- that ever needs to update or delete a row in either table, so both operations are rejected
-- outright, not merely discouraged by convention.
CREATE OR REPLACE FUNCTION reject_all_mutations() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted on this table (row %)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refund_provider_observations_append_only_upd_trg
  BEFORE UPDATE ON refund_provider_observations
  FOR EACH ROW EXECUTE FUNCTION reject_all_mutations();
CREATE TRIGGER refund_provider_observations_append_only_del_trg
  BEFORE DELETE ON refund_provider_observations
  FOR EACH ROW EXECUTE FUNCTION reject_all_mutations();

CREATE TRIGGER refund_observation_consumptions_append_only_upd_trg
  BEFORE UPDATE ON refund_observation_consumptions
  FOR EACH ROW EXECUTE FUNCTION reject_all_mutations();
CREATE TRIGGER refund_observation_consumptions_append_only_del_trg
  BEFORE DELETE ON refund_observation_consumptions
  FOR EACH ROW EXECUTE FUNCTION reject_all_mutations();

COMMIT;
