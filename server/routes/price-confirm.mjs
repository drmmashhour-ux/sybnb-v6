import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed } from '../lib/responses.mjs'

// POST /api/host/listings/:id/confirm-price   (owner only)
// "I re-checked this price today." Stamps metadata.priceConfirmedAt without touching anything else
// and WITHOUT sending a live listing back to review (unlike a content edit), so owners of volatile-
// price listings (property, cars) can re-verify every couple of weeks at no cost. Guests see
// "Price confirmed by owner N days ago" and a stale warning after 14 days.
export async function handlePriceConfirm(req, res, url, context) {
  const match = url.pathname.match(/^\/api\/host\/listings\/([0-9a-f-]{36})\/confirm-price$/)
  if (!match) return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  requireAuth(context, ['HOST', 'SELLER'])

  const existing = await db().listing.findFirst({ where: { id: match[1], ownerId: context.user.id } })
  if (!existing) {
    const error = new Error('Listing not found for this account.')
    error.statusCode = 404
    error.code = 'HOST_LISTING_NOT_FOUND'
    error.expose = true
    throw error
  }

  const priceConfirmedAt = new Date().toISOString()
  const listing = await db().listing.update({
    where: { id: existing.id },
    data: { metadata: { ...(existing.metadata || {}), priceConfirmedAt } },
  })
  await db().adminAuditLog.create({
    data: {
      actorUserId: context.user.id,
      action: 'HOST_LISTING_PRICE_CONFIRMED',
      entityType: 'listings',
      entityId: listing.id,
      before: { priceConfirmedAt: existing.metadata?.priceConfirmedAt ?? null },
      after: { priceConfirmedAt, priceMinor: listing.priceMinor },
    },
  })
  return json(res, 200, { ok: true, listing })
}
