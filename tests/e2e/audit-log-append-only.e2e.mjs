// The audit log must refuse edits and deletes at the database, even with direct DB access.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
let pass = 0, fail = 0
const ok = (n, c) => { console.log(`   ${c ? 'PASS' : 'FAIL'}  ${n}`); c ? pass++ : fail++ }
const refused = async (fn) => { try { await fn(); return false } catch { return true } }
console.log('=== AUDIT LOG APPEND-ONLY E2E ===')
const tag = Date.now().toString(36)
const u = await db.user.create({ data: { email: `audit-${tag}@example.test`, displayName: 'Audit actor', locale: 'en' } })
const row = await db.adminAuditLog.create({ data: { actorUserId: u.id, action: 'E2E_TEST', entityType: 'e2e', entityId: tag, before: null, after: { a: 1 } } })
ok('a new audit row can be appended', !!row.id)
ok('editing the action is refused', await refused(() => db.adminAuditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } })))
ok('editing the after-state is refused', await refused(() => db.adminAuditLog.update({ where: { id: row.id }, data: { after: { a: 2 } } })))
ok('deleting the row is refused', await refused(() => db.adminAuditLog.delete({ where: { id: row.id } })))
ok('re-pointing the actor to another user is refused', await refused(async () => { const o = await db.user.create({ data: { email: `audit2-${tag}@example.test`, displayName: 'Other', locale: 'en' } }); await db.adminAuditLog.update({ where: { id: row.id }, data: { actorUserId: o.id } }) }))
const still = await db.adminAuditLog.findUnique({ where: { id: row.id } })
ok('the row is unchanged afterwards', still?.action === 'E2E_TEST' && still.actorUserId === u.id)
// Note: this test row is intentionally left behind (the log cannot be cleaned), tagged E2E_TEST.
console.log(`\n==== AUDIT LOG APPEND-ONLY: ${pass} passed, ${fail} failed ====`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
