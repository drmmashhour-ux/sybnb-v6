import type { ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../brand'
import { clearGuestSession, getStoredGuestSession } from '../api/platformApi'
import { Footer } from './Footer'

type Props = {
  lang: Lang
  onLanguageChange: (lang: Lang) => void
  path: string
  children: ReactNode
}

export function AppShell({ lang, onLanguageChange, path, children }: Props) {
  const isAr = lang === 'ar'
  const isLanding = path === '/'
  const isAdvertisingTunnel = path.startsWith('/sell') || path.startsWith('/advertising')
  const isAdminControlRoom = path.startsWith('/admin')
  const routeContext = getRouteContext(path, isAr)
  const showFlowNav = !isLanding && !isAdminControlRoom
  const guestSession = typeof window !== 'undefined' ? getStoredGuestSession() : null

  function goBack() {
    navigate(routeContext.backPath)
  }

  function goNext() {
    if (!routeContext.nextPath) return
    navigate(routeContext.nextPath)
  }

  function signOutGuest() {
    clearGuestSession()
    navigate('/')
  }

  return (
    <div className="app-shell" dir={isAr ? 'rtl' : 'ltr'}>
      <a className="skip-link" href="#main-content">
        {isAr ? 'تخطي إلى المحتوى الرئيسي' : 'Skip to main content'}
      </a>
      {(isAdvertisingTunnel || isAdminControlRoom) && (
        <div className="final-isolated-watermark" aria-hidden="true">
          FINAL · JULY 6 · CAPSULE EDITION · 3055
        </div>
      )}
      {!isAdvertisingTunnel && !isAdminControlRoom && (
        <header className="top-nav">
          <button className="brand-lockup" onClick={() => navigate('/')} aria-label="SYBNB home">
            <BrandLogo logo="platform" size="nav" className="top-nav-logo" />
          </button>

          <nav className="nav-actions" aria-label={isAr ? 'إجراءات الحساب' : 'Account actions'}>
            {!isLanding && (
              <div className="route-context" aria-label={isAr ? 'مكانك داخل المنصة' : 'Current platform location'}>
                <span className="route-main">{routeContext.section}</span>
                <span className="route-separator">/</span>
                <strong className="route-page">{routeContext.page}</strong>
              </div>
            )}
            <div className="language-switch" role="group" aria-label={isAr ? 'اختيار اللغة' : 'Choose language'}>
              <button className={isAr ? 'active' : ''} onClick={() => onLanguageChange('ar')}>
                AR
              </button>
              <button className={!isAr ? 'active' : ''} onClick={() => onLanguageChange('en')}>
                EN
              </button>
            </div>
            {guestSession ? (
              <div className="public-auth-actions" aria-label={isAr ? 'حساب العميل' : 'Guest account'}>
                <button className="menu-action" onClick={() => navigate('/dashboard')}>
                  {isAr ? `مرحباً، ${guestSession.user.displayName}` : `Hi, ${guestSession.user.displayName}`}
                </button>
                <button className="primary-action" onClick={signOutGuest}>
                  {isAr ? 'تسجيل الخروج' : 'Sign out'}
                </button>
              </div>
            ) : (
              <div className="public-auth-actions">
                <button className="menu-action" onClick={() => navigate('/account/open')}>
                  {isAr ? 'تسجيل الدخول' : 'Sign in'}
                </button>
                <button className="primary-action" onClick={() => navigate('/account/open')}>
                  {isAr ? 'إنشاء حساب' : 'Sign up'}
                </button>
              </div>
            )}
          </nav>
        </header>
      )}
      {showFlowNav && (
        <div className="flow-step-nav" aria-label={isAr ? 'التنقل داخل المسار' : 'Flow navigation'}>
          <button className="flow-nav-button" onClick={goBack}>
            {isAr ? 'السابق' : 'Back'}
          </button>
          <button className="flow-nav-button flow-home-button" onClick={() => navigate('/')}>
            {isAr ? 'الرئيسية' : 'Home'}
          </button>
          <span>{routeContext.section} · {routeContext.page}</span>
          {routeContext.nextPath ? (
            <button className="flow-nav-button" onClick={goNext}>
              {isAr ? 'التالي' : 'Next'}
            </button>
          ) : (
            <span className="flow-nav-placeholder" aria-hidden="true" />
          )}
        </div>
      )}
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
      {!isAdvertisingTunnel && !isAdminControlRoom && <Footer lang={lang} />}
    </div>
  )
}

function getRouteContext(path: string, isAr: boolean) {
  const home = '/'
  if (path === '/stays') {
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'بحث الإيجار اليومي' : 'Stay search',
      backPath: home,
      nextPath: '',
    }
  }
  if (path === '/search-preview') {
    return {
      section: isAr ? 'البحث' : 'Search',
      page: isAr ? 'محرك البحث العام' : 'Search engine',
      backPath: home,
      nextPath: '/stays',
    }
  }
  if (path.startsWith('/rentals')) {
    return {
      section: isAr ? 'الإيجار الشهري' : 'Monthly rental',
      page: isAr ? 'بحث العقارات' : 'Property search',
      backPath: home,
      nextPath: '/account/open',
    }
  }
  if (path.startsWith('/cars')) {
    return {
      section: isAr ? 'المركبات' : 'Cars',
      page: isAr ? 'بحث المركبات' : 'Vehicle search',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/new-construction')) {
    return {
      section: isAr ? 'مشاريع جديدة' : 'New construction',
      page: isAr ? 'المشاريع' : 'Projects',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/marketplace')) {
    return {
      section: isAr ? 'السوق' : 'Marketplace',
      page: isAr ? 'العروض' : 'Offers',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/sell') || path.startsWith('/advertising')) {
    const isPaymentTunnel = path.includes('/payment')
    return {
      section: isAr ? 'الإعلان معنا' : 'Advertise with us',
      page: isPaymentTunnel ? (isAr ? 'الدفع' : 'Payment') : (isAr ? 'طلب الإعلان' : 'Advertising request'),
      backPath: isPaymentTunnel ? '/advertising/account' : home,
      nextPath: '',
    }
  }
  if (path.startsWith('/listing/')) {
    const id = path.split('/')[2] || ''
    const listingContext = routeContextFromReturnPath(readListingReturnPath(), isAr)
    return {
      section: listingContext.section,
      page: listingContext.detailsPage,
      backPath: listingContext.backPath,
      nextPath: `/account/open/${id}`,
    }
  }
  if (path.startsWith('/account/open')) {
    const id = path.split('/')[3] || ''
    const returnPath = readGuestReturnPath()
    if (!id && returnPath.startsWith('/rentals')) {
      return {
        section: isAr ? 'الإيجار الشهري' : 'Monthly rental',
        page: isAr ? 'فتح حساب المستأجر' : 'Open renter account',
        backPath: '/rentals',
        nextPath: '/rentals',
      }
    }
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'فتح الحساب' : 'Open account',
      backPath: id ? `/listing/${id}` : '/stays',
      nextPath: id ? `/listing/${id}` : '/dashboard',
    }
  }
  if (path.startsWith('/booking/')) {
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'الحجز' : 'Booking',
      backPath: '/dashboard',
      nextPath: '',
    }
  }
  if (path.startsWith('/payment/')) {
    return {
      section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
      page: isAr ? 'الدفع الآمن' : 'Secure payment',
      backPath: '/dashboard',
      nextPath: '',
    }
  }
  if (path === '/dashboard' || path === '/account') {
    return {
      section: isAr ? 'حساب العميل' : 'Guest account',
      page: isAr ? 'رحلتي' : 'My trip',
      backPath: '/stays',
      nextPath: '/wallet',
    }
  }
  if (path === '/wallet') {
    return {
      section: isAr ? 'حساب العميل' : 'Guest account',
      page: isAr ? 'المحفظة' : 'Wallet',
      backPath: '/dashboard',
      nextPath: '/dashboard',
    }
  }
  if (path.startsWith('/host')) {
    if (path.startsWith('/host/cars')) {
      return {
        section: isAr ? 'المركبات' : 'Cars',
        page: isAr ? 'لوحة بائع المركبات' : 'Vehicle seller dashboard',
        backPath: '/cars',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/new-construction')) {
      return {
        section: isAr ? 'مشاريع جديدة' : 'New construction',
        page: isAr ? 'لوحة المطور العقاري' : 'Developer dashboard',
        backPath: '/new-construction',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/marketplace')) {
      return {
        section: isAr ? 'السوق' : 'Marketplace',
        page: isAr ? 'لوحة بائع السوق' : 'Marketplace seller dashboard',
        backPath: '/marketplace',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/stays')) {
      return {
        section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
        page: isAr ? 'لوحة الاستضافة' : 'Hosting dashboard',
        backPath: '/stays',
        nextPath: '',
      }
    }
    return {
      section: isAr ? 'المضيف' : 'Host',
      page: isAr ? 'لوحة الاستضافة' : 'Hosting dashboard',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/driver')) {
    return {
      section: isAr ? 'السائق' : 'Driver',
      page: isAr ? 'لوحة SR' : 'SR dashboard',
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/admin')) {
    return {
      section: isAr ? 'الإدارة' : 'Admin',
      page: isAr ? 'المراجعة' : 'Review',
      backPath: home,
      nextPath: '/operations',
    }
  }
  if (path.startsWith('/finance')) {
    return {
      section: isAr ? 'المالية' : 'Finance',
      page: isAr ? 'المطابقة' : 'Reconciliation',
      backPath: '/admin/review',
      nextPath: '/operations',
    }
  }
  if (path.startsWith('/operations')) {
    return {
      section: isAr ? 'العمليات' : 'Operations',
      page: isAr ? 'المتابعة' : 'Tracking',
      backPath: '/finance',
      nextPath: '/ai-brain',
    }
  }
  if (path.startsWith('/ai-brain')) {
    return {
      section: isAr ? 'AI Brain' : 'AI Brain',
      page: isAr ? 'ذكاء السوق' : 'Market intelligence',
      backPath: '/operations',
      nextPath: '/competitors',
    }
  }
  if (path.startsWith('/competitors')) {
    return {
      section: isAr ? 'المنافسين' : 'Competitors',
      page: isAr ? 'المقارنة' : 'Comparison',
      backPath: '/ai-brain',
      nextPath: '/status',
    }
  }
  if (path.startsWith('/immocontact')) {
    return {
      section: isAr ? 'تواصل' : 'Contact',
      page: isAr ? 'صندوق الرسائل' : 'Inbox',
      backPath: home,
      nextPath: '',
    }
  }
  return {
    section: isAr ? 'المنصة' : 'Platform',
    page: isAr ? 'الصفحة الحالية' : 'Current page',
    backPath: home,
    nextPath: '',
  }
}

function readGuestReturnPath() {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem('sybnb.v6.guestReturnPath') || ''
  } catch {
    return ''
  }
}

function readListingReturnPath() {
  if (typeof window === 'undefined') return '/stays'
  try {
    return sessionStorage.getItem('sybnb-v6-listing-return-path') || '/stays'
  } catch {
    return '/stays'
  }
}

function routeContextFromReturnPath(returnPath: string, isAr: boolean) {
  if (returnPath.startsWith('/rentals')) {
    return {
      section: isAr ? 'الإيجار الشهري' : 'Monthly rental',
      detailsPage: isAr ? 'تفاصيل الإيجار' : 'Rental details',
      backPath: '/rentals',
    }
  }
  if (returnPath.startsWith('/cars')) {
    return {
      section: isAr ? 'المركبات' : 'Cars',
      detailsPage: isAr ? 'تفاصيل المركبة' : 'Vehicle details',
      backPath: '/cars',
    }
  }
  if (returnPath.startsWith('/marketplace')) {
    return {
      section: isAr ? 'السوق' : 'Marketplace',
      detailsPage: isAr ? 'تفاصيل المنتج' : 'Product details',
      backPath: '/marketplace',
    }
  }
  if (returnPath.startsWith('/buy')) {
    return {
      section: isAr ? 'شراء عقار' : 'Buy property',
      detailsPage: isAr ? 'تفاصيل العقار' : 'Property details',
      backPath: '/buy',
    }
  }
  if (returnPath.startsWith('/new-construction')) {
    return {
      section: isAr ? 'مشاريع جديدة' : 'New construction',
      detailsPage: isAr ? 'تفاصيل المشروع' : 'Project details',
      backPath: '/new-construction',
    }
  }
  return {
    section: isAr ? 'الإيجار اليومي' : 'Short-term rental',
    detailsPage: isAr ? 'تفاصيل الإقامة' : 'Stay details',
    backPath: '/stays',
  }
}
