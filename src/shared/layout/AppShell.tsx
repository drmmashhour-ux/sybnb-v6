import type { ReactNode } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../brand'
import { currentAccountIsHost, getStoredGuestSession, signOutGuest as revokeGuestSession } from '../api/platformApi'
import { Footer } from './Footer'

type Props = {
  lang: Lang
  onLanguageChange: (lang: Lang) => void
  path: string
  // Set by App when a gate screen replaces the requested page (sign-in, become-host, staff sign-in),
  // so the breadcrumb describes the screen actually shown rather than the protected page.
  gate?: 'account' | 'become-host' | 'staff'
  children: ReactNode
}


export function AppShell({ lang, onLanguageChange, path, gate, children }: Props) {
  const isAr = lang === 'ar'
  const isLanding = path === '/'
  const isAdvertisingTunnel = path.startsWith('/sell') || path.startsWith('/advertising')
  const isAdminControlRoom = path.startsWith('/admin')
  const routeContext = gate ? getGateRouteContext(path, gate, lang) : getRouteContext(path, lang)
  const showFlowNav = !isLanding && !isAdminControlRoom
  const guestSession = typeof window !== 'undefined' ? getStoredGuestSession() : null
  const isHost = typeof window !== 'undefined' && currentAccountIsHost()
  // /host/why is the public host landing page, not the host area.
  const inHostArea = path.startsWith('/host') && path !== '/host/why'
  // Airbnb-style host switch: one account; the same button turns into "Switch to traveling" inside
  // the host area. A non-host is taken to /host/stays, which shows the one-tap "Become a host" page.
  const hostSwitchLabel = inHostArea
    ? (pick(lang, 'التبديل إلى السفر', 'Switch to traveling', 'Passer en mode voyage'))
    : isHost
      ? (pick(lang, 'التبديل إلى الاستضافة', 'Switch to hosting', 'Passer en mode hôte'))
      : (pick(lang, 'استضف على SYBNB', 'Become a host', 'Devenir hôte'))
  const hostSwitchPath = inHostArea ? '/stays' : '/host/stays'

  function goBack() {
    navigate(routeContext.backPath)
  }

  function goNext() {
    if (!routeContext.nextPath) return
    navigate(routeContext.nextPath)
  }

  // SEC-002: sign-out is a server round trip now, not a sessionStorage delete. If the server did
  // not confirm revocation the local session is still dropped, but the user is told the session may
  // still be live elsewhere rather than being reassured falsely.
  async function signOutGuest() {
    const { serverRevoked } = await revokeGuestSession()
    if (!serverRevoked) {
      window.alert(
        pick(
          lang,
          'تم تسجيل الخروج من هذا الجهاز، لكن تعذّر الوصول إلى الخادم لإنهاء الجلسة. قد تظل الجلسة نشطة في مكان آخر — أعد المحاولة عند عودة الاتصال.',
          'Signed out on this device, but the server could not be reached to end the session. It may still be active elsewhere — try again once you are back online.',
          'Vous êtes déconnecté sur cet appareil, mais le serveur est injoignable pour fermer la session. Elle pourrait rester active ailleurs — réessayez une fois de retour en ligne.',
        ),
      )
    }
    navigate('/')
  }

  return (
    <div className="app-shell" dir={isAr ? 'rtl' : 'ltr'}>
      {!isAdvertisingTunnel && !isAdminControlRoom && (
        <header className="top-nav">
          <button className="brand-lockup" onClick={() => navigate('/')} aria-label="SYBNB home">
            <BrandLogo logo="platform" size="nav" className="top-nav-logo" />
          </button>

          <nav className="nav-actions" aria-label={pick(lang, 'إجراءات الحساب', 'Account actions', 'Actions du compte')}>
            {!isLanding && (
              <div className="route-context" aria-label={pick(lang, 'مكانك داخل المنصة', 'Current platform location', 'Votre position sur la plateforme')}>
                <span className="route-main">{routeContext.section}</span>
                <span className="route-separator">/</span>
                <strong className="route-page">{routeContext.page}</strong>
              </div>
            )}
            <div className="language-switch" role="group" aria-label={pick(lang, 'اختيار اللغة', 'Choose language', 'Choisir la langue')}>
              <button className={isAr ? 'active' : ''} onClick={() => onLanguageChange('ar')}>
                AR
              </button>
              <button className={lang === 'en' ? 'active' : ''} onClick={() => onLanguageChange('en')}>
                EN
              </button>
              <button className={lang === 'fr' ? 'active' : ''} onClick={() => onLanguageChange('fr')}>
                FR
              </button>
            </div>
            {guestSession ? (
              <div className="public-auth-actions" aria-label={pick(lang, 'حسابي', 'My account', 'Mon compte')}>
                <button className="menu-action" onClick={() => navigate(hostSwitchPath)}>
                  {hostSwitchLabel}
                </button>
                <button className="menu-action" onClick={() => navigate('/dashboard')}>
                  {pick(lang, `مرحباً، ${guestSession.user.displayName}`, `Hi, ${guestSession.user.displayName}`, `Bonjour, ${guestSession.user.displayName}`)}
                </button>
                <button className="primary-action" onClick={signOutGuest}>
                  {pick(lang, 'تسجيل الخروج', 'Sign out', 'Se déconnecter')}
                </button>
              </div>
            ) : (
              <div className="public-auth-actions">
                <button className="menu-action" onClick={() => navigate('/host/why')}>
                  {pick(lang, 'استضف على SYBNB', 'Become a host', 'Devenir hôte')}
                </button>
                <button className="primary-action" onClick={() => navigate('/account/open')}>
                  {pick(lang, 'تسجيل الدخول أو إنشاء حساب', 'Log in or sign up', 'Connexion ou inscription')}
                </button>
              </div>
            )}
          </nav>
        </header>
      )}
      {showFlowNav && (
        <div className="flow-step-nav" aria-label={pick(lang, 'التنقل داخل المسار', 'Flow navigation', 'Navigation du parcours')}>
          <button className="flow-nav-button" onClick={goBack}>
            {pick(lang, 'السابق', 'Back', 'Retour')}
          </button>
          <button className="flow-nav-button flow-home-button" onClick={() => navigate('/')}>
            {pick(lang, 'الرئيسية', 'Home', 'Accueil')}
          </button>
          <span>{routeContext.section} · {routeContext.page}</span>
          {routeContext.nextPath ? (
            <button className="flow-nav-button" onClick={goNext}>
              {pick(lang, 'التالي', 'Next', 'Suivant')}
            </button>
          ) : (
            <span className="flow-nav-placeholder" aria-hidden="true" />
          )}
        </div>
      )}
      {children}
      {!isAdvertisingTunnel && !isAdminControlRoom && <Footer lang={lang} />}
    </div>
  )
}

