import { useEffect, useState } from 'react'
import { localeForLang } from '../../shared/country/presentation'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchPrototypeOverview,
  type PlatformOverview,
} from '../../shared/api/platformApi'
import { listingTitleText, moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    previous: 'السابق',
    next: 'التالي',
    title: 'حسابي ورحلتي',
    subtitle: 'حجوزاتي، إثباتات الدفع، المحفظة، ورحلات SR الخاصة بي فقط.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    error: 'تعذر تحميل اللوحة',
    bookings: 'الحجوزات والطلبات',
    listings: 'الإعلانات',
    rides: 'رحلات SR',
    payments: 'المدفوعات',
    wallet: 'المحفظة',
    nextStep: 'الخطوة التالية',
    status: 'الحالة',
    amount: 'المبلغ',
    listing: 'الإعلان',
    provider: 'المزوّد',
    balance: 'الرصيد',
    pay: 'دفع',
    details: 'التفاصيل',
    receipt: 'الإيصال',
    paymentStatus: 'حالة الدفع',
    empty: 'لا توجد عناصر بعد.',
    tripTimeline: 'مسار الرحلة',
    tripTimelineCopy: 'تابع ما يحدث بعد الدفع، وافتح نزاعاً إذا ظهرت مشكلة.',
    dispute: 'فتح نزاع',
    support: 'الدعم',
    protected: 'محمي',
    disputeOpen: 'نزاع مفتوح',
    disputeCopy: 'إذا كان لديك نزاع، يبقى المبلغ محمياً ويتم تحويل الحالة إلى فريق SYBNB مع رقم الحجز وإثبات الدفع.',
    timelineSteps: ['اختيار الاستضافة', 'إثبات الدفع', 'SYBNB يراجع', 'تأكيد الحجز', 'تعليمات الوصول', 'انتهاء الرحلة'],
    privacyTitle: 'خصوصية الرحلة',
    privacyCopy: 'تتم إزالة معلومات الرحلة الحساسة أسبوعياً. يمكنك حفظ نسخة شخصية أو طباعتها قبل الإزالة.',
    saveTrip: 'حفظ نسخة شخصية',
    printTrip: 'طباعة الرحلة',
    member: 'العضوية الموثقة',
    pendingVerification: 'التوثيق قيد المراجعة',
    verifyNow: 'وثّق هويتك',
    inTrip: 'في الرحلة',
    upcomingTrip: 'رحلة قادمة',
    noActiveTrip: 'لا توجد رحلة نشطة حالياً',
    noActiveTripCopy: 'ابحث عن إقامة واحجزها لتظهر تفاصيل رحلتك هنا.',
    invoice: 'الفاتورة',
    contact: 'الاتصال',
    sos: 'SOS',
    trustCopy: 'حجزك محمي بالكامل مع نظام SYBNB Trust',
    trustScore: 'مركز الثقة',
    currentTrip: 'رحلتي الحالية',
    previousTrips: 'رحلاتي السابقة',
    tripDates: '12 - 15 فبراير',
    progressSteps: ['تم الحجز', 'تم الدفع', 'الوصول', 'المغادرة'],
    walletTitle: 'محفظتي وحركات الدفع',
    walletSubtitle: 'كل المبالغ المحمية، المدفوعة، والمراجعة في مكان واحد.',
    availableBalance: 'الرصيد المتاح',
    protectedFunds: 'الأموال المحمية',
    walletTransactions: 'حركات المحفظة',
    noTransactions: 'لا توجد حركات دفع بعد.',
    method: 'الطريقة',
    reviewStatus: 'حالة المراجعة',
    bookingRef: 'رقم الحجز',
  },
  en: {
    back: 'Back to landing',
    previous: 'Previous',
    next: 'Next',
    title: 'My Account and Trip',
    subtitle: 'Only my bookings, payment proofs, wallet, and SR rides.',
    refresh: 'Refresh',
    loading: 'Loading',
    error: 'Could not load dashboard',
    bookings: 'Bookings and requests',
    listings: 'Listings',
    rides: 'SR rides',
    payments: 'Payments',
    wallet: 'Wallet',
    nextStep: 'Next step',
    status: 'Status',
    amount: 'Amount',
    listing: 'Listing',
    provider: 'Provider',
    balance: 'Balance',
    pay: 'Pay',
    details: 'Details',
    receipt: 'Receipt',
    paymentStatus: 'Payment status',
    empty: 'No items yet.',
    tripTimeline: 'Trip timeline',
    tripTimelineCopy: 'Track what happens after payment, and open a dispute if something goes wrong.',
    dispute: 'Open dispute',
    support: 'Support',
    protected: 'Protected',
    disputeOpen: 'Dispute open',
    disputeCopy: 'If you have a dispute, funds stay protected and the case goes to the SYBNB team with booking and payment proof.',
    timelineSteps: ['Stay selected', 'Payment proof', 'SYBNB review', 'Booking confirmed', 'Arrival instructions', 'Trip complete'],
    privacyTitle: 'Trip privacy',
    privacyCopy: 'Sensitive trip information is removed weekly. You can save a personal copy or print it before removal.',
    saveTrip: 'Save personal copy',
    printTrip: 'Print trip',
    member: 'Verified membership',
    pendingVerification: 'Verification in review',
    verifyNow: 'Verify your identity',
    inTrip: 'In trip',
    upcomingTrip: 'Upcoming trip',
    noActiveTrip: 'No active trip right now',
    noActiveTripCopy: 'Search and book a stay to see your trip details here.',
    invoice: 'Invoice',
    contact: 'Contact',
    sos: 'SOS',
    trustCopy: 'Your booking is fully protected with SYBNB Trust',
    trustScore: 'Trust Center',
    currentTrip: 'Current trip',
    previousTrips: 'Previous trips',
    tripDates: 'Feb 12 - 15',
    progressSteps: ['Booked', 'Paid', 'Arrival', 'Departure'],
    walletTitle: 'My Wallet and Payment Movements',
    walletSubtitle: 'Protected, paid, and reviewed amounts in one place.',
    availableBalance: 'Available balance',
    protectedFunds: 'Protected funds',
    walletTransactions: 'Wallet transactions',
    noTransactions: 'No payment movements yet.',
    method: 'Method',
    reviewStatus: 'Review status',
    bookingRef: 'Booking ref',
  },
  fr: {
    back: 'Retour à l’accueil',
    previous: 'Précédent',
    next: 'Suivant',
    title: 'Mon compte et mon voyage',
    subtitle: 'Uniquement mes réservations, preuves de paiement, portefeuille et trajets SR.',
    refresh: 'Actualiser',
    loading: 'Chargement',
    error: 'Impossible de charger le tableau de bord',
    bookings: 'Réservations et demandes',
    listings: 'Annonces',
    rides: 'Trajets SR',
    payments: 'Paiements',
    wallet: 'Portefeuille',
    nextStep: 'Étape suivante',
    status: 'Statut',
    amount: 'Montant',
    listing: 'Annonce',
    provider: 'Fournisseur',
    balance: 'Solde',
    pay: 'Payer',
    details: 'Détails',
    receipt: 'Reçu',
    paymentStatus: 'Statut du paiement',
    empty: 'Aucun élément pour le moment.',
    tripTimeline: 'Déroulement du voyage',
    tripTimelineCopy: 'Suivez ce qui se passe après le paiement et ouvrez un litige en cas de problème.',
    dispute: 'Ouvrir un litige',
    support: 'Soutien',
    protected: 'Protégé',
    disputeOpen: 'Litige ouvert',
    disputeCopy: 'En cas de litige, les fonds restent protégés et le dossier est transmis à l’équipe SYBNB avec la réservation et la preuve de paiement.',
    timelineSteps: ['Séjour choisi', 'Preuve de paiement', 'Vérification SYBNB', 'Réservation confirmée', 'Instructions d’arrivée', 'Voyage terminé'],
    privacyTitle: 'Confidentialité du voyage',
    privacyCopy: 'Les informations sensibles du voyage sont supprimées chaque semaine. Vous pouvez en enregistrer une copie personnelle ou l’imprimer avant la suppression.',
    saveTrip: 'Enregistrer une copie personnelle',
    printTrip: 'Imprimer le voyage',
    member: 'Membre vérifié',
    pendingVerification: 'Vérification en cours',
    verifyNow: 'Vérifiez votre identité',
    inTrip: 'En voyage',
    upcomingTrip: 'Voyage à venir',
    noActiveTrip: 'Aucun voyage en cours',
    noActiveTripCopy: 'Recherchez et réservez un séjour pour voir les détails de votre voyage ici.',
    invoice: 'Facture',
    contact: 'Contact',
    sos: 'SOS',
    trustCopy: 'Votre réservation est entièrement protégée par SYBNB Trust',
    trustScore: 'Centre de confiance',
    currentTrip: 'Voyage en cours',
    previousTrips: 'Voyages précédents',
    tripDates: '12 - 15 févr.',
    progressSteps: ['Réservé', 'Payé', 'Arrivée', 'Départ'],
    walletTitle: 'Mon portefeuille et mes paiements',
    walletSubtitle: 'Les montants protégés, payés et vérifiés, au même endroit.',
    availableBalance: 'Solde disponible',
    protectedFunds: 'Fonds protégés',
    walletTransactions: 'Transactions du portefeuille',
    noTransactions: 'Aucun mouvement de paiement pour le moment.',
    method: 'Mode',
    reviewStatus: 'Statut de la vérification',
    bookingRef: 'Réf. de réservation',
  },
}

