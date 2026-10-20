// STEP 5A (3A-4) -- the high-risk registry. "High risk" is DATA (permission_definitions.high_risk, seeded
// from catalogue.mjs). Every rule asks this module; nothing compares a permission code to a literal.
export async function highRiskCodes(client) {
  const rows = await client.permissionDefinition.findMany({ where: { highRisk: true, deprecated: false }, select: { code: true } })
  return new Set(rows.map((r) => r.code))
}

/** Permission codes of a role version that are high-risk, per the registry. */
export async function highRiskIn(client, codes) {
  if (!codes.length) return []
  const rows = await client.permissionDefinition.findMany({ where: { code: { in: [...codes] }, highRisk: true }, select: { code: true } })
  return rows.map((r) => r.code).sort()
}

export async function versionCodes(client, roleVersionId) {
  const rows = await client.roleVersionPermission.findMany({ where: { roleVersionId }, include: { permission: { select: { code: true } } } })
  return rows.map((r) => r.permission.code)
}

/**
 * Does moving from `fromVersionId` (or nothing) to `toVersionId` add any high-risk permission?
 * Returns { added, addedHighRisk, removed }.
 */
export async function privilegeDelta(client, fromVersionId, toVersionId) {
  const to = new Set(await versionCodes(client, toVersionId))
  const from = new Set(fromVersionId ? await versionCodes(client, fromVersionId) : [])
  const added = [...to].filter((c) => !from.has(c)).sort()
  const removed = [...from].filter((c) => !to.has(c)).sort()
  return { added, removed, addedHighRisk: await highRiskIn(client, added) }
}
