// STEP 5 -- sign-in policy bridge. The existing login (server/routes/auth.mjs) demands a fresh
// emailed code and a short session ONLY for accounts holding the legacy ADMIN role. An account that
// holds new-model role assignments but no legacy ADMIN row would otherwise sign in with just a
// password. This helper makes any account with an ACTIVE role assignment count as staff for that
// sign-in policy ONLY (it adds nothing to what the account may do).
import { db } from '../prisma.mjs'

const isAdminRole = (r) => (typeof r === 'string' ? r : r?.role) === 'ADMIN'

export async function staffLoginRoles(user, client = db()) {
  const roles = Array.isArray(user.roles) ? user.roles : []
  if (roles.some(isAdminRole)) return roles
  try {
    const active = await client.roleAssignment.count({ where: { userId: user.id, status: 'ACTIVE' } })
    return active > 0 ? [...roles, { role: 'ADMIN' }] : roles
  } catch (error) {
    // P2021 / 42P01: table not migrated yet -> no assignments can exist -> legacy behaviour.
    if (error?.code === 'P2021' || error?.meta?.code === '42P01' || /does not exist/i.test(String(error?.message))) return roles
    throw error
  }
}
