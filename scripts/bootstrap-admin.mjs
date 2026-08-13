// SYBNB V6 — safe admin/support provisioning (no manual SQL).
//
// Grants an ADMIN (or SUPPORT) role to an EXISTING user, identified by email. Idempotent: if the
// role already exists it reports and exits 0. This closes the launch-blocking gap where the only
// way to create an operator was a raw `INSERT INTO user_roles`.
//
// It never creates users and never grants a role from client/browser input — it is an operator
// CLI run against the server environment (requires DATABASE_URL). ADMIN/SUPPORT remain
// un-self-registerable via the API (auth.rejects them); this script is the governed grant path.
//
// Usage:
//   DATABASE_URL="postgresql://.../sybnb_v6?schema=public" \
//     node scripts/bootstrap-admin.mjs --email owner@example.com [--role ADMIN|SUPPORT]
//   (or: npm run bootstrap:admin -- --email owner@example.com)

import { PrismaClient } from '@prisma/client'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const email = arg('email')
const role = (arg('role') || 'ADMIN').toUpperCase()

if (!email) {
  console.error('Missing --email. Usage: node scripts/bootstrap-admin.mjs --email <user-email> [--role ADMIN|SUPPORT]')
  process.exit(2)
}
if (!['ADMIN', 'SUPPORT'].includes(role)) {
  console.error(`Invalid --role "${role}". Allowed: ADMIN, SUPPORT.`)
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set (the server database to grant the role in).')
  process.exit(2)
}

const prisma = new PrismaClient()
try {
  const user = await prisma.user.findUnique({ where: { email }, include: { roles: true } })
  if (!user) {
    console.error(`No user found with email "${email}". Create the account first (self-register as GUEST), then grant.`)
    process.exit(1)
  }
  if (user.roles.some((r) => r.role === role)) {
    console.log(`No change: ${email} already has role ${role}.`)
    process.exit(0)
  }
  await prisma.userRole.create({ data: { userId: user.id, role } })
  const after = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } })
  console.log(`Granted ${role} to ${email}. Roles now: ${after.map((r) => r.role).join(', ')}.`)
  process.exit(0)
} catch (err) {
  console.error('Failed to grant role:', err?.message || err)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
