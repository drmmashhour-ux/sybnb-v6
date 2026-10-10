import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react'
import { findDivisionByRoute } from '../engines/navigation/divisions'
import type { Lang } from '../engines/language/languageEngine'
import { getInitialLanguage, persistLanguage, text } from '../engines/language/languageEngine'
import { AppShell } from '../shared/layout/AppShell'
import { NotFoundPage } from '../modules/common/NotFoundPage'
import { isSellerRoute } from '../modules/seller/sellerRoutes'
import { isTrustProtectionRoute } from '../modules/trust/trustRoutes'
import { isGiftFlowRoute } from '../modules/wallet/giftRoutes'
import { getCurrentPath } from './routes'
import { authStorage } from '../shared/api/authStorage'
import { refreshStoredSessionRoles } from '../shared/api/platformApi'

const AdminReviewPage = lazyNamed(() => import('../modules/admin/AdminReviewPage'), 'AdminReviewPage')
const AiBrainPage = lazyNamed(() => import('../modules/ai/AiBrainPage'), 'AiBrainPage')
const BookingDetailPage = lazyNamed(() => import('../modules/bookings/BookingDetailPage'), 'BookingDetailPage')
const CheckoutPage = lazyNamed(() => import('../modules/bookings/CheckoutPage'), 'CheckoutPage')
const CompetitorsPage = lazyNamed(() => import('../modules/competitors/CompetitorsPage'), 'CompetitorsPage')
const DashboardPage = lazyNamed(() => import('../modules/dashboard/DashboardPage'), 'DashboardPage')
const DivisionLivePage = lazyNamed(() => import('../modules/divisions/DivisionLivePage'), 'DivisionLivePage')
const DriverDashboardPage = lazyNamed(() => import('../modules/driver/DriverDashboardPage'), 'DriverDashboardPage')
const FinanceReconciliationPage = lazyNamed(() => import('../modules/finance/FinanceReconciliationPage'), 'FinanceReconciliationPage')
const GiftFlowRoutes = lazyNamed(() => import('../modules/wallet/GiftFlowRoutes'), 'GiftFlowRoutes')
const GuestAccountPage = lazyNamed(() => import('../modules/account/GuestAccountPage'), 'GuestAccountPage')
const BecomeHostPage = lazyNamed(() => import('../modules/account/BecomeHostPage'), 'BecomeHostPage')
const HostWhyPage = lazyNamed(() => import('../modules/account/HostWhyPage'), 'HostWhyPage')
const HostJoinPage = lazyNamed(() => import('../modules/account/HostJoinPage'), 'HostJoinPage')
const AdminHostsPage = lazyNamed(() => import('../modules/admin/AdminHostsPage'), 'AdminHostsPage')
const HostDashboardPage = lazyNamed(() => import('../modules/host/HostDashboardPage'), 'HostDashboardPage')
const HostProfilePage = lazyNamed(() => import('../modules/host/HostProfilePage'), 'HostProfilePage')
const ProfilePage = lazyNamed(() => import('../modules/profile/ProfilePage'), 'ProfilePage')
const HostEarningsPage = lazyNamed(() => import('../modules/host/HostEarningsPage'), 'HostEarningsPage')
const HostPayoutsPage = lazyNamed(() => import('../modules/host/HostPayoutsPage'), 'HostPayoutsPage')
const AdminMoneyPage = lazyNamed(() => import('../modules/admin/AdminMoneyPage'), 'AdminMoneyPage')
const AdminCustomerPage = lazyNamed(() => import('../modules/admin/AdminCustomerPage'), 'AdminCustomerPage')
const AdminMoneyFlowPage = lazyNamed(() => import('../modules/admin/AdminMoneyFlowPage'), 'AdminMoneyFlowPage')
const HostInquiriesPage = lazyNamed(() => import('../modules/host/HostInquiriesPage'), 'HostInquiriesPage')
const ImmocontactPage = lazyNamed(() => import('../modules/immocontact/ImmocontactPage'), 'ImmocontactPage')
const LandingPage = lazyNamed(() => import('../modules/landing/LandingPage'), 'LandingPage')
const LegalDocumentPage = lazyNamed(() => import('../modules/legal/LegalDocumentPage'), 'LegalDocumentPage')
const ListingDetailPage = lazyNamed(() => import('../modules/listings/ListingDetailPage'), 'ListingDetailPage')
const OperationsCalendarPage = lazyNamed(() => import('../modules/operations/OperationsCalendarPage'), 'OperationsCalendarPage')
const PaymentReceiptPage = lazyNamed(() => import('../modules/payments/PaymentReceiptPage'), 'PaymentReceiptPage')
const PlatformStatusPage = lazyNamed(() => import('../modules/status/PlatformStatusPage'), 'PlatformStatusPage')
const RentalsPage = lazyNamed(() => import('../modules/rentals/RentalsPage'), 'RentalsPage')
const SearchPreviewPage = lazyNamed(() => import('../modules/search/SearchPreviewPage'), 'SearchPreviewPage')
const SellerDivisionRoutes = lazyNamed(() => import('../modules/seller'), 'SellerDivisionRoutes')
const SrRidePage = lazyNamed(() => import('../modules/sr/SrRidePage'), 'SrRidePage')
const SharedRidePage = lazyNamed(() => import('../modules/sr/SharedRidePage'), 'SharedRidePage')
const AdminPromoCodesPage = lazyNamed(() => import('../modules/sr/AdminPromoCodesPage'), 'AdminPromoCodesPage')
const AdminBusinessAccountsPage = lazyNamed(() => import('../modules/sr/AdminBusinessAccountsPage'), 'AdminBusinessAccountsPage')
const AdminIncidentsPage = lazyNamed(() => import('../modules/admin/AdminIncidentsPage'), 'AdminIncidentsPage')
const BusinessAccountPage = lazyNamed(() => import('../modules/sr/BusinessAccountPage'), 'BusinessAccountPage')
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
    // On hash-route change, reset scroll and move keyboard/screen-reader focus to the main content
    // so navigation is announced and doesn't leave focus on the old page.
    if (typeof window === 'undefined') return
    window.scrollTo(0, 0)
    const main = document.querySelector('main') as HTMLElement | null
    if (main) {
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
      main.focus({ preventScroll: true })
    }
  }, [path])

  // Stale-role fix: the stored session's roles are a copy taken at sign-in. Refresh them from the
  // server once per app load (the account menu refreshes again when it opens), so a role granted
  // meanwhile shows up ("Switch to hosting", "Admin panel") without signing in again.
  useEffect(() => {
    void refreshStoredSessionRoles({ minIntervalMs: 0 })
  }, [])

  // Installable "SYBNB Admin" app: while an admin route is open, point the page's web manifest at
  // public/manifest-admin.webmanifest (installing from here installs the admin app, start_url
  // /admin.html). Removed again outside /admin -- the main site declares no manifest of its own.
  const isAdminRoute = path.startsWith('/admin')
  useEffect(() => {
    if (typeof document === 'undefined') return
    const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"][data-sybnb-admin]')
    if (isAdminRoute && !existing) {
      const link = document.createElement('link')
      link.rel = 'manifest'
      link.href = '/manifest-admin.webmanifest'
      link.setAttribute('data-sybnb-admin', '1')
      document.head.appendChild(link)
    } else if (!isAdminRoute && existing) {
      existing.remove()
    }
  }, [isAdminRoute])

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
  // These booking-detail sub-routes (protection/guarantee/payment-status/dispute) and the ID-
  // verification screen all end up calling a requireAuth() endpoint for a specific guest's data
  // (fetchPrototypeBooking, disputePrototypeBooking, submitGuestIdDocument) — same reasoning as the
  // bare /booking/:id route above, just not covered by that single-segment regex. The trust-center
  // hub and SOS screens stay ungated (informational/support entry points, no guest-specific fetch).
  const trustBookingSubRouteMatch =
    /^\/booking\/(protection|guarantee|payment-status|dispute|dispute-closed)\/[^/]+$/.test(path)
  const listingMatch = path.match(/^\/listing\/([^/]+)$/)
  // Airbnb-style "Confirm and pay". Deliberately NOT gated: the page signs the guest in inline and
  // keeps every choice (dates, protection, payment method) while they do.
  const checkoutMatch = path.match(/^\/checkout\/([^/]+)$/)
  const paymentReceiptMatch = path.match(/^\/payment\/receipt\/([^/]+)$/)
  const bookingPaymentMatch = path.match(/^\/payment\/local-wallet\/([^/]+)\/(\d+)\/([^/]+)$/)
  // SR Ride vs. Uber gap-closure (P0 #3): a trip-share link -- deliberately public/ungated, same
  // category as the trust-center/SOS routes below (informational, verified by its own signed token
  // rather than a session; see server/lib/ride-share.mjs). Never added to guestProtectedRoute.
  const sharedRideMatch = path.match(/^\/ride\/shared\/([^/?]+)(?:\?(.*))?$/)
  const guestAccountMatch = path.match(/^\/account\/open(?:\/([^/]+))?$/)
  // Claiming a gift calls a requireAuth() endpoint (server/routes/wallet.mjs), so a real guest
  // session must exist before the claim screens render — otherwise the only thing standing between
  // the user and a silently-failing claim call is a fake local "create account" step that never
  // talks to the server.
  const giftClaimRoute = path === '/wallet/gift/claim' || /^\/wallet\/gift\/claim\/[^/]+$/.test(path)
    || path === '/wallet/gift/code' || /^\/wallet\/gift\/code\/[^/]+$/.test(path)
  const guestProtectedRoute = path === '/dashboard' || path === '/account' || path === '/profile' || path === '/wallet' || path === '/ride' || path === '/ride-preview' || path === '/business/account' || path === '/trust-center/verification' || giftClaimRoute || trustBookingSubRouteMatch || Boolean(bookingMatch || bookingPaymentMatch || paymentReceiptMatch)
  const guestGateFlow = path === '/ride' || path === '/ride-preview' ? 'ride' : path === '/account/open' || path === '/dashboard' || path === '/account' || path === '/profile' || path === '/wallet' || path === '/business/account' || path === '/trust-center/verification' || giftClaimRoute || trustBookingSubRouteMatch ? 'generic' : 'stays'
  const hasGuestSession = typeof window !== 'undefined' && Boolean(authStorage.getItem('sybnb-v6-guest-token'))
  const staffRequiredRole = getStaffRequiredRole(path)
  const hasStaffSession = typeof window !== 'undefined' && hasRequiredStaffSession(staffRequiredRole)
  const hasAnyStaffSession = typeof window !== 'undefined' && hasAnyValidStaffSession()
  const contactProtectedRoute = path === '/immocontact'
  const needsGuestAccountGate = (guestProtectedRoute && !hasGuestSession) || (contactProtectedRoute && !hasGuestSession && !hasAnyStaffSession)

  if (needsGuestAccountGate && typeof window !== 'undefined') {
    sessionStorage.setItem('sybnb.v6.guestReturnPath', path)
  }

  // Tells the shell which screen is really showing when a gate replaces the requested page, so the
  // breadcrumb reads "… / Sign in" (or "Host / Become a host") instead of the protected page's name.
  const shellGate: 'account' | 'become-host' | 'staff' | undefined = needsGuestAccountGate
    ? 'account'
    : staffRequiredRole === 'HOST' && !hasStaffSession && !hasGuestSession
      ? 'account'
      : staffRequiredRole === 'HOST' && !hasStaffSession
        ? 'become-host'
        : staffRequiredRole && !hasStaffSession
          ? 'staff'
          : undefined

  return (
    <AppShell lang={lang} onLanguageChange={setLang} path={path} gate={shellGate}>
      <Suspense fallback={<RouteLoading lang={lang} />}>
        {needsGuestAccountGate ? (
          <GuestAccountPage lang={lang} flow={guestGateFlow} returnPath={path} />
        ) : staffRequiredRole === 'HOST' && !hasStaffSession && !hasGuestSession ? (
          // Airbnb-style: hosting uses the SAME account. Not signed in -> the normal sign-in, then back here.
          <GuestAccountPage lang={lang} flow="generic" returnPath={path} />
        ) : staffRequiredRole === 'HOST' && !hasStaffSession ? (
          // Signed in but not a host yet -> one-tap "Become a host" on this same account.
          <BecomeHostPage lang={lang} returnPath={path} />
        ) : staffRequiredRole && !hasStaffSession ? (
          <StaffAccessPage lang={lang} role={staffRequiredRole} returnPath={path} />
        ) : path === '/host/why' ? (
          // Public "Why host on SYBNB" landing (exempt from the HOST gate in getStaffRequiredRole).
          <HostWhyPage lang={lang} />
        ) : path === '/host/join' ? (
          // Host entrance: inline sign-in/up -> hosting on -> profile -> listing wizard (also exempt).
          <HostJoinPage lang={lang} />
        ) : isGiftFlowRoute(path) ? (
          <GiftFlowRoutes lang={lang} path={path} />
        ) : isTrustProtectionRoute(path) ? (
          <TrustProtectionRoutes lang={lang} path={path} />
        ) : guestAccountMatch ? (
          // A real bug caught by an independent re-audit: hardcoding '/stays' here always won
          // over whatever the calling page actually stored (e.g. RentalsPage.openAccount() sets
          // '/rentals'/'/buy'/'/immocontact' before navigating here) -- GuestAccountPage's own
          // returnPath logic already falls through to sessionStorage correctly when no explicit
          // prop is given (defaulting to '/stays' only if nothing was genuinely stored), so simply
          // not overriding it here lets that real value win.
          <GuestAccountPage lang={lang} listingId={guestAccountMatch[1]} flow={guestAccountMatch[1] ? 'stays' : 'generic'} returnPath={guestAccountMatch[1] ? `/listing/${guestAccountMatch[1]}` : undefined} />
        ) : path === '/dashboard' || path === '/account' ? (
          <DashboardPage lang={lang} />
        ) : path === '/host/profile' ? (
          <HostProfilePage lang={lang} />
        ) : path === '/profile' ? (
          <ProfilePage lang={lang} />
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
        ) : path === '/host/payouts' ? (
          <HostPayoutsPage lang={lang} />
        ) : path === '/host/inquiries' ? (
          <HostInquiriesPage lang={lang} />
        ) : path === '/driver' ? (
          <DriverDashboardPage lang={lang} />
        ) : path === '/immocontact' ? (
          <ImmocontactPage lang={lang} />
        ) : path === '/admin/sr/promo-codes' ? (
          <AdminPromoCodesPage lang={lang} />
        ) : path === '/admin/sr/business-accounts' ? (
          <AdminBusinessAccountsPage lang={lang} />
        ) : path === '/admin/sr/incidents' ? (
          <AdminIncidentsPage lang={lang} />
        ) : path === '/business/account' ? (
          <BusinessAccountPage lang={lang} />
        ) : path === '/admin/hosts' ? (
          <AdminHostsPage lang={lang} />
        ) : path === '/admin/money' ? (
          <AdminMoneyPage lang={lang} />
        ) : path === '/admin/customers' || path.startsWith('/admin/customers/') ? (
          <AdminCustomerPage lang={lang} />
        ) : path === '/admin/money-flow' ? (
          <AdminMoneyFlowPage lang={lang} />
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
          <LegalDocumentPage lang={lang} page="terms" />
        ) : path === '/privacy' ? (
          <LegalDocumentPage lang={lang} page="privacy" />
        ) : path === '/listing-agreement' ? (
          <LegalDocumentPage lang={lang} page="listing-agreement" />
        ) : bookingMatch ? (
          <BookingDetailPage bookingId={bookingMatch[1]} lang={lang} />
        ) : checkoutMatch ? (
          <CheckoutPage listingId={checkoutMatch[1]} lang={lang} />
        ) : listingMatch ? (
          <ListingDetailPage listingId={listingMatch[1]} lang={lang} />
        ) : path === '/ride' || path === '/ride-preview' ? (
          <SrRidePage lang={lang} />
        ) : sharedRideMatch ? (
          <SharedRidePage
            lang={lang}
            rideId={sharedRideMatch[1]}
            exp={new URLSearchParams(sharedRideMatch[2] || '').get('exp') || ''}
            sig={new URLSearchParams(sharedRideMatch[2] || '').get('sig') || ''}
          />
        ) : path === '/advertising' ? (
          // Bare /advertising had no route (404). The advertising flow starts at /advertising/account.
          <SellerDivisionRoutes lang={lang} path="/advertising/account" />
        ) : isSellerRoute(path) ? (
          <SellerDivisionRoutes lang={lang} path={path} />
        ) : path === '/search-preview' || path === '/stays' ? (
          <SearchPreviewPage key="stays" lang={lang} initialDivision="stays" entry={path === '/stays' ? 'stays' : 'general'} />
        ) : path === '/rentals' ? (
          <RentalsPage lang={lang} mode="rentals" />
        ) : path === '/buy' ? (
          <RentalsPage lang={lang} mode="buy" />
        ) : path === '/cars' ? (
          <SearchPreviewPage key="cars" lang={lang} initialDivision="cars" entry="general" />
        ) : path === '/marketplace' ? (
          <SearchPreviewPage key="marketplace" lang={lang} initialDivision="marketplace" entry="general" />
        ) : path === '/new-construction' ? (
          <SearchPreviewPage key="newConstruction" lang={lang} initialDivision="newConstruction" entry="general" />
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
        ) : path === '/' || path === '' || path === '/home' ? (
          <LandingPage lang={lang} />
        ) : (
          <NotFoundPage lang={lang} path={path} />
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
  if (path === '/host/why') return null // public host landing page
  if (path === '/host/join') return null // host entrance: handles signed-out / non-host itself
  if (path.startsWith('/host')) return 'HOST'
  if (path.startsWith('/driver')) return 'DRIVER'
  if (
    path.startsWith('/admin') ||
    path.startsWith('/finance') ||
    path.startsWith('/operations') ||
    path.startsWith('/ai-brain') ||
    path.startsWith('/competitors') ||
    path.startsWith('/status') ||
    path === '/wallet/admin/gift-audit'
  ) {
    return 'ADMIN'
  }
  return null
}

function hasRequiredStaffSession(requiredRole: 'ADMIN' | 'HOST' | 'DRIVER' | null) {
  if (!requiredRole) return true
  try {
    const raw = authStorage.getItem('sybnb.v6.staffSession')
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
    <main className="page-shell">
      <section className="panel">
        <p>{text({ ar: 'جاري التحميل...', en: 'Loading...', fr: 'Chargement...' }, lang)}</p>
      </section>
    </main>
  )
}
