import { db } from './prisma.mjs'
import { verifySessionToken } from './security.mjs'

export async function getAuthContext(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const session = token ? verifySessionToken(token) : null
  if (!session?.sub) return null

  // A validly-signed token can only carry a malformed subject if AUTH_SECRET was ever weaker or
  // compromised, or the user id format changes in the future — treat that the same as "no such
  // user" (fail closed to 401) instead of letting Prisma's UUID-parse error (P2023) surface as an
  // unhandled 500.
  let user
  try {
    user = await db().user.findUnique({
      where: { id: session.sub },
      include: { roles: true },
    })
  } catch (error) {
    if (error?.code === 'P2023') return null
    throw error
  }
  if (!user || user.status !== 'ACTIVE') return null

  // Revocation check (F-02): a stateless signed token has no server-side record of its own, so
  // "logging out" or resetting a password can't delete it -- instead those actions bump
  // user.sessionVersion, and any token minted before that bump (recorded as its `sv` claim at
  // issuance) is treated as expired even though its signature and `exp` are still valid.
  const tokenVersion = Number.isInteger(session.sv) ? session.sv : 0
  if (tokenVersion !== user.sessionVersion) return null

  return {
    user,
    roles: user.roles.map((item) => item.role),
  }
}

export function requireAuth(context, roles = []) {
  if (!context?.user) {
    const error = new Error('Authentication required.')
    error.statusCode = 401
    error.code = 'AUTH_REQUIRED'
    error.expose = true
    throw error
  }

  if (roles.length > 0 && !roles.some((role) => context.roles.includes(role))) {
    const error = new Error('This account does not have permission for this V6 action.')
    error.statusCode = 403
    error.code = 'FORBIDDEN'
    error.expose = true
    throw error
  }
}
