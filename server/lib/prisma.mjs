import { PrismaClient } from '@prisma/client'
import { assertTestDatabaseSafe } from './test-db-guard.mjs'

let prisma

// When NODE_ENV=test, verify the test-database safety guard before ever constructing a
// PrismaClient — this is the single real connection choke-point for the whole app, so it is the
// most reliable place to enforce that a test run can never open a connection to the development
// database. No-op (and zero added cost) for every non-test environment.
export function db() {
  if (!prisma) {
    if (process.env.NODE_ENV === 'test') {
      assertTestDatabaseSafe()
    }
    prisma = new PrismaClient()
  }
  return prisma
}

export async function disconnectDb() {
  if (prisma) {
    await prisma.$disconnect()
    prisma = undefined
  }
}

export async function checkDatabase() {
  await db().$queryRaw`SELECT 1`
  return true
}
