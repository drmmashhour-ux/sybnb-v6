import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react'
import { getCurrentPath } from '@platform/app/routes'
import { getInitialLanguage, persistLanguage, pick, type Lang } from '@platform/engines/language/languageEngine'
import { authStorage } from '@platform/shared/api/authStorage'
import { refreshStoredSessionRoles } from '@platform/shared/api/platformApi'
import { isTrustProtectionRoute } from '@platform/modules/trust/trustRoutes'
import { Shell } from './Shell'

function lazyNamed<T extends Record<string, unknown>, K extends keyof T>(loader: () => Promise<T>, exportName: K) {
  return lazy(async () => ({ default: (await loader())[exportName] as ComponentType<any> }))
}

// Own (restyled) copies of the stays pages.
const SearchPreviewPage = lazyNamed(() => import('./pages/SearchPreviewPage'), 'SearchPreviewPage')
const ListingDetailPage = lazyNamed(() => import('./pages/ListingDetailPage'), 'ListingDetailPage')
const CheckoutPage = lazyNamed(() => import('./pages/CheckoutPage'), 'CheckoutPage')
const BookingDetailPage = lazyNamed(() => import('./pages/BookingDetailPage'), 'BookingDetailPage')
const SavedPage = lazyNamed(() => import('./pages/SavedPage'), 'SavedPage')
const TripsPage = lazyNamed(() => import('./pages/TripsPage'), 'TripsPage')
const ProfilePage = lazyNamed(() => import('./pages/ProfilePage'), 'ProfilePage')

// Platform pages reused as-is (account sign-in, payment rails, receipts, trust/dispute screens,
// host inbox, legal text). They keep the platform's own look.
const GuestAccountPage = lazyNamed(() => import('@platform/modules/account/GuestAccountPage'), 'GuestAccountPage')
const LegalDocumentPage = lazyNamed(() => import('@platform/modules/legal/LegalDocumentPage'), 'LegalDocumentPage')
const PaymentReceiptPage = lazyNamed(() => import('@platform/modules/payments/PaymentReceiptPage'), 'PaymentReceiptPage')
const SyrianLocalWalletPaymentPage = lazyNamed(
  () => import('@platform/modules/payments/SyrianLocalWalletPaymentPage'),
  'SyrianLocalWalletPaymentPage',
)
const TrustProtectionRoutes = lazyNamed(() => import('@platform/modules/trust/TrustProtectionRoutes'), 'TrustProtectionRoutes')
const ImmocontactPage = lazyNamed(() => import('@platform/modules/immocontact/ImmocontactPage'), 'ImmocontactPage')

