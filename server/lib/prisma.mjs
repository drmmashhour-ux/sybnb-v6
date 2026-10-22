import { PrismaClient } from '@prisma/client'

let prisma

// Connection pool sizing (scale, 2026-10-22). Prisma's default pool is CPUs*2+1, which on a small
// container is 3-5 connections: under load every request queued for a connection and failed with
// P2024 after 10 s (measured at 500 simulated drivers). DB_POOL_SIZE / DB_POOL_TIMEOUT_S set
// connection_limit / pool_timeout explicitly unless DATABASE_URL already carries them. Size it as
// (database or pooler max connections) / (number of API replicas), leaving headroom for migrations
// and admin tools. Behind PgBouncer / Neon's pooler, also append pgbouncer=true to DATABASE_URL.
export function databaseUrlWithPool(raw = process.env.DATABASE_URL, env = process.env) {
  if (!raw) return raw
  let url
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  const size = Number(env.DB_POOL_SIZE)
  const timeout = Number(env.DB_POOL_TIMEOUT_S)
  if (Number.isFinite(size) && size > 0 && !url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', String(Math.trunc(size)))
  if (Number.isFinite(timeout) && timeout > 0 && !url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', String(Math.trunc(timeout)))
  return url.toString()
}

export function db() {
  if (!prisma) {
    const url = databaseUrlWithPool()
    prisma = url && url !== process.env.DATABASE_URL ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient()
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
