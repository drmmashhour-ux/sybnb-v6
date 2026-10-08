import type { Lang } from '../../engines/language/languageEngine'

// One place to pick a listing title for the current language. French has no stored title, so it
// uses the English one, with the demo prefix localized ("Demo —" -> "Démo —").
export function listingDisplayTitle(listing: { titleAr?: string | null; titleEn?: string | null }, lang: Lang): string {
  const ar = listing.titleAr || ''
  const en = listing.titleEn || ar
  if (lang === 'ar') return ar || en
  if (lang === 'fr') return en.replace(/^Demo —\s*/, 'Démo — ')
  return en
}
