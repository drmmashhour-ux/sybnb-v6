// Client-side keyword matching for browse results (the listings API has no keyword parameter).
// Case-insensitive and Arabic-normalized: diacritics/tatweel removed and the common letter
// variants folded (أ/إ/آ -> ا, ة -> ه, ى -> ي, ؤ -> و, ئ -> ي), so "مكيف" matches "مُكيّف".
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
}

type KeywordSearchable = {
  titleAr?: string | null
  titleEn?: string | null
  description?: string | null
  metadata?: unknown
}

// Every word of the keyword must appear somewhere in the listing's titles or description.
export function listingMatchesKeyword(listing: KeywordSearchable, keyword: string): boolean {
  const terms = normalizeSearchText(keyword).split(' ').filter(Boolean)
  if (!terms.length) return true
  const metadata = (listing.metadata && typeof listing.metadata === 'object' ? listing.metadata : {}) as Record<string, unknown>
  const haystack = normalizeSearchText(
    [listing.titleAr, listing.titleEn, listing.description, metadata.descriptionEn, metadata.descriptionAr].filter(Boolean).join(' '),
  )
  return terms.every((term) => haystack.includes(term))
}
