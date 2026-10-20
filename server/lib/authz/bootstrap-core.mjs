// STEP 5B -- ONE-TIME OWNER SECURITY BOOTSTRAP.
//
// Purpose: move the initial, already-legitimate Owner from the old OWNER role version to the current approved
// OWNER version when the ordinary high-risk workflow (requester + reviewer + Owner approver + target, 48h) is
// impossible because no second independently-authorized person exists yet.
//
// This is NOT a general grant path:
//   * target is always the authenticated caller (actor === target): it cannot create or promote anyone else
//   * the caller must already hold an ACTIVE Owner assignment on an OLDER version, ORGANIZATION-scoped
//   * it works only while the organization's state is SECURITY_BOOTSTRAP_REQUIRED and no valid holder of the latest
//     Owner version exists
//   * it needs a deployment-side operator secret (ADMIN_BOOTSTRAP_SECRET) in addition to the authenticated session
//   * it needs a session that signed in with password + emailed code, and a fresh step-up (the route authorizes
//     access.assign, a tier-4 permission)
//   * on success the state moves to SECURITY_BOOTSTRAP_COMPLETED, a database trigger makes that terminal
//
// REPLAY PREVENTION (all layers must pass, any one stops a replay):
//   1. state machine row locked FOR UPDATE; COMPLETED => 409 BOOTSTRAP_CLOSED; the trigger refuses any later change
//      or delete of a completed row, so even direct SQL cannot reopen it without dropping the trigger
//   2. "no valid holder of the latest Owner version" is re-checked inside the same transaction
//   3. the caller's old assignment is superseded in the same transaction, so a second call finds nothing to migrate
//   4. operator secret from the deployment environment, compared in constant time; unset or short => disabled
//   5. every denied attempt is audited with a WARNING security event (never the secret)
//
// 48-HOUR EXCEPTION: the new assignment is ACTIVE immediately (activation_at = now). This exception exists ONLY
// inside this function. createAssignment / approveAssignment have no flag for it and always use the policy delay.
import { createHash, timingSafeEqual } from 'node:crypto'
import { writeAdminAudit } from './audit.mjs'
import { writeEvidence } from './evidence.mjs'
import { recordSecurityEvent } from './security-events.mjs'
import { retentionFor } from './retention.mjs'
import { validHolders, assertContinuity, lockContinuity, CONTINUITY_PERMISSIONS } from './continuity.mjs'
import { dbNow } from './clock.mjs'
import { PERMISSION_RULESET_VERSION } from './catalogue.mjs'
import { loadPolicy } from './loader.mjs'
import { svcError, badReq, conflictErr } from './errors.mjs'

export const BOOTSTRAP_REQUIRED = 'SECURITY_BOOTSTRAP_REQUIRED'
export const BOOTSTRAP_COMPLETED = 'SECURITY_BOOTSTRAP_COMPLETED'
export const BOOTSTRAP_ROLE_CODE = 'OWNER'
const TX = { maxWait: 10_000, timeout: 30_000 }
const WORKFLOW_UNAVAILABLE = 'Initial Owner security bootstrap: no second independently authorized person existed, so the ordinary request/review/approve workflow and its 48-hour delay could not be applied. One-time exception, now closed.'

export const SECRET_LEFT_CONFIGURED_WARNING = 'BOOTSTRAP SECRET STILL CONFIGURED AFTER COMPLETION'
export const SECRET_LIFECYCLE_INSTRUCTION = 'REMOVE OR ROTATE ADMIN_BOOTSTRAP_SECRET AFTER SUCCESSFUL BOOTSTRAP.'

/**
 * Secret lifecycle diagnostics (STEP 5C). Never exposes the value, only whether one is configured. A completed
 * bootstrap ignores the secret entirely (completeOwnerBootstrap answers BOOTSTRAP_CLOSED before reading it), so a
 * secret left in the environment is inert, but it is still reported so operators remove or rotate it.
 */