export function DashboardPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadOverview()
  }, [])

  async function loadOverview() {
    setStatus('loading')
    setMessage('')

    try {
      setOverview(await fetchPrototypeOverview())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function savePersonalCopy() {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        retention: 'Client trip/account data is designed for weekly removal unless the client saves a personal copy.',
        overview,
      },
      null,
      2,
    )
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sybnb-my-trip-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  // CAPSULE_RULES.noFakeTrustSignal: "current trip" must be a real non-terminal booking, not just
  // whichever booking was created most recently -- an old cancelled/completed booking could
  // otherwise outrank a genuinely upcoming one that was requested earlier. bookings is already
  // ordered by createdAt desc (server/routes/me.mjs), so the first non-terminal match is the most
  // recent active one. The backend's completeExpiredBookings() keeps status honest (flips CONFIRMED
  // to COMPLETED once checkOut has passed), so trusting status here is safe, not naive.
  const TERMINAL_BOOKING_STATUSES = ['COMPLETED', 'CANCELLED']
  const activeBooking = overview?.bookings.find((booking) => !TERMINAL_BOOKING_STATUSES.includes(booking.status))
  const isDisputed = activeBooking?.status === 'DISPUTED'
  const activeListing = activeBooking?.listing
  const activeTitle = activeListing ? labelForListing(activeListing, lang) : ''
  const activeReference = activeBooking?.id ? `BK-${activeBooking.id.slice(0, 4).toUpperCase()}-${activeBooking.id.slice(4, 8).toUpperCase()}` : ''
  const activeTripDates = activeBooking?.checkIn && activeBooking?.checkOut ? tripDateRange(activeBooking.checkIn, activeBooking.checkOut, lang) : ''
  const displayName = overview?.user?.displayName || pick(lang, 'ضيف', 'Guest', 'Voyageur')
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || pick(lang, 'ض', 'G', 'V')
  // CAPSULE_RULES.noFakeTrustSignal: mirrors the same real idDocumentStatus-driven pattern
  // HostDashboardPage already uses for its own verification badge -- never a static claim.
  const isMembershipVerified = overview?.user?.idDocumentStatus === 'APPROVED'
  const isMembershipPendingReview = overview?.user?.idDocumentStatus === 'PENDING_REVIEW'
  const activeStep = activeTripStep(activeBooking)
  const pastTrips =
    overview?.bookings
      .filter((booking) => booking.id !== activeBooking?.id && TERMINAL_BOOKING_STATUSES.includes(booking.status))
      .slice(0, 3)
      .map((booking) => normalizePastTrip(booking, lang)) || []
  const walletRows = normalizeWalletRows(overview, lang)
  const protectedFunds = overview?.payments
    .filter((payment) => ['PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(payment.status))
    .reduce((total, payment) => total + payment.amountMinor, 0) || activeBooking?.amountMinor || 0

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.accountTop}>
        <button style={styles.iconButton} onClick={() => void loadOverview()} aria-label={t.refresh}>♢</button>
        <div style={styles.profile}>
          <span style={styles.avatar}>{avatarLetter}</span>
          <div>
            <strong>{displayName}</strong>
            {isMembershipVerified ? (
              <span>SYBNB STAYS · {t.member}</span>
            ) : isMembershipPendingReview ? (
              <span>SYBNB STAYS · {t.pendingVerification}</span>
            ) : (
              <span>
                SYBNB STAYS ·{' '}
                <button style={styles.verifyLink} onClick={() => (window.location.hash = '/trust-center/verification')}>
                  {t.verifyNow}
                </button>
              </span>
            )}
          </div>
        </div>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.desktopHero}>
        <div style={styles.tripCard}>
          {activeBooking ? (
            <>
              <div style={styles.tripMeta}>
                {activeTripDates && <span style={styles.datePill}>{activeTripDates}</span>}
                {/* A real bug caught by an independent re-audit: this always said "In trip" for
                    any active, non-disputed booking, even days before check-in -- directly
                    contradicting the stepper below it on the same screen, which already has the
                    real signal (activeStep/hasArrived, from activeTripStep()). Now the two agree. */}
                <span style={isDisputed ? styles.disputePill : styles.activePill}>
                  {isDisputed ? t.disputeOpen : activeStep === 2 ? t.inTrip : t.upcomingTrip}
                </span>
              </div>
              <h1 style={styles.tripTitle}>{activeTitle}</h1>
              <p style={styles.tripRef}>{activeReference}</p>
              {isDisputed && <p style={styles.disputeNotice}>{t.disputeCopy}</p>}
            </>
          ) : (
            <>
              <h1 style={styles.tripTitle}>{t.noActiveTrip}</h1>
              <p style={styles.tripRef}>{t.noActiveTripCopy}</p>
            </>
          )}
          <div style={styles.tripActions}>
            <button style={styles.sosButton} onClick={() => (window.location.hash = '/trust-center/sos')}>
              {t.sos} ⚠
            </button>
            <button style={styles.goldButton} onClick={() => activeBooking?.payments?.[0]?.id ? (window.location.hash = `/payment/receipt/${activeBooking.payments[0].id}`) : window.print()}>
              {t.invoice} ▤
            </button>
            <button style={styles.blueButton} onClick={() => (window.location.hash = '/immocontact')}>
              {t.contact} ◯
            </button>
          </div>
        </div>

        <div style={styles.sidePanel}>
          <section style={styles.trustStrip}>
            <span>{t.trustScore}</span>
            <strong>{t.trustCopy}</strong>
          </section>
          <section style={styles.quickCards}>
            <button style={styles.paymentTile} onClick={() => (window.location.hash = '/wallet')}>
              <span>{t.availableBalance}</span>
              <strong>{moneyText(overview?.wallet?.cachedBalanceMinor || 0, overview?.wallet?.currency || activeBooking?.currency || 'SYP', lang)}</strong>
              <small>{t.wallet}</small>
            </button>
            <button style={styles.trustTile} onClick={() => (window.location.hash = '/trust-center')}>
              <span>{t.trustScore}</span>
              <small>{pick(lang, 'مركز الثقة', 'Trust Center', 'Centre de confiance')}</small>
            </button>
            <button style={styles.trustTile} onClick={() => (window.location.hash = '/profile')}>
              <span>★</span>
              <small>{pick(lang, 'ملفي ونقاط الولاء', 'Profile & rewards', 'Profil & fidélité')}</small>
            </button>
          </section>
        </div>
      </section>

      <section style={styles.progressWrap} aria-label={t.tripTimeline}>
        {t.progressSteps.map((step, index) => (
          <div key={step} style={styles.progressItem}>
            <span style={index <= activeStep ? styles.progressDotActive : styles.progressDot}>{index <= activeStep ? '✓' : '↗'}</span>
            <small style={index <= activeStep ? styles.progressTextActive : styles.progressText}>{step}</small>
          </div>
        ))}
      </section>

      <section style={styles.walletPanel}>
        <div style={styles.sectionHeader}>
          <div>
            <h2>{t.walletTitle}</h2>
            <p>{t.walletSubtitle}</p>
          </div>
          <button style={styles.secondaryButton} onClick={() => (window.location.hash = '/wallet')}>{t.details}</button>
        </div>

        <div style={styles.walletStats}>
          <article style={styles.walletStat}>
            <span>{t.availableBalance}</span>
            <strong>{moneyText(overview?.wallet?.cachedBalanceMinor || 0, overview?.wallet?.currency || activeBooking?.currency || 'SYP', lang)}</strong>
          </article>
          <article style={styles.walletStatProtected}>
            <span>{t.protectedFunds}</span>
            <strong>{moneyText(protectedFunds, activeBooking?.currency || 'SYP', lang)}</strong>
          </article>
        </div>

        <div style={styles.transactionList}>
          <strong>{t.walletTransactions}</strong>
          {walletRows.length ? walletRows.map((row) => (
            <article key={row.id} style={styles.transactionRow}>
              <div>
                <b>{row.title}</b>
                <span>{t.bookingRef}: {row.ref}</span>
              </div>
              <div>
                <b>{row.amount}</b>
                <span>{t.method}: {row.method}</span>
              </div>
              <em style={row.statusTone === 'green' ? styles.statusGreen : styles.statusGold}>{row.status}</em>
            </article>
          )) : <p style={styles.mutedText}>{t.noTransactions}</p>}
        </div>
      </section>

      <section style={styles.privacyPanel}>
        <button style={styles.secondaryButton} onClick={savePersonalCopy}>{t.saveTrip}</button>
        <button style={styles.secondaryButton} onClick={() => window.print()}>{t.printTrip}</button>
      </section>

      <section style={styles.previousTrips}>
        <h2>{t.previousTrips}</h2>
        {pastTrips.length ? pastTrips.map((trip) => (
          <article key={trip.id} style={styles.previousTrip}>
            <img style={styles.tripThumb} src={trip.image} alt="" />
            <div>
              <strong>{trip.title}</strong>
              <span>{trip.dates}</span>
            </div>
            <b>{trip.statusLabel}</b>
          </article>
        )) : <p style={styles.mutedText}>{t.empty}</p>}
      </section>
    </main>
  )
}

