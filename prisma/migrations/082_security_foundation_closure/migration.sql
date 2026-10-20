-- STEP 5B (migration 082) -- closes the Step 5A gaps. ADDITIVE ONLY. (Hardened in STEP 5D before it was ever applied
-- to production: full referential integrity, strict REQUIRED shape, guaranteed per-organization provisioning, and a
-- mandatory evidence ruleset_version with an explicit legacy value. The migration is one transaction: it either
-- applies completely or not at all.)
--  * security_bootstrap: explicit one-time Owner bootstrap state machine per organization
--    (SECURITY_BOOTSTRAP_REQUIRED -> SECURITY_BOOTSTRAP_COMPLETED). COMPLETED is terminal, enforced by the database.
--  * authorization_evidence.ruleset_version: which permission rule set (noSelf, tiers, high-risk) was applied.
--    NOT NULL; every row that exists when this migration runs predates rule-set versioning and is marked
--    'LEGACY_PRE_VERSIONED' (never a modern version). New evidence must carry a real version (CHECK + writer).
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
  -- REQUIRED must not look partially completed: every completion-only field is NULL (reason and the workflow
  -- explanation are written only by the completing transaction). COMPLETED must be fully populated.
  CONSTRAINT "security_bootstrap_shape_chk" CHECK (
    (state = 'SECURITY_BOOTSTRAP_REQUIRED'
        AND completed_at IS NULL AND completed_by_id IS NULL AND target_user_id IS NULL
        AND old_assignment_id IS NULL AND new_assignment_id IS NULL AND old_role_version_id IS NULL AND new_role_version_id IS NULL
        AND reason IS NULL AND workflow_unavailable_reason IS NULL
        AND security_event_id IS NULL AND audit_event_id IS NULL AND evidence_id IS NULL)
    OR (state = 'SECURITY_BOOTSTRAP_COMPLETED' AND completed_at IS NOT NULL AND completed_by_id IS NOT NULL AND target_user_id = completed_by_id
        AND old_assignment_id IS NOT NULL AND new_assignment_id IS NOT NULL AND old_role_version_id IS NOT NULL AND new_role_version_id IS NOT NULL
        AND reason IS NOT NULL AND workflow_unavailable_reason IS NOT NULL
        AND security_event_id IS NOT NULL AND audit_event_id IS NOT NULL AND evidence_id IS NOT NULL)
  )
);
-- Referential integrity (5D): bootstrap is permanent security evidence, so EVERY reference is RESTRICT/RESTRICT:
-- the referenced organization, person, assignment, role version, security event, audit row and evidence row can
-- neither be deleted nor have their id changed while the bootstrap record points at them. This matches the
-- existing policy of the referenced tables (role_assignments -> users/role_versions are RESTRICT; audit, evidence,
-- security events and role versions/assignments are append-only by trigger). There is no cycle: none of the
-- referenced tables references security_bootstrap, and the completing transaction creates the event, audit and
-- evidence rows BEFORE it updates the bootstrap row to COMPLETED.
ALTER TABLE "security_bootstrap"
  ADD CONSTRAINT "security_bootstrap_organization_id_fkey"    FOREIGN KEY ("organization_id")      REFERENCES "organizations"("id")           ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_completed_by_id_fkey"    FOREIGN KEY ("completed_by_id")      REFERENCES "users"("id")                   ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_target_user_id_fkey"     FOREIGN KEY ("target_user_id")       REFERENCES "users"("id")                   ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_old_assignment_id_fkey"  FOREIGN KEY ("old_assignment_id")    REFERENCES "role_assignments"("id")        ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_new_assignment_id_fkey"  FOREIGN KEY ("new_assignment_id")    REFERENCES "role_assignments"("id")        ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_old_role_version_id_fkey" FOREIGN KEY ("old_role_version_id") REFERENCES "role_versions"("id")           ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_new_role_version_id_fkey" FOREIGN KEY ("new_role_version_id") REFERENCES "role_versions"("id")           ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_security_event_id_fkey"  FOREIGN KEY ("security_event_id")    REFERENCES "security_events"("id")         ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_audit_event_id_fkey"     FOREIGN KEY ("audit_event_id")       REFERENCES "admin_audit_logs"("id")        ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "security_bootstrap_evidence_id_fkey"        FOREIGN KEY ("evidence_id")          REFERENCES "authorization_evidence"("id")  ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "security_bootstrap_completed_by_id_idx" ON "security_bootstrap" ("completed_by_id");

