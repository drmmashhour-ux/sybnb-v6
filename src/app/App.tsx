import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react'
import { findDivisionByRoute } from '../engines/navigation/divisions'
import type { Lang } from '../engines/language/languageEngine'
import { getInitialLanguage, persistLanguage, text } from '../engines/language/languageEngine'
import { AppShell } from '../shared/layout/AppShell'
import { isSellerRoute } from '../modules/seller/sellerRoutes'
import { isTrustProtectionRoute } from '../modules/trust/trustRoutes'
import { isGiftFlowRoute } from '../modules/wallet/giftRoutes'
import { getCurrentPath } from './routes'

const AdminReviewPage = lazyNamed(() => import('../modules/admin/AdminReviewPage'), 'AdminReviewPage')
const AiBrainPage = lazyNamed(() => import('../modules/ai/AiBrainPage'), 'AiBrainPage')
const BookingDetailPage = lazyNamed(() => import('../modules/bookings/BookingDetailPage'), 'BookingDetailPage')
const BookingReviewPage = lazyNamed(() => import('../modules/bookings/BookingReviewPage'), 'BookingReviewPage')
const CompetitorsPage = lazyNamed(() => import('../modules/competitors/CompetitorsPage'), 'CompetitorsPage')
const DashboardPage = lazyNamed(() => import('../modules/dashboard/DashboardPage'), 'DashboardPage')
const DivisionLivePage = lazyNamed(() => import('../modules/divisions/DivisionLivePage'), 'DivisionLivePage')
const DriverDashboardPage = lazyNamed(() => import('../modules/driver/DriverDashboardPage'), 'DriverDashboardPage')
const FinanceReconciliationPage = lazyNamed(() => import('../modules/finance/FinanceReconciliationPage'), 'FinanceReconciliationPage')
const GiftFlowRoutes = lazyNamed(() => import('../modules/wallet/GiftFlowRoutes'), 'GiftFlowRoutes')
const GuestAccountPage = lazyNamed(() => import('../modules/account/GuestAccountPage'), 'GuestAccountPage')
const HostDashboardPage = lazyNamed(() => import('../modules/host/HostDashboardPage'), 'HostDashboardPage')
const HostEarningsPage = lazyNamed(() => import('../modules/host/HostEarningsPage'), 'HostEarningsPage')
const HostInsightsPanel = lazyNamed(() => import('../modules/host/HostInsightsPanel'), 'HostInsightsPanel')
const HostInquiriesPage = lazyNamed(() => import('../modules/host/HostInquiriesPage'), 'HostInquiriesPage')
const ImmocontactPage = lazyNamed(() => import('../modules/immocontact/ImmocontactPage'), 'ImmocontactPage')
const LandingPage = lazyNamed(() => import('../modules/landing/LandingPage'), 'LandingPage')
const LegalPlaceholderPage = lazyNamed(() => import('../modules/legal/LegalPlaceholderPage'), 'LegalPlaceholderPage')
const ListingDetailPage = lazyNamed(() => import('../modules/listings/ListingDetailPage'), 'ListingDetailPage')
const OperationsCalendarPage = lazyNamed(() => import('../modules/operations/OperationsCalendarPage'), 'OperationsCalendarPage')
const PaymentReceiptPage = lazyNamed(() => import('../modules/payments/PaymentReceiptPage'), 'PaymentReceiptPage')
const PlatformStatusPage = lazyNamed(() => import('../modules/status/PlatformStatusPage'), 'PlatformStatusPage')
const RentalsPage = lazyNamed(() => import('../modules/rentals/RentalsPage'), 'RentalsPage')
const SearchPreviewPage = lazyNamed(() => import('../modules/search/SearchPreviewPage'), 'SearchPreviewPage')
const SellerDivisionRoutes = lazyNamed(() => import('../modules/seller'), 'SellerDivisionRoutes')
const SrRidePage = lazyNamed(() => import('../modules/sr/SrRidePage'), 'SrRidePage')
const StaffAccessPage = lazyNamed(() => import('../modules/account/StaffAccessPage'), 'StaffAccessPage')
const SyrianLocalWalletPaymentPage = lazyNamed(
  () => import('../modules/payments/SyrianLocalWalletPaymentPage'),
  'SyrianLocalWalletPaymentPage',
)
const TrustProtectionRoutes = lazyNamed(() => import('../modules/trust/TrustProtectionRoutes'), 'TrustProtectionRoutes')
const WalletPage = lazyNamed(() => import('../modules/wallet-live/WalletPage'), 'WalletPage')

