// STEP 5 -- database loaders for the authorization evaluator. Read-only. Every function takes a
// Prisma client or transaction so callers control the transaction boundary.
import { DEFAULT_POLICY } from './evaluate.mjs'

export async function loadOrgIndex(client) {
  const [orgs, les, bus, platforms] = await Promise.all([
    client.organization.findMany(), client.legalEntity.findMany(), client.businessUnit.findMany(), client.platform.findMany(),
  ])
  return {
    organizationsById: new Map(orgs.map((o) => [o.id, o])),
    legalEntitiesById: new Map(les.map((o) => [o.id, o])),
    businessUnitsById: new Map(bus.map((o) => [o.id, o])),
    platformsById: new Map(platforms.map((o) => [o.id, o])),
    platformsByCode: new Map(platforms.map((o) => [o.code, o])),
  }
}

export async function loadPermission(client, code) {
  const row = await client.permissionDefinition.findUnique({ where: { code } })
  return row ? { id: row.id, code: row.code, tier: row.tier, highRisk: row.highRisk, deprecated: row.deprecated, noSelf: NO_SELF.has(row.code), reserved: RESERVED.has(row.code) } : null
}

// "noSelf" is a property of the permission's definition in the catalogue; it is mirrored here to
// avoid a schema change in this step (documented limitation: not yet a database column).
import { PERMISSIONS } from './catalogue.mjs'
const NO_SELF = new Set(PERMISSIONS.filter((p) => p.noSelf).map((p) => p.code))
const RESERVED = new Set(PERMISSIONS.filter((p) => p.reserved).map((p) => p.code))

function mapAssignment(a) {
  return {
    id: a.id, userId: a.userId, status: a.status, activationAt: a.activationAt ?? null, approvedAt: a.approvedAt ?? null, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo,
    revokedAt: a.revokedAt, platformQualifier: a.platformQualifier || [],
    roleVersion: {
      id: a.roleVersion.id, versionNumber: a.roleVersion.versionNumber, status: a.roleVersion.status,
      effectiveFrom: a.roleVersion.effectiveFrom, effectiveTo: a.roleVersion.effectiveTo,
      platformCoverage: a.roleVersion.platformCoverage || [],
      role: { id: a.roleVersion.role.id, code: a.roleVersion.role.code, status: a.roleVersion.role.status },
      permissionCodes: new Set(a.roleVersion.permissions.map((p) => p.permission.code)),
    },
    scopes: a.scopes.map((s) => ({
      id: s.id, kind: s.kind, organizationId: s.organizationId, legalEntityId: s.legalEntityId, businessUnitId: s.businessUnitId,
      platformId: s.platformId, departmentId: s.departmentId, propertyRef: s.propertyRef, vehicleRef: s.vehicleRef, projectRef: s.projectRef,
    })),
  }
}

const ASSIGNMENT_INCLUDE = {
  roleVersion: { include: { role: true, permissions: { include: { permission: true } } } },
  scopes: true,
}

// Live authorization: only assignments that could be active now (cheap filter; the evaluator still
// re-checks every date and status rule).
export async function loadAssignmentsForUser(client, userId) {
  const rows = await client.roleAssignment.findMany({ where: { userId, status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] } }, include: ASSIGNMENT_INCLUDE })
  return rows.map(mapAssignment)
}

// Point-in-time proof (3A.1): load the user's FULL assignment history, including assignments that
// have since been revoked or superseded. The row's status NOW is replaced by "what it was at T":
// an assignment that existed at T and had not been revoked by T counts as ACTIVE at T.
export async function loadAssignmentsAsOf(client, userId, at) {
  const rows = await client.roleAssignment.findMany({ where: { userId }, include: ASSIGNMENT_INCLUDE })
  const t = new Date(at).getTime()
  return rows
    .filter((a) => !['PENDING_APPROVAL', 'UNDER_REVIEW', 'REJECTED'].includes(a.status) && a.effectiveFrom.getTime() <= t)
    .filter((a) => a.approvedAt == null || a.approvedAt.getTime() <= t)
    .map((a) => {
      const m = mapAssignment(a)
      const revokedByT = a.revokedAt != null && a.revokedAt.getTime() <= t
      m.status = revokedByT ? 'REVOKED' : 'ACTIVE' // activationAt (if any) still gates use at T
      return m
    })
}

export async function loadSuspensions(client) {
  const rows = await client.permissionSuspension.findMany({ include: { permission: true } })
  return rows.map((s) => ({
    id: s.id, permissionCode: s.permission?.code ?? null, roleVersionId: s.roleVersionId,
    effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, liftedAt: s.liftedAt,
  }))
}

export async function loadPolicy(client, at = new Date()) {
  const row = await client.securityPolicyVersion.findFirst({ where: { effectiveFrom: { lte: at } }, orderBy: { versionNumber: 'desc' } })
  if (!row) return { ...DEFAULT_POLICY, id: null }
  const cfg = row.config || {}
  const w = cfg.stepUpWindowMs || {}
  const delayH = Number(cfg.highRiskActivationDelayHours)
  // The delay can be lengthened by policy but never shortened below the approved 48 hours.
  const delayMs = Math.max(DEFAULT_POLICY.highRiskActivationDelayMs, Number.isFinite(delayH) ? delayH * 3_600_000 : 0)
  return { id: row.id, version: row.versionNumber, highRiskActivationDelayMs: delayMs, stepUpWindowMs: { 3: Number(w['3'] ?? DEFAULT_POLICY.stepUpWindowMs[3]), 4: Number(w['4'] ?? DEFAULT_POLICY.stepUpWindowMs[4]) } }
}