-- One-way door: rows are created REQUIRED, may move to COMPLETED exactly once, and are never changed or deleted again.
CREATE OR REPLACE FUNCTION security_bootstrap_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'SECURITY_BOOTSTRAP_REQUIRED' THEN RAISE EXCEPTION 'security_bootstrap rows are created in the REQUIRED state' USING ERRCODE = 'restrict_violation'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- A COMPLETED row is permanent evidence. A REQUIRED row holds no evidence and may only disappear together
    -- with its (evidence-free) organization, via organizations_bootstrap_cleanup below.
    IF OLD.state = 'SECURITY_BOOTSTRAP_COMPLETED' OR COALESCE(current_setting('sybnb.org_delete', true), '') <> OLD.organization_id::text THEN
      RAISE EXCEPTION 'security_bootstrap rows are never deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state = 'SECURITY_BOOTSTRAP_COMPLETED' THEN RAISE EXCEPTION 'owner bootstrap is permanently closed' USING ERRCODE = 'restrict_violation'; END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'organization_id is immutable' USING ERRCODE = 'restrict_violation'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER security_bootstrap_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "security_bootstrap"
  FOR EACH ROW EXECUTE FUNCTION security_bootstrap_guard();
CREATE TRIGGER security_bootstrap_retention_trg BEFORE UPDATE ON "security_bootstrap"
  FOR EACH ROW EXECUTE FUNCTION retention_no_shorten();

-- GUARANTEED PROVISIONING (5D): the database creates the REQUIRED row in the SAME transaction as the organization,
-- whatever code path inserts it (service, script, seed, manual SQL). Organization and bootstrap state cannot
-- become inconsistent, and no repair job or seed is needed. ON CONFLICT DO NOTHING keeps explicit inserts harmless.
CREATE OR REPLACE FUNCTION organizations_bootstrap_provision() RETURNS trigger AS $$
BEGIN
  INSERT INTO "security_bootstrap" ("organization_id") VALUES (NEW.id) ON CONFLICT ("organization_id") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_bootstrap_provision_trg AFTER INSERT ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION organizations_bootstrap_provision();

-- Deleting an organization removes ONLY a still-REQUIRED (evidence-free) row. For a COMPLETED organization the
-- guard raises, and the RESTRICT foreign key would refuse anyway, so completed bootstrap evidence is never lost.
CREATE OR REPLACE FUNCTION organizations_bootstrap_cleanup() RETURNS trigger AS $$
BEGIN
  PERFORM set_config('sybnb.org_delete', OLD.id::text, true);
  DELETE FROM "security_bootstrap" WHERE "organization_id" = OLD.id;
  PERFORM set_config('sybnb.org_delete', '', true);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_bootstrap_cleanup_trg BEFORE DELETE ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION organizations_bootstrap_cleanup();

-- Every organization that exists today starts in REQUIRED.
INSERT INTO "security_bootstrap" ("organization_id") SELECT "id" FROM "organizations" ON CONFLICT ("organization_id") DO NOTHING;

-- ADD COLUMN ... DEFAULT fills existing rows without firing the append-only trigger and without rewriting any hashed
-- field: the chain still verifies because the hash ignores the legacy marker (see server/lib/authz/evidence.mjs).
ALTER TABLE "authorization_evidence" ADD COLUMN "ruleset_version" TEXT NOT NULL DEFAULT 'LEGACY_PRE_VERSIONED';
ALTER TABLE "authorization_evidence" ALTER COLUMN "ruleset_version" DROP DEFAULT;
ALTER TABLE "authorization_evidence" ADD CONSTRAINT "authorization_evidence_ruleset_version_chk" CHECK (length(btrim("ruleset_version")) > 0);
ALTER TABLE "security_events" ADD COLUMN "delivery" JSONB NOT NULL DEFAULT '{}';