function bookingImage(booking: PlatformOverview['bookings'][number]) {
  const mediaUrl = booking.listing?.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  return typeof mediaUrl === 'string' ? mediaUrl : '/assets/divisions/daily-rental.webp'
}

function normalizePastTrip(booking: PlatformOverview['bookings'][number], lang: Lang) {
  return {
    id: booking.id,
    title: booking.listing ? labelForListing(booking.listing, lang) : booking.id.slice(0, 8).toUpperCase(),
    dates: booking.checkIn && booking.checkOut ? tripDateRange(booking.checkIn, booking.checkOut, lang) : pick(lang, 'رحلة محفوظة', 'Saved trip', 'Voyage enregistré'),
    image: bookingImage(booking),
    statusLabel: statusText(booking.status, lang),
  }
}

function tripDateRange(checkIn: string, checkOut: string, lang: Lang) {
  const locale = pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA')
  // Check-in/check-out are stored/returned as midnight-UTC dates -- formatting without an
  // explicit UTC timeZone rolls the date back a day for any viewer west of UTC (found by an
  // independent re-audit: a real Aug 30 booking rendered as "Aug 29" in EDT).
  const format = (value: string) => new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `${format(checkIn)} - ${format(checkOut)}`
}

function labelForListing(listing: NonNullable<PlatformOverview['bookings'][number]['listing']>, lang: Lang) {
  return listingTitleText(listing, lang)
}