function getRouteContext(path: string, lang: Lang) {
  const home = '/'
  if (path === '/stays') {
    return {
      section: pick(lang, 'الإيجار اليومي', 'Short-term rental', 'Location à court terme'),
      page: pick(lang, 'بحث الإيجار اليومي', 'Stay search', 'Recherche de séjours'),
      backPath: home,
      nextPath: '',
    }
  }
  if (path === '/search-preview') {
    return {
      section: pick(lang, 'البحث', 'Search', 'Recherche'),
      page: pick(lang, 'محرك البحث العام', 'Search engine', 'Moteur de recherche'),
      backPath: home,
      nextPath: '/stays',
    }
  }
  if (path.startsWith('/rentals')) {
    return {
      section: pick(lang, 'الإيجار الشهري', 'Monthly rental', 'Location au mois'),
      page: pick(lang, 'بحث العقارات', 'Property search', 'Recherche de propriétés'),
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/cars')) {
    return {
      section: pick(lang, 'المركبات', 'Cars', 'Véhicules'),
      page: pick(lang, 'بحث المركبات', 'Vehicle search', 'Recherche de véhicules'),
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/new-construction')) {
    return {
      section: pick(lang, 'مشاريع جديدة', 'New construction', 'Projets neufs'),
      page: pick(lang, 'المشاريع', 'Projects', 'Projets'),
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/marketplace')) {
    return {
      section: pick(lang, 'السوق', 'Marketplace', 'Marché'),
      page: pick(lang, 'العروض', 'Offers', 'Offres'),
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/sell') || path.startsWith('/advertising')) {
    const isPaymentTunnel = path.includes('/payment')
    return {
      section: pick(lang, 'الإعلان معنا', 'Advertise with us', 'Annoncez avec nous'),
      page: isPaymentTunnel ? (pick(lang, 'الدفع', 'Payment', 'Paiement')) : (pick(lang, 'طلب الإعلان', 'Advertising request', 'Demande d\'annonce')),
      backPath: isPaymentTunnel ? '/advertising/account' : home,
      nextPath: '',
    }
  }
  if (path.startsWith('/listing/')) {
    const listingContext = routeContextFromReturnPath(readListingReturnPath(), lang)
    return {
      section: listingContext.section,
      page: listingContext.detailsPage,
      backPath: listingContext.backPath,
      // No breadcrumb "Next" here: it jumped to sign-in. The page's own buttons lead on.
      nextPath: '',
    }
  }
  if (path.startsWith('/account/open')) {
    const id = path.split('/')[3] || ''
    // With a listing id the user came from that listing; otherwise use whatever page stored its
    // return path (sybnb.v6.guestReturnPath) so the breadcrumb names the right section.
    const returnPath = id ? `/listing/${id}` : readGuestReturnPath()
    return accountContext(returnPath, lang)
  }
  if (path.startsWith('/booking/')) {
    return {
      section: pick(lang, 'الإيجار اليومي', 'Short-term rental', 'Location à court terme'),
      page: pick(lang, 'الحجز', 'Booking', 'Réservation'),
      backPath: '/dashboard',
      nextPath: '',
    }
  }
  if (path.startsWith('/payment/')) {
    return {
      section: pick(lang, 'الإيجار اليومي', 'Short-term rental', 'Location à court terme'),
      page: pick(lang, 'الدفع الآمن', 'Secure payment', 'Paiement sécurisé'),
      backPath: '/dashboard',
      nextPath: '',
    }
  }
  if (path === '/dashboard' || path === '/account') {
    return {
      section: pick(lang, 'حساب العميل', 'Guest account', 'Compte voyageur'),
      page: pick(lang, 'رحلتي', 'My trip', 'Mon voyage'),
      backPath: '/stays',
      nextPath: '/wallet',
    }
  }
  if (path === '/wallet') {
    return {
      section: pick(lang, 'حساب العميل', 'Guest account', 'Compte voyageur'),
      page: pick(lang, 'المحفظة', 'Wallet', 'Portefeuille'),
      backPath: '/dashboard',
      nextPath: '/dashboard',
    }
  }
  if (path.startsWith('/host')) {
    if (path === '/host/why') {
      return {
        section: pick(lang, 'المضيف', 'Host', 'Hôte'),
        page: pick(lang, 'لماذا تستضيف على SYBNB', 'Why host on SYBNB', 'Pourquoi accueillir sur SYBNB'),
        backPath: home,
        nextPath: '',
      }
    }
    if (path === '/host/profile') {
      return {
        section: pick(lang, 'المضيف', 'Host', 'Hôte'),
        page: pick(lang, 'ملفك كمضيف', 'Host profile', 'Profil d\'hôte'),
        backPath: '/host/stays',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/cars')) {
      return {
        section: pick(lang, 'المركبات', 'Cars', 'Véhicules'),
        page: pick(lang, 'لوحة بائع المركبات', 'Vehicle seller dashboard', 'Tableau de bord vendeur de véhicules'),
        backPath: '/cars',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/new-construction')) {
      return {
        section: pick(lang, 'مشاريع جديدة', 'New construction', 'Projets neufs'),
        page: pick(lang, 'لوحة المطور العقاري', 'Developer dashboard', 'Tableau de bord promoteur'),
        backPath: '/new-construction',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/marketplace')) {
      return {
        section: pick(lang, 'السوق', 'Marketplace', 'Marché'),
        page: pick(lang, 'لوحة بائع السوق', 'Marketplace seller dashboard', 'Tableau de bord vendeur du marché'),
        backPath: '/marketplace',
        nextPath: '',
      }
    }
    if (path.startsWith('/host/stays')) {
      return {
        section: pick(lang, 'الإيجار اليومي', 'Short-term rental', 'Location à court terme'),
        page: pick(lang, 'لوحة الاستضافة', 'Hosting dashboard', 'Tableau de bord d\'hôte'),
        backPath: '/stays',
        nextPath: '',
      }
    }
    return {
      section: pick(lang, 'المضيف', 'Host', 'Hôte'),
      page: pick(lang, 'لوحة الاستضافة', 'Hosting dashboard', 'Tableau de bord d\'hôte'),
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/driver')) {
    return {
      section: pick(lang, 'السائق', 'Driver', 'Chauffeur'),
      page: pick(lang, 'لوحة SR', 'SR dashboard', 'Tableau de bord SR'),
      backPath: home,
      nextPath: '',
    }
  }
  if (path.startsWith('/admin')) {
    return {
      section: pick(lang, 'الإدارة', 'Admin', 'Administration'),
      page: pick(lang, 'المراجعة', 'Review', 'Vérification'),
      backPath: home,
      nextPath: '/operations',
    }
  }
  if (path.startsWith('/finance')) {
    return {
      section: pick(lang, 'المالية', 'Finance', 'Finances'),
      page: pick(lang, 'المطابقة', 'Reconciliation', 'Rapprochement'),
      backPath: '/admin/review',
      nextPath: '/operations',
    }
  }
  if (path.startsWith('/operations')) {
    return {
      section: pick(lang, 'العمليات', 'Operations', 'Opérations'),
      page: pick(lang, 'المتابعة', 'Tracking', 'Suivi'),
      backPath: '/finance',
      nextPath: '/ai-brain',
    }
  }
  if (path.startsWith('/ai-brain')) {
    return {
      section: pick(lang, 'AI Brain', 'AI Brain', 'AI Brain'),
      page: pick(lang, 'ذكاء السوق', 'Market intelligence', 'Veille du marché'),
      backPath: '/operations',
      nextPath: '/competitors',
    }
  }
  if (path.startsWith('/competitors')) {
    return {
      section: pick(lang, 'المنافسين', 'Competitors', 'Concurrents'),
      page: pick(lang, 'المقارنة', 'Comparison', 'Comparaison'),
      backPath: '/ai-brain',
      nextPath: '/status',
    }
  }
  if (path.startsWith('/immocontact')) {
    return {
      section: pick(lang, 'تواصل', 'Contact', 'Contact'),
      page: pick(lang, 'صندوق الرسائل', 'Inbox', 'Boîte de réception'),
      backPath: home,
      nextPath: '',
    }
  }
  return {
    section: pick(lang, 'المنصة', 'Platform', 'Plateforme'),
    page: pick(lang, 'الصفحة الحالية', 'Current page', 'Page actuelle'),
    backPath: home,
    nextPath: '',
  }
}

// Breadcrumb for a gate screen shown in place of `path` (App passes the gate kind).
function getGateRouteContext(path: string, gate: 'account' | 'become-host' | 'staff', lang: Lang) {
  if (gate === 'become-host') {
    return {
      section: pick(lang, 'المضيف', 'Host', 'Hôte'),
      page: pick(lang, 'استضف على SYBNB', 'Become a host', 'Devenir hôte'),
      backPath: '/host/why',
      nextPath: '',
    }
  }
  if (gate === 'staff') {
    return {
      section: pick(lang, 'فريق SYBNB', 'SYBNB team', 'Équipe SYBNB'),
      page: pick(lang, 'تسجيل دخول الفريق', 'Team sign-in', 'Connexion de l’équipe'),
      backPath: '/',
      nextPath: '',
    }
  }
  return accountContext(path, lang)
}

// Sign-in / open-account screen: section follows where the user is headed (returnPath), page is
// always the sign-in step, and Back returns to the page they came from (never to the gated page
// itself, which would just show the sign-in again).
function accountContext(returnPath: string, lang: Lang) {
  const page = pick(lang, 'تسجيل الدخول أو إنشاء حساب', 'Log in or sign up', 'Connexion ou inscription')
  const listingId = returnPath.match(/^\/listing\/([^/]+)$/)?.[1]
  if (listingId) {
    const listingContext = routeContextFromReturnPath(readListingReturnPath(), lang)
    return { section: listingContext.section, page, backPath: returnPath, nextPath: '' }
  }
  if (returnPath.startsWith('/immocontact')) {
    // Contacting an owner/seller: name the section of the listing they were browsing.
    const listingContext = routeContextFromReturnPath(readListingReturnPath(), lang)
    return { section: listingContext.section, page, backPath: listingContext.backPath, nextPath: '' }
  }
  if (returnPath.startsWith('/rentals')) {
    return { section: pick(lang, 'الإيجار الشهري', 'Monthly rental', 'Location au mois'), page, backPath: '/rentals', nextPath: '' }
  }
  if (returnPath.startsWith('/buy')) {
    return { section: pick(lang, 'شراء عقار', 'Buy property', 'Achat immobilier'), page, backPath: '/buy', nextPath: '' }
  }
  if (returnPath.startsWith('/host')) {
    return { section: pick(lang, 'المضيف', 'Host', 'Hôte'), page, backPath: '/host/why', nextPath: '' }
  }
  if (returnPath === '/ride' || returnPath === '/ride-preview' || returnPath.startsWith('/business')) {
    return { section: pick(lang, 'رحلات سير', 'SR Rides', 'Trajets SR'), page, backPath: '/', nextPath: '' }
  }
  if (returnPath.startsWith('/stays') || returnPath.startsWith('/booking') || returnPath.startsWith('/payment')) {
    return { section: pick(lang, 'الإيجار اليومي', 'Short-term rental', 'Location à court terme'), page, backPath: '/stays', nextPath: '' }
  }
  return { section: pick(lang, 'الحساب', 'Account', 'Compte'), page, backPath: '/', nextPath: '' }
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

function routeContextFromReturnPath(returnPath: string, lang: Lang) {
  if (returnPath.startsWith('/rentals')) {
    return {
      section: pick(lang, 'الإيجار الشهري', 'Monthly rental', 'Location au mois'),
      detailsPage: pick(lang, 'تفاصيل الإيجار', 'Rental details', 'Détails de la location'),
      backPath: '/rentals',
    }
  }
  if (returnPath.startsWith('/cars')) {
    return {
      section: pick(lang, 'المركبات', 'Cars', 'Véhicules'),
      detailsPage: pick(lang, 'تفاصيل المركبة', 'Vehicle details', 'Détails du véhicule'),
      backPath: '/cars',
    }
  }
  if (returnPath.startsWith('/marketplace')) {
    return {
      section: pick(lang, 'السوق', 'Marketplace', 'Marché'),
      detailsPage: pick(lang, 'تفاصيل المنتج', 'Product details', 'Détails du produit'),
      backPath: '/marketplace',
    }
  }
  if (returnPath.startsWith('/buy')) {
    return {
      section: pick(lang, 'شراء عقار', 'Buy property', 'Achat immobilier'),
      detailsPage: pick(lang, 'تفاصيل العقار', 'Property details', 'Détails de la propriété'),
      backPath: '/buy',
    }
  }
  if (returnPath.startsWith('/new-construction')) {
    return {
      section: pick(lang, 'مشاريع جديدة', 'New construction', 'Projets neufs'),
      detailsPage: pick(lang, 'تفاصيل المشروع', 'Project details', 'Détails du projet'),
      backPath: '/new-construction',
    }
  }
  return {
    section: pick(lang, 'الإيجار اليومي', 'Short-term rental', 'Location à court terme'),
    detailsPage: pick(lang, 'تفاصيل الإقامة', 'Stay details', 'Détails du séjour'),
    backPath: '/stays',
  }
}
