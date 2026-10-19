-- Step 5 admin foundation (Step 3A model). Additive only: no existing table is altered except
-- admin_audit_logs gaining nullable columns. Legacy user_roles is untouched.

-- CreateEnum
CREATE TYPE "admin_entity_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "platform_status" AS ENUM ('ACTIVE', 'SETUP', 'DEGRADED', 'DISABLED', 'NO_DATA');

-- CreateEnum
CREATE TYPE "role_status" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "role_version_status" AS ENUM ('DRAFT', 'IN_SECURITY_REVIEW', 'APPROVED', 'EFFECTIVE', 'SUPERSEDED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "role_version_classification" AS ENUM ('INITIAL', 'REDUCING', 'EXPANDING_ORDINARY', 'EXPANDING_HIGH_RISK');

-- CreateEnum
CREATE TYPE "role_assignment_status" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "scope_kind" AS ENUM ('ORGANIZATION', 'LEGAL_ENTITY', 'BUSINESS_UNIT', 'PLATFORM', 'DEPARTMENT', 'PROPERTY', 'VEHICLE', 'PROJECT', 'SELF');

-- CreateEnum
CREATE TYPE "authz_decision" AS ENUM ('ALLOW', 'DENY');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "admin_entity_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "status" "admin_entity_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_units" (
    "id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "admin_entity_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platforms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "business_unit_id" UUID,
    "status" "platform_status" NOT NULL DEFAULT 'SETUP',
    "icon_ref" TEXT,
    "route" TEXT NOT NULL,
    "feature_flag_key" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "admin_entity_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_definitions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "high_risk" BOOLEAN NOT NULL DEFAULT false,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "role_status" NOT NULL DEFAULT 'ACTIVE',
    "owner_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_versions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "role_version_status" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "classification" "role_version_classification" NOT NULL DEFAULT 'INITIAL',
    "platform_coverage" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_hash" TEXT NOT NULL,
    "change_reason" TEXT NOT NULL,
    "change_reference" TEXT,
    "created_by_id" UUID,
    "reviewed_by_id" UUID,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_version_permissions" (
    "role_version_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_version_permissions_pkey" PRIMARY KEY ("role_version_id","permission_id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_version_id" UUID NOT NULL,
    "status" "role_assignment_status" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "grant_reason" TEXT NOT NULL,
    "granted_by_id" UUID,
    "approved_by_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,
    "supersedes_assignment_id" UUID,
    "platform_qualifier" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_temporary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_scopes" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "kind" "scope_kind" NOT NULL,
    "organization_id" UUID,
    "legal_entity_id" UUID,
    "business_unit_id" UUID,
    "platform_id" UUID,
    "department_id" UUID,
    "property_ref" TEXT,
    "vehicle_ref" TEXT,
    "project_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment_events" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_suspensions" (
    "id" UUID NOT NULL,
    "permission_id" UUID,
    "role_version_id" UUID,
    "reason" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "lifted_at" TIMESTAMP(3),
    "lifted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_policy_versions" (
    "id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_evidence" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "role_assignment_id" UUID,
    "role_version_id" UUID,
    "role_code" TEXT,
    "role_version_number" INTEGER,
    "permission_id" UUID,
    "permission_code" TEXT NOT NULL,
    "scope_id" UUID,
    "scope_kind" "scope_kind",
    "scope_target" TEXT,
    "scope_description" TEXT,
    "platform_context" TEXT,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "action" TEXT NOT NULL,
    "auth_strength" TEXT,
    "mfa_method" TEXT,
    "mfa_result" TEXT,
    "recent_auth_at" TIMESTAMP(3),
    "request_id" TEXT,
    "correlation_id" TEXT,
    "decision" "authz_decision" NOT NULL,
    "deny_reason" TEXT,
    "policy_version_id" UUID,
    "delegation_id" UUID,
    "audit_event_id" UUID,
    "approval_snapshot_id" UUID,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "legal_entities_code_key" ON "legal_entities"("code");

-- CreateIndex
CREATE INDEX "legal_entities_organization_id_idx" ON "legal_entities"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_units_code_key" ON "business_units"("code");

-- CreateIndex
CREATE INDEX "business_units_legal_entity_id_idx" ON "business_units"("legal_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "platforms_code_key" ON "platforms"("code");

-- CreateIndex
CREATE INDEX "platforms_business_unit_id_idx" ON "platforms"("business_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permission_definitions_code_key" ON "permission_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "role_versions_role_id_status_idx" ON "role_versions"("role_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "role_versions_role_id_version_number_key" ON "role_versions"("role_id", "version_number");

-- CreateIndex
CREATE INDEX "role_version_permissions_permission_id_idx" ON "role_version_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "role_assignments_user_id_status_idx" ON "role_assignments"("user_id", "status");

-- CreateIndex
CREATE INDEX "role_assignments_role_version_id_idx" ON "role_assignments"("role_version_id");

-- CreateIndex
CREATE INDEX "assignment_scopes_assignment_id_idx" ON "assignment_scopes"("assignment_id");

-- CreateIndex
CREATE INDEX "role_assignment_events_assignment_id_created_at_idx" ON "role_assignment_events"("assignment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "security_policy_versions_version_number_key" ON "security_policy_versions"("version_number");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_evidence_sequence_key" ON "authorization_evidence"("sequence");

-- CreateIndex
CREATE INDEX "authorization_evidence_user_id_decided_at_idx" ON "authorization_evidence"("user_id", "decided_at");

-- CreateIndex
CREATE INDEX "authorization_evidence_permission_code_decided_at_idx" ON "authorization_evidence"("permission_code", "decided_at");

-- CreateIndex
CREATE INDEX "authorization_evidence_correlation_id_idx" ON "authorization_evidence"("correlation_id");

-- AddForeignKey
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platforms" ADD CONSTRAINT "platforms_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_versions" ADD CONSTRAINT "role_versions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_version_permissions" ADD CONSTRAINT "role_version_permissions_role_version_id_fkey" FOREIGN KEY ("role_version_id") REFERENCES "role_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_version_permissions" ADD CONSTRAINT "role_version_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_version_id_fkey" FOREIGN KEY ("role_version_id") REFERENCES "role_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_scopes" ADD CONSTRAINT "assignment_scopes_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "role_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment_events" ADD CONSTRAINT "role_assignment_events_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "role_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_suspensions" ADD CONSTRAINT "permission_suspensions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_suspensions" ADD CONSTRAINT "permission_suspensions_role_version_id_fkey" FOREIGN KEY ("role_version_id") REFERENCES "role_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Integrity rules
-- ---------------------------------------------------------------------------------------------

-- An assignment scope row targets exactly what its kind says (SELF targets nothing).
ALTER TABLE "assignment_scopes" ADD CONSTRAINT "assignment_scopes_kind_target_chk" CHECK (
  (kind = 'ORGANIZATION'  AND organization_id IS NOT NULL AND legal_entity_id IS NULL AND business_unit_id IS NULL AND platform_id IS NULL AND department_id IS NULL AND property_ref IS NULL AND vehicle_ref IS NULL AND project_ref IS NULL) OR
  (kind = 'LEGAL_ENTITY'  AND legal_entity_id IS NOT NULL AND organization_id IS NULL AND business_unit_id IS NULL AND platform_id IS NULL AND department_id IS NULL AND property_ref IS NULL AND vehicle_ref IS NULL AND project_ref IS NULL) OR
  (kind = 'BUSINESS_UNIT' AND business_unit_id IS NOT NULL AND organization_id IS NULL AND legal_entity_id IS NULL AND platform_id IS NULL AND department_id IS NULL AND property_ref IS NULL AND vehicle_ref IS NULL AND project_ref IS NULL) OR
  (kind = 'PLATFORM'      AND platform_id IS NOT NULL AND organization_id IS NULL AND legal_entity_id IS NULL AND business_unit_id IS NULL AND department_id IS NULL AND property_ref IS NULL AND vehicle_ref IS NULL AND project_ref IS NULL) OR
  (kind = 'DEPARTMENT'    AND department_id IS NOT NULL AND organization_id IS NULL AND legal_entity_id IS NULL AND business_unit_id IS NULL AND platform_id IS NULL AND property_ref IS NULL AND vehicle_ref IS NULL AND project_ref IS NULL) OR
  (kind = 'PROPERTY'      AND property_ref IS NOT NULL AND organization_id IS NULL AND legal_entity_id IS NULL AND business_unit_id IS NULL AND platform_id IS NULL AND department_id IS NULL AND vehicle_ref IS NULL AND project_ref IS NULL) OR
  (kind = 'VEHICLE'       AND vehicle_ref IS NOT NULL AND organization_id IS NULL AND legal_entity_id IS NULL AND business_unit_id IS NULL AND platform_id IS NULL AND department_id IS NULL AND property_ref IS NULL AND project_ref IS NULL) OR
  (kind = 'PROJECT'       AND project_ref IS NOT NULL AND organization_id IS NULL AND legal_entity_id IS NULL AND business_unit_id IS NULL AND platform_id IS NULL AND department_id IS NULL AND property_ref IS NULL AND vehicle_ref IS NULL) OR
  (kind = 'SELF'          AND organization_id IS NULL AND legal_entity_id IS NULL AND business_unit_id IS NULL AND platform_id IS NULL AND department_id IS NULL AND property_ref IS NULL AND vehicle_ref IS NULL AND project_ref IS NULL)
);

-- Half-open [from, to) intervals must not be empty or inverted.
ALTER TABLE "role_versions" ADD CONSTRAINT "role_versions_interval_chk" CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from);
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_interval_chk" CHECK (effective_to IS NULL OR effective_to > effective_from);
ALTER TABLE "permission_definitions" ADD CONSTRAINT "permission_definitions_tier_chk" CHECK (tier BETWEEN 1 AND 4);
ALTER TABLE "permission_definitions" ADD CONSTRAINT "permission_definitions_code_chk" CHECK (code ~ '^[a-z_]+(\.[a-z_]+){2}$');
-- Only one EFFECTIVE version per role at a time.
CREATE UNIQUE INDEX "role_versions_one_effective_per_role" ON "role_versions" (role_id) WHERE status = 'EFFECTIVE';

-- ---------------------------------------------------------------------------------------------
-- Immutability: published role versions and their membership can never be edited (Step 3A.1).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION role_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'role_versions rows are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'DRAFT' THEN RETURN NEW; END IF;
  -- After DRAFT only the lifecycle columns may move; the content that approvals bind to may not.
  IF NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.platform_coverage IS DISTINCT FROM OLD.platform_coverage
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'role_versions content is immutable after DRAFT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER role_versions_immutable_trg BEFORE UPDATE OR DELETE ON "role_versions"
  FOR EACH ROW EXECUTE FUNCTION role_versions_immutable();

CREATE OR REPLACE FUNCTION role_version_permissions_guard() RETURNS trigger AS $$
DECLARE v_status role_version_status; v_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'role_version_permissions rows are never updated' USING ERRCODE = 'restrict_violation';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.role_version_id ELSE NEW.role_version_id END;
  SELECT status INTO v_status FROM role_versions WHERE id = v_id;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'permission membership can only change while the role version is DRAFT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER role_version_permissions_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "role_version_permissions"
  FOR EACH ROW EXECUTE FUNCTION role_version_permissions_guard();

-- Assignments are never deleted; grant facts never change. Only lifecycle columns may move.
CREATE OR REPLACE FUNCTION role_assignments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'role_assignments rows are never deleted (revoke instead)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.role_version_id IS DISTINCT FROM OLD.role_version_id
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason
     OR NEW.granted_by_id IS DISTINCT FROM OLD.granted_by_id
     OR NEW.supersedes_assignment_id IS DISTINCT FROM OLD.supersedes_assignment_id
     OR NEW.platform_qualifier IS DISTINCT FROM OLD.platform_qualifier
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'role_assignments grant facts are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER role_assignments_guard_trg BEFORE UPDATE OR DELETE ON "role_assignments"
  FOR EACH ROW EXECUTE FUNCTION role_assignments_guard();

-- Generic append-only guard for scope rows, assignment events, and authorization evidence.
CREATE OR REPLACE FUNCTION admin_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER assignment_scopes_append_only_trg BEFORE UPDATE OR DELETE ON "assignment_scopes"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER role_assignment_events_append_only_trg BEFORE UPDATE OR DELETE ON "role_assignment_events"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER authorization_evidence_append_only_trg BEFORE UPDATE OR DELETE ON "authorization_evidence"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER security_policy_versions_append_only_trg BEFORE UPDATE OR DELETE ON "security_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();

-- Permission codes and tiers are immutable once published; only deprecation may change.
CREATE OR REPLACE FUNCTION permission_definitions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'permission_definitions are never deleted (deprecate instead)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.high_risk IS DISTINCT FROM OLD.high_risk OR NEW.area IS DISTINCT FROM OLD.area
     OR NEW.resource IS DISTINCT FROM OLD.resource OR NEW.action IS DISTINCT FROM OLD.action THEN
    RAISE EXCEPTION 'permission_definitions code, tier and risk are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER permission_definitions_guard_trg BEFORE UPDATE OR DELETE ON "permission_definitions"
  FOR EACH ROW EXECUTE FUNCTION permission_definitions_guard();

-- ---------------------------------------------------------------------------------------------
-- Existing admin audit log: additive correlation/platform/reason columns, guard extended.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "admin_audit_logs" ADD COLUMN "correlation_id" TEXT, ADD COLUMN "platform_code" TEXT, ADD COLUMN "reason" TEXT;
CREATE INDEX "admin_audit_logs_correlation_id_idx" ON "admin_audit_logs" ("correlation_id");
CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs" ("action", "created_at");

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
     OR (NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id AND NEW.actor_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'admin_audit_logs is append-only (UPDATE refused)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
