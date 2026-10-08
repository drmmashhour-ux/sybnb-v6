import type { Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'

// Price as shown on result cards: STAYS are priced per night, RENTALS per month; every other
// division (buy, cars, marketplace, new construction) is a one-off price with no unit.
export function listingPriceText(listing: { division?: string; priceMinor: number; currency: string }, lang: Lang): string {
  const amount = moneyText(listing.priceMinor, listing.currency, lang)
  const division = String(listing.division || '').toUpperCase()
  if (division === 'STAYS') return `${amount} / ${lang === 'ar' ? 'ليلة' : lang === 'fr' ? 'nuit' : 'night'}`
  if (division === 'RENTALS') return `${amount} / ${lang === 'ar' ? 'شهر' : lang === 'fr' ? 'mois' : 'month'}`
  return amount
}
