// Market insights (migration 064, 2026-10-11). Centris-parity "market statistics", adapted: SYBNB
// has no sold-transaction data yet, so stats are computed from ACTIVE (APPROVED) listing asking
// prices. Grows into true history as sales accumulate. Public, read-only.
import { db } from '../lib/prisma.mjs'
import { json, methodNotAllowed } from '../lib/responses.mjs'

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function stats(prices) {
  if (!prices.length) return null
  const sum = prices.reduce((a, b) => a + b, 0)
  return {
    count: prices.length,
    avg: Math.round(sum / prices.length),
    median: median(prices),
    min: Math.min(...prices),
    max: Math.max(...prices),
  }
}

export async function handleMarket(req, res, url, context) {
  if (url.pathname !== '/api/market/insights') return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  const division = url.searchParams.get('division') || undefined
  const city = url.searchParams.get('city') || undefined
  const currency = (url.searchParams.get('currency') || 'USD').toUpperCase()

  const rows = await db().listing.findMany({
    where: {
      status: 'APPROVED',
      currency,
      ...(division ? { division } : {}),
      ...(city ? { location: { city: { equals: city, mode: 'insensitive' } } } : {}),
    },
    select: { priceMinor: true, location: { select: { city: true, area: true } } },
    take: 5000,
  })

  const allPrices = rows.map((r) => r.priceMinor).filter((p) => Number.isFinite(p) && p > 0)

  // Per-area breakdown (area when present, else city).
  const byAreaMap = new Map()
  for (const r of rows) {
    if (!Number.isFinite(r.priceMinor) || r.priceMinor <= 0) continue
    const key = r.location?.area || r.location?.city || '—'
    if (!byAreaMap.has(key)) byAreaMap.set(key, [])
    byAreaMap.get(key).push(r.priceMinor)
  }
  const byArea = [...byAreaMap.entries()]
    .map(([area, prices]) => ({ area, ...stats(prices) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return json(res, 200, {
    ok: true,
    currency,
    division: division || null,
    city: city || null,
    overall: stats(allPrices),
    byArea,
    disclaimer: 'Based on current asking prices of active listings, not completed sales.',
  })
}
