// STEP 5 -- audit event helper over the existing append-only admin_audit_logs table (migration 071,
// extended in 078 with correlation_id / platform_code / reason, in 083 with organization_id).
//
// STEP 5H: `organizationId` says which organization the record belongs to. It must come from trusted server state (the
// resource's own organization, the authorization decision, or the actor's single organization), never from request input.
// Omitted / null = UNATTRIBUTED: the row is stored but no organization-scoped route will ever show it (fail closed).
export async function writeAdminAudit(tx, { actorUserId, action, entityType, entityId, before = null, after = null, reason = null, correlationId = null, platformCode = null, ipHash = null, organizationId = null }) {
  return tx.adminAuditLog.create({
    data: {
      actorUserId: actorUserId ?? null, action, entityType, entityId: String(entityId ?? ''), before, after,
      reason, correlationId, platformCode, ipHash, organizationId: organizationId ?? null,
    },
  })
}