function activeTripStep(booking: PlatformOverview['bookings'][number] | undefined) {
  // "Arrival" (step 2) must reflect the real check-in date, not just booking+payment confirmation --
  // a CONFIRMED booking used to force-show "Arrival" as done the instant it was paid, even for a
  // stay weeks away. Scoped to this booking's own payments only -- a guest's unrelated payment from
  // a different booking must never influence this booking's progress stepper.
  if (!booking) return -1
  if (booking.status === 'COMPLETED') return 3
  const payment = booking.payments?.[0]
  const isPaid = booking.status === 'CONFIRMED' || payment?.status === 'APPROVED'
  if (!isPaid) return 0
  const hasArrived = booking.checkIn ? new Date(booking.checkIn).getTime() <= Date.now() : false
  return hasArrived ? 2 : 1
}

function normalizeWalletRows(overview: PlatformOverview | null, lang: Lang) {
  if (!overview) return []
  const paymentRows = overview.payments.slice(0, 5).map((payment) => ({
    id: payment.id,
    title: payment.booking?.listing ? labelForListing(payment.booking.listing, lang) : pick(lang, 'دفعة حجز', 'Booking payment', 'Paiement de réservation'),
    ref: payment.bookingId ? `BK-${payment.bookingId.slice(0, 8).toUpperCase()}` : payment.providerRef || payment.id.slice(0, 8).toUpperCase(),
    amount: moneyText(payment.amountMinor, payment.currency, lang),
    method: payment.provider,
    status: paymentStatusLabel(payment.status, lang),
    statusTone: payment.status === 'APPROVED' ? 'green' : 'gold',
  }))

  if (paymentRows.length) return paymentRows

  return (overview.wallet?.entries || []).slice(0, 5).map((entry, index) => {
    const amountMinor = typeof entry.amountMinor === 'number' ? entry.amountMinor : 0
    const currency = typeof entry.currency === 'string' ? entry.currency : overview.wallet?.currency || 'SYP'
    const type = typeof entry.type === 'string' ? entry.type : pick(lang, 'حركة محفظة', 'Wallet movement', 'Mouvement de portefeuille')
    const status = typeof entry.status === 'string' ? entry.status : 'RECORDED'
    return {
      id: String(entry.id || index),
      title: type,
      ref: String(entry.bookingId || entry.reference || entry.id || `WALLET-${index + 1}`),
      amount: moneyText(amountMinor, currency, lang),
      method: pick(lang, 'محفظة SYBNB', 'SYBNB Wallet', 'Portefeuille SYBNB'),
      status: paymentStatusLabel(status, lang),
      statusTone: status === 'APPROVED' || status === 'RECORDED' ? 'green' : 'gold',
    }
  })
}

