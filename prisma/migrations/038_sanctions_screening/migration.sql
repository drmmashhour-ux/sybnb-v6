-- Architecture audit follow-up (Module 2.1). Real scaffolding for a sanctions-screening gate,
-- provider-agnostic: this table and its status enum say nothing about what "compliant" means for
-- any particular market, and no code in this migration or its accompanying module encodes any
-- specific claim about current Canadian sanctions policy toward Syria -- that determination
-- belongs to counsel (see countries/syria/profile.mjs's externalGates, which already names this
-- review as required and unconfirmed). This is purely additive and, on its own, changes no
-- runtime behavior: nothing calls into this table yet.
--
-- SYSTEM_ERROR is the enum's default specifically so a row inserted without an explicit status
-- (a bug, an interrupted write) reads as "unresolved," never as a silent pass.
CREATE TYPE sanctions_screening_status AS ENUM ('CLEARED', 'POTENTIAL_MATCH', 'HARD_MATCH', 'SYSTEM_ERROR');

CREATE TABLE sanctions_screening_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL UNIQUE,
  -- Loose subject reference (entityType/entityId style, matching admin_audit_logs) rather than a
  -- hard FK to users -- a screening subject may be a listing owner, a payout recipient, or a
  -- future non-user party, and this table should never need a schema change to log about a new
  -- kind of subject.
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  full_name_checked text NOT NULL,
  country_code text NOT NULL,
  status sanctions_screening_status NOT NULL DEFAULT 'SYSTEM_ERROR',
  match_score double precision NOT NULL DEFAULT 0,
  provider_used text NOT NULL,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sanctions_screening_results_subject_idx ON sanctions_screening_results(subject_type, subject_id);
CREATE INDEX sanctions_screening_results_status_idx ON sanctions_screening_results(status);