function lazyNamed<T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) {
  return lazy(async () => ({ default: (await loader())[exportName] as ComponentType<any> }))
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => getInitialLanguage())
  const [path, setPath] = useState(() => getCurrentPath())
  const [, setAuthVersion] = useState(0)

  useEffect(() => {
    persistLanguage(lang)
  }, [lang])

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

  const division = findDivisionByRoute(path)
  const bookingMatch = path.match(/^\/booking\/([^/]+)$/)
  const bookingReviewMatch = path.match(/^\/booking\/review\/([^/]+)$/)
  const listingMatch = path.match(/^\/listing\/([^/]+)$/)
  const paymentReceiptMatch = path.match(/^\/payment\/receipt\/([^/]+)$/)
  const bookingPaymentMatch = path.match(/^\/payment\/local-wallet\/([^/]+)\/(\d+)\/([^/]+)$/)
  const guestAccountMatch = path.match(/^\/account\/open(?:\/([^/]+))?$/)
  const guestProtectedRoute = path === '/dashboard' || path === '/account' || path === '/wallet' || path === '/ride' || path === '/ride-preview' || Boolean(bookingMatch || bookingReviewMatch || bookingPaymentMatch || paymentReceiptMatch)
  const guestGateFlow = path === '/ride' || path === '/ride-preview' ? 'ride' : path === '/dashboard' || path === '/account' || path === '/wallet' ? 'generic' : 'stays'
  const hasGuestSession = typeof window !== 'undefined' && Boolean(sessionStorage.getItem('sybnb-v6-guest-token'))
  const staffRequiredRole = getStaffRequiredRole(path)
  const hasStaffSession = typeof window !== 'undefined' && hasRequiredStaffSession(staffRequiredRole)
  const hasAnyStaffSession = typeof window !== 'undefined' && hasAnyValidStaffSession()
  const contactProtectedRoute = path === '/immocontact'
  const needsGuestAccountGate = (guestProtectedRoute && !hasGuestSession) || (contactProtectedRoute && !hasGuestSession && !hasAnyStaffSession)

  if (needsGuestAccountGate && typeof window !== 'undefined') {
    sessionStorage.setItem('sybnb.v6.guestReturnPath', path)
  }

  return (
    <AppShell lang={lang} onLanguageChange={setLang} path={path}>
      <Suspense fallback={<RouteLoading lang={lang} />}>
        {needsGuestAccountGate ? (
          <GuestAccountPage lang={lang} flow={guestGateFlow} returnPath={path} />
        ) : staffRequiredRole && !hasStaffSession ? (
          <StaffAccessPage lang={lang} role={staffRequiredRole} returnPath={path} />
        ) : isGiftFlowRoute(path) ? (
          <GiftFlowRoutes lang={lang} path={path} />
        ) : isTrustProtectionRoute(path) ? (
          <TrustProtectionRoutes lang={lang} path={path} />
        ) : guestAccountMatch ? (
          // No hardcoded '/stays' fallback here: when there's no listing id in the URL (e.g. the
          // Rentals/Buy in-page capsule search's "open account" button, which navigates to plain
          // /account/open), GuestAccountPage's own returnPath fallback chain reads the specific
          // return path those pages already write to sessionStorage (sybnb.v6.guestReturnPath)
          // before the account gate. Hardcoding '/stays' here overrode that and silently sent
          // every non-listing-scoped signup back to the Stays search page.
          <GuestAccountPage lang={lang} listingId={guestAccountMatch[1]} returnPath={guestAccountMatch[1] ? `/listing/${guestAccountMatch[1]}` : undefined} />
        ) : path === '/dashboard' || path === '/account' ? (
          <DashboardPage lang={lang} />
        ) : path === '/host' ||
          path === '/host/seller' ||
          path === '/host/stays' ||
          path === '/host/cars' ||
          path === '/host/new-construction' ||
          path === '/host/marketplace' ? (
          <HostDashboardPage
            lang={lang}
            mode={path === '/host/stays' || path === '/host' ? 'host' : 'seller'}
            focus={hostFocusFromPath(path)}
          />
        ) : path === '/host/earnings' ? (
          <HostEarningsPage lang={lang} />
        ) : path === '/host/insights' ? (
          <HostInsightsPanel lang={lang} />
        ) : path === '/host/inquiries' ? (
          <HostInquiriesPage lang={lang} />
        ) : path === '/driver' ? (
          <DriverDashboardPage lang={lang} />
        ) : path === '/immocontact' ? (
          <ImmocontactPage lang={lang} />
        ) : path === '/admin/review' ? (
          <AdminReviewPage lang={lang} />
        ) : path === '/ai-brain' ? (
          <AiBrainPage lang={lang} />
        ) : path === '/competitors' ? (
          <CompetitorsPage lang={lang} />
        ) : path === '/operations' ? (
          <OperationsCalendarPage lang={lang} />
        ) : path === '/finance' ? (
          <FinanceReconciliationPage lang={lang} />
        ) : path === '/status' ? (
          <PlatformStatusPage lang={lang} />
        ) : path === '/terms' ? (
          <LegalPlaceholderPage lang={lang} page="terms" />
        ) : path === '/privacy' ? (
          <LegalPlaceholderPage lang={lang} page="privacy" />
        ) : bookingReviewMatch ? (
          <BookingReviewPage listingId={bookingReviewMatch[1]} lang={lang} />
        ) : bookingMatch ? (
          <BookingDetailPage bookingId={bookingMatch[1]} lang={lang} />
        ) : listingMatch ? (
          <ListingDetailPage listingId={listingMatch[1]} lang={lang} />
        ) : path === '/ride' || path === '/ride-preview' ? (
          <SrRidePage lang={lang} />
        ) : isSellerRoute(path) ? (
          <SellerDivisionRoutes lang={lang} path={path} />
        ) : path === '/search-preview' || path === '/stays' ? (
          <SearchPreviewPage lang={lang} initialDivision="stays" entry={path === '/stays' ? 'stays' : 'general'} />
        ) : path === '/rentals' ? (
          <RentalsPage lang={lang} mode="rentals" />
        ) : path === '/buy' ? (
          <RentalsPage lang={lang} mode="buy" />
        ) : path === '/cars' ? (
          <SearchPreviewPage lang={lang} initialDivision="cars" entry="general" />
        ) : path === '/marketplace' ? (
          <SearchPreviewPage lang={lang} initialDivision="marketplace" entry="general" />
        ) : path === '/new-construction' ? (
          <SearchPreviewPage lang={lang} initialDivision="newConstruction" entry="general" />
        ) : paymentReceiptMatch ? (
          <PaymentReceiptPage lang={lang} proofId={paymentReceiptMatch[1]} />
        ) : bookingPaymentMatch ? (
          <SyrianLocalWalletPaymentPage
            lang={lang}
            bookingId={bookingPaymentMatch[1]}
            amountMinor={Number(bookingPaymentMatch[2])}
            currency={decodeURIComponent(bookingPaymentMatch[3])}
          />
        ) : path === '/wallet' ? (
          <WalletPage lang={lang} />
        ) : division ? (
          <DivisionLivePage division={division} lang={lang} />
        ) : (
          <LandingPage lang={lang} />
        )}
      </Suspense>
    </AppShell>
  )
}

