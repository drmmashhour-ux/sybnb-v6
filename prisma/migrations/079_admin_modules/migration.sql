-- Step 5 admin foundation, part 2: shared modules (work queue, notifications, parties, documents,
-- support, comments, timeline, approvals, settings, flags, service accounts). Additive only; the
-- only existing table touched is user_sessions (one nullable column).

-- CreateEnum
CREATE TYPE "work_item_type" AS ENUM ('DOCUMENT_REVIEW', 'ACCESS_REQUEST', 'SECURITY_REVIEW', 'APPROVAL', 'SUPPORT_ESCALATION', 'PLATFORM_SETUP');

-- CreateEnum
CREATE TYPE "work_item_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "admin_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "admin_risk" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "admin_notification_type" AS ENUM ('TASK', 'APPROVAL', 'SECURITY', 'DOCUMENT', 'SUPPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "party_kind" AS ENUM ('PERSON', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "party_status" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "admin_document_status" AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "support_case_status" AS ENUM ('OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "support_message_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "approval_kind" AS ENUM ('ACCESS', 'DOCUMENT', 'PLATFORM', 'FINANCIAL');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "feature_flag_scope" AS ENUM ('ORGANIZATION', 'LEGAL_ENTITY', 'PLATFORM');

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "step_up_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "work_items" (
    "id" UUID NOT NULL,
    "type" "work_item_type" NOT NULL,
    "title" TEXT NOT NULL,
    "platform_id" UUID,
    "priority" "admin_priority" NOT NULL DEFAULT 'NORMAL',
    "status" "work_item_status" NOT NULL DEFAULT 'OPEN',
    "assigned_user_id" UUID,
    "assigned_team" TEXT,
    "due_at" TIMESTAMP(3),
    "linked_entity_type" TEXT,
    "linked_entity_id" TEXT,
    "risk" "admin_risk" NOT NULL DEFAULT 'NONE',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "admin_notification_type" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "priority" "admin_priority" NOT NULL DEFAULT 'NORMAL',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "kind" "party_kind" NOT NULL,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "party_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_roles" (
    "id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "role_type" TEXT NOT NULL,
    "platform_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_addresses" (
    "id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_party_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_party_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_documents" (
    "id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "admin_document_status" NOT NULL DEFAULT 'UPLOADED',
    "platform_id" UUID,
    "party_id" UUID,
    "uploaded_by_id" UUID,
    "current_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID,
    "supersedes_version_id" UUID,
    "retention_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_reviews" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_cases" (
    "id" UUID NOT NULL,
    "case_number" SERIAL NOT NULL,
    "platform_id" UUID,
    "type" TEXT NOT NULL,
    "priority" "admin_priority" NOT NULL DEFAULT 'NORMAL',
    "status" "support_case_status" NOT NULL DEFAULT 'OPEN',
    "party_id" UUID,
    "linked_entity_type" TEXT,
    "linked_entity_id" TEXT,
    "assigned_user_id" UUID,
    "summary" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "direction" "support_message_direction" NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_comments" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "attachment_refs" JSONB NOT NULL DEFAULT '[]',
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "kind" "approval_kind" NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'PENDING',
    "platform_id" UUID,
    "subject_snapshot" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "required_approvals" INTEGER NOT NULL DEFAULT 1,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "approver_user_id" UUID,
    "decision" TEXT,
    "reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_settings" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope_kind" "feature_flag_scope" NOT NULL,
    "scope_ref" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_accounts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "integration_code" TEXT,
    "platform_id" UUID,
    "organization_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "secret_ref" TEXT,
    "permission_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),
    "disabled_by_id" UUID,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_delegations" (
    "id" UUID NOT NULL,
    "delegator_user_id" UUID NOT NULL,
    "delegate_user_id" UUID NOT NULL,
    "permission_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_saved_views" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "view_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_items_assigned_user_id_status_idx" ON "work_items"("assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "work_items_status_priority_idx" ON "work_items"("status", "priority");

-- CreateIndex
CREATE INDEX "work_items_platform_id_idx" ON "work_items"("platform_id");

-- CreateIndex
CREATE INDEX "admin_notifications_user_id_read_at_created_at_idx" ON "admin_notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "parties_display_name_idx" ON "parties"("display_name");

-- CreateIndex
CREATE INDEX "parties_status_idx" ON "parties"("status");

-- CreateIndex
CREATE INDEX "party_roles_party_id_idx" ON "party_roles"("party_id");

-- CreateIndex
CREATE INDEX "party_roles_role_type_idx" ON "party_roles"("role_type");

-- CreateIndex
CREATE INDEX "party_roles_platform_id_idx" ON "party_roles"("platform_id");

-- CreateIndex
CREATE INDEX "party_addresses_party_id_idx" ON "party_addresses"("party_id");

-- CreateIndex
CREATE INDEX "user_party_links_user_id_idx" ON "user_party_links"("user_id");

-- CreateIndex
CREATE INDEX "user_party_links_party_id_idx" ON "user_party_links"("party_id");

-- CreateIndex
CREATE INDEX "admin_documents_status_idx" ON "admin_documents"("status");

-- CreateIndex
CREATE INDEX "admin_documents_party_id_idx" ON "admin_documents"("party_id");

-- CreateIndex
CREATE INDEX "admin_documents_platform_id_idx" ON "admin_documents"("platform_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "document_links_entity_type_entity_id_idx" ON "document_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_entity_type_entity_id_key" ON "document_links"("document_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "document_reviews_document_id_idx" ON "document_reviews"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_cases_case_number_key" ON "support_cases"("case_number");

-- CreateIndex
CREATE INDEX "support_cases_status_priority_idx" ON "support_cases"("status", "priority");

-- CreateIndex
CREATE INDEX "support_cases_assigned_user_id_idx" ON "support_cases"("assigned_user_id");

-- CreateIndex
CREATE INDEX "support_cases_platform_id_idx" ON "support_cases"("platform_id");

-- CreateIndex
CREATE INDEX "support_messages_case_id_created_at_idx" ON "support_messages"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_comments_entity_type_entity_id_created_at_idx" ON "admin_comments"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "timeline_events_entity_type_entity_id_created_at_idx" ON "timeline_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_status_kind_idx" ON "approval_requests"("status", "kind");

-- CreateIndex
CREATE INDEX "approval_requests_requester_user_id_idx" ON "approval_requests"("requester_user_id");

-- CreateIndex
CREATE INDEX "approval_steps_request_id_idx" ON "approval_steps"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_settings_category_key_key" ON "admin_settings"("category", "key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_scope_kind_scope_ref_key" ON "feature_flags"("key", "scope_kind", "scope_ref");

-- CreateIndex
CREATE INDEX "admin_delegations_delegate_user_id_status_idx" ON "admin_delegations"("delegate_user_id", "status");

-- CreateIndex
CREATE INDEX "admin_saved_views_user_id_view_key_idx" ON "admin_saved_views"("user_id", "view_key");

-- AddForeignKey
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_party_links" ADD CONSTRAINT "user_party_links_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "admin_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "admin_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "admin_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Integrity rules for the shared admin modules
-- ---------------------------------------------------------------------------------------------
-- Document versions, reviews, support messages and the operational timeline are append-only:
-- an uploaded original is never replaced (a correction is a NEW version), and history is never edited.
CREATE TRIGGER document_versions_append_only_trg BEFORE UPDATE OR DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER document_reviews_append_only_trg BEFORE UPDATE OR DELETE ON "document_reviews"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER support_messages_append_only_trg BEFORE UPDATE OR DELETE ON "support_messages"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER timeline_events_append_only_trg BEFORE UPDATE OR DELETE ON "timeline_events"
  FOR EACH ROW EXECUTE FUNCTION admin_append_only();

-- Records that carry history are never deleted.
CREATE OR REPLACE FUNCTION admin_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER parties_no_delete_trg BEFORE DELETE ON "parties" FOR EACH ROW EXECUTE FUNCTION admin_no_delete();
CREATE TRIGGER party_roles_no_delete_trg BEFORE DELETE ON "party_roles" FOR EACH ROW EXECUTE FUNCTION admin_no_delete();
CREATE TRIGGER admin_documents_no_delete_trg BEFORE DELETE ON "admin_documents" FOR EACH ROW EXECUTE FUNCTION admin_no_delete();
CREATE TRIGGER support_cases_no_delete_trg BEFORE DELETE ON "support_cases" FOR EACH ROW EXECUTE FUNCTION admin_no_delete();
CREATE TRIGGER admin_comments_no_delete_trg BEFORE DELETE ON "admin_comments" FOR EACH ROW EXECUTE FUNCTION admin_no_delete();
CREATE TRIGGER approval_requests_no_delete_trg BEFORE DELETE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION admin_no_delete();
CREATE TRIGGER approval_steps_no_delete_trg BEFORE DELETE ON "approval_steps" FOR EACH ROW EXECUTE FUNCTION admin_no_delete();

-- A comment's text and author are fixed once written; only the resolved state may change.
CREATE OR REPLACE FUNCTION admin_comments_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'admin_comments content is immutable (only resolved state may change)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER admin_comments_guard_trg BEFORE UPDATE ON "admin_comments" FOR EACH ROW EXECUTE FUNCTION admin_comments_guard();

-- The approved snapshot and its hash never change; a decision step can be decided exactly once.
CREATE OR REPLACE FUNCTION approval_requests_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.subject_snapshot IS DISTINCT FROM OLD.subject_snapshot OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
     OR NEW.requester_user_id IS DISTINCT FROM OLD.requester_user_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.subject_type IS DISTINCT FROM OLD.subject_type OR NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    RAISE EXCEPTION 'approval_requests snapshot and subject are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a decided approval request cannot change status' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER approval_requests_guard_trg BEFORE UPDATE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION approval_requests_guard();

CREATE OR REPLACE FUNCTION approval_steps_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'an approval step can be decided only once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER approval_steps_guard_trg BEFORE UPDATE ON "approval_steps" FOR EACH ROW EXECUTE FUNCTION approval_steps_guard();

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_size_chk" CHECK (size_bytes >= 0 AND sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_required_chk" CHECK (required_approvals >= 1);
