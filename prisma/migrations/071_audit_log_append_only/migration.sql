-- The admin audit log is append-only at the database level: nobody (including a compromised admin
-- session or a buggy script) can edit or delete a row. The single allowed change is the foreign key's
-- own ON DELETE SET NULL (actor_user_id -> NULL when a user account is removed); every other column
-- must stay identical.
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
     OR (NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id AND NEW.actor_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'admin_audit_logs is append-only (UPDATE refused)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_logs_append_only_trg
  BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION admin_audit_logs_append_only();
