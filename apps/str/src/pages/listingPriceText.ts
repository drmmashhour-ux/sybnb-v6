import type { Lang } from '@platform/engines/language/languageEngine'
import { moneyText } from '@platform/shared/i18n/display'

// Price as shown on result cards: STAYS are priced per night, RENTALS per month; every other
// division (buy, cars, marketplace, new construction) is a one-off price with no unit.
export function listingPriceText(listing: { division?: string; priceMinor: number; currency: string; metadata?: Record<string, unknown> | null }, lang: Lang): string {
  // Cars auctions (metadata.auction): show the live top bid (or the starting price before any bid)
  // instead of the fixed asking price.
  const auction = (listing.metadata as { auction?: { isAuction?: boolean; currentBidMinor?: number | null; startMinor?: number } } | null | undefined)?.auction
  if (auction?.isAuction) {
    const hasBid = typeof auction.currentBidMinor === 'number' && auction.currentBidMinor != null
    const amt = hasBid ? (auction.currentBidMinor as number) : (typeof auction.startMinor === 'number' ? auction.startMinor : listing.priceMinor)
    const label = lang === 'ar' ? (hasBid ? 'أعلى مزايدة' : 'سعر البداية') : lang === 'fr' ? (hasBid ? 'enchère' : 'départ') : (hasBid ? 'top bid' : 'start')
    return `${moneyText(amt, listing.currency, lang)} · ${label}`
  }
  const amount = moneyText(listing.priceMinor, listing.currency, lang)
  const division = String(listing.division || '').toUpperCase()
  if (division === 'STAYS') return `${amount} / ${lang === 'ar' ? 'ليلة' : lang === 'fr' ? 'nuit' : 'night'}`
  if (division === 'RENTALS') return `${amount} / ${lang === 'ar' ? 'شهر' : lang === 'fr' ? 'mois' : 'month'}`
  return amount
}
