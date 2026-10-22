import type { ReactNode } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { getStoredGuestSession } from '@platform/shared/api/platformApi'
import { authStorage } from '@platform/shared/api/authStorage'

type TabId = 'explore' | 'saved' | 'trips' | 'host' | 'profile'

type Props = {
  lang: Lang
  onLanguageChange: (lang: Lang) => void
  path: string
  children: ReactNode
}

const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'ar', label: 'العربية' },
  { id: 'en', label: 'EN' },
  { id: 'fr', label: 'FR' },
]

export function activeTabFor(path: string): TabId | null {
  if (path === '/' || path === '' || path === '/home' || path === '/stays' || path.startsWith('/listing/')) return 'explore'
  if (path === '/saved') return 'saved'
  if (path === '/trips' || path === '/dashboard' || path.startsWith('/booking/') || path.startsWith('/payment/')) return 'trips'
  if (path.startsWith('/host') || path.startsWith('/sell/') || path.startsWith('/checkin/')) return 'host'
  if (path === '/profile' || path.startsWith('/account')) return 'profile'
  return null
}

// Slim top bar (text wordmark, language switcher) + a bottom tab bar on phones. On wide screens the
// tabs move into the top bar. The bar is hidden on screens that carry their own fixed bottom
// action (listing page "Reserve", checkout).
export function Shell({ lang, onLanguageChange, path, children }: Props) {
  const signedIn = typeof window !== 'undefined' && Boolean(getStoredGuestSession())
  const isHost = typeof window !== 'undefined' && hasHostRole()
  const active = activeTabFor(path)
  const hideTabs = path.startsWith('/listing/') || path.startsWith('/checkout/')

  const tabs: Array<{ id: TabId; href: string; label: string; icon: ReactNode }> = [
    { id: 'explore', href: '/stays', label: pick(lang, 'استكشف', 'Explore', 'Explorer'), icon: <IconSearch /> },
    { id: 'saved', href: '/saved', label: pick(lang, 'المحفوظات', 'Wishlists', 'Favoris'), icon: <IconHeart /> },
    { id: 'trips', href: '/trips', label: pick(lang, 'رحلاتي', 'Trips', 'Voyages'), icon: <IconSuitcase /> },
    // Hosting on the same account: hosts go to their dashboard, everyone else to "Become a host".
    { id: 'host', href: isHost ? '/host' : '/host/join', label: isHost ? pick(lang, 'الاستضافة', 'Hosting', 'Hôte') : pick(lang, 'استضف', 'Host', 'Accueillir'), icon: <IconHome /> },
    {
      id: 'profile',
      href: signedIn ? '/profile' : '/account/open',
      label: signedIn ? pick(lang, 'حسابي', 'Profile', 'Profil') : pick(lang, 'دخول', 'Log in', 'Connexion'),
      icon: <IconUser />,
    },
  ]

  return (
    <div className="str-app" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <a className="str-skip" href="#str-main" onClick={(event) => { event.preventDefault(); document.getElementById('str-main')?.focus() }}>
        {pick(lang, 'تخطي إلى المحتوى', 'Skip to content', 'Aller au contenu')}
      </a>
      <header className="str-header">
        <a className="str-wordmark" href="#/stays" aria-label="Rezekme">Rezekme</a>
        <nav className="str-topnav" aria-label={pick(lang, 'التنقل', 'Main', 'Navigation')}>
          {tabs.map((tab) => (
            <a key={tab.id} href={`#${tab.href}`} className={active === tab.id ? 'is-active' : undefined} aria-current={active === tab.id ? 'page' : undefined}>
              {tab.label}
            </a>
          ))}
        </nav>
        <div className="str-langs" role="group" aria-label={pick(lang, 'اللغة', 'Language', 'Langue')}>
          {LANGS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={lang === item.id ? 'is-active' : undefined}
              aria-pressed={lang === item.id}
              onClick={() => onLanguageChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div id="str-main" tabIndex={-1} className="str-content">
        {children}
      </div>

      {hideTabs ? null : (
        <nav className="str-tabbar" aria-label={pick(lang, 'التنقل', 'Main', 'Navigation')}>
          {tabs.map((tab) => (
            <a key={tab.id} href={`#${tab.href}`} className={active === tab.id ? 'is-active' : undefined} aria-current={active === tab.id ? 'page' : undefined}>
              {tab.icon}
              <span>{tab.label}</span>
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}

const iconProps = { viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

function IconSearch() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}
function IconHeart() {
  return (
    <svg {...iconProps}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  )
}
function IconSuitcase() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}
function IconUser() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  )
}

function hasHostRole() {
  try {
    const raw = authStorage.getItem('sybnb.v6.staffSession')
    if (!raw) return false
    const roles = (JSON.parse(raw) as { user?: { roles?: string[] } }).user?.roles || []
    return roles.includes('HOST') || roles.includes('SELLER')
  } catch {
    return false
  }
}

function IconHome() {
  return (
    <svg {...iconProps}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  )
}
