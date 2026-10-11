// Centris-parity Phase 1 (2026-10-10): new-listing alerts for saved searches.
//
// On the server's periodic heartbeat, for each SavedSearch with notifyOnNew, find APPROVED listings
// in its division that became approved AFTER the search was last checked (approvedAt > lastCheckedAt),
// filter them in JS against the saved filter set (the same semantics as the browse query), and push a
// single batched notification per search. lastCheckedAt is advanced every run so nothing re-notifies.
//
// Matching is done in JS (not a Prisma JSON-path where) because the new-listing volume per sweep is
// tiny and JS keeps the filter semantics in one readable place, consistent with how a human reads the
// saved filters.
import { db } from './prisma.mjs'
import { publicListingVisibilityWhere } from './host-verification.mjs'
import { sendPushNotification } from './push-notifications.mjs'
import { log } from './logger.mjs'

const SINGLE_ATTRS = ['carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition', 'propertyType', 'marketCategory']
const ARRAY_ATTRS = ['amenities', 'views', 'access']

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function divisionLabel(division) {
  switch (String(division || '').toUpperCase()) {
    case 'STAYS': return 'stay'
    case 'RENTALS': return 'rental'
    case 'BUY': return 'property'
    case 'CARS': return 'car'
    case 'MARKETPLACE': return 'item'
    case 'NEW_CONSTRUCTION': return 'project'
    default: return 'listing'
  }
}

export function listingMatchesSavedFilters(listing, filters) {
  const f = filters || {}
  const md = listing.metadata || {}
  const vf = (md.visualFilters && typeof md.visualFilters === 'object') ? md.visualFilters : {}

  const pmin = toNum(f.priceMin)
  const pmax = toNum(f.priceMax)
  if (pmin !== undefined && pmin > 0 && listing.priceMinor < pmin) return false
  if (pmax !== undefined && pmax > 0 && listing.priceMinor > pmax) return false

  const bmin = toNum(f.bedroomsMin)
  if (bmin !== undefined && bmin > 0 && !(toNum(md.bedrooms) >= bmin)) return false
  const bamin = toNum(f.bathroomsMin)
  if (bamin !== undefined && bamin > 0 && !(toNum(md.bathrooms) >= bamin)) return false

  for (const k of SINGLE_ATTRS) {
    const want = f[k]
    if (want && want !== 'any' && String(vf[k] ?? '') !== String(want)) return false
  }

  for (const k of ARRAY_ATTRS) {
    let want = f[k]
    if (!want) continue
    if (typeof want === 'string') want = want.split(',').map((s) => s.trim()).filter(Boolean)
    if (Array.isArray(want) && want.length) {
      const have = Array.isArray(vf[k]) ? vf[k].map(String) : []
      if (!want.every((w) => have.includes(String(w)))) return false
    }
  }

  const city = (f.city || '').toString().trim().toLowerCase()
  if (city) {
    const hay = [
      listing.location?.city, listing.location?.area, listing.location?.governorate,
      md.city, md.cityLabel, md.area, md.areaLabel, md.governorate, md.governorateLabel,
    ].filter(Boolean).map((x) => String(x).toLowerCase()).join(' | ')
    if (!hay.includes(city)) return false
  }

  return true
}

export async function runSavedSearchAlerts() {
  let notified = 0
  try {
    const searches = await db().savedSearch.findMany({ where: { notifyOnNew: true }, take: 200 })
    for (const ss of searches) {
      const runStart = new Date()
      const since = ss.lastCheckedAt
      let candidates = []
      try {
        candidates = await db().listing.findMany({
          where: { status: 'APPROVED', division: ss.division, approvedAt: { gt: since }, ...publicListingVisibilityWhere(ss.division) },
          include: { location: true },
          orderBy: { approvedAt: 'asc' },
          take: 50,
        })
      } catch (err) {
        log.warn('saved_search_query_failed', { savedSearchId: ss.id, message: err?.message })
        continue
      }
      // Advance the watermark so a listing is never counted twice. If we hit the page cap (50), there
      // may be more approved rows after the newest one we fetched, so only advance to that row's
      // approvedAt (the rest are picked up next run) instead of jumping to runStart and skipping them.
      const watermark = candidates.length === 50 ? candidates[candidates.length - 1].approvedAt : runStart
      await db().savedSearch.update({ where: { id: ss.id }, data: { lastCheckedAt: watermark } }).catch(() => {})
      if (!candidates.length) continue
      const matches = candidates.filter((l) => listingMatchesSavedFilters(l, ss.filters))
      if (!matches.length) continue
      const n = matches.length
      const label = divisionLabel(ss.division)
      await sendPushNotification(ss.userId, {
        title: `${n} new ${label}${n > 1 ? 's' : ''} for you`,
        body: ss.label ? `New matches for your saved search “${ss.label}”.` : `New ${label} listings match your saved search.`,
        url: '/#/saved',
      }).catch(() => {})
      notified += 1
    }
  } catch (err) {
    log.warn('saved_search_alerts_failed', { message: err?.message })
  }
  return { notified }
}