export async function bootstrapSecretDiagnostics(client) {
  const configured = (process.env.ADMIN_BOOTSTRAP_SECRET || '').length > 0
  const rows = await client.securityBootstrap.findMany({ select: { state: true } })
  const completed = rows.filter((r) => r.state === BOOTSTRAP_COMPLETED).length
  const required = rows.length - completed
  const stale = configured && completed > 0 && required === 0
  return { secretConfigured: configured, organizationsCompleted: completed, organizationsRequired: required, warning: configured && completed > 0 ? SECRET_LEFT_CONFIGURED_WARNING : null, instruction: configured && completed > 0 ? SECRET_LIFECYCLE_INSTRUCTION : null, secretNoLongerNeeded: stale }
}

export async function getBootstrapState(client, organizationId) {
  const row = await client.securityBootstrap.findUnique({ where: { organizationId } })
  return row ? { state: row.state, completedAt: row.completedAt } : null
}

function secretOk(provided) {
  const configured = process.env.ADMIN_BOOTSTRAP_SECRET || ''
  if (configured.length < 32) throw svcError(503, 'BOOTSTRAP_DISABLED', 'Owner bootstrap is not enabled on this deployment.')
  const a = createHash('sha256').update(String(provided ?? '')).digest()
  const b = createHash('sha256').update(configured).digest()
  return timingSafeEqual(a, b)
}

async function deny(client, { actorUserId, organizationId, code, status, message, requestId }) {
  try {
    await client.$transaction(async (tx) => {
      // STEP 5H: attribute the denial to the organization only when it exists in the registry (the column is a foreign key; the denial itself is always recorded).
      const known = organizationId ? await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }) : null
      const audit = await writeAdminAudit(tx, { actorUserId, action: 'security.owner_bootstrap_denied', entityType: 'security_bootstrap', entityId: organizationId, after: { code }, reason: code, correlationId: requestId, organizationId: known?.id ?? null })
      await recordSecurityEvent(tx, { severity: 'WARNING', eventType: 'OWNER_BOOTSTRAP_DENIED', actorUserId, entityType: 'security_bootstrap', entityId: organizationId, summary: `Owner bootstrap attempt denied (${code})`, detail: { code }, correlationId: requestId, auditEventId: audit.id, organizationId: known?.id ?? null })
    }, TX)
  } catch { /* recording a denial must never mask the denial itself */ }
  return svcError(status, code, message)
}

