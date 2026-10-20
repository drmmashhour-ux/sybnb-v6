-- STEP 5A -- security reconciliation with the locked management decisions 3A-4, 3A-6 and 3A-10.
-- ADDITIVE except one controlled in-place rename of permission codes (see section 1). Test database
-- first; production is applied by the owner after review.

-- ---------------------------------------------------------------------------------------------
-- 1. Canonical permission codes. Renamed IN PLACE (same row and id) so role-version membership,
--    assignments and evidence references stay intact; the legacy name is kept in an alias table so
--    historical evidence written under the old name remains queryable. The immutability trigger is
--    disabled ONLY for this statement, inside this migration.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "permission_definitions" DROP CONSTRAINT "permission_definitions_code_chk";
ALTER TABLE "permission_definitions" ADD CONSTRAINT "permission_definitions_code_chk" CHECK (code ~ '^[a-z_]+(\.[a-z_]+){1,2}$');

CREATE TABLE "permission_code_aliases" (
  "legacy_code" TEXT NOT NULL,
  "permission_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "permission_code_aliases_pkey" PRIMARY KEY ("legacy_code"),
  CONSTRAINT "permission_code_aliases_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "permission_code_aliases_permission_id_idx" ON "permission_code_aliases" ("permission_id");

ALTER TABLE "permission_definitions" DISABLE TRIGGER permission_definitions_guard_trg;
WITH m(legacy, canonical, area, resource, action) AS (VALUES
  ('admin.console.access', 'console.access', 'console', 'console', 'access'),
  ('search.global.use', 'search.use', 'search', 'search', 'use'),
  ('notification.own.read', 'notification.view_own', 'notification', 'notification', 'view_own'),
  ('report.directory.read', 'report.view', 'report', 'report', 'view'),
  ('ai.controller.read', 'ai.view', 'ai', 'ai', 'view'),
  ('fin.shell.read', 'finance.view', 'finance', 'finance', 'view'),
  ('tax.shell.read', 'tax.view', 'tax', 'tax', 'view'),
  ('acct.center.read', 'accountant.view', 'accountant', 'accountant', 'view'),
  ('cfg.settings.read', 'config.view', 'config', 'config', 'view'),
  ('cfg.settings.write', 'config.manage', 'config', 'config', 'manage'),
  ('platform.shell.read', 'platform.view', 'platform', 'platform', 'view'),
  ('platform.registry.manage', 'platform.manage', 'platform', 'platform', 'manage'),
  ('platform.health.read', 'platform_health.view', 'platform_health', 'platform_health', 'view'),
  ('work.item.read', 'work.view', 'work', 'work', 'view'),
  ('work.item.manage', 'work.manage', 'work', 'work', 'manage'),
  ('approval.request.read', 'approval.view', 'approval', 'approval', 'view'),
  ('approval.request.decide', 'approval.decide', 'approval', 'approval', 'decide'),
  ('party.party.read', 'party.view', 'party', 'party', 'view'),
  ('party.party.write', 'party.manage', 'party', 'party', 'manage'),
  ('party.contact.read_sensitive', 'party.contact_sensitive.view', 'party', 'contact_sensitive', 'view'),
  ('doc.document.read', 'document.view', 'document', 'document', 'view'),
  ('doc.document.upload', 'document.upload', 'document', 'document', 'upload'),
  ('doc.document.review', 'document.review', 'document', 'document', 'review'),
  ('doc.document.download', 'document.download', 'document', 'document', 'download'),
  ('support.case.read', 'support.view', 'support', 'support', 'view'),
  ('support.case.write', 'support.manage', 'support', 'support', 'manage'),
  ('support.note.internal', 'support.note_internal', 'support', 'support', 'note_internal'),
  ('comment.internal.write', 'comment.write', 'comment', 'comment', 'write'),
  ('iam.user.read', 'user.view', 'user', 'user', 'view'),
  ('iam.user.suspend', 'user.suspend', 'user', 'user', 'suspend'),
  ('iam.role.read', 'role.view', 'role', 'role', 'view'),
  ('iam.role.manage', 'role.manage', 'role', 'role', 'manage'),
  ('iam.role_assignment.read', 'access.view', 'access', 'access', 'view'),
  ('iam.role_assignment.assign', 'access.assign', 'access', 'access', 'assign'),
  ('iam.session.read_own', 'session.view_own', 'session', 'session', 'view_own'),
  ('iam.session.revoke_own', 'session.revoke_own', 'session', 'session', 'revoke_own'),
  ('iam.session.read_org', 'session.view', 'session', 'session', 'view'),
  ('iam.session.revoke_org', 'session.revoke', 'session', 'session', 'revoke'),
  ('iam.service_account.read', 'service_account.view', 'service_account', 'service_account', 'view'),
  ('iam.service_account.disable', 'service_account.disable', 'service_account', 'service_account', 'disable'),
  ('sec.event.read', 'security_event.view', 'security_event', 'security_event', 'view'),
  ('sec.settings.manage', 'security.manage', 'security', 'security', 'manage'),
  ('sec.break_glass.activate', 'break_glass.use', 'break_glass', 'break_glass', 'use'),
  ('audit.event.read', 'audit.view', 'audit', 'audit', 'view'),
  ('audit.event.export', 'audit.export', 'audit', 'audit', 'export'),
  ('audit.evidence.read', 'audit.evidence.view', 'audit', 'evidence', 'view')
), renamed AS (
  UPDATE "permission_definitions" d SET code = m.canonical, area = m.area, resource = m.resource, action = m.action
  FROM m WHERE d.code = m.legacy
  RETURNING d.id, m.legacy
)
INSERT INTO "permission_code_aliases" (legacy_code, permission_id) SELECT legacy, id FROM renamed;
ALTER TABLE "permission_definitions" ENABLE TRIGGER permission_definitions_guard_trg;

CREATE OR REPLACE FUNCTION admin_append_only_aliases() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'permission_code_aliases is append-only' USING ERRCODE = 'restrict_violation'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER permission_code_aliases_append_only_trg BEFORE UPDATE OR DELETE ON "permission_code_aliases"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only_aliases();

-- ---------------------------------------------------------------------------------------------
-- 2. High-risk privilege lifecycle and the 48-hour activation delay (3A-4).
--    REQUESTED = PENDING_APPROVAL. New states: UNDER_REVIEW (security review passed, awaiting Owner
--    approval), PENDING_ACTIVATION (approved; usable only from activation_at), REJECTED.
-- ---------------------------------------------------------------------------------------------
ALTER TYPE "role_assignment_status" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "role_assignment_status" ADD VALUE IF NOT EXISTS 'PENDING_ACTIVATION';
ALTER TYPE "role_assignment_status" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "role_assignments"
  ADD COLUMN "activation_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_id" UUID,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "retention_category" TEXT NOT NULL DEFAULT 'PRIVILEGED_ACCESS',
  ADD COLUMN "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years');

-- ---------------------------------------------------------------------------------------------
-- 3. Retention metadata (3A-6): minimum 7 years, longer by policy per category. No purge job exists.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "retention_policies" (
  "category" TEXT NOT NULL,
  "min_years" INTEGER NOT NULL,
  "years" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("category"),
  CONSTRAINT "retention_policies_floor_chk" CHECK (min_years >= 7 AND years >= min_years)
);
INSERT INTO "retention_policies" (category, min_years, years, description) VALUES
  ('AUTHORIZATION_EVIDENCE', 7, 7, 'Authorization decision snapshots, MFA/step-up and approval authorization evidence.'),
  ('SECURITY_EVENT', 7, 7, 'Security events of every severity.'),
  ('PRIVILEGED_ACCESS', 7, 7, 'Role assignments, scope assignments, temporary privilege and delegation records.'),
  ('ROLE_HISTORY', 7, 7, 'Role versions and their permission membership.'),
  ('ACCESS_APPROVAL', 7, 7, 'Access approval and review records.'),
  ('BREAK_GLASS', 7, 7, 'Break-glass requests, use and review.'),
  ('USER_SUSPENSION', 7, 7, 'Suspension and reactivation records.'),
  ('AUDIT', 7, 7, 'Administrative audit events.');

CREATE OR REPLACE FUNCTION retention_policies_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'retention_policies rows are never deleted' USING ERRCODE = 'restrict_violation'; END IF;
  IF NEW.min_years < OLD.min_years THEN RAISE EXCEPTION 'the retention floor cannot be lowered' USING ERRCODE = 'restrict_violation'; END IF;
  IF NEW.years < OLD.years THEN RAISE EXCEPTION 'retention can be lengthened, never shortened' USING ERRCODE = 'restrict_violation'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER retention_policies_guard_trg BEFORE UPDATE OR DELETE ON "retention_policies"
  FOR EACH ROW EXECUTE FUNCTION retention_policies_guard();

CREATE OR REPLACE FUNCTION retention_no_shorten() RETURNS trigger AS $$
BEGIN
  IF NEW.retain_until < OLD.retain_until THEN
    RAISE EXCEPTION 'retain_until can be extended, never shortened' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER role_assignments_retention_trg BEFORE UPDATE ON "role_assignments"
  FOR EACH ROW EXECUTE FUNCTION retention_no_shorten();

ALTER TABLE "authorization_evidence" ADD COLUMN "retention_category" TEXT NOT NULL DEFAULT 'AUTHORIZATION_EVIDENCE', ADD COLUMN "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years');
ALTER TABLE "role_assignment_events" ADD COLUMN "retention_category" TEXT NOT NULL DEFAULT 'PRIVILEGED_ACCESS', ADD COLUMN "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years');
ALTER TABLE "role_versions" ADD COLUMN "retention_category" TEXT NOT NULL DEFAULT 'ROLE_HISTORY', ADD COLUMN "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years');
ALTER TABLE "admin_audit_logs" ADD COLUMN "retention_category" TEXT NOT NULL DEFAULT 'AUDIT', ADD COLUMN "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years');
CREATE TRIGGER role_versions_retention_trg BEFORE UPDATE ON "role_versions"
  FOR EACH ROW EXECUTE FUNCTION retention_no_shorten();

-- ---------------------------------------------------------------------------------------------
-- 4. Security events (severity INFO / WARNING / HIGH / CRITICAL). Not the same thing as an audit
--    event: both are produced for privileged actions. Append-only except the review columns.
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "security_event_severity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
CREATE TYPE "security_event_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'REVIEWED');

CREATE TABLE "security_events" (
  "id" UUID NOT NULL,
  "severity" "security_event_severity" NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_user_id" UUID,
  "subject_user_id" UUID,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "summary" TEXT NOT NULL,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "correlation_id" TEXT,
  "audit_event_id" UUID,
  "notified_count" INTEGER NOT NULL DEFAULT 0,
  "status" "security_event_status" NOT NULL DEFAULT 'OPEN',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "retention_category" TEXT NOT NULL DEFAULT 'SECURITY_EVENT',
  "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "security_events_severity_created_at_idx" ON "security_events" ("severity", "created_at");
CREATE INDEX "security_events_status_created_at_idx" ON "security_events" ("status", "created_at");
CREATE INDEX "security_events_subject_user_id_idx" ON "security_events" ("subject_user_id");
CREATE INDEX "security_events_correlation_id_idx" ON "security_events" ("correlation_id");

CREATE OR REPLACE FUNCTION security_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'security_events are never deleted' USING ERRCODE = 'restrict_violation'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.severity IS DISTINCT FROM OLD.severity OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
     OR NEW.summary IS DISTINCT FROM OLD.summary OR NEW.detail IS DISTINCT FROM OLD.detail OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.audit_event_id IS DISTINCT FROM OLD.audit_event_id
     OR NEW.retention_category IS DISTINCT FROM OLD.retention_category THEN
    RAISE EXCEPTION 'security_events content is immutable (only review columns may change)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER security_events_guard_trg BEFORE UPDATE OR DELETE ON "security_events"
  FOR EACH ROW EXECUTE FUNCTION security_events_guard();
CREATE TRIGGER security_events_retention_trg BEFORE UPDATE ON "security_events"
  FOR EACH ROW EXECUTE FUNCTION retention_no_shorten();

-- ---------------------------------------------------------------------------------------------
-- 5. Suspension records (standard and emergency) and their separate reactivation.
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "user_suspension_kind" AS ENUM ('STANDARD', 'EMERGENCY');

CREATE TABLE "user_suspensions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" "user_suspension_kind" NOT NULL,
  "reason" TEXT NOT NULL,
  "suspended_by_id" UUID NOT NULL,
  "suspended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "prior_status" TEXT NOT NULL,
  "sessions_revoked" INTEGER NOT NULL DEFAULT 0,
  "assignments_snapshot" JSONB NOT NULL DEFAULT '[]',
  "security_event_id" UUID,
  "correlation_id" TEXT,
  "reactivated_at" TIMESTAMP(3),
  "reactivated_by_id" UUID,
  "reactivation_reason" TEXT,
  "reactivation_security_event_id" UUID,
  "retention_category" TEXT NOT NULL DEFAULT 'USER_SUSPENSION',
  "retain_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
  CONSTRAINT "user_suspensions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_suspensions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "user_suspensions_user_id_suspended_at_idx" ON "user_suspensions" ("user_id", "suspended_at");

CREATE OR REPLACE FUNCTION user_suspensions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'user_suspensions are never deleted' USING ERRCODE = 'restrict_violation'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.suspended_by_id IS DISTINCT FROM OLD.suspended_by_id
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at OR NEW.prior_status IS DISTINCT FROM OLD.prior_status
     OR NEW.assignments_snapshot IS DISTINCT FROM OLD.assignments_snapshot THEN
    RAISE EXCEPTION 'user_suspensions facts are immutable (only the reactivation columns may be set, once)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.reactivated_at IS NOT NULL THEN RAISE EXCEPTION 'a suspension can be reactivated only once' USING ERRCODE = 'restrict_violation'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_suspensions_guard_trg BEFORE UPDATE OR DELETE ON "user_suspensions"
  FOR EACH ROW EXECUTE FUNCTION user_suspensions_guard();
CREATE TRIGGER user_suspensions_retention_trg BEFORE UPDATE ON "user_suspensions"
  FOR EACH ROW EXECUTE FUNCTION retention_no_shorten();
