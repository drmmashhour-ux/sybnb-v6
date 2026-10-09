// SYBNB — seed the fixed synthetic user ids scripts/run-all-e2e.sh passes to the governed e2e suites
// (SELLER1, SELLER2, BUYER, ADMIN, HOST, GUEST, GUEST2) into an EMPTY test database, so CI can run
// them against a freshly migrated Postgres. Dev/CI tool only: refuses to run in production.
// Idempotent (upserts). Ids default to the same values run-all-e2e.sh uses and honour the same env
// overrides. Usage: DATABASE_URL=... node scripts/ci-seed-e2e-fixtures.mjs
import { db, disconnectDb } from '../server/lib/prisma.mjs'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed synthetic e2e fixtures with NODE_ENV=production.')
  process.exit(2)
}

const FIXTURES = [
  ['SELLER1', '1fdde54d-20f1-41ae-9f9a-2a4482f13c69', ['SELLER', 'GUEST']],
  ['SELLER2', 'f845e528-dff8-404f-b9ef-6f096fefd9c5', ['SELLER', 'GUEST']],
  ['BUYER', 'b2cf0295-8b24-4be0-a014-8b9321c44e0a', ['GUEST']],
  ['ADMIN', 'c6b57605-18aa-4093-bd99-264185de4b26', ['ADMIN']],
  ['HOST', '480b860e-f32f-4089-a34b-5bbeec33952f', ['HOST', 'GUEST']],
  ['GUEST', 'e14887c6-6fff-4cab-bcea-62e1b976ea61', ['GUEST']],
  ['GUEST2', 'ec554c79-c1e4-451a-b65c-206486a5a491', ['GUEST']],
]

try {
  for (const [name, defaultId, roles] of FIXTURES) {
    const id = process.env[name] || defaultId
    await db().user.upsert({
      where: { id },
      create: { id, email: `e2e-${name.toLowerCase()}@example.test`, displayName: `E2E ${name}`, locale: 'ar-SY' },
      update: {},
    })
    for (const role of roles) {
      await db().userRole.upsert({
        where: { userId_role: { userId: id, role } },
        create: { userId: id, role },
        update: {},
      })
    }
    console.log(`seeded ${name} ${id} [${roles.join(', ')}]`)
  }
} finally {
  await disconnectDb()
}
