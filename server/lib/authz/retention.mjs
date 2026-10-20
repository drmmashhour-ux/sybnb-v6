import { trustedNow } from './clock.mjs'
// STEP 5A (3A-6) -- retention metadata. Floor: 7 years (also a database CHECK and trigger). Longer is
// supported by raising retention_policies.years. There is NO purge job and no delete endpoint: retention
// here only stamps `retain_until` so that a future, separately approved disposal process has the facts.
export const RETENTION_FLOOR_YEARS = 7
export const RETENTION_CATEGORIES = Object.freeze([
  'AUTHORIZATION_EVIDENCE', 'SECURITY_EVENT', 'PRIVILEGED_ACCESS', 'ROLE_HISTORY', 'ACCESS_APPROVAL', 'BREAK_GLASS', 'USER_SUSPENSION', 'AUDIT',
])

export function addYears(from, years) {
  const d = new Date(from)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d
}

export async function loadRetentionPolicies(client) {
  const rows = await client.retentionPolicy.findMany()
  return new Map(rows.map((r) => [r.category, r]))
}

/** { retentionCategory, retainUntil } for a record created at `from`. Never shorter than 7 years. */
export async function retentionFor(client, category, from = trustedNow()) {
  const p = await client.retentionPolicy.findUnique({ where: { category } })
  const years = Math.max(RETENTION_FLOOR_YEARS, p?.years ?? RETENTION_FLOOR_YEARS)
  return { retentionCategory: category, retainUntil: addYears(from, years) }
}
