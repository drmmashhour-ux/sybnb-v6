import { api, ApiError, applyLang, banner, getLang, h, langToggle, money, mount, registerShell, store, type Lang } from './lite'

// LIGHT STR (daily stays): pick a city -> text list (photos optional, off by default) -> details.
// The last list per city is saved on the phone so it still opens with no signal.
const CITIES: Array<[string, string, string]> = [
  ['Damascus', 'دمشق', 'Damascus'], ['Aleppo', 'حلب', 'Aleppo'], ['Latakia', 'اللاذقية', 'Latakia'],
  ['Tartus', 'طرطوس', 'Tartus'], ['Homs', 'حمص', 'Homs'], ['Hama', 'حماة', 'Hama'],
  ['Rif Dimashq', 'ريف دمشق', 'Rif Dimashq'], ['As-Suwayda', 'السويداء', 'Suwayda'], ['Daraa', 'درعا', 'Daraa'],
  ['Idlib', 'إدلب', 'Idlib'], ['Deir ez-Zor', 'دير الزور', 'Deir ez-Zor'], ['Raqqa', 'الرقة', 'Raqqa'],
  ['Al-Hasakah', 'الحسكة', 'Hasakah'], ['Quneitra', 'القنيطرة', 'Quneitra'],
]
const T = {
  ar: { title: 'إقامات', night: 'لليلة', more: 'عرض المزيد', photos: 'عرض الصور', back: 'رجوع', book: 'احجز', empty: 'لا توجد إقامات الآن.',
    offline: 'لا يوجد اتصال.', saved: 'نسخة محفوظة (بدون إنترنت)', host: 'المضيف', retry: 'إعادة المحاولة' },
  en: { title: 'Stays', night: 'per night', more: 'Show more', photos: 'Show photos', back: 'Back', book: 'Book', empty: 'No stays right now.',
    offline: 'No connection.', saved: 'Saved copy (offline)', host: 'Host', retry: 'Retry' },
}
type L = { id: string; titleAr: string; titleEn: string | null; description: string | null; priceMinor: number; currency: string; location?: { area?: string; city?: string } | null; owner?: { displayName?: string }; media?: Array<{ url?: string; src?: string; assetUrl?: string }> }

const root = document.getElementById('app')!
const none = null as unknown as Node
let lang: Lang = getLang()
let city = store('sybnb.lite.str.city') || 'Damascus'
let showPhotos = store('sybnb.lite.str.photos') === '1'
let items: L[] = []
let cursor: string | null = null
let stale = false

const title = (l: L) => (lang === 'en' && l.titleEn ? l.titleEn : l.titleAr)
const photo = (l: L) => { const m = l.media?.[0]; return m?.url || m?.src || m?.assetUrl || '' }
const flip = () => { lang = lang === 'ar' ? 'en' : 'ar' }
// Booking continues in the full web app (dates, payment, host verification live there).
function bookUrl(id: string) {
  const web = (import.meta.env.VITE_WEB_URL as string) || 'https://sybnb.app'
  const origin = /^https?:$/.test(location.protocol) && location.hostname !== 'localhost' ? '' : web
  return `${origin}/#/listing/${id}`
}
const cacheKey = (c: string) => `sybnb.lite.str.cache.${c}`

async function load(more: boolean) {
  const q = `/api/listings?division=STAYS&city=${encodeURIComponent(city)}${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  try {
    const r = await api<{ listings: L[]; nextCursor: string | null }>(q)
    const slim = r.listings.map((l) => ({ ...l, description: (l.description || '').slice(0, 400), media: (l.media || []).slice(0, 1) }))
    items = more ? items.concat(slim) : slim
    cursor = r.nextCursor
    stale = false
    store(cacheKey(city), JSON.stringify({ items: items.slice(0, 40) }))
    return null
  } catch (e) {
    if (!more) {
      try { items = JSON.parse(store(cacheKey(city)) || '{}').items || [] } catch { items = [] }
      cursor = null
      stale = items.length > 0
    }
    return e instanceof ApiError && !e.offline ? e.message : T[lang].offline
  }
}

async function list(more = false) {
  const t = T[lang]
  const err = await load(more)
  applyLang(lang)
  const chips = h('nav', { class: 'chips' }, ...CITIES.map(([id, ar, en]) =>
    h('button', { type: 'button', class: id === city ? 'chip on' : 'chip', onclick: () => { city = id; store('sybnb.lite.str.city', id); void list() } }, lang === 'ar' ? ar : en)))
  const cards = items.map((l) => h('article', { class: 'card', tabindex: '0', onclick: () => detail(l) },
    showPhotos && photo(l) ? h('img', { src: photo(l), loading: 'lazy', alt: '', width: '96', height: '72' }) : null,
    h('div', {}, h('h2', {}, title(l)), h('p', {}, l.location?.area || l.location?.city || ''), h('p', { class: 'big' }, `${money(l.priceMinor, l.currency)} ${t.night}`))))
  mount(root,
    h('header', {}, h('h1', {}, t.title), h('span', {}, langToggle(lang, () => { flip(); void list() }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', ...(showPhotos ? { checked: true } : {}), onchange: (e: Event) => { showPhotos = (e.target as HTMLInputElement).checked; store('sybnb.lite.str.photos', showPhotos ? '1' : '0'); void list() } }), t.photos))),
    chips,
    h('main', {},
      err ? banner(err) : none,
      stale ? banner(t.saved, 'info') : none,
      ...(cards.length ? cards : err ? [h('button', { type: 'button', class: 'primary', onclick: () => void list() }, t.retry)] : [h('p', {}, t.empty)]),
      cursor ? h('button', { type: 'button', onclick: () => void list(true) }, t.more) : none))
}

function detail(l: L) {
  const t = T[lang]
  window.scrollTo(0, 0)
  mount(root,
    h('header', {}, h('button', { class: 'link', type: 'button', onclick: () => void list() }, `← ${t.back}`), h('span', {}, langToggle(lang, () => { flip(); detail(l) }))),
    h('main', {},
      showPhotos && photo(l) ? h('img', { class: 'hero', src: photo(l), alt: '', loading: 'lazy' }) : none,
      h('h1', {}, title(l)),
      h('p', {}, l.location?.area || l.location?.city || ''),
      h('p', { class: 'big' }, `${money(l.priceMinor, l.currency)} ${t.night}`),
      l.owner?.displayName ? h('p', {}, `${t.host}: ${l.owner.displayName}`) : none,
      h('p', { class: 'desc' }, l.description || ''),
      h('a', { class: 'btn primary', href: bookUrl(l.id) }, t.book)))
}

registerShell('/str.html')
void list()
