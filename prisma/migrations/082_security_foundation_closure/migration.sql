-- STEP 5B (migration 082) -- closes the Step 5A gaps. ADDITIVE ONLY.
--  * security_bootstrap: explicit one-time Owner bootstrap state machine per organization
--    (SECURITY_BOOTSTRAP_REQUIRED -> SECURITY_BOOTSTRAP_COMPLETED). COMPLETED is terminal, enforced by the database.
--  * authorization_evidence.ruleset_version: which permission rule set (noSelf, tiers, high-risk) was applied.
--  * security_events.delivery: per-transport notification delivery results (the event never depends on delivery).

CREATE TABLE "security_bootstrap" (
  "organization_id" UUID NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'SECURITY_BOOTSTRAP_REQUIRED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "completed_by_id" UUID,
  "target_user_id" UUID,
  "old_assignment_id" UUID,
  "new_assignment_id" UUID,
  "old_role_version_id" UUID,
  "new_role_version_id" UUID,
  "reason" TEXT,
  "workflow_unavailable_reason" TEXT,
  "security_event_id" UUID,
  "audit_event_id" UUID,
  "evidence_id" UUID,
  "retention_category" TEXT NOT NULL DEFAULT 'PRIVILEGED_ACCESS',
  "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
  CONSTRAINT "security_bootstrap_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "security_bootstrap_state_chk" CHECK (state IN ('SECURITY_BOOTSTRAP_REQUIRED', 'SECURITY_BOOTSTRAP_COMPLETED')),
  CONSTRAINT "security_bootstrap_shape_chk" CHECK (
    (state = 'SECURITY_BOOTSTRAP_REQUIRED' AND completed_at IS NULL AND new_assignment_id IS NULL)
    OR (state = 'SECURITY_BOOTSTRAP_COMPLETED' AND completed_at IS NOT NULL AND completed_by_id IS NOT NULL AND target_user_id = completed_by_id
        AND old_assignment_id IS NOT NULL AND new_assignment_id IS NOT NULL AND old_role_version_id IS NOT NULL AND new_role_version_id IS NOT NULL
        AND reason IS NOT NULL AND security_event_id IS NOT NULL AND audit_event_id IS NOT NULL AND evidence_id IS NOT NULL)
  )
);
ALTER TABLE "security_bootstrap" ADD CONSTRAINT "security_bootstrap_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One-way door: rows are created REQUIRED, may move to COMPLETED exactly once, and are never changed or deleted again.
CREATE OR REPLACE FUNCTION security_bootstrap_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'SECURITY_BOOTSTRAP_REQUIRED' THEN RAISE EXCEPTION 'security_bootstrap rows are created in the REQUIRED state' USING ERRCODE = 'restrict_violation'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'security_bootstrap rows are never deleted' USING ERRCODE = 'restrict_violation'; END IF;
  IF OLD.state = 'SECURITY_BOOTSTRAP_COMPLETED' THEN RAISE EXCEPTION 'owner bootstrap is permanently closed' USING ERRCODE = 'restrict_violation'; END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'organization_id is immutable' USING ERRCODE = 'restrict_violation'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER security_bootstrap_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "security_bootstrap"
  FOR EACH ROW EXECUTE FUNCTION security_bootstrap_guard();
CREATE TRIGGER security_bootstrap_retention_trg BEFORE UPDATE ON "security_bootstrap"
  FOR EACH ROW EXECUTE FUNCTION retention_no_shorten();

-- Every organization that exists today starts in REQUIRED. (Organizations created later get a row from the seed
-- or by explicit insert; the row can never be created in the COMPLETED state.)
INSERT INTO "security_bootstrap" ("organization_id") SELECT "id" FROM "organizations";

ALTER TABLE "authorization_evidence" ADD COLUMN "ruleset_version" TEXT;
ALTER TABLE "security_events" ADD COLUMN "delivery" JSONB NOT NULL DEFAULT '{}';
