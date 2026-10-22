// Stay variable pricing routes (2026-10-22). Engine + storage: server/lib/stay-pricing.mjs.
//
//   GET/PATCH /api/host/listings/:id/pricing   host's own rules (weekend price, weekly/monthly
//                                              discount, opt out of seasons). A pricing-rule change
//                                              does NOT send a live listing back to review -- like a
//                                              per-date calendar price, it is the host's commercial
//                                              choice, not listing content. Audited.
//   GET/PUT  /api/admin/stays/pricing          admin weekend nights + high-season periods. Audited,
//   POST     /api/admin/stays/pricing/preview  re-authorized at commit, version-checked (as SR).
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'
import {
  STAY_PRICING_CATEGORY,
  STAY_PRICING_LIMITS,
  defaultStayPricing,
  getStayPricingConfig,
  invalidateStayPricingCache,
  normalizeHostPricing,
  normalizeStayPricingConfig,
  priceStayNights,
  readStoredStayPricing,
  stayPricingKey,
} from '../lib/stay-pricing.mjs'

function fail(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

function upcomingSeasons(config, today = new Date().toISOString().slice(0, 10)) {
  return config.seasons.filter((season) => season.to >= today)
}

// Worked examples for the admin page: a 100,000 base / 130,000 weekend listing over a few stays.
function examples(config) {
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const nights = (from, count) => Array.from({ length: count }, (_, i) => new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10))
  const sample = { weekendPriceMinor: 130_000, weeklyDiscountPct: 10, monthlyDiscountPct: 20 }
  const rows = [{ label: 'next 3 nights', nights: nights(start, 3) }, { label: 'next 7 nights', nights: nights(start, 7) }]
  for (const season of upcomingSeasons(config).slice(0, 3)) {
    rows.push({ label: `${season.name}: first 3 nights`, nights: nights(new Date(`${season.from}T00:00:00Z`), 3) })
  }
  return rows.map((row) => {
    const priced = priceStayNights({ basePriceMinor: 100_000, nights: row.nights, hostPricing: sample, config })
    return { label: row.label, from: row.nights[0], nights: row.nights.length, subtotalMinor: priced.subtotalMinor, discountMinor: priced.discountMinor, totalMinor: priced.totalMinor }
  })
}

