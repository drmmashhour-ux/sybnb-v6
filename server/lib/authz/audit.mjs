// STEP 5 -- audit event helper over the existing append-only admin_audit_logs table (migration 071,
// extended in 078 with correlation_id / platform_code / reason).
export async function writeAdminAudit(tx, { actorUserId, action, entityType, entityId, before = null, after = null, reason = null, correlationId = null, platformCode = null, ipHash = null }) {
  return tx.adminAuditLog.create({
    data: {
      actorUserId: actorUserId ?? null, action, entityType, entityId: String(entityId ?? ''), before, after,
      reason, correlationId, platformCode, ipHash,
    },
  })
}