function hostFocusFromPath(path: string): 'stays' | 'cars' | 'newConstruction' | 'marketplace' | undefined {
  if (path === '/host/stays') return 'stays'
  if (path === '/host/cars') return 'cars'
  if (path === '/host/new-construction') return 'newConstruction'
  if (path === '/host/marketplace') return 'marketplace'
  return undefined
}

function getStaffRequiredRole(path: string): 'ADMIN' | 'HOST' | 'DRIVER' | null {
  if (path.startsWith('/host')) return 'HOST'
  if (path.startsWith('/driver')) return 'DRIVER'
  if (
    path.startsWith('/admin') ||
    path.startsWith('/finance') ||
    path.startsWith('/operations') ||
    path.startsWith('/ai-brain') ||
    path.startsWith('/competitors') ||
    path.startsWith('/status')
  ) {
    return 'ADMIN'
  }
  return null
}

function hasRequiredStaffSession(requiredRole: 'ADMIN' | 'HOST' | 'DRIVER' | null) {
  if (!requiredRole) return true
  try {
    const raw = sessionStorage.getItem('sybnb.v6.staffSession')
    if (!raw) return false
    const session = JSON.parse(raw) as { token?: string; user?: { roles?: string[] } }
    const roles = session.user?.roles || []
    if (!session.token) return false
    if (requiredRole === 'HOST') return roles.includes('HOST') || roles.includes('SELLER')
    return roles.includes(requiredRole)
  } catch {
    return false
  }
}

function hasAnyValidStaffSession() {
  try {
    const raw = sessionStorage.getItem('sybnb.v6.staffSession')
    if (!raw) return false
    const session = JSON.parse(raw) as { token?: string; user?: { roles?: string[] } }
    return Boolean(session.token && session.user?.roles?.length)
  } catch {
    return false
  }
}

function RouteLoading({ lang }: { lang: Lang }) {
  return (
    <main className="page-shell">
      <section className="panel">
        <p>{text({ ar: 'جاري التحميل...', en: 'Loading...' }, lang)}</p>
      </section>
    </main>
  )
}
