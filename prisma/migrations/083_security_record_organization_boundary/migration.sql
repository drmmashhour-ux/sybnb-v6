-- STEP 5H (migration 083) -- ORGANIZATION BOUNDARY FOR SECURITY / AUDIT / EVIDENCE RECORDS. ADDITIVE ONLY.
-- PREPARED, NOT APPLIED. Review it, then apply it through the normal release process.
--
-- Problem: admin_audit_logs, security_events and authorization_evidence had no organization, so the Security Center and
-- Audit Center routes could only query them globally (an admin authorized for organization A could read organization B).
--
-- Change:
--   * nullable "organization_id" on the three tables, foreign key to organizations (ON DELETE RESTRICT), supporting index.
--   * NULL means UNATTRIBUTED. Every row that exists when this migration runs stays NULL: no organization can be proved
--     for it from the data (an actor or subject user may hold scopes in several organizations), so the routes treat it as
--     visible to NOBODY (fail closed). There is deliberately NO backfill here.
--   * guards: the column is write-once. admin_audit_logs and security_events may have it set while it is NULL (a reviewed,
--     operator-run attribution of legacy rows, see below) but never changed afterwards. authorization_evidence is fully
--     append-only (existing trigger), so its legacy rows can never be attributed; new evidence carries the organization
--     and, when present, the organization is part of the row hash.
--
-- Optional, operator-run, NOT part of this migration: in a deployment that has only ever had ONE organization, legacy
-- audit / security rows may be attributed to it after review, for example
--     UPDATE admin_audit_logs SET organization_id = '<the organization id>' WHERE organization_id IS NULL;
--     UPDATE security_events  SET organization_id = '<the organization id>' WHERE organization_id IS NULL;
-- Never run that where more than one organization exists or may have existed.

ALTER TABLE "admin_audit_logs"       ADD COLUMN "organization_id" UUID;
ALTER TABLE "security_events"        ADD COLUMN "organization_id" UUID;
ALTER TABLE "authorization_evidence" ADD COLUMN "organization_id" UUID;

ALTER TABLE "admin_audit_logs"       ADD CONSTRAINT "admin_audit_logs_organization_id_fkey"       FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "security_events"        ADD CONSTRAINT "security_events_organization_id_fkey"        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "authorization_evidence" ADD CONSTRAINT "authorization_evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "admin_audit_logs_org_idx"       ON "admin_audit_logs"       ("organization_id", "created_at");
CREATE INDEX "security_events_org_idx"        ON "security_events"        ("organization_id", "created_at");
CREATE INDEX "authorization_evidence_org_idx" ON "authorization_evidence" ("organization_id", "sequence");

-- Guards: same rules as before (migration 078 / 081) plus "organization_id is write-once".
CREATE OR REPLACE FUNCTION admin_audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admin_audit_logs is append-only (DELETE refused)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW."before" IS DISTINCT FROM OLD."before"
     OR NEW."after" IS DISTINCT FROM OLD."after"
     OR NEW.ip_hash IS DISTINCT FROM OLD.ip_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.platform_code IS DISTINCT FROM OLD.platform_code
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR (NEW.organization_id IS DISTINCT FROM OLD.organization_id AND OLD.organization_id IS NOT NULL)
     OR (NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id AND NEW.actor_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'admin_audit_logs is append-only (UPDATE refused)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'security_events are never deleted' USING ERRCODE = 'restrict_violation'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.severity IS DISTINCT FROM OLD.severity OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
     OR NEW.summary IS DISTINCT FROM OLD.summary OR NEW.detail IS DISTINCT FROM OLD.detail OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.audit_event_id IS DISTINCT FROM OLD.audit_event_id
     OR NEW.retention_category IS DISTINCT FROM OLD.retention_category
     OR (NEW.organization_id IS DISTINCT FROM OLD.organization_id AND OLD.organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'security_events content is immutable (only review columns may change)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
