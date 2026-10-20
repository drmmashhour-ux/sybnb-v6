// STEP 5 -- idempotent seed for the admin foundation reference data: organization registry, platform
// registry, departments, permission definitions, role version 1 of each starter role, and security
// policy version 1. SAFE to re-run: it only inserts what is missing and never edits a published
// role version (published versions are immutable; changes go through the role-version workflow).
//
//   DATABASE_URL=... node scripts/admin-foundation-seed.mjs
import { PrismaClient } from '@prisma/client'
import { PERMISSIONS, ROLES, REGISTRY_SEED, POLICY_V2_CONFIG, permissionParts, roleVersionContentHash, resolveRoleVersions } from '../server/lib/authz/catalogue.mjs'
import { LEGACY_PERMISSION_ALIASES } from '../server/lib/authz/permission-aliases.mjs'

const db = new PrismaClient()
const log = (...a) => console.log('[admin-seed]', ...a)

async function main() {
  const org = await db.organization.upsert({ where: { code: REGISTRY_SEED.organization.code }, update: {}, create: REGISTRY_SEED.organization })
  const le = await db.legalEntity.upsert({ where: { code: REGISTRY_SEED.legalEntity.code }, update: {}, create: { ...REGISTRY_SEED.legalEntity, organizationId: org.id } })
  const buByCode = new Map()
  for (const bu of REGISTRY_SEED.businessUnits) {
    buByCode.set(bu.code, await db.businessUnit.upsert({ where: { code: bu.code }, update: {}, create: { ...bu, legalEntityId: le.id } }))
  }
  for (const p of REGISTRY_SEED.platforms) {
    await db.platform.upsert({
      where: { code: p.code }, update: {},
      create: { code: p.code, displayName: p.displayName, businessUnitId: buByCode.get(p.bu).id, route: p.route, featureFlagKey: p.flag, sortOrder: p.sortOrder, status: 'SETUP' },
    })
  }
  for (const d of REGISTRY_SEED.departments) {
    await db.department.upsert({ where: { organizationId_code: { organizationId: org.id, code: d.code } }, update: {}, create: { ...d, organizationId: org.id } })
  }
  for (const p of PERMISSIONS) {
    const parts = permissionParts(p.code)
    await db.permissionDefinition.upsert({
      where: { code: p.code }, update: {},
      create: { code: p.code, ...parts, tier: p.tier, highRisk: Boolean(p.highRisk) || p.tier === 4, description: p.description },
    })
  }
  const permByCode = new Map((await db.permissionDefinition.findMany()).map((p) => [p.code, p]))

  // Legacy (first-cut) names stay resolvable for historical evidence. Insert-only.
  for (const [legacy, canonical] of Object.entries(LEGACY_PERMISSION_ALIASES)) {
    const perm = permByCode.get(canonical)
    if (!perm) throw new Error(`alias ${legacy} -> unknown permission ${canonical}`)
    await db.permissionCodeAlias.upsert({ where: { legacyCode: legacy }, update: {}, create: { legacyCode: legacy, permissionId: perm.id } })
  }

  // Retention policies (3A-6): migration 081 creates them; this keeps a re-seeded DB complete. The 7-year
  // floor is a database CHECK; there is no purge job anywhere.
  const RETENTION = { AUTHORIZATION_EVIDENCE: 'Authorization decisions and snapshots', SECURITY_EVENT: 'Security events', PRIVILEGED_ACCESS: 'Privileged access, delegation, temporary access', ROLE_HISTORY: 'Role versions and scope evidence', ACCESS_APPROVAL: 'Access approvals', BREAK_GLASS: 'Break-glass requests and use', USER_SUSPENSION: 'User suspensions and reactivations', AUDIT: 'Audit events' }
  for (const [category, description] of Object.entries(RETENTION)) {
    await db.retentionPolicy.upsert({ where: { category }, update: {}, create: { category, minYears: 7, years: 7, description } })
  }

  // Roles: apply every catalogue version that is missing, in order. A published version is never edited;
  // a new version supersedes the previous EFFECTIVE one, and existing holders STAY pinned to the version
  // they were granted (they move only through the assignment workflow -- expansions are never silent).
  for (const r of ROLES) {
    const role = await db.role.upsert({ where: { code: r.code }, update: {}, create: { code: r.code, name: r.name, description: r.description } })
    for (const v of resolveRoleVersions(r)) {
      for (const code of v.permissions) if (!permByCode.has(code)) throw new Error(`role ${r.code} v${v.n} references unknown permission ${code}`)
      const existing = await db.roleVersion.findUnique({ where: { roleId_versionNumber: { roleId: role.id, versionNumber: v.n } } })
      if (existing) { log('role', r.code, `v${v.n} already present (left untouched)`); continue }
      const added = v.add.map((c) => permByCode.get(c))
      const classification = v.n === 1 ? 'INITIAL' : v.remove.length ? 'REDUCING' : added.some((d) => d.highRisk) ? 'EXPANDING_HIGH_RISK' : 'EXPANDING_ORDINARY'
      const hash = roleVersionContentHash({ roleCode: r.code, versionNumber: v.n, coverage: r.coverage, permissions: v.permissions })
      await db.$transaction(async (tx) => {
        const rv = await tx.roleVersion.create({
          data: { roleId: role.id, versionNumber: v.n, status: 'DRAFT', classification, platformCoverage: r.coverage, contentHash: hash, changeReason: v.reason, changeReference: v.n === 1 ? 'STEP5-SEED' : 'STEP5A-SEED' },
        })
        await tx.roleVersionPermission.createMany({ data: v.permissions.map((c) => ({ roleVersionId: rv.id, permissionId: permByCode.get(c).id })) })
        // One EFFECTIVE version per role: the previous one becomes SUPERSEDED (still usable by its pinned holders).
        await tx.roleVersion.updateMany({ where: { roleId: role.id, status: 'EFFECTIVE' }, data: { status: 'SUPERSEDED', effectiveTo: new Date() } })
        await tx.roleVersion.update({ where: { id: rv.id }, data: { status: 'EFFECTIVE', effectiveFrom: new Date() } })
      })
      log('role', r.code, `v${v.n} published with`, v.permissions.length, 'permissions')
    }
  }

  if (!(await db.securityPolicyVersion.findUnique({ where: { versionNumber: 1 } }))) {
    await db.securityPolicyVersion.create({ data: { versionNumber: 1, config: { stepUpWindowMs: { 3: 15 * 60_000, 4: 5 * 60_000 }, note: 'Initial policy from Step 3.' } } })
    log('security policy v1 created')
  }
  if (!(await db.securityPolicyVersion.findUnique({ where: { versionNumber: 2 } }))) {
    await db.securityPolicyVersion.create({ data: { versionNumber: 2, config: POLICY_V2_CONFIG } })
    log('security policy v2 created (48h high-risk activation delay)')
  }
  log('done')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
