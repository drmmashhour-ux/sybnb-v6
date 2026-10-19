import test from 'node:test'
import assert from 'node:assert/strict'
import { staffLoginRoles } from '../../server/lib/authz/staff-login.mjs'
import { requiresAdminLoginCode } from '../../server/lib/admin-login.mjs'

const clientWith = (count) => ({ roleAssignment: { count: async () => count } })

test('legacy ADMIN accounts are unchanged (no database lookup needed)', async () => {
  const roles = [{ role: 'ADMIN' }]
  assert.equal(await staffLoginRoles({ id: 'u', roles }, { roleAssignment: { count: () => { throw new Error('should not be called') } } }), roles)
})

test('an account with an ACTIVE role assignment but no legacy ADMIN now needs the admin sign-in code', async () => {
  const out = await staffLoginRoles({ id: 'u', roles: [{ role: 'GUEST' }] }, clientWith(1))
  assert.equal(requiresAdminLoginCode(out), true)
})

test('an ordinary account (no assignments) is unchanged', async () => {
  const roles = [{ role: 'GUEST' }]
  const out = await staffLoginRoles({ id: 'u', roles }, clientWith(0))
  assert.deepEqual(out, roles)
  assert.equal(requiresAdminLoginCode(out), false)
})

test('a not-yet-migrated database (table missing) falls back to legacy behaviour; other errors propagate', async () => {
  const missing = { roleAssignment: { count: async () => { const e = new Error('The table `public.role_assignments` does not exist'); e.code = 'P2021'; throw e } } }
  assert.deepEqual(await staffLoginRoles({ id: 'u', roles: [] }, missing), [])
  const broken = { roleAssignment: { count: async () => { throw new Error('connection reset') } } }
  await assert.rejects(staffLoginRoles({ id: 'u', roles: [] }, broken), /connection reset/)
})