export async function handleStayPricing(req, res, url, context) {
  // Public: which nights are weekend nights and the upcoming high seasons (shown to hosts while
  // they set prices, before the listing exists). No prices, nothing private.
  if (url.pathname === '/api/stays/pricing-info') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const config = await getStayPricingConfig()
    return json(res, 200, { ok: true, weekendNights: config.weekendNights, seasons: upcomingSeasons(config), limits: STAY_PRICING_LIMITS })
  }

  const hostMatch = url.pathname.match(/^\/api\/host\/listings\/([^/]+)\/pricing$/)
  if (hostMatch) {
    requireAuth(context, ['HOST', 'SELLER', 'ADMIN'])
    const isAdminActor = context.roles.includes('ADMIN')
    const existing = await db().listing.findFirst({
      where: isAdminActor ? { id: hostMatch[1] } : { id: hostMatch[1], ownerId: context.user.id },
      select: { id: true, division: true, priceMinor: true, currency: true, metadata: true },
    })
    if (!existing) fail(404, 'HOST_LISTING_NOT_FOUND', 'Listing not found for this host account.')
    if (existing.division !== 'STAYS') fail(400, 'PRICING_STAYS_ONLY', 'Pricing rules apply to stays only.')
    const config = await getStayPricingConfig()
    if (req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        pricing: normalizeHostPricing(existing.metadata?.pricing, existing.priceMinor),
        basePriceMinor: existing.priceMinor,
        currency: existing.currency,
        weekendNights: config.weekendNights,
        seasons: upcomingSeasons(config),
        limits: STAY_PRICING_LIMITS,
      })
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req)
      const weekendRaw = body?.weekendPriceMinor
      if (weekendRaw != null && weekendRaw !== '' && !(Number(weekendRaw) > 0)) fail(400, 'PRICING_WEEKEND_INVALID', 'The weekend price must be greater than zero, or empty.')
      if (weekendRaw != null && weekendRaw !== '' && Number(weekendRaw) > existing.priceMinor * 10) fail(400, 'PRICING_WEEKEND_TOO_HIGH', 'The weekend price is more than 10 times the nightly price. Check for an extra zero.')
      const pricing = normalizeHostPricing(
        {
          weekendPriceMinor: weekendRaw === '' ? null : weekendRaw,
          weeklyDiscountPct: body?.weeklyDiscountPct,
          monthlyDiscountPct: body?.monthlyDiscountPct,
          seasonalOptOut: body?.seasonalOptOut === true,
        },
        existing.priceMinor,
      )
      const before = normalizeHostPricing(existing.metadata?.pricing, existing.priceMinor)
      const metadata = { ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}), pricing }
      await db().$transaction(async (tx) => {
        await tx.listing.update({ where: { id: existing.id }, data: { metadata } })
        await tx.adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: isAdminActor ? 'ADMIN_LISTING_PRICING_EDIT' : 'HOST_LISTING_PRICING_EDIT',
            entityType: 'listings',
            entityId: existing.id,
            before: { pricing: before },
            after: { pricing },
          },
        })
      })
      return json(res, 200, { ok: true, pricing })
    }
    return methodNotAllowed(res, ['GET', 'PATCH'])
  }

  if (url.pathname === '/api/admin/stays/pricing' || url.pathname === '/api/admin/stays/pricing/preview') {
    requireAuth(context, ['ADMIN'])
    const preview = url.pathname.endsWith('/preview')
    if (req.method === 'GET' && !preview) {
      const row = await readStoredStayPricing()
      const config = normalizeStayPricingConfig(row?.value ?? defaultStayPricing())
      return json(res, 200, {
        ok: true,
        stored: Boolean(row),
        version: row?.version ?? 0,
        updatedAt: row?.updatedAt ?? null,
        config,
        defaults: normalizeStayPricingConfig(defaultStayPricing()),
        limits: STAY_PRICING_LIMITS,
        examples: examples(config),
      })
    }
    if (req.method === 'POST' && preview) {
      const body = await readJson(req)
      const config = normalizeStayPricingConfig(body?.config)
      return json(res, 200, { ok: true, config, examples: examples(config) })
    }
    if (req.method === 'PUT' && !preview) {
      const body = await readJson(req)
      const reason = String(body?.reason || '').trim()
      if (reason.length < 8 || reason.length > 300) fail(400, 'PRICING_REASON_REQUIRED', 'Write a reason of 8 to 300 characters. It goes in the audit log.')
      const config = normalizeStayPricingConfig(body?.config)
      const existing = await readStoredStayPricing()
      if (existing && body?.expectedVersion != null && Number(body.expectedVersion) !== existing.version) {
        fail(409, 'PRICING_VERSION_CONFLICT', 'Stay pricing changed since you loaded it. Reload and try again.')
      }
      const saved = await db().$transaction(async (tx) => {
        await reauthorizeAtCommit(tx, context, { action: 'STAY_PRICING_CHANGED', requiredRoles: ['ADMIN'] })
        const row = existing
          ? await tx.adminSetting.update({ where: { id: existing.id }, data: { value: config, version: { increment: 1 }, updatedById: context.user.id, updatedAt: new Date() } })
          : await tx.adminSetting.create({ data: { category: STAY_PRICING_CATEGORY, key: stayPricingKey(), value: config, updatedById: context.user.id } })
        await tx.adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: 'STAY_PRICING_CHANGED',
            entityType: 'admin_settings',
            entityId: row.id,
            before: existing ? { value: existing.value, version: existing.version } : null,
            after: { value: config, version: row.version },
            reason,
          },
        })
        return row
      })
      invalidateStayPricingCache()
      return json(res, 200, { ok: true, version: saved.version, config, examples: examples(config) })
    }
    return methodNotAllowed(res, preview ? ['POST'] : ['GET', 'PUT'])
  }

  return false
}
