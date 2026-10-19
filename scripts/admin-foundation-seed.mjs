// STEP 5 -- idempotent seed for the admin foundation reference data: organization registry, platform
// registry, departments, permission definitions, role version 1 of each starter role, and security
// policy version 1. SAFE to re-run: it only inserts what is missing and never edits a published
// role version (published versions are immutable; changes go through the role-version workflow).
//
//   DATABASE_URL=... node scripts/admin-foundation-seed.mjs
import { PrismaClient } from '@prisma/client'
import { PERMISSIONS, ROLES, REGISTRY_SEED, permissionParts, roleVersionContentHash } from '../server/lib/authz/catalogue.mjs'

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

  for (const r of ROLES) {
    for (const code of r.permissions) if (!permByCode.has(code)) throw new Error(`role ${r.code} references unknown permission ${code}`)
    const role = await db.role.upsert({ where: { code: r.code }, update: {}, create: { code: r.code, name: r.name, description: r.description } })
    const existing = await db.roleVersion.findUnique({ where: { roleId_versionNumber: { roleId: role.id, versionNumber: 1 } } })
    if (existing) { log('role', r.code, 'v1 already present (left untouched)'); continue }
    const hash = roleVersionContentHash({ roleCode: r.code, versionNumber: 1, coverage: r.coverage, permissions: r.permissions })
    await db.$transaction(async (tx) => {
      const rv = await tx.roleVersion.create({
        data: { roleId: role.id, versionNumber: 1, status: 'DRAFT', classification: 'INITIAL', platformCoverage: r.coverage, contentHash: hash, changeReason: 'Initial version created by the Step 5 admin foundation seed.', changeReference: 'STEP5-SEED' },
      })
      await tx.roleVersionPermission.createMany({ data: r.permissions.map((c) => ({ roleVersionId: rv.id, permissionId: permByCode.get(c).id })) })
      // Publish: DRAFT -> EFFECTIVE (the database trigger freezes content from here on).
      await tx.roleVersion.update({ where: { id: rv.id }, data: { status: 'EFFECTIVE', effectiveFrom: new Date() } })
    })
    log('role', r.code, 'v1 published with', r.permissions.length, 'permissions')
  }

  if (!(await db.securityPolicyVersion.findUnique({ where: { versionNumber: 1 } }))) {
    await db.securityPolicyVersion.create({ data: { versionNumber: 1, config: { stepUpWindowMs: { 3: 15 * 60_000, 4: 5 * 60_000 }, note: 'Initial policy from Step 3.' } } })
    log('security policy v1 created')
  }
  log('done')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
