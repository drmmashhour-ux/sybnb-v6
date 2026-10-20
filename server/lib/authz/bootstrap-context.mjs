// STEP 5E -- trusted organization context for the Owner bootstrap.
//
// The organization is NEVER chosen by the caller (no query parameter, body field, header or route parameter).
// It is derived from the authenticated user's own role assignments: the organizations on which the caller holds
// an ACTIVE OWNER assignment with an ORGANIZATION scope. Platform / legal-entity / business-unit scoped Owner
// assignments do not identify an organization for security purposes and are ignored. Authorization (access.assign
// at that organization, tier 4, step-up) and the bootstrap's own eligibility checks still run afterwards.
//
//   no eligible Owner assignment      -> { organizationId: null, reason: 'NO_OWNER_ORGANIZATION' }
//   Owner of exactly one organization -> { organizationId }
//   Owner of several organizations    -> { organizationId: null, reason: 'ORGANIZATION_CONTEXT_REQUIRED' }
//     (fail closed: choosing among several must go through the standard organization-context mechanism, which
//      does not exist yet; this endpoint deliberately does not grow its own selector)
import { BOOTSTRAP_ROLE_CODE } from './bootstrap-core.mjs'

export async function resolveBootstrapOrganization(client, userId) {
  if (!userId) return { organizationId: null, reason: 'NO_OWNER_ORGANIZATION' }
  const rows = await client.roleAssignment.findMany({
    where: { userId, status: 'ACTIVE', revokedAt: null, roleVersion: { role: { code: BOOTSTRAP_ROLE_CODE } }, scopes: { some: { kind: 'ORGANIZATION' } } },
    select: { scopes: { where: { kind: 'ORGANIZATION' }, select: { organizationId: true } } },
  })
  const ids = [...new Set(rows.flatMap((a) => a.scopes.map((s) => s.organizationId)).filter(Boolean))]
  if (ids.length === 0) return { organizationId: null, reason: 'NO_OWNER_ORGANIZATION' }
  if (ids.length > 1) return { organizationId: null, reason: 'ORGANIZATION_CONTEXT_REQUIRED' }
  return { organizationId: ids[0], reason: null }
}
