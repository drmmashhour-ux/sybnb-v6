// Step 5G -- a party's role history must never be confused with its active roles.
export type RoleLike = { status: string; effectiveFrom: string | null; effectiveTo: string | null }
export type RoleState = 'ACTIVE' | 'PENDING' | 'HISTORICAL'
export const ROLE_STATE_LABEL: Record<RoleState, string> = { ACTIVE: 'Active', PENDING: 'Pending', HISTORICAL: 'Historical' }

export function roleState(r: RoleLike, now: number = Date.now()): RoleState {
  const from = r.effectiveFrom ? Date.parse(r.effectiveFrom) : NaN
  const to = r.effectiveTo ? Date.parse(r.effectiveTo) : NaN
  if (r.status === 'PENDING') return 'PENDING'
  if (r.status !== 'ACTIVE') return 'HISTORICAL'
  if (!Number.isNaN(to) && to <= now) return 'HISTORICAL'
  if (!Number.isNaN(from) && from > now) return 'PENDING'
  return 'ACTIVE'
}
export function groupRoles<T extends RoleLike>(roles: T[], now: number = Date.now()): Record<RoleState, T[]> {
  const out: Record<RoleState, T[]> = { ACTIVE: [], PENDING: [], HISTORICAL: [] }
  for (const r of roles) out[roleState(r, now)].push(r)
  return out
}