function paymentStatusLabel(status: string, lang: Lang) {
  const ar: Record<string, string> = {
    APPROVED: 'مؤكد',
    PENDING: 'قيد المراجعة',
    SUBMITTED: 'تم الإرسال',
    UNDER_REVIEW: 'تحت المراجعة',
    REJECTED: 'مرفوض',
    RECORDED: 'مسجلة',
  }
  const en: Record<string, string> = {
    APPROVED: 'Confirmed',
    PENDING: 'In review',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under review',
    REJECTED: 'Rejected',
    RECORDED: 'Recorded',
  }
  const fr: Record<string, string> = {
    APPROVED: 'Confirmé',
    PENDING: 'En vérification',
    SUBMITTED: 'Envoyé',
    UNDER_REVIEW: 'En cours de vérification',
    REJECTED: 'Refusé',
    RECORDED: 'Enregistré',
  }
  return pick(lang, ar, en, fr)[status] || status
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#050507', color: '#fff', padding: '36px clamp(22px, 4vw, 54px) 110px', display: 'grid', gap: 24, maxWidth: 1180, margin: '0 auto' },
  accountTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
  iconButton: { width: 50, height: 50, borderRadius: 999, border: '1px solid #242b3e', background: '#101522', color: '#fff', fontSize: 26, display: 'grid', placeItems: 'center' },
  profile: { display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', gap: 12, textAlign: 'right' },
  avatar: { width: 48, height: 48, borderRadius: 999, border: '2px solid rgba(255,255,255,.24)', background: 'linear-gradient(145deg,#5268ff,#20d29b)', display: 'grid', placeItems: 'center', fontWeight: 950, color: '#fff' },
  verifyLink: { border: 0, background: 'none', padding: 0, color: '#ffb020', fontWeight: 900, fontSize: 'inherit', textDecoration: 'underline', cursor: 'pointer' },
  desktopHero: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.42fr) minmax(330px, .78fr)', gap: 18, alignItems: 'stretch' },
  sidePanel: { display: 'grid', gap: 16, alignContent: 'stretch' },
  tripCard: { border: '1.5px solid #20d29b', borderRadius: 22, background: '#14141b', padding: 30, display: 'grid', gap: 18, alignContent: 'center', minHeight: 300, boxShadow: '0 18px 42px rgba(0,0,0,.34)' },
  tripMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  datePill: { borderRadius: 999, background: '#25252f', color: '#d6d9e6', padding: '7px 12px', fontSize: 12, fontWeight: 900 },
  activePill: { color: '#20d29b', fontSize: 13, fontWeight: 950 },
  disputePill: { color: '#ffb020', fontSize: 13, fontWeight: 950 },
  tripTitle: { margin: 0, fontSize: 38, lineHeight: 1.12, textAlign: 'right' },
  tripRef: { margin: 0, color: '#82899b', textAlign: 'right', fontWeight: 800 },
  disputeNotice: { margin: 0, color: '#ffb020', textAlign: 'right', fontWeight: 800, fontSize: 13 },
  tripActions: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
  sosButton: { minHeight: 64, borderRadius: 14, border: '2px solid #ff4c73', background: 'transparent', color: '#ff4c73', fontWeight: 950, fontSize: 17 },
  goldButton: { minHeight: 64, border: 0, borderRadius: 14, background: '#e5b80b', color: '#fff', fontWeight: 950, fontSize: 17 },
  blueButton: { minHeight: 64, border: 0, borderRadius: 14, background: '#5268ff', color: '#fff', fontWeight: 950, fontSize: 17 },
  progressWrap: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, position: 'relative', border: '1px solid #1f2739', borderRadius: 18, background: '#101522', padding: 16 },
  progressItem: { display: 'grid', justifyItems: 'center', gap: 7 },
  progressDot: { width: 36, height: 36, borderRadius: 999, background: '#242532', color: '#a0a6b8', display: 'grid', placeItems: 'center', fontWeight: 950 },
  progressDotActive: { width: 36, height: 36, borderRadius: 999, background: '#20d29b', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 950 },
  progressText: { color: '#83899a', fontWeight: 900, textAlign: 'center' },
  progressTextActive: { color: '#fff', fontWeight: 950, textAlign: 'center' },
  trustStrip: { borderRadius: 16, background: '#20c987', color: '#fff', padding: '18px 20px', display: 'grid', gap: 8, alignContent: 'center', fontWeight: 950, minHeight: 118 },
  quickCards: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  paymentTile: { minHeight: 166, border: 0, borderRadius: 18, background: 'linear-gradient(145deg, #5268ff 0%, #e5b80b 74%)', color: '#fff', padding: 18, display: 'grid', alignContent: 'space-between', textAlign: 'center', fontWeight: 950 },
  trustTile: { minHeight: 166, border: 0, borderRadius: 18, background: 'linear-gradient(145deg, #20d29b 0%, #b57dff 100%)', color: '#fff', padding: 18, display: 'grid', alignContent: 'space-between', textAlign: 'center', fontWeight: 950 },
  walletPanel: { border: '1px solid #232c42', borderRadius: 20, background: '#111520', padding: 22, display: 'grid', gap: 18 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center' },
  walletStats: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 },
  walletStat: { border: '1px solid #2a3450', borderRadius: 16, background: '#0d1320', padding: 18, display: 'grid', gap: 8 },
  walletStatProtected: { border: '1px solid rgba(32,210,155,.45)', borderRadius: 16, background: 'rgba(32,210,155,.08)', padding: 18, display: 'grid', gap: 8 },
  transactionList: { display: 'grid', gap: 10 },
  transactionRow: { border: '1px solid #263049', borderRadius: 14, background: '#0b101b', padding: 14, display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto', gap: 14, alignItems: 'center' },
  statusGreen: { borderRadius: 999, background: 'rgba(32,210,155,.16)', color: '#20d29b', padding: '8px 12px', fontStyle: 'normal', fontWeight: 950 },
  statusGold: { borderRadius: 999, background: 'rgba(229,184,11,.14)', color: '#e5b80b', padding: '8px 12px', fontStyle: 'normal', fontWeight: 950 },
  mutedText: { color: '#9098ad', margin: 0 },
  privacyPanel: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  secondaryButton: { minHeight: 48, border: '1px solid #30384d', borderRadius: 12, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  previousTrips: { display: 'grid', gap: 14 },
  previousTrip: { minHeight: 96, borderRadius: 16, background: '#14141b', padding: 12, display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 14, alignItems: 'center' },
  tripThumb: { width: 90, height: 70, borderRadius: 12, objectFit: 'cover' },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 12, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
}
