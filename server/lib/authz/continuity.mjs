// STEP 5B -- continuity protection (anti-lockout). This is NOT immunity: an Owner can still be suspended,
// revoked or reduced, as long as another valid holder of the same capability remains in the organization.
// The capabilities are expressed as permissions (never role names):
//   access.assign   -- can administer access (also held by the pre-bootstrap Owner)
//   access.approve  -- final approval of high-risk grants
//   user.reactivate -- can recover a suspended account
// A capability is only protected while at least one valid holder exists (an organization that never had it,
// for example before the Owner bootstrap, cannot be made "worse").
//
// Approved transition / recovery path: grant the capability to a second holder first (ordinary 48h workflow,
// or the one-time Owner bootstrap), then remove the old holder. A migration (supersede) counts the new
// assignment as a holder before the old one is closed, so version transitions are never blocked.
import { conflictErr } from './errors.mjs'

export const CONTINUITY_PERMISSIONS = Object.freeze(['access.assign', 'access.approve', 'user.reactivate'])

function validNow(now) {
  return {
    OR: [{ status: 'ACTIVE' }, { status: 'PENDING_ACTIVATION', activationAt: { lte: now } }],
    revokedAt: null, effectiveFrom: { lte: now },
    AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
  }
}

/** Distinct valid holders of `permission` in the organization. */
export async function validHolders(client, { organizationId, permission, excludeUserIds = [], excludeAssignmentIds = [], roleVersionId = null, now = new Date() }) {
  const rows = await client.roleAssignment.findMany({
    where: {
      ...validNow(now),
      user: { status: 'ACTIVE' },
      ...(excludeUserIds.length ? { userId: { notIn: excludeUserIds } } : {}),
      ...(excludeAssignmentIds.length ? { id: { notIn: excludeAssignmentIds } } : {}),
      scopes: { some: { kind: 'ORGANIZATION', organizationId } },
      roleVersion: {
        status: { in: ['EFFECTIVE', 'SUPERSEDED'] }, role: { status: 'ACTIVE' }, ...(roleVersionId ? { id: roleVersionId } : {}),
        permissions: { some: { permission: { code: permission } } },
      },
    },
    select: { userId: true },
  })
  return new Set(rows.map((r) => r.userId)).size
}

/** Organizations in which the given assignments currently confer authority (ORGANIZATION scope). */
async function orgsOf(client, { userId, assignmentIds }) {
  const rows = await client.assignmentScope.findMany({
    where: { kind: 'ORGANIZATION', organizationId: { not: null }, assignment: assignmentIds?.length ? { id: { in: assignmentIds } } : { userId } },
    select: { organizationId: true },
  })
  return [...new Set(rows.map((r) => r.organizationId))]
}

/**
 * Throws 409 LAST_AUTHORITY if removing the user (all their assignments) or the given assignments would leave an
 * organization with zero valid holders of a capability it currently has.
 */
export async function assertContinuity(client, { userId = null, assignmentIds = null, now = new Date() }) {
  const orgs = await orgsOf(client, { userId, assignmentIds })
  for (const organizationId of orgs) {
    for (const permission of CONTINUITY_PERMISSIONS) {
      const before = await validHolders(client, { organizationId, permission, now })
      if (before === 0) continue
      const after = await validHolders(client, { organizationId, permission, now, excludeUserIds: userId ? [userId] : [], excludeAssignmentIds: assignmentIds ?? [] })
      if (after === 0) {
        throw conflictErr(`This is the last active holder of ${permission} in the organization; removing it would lock everyone out. Grant it to another person first.`, 'LAST_AUTHORITY')
      }
    }
  }
}

/** After a transition: every listed capability must still have a valid holder in each organization. */
export async function assertCapabilitiesRetained(client, { organizationIds, permissions, now = new Date() }) {
  for (const organizationId of organizationIds) {
    for (const permission of permissions.filter((p) => CONTINUITY_PERMISSIONS.includes(p))) {
      if (await validHolders(client, { organizationId, permission, now }) === 0) {
        throw conflictErr(`This change would leave the organization with no holder of ${permission}.`, 'LAST_AUTHORITY')
      }
    }
  }
}
