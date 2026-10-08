// Three interface languages: Arabic (RTL), English and French (LTR).
export type Lang = 'ar' | 'en' | 'fr'

const STORAGE_KEY = 'sybnb_v6_language'

export function isLang(value: unknown): value is Lang {
  return value === 'ar' || value === 'en' || value === 'fr'
}

export function getInitialLanguage(): Lang {
  if (typeof window === 'undefined') return 'ar'
  // A shared link can choose the language: ?lang=fr (before or after the #).
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang') ||
      new URLSearchParams(window.location.hash.split('?')[1] || '').get('lang')
    if (isLang(fromUrl)) {
      window.localStorage.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
  } catch {
    /* ignore */
  }
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage blocked */
  }
  return isLang(stored) ? stored : 'ar'
}

export function persistLanguage(lang: Lang) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }
}

// Bilingual pairs keep working: French falls back to English when no `fr` is given.
export function text(pair: { ar: string; en: string; fr?: string }, lang: Lang) {
  if (lang === 'ar') return pair.ar
  if (lang === 'fr') return pair.fr ?? pair.en
  return pair.en
}

// Inline three-way choice: pick(lang, 'عربي', 'English', 'Français'). French falls back to English.
export function pick<T>(lang: Lang, ar: T, en: T, fr?: T): T {
  if (lang === 'ar') return ar
  if (lang === 'fr') return fr ?? en
  return en
}