export async function runBootstrap(client, roleCode, { actorUserId, organizationId, reason, operatorSecret, authStrength, requestId = null, now: injectedNow = null }) {
  // 1. A completed bootstrap is closed BEFORE anything privileged happens: the reason, the operator secret and the
  //    session strength are not even evaluated, so a secret left in the environment cannot do anything.
  const pre = await client.securityBootstrap.findUnique({ where: { organizationId }, select: { state: true } })
  if (pre?.state === BOOTSTRAP_COMPLETED) throw await deny(client, { actorUserId, organizationId, code: 'BOOTSTRAP_CLOSED', status: 409, message: 'Owner bootstrap has already been completed and is permanently closed.', requestId })
  const why = String(reason ?? '').trim()
  if (why.length < 20) throw badReq('Explain the bootstrap in at least 20 characters.', 'REASON_REQUIRED')
  const secretGood = secretOk(operatorSecret) // throws 503 when the deployment has not enabled bootstrap
  if (!secretGood) throw await deny(client, { actorUserId, organizationId, code: 'BOOTSTRAP_SECRET_INVALID', status: 403, message: 'Operator authorization failed.', requestId })
  if (authStrength !== 'PASSWORD_PLUS_EMAIL_CODE') throw await deny(client, { actorUserId, organizationId, code: 'STRONG_AUTH_REQUIRED', status: 403, message: 'This action needs a session signed in with the emailed code.', requestId })

  let outcome
  try {
    outcome = await client.$transaction(async (tx) => {
      const now = injectedNow ?? await dbNow(tx) // database time for every comparison and write below
      const locked = await tx.$queryRaw`SELECT state FROM security_bootstrap WHERE organization_id = ${organizationId}::uuid FOR UPDATE`
      if (!locked.length) throw svcError(404, 'BOOTSTRAP_NOT_FOUND', 'No bootstrap record for this organization.')
      if (locked[0].state !== BOOTSTRAP_REQUIRED) throw conflictErr('Owner bootstrap has already been completed and is permanently closed.', 'BOOTSTRAP_CLOSED')

      await lockContinuity(tx, [organizationId]) // serialize against any concurrent authority removal in this organization
      const role = await tx.role.findUnique({ where: { code: roleCode } })
      const latest = role && await tx.roleVersion.findFirst({ where: { roleId: role.id, status: 'EFFECTIVE' }, include: { permissions: { include: { permission: true } } } })
      if (!latest) throw conflictErr('There is no current approved Owner role version.', 'NO_LATEST_VERSION')
      const latestCodes = new Set(latest.permissions.map((p) => p.permission.code))
      for (const c of CONTINUITY_PERMISSIONS) if (!latestCodes.has(c)) throw conflictErr(`The current Owner version lacks ${c}; bootstrap would not restore authority.`, 'LATEST_VERSION_INCOMPLETE')

      const existing = await validHolders(tx, { organizationId, permission: 'access.approve', roleVersionId: latest.id, now })
      if (existing > 0) throw conflictErr('A holder of the current Owner version already exists; use the ordinary workflow.', 'BOOTSTRAP_NOT_NEEDED')

      const actor = await tx.user.findUnique({ where: { id: actorUserId } })
      if (!actor || actor.status !== 'ACTIVE') throw svcError(403, 'NOT_LEGITIMATE_OWNER', 'Only an existing, active Owner can bootstrap.')
      const old = await tx.roleAssignment.findFirst({
        where: {
          userId: actorUserId, status: 'ACTIVE', revokedAt: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          roleVersion: { roleId: role.id, id: { not: latest.id }, status: { in: ['EFFECTIVE', 'SUPERSEDED'] } },
          scopes: { some: { kind: 'ORGANIZATION', organizationId } },
        },
        include: { scopes: true, roleVersion: true },
      })
      if (!old) throw svcError(403, 'NOT_LEGITIMATE_OWNER', 'Only an existing Owner of this organization on an older Owner version can bootstrap.')

      const ret = await retentionFor(tx, 'PRIVILEGED_ACCESS')
      const policy = await loadPolicy(tx, now)
      const fresh = await tx.roleAssignment.create({
        data: {
          userId: actorUserId, roleVersionId: latest.id, status: 'ACTIVE', effectiveFrom: now, effectiveTo: old.effectiveTo, isTemporary: old.isTemporary,
          grantReason: `SECURITY_BOOTSTRAP: ${why}`.slice(0, 1000), grantedById: actorUserId, approvedAt: now, activationAt: now, supersedesAssignmentId: old.id,
          platformQualifier: old.platformQualifier,
          scopes: { create: old.scopes.map((s) => ({ kind: s.kind, organizationId: s.organizationId, legalEntityId: s.legalEntityId, businessUnitId: s.businessUnitId, platformId: s.platformId, departmentId: s.departmentId, propertyRef: s.propertyRef, vehicleRef: s.vehicleRef, projectRef: s.projectRef })) },
          ...ret,
        },
      })
      await tx.roleAssignment.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } })
      const evDetail = { organizationId, oldRoleVersion: old.roleVersion.versionNumber, newRoleVersion: latest.versionNumber, oldAssignmentId: old.id, newAssignmentId: fresh.id, normalWorkflowUnavailable: true, activationDelayWaived: true, reason: why }
      await tx.roleAssignmentEvent.create({ data: { assignmentId: old.id, eventType: 'BOOTSTRAP_SUPERSEDED', actorUserId, detail: evDetail, correlationId: requestId, ...ret } })
      await tx.roleAssignmentEvent.create({ data: { assignmentId: fresh.id, eventType: 'BOOTSTRAP_GRANTED', actorUserId, detail: evDetail, correlationId: requestId, ...ret } })

      // Never leave the organization without authority: every continuity capability must still have a holder.
      for (const permission of CONTINUITY_PERMISSIONS) {
        if (await validHolders(tx, { organizationId, permission, now }) === 0) throw conflictErr(`Bootstrap would leave no holder of ${permission}.`, 'WOULD_LEAVE_NO_AUTHORITY')
      }
      await assertContinuity(tx, { assignmentIds: [old.id], now })

      const audit = await writeAdminAudit(tx, {
        actorUserId, action: 'security.owner_bootstrap_completed', entityType: 'security_bootstrap', entityId: organizationId,
        before: { state: BOOTSTRAP_REQUIRED, roleVersion: old.roleVersion.versionNumber }, after: { state: BOOTSTRAP_COMPLETED, roleVersion: latest.versionNumber, activationDelayWaived: true, policyDelayHours: policy.highRiskActivationDelayMs / 3_600_000 },
        reason: why, correlationId: requestId, organizationId,
      })
      const perm = await tx.permissionDefinition.findUnique({ where: { code: 'access.assign' } })
      const evidence = await writeEvidence(tx, {
        userId: actorUserId, roleAssignmentId: fresh.id, roleVersionId: latest.id, roleCode, roleVersionNumber: latest.versionNumber,
        permissionId: perm?.id ?? null, permissionCode: 'access.assign', scopeKind: 'ORGANIZATION', scopeTarget: organizationId, scopeDescription: 'Initial Owner security bootstrap',
        resourceType: 'security_bootstrap', resourceId: organizationId, action: 'owner_bootstrap', authStrength, mfaMethod: 'EMAIL_OTP', mfaResult: 'VERIFIED_AT_LOGIN',
        requestId, correlationId: requestId, decision: 'ALLOW', policyVersionId: policy.id ?? null, auditEventId: audit.id, rulesetVersion: PERMISSION_RULESET_VERSION, organizationId,
      })
      const ev = await recordSecurityEvent(tx, {
        severity: 'CRITICAL', eventType: 'OWNER_BOOTSTRAP_COMPLETED', actorUserId, entityType: 'security_bootstrap', entityId: organizationId,
        summary: 'Initial Owner security bootstrap completed (one-time exception, now closed)', detail: { ...evDetail, workflowUnavailableReason: WORKFLOW_UNAVAILABLE }, correlationId: requestId, auditEventId: audit.id, organizationId,
      })
      const closed = await tx.securityBootstrap.updateMany({
        where: { organizationId, state: BOOTSTRAP_REQUIRED },
        data: {
          state: BOOTSTRAP_COMPLETED, completedAt: now, completedById: actorUserId, targetUserId: actorUserId, oldAssignmentId: old.id, newAssignmentId: fresh.id,
          oldRoleVersionId: old.roleVersionId, newRoleVersionId: latest.id, reason: why, workflowUnavailableReason: WORKFLOW_UNAVAILABLE,
          securityEventId: ev.id, auditEventId: audit.id, evidenceId: evidence.id,
        },
      })
      if (closed.count !== 1) throw conflictErr('Owner bootstrap was completed concurrently.', 'BOOTSTRAP_CLOSED')
      return { organizationId, oldRoleVersion: old.roleVersion.versionNumber, newRoleVersion: latest.versionNumber, newAssignmentId: fresh.id, securityEventId: ev.id, auditEventId: audit.id, evidenceId: evidence.id, notified: ev.notifiedCount }
    }, TX)
  } catch (e) {
    if (e?.expose) throw await deny(client, { actorUserId, organizationId, code: e.code, status: e.statusCode, message: e.message, requestId })
    throw e
  }
  return outcome
}

/** The ONLY production entry point (re-exported by bootstrap.mjs; `runBootstrap` itself is NOT re-exported): the role is fixed to OWNER and cannot be chosen by a caller. */
export function completeOwnerBootstrap(client, args) { return runBootstrap(client, BOOTSTRAP_ROLE_CODE, args) }
