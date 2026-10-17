import { createHash, randomBytes } from 'node:crypto'
import { db } from './prisma.mjs'

// One-time emailed "open my booking" links (migration 074). The raw token only ever exists in the
// email; the database keeps its SHA-256.
export const MAGIC_LINK_TTL_MS = 72 * 60 * 60 * 1000

const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

export async function createMagicLink({ userId, bookingId = null, now = new Date() }) {
  const token = randomBytes(32).toString('base64url')
  await db().emailLoginLink.create({
    data: { userId, bookingId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS) },
  })
  return token
}

// Atomically consumes the link (only a still-unused, unexpired row flips) and returns it, or null.
export async function consumeMagicLink(token, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null
  const tokenHash = hashToken(token)
  const consumed = await db().emailLoginLink.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  if (consumed.count !== 1) return null
  return db().emailLoginLink.findUnique({ where: { tokenHash } })
}