export function App() {
  const [lang, setLang] = useState<Lang>(() => getInitialLanguage())
  const [path, setPath] = useState(() => getCurrentPath())
  const [, setAuthVersion] = useState(0)

  useEffect(() => {
    persistLanguage(lang)
  }, [lang])

  useEffect(() => {
    // New route: back to the top and move focus into the content so navigation is announced.
    window.scrollTo(0, 0)
    document.getElementById('str-main')?.focus({ preventScroll: true })
  }, [path])

  // The stored session's roles are a copy taken at sign-in; refresh them once per app load.
  useEffect(() => {
    void refreshStoredSessionRoles({ minIntervalMs: 0 })
  }, [])

  useEffect(() => {
    const sync = () => setPath(getCurrentPath())
    const syncAuth = () => setAuthVersion((version) => version + 1)
    window.addEventListener('hashchange', sync)
    window.addEventListener('sybnb-session-changed', syncAuth)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('sybnb-session-changed', syncAuth)
    }
  }, [])

  const bookingMatch = path.match(/^\/booking\/([^/]+)$/)
  const listingMatch = path.match(/^\/listing\/([^/]+)$/)
  // "Confirm and pay" is deliberately NOT gated: the page signs the guest in inline and keeps every
  // choice (dates, protection, payment method) while they do.
  const checkoutMatch = path.match(/^\/checkout\/([^/]+)$/)
  const paymentReceiptMatch = path.match(/^\/payment\/receipt\/([^/]+)$/)
  const bookingPaymentMatch = path.match(/^\/payment\/local-wallet\/([^/]+)\/(\d+)\/([^/]+)$/)
  const guestAccountMatch = path.match(/^\/account\/open(?:\/([^/]+))?$/)
  // Booking sub-routes (protection / guarantee / payment-status / dispute) call requireAuth()
  // endpoints for one guest's data, like the bare /booking/:id route.
  const trustBookingSubRouteMatch = /^\/booking\/(protection|guarantee|payment-status|dispute|dispute-closed)\/[^/]+$/.test(path)
  const guestProtectedRoute =
    path === '/profile' || path === '/trust-center/verification' || trustBookingSubRouteMatch || Boolean(bookingMatch || bookingPaymentMatch || paymentReceiptMatch)
  const guestGateFlow = path === '/profile' || path === '/trust-center/verification' || trustBookingSubRouteMatch ? 'generic' : 'stays'
  const hasGuestSession = Boolean(authStorage.getItem('sybnb-v6-guest-token'))
  const hasAnyStaffSession = hasAnyValidStaffSession()
  const contactProtectedRoute = path === '/immocontact'
  const needsGuestAccountGate = (guestProtectedRoute && !hasGuestSession) || (contactProtectedRoute && !hasGuestSession && !hasAnyStaffSession)

  if (needsGuestAccountGate) {
    try {
      sessionStorage.setItem('sybnb.v6.guestReturnPath', path)
    } catch {
      // storage blocked: the account page falls back to /stays
    }
  }

  return (
    <Shell lang={lang} onLanguageChange={setLang} path={path}>
      <Suspense fallback={<RouteLoading lang={lang} />}>
        {needsGuestAccountGate ? (
          <GuestAccountPage lang={lang} flow={guestGateFlow} returnPath={path} />
        ) : guestAccountMatch ? (
          <GuestAccountPage
            lang={lang}
            listingId={guestAccountMatch[1]}
            flow={guestAccountMatch[1] ? 'stays' : 'generic'}
            returnPath={guestAccountMatch[1] ? `/listing/${guestAccountMatch[1]}` : undefined}
          />
        ) : path === '/account' ? (
          <GuestAccountPage lang={lang} flow="generic" />
        ) : isTrustProtectionRoute(path) ? (
          <TrustProtectionRoutes lang={lang} path={path} />
        ) : path === '/saved' ? (
          <SavedPage lang={lang} />
        ) : path === '/trips' || path === '/dashboard' ? (
          <TripsPage lang={lang} />
        ) : path === '/profile' ? (
          <ProfilePage lang={lang} />
        ) : path === '/immocontact' ? (
          <ImmocontactPage lang={lang} />
        ) : path === '/terms' ? (
          <LegalDocumentPage lang={lang} page="terms" />
        ) : path === '/privacy' ? (
          <LegalDocumentPage lang={lang} page="privacy" />
        ) : bookingMatch ? (
          <BookingDetailPage bookingId={bookingMatch[1]} lang={lang} />
        ) : checkoutMatch ? (
          <CheckoutPage listingId={checkoutMatch[1]} lang={lang} />
        ) : listingMatch ? (
          <ListingDetailPage listingId={listingMatch[1]} lang={lang} />
        ) : paymentReceiptMatch ? (
          <PaymentReceiptPage lang={lang} proofId={paymentReceiptMatch[1]} />
        ) : bookingPaymentMatch ? (
          <SyrianLocalWalletPaymentPage
            lang={lang}
            bookingId={bookingPaymentMatch[1]}
            amountMinor={Number(bookingPaymentMatch[2])}
            currency={decodeURIComponent(bookingPaymentMatch[3])}
          />
        ) : path === '/' || path === '' || path === '/home' || path === '/stays' || path === '/search-preview' ? (
          <SearchPreviewPage lang={lang} />
        ) : (
          <NotFound lang={lang} />
        )}
      </Suspense>
    </Shell>
  )
}

function hasAnyValidStaffSession() {
  try {
    const raw = authStorage.getItem('sybnb.v6.staffSession')
    if (!raw) return false
    const session = JSON.parse(raw) as { token?: string; user?: { roles?: string[] } }
    return Boolean(session.token && session.user?.roles?.length)
  } catch {
    return false
  }
}

function RouteLoading({ lang }: { lang: Lang }) {
  return (
    <main className="str-page" aria-busy="true">
      <div className="str-skeleton str-skeleton-line" style={{ width: '40%', height: 24 }} />
      <span className="str-sr-only">{pick(lang, 'جاري التحميل...', 'Loading...', 'Chargement...')}</span>
    </main>
  )
}

function NotFound({ lang }: { lang: Lang }) {
  return (
    <main className="str-page str-narrow" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h1 className="str-h1">{pick(lang, 'الصفحة غير موجودة', 'Page not found', 'Page introuvable')}</h1>
      <button type="button" className="str-btn str-btn-primary str-btn-inline" onClick={() => (window.location.hash = '/stays')}>
        {pick(lang, 'العودة إلى الاستكشاف', 'Back to Explore', 'Retour à Explorer')}
      </button>
    </main>
  )
}
