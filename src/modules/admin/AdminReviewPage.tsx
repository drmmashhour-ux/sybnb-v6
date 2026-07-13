import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminPayouts,
  fetchIdDocumentBlobUrl,
  fetchPrototypeAdminAuditLog,
  fetchPrototypeReviewQueue,
  getStoredStaffSession,
  lookupAdminUserByEmail,
  releaseAdminPayout,
  reviewPrototypePaymentProof,
  reviewPrototypeQueueEntity,
  uploadIdDocumentForUser,
  type AdminPayout,
  type PlatformAdminAuditLog,
  type PlatformIdDocumentReview,
  type PlatformListing,
  type PlatformPaymentProof,
  type PlatformReviewBooking,
  type PlatformReviewQueue,
  type PlatformWalletGift,
} from '../../shared/api/platformApi'
import { BrandLogo } from '../../shared/brand'
import { divisionText, listingDescriptionText, listingTitleText, moneyText, providerText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'مراجعة الإدارة',
    subtitle: 'قائمة مباشرة من قاعدة البيانات للإعلانات والمدفوعات والهدايا والحجوزات بانتظار القرار.',
    listings: 'الإعلانات',
    payments: 'المدفوعات',
    gifts: 'الهدايا',
    bookings: 'الحجوزات والطلبات',
    audit: 'سجل الإدارة',
    empty: 'لا توجد عناصر بانتظار المراجعة.',
    auditEmpty: 'لا توجد قرارات إدارية مسجلة بعد.',
    approve: 'موافقة',
    reject: 'رفض',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    error: 'تعذر تحميل قائمة المراجعة',
    price: 'السعر',
    provider: 'المزوّد',
    listing: 'الإعلان',
    actor: 'المسؤول',
    entity: 'العنصر',
    details: 'فتح التفاصيل',
    search: 'بحث',
    all: 'الكل',
  },
  en: {
    back: 'Back to landing',
    title: 'Admin Review',
    subtitle: 'Live PostgreSQL queue for listings, payments, gifts, and bookings waiting on a decision.',
    listings: 'Listings',
    payments: 'Payments',
    gifts: 'Gifts',
    bookings: 'Bookings and requests',
    audit: 'Admin audit log',
    empty: 'No items waiting for review.',
    auditEmpty: 'No admin decisions recorded yet.',
    approve: 'Approve',
    reject: 'Reject',
    refresh: 'Refresh',
    loading: 'Loading',
    error: 'Could not load review queue',
    price: 'Price',
    provider: 'Provider',
    listing: 'Listing',
    actor: 'Actor',
    entity: 'Entity',
    details: 'Open details',
    search: 'Search',
    all: 'All',
  },
}

type AdminFilter = 'all' | 'listings' | 'payments' | 'gifts' | 'bookings' | 'audit'
type AdminCommandView = 'general' | 'audit' | 'aiBrain' | 'disputes' | 'hosts' | 'customers' | 'bookings' | 'finance'
type ShamCashApprovalPayload = {
  accountMinor: number | null
  expectedMinor: number
  differenceMinor: number
  source?: string
}

const SHAM_CASH_ACCOUNT_BALANCE_KEY = 'sybnb_v6_sham_cash_account_minor'
const STR_ADMIN_COMMISSION_RATE = 0.1
const STR_TAX_RATE = 0.02
const STR_CLEANING_RATE = 0.05

const todayStatBars = [42, 61, 51, 74, 86, 104, 64]

const recentAdminUsers = [
  { ar: 'سامر محمد', en: 'Samer Mohammad', statusAr: 'نشط', statusEn: 'Active', tone: 'green', ageAr: 'انضم منذ ٥ دقائق', ageEn: 'Joined 5 minutes ago' },
  { ar: 'محمد علي', en: 'Mohammad Ali', statusAr: 'قيد المراجعة', statusEn: 'Review', tone: 'gold', ageAr: 'انضم منذ ١٢ دقيقة', ageEn: 'Joined 12 minutes ago' },
  { ar: 'نور حسين', en: 'Nour Hussein', statusAr: 'نشط', statusEn: 'Active', tone: 'green', ageAr: 'انضمت منذ ٢٤ دقيقة', ageEn: 'Joined 24 minutes ago' },
  { ar: 'عمر خالد', en: 'Omar Khaled', statusAr: 'قيد المراجعة', statusEn: 'Review', tone: 'gold', ageAr: 'انضم منذ ٤٥ دقيقة', ageEn: 'Joined 45 minutes ago' },
]

export function AdminReviewPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [auditLog, setAuditLog] = useState<PlatformAdminAuditLog[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'saving'>('loading')
  const [message, setMessage] = useState('')
  const [activeFilter, setActiveFilter] = useState<AdminFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [payouts, setPayouts] = useState<AdminPayout[]>([])
  const [payoutHoldDays, setPayoutHoldDays] = useState(14)
  const [releasingPayoutId, setReleasingPayoutId] = useState('')

  const total = useMemo(() => {
    if (!queue) return 0
    return queue.listings.length + queue.payments.length + queue.gifts.length + queue.bookings.length
  }, [queue])

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const paymentQueue = useMemo(() => queue?.payments || [], [queue])
  const visibleListings = useMemo(
    () => (queue?.listings || []).filter((listing) => matchesSearch([listing.titleAr, listing.titleEn, listing.status, listing.division, listing.id], normalizedSearch)),
    [normalizedSearch, queue],
  )
  const visiblePayments = useMemo(
    () => paymentQueue.filter((payment) => matchesSearch([payment.provider, payment.providerRef, payment.status, payment.currency, payment.id], normalizedSearch)),
    [normalizedSearch, paymentQueue],
  )
  const visibleGifts = useMemo(
    () => (queue?.gifts || []).filter((gift) => matchesSearch([gift.id, gift.status, gift.currency, gift.message, gift.senderUserId], normalizedSearch)),
    [normalizedSearch, queue],
  )
  const visibleBookings = useMemo(
    () =>
      (queue?.bookings || []).filter((booking) =>
        matchesSearch([
          booking.id,
          booking.status,
          booking.currency,
          booking.listing?.titleAr,
          booking.listing?.titleEn,
          booking.listing?.division,
        ], normalizedSearch),
      ),
    [normalizedSearch, queue],
  )
  const visibleAuditLog = useMemo(
    () => auditLog.filter((entry) => matchesSearch([entry.action, entry.entityType, entry.entityId, entry.actor?.displayName, entry.actor?.email], normalizedSearch)),
    [auditLog, normalizedSearch],
  )
  const activityItems = useMemo(() => {
    const liveItems = visibleAuditLog.slice(0, 4).map((entry, index) => ({
      label: auditActionText(entry.action, lang),
      detail: isAr ? 'منذ دقائق' : 'Minutes ago',
      tone: index % 3 === 0 ? 'green' : index % 3 === 1 ? 'gold' : 'red',
    }))

    if (liveItems.length >= 4) return liveItems

    const fallback = [
      { label: isAr ? 'مستخدم جديد: سامر محمد' : 'New user: Samer Mohammad', detail: isAr ? 'منذ ٥ دقائق' : '5 minutes ago', tone: 'green' },
      { label: isAr ? 'دفعة مستلمة: ١٥٠,٠٠٠ ل.س' : 'Payment received: 150,000 SYP', detail: isAr ? 'منذ ١٢ دقيقة' : '12 minutes ago', tone: 'gold' },
      { label: isAr ? 'إعلان مرفوض: شقة في جرمانا' : 'Rejected listing: Jaramana stay', detail: isAr ? 'منذ ٣٢ دقيقة' : '32 minutes ago', tone: 'red' },
      { label: 'AI v6.2.1', detail: isAr ? 'نشط الآن' : 'Active now', tone: 'blue' },
    ]

    return [...liveItems, ...fallback].slice(0, 4)
  }, [isAr, lang, visibleAuditLog])
  const visibleTotal = visibleListings.length + visiblePayments.length + visibleGifts.length + visibleBookings.length
  const nowLabel = new Intl.DateTimeFormat(isAr ? 'ar-SY' : 'en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date())
  const timeLabel = new Intl.DateTimeFormat(isAr ? 'ar-SY' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
  const filterItems: Array<{ id: AdminFilter; label: string; count: number }> = [
    { id: 'all', label: t.all, count: visibleTotal + visibleAuditLog.length },
    { id: 'listings', label: t.listings, count: visibleListings.length },
    { id: 'payments', label: t.payments, count: visiblePayments.length },
    { id: 'gifts', label: t.gifts, count: visibleGifts.length },
    { id: 'bookings', label: t.bookings, count: visibleBookings.length },
    { id: 'audit', label: t.audit, count: visibleAuditLog.length },
  ]

  useEffect(() => {
    void loadQueue()
    void loadPayouts()
  }, [])

  async function loadQueue() {
    setStatus('loading')
    setMessage('')

    try {
      const [nextQueue, nextAuditLog] = await Promise.all([
        fetchPrototypeReviewQueue(),
        fetchPrototypeAdminAuditLog(12),
      ])
      setQueue(nextQueue)
      setAuditLog(nextAuditLog)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function loadPayouts() {
    try {
      const response = await fetchAdminPayouts()
      setPayouts(response.payouts)
      setPayoutHoldDays(response.holdDays)
    } catch {
      setPayouts([])
    }
  }

  async function releasePayout(bookingId: string) {
    setReleasingPayoutId(bookingId)
    try {
      await releaseAdminPayout(bookingId)
      await loadPayouts()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setReleasingPayoutId('')
    }
  }

  async function decide(
    entityType: 'listings' | 'payments' | 'gifts' | 'bookings' | 'iddocuments',
    id: string,
    decision: 'APPROVE' | 'REJECT',
    options?: { shamCashReconciliation?: ShamCashApprovalPayload },
  ) {
    setStatus('saving')
    setMessage('')

    try {
      if (entityType === 'payments') {
        await reviewPrototypePaymentProof(id, decision, undefined, options?.shamCashReconciliation)
      } else {
        await reviewPrototypeQueueEntity(entityType, id, decision)
      }
      const [nextQueue, nextAuditLog] = await Promise.all([
        fetchPrototypeReviewQueue(),
        fetchPrototypeAdminAuditLog(12),
      ])
      setQueue(nextQueue)
      setAuditLog(nextAuditLog)
      setStatus('ready')
    } catch (error) {
      setStatus('ready')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  return (
    <ShortRentAdminCommandDashboard
      auditLog={visibleAuditLog}
      disabled={status === 'saving'}
      isAr={isAr}
      lang={lang}
      listings={visibleListings}
      loadQueue={loadQueue}
      message={message}
      payments={visiblePayments.length ? visiblePayments : paymentQueue}
      queue={queue}
      status={status}
      onBookingDecision={(id, decision) => void decide('bookings', id, decision)}
      onPaymentDecision={(id, decision, shamCashReconciliation) => void decide('payments', id, decision, { shamCashReconciliation })}
      onIdDocumentDecision={(id, decision) => void decide('iddocuments', id, decision)}
      bookings={visibleBookings}
      payouts={payouts}
      payoutHoldDays={payoutHoldDays}
      releasingPayoutId={releasingPayoutId}
      onReleasePayout={(id) => void releasePayout(id)}
    />
  )

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} className="admin-console">
      <section className="admin-shell">
        <aside className="admin-side">
          <BrandLogo logo="platform" size="nav" className="admin-side-logo" />
          <button className="active" onClick={() => setActiveFilter('all')}>{isAr ? 'لوحة التحكم' : 'Dashboard'} <span>▦</span></button>
          <button onClick={() => setActiveFilter('listings')}>{t.listings} <span>▤</span></button>
          <button onClick={() => setActiveFilter('payments')}>{t.payments} <span>▭</span></button>
          <button onClick={() => (window.location.hash = '/finance')}>{isAr ? 'المالية' : 'Finance'} <span>▥</span></button>
          <button onClick={() => (window.location.hash = '/ai-brain')}>AI Brain <span>◉</span></button>
          <button onClick={() => setActiveFilter('audit')}>{isAr ? 'التقارير' : 'Reports'} <span>▧</span></button>
          <button onClick={() => (window.location.hash = '/')}>{t.back} <span>↩</span></button>
        </aside>

        <div className="admin-main">
          <header className="admin-topbar">
            <div className="admin-avatar" aria-hidden="true">A</div>
            <div className="admin-language">AR <span /> EN</div>
            <strong>{timeLabel}</strong>
            <strong>{nowLabel}</strong>
            <span>Platform Admin</span>
            <BrandLogo logo="platform" size="nav" className="admin-wordmark" />
          </header>

          <section className="admin-metrics" aria-label={isAr ? 'مؤشرات الإدارة' : 'Admin metrics'}>
            <AdminMetric label={isAr ? 'تنبيهات' : 'Alerts'} value={String(visibleGifts.length + visibleBookings.length)} tone="red" icon="!" />
            <AdminMetric label={isAr ? 'المعاملات اليوم' : 'Transactions'} value={String(visiblePayments.length)} tone="gold" icon="⚡" />
            <AdminMetric label={isAr ? 'المستخدمون النشطون' : 'Active users'} value="1,483" tone="green" icon="♙" />
            <AdminMetric label={isAr ? 'إجمالي الإعلانات' : 'Total listings'} value={String(queue?.listings.length || 0)} tone="blue" icon="▣" />
          </section>

          <section className="admin-dashboard-grid">
            <div className="admin-quick-panel">
              <h2>{isAr ? 'إجراءات سريعة' : 'Quick actions'}</h2>
              <button className="admin-primary-action" onClick={() => setActiveFilter('payments')}>{isAr ? 'مراجعة المدفوعات' : 'Review payments'} <span>☑</span></button>
              <button onClick={() => setActiveFilter('listings')}>{isAr ? 'إدارة الإعلانات' : 'Manage listings'} <span>⊕</span></button>
              <button className="admin-gold-action" onClick={() => setActiveFilter('audit')}>{isAr ? 'تقرير اليوم' : 'Today report'} <span>▥</span></button>
              <button onClick={() => void loadQueue()}>{t.refresh} <span>↻</span></button>
              <div className="admin-ai-card">
                <strong>{isAr ? 'ترقية السيرفر' : 'Server upgrade'}</strong>
                <p>{isAr ? 'استخدم الذاكرة الذكية للوصول إلى ٨٥٪ من المتابعة.' : 'Use smart memory to reach 85% platform tracking.'}</p>
                <button onClick={() => setActiveFilter('all')}>{isAr ? 'ابدأ الآن' : 'Start now'}</button>
              </div>
            </div>

            <div className="admin-table-card">
              <div className="admin-card-heading">
                <button onClick={() => setActiveFilter('all')}>{isAr ? 'عرض الكل' : 'View all'}</button>
                <h2>{isAr ? 'أحدث الإعلانات' : 'Latest listings'}</h2>
              </div>
              <div className="admin-table">
                {(visibleListings.length ? visibleListings : queue?.listings || []).length > 0 ? (
                  (visibleListings.length ? visibleListings : queue?.listings || []).slice(0, 5).map((listing) => (
                    <button key={listing.id} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>
                      <span>{listingTitleText(listing, lang)}</span>
                      <small>{divisionText(listing.division, lang)}</small>
                      <strong>{statusText(listing.status, lang)}</strong>
                    </button>
                  ))
                ) : (
                  <p className="admin-empty-row">{status === 'loading' ? t.loading : t.empty}</p>
                )}
              </div>
            </div>
          </section>

          <section className="admin-activity-panel" aria-label={isAr ? 'آخر الأنشطة' : 'Latest activity'}>
            <div className="admin-section-title">
              <button onClick={() => setActiveFilter('audit')}>{isAr ? 'شاهد السجل الكامل' : 'View full log'}</button>
              <h2>{isAr ? 'آخر الأنشطة' : 'Latest Activity'}</h2>
            </div>
            <div className="admin-activity-strip">
              {activityItems.map((item) => (
                <button key={`${item.label}-${item.detail}`} className={`admin-activity-chip ${item.tone}`} onClick={() => setActiveFilter('audit')}>
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="admin-insight-card admin-stats-card" aria-label={isAr ? 'إحصائيات اليوم' : 'Today stats'}>
            <div className="admin-section-title">
              <span>{isAr ? 'Today Stats' : 'Today Stats'}</span>
              <h2>{isAr ? 'إحصائيات اليوم' : 'Today Stats'}</h2>
            </div>
            <div className="admin-bar-chart">
              {todayStatBars.map((height, index) => (
                <span key={height} className={index === 5 ? 'gold' : ''} style={{ '--bar-height': `${height}px` } as CSSProperties} />
              ))}
            </div>
          </section>

          <section className="admin-insight-card admin-users-card" aria-label={isAr ? 'آخر المستخدمين' : 'Recent users'}>
            <div className="admin-section-title">
              <span>{isAr ? 'Recent Users' : 'Recent Users'}</span>
              <h2>{isAr ? 'آخر المستخدمين' : 'Recent Users'}</h2>
            </div>
            <div className="admin-recent-list">
              {recentAdminUsers.map((user) => (
                <article key={user.en}>
                  <strong>{isAr ? user.ar[0] : user.en[0]}</strong>
                  <div>
                    <b>{isAr ? user.ar : user.en}</b>
                    <small>{isAr ? user.ageAr : user.ageEn}</small>
                  </div>
                  <span className={user.tone}>{isAr ? user.statusAr : user.statusEn}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-tools">
            <input
              aria-label={t.search}
              placeholder={t.search}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <div>
              {filterItems.map((item) => (
                <button
                  key={item.id}
                  className={activeFilter === item.id ? 'active' : ''}
                  onClick={() => setActiveFilter(item.id)}
                >
                  {item.label} {item.count}
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>

      {status === 'error' && (
        <section style={styles.alert}>
          <strong>{t.error}</strong>
          <span>{message}</span>
        </section>
      )}

      {(activeFilter === 'all' || activeFilter === 'listings') && (
      <ReviewSection title={t.listings} empty={t.empty}>
        {visibleListings.map((listing) => (
          <ListingReviewCard
            key={listing.id}
            listing={listing}
            labels={{ approve: t.approve, reject: t.reject, price: t.price, details: t.details }}
            lang={lang}
            disabled={status === 'saving'}
            onDecision={(decision) => void decide('listings', listing.id, decision)}
          />
        ))}
      </ReviewSection>
      )}

      {(activeFilter === 'all' || activeFilter === 'payments') && (
      <ReviewSection title={t.payments} empty={t.empty}>
        {visiblePayments.map((payment) => (
          <PaymentReviewCard
            key={payment.id}
            payment={payment}
            labels={{ approve: t.approve, reject: t.reject, price: t.price, provider: t.provider, details: t.details }}
            lang={lang}
            disabled={status === 'saving'}
            onDecision={(decision) => void decide('payments', payment.id, decision)}
          />
        ))}
      </ReviewSection>
      )}

      {(activeFilter === 'all' || activeFilter === 'gifts') && (
      <ReviewSection title={t.gifts} empty={t.empty}>
        {visibleGifts.map((gift) => (
          <GiftReviewCard
            key={gift.id}
            gift={gift}
            labels={{ approve: t.approve, reject: t.reject, price: t.price, details: t.details }}
            lang={lang}
            disabled={status === 'saving'}
            onDecision={(decision) => void decide('gifts', gift.id, decision)}
          />
        ))}
      </ReviewSection>
      )}

      {(activeFilter === 'all' || activeFilter === 'bookings') && (
      <ReviewSection title={t.bookings} empty={t.empty}>
        {visibleBookings.map((booking) => (
          <BookingReviewCard
            key={booking.id}
            booking={booking}
            labels={{ approve: t.approve, reject: t.reject, price: t.price, listing: t.listing, details: t.details }}
            lang={lang}
            disabled={status === 'saving'}
            onDecision={(decision) => void decide('bookings', booking.id, decision)}
          />
        ))}
      </ReviewSection>
      )}

      {(activeFilter === 'all' || activeFilter === 'audit') && (
      <ReviewSection title={t.audit} empty={t.auditEmpty}>
        {visibleAuditLog.map((entry) => (
          <AuditLogCard
            key={entry.id}
            entry={entry}
            labels={{ actor: t.actor, entity: t.entity, details: t.details }}
            lang={lang}
          />
        ))}
      </ReviewSection>
      )}
    </main>
  )
}

function matchesSearch(values: Array<unknown>, search: string) {
  if (!search) return true
  return values.some((value) => String(value || '').toLowerCase().includes(search))
}

function ShortRentAdminCommandDashboard({
  auditLog,
  bookings,
  disabled,
  isAr,
  lang,
  listings,
  loadQueue,
  message,
  payments,
  queue,
  status,
  onBookingDecision,
  onPaymentDecision,
  onIdDocumentDecision,
  payouts,
  payoutHoldDays,
  releasingPayoutId,
  onReleasePayout,
}: {
  auditLog: PlatformAdminAuditLog[]
  bookings: PlatformReviewBooking[]
  disabled: boolean
  isAr: boolean
  lang: Lang
  listings: PlatformListing[]
  loadQueue: () => Promise<void>
  message: string
  payments: PlatformPaymentProof[]
  queue: PlatformReviewQueue | null
  status: 'loading' | 'ready' | 'error' | 'saving'
  onBookingDecision: (id: string, decision: 'APPROVE' | 'REJECT') => void
  onPaymentDecision: (id: string, decision: 'APPROVE' | 'REJECT', shamCashReconciliation?: ShamCashApprovalPayload) => void
  onIdDocumentDecision: (id: string, decision: 'APPROVE' | 'REJECT') => void
  payouts: AdminPayout[]
  payoutHoldDays: number
  releasingPayoutId: string
  onReleasePayout: (bookingId: string) => void
}) {
  const [activeCommandView, setActiveCommandView] = useState<AdminCommandView>('general')
  const [expandedCommandCategory, setExpandedCommandCategory] = useState('monitoring')
  const [commandNotice, setCommandNotice] = useState('')
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [payoutDecisions, setPayoutDecisions] = useState<Record<string, 'RELEASE_STAGED' | 'HELD'>>({})
  const [heldPaymentIds, setHeldPaymentIds] = useState<Record<string, boolean>>({})
  const [adminOutbox, setAdminOutbox] = useState<Array<{ id: string; target: 'guest' | 'host'; bookingRef: string; message: string }>>([])
  const [manualShamCashByPayment, setManualShamCashByPayment] = useState<Record<string, number>>(() => readStoredShamCashMap(SHAM_CASH_ACCOUNT_BALANCE_KEY))
  const [reconcileDraft, setReconcileDraft] = useState('')
  // No synthetic fallback payments: when the real queue is empty, every stat below should honestly
  // read 0/empty rather than silently substituting fabricated placeholder payments -- an admin
  // reviewing an empty queue (e.g. right after launch, before any real bookings exist) must see
  // "no pending payments," not fake money and a fake payment to approve/reject.
  const displayPayments = payments
  const primaryPayment = payments.find((payment) => payment.id === selectedPaymentId) || payments[0]
  const previewPayment = primaryPayment || displayPayments.find((payment) => payment.id === selectedPaymentId) || displayPayments[0]
  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId) || bookings.find((booking) => booking.id === previewPayment?.bookingId)
  const activeListings = queue ? queue.listings.length : listings.length
  const todayBookings = bookings
  const bookingNeedsApproval = bookings.filter(isBookingAwaitingApproval)
  const confirmedBookingRows = bookings.filter(isBookingConfirmed)
  const disputeBookingRows = bookings.filter(isBookingDisputed)
  const confirmedBookings = confirmedBookingRows.length
  const pendingPayments = payments.filter((payment) => payment.status !== 'APPROVED' && payment.status !== 'REJECTED').length
  const heldTotal = displayPayments.reduce((sum, payment) => sum + payment.amountMinor, 0)
  const activeLedger = createShortRentLedger(previewPayment?.amountMinor || 0)
  const readyPayout = Math.round(displayPayments.reduce((sum, payment) => sum + createShortRentLedger(payment.amountMinor).hostPayoutMinor, 0))
  const adminCommission = activeLedger.adminCommissionMinor
  const totalAdminCommission = displayPayments.reduce((sum, payment) => sum + createShortRentLedger(payment.amountMinor).adminCommissionMinor, 0)
  const shamCashReconciliation = createShamCashReconciliation(payments, displayPayments, lang, manualShamCashByPayment)
  const bookingRef = bookingReference(previewPayment)
  const listingTitle = paymentListingTitle(previewPayment, lang)
  const hostName = paymentHostName(previewPayment, lang)
  const hostIdVerified = previewPayment?.booking?.listing?.owner?.idDocumentStatus === 'APPROVED'
  const amountMinor = previewPayment?.amountMinor || 0
  const currency = previewPayment?.currency || 'SYP'
  const selectedPaymentNeedsCashMatch = primaryPayment ? isShamCashProvider(primaryPayment.provider) : false
  const selectedPaymentHeld = primaryPayment ? Boolean(heldPaymentIds[primaryPayment.id]) : false
  const staffSession = getStoredStaffSession('ADMIN')
  const adminName = staffSession?.user.displayName || (isAr ? 'مدير الإدارة' : 'Platform Admin')
  const adminRole = isAr ? 'مدير العمليات' : 'Operations manager'
  const adminInitial = (adminName.trim()[0] || 'A').toUpperCase()
  const selectPayment = (payment: PlatformPaymentProof) => {
    setSelectedPaymentId(payment.id)
    if (payment.bookingId) setSelectedBookingId(payment.bookingId)
  }
  const selectBooking = (booking: PlatformReviewBooking) => {
    setSelectedBookingId(booking.id)
    const linkedPayment = payments.find((payment) => payment.bookingId === booking.id)
    if (linkedPayment) setSelectedPaymentId(linkedPayment.id)
  }
  const isPaymentReconciled = (payment?: PlatformPaymentProof) => {
    if (!payment || !isShamCashProvider(payment.provider)) return true
    return manualShamCashByPayment[payment.id] === payment.amountMinor
  }
  const reconciliationForPayment = (payment?: PlatformPaymentProof): ShamCashApprovalPayload | undefined => {
    if (!payment || !isShamCashProvider(payment.provider)) return undefined
    const accountMinor = manualShamCashByPayment[payment.id] ?? null
    return {
      accountMinor,
      expectedMinor: payment.amountMinor,
      differenceMinor: (accountMinor ?? 0) - payment.amountMinor,
      source: 'admin-ui-manual-sham-cash-match',
    }
  }
  // Reconciles the currently previewed payment only (its own amount, not the aggregate across all
  // pending Sham Cash payments) via a controlled input instead of window.prompt, which can't be
  // driven by automated tests/tools and blocks the render thread with a native dialog.
  const saveReconciliationForPayment = (paymentId: string, valueText: string) => {
    const normalized = Number(valueText.replace(/[^\d.]/g, ''))
    if (!Number.isFinite(normalized) || !valueText.trim()) {
      setCommandNotice(isAr ? 'لم يتم قبول الرصيد. أدخل رقما صحيحا.' : 'Balance was not accepted. Enter a valid number.')
      return
    }
    const nextMinor = Math.round(normalized)
    const nextMap = { ...manualShamCashByPayment, [paymentId]: nextMinor }
    window.localStorage.setItem(SHAM_CASH_ACCOUNT_BALANCE_KEY, JSON.stringify(nextMap))
    setManualShamCashByPayment(nextMap)
    setCommandNotice(isAr ? 'تم تحديث رصيد شام كاش للمطابقة اليدوية.' : 'Sham Cash balance updated for manual reconciliation.')
  }
  const selectedBookingRef = selectedBooking ? shortBookingReference(selectedBooking) : bookingRef
  const selectedPayoutState = payoutDecisions[selectedBooking?.id || previewPayment?.bookingId || '']
  // Previously this only wrote to local React state and showed a success toast — it never called
  // the release API, so an admin could believe a payout was released (and tell the host so) when
  // no money moved. Now it calls the same real release path as the payouts table, gated by the
  // same eligibility the payouts table enforces (14-day hold, real payout row).
  const stagePayoutDecision = (decision: 'RELEASE_STAGED' | 'HELD') => {
    const bookingId = selectedBooking?.id || previewPayment?.bookingId
    if (!bookingId) {
      setCommandNotice(isAr ? 'اختر حجزا محددا قبل قرار الصرف.' : 'Select a specific booking before payout decision.')
      return
    }

    if (decision === 'HELD') {
      setPayoutDecisions((current) => ({ ...current, [bookingId]: decision }))
      setActiveCommandView('finance')
      setCommandNotice(
        isAr
          ? `تمت إضافة ملاحظة تعليق شخصية للحجز ${selectedBookingRef}. هذا تذكير للفريق فقط ولا يوقف الصرف تلقائياً في النظام.`
          : `A personal hold note was added for booking ${selectedBookingRef}. This is a team reminder only and does not stop automatic release in the system.`,
      )
      return
    }

    const matchingPayout = payouts.find((payout) => payout.bookingId === bookingId)
    if (!matchingPayout) {
      setCommandNotice(
        isAr
          ? `لا يوجد صرف مستحق لهذا الحجز بعد. تحقق من قائمة الصرف الحقيقية أدناه.`
          : `No payout is due for this booking yet. Check the real payout list below.`,
      )
      return
    }
    if (!matchingPayout.eligibleNow) {
      setCommandNotice(
        isAr
          ? `الصرف غير متاح بعد للحجز ${selectedBookingRef} (فترة الاحتجاز ${payoutHoldDays} يوماً لم تنته).`
          : `Payout is not eligible yet for booking ${selectedBookingRef} (the ${payoutHoldDays}-day hold hasn't passed).`,
      )
      return
    }

    setActiveCommandView('finance')
    onReleasePayout(bookingId)
  }
  const holdPaymentForReview = (payment: PlatformPaymentProof) => {
    selectPayment(payment)
    setHeldPaymentIds((current) => ({ ...current, [payment.id]: true }))
    setActiveCommandView('finance')
    setCommandNotice(
      isAr
        ? `تم تعليق إثبات الدفع ${bookingReference(payment)} للمراجعة قبل قرار الإدارة.`
        : `Payment proof ${bookingReference(payment)} was held for admin review before a final decision.`,
    )
  }
  const reopenPaymentForReview = (payment: PlatformPaymentProof) => {
    selectPayment(payment)
    setHeldPaymentIds((current) => {
      const next = { ...current }
      delete next[payment.id]
      return next
    })
    setActiveCommandView('finance')
    setCommandNotice(
      isAr
        ? `تمت إعادة فتح إثبات الدفع ${bookingReference(payment)} ويمكن للإدارة اتخاذ القرار.`
        : `Payment proof ${bookingReference(payment)} was reopened for an admin decision.`,
    )
  }
  const queueAdminMessage = (target: 'guest' | 'host') => {
    const message =
      target === 'guest'
        ? isAr
          ? `رسالة للعميل: تم تحديث حالة الحجز ${selectedBookingRef}. تابع من حسابك داخل SYBNB.`
          : `Guest message: booking ${selectedBookingRef} status was updated. Continue from your SYBNB account.`
        : isAr
          ? `رسالة للمضيف: تم تحديث حالة الحجز ${selectedBookingRef}. راجع لوحة المضيف قبل الصرف.`
          : `Host message: booking ${selectedBookingRef} status was updated. Review host dashboard before payout.`
    setAdminOutbox((current) => [
      {
        id: `${target}-${Date.now()}`,
        target,
        bookingRef: selectedBookingRef,
        message,
      },
      ...current,
    ])
    setCommandNotice(
      target === 'guest'
        ? isAr
          ? 'تمت إضافة رسالة العميل إلى صندوق إرسال الإدارة.'
          : 'Guest message added to admin outbox.'
        : isAr
          ? 'تمت إضافة رسالة المضيف إلى صندوق إرسال الإدارة.'
          : 'Host message added to admin outbox.',
    )
  }

  const stats = [
    { label: isAr ? 'حجوزات اليوم' : 'Today bookings', value: String(todayBookings.length), tone: 'blue' },
    { label: isAr ? 'بانتظار مراجعة الدفع' : 'Payment review', value: String(pendingPayments), tone: 'gold' },
    { label: isAr ? 'حجوزات مؤكدة' : 'Confirmed bookings', value: String(confirmedBookings), tone: 'green' },
    { label: isAr ? 'حالات نزاع' : 'Disputes', value: String(disputeBookingRows.length), tone: 'red' },
    { label: isAr ? 'مبالغ محجوزة' : 'Held funds', value: moneyText(heldTotal, 'SYP', lang), tone: 'gold' },
    { label: isAr ? 'مبالغ جاهزة للصرف' : 'Ready payout', value: moneyText(readyPayout, 'SYP', lang), tone: 'green' },
    { label: isAr ? 'عمولة المنصة' : 'Platform commission', value: moneyText(totalAdminCommission, 'SYP', lang), tone: 'blue' },
    { label: isAr ? 'عقارات نشطة' : 'Active stays', value: String(activeListings), tone: 'white' },
  ]
  const adminGroups = [
    {
      title: isAr ? 'تشغيل الحجوزات' : 'Booking operations',
      subtitle: isAr ? 'إدارة حالة الحجز والطلبات اليومية' : 'Manage daily booking status and requests',
      items: stats.slice(0, 4),
    },
    {
      title: isAr ? 'المال والعمولة' : 'Money and commission',
      subtitle: isAr ? 'محجوزات الضيوف، صرف المضيف، وعمولة المنصة' : 'Guest holds, host payout, and platform commission',
      items: stats.slice(4, 7),
    },
    {
      title: isAr ? 'المخزون والجاهزية' : 'Inventory and readiness',
      subtitle: isAr ? 'العقارات النشطة وربطها بمراقبة AI' : 'Active stays linked to AI monitoring',
      items: [stats[7]],
    },
  ]
  const proofCards = payments.slice(0, 3)
  const baseReviewChecklist = createPaymentReviewChecklist(previewPayment, isAr)
  const aiReview = selectedPaymentNeedsCashMatch && !isPaymentReconciled(primaryPayment)
    ? createCashMatchChecklist(isAr, manualShamCashByPayment[primaryPayment?.id || ''] == null)
    : baseReviewChecklist
  const commandViews: Array<{ id: AdminCommandView; label: string; count: number; tone: string }> = [
    { id: 'general', label: isAr ? 'الرصد العام' : 'General watch', count: todayBookings.length, tone: 'blue' },
    { id: 'audit', label: isAr ? 'التدقيق' : 'Audit', count: auditLog.length, tone: 'white' },
    { id: 'aiBrain', label: isAr ? 'قائمة المراجعة' : 'Review checklist', count: aiReview.reasons.length, tone: 'gold' },
    { id: 'disputes', label: isAr ? 'النزاعات' : 'Disputes', count: disputeBookingRows.length, tone: 'red' },
    { id: 'hosts', label: isAr ? 'المضيفين' : 'Hosts', count: listings.length || activeListings, tone: 'green' },
    { id: 'customers', label: isAr ? 'العملاء' : 'Customers', count: bookings.length, tone: 'blue' },
    { id: 'bookings', label: isAr ? 'الحجوزات' : 'Bookings', count: bookings.length, tone: 'blue' },
    { id: 'finance', label: isAr ? 'المالية' : 'Finance', count: pendingPayments, tone: shamCashReconciliation.isMatched ? 'green' : 'red' },
  ]
  const commandCategories: Array<{ id: string; label: string; subtitle: string; viewIds: AdminCommandView[] }> = [
    {
      id: 'operations',
      label: isAr ? 'تشغيل الحجوزات' : 'Booking operations',
      subtitle: isAr ? 'الحجوزات، العملاء، المضيفين، والنزاعات' : 'Bookings, customers, hosts, and disputes',
      viewIds: ['bookings', 'customers', 'hosts', 'disputes'],
    },
    {
      id: 'finance',
      label: isAr ? 'المالية والصرف' : 'Finance & payouts',
      subtitle: isAr ? 'مراجعة الدفعات ومطابقة شام كاش' : 'Payment review and Sham Cash reconciliation',
      viewIds: ['finance'],
    },
    {
      id: 'monitoring',
      label: isAr ? 'المراقبة والمراجعة' : 'Monitoring & review',
      subtitle: isAr ? 'الرصد العام، التدقيق، وقائمة المراجعة' : 'General watch, audit log, and review checklist',
      viewIds: ['general', 'audit', 'aiBrain'],
    },
  ]
  const activeCommand = commandViews.find((view) => view.id === activeCommandView) || commandViews[0]
  const selectCommandView = (viewId: AdminCommandView, categoryId: string) => {
    setActiveCommandView(viewId)
    setExpandedCommandCategory(categoryId)
    setCommandNotice('')
  }

  const flowSteps = [
    isAr ? 'بحث العميل' : 'Client search',
    isAr ? 'فتح الحساب' : 'Account opened',
    isAr ? 'قبول شروط الإيجار' : 'Terms accepted',
    isAr ? 'إرسال طلب الحجز' : 'Booking request',
    isAr ? 'دفع العميل' : 'Guest paid',
    isAr ? 'رفع إثبات الدفع' : 'Proof uploaded',
    isAr ? 'مراجعة الإدارة' : 'Admin review',
    isAr ? 'تأكيد المضيف' : 'Host confirmation',
    isAr ? 'الرحلة قيد التنفيذ' : 'Stay in progress',
    isAr ? 'المغادرة' : 'Checkout',
    isAr ? 'تقييم العميل' : 'Guest review',
    isAr ? 'صرف مستحقات المضيف' : 'Host payout',
    isAr ? 'إغلاق المعاملة' : 'Transaction closed',
  ]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={commandStyles.page}>
      <header className="admin-command-header" style={commandStyles.header}>
        <div className="admin-brand-lockup" style={commandStyles.strBrandLockup}>
          <BrandLogo logo="stays" size="nav" />
          <div className="admin-header-watermark" style={commandStyles.watermark}>STR · STAY TRUST RELAX · FINAL REVIEW · 3055</div>
        </div>
        <div className="admin-breadcrumb" style={commandStyles.breadcrumb}>
          <strong>{isAr ? 'لوحة الإدارة' : 'Admin dashboard'}</strong>
          <b>/</b>
          <span>{isAr ? 'الإيجار اليومي' : 'Daily rent'}</span>
        </div>
        <div className="admin-identity" style={commandStyles.adminIdentity}>
          <strong>{adminName}</strong>
          <small className="admin-identity-role">{adminRole}</small>
          <span style={commandStyles.avatar}>{adminInitial}</span>
          <span className="admin-identity-notify" style={commandStyles.notify}>●</span>
          <b className="admin-identity-lang">EN / AR</b>
          <button style={commandStyles.circleButton} onClick={() => window.history.back()} aria-label={isAr ? 'السابق' : 'Back'}>←</button>
          <button style={commandStyles.circleButton} onClick={() => window.history.forward()} aria-label={isAr ? 'التالي' : 'Next'}>→</button>
        </div>
      </header>

      <section style={commandStyles.departmentGroups} aria-label={isAr ? 'أقسام الإدارة' : 'Admin departments'}>
        {commandCategories.map((category) => {
          const items = commandViews.filter((view) => category.viewIds.includes(view.id))
          const totalCount = items.reduce((sum, view) => sum + view.count, 0)
          const isExpanded = expandedCommandCategory === category.id
          const containsActive = items.some((view) => view.id === activeCommandView)
          return (
            <div key={category.id} style={commandStyles.departmentGroup}>
              <button
                style={{
                  ...commandStyles.departmentGroupHeader,
                  ...(isExpanded || containsActive ? commandStyles.departmentGroupHeaderActive : {}),
                }}
                onClick={() => setExpandedCommandCategory(isExpanded ? '' : category.id)}
                aria-expanded={isExpanded}
              >
                <span style={commandStyles.departmentGroupChevron}>{isExpanded ? '▾' : '▸'}</span>
                <span style={commandStyles.departmentGroupLabel}>
                  <strong>{category.label}</strong>
                  <small>{category.subtitle}</small>
                </span>
                <b style={commandTone('white')}>{totalCount}</b>
              </button>
              {isExpanded && (
                <div style={commandStyles.departmentTabs}>
                  {items.map((view) => (
                    <button
                      key={view.id}
                      style={{
                        ...commandStyles.departmentTab,
                        ...(activeCommandView === view.id ? commandStyles.departmentTabActive : {}),
                      }}
                      onClick={() => selectCommandView(view.id, category.id)}
                    >
                      <span>{view.label}</span>
                      <b style={commandTone(view.tone)}>{view.count}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <section style={commandStyles.statsGrid} aria-label={isAr ? 'أرقام الإدارة' : 'Admin numbers'}>
        {stats.map((stat) => (
          <article key={stat.label} style={commandStyles.statCard}>
            <small>{stat.label}</small>
            <strong style={commandTone(stat.tone)}>{stat.value}</strong>
          </article>
        ))}
        <article style={{ ...commandStyles.statCard, borderColor: shamCashReconciliation.isMatched ? 'rgba(32,210,155,.3)' : 'rgba(255,77,115,.5)' }}>
          <small>{isAr ? 'مطابقة شام كاش' : 'Sham Cash match'}</small>
          <strong style={commandTone(shamCashReconciliation.isMatched ? 'green' : 'red')}>
            {shamCashReconciliation.isMatched ? (isAr ? 'مطابق' : 'MATCHED') : (isAr ? 'غير مطابق' : 'MISMATCH')}
          </strong>
        </article>
      </section>

      {!shamCashReconciliation.isMatched && (
        <section style={commandStyles.warningBanner}>
          <strong>⚠</strong>
          <span>
            {isAr
              ? `تنبيه: يوجد عدم مطابقة في Sham Cash بقيمة ${moneyText(Math.abs(shamCashReconciliation.differenceMinor), 'SYP', lang)} للحجز ${bookingRef}.`
              : `Warning: Sham Cash mismatch of ${moneyText(Math.abs(shamCashReconciliation.differenceMinor), 'SYP', lang)} for booking ${bookingRef}.`}
          </span>
          <button style={commandStyles.outlineGold} onClick={() => setActiveCommandView('finance')}>{isAr ? 'مراجعة الفروقات' : 'Review mismatch'}</button>
        </section>
      )}

      {status === 'error' && (
        <section style={styles.alert}>
          <strong>{isAr ? 'تعذر تحميل لوحة الإدارة' : 'Could not load admin dashboard'}</strong>
          <span>{message}</span>
        </section>
      )}

      <section className="admin-v2-grid" style={commandStyles.adminV2Grid}>
        <aside style={commandStyles.leftRail}>
          <article style={commandStyles.sideCard}>
            <div style={commandStyles.hostRow}>
              <span style={commandStyles.hostAvatar}>{(hostName.trim()[0] || (isAr ? 'م' : 'H')).toUpperCase()}</span>
              <div>
                <h2>{hostName}</h2>
                <small>
                  {hostIdVerified
                    ? (isAr ? 'الهوية موثّقة' : 'ID verified')
                    : (isAr ? 'لم تُوثَّق الهوية بعد' : 'ID not yet verified')}
                </small>
              </div>
            </div>
            <span style={commandStyles.payoutState}>{isAr ? 'بانتظار إطلاق الدفعة' : 'Waiting payout release'}</span>
            <button style={{ ...commandStyles.acceptButton, opacity: selectedPayoutState === 'RELEASE_STAGED' ? 1 : 0.38 }} onClick={() => stagePayoutDecision('RELEASE_STAGED')}>
              {isAr ? 'إطلاق المستحقات' : 'Release earnings'}
            </button>
          </article>

          <article style={commandStyles.sideCard}>
            <h2>{isAr ? 'حماية العميل' : 'Guest protection'}</h2>
            <FeeLine label={isAr ? 'إجمالي المبلغ المدفوع' : 'Guest total paid'} value={moneyText(activeLedger.totalMinor, currency, lang)} strong />
            <FeeLine label={isAr ? 'الضرائب والرسوم' : 'Taxes and fees'} value={moneyText(activeLedger.taxesMinor + activeLedger.cleaningFeeMinor, currency, lang)} />
            <FeeLine label={isAr ? 'عمولة المنصة - مخفي عن العميل' : 'Platform commission - hidden from guest'} value={moneyText(adminCommission, currency, lang)} danger />
            <div style={commandStyles.protectionFlags}>
              <span>✓ {isAr ? 'الحماية مفعلة' : 'Protection active'}</span>
              <span>✓ {isAr ? 'العقد مقبول' : 'Agreement accepted'}</span>
            </div>
          </article>

          <section style={{ ...commandStyles.aiDecisionCard, borderColor: aiReview.borderColor }}>
            <div style={commandStyles.aiDecisionHeader}>
              <span style={{ ...commandStyles.aiDecisionBadge, background: aiReview.borderColor }}>{aiReview.label}</span>
              <div>
                <small>{isAr ? 'قائمة مراجعة آلية — ليست ذكاءً اصطناعياً' : 'Automated checklist — not AI-generated'}</small>
                <h2>{aiReview.title}</h2>
              </div>
            </div>
            <div style={commandStyles.aiPills}>
              {aiReview.reasons.slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}
            </div>
          </section>
        </aside>

        <section style={commandStyles.centerPanel}>
          <div style={commandStyles.commandViewHeader}>
            <div>
              <h1>{bookingRef}</h1>
              <small>{listingTitle} · {isAr ? 'دمشق' : 'Damascus'}</small>
            </div>
            <button style={commandStyles.blueButton} onClick={() => previewPayment?.bookingId ? (window.location.hash = `/booking/${previewPayment.bookingId}`) : undefined}>
              {isAr ? 'تفاصيل الحجز' : 'Booking details'}
            </button>
          </div>
          <div style={commandStyles.pipelineList}>
            {flowSteps.map((step, index) => (
              <div key={step} style={{ ...commandStyles.pipelineStep, ...(index === 6 ? commandStyles.pipelineActive : {}) }}>
                <small>{flowStepTime(index, isAr, previewPayment, selectedBooking)}</small>
                <span>{step}</span>
                <strong>{index + 1}</strong>
              </div>
            ))}
          </div>
          {!shamCashReconciliation.isMatched && (
            <ShamCashReconciliationPanel data={shamCashReconciliation} isAr={isAr} lang={lang} targetPayment={previewPayment} inputValue={reconcileDraft} onChangeInputValue={setReconcileDraft} onSave={saveReconciliationForPayment} />
          )}
          {commandNotice && <span style={commandStyles.commandNotice}>{commandNotice}</span>}
          {adminOutbox.length > 0 && (
            <div style={commandStyles.outboxPanel}>
              <strong>{isAr ? 'صندوق رسائل الإدارة' : 'Admin message outbox'}</strong>
              {adminOutbox.slice(0, 3).map((item) => (
                <p key={item.id}>
                  <b>{item.target === 'guest' ? (isAr ? 'العميل' : 'Guest') : (isAr ? 'المضيف' : 'Host')}</b>
                  <span>{item.message}</span>
                </p>
              ))}
            </div>
          )}
        </section>

        <aside style={commandStyles.rightQueue}>
          <div style={commandStyles.sectionHeading}>
            <button style={commandStyles.linkButton} onClick={() => setActiveCommandView('finance')}>{isAr ? 'مشاهدة الكل' : 'View all'}</button>
            <h2><span style={commandStyles.countBadge}>{pendingPayments}</span>{isAr ? 'مراجعة إثبات الدفع' : 'Payment proof review'}</h2>
          </div>
          <div style={commandStyles.proofList}>
            {proofCards.length === 0 && (
              <article style={commandStyles.emptyProofCard}>
                <strong>{isAr ? 'لا توجد إثباتات دفع بانتظار القرار' : 'No payment proofs waiting for decision'}</strong>
                <span>{isAr ? 'عند وصول إثبات دفع حقيقي سيظهر هنا.' : 'Real submitted payment proofs will appear here.'}</span>
              </article>
            )}
            {proofCards.map((payment) => (
              <article key={payment.id} style={{ ...commandStyles.proofCard, ...(payment.id === previewPayment?.id ? commandStyles.selectedCard : {}) }} onClick={() => selectPayment(payment)}>
                <div style={commandStyles.proofTop}>
                  <strong>{bookingReference(payment)}</strong>
                  <span>{heldPaymentIds[payment.id] ? (isAr ? 'معلق' : 'Held') : providerText(payment.provider, lang)}</span>
                </div>
                <b>{paymentListingTitle(payment, lang)}</b>
                <strong>{moneyText(payment.amountMinor, payment.currency, lang)}</strong>
                <small>{createPaymentReviewChecklist(payment, isAr).label}</small>
                <div style={commandStyles.proofActions}>
                  <button disabled={disabled || heldPaymentIds[payment.id] || !isPaymentReconciled(payment)} style={commandStyles.acceptButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'APPROVE', reconciliationForPayment(payment)) }}>{isAr ? 'قبول' : 'Approve'}</button>
                  <button disabled={disabled || heldPaymentIds[payment.id]} style={commandStyles.rejectButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'REJECT') }}>{isAr ? 'رفض' : 'Reject'}</button>
                  <button style={heldPaymentIds[payment.id] ? commandStyles.secondaryCommand : commandStyles.goldButton} onClick={(event) => { event.stopPropagation(); heldPaymentIds[payment.id] ? reopenPaymentForReview(payment) : holdPaymentForReview(payment) }}>{heldPaymentIds[payment.id] ? (isAr ? 'إعادة فتح' : 'Reopen') : (isAr ? 'تعليق' : 'Hold')}</button>
                  <button style={commandStyles.blueButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); window.location.hash = `/payment/receipt/${payment.id}` }}>{isAr ? 'تفاصيل' : 'Details'}</button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section style={commandStyles.commandViewPanel}>
        <div style={commandStyles.commandViewHeader}>
          <small>{isAr ? 'لوحة تشغيل مباشرة' : 'Live operations panel'}</small>
          <h2>{activeCommand.label}</h2>
        </div>
        {activeCommandView === 'general' && (
          <div style={commandStyles.managementList}>
            {todayBookings.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد حجوزات اليوم في قائمة الإدارة.' : 'No bookings are in today’s admin queue.'} />
            ) : todayBookings.map((booking) => (
              <AdminBookingLine key={booking.id} booking={booking} disabled={disabled} isAr={isAr} lang={lang} selected={booking.id === selectedBooking?.id} onApprove={() => onBookingDecision(booking.id, 'APPROVE')} onReject={() => onBookingDecision(booking.id, 'REJECT')} onSelect={() => selectBooking(booking)} />
            ))}
          </div>
        )}
        {activeCommandView === 'finance' && (
          <div style={commandStyles.managementList}>
            {payments.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد دفعات حقيقية بانتظار موافقة الإدارة.' : 'No real payment proofs are waiting for admin approval.'} />
            ) : payments.map((payment) => (
              <AdminPaymentLine key={payment.id} disabled={disabled || heldPaymentIds[payment.id] || !isPaymentReconciled(payment)} isAr={isAr} lang={lang} payment={payment} selected={payment.id === previewPayment?.id} onApprove={() => onPaymentDecision(payment.id, 'APPROVE', reconciliationForPayment(payment))} onReject={() => onPaymentDecision(payment.id, 'REJECT')} onSelect={() => selectPayment(payment)} />
            ))}
          </div>
        )}
        {activeCommandView === 'bookings' && (
          <div style={commandStyles.managementList}>
            {bookingNeedsApproval.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد حجوزات بانتظار موافقة الإدارة الآن.' : 'No bookings currently need admin approval.'} />
            ) : bookingNeedsApproval.map((booking) => (
              <AdminBookingLine key={booking.id} booking={booking} disabled={disabled} isAr={isAr} lang={lang} selected={booking.id === selectedBooking?.id} onApprove={() => onBookingDecision(booking.id, 'APPROVE')} onReject={() => onBookingDecision(booking.id, 'REJECT')} onSelect={() => selectBooking(booking)} />
            ))}
          </div>
        )}
        {activeCommandView === 'bookings' && (
          <div style={commandStyles.managementList}>
            {confirmedBookingRows.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد حجوزات مؤكدة في هذه القائمة.' : 'No confirmed bookings are in this queue.'} />
            ) : confirmedBookingRows.map((booking) => (
              <AdminBookingLine key={booking.id} booking={booking} disabled={true} isAr={isAr} lang={lang} selected={booking.id === selectedBooking?.id} onApprove={() => undefined} onReject={() => undefined} onSelect={() => selectBooking(booking)} />
            ))}
          </div>
        )}
        {activeCommandView === 'disputes' && (
          <div style={commandStyles.managementList}>
            {disputeBookingRows.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد نزاعات مفتوحة للإيجار اليومي.' : 'No open short-term-rent disputes.'} />
            ) : disputeBookingRows.map((booking) => (
              <AdminBookingLine key={booking.id} booking={booking} disabled={disabled} isAr={isAr} lang={lang} selected={booking.id === selectedBooking?.id} onApprove={() => onBookingDecision(booking.id, 'APPROVE')} onReject={() => onBookingDecision(booking.id, 'REJECT')} onSelect={() => selectBooking(booking)} />
            ))}
          </div>
        )}
        {activeCommandView === 'finance' && (
          <div style={commandStyles.moneyCommandGrid}>
            <div style={commandStyles.moneyCommandCard}>
              <small>{isAr ? 'مبالغ جاهزة للصرف' : 'Ready payout'}</small>
              <strong style={commandTone('green')}>{moneyText(readyPayout, 'SYP', lang)}</strong>
              <span style={commandStyles.payoutState}>{selectedPayoutState === 'RELEASE_STAGED' ? (isAr ? 'جاهز للصرف' : 'Release staged') : selectedPayoutState === 'HELD' ? (isAr ? 'معلق' : 'Held') : (isAr ? 'اختر حجزا' : 'Select booking')}</span>
              <button style={commandStyles.acceptButton} onClick={() => stagePayoutDecision('RELEASE_STAGED')}>{isAr ? 'إطلاق الدفعة للمضيف' : 'Release payout'}</button>
            </div>
            <div style={commandStyles.moneyCommandCard}>
              <small>{isAr ? 'عمولة المنصة' : 'Platform commission'}</small>
              <strong style={commandTone('blue')}>{moneyText(totalAdminCommission, 'SYP', lang)}</strong>
              <button style={commandStyles.secondaryCommand} onClick={() => {
                setActiveCommandView('finance')
                setCommandNotice(isAr ? `سجل عمولة المنصة للحجز ${selectedBookingRef}: ${moneyText(adminCommission, 'SYP', lang)}.` : `Platform commission ledger for ${selectedBookingRef}: ${moneyText(adminCommission, 'SYP', lang)}.`)
              }}>{isAr ? 'عرض السجل المالي' : 'View ledger'}</button>
            </div>
            <div style={commandStyles.moneyCommandCard}>
              <small>{isAr ? 'مبالغ محجوزة' : 'Held funds'}</small>
              <strong style={commandTone('gold')}>{moneyText(heldTotal, 'SYP', lang)}</strong>
              <button style={commandStyles.outlineGold} onClick={() => stagePayoutDecision('HELD')}>{isAr ? 'تعليق الدفعة' : 'Hold payout'}</button>
            </div>
          </div>
        )}
        {activeCommandView === 'finance' && (
          <ShamCashReconciliationPanel data={shamCashReconciliation} isAr={isAr} lang={lang} expanded targetPayment={previewPayment} inputValue={reconcileDraft} onChangeInputValue={setReconcileDraft} onSave={saveReconciliationForPayment} />
        )}
        {activeCommandView === 'finance' && (
          <div style={commandStyles.managementList}>
            <div style={commandStyles.sectionHeadRow}>
              <strong>{isAr ? 'صرف المضيفين (حقيقي)' : 'Host payouts (real)'}</strong>
              <small>
                {isAr
                  ? `يبقى الصرف معلقا حتى ${payoutHoldDays} يوما بعد انتهاء الإقامة، ولا يظهر هنا إلا بعد اكتمال الحجز وعدم وجود نزاع مفتوح.`
                  : `Payout stays held for ${payoutHoldDays} days after the stay ends, and only appears here once the booking is completed with no open dispute.`}
              </small>
            </div>
            {payouts.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد مبالغ صرف بانتظار الإدارة الآن.' : 'No host payouts are waiting on admin right now.'} />
            ) : payouts.map((payout) => (
              <div key={payout.bookingId} style={commandStyles.managementRow}>
                <span>{payout.listingTitle || payout.bookingId.slice(0, 8).toUpperCase()}</span>
                <small>{payout.hostName || payout.hostId?.slice(0, 8).toUpperCase()}</small>
                <strong>{moneyText(payout.hostPayoutMinor, payout.currency, lang)}</strong>
                <small>
                  {payout.eligibleNow
                    ? (isAr ? 'جاهز للصرف الآن' : 'Eligible now')
                    : (isAr ? `يفتح في ${payout.eligibleAt ? new Date(payout.eligibleAt).toLocaleDateString(isAr ? 'ar-SY' : 'en-US') : ''}` : `Opens ${payout.eligibleAt ? new Date(payout.eligibleAt).toLocaleDateString('en-US') : ''}`)}
                </small>
                <button
                  disabled={!payout.eligibleNow || releasingPayoutId === payout.bookingId}
                  style={payout.eligibleNow ? commandStyles.acceptButton : commandStyles.secondaryCommand}
                  onClick={() => onReleasePayout(payout.bookingId)}
                >
                  {releasingPayoutId === payout.bookingId
                    ? (isAr ? 'جار الصرف...' : 'Releasing...')
                    : (isAr ? 'صرف الآن' : 'Release now')}
                </button>
              </div>
            ))}
          </div>
        )}
        {activeCommandView === 'hosts' && (
          <div style={commandStyles.managementList}>
            {(listings.length ? listings : []).length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد عقارات في قائمة الإدارة الحالية.' : 'No stays are in the current admin inventory.'} />
            ) : listings.map((listing) => (
              <button key={listing.id} style={commandStyles.managementRow} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>
                <span>{listingTitleText(listing, lang)}</span>
                <small>{divisionText(listing.division, lang)}</small>
                <strong>{statusText(listing.status, lang)}</strong>
              </button>
            ))}
          </div>
        )}
        {activeCommandView === 'customers' && (
          <div style={commandStyles.managementList}>
            {bookings.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد ملفات عملاء مرتبطة بحجوزات الإيجار اليومي.' : 'No customer records are linked to short-term-rent bookings.'} />
            ) : bookings.map((booking) => (
              <button key={booking.id} style={{ ...commandStyles.managementRow, ...(booking.id === selectedBooking?.id ? commandStyles.selectedCard : {}) }} onClick={() => selectBooking(booking)}>
                <span>{shortBookingReference(booking)}</span>
                <small>{booking.guest?.displayName || (isAr ? 'عميل STR' : 'STR guest')}</small>
                <strong>{statusText(booking.status, lang)}</strong>
              </button>
            ))}
          </div>
        )}
        {activeCommandView === 'customers' && (
          <div style={commandStyles.managementList}>
            <strong style={{ display: 'block', margin: '18px 0 8px' }}>
              {isAr ? 'مراجعة إثبات الهوية' : 'ID document review'}
            </strong>
            {!queue?.idDocuments?.length ? (
              <AdminEmptyLine text={isAr ? 'لا توجد مستندات هوية بانتظار المراجعة.' : 'No ID documents are waiting for review.'} />
            ) : queue.idDocuments.map((doc) => (
              <AdminIdDocumentLine
                key={doc.id}
                doc={doc}
                disabled={disabled}
                isAr={isAr}
                onApprove={() => onIdDocumentDecision(doc.id, 'APPROVE')}
                onReject={() => onIdDocumentDecision(doc.id, 'REJECT')}
              />
            ))}
            <AdminManualIdUploadPanel isAr={isAr} />
          </div>
        )}
        {activeCommandView === 'audit' && (
          <div style={commandStyles.managementList}>
            {auditLog.length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد قرارات إدارية مسجلة بعد.' : 'No admin audit decisions recorded yet.'} />
            ) : auditLog.slice(0, 12).map((entry) => (
              <button key={entry.id} style={commandStyles.managementRow} onClick={() => setCommandNotice(`${entry.action} · ${entry.entityType} · ${entry.entityId}`)}>
                <span>{entry.actor?.displayName || entry.actor?.email || (isAr ? 'النظام' : 'System')}</span>
                <small>{entry.entityType}</small>
                <strong>{entry.action}</strong>
              </button>
            ))}
          </div>
        )}
        {activeCommandView === 'aiBrain' && (
          <div style={commandStyles.managementList}>
            <article style={commandStyles.aiDecisionCard}>
              <h3>{aiReview.title}</h3>
              <strong style={{ color: aiReview.borderColor }}>{aiReview.label}</strong>
              {aiReview.reasons.map((reason) => <p key={reason}>{reason}</p>)}
            </article>
          </div>
        )}
      </section>

      {status === 'error' && (
        <section style={styles.alert}>
          <strong>{isAr ? 'تعذر تحميل لوحة الإدارة' : 'Could not load admin dashboard'}</strong>
          <span>{message}</span>
        </section>
      )}

      <section style={commandStyles.commandGrid}>
        <section style={commandStyles.proofColumn}>
          <div style={commandStyles.sectionHeading}>
            <small>{isAr ? `اكتملت ${auditLog.length || 12} اليوم` : `${auditLog.length || 12} complete today`}</small>
            <h2><span style={commandStyles.countBadge}>{pendingPayments}</span>{isAr ? 'مراجعة إثبات الدفع' : 'Payment proof review'}</h2>
          </div>
          <div style={commandStyles.proofList}>
            {proofCards.length === 0 && (
              <article style={commandStyles.emptyProofCard}>
                <strong>{isAr ? 'لا توجد إثباتات دفع بانتظار القرار' : 'No payment proofs waiting for decision'}</strong>
                <span>{isAr ? 'عند وصول إثبات دفع حقيقي سيظهر هنا مع أزرار القبول والرفض.' : 'Real submitted payment proofs will appear here with approve and reject actions.'}</span>
              </article>
            )}
            {proofCards.map((payment) => (
              <article key={payment.id} style={{ ...commandStyles.proofCard, ...(payment.id === previewPayment?.id ? commandStyles.selectedCard : {}) }} onClick={() => selectPayment(payment)}>
                <div style={commandStyles.proofTop}>
                  <strong>{bookingReference(payment)}</strong>
                  <span>{providerText(payment.provider, lang)}</span>
                </div>
                <div style={commandStyles.proofInfo}>
                  <b>{paymentListingTitle(payment, lang)}</b>
                  <small>{paymentHostName(payment, lang)}</small>
                </div>
                <div style={commandStyles.proofMoney}>
                  <strong>{moneyText(payment.amountMinor, payment.currency, lang)}</strong>
                  <span>{createPaymentReviewChecklist(payment, isAr).label}</span>
                </div>
                <div style={commandStyles.aiMiniDecision}>
                  <b>{createPaymentReviewChecklist(payment, isAr).title}</b>
                  <small>{createPaymentReviewChecklist(payment, isAr).reasons[0]}</small>
                </div>
                <div style={commandStyles.proofActions}>
                  <button disabled={disabled || heldPaymentIds[payment.id] || !isPaymentReconciled(payment)} style={commandStyles.acceptButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'APPROVE', reconciliationForPayment(payment)) }}>{isAr ? 'قبول' : 'Approve'}</button>
                  <button disabled={disabled || heldPaymentIds[payment.id]} style={commandStyles.rejectButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'REJECT') }}>{isAr ? 'رفض' : 'Reject'}</button>
                  <button style={heldPaymentIds[payment.id] ? commandStyles.secondaryCommand : commandStyles.goldButton} onClick={(event) => { event.stopPropagation(); heldPaymentIds[payment.id] ? reopenPaymentForReview(payment) : holdPaymentForReview(payment) }}>{heldPaymentIds[payment.id] ? (isAr ? 'إعادة فتح' : 'Reopen') : (isAr ? 'تعليق' : 'Hold')}</button>
                  <button style={commandStyles.blueButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); window.location.hash = `/payment/receipt/${payment.id}` }}>{isAr ? 'تفاصيل' : 'Details'}</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section style={commandStyles.pipelineCard}>
          <div style={commandStyles.pipelinePulse}>⌁</div>
          <h2>{isAr ? 'مسار الحجز' : 'Booking path'}</h2>
          <div style={commandStyles.pipelineList}>
            {flowSteps.map((step, index) => (
              <div key={step} style={{ ...commandStyles.pipelineStep, ...(index === 6 ? commandStyles.pipelineActive : {}) }}>
                <small>{flowStepTime(index, isAr, previewPayment, selectedBooking)}</small>
                <span>{step}</span>
                <strong>{index + 1}</strong>
              </div>
            ))}
          </div>
        </section>

        <aside style={commandStyles.sidePanels}>
          <article style={commandStyles.sideCard}>
            <div style={commandStyles.cardTitleRow}>
              <span style={hostIdVerified ? commandStyles.confirmedPill : commandStyles.warningPill}>
                {hostIdVerified ? (isAr ? 'موثّق' : 'Verified') : (isAr ? 'غير موثّق' : 'Unverified')}
              </span>
              <h2>{isAr ? 'حالة المضيف' : 'Host status'}</h2>
            </div>
            <div style={commandStyles.hostRow}>
              <div>
                <strong>{hostName}</strong>
                <small>{hostIdVerified ? (isAr ? 'الهوية موثّقة' : 'ID verified') : (isAr ? 'لم تُوثَّق الهوية بعد' : 'ID not yet verified')}</small>
              </div>
              <span style={commandStyles.hostAvatar}>{(hostName.trim()[0] || (isAr ? 'م' : 'H')).toUpperCase()}</span>
            </div>
          </article>

          <article style={commandStyles.sideCard}>
            <div style={commandStyles.cardTitleRow}>
              <span style={commandStyles.confirmedPill}>{isAr ? 'مفعل' : 'Active'}</span>
              <h2>{isAr ? 'حماية العميل' : 'Guest protection'}</h2>
            </div>
            <FeeLine label={isAr ? 'رسوم الإيجار' : 'Rent'} value={moneyText(activeLedger.rentMinor, currency, lang)} />
            <FeeLine label={isAr ? 'ضرائب' : 'Taxes'} value={moneyText(activeLedger.taxesMinor, currency, lang)} />
            <FeeLine label={isAr ? 'رسوم التنظيف' : 'Cleaning fees'} value={moneyText(activeLedger.cleaningFeeMinor, currency, lang)} />
            <FeeLine label={isAr ? 'الإجمالي' : 'Total'} value={moneyText(activeLedger.totalMinor, currency, lang)} strong />
            <FeeLine label={isAr ? 'عمولة المنصة - للإدارة فقط' : 'Platform commission - admin only'} value={moneyText(adminCommission, currency, lang)} danger />
          </article>
          <article style={commandStyles.sideCard}>
            <div style={commandStyles.cardTitleRow}>
              <span style={shamCashReconciliation.isMatched ? commandStyles.confirmedPill : commandStyles.warningPill}>
                {shamCashReconciliation.isMatched ? (isAr ? 'مطابق' : 'Matched') : (isAr ? 'فرق' : 'Mismatch')}
              </span>
              <h2>{isAr ? 'مطابقة شام كاش' : 'Sham Cash match'}</h2>
            </div>
            <FeeLine label={isAr ? 'المتوقع في SYBNB' : 'SYBNB expected'} value={moneyText(shamCashReconciliation.expectedMinor, 'SYP', lang)} />
            <FeeLine label={isAr ? 'حساب شام كاش' : 'Sham Cash account'} value={moneyText(shamCashReconciliation.accountMinor, 'SYP', lang)} />
            <FeeLine label={isAr ? 'الفرق' : 'Difference'} value={moneyText(shamCashReconciliation.differenceMinor, 'SYP', lang)} strong danger={!shamCashReconciliation.isMatched} />
          </article>
        </aside>
      </section>

      <section style={commandStyles.drawerGrid}>
        <article style={commandStyles.drawerCard}>
          <h2>{isAr ? 'محفظة المضيف والصرف' : 'Host wallet and payout'}</h2>
          <div style={commandStyles.walletTimeline}>
            <span>{isAr ? 'مدفوعات الضيف' : 'Guest paid'} <b>{moneyText(amountMinor, currency, lang)}</b></span>
            <span>{isAr ? 'محمي داخل SYBNB' : 'Protected by SYBNB'} <b>{moneyText(amountMinor, currency, lang)}</b></span>
            <span>{isAr ? 'موافقة الإدارة' : 'Admin approved'} <b>{isAr ? 'بانتظار الصرف' : 'Pending release'}</b></span>
            <span>{isAr ? 'أرباح المضيف' : 'Host payout'} <b>{moneyText(activeLedger.hostPayoutMinor, currency, lang)}</b></span>
          </div>
          <button style={commandStyles.acceptButton} onClick={() => stagePayoutDecision('RELEASE_STAGED')}>{isAr ? 'إطلاق الدفعة للمضيف' : 'Release payout'}</button>
          <button style={commandStyles.outlineGold} onClick={() => stagePayoutDecision('HELD')}>{isAr ? 'تعليق الدفعة' : 'Hold payout'}</button>
        </article>
        <article style={commandStyles.drawerCard}>
          <h2>{isAr ? 'قائمة المراجعة' : 'Review checklist'} <small>{isAr ? 'مساعدة فقط، ليست ذكاءً اصطناعياً' : 'ADVISORY ONLY — not AI-generated'}</small></h2>
          {aiReview.reasons.map((reason) => (
            <p key={reason} style={commandStyles.signalLine}>
              <span>✓</span>
              {reason}
            </p>
          ))}
        </article>
      </section>

      <nav style={commandStyles.actionBar} aria-label={isAr ? 'إجراءات الإدارة' : 'Admin actions'}>
        <button style={commandStyles.acceptButton} disabled={!primaryPayment || disabled || selectedPaymentHeld || !isPaymentReconciled(primaryPayment)} onClick={() => primaryPayment ? onPaymentDecision(primaryPayment.id, 'APPROVE', reconciliationForPayment(primaryPayment)) : setActiveCommandView('finance')}>{isAr ? 'قبول الدفع' : 'Approve payment'}</button>
        <button style={commandStyles.rejectButton} disabled={!primaryPayment || disabled || selectedPaymentHeld} onClick={() => primaryPayment ? onPaymentDecision(primaryPayment.id, 'REJECT') : setActiveCommandView('finance')}>{isAr ? 'رفض الدفع' : 'Reject payment'}</button>
        <button style={commandStyles.blueButton} disabled={disabled} onClick={() => {
          setActiveCommandView('bookings')
          const bookingToConfirm = selectedBooking && isBookingAwaitingApproval(selectedBooking) ? selectedBooking : null
          if (bookingToConfirm) {
            onBookingDecision(bookingToConfirm.id, 'APPROVE')
          } else {
            setCommandNotice(isAr ? 'اختر حجزا محددا من قائمة بانتظار الموافقة قبل التأكيد.' : 'Select a specific booking from Needs approval before confirming.')
          }
        }}>{isAr ? 'تأكيد الحجز' : 'Confirm booking'}</button>
        <button style={commandStyles.disputeButton} onClick={() => setActiveCommandView('disputes')}>{isAr ? 'فتح النزاع' : 'Open dispute'}</button>
        <button style={commandStyles.outlineGold} onClick={() => {
          setActiveCommandView('finance')
          setCommandNotice(isAr ? 'تم فتح مطابقة شام كاش قبل قرار الإدارة.' : 'Sham Cash reconciliation opened before admin decision.')
        }}>{isAr ? 'مطابقة شام كاش' : 'Match Sham Cash'}</button>
        <button style={commandStyles.secondaryCommand} onClick={() => queueAdminMessage('guest')}>{isAr ? 'إرسال للعميل' : 'Send to guest'}</button>
        <button style={commandStyles.secondaryCommand} onClick={() => queueAdminMessage('host')}>{isAr ? 'إرسال للمضيف' : 'Send to host'}</button>
        <button style={commandStyles.secondaryCommand} onClick={() => window.print()}>{isAr ? 'طباعة التقرير' : 'Print report'}</button>
        <button style={commandStyles.secondaryCommand} onClick={() => void loadQueue()}>{isAr ? 'تحديث' : 'Refresh'}</button>
      </nav>
    </main>
  )
}

function FeeLine({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <p style={{ ...commandStyles.feeLine, ...(strong ? commandStyles.feeStrong : {}), ...(danger ? commandStyles.feeDanger : {}) }}>
      <span>{value}</span>
      <b>{label}</b>
    </p>
  )
}

function AdminEmptyLine({ text }: { text: string }) {
  return <div style={commandStyles.emptyProofCard}>{text}</div>
}

function AdminPaymentLine({
  disabled,
  isAr,
  lang,
  payment,
  selected,
  onApprove,
  onReject,
  onSelect,
}: {
  disabled: boolean
  isAr: boolean
  lang: Lang
  payment: PlatformPaymentProof
  selected: boolean
  onApprove: () => void
  onReject: () => void
  onSelect: () => void
}) {
  const aiReview = createPaymentReviewChecklist(payment, isAr)
  return (
    <article style={{ ...commandStyles.managementRow, ...(selected ? commandStyles.selectedCard : {}) }} onClick={onSelect}>
      <div>
        <strong>{bookingReference(payment)}</strong>
        <small>{paymentListingTitle(payment, lang)}</small>
      </div>
      <span>{providerText(payment.provider, lang)}</span>
      <div style={commandStyles.aiRowDecision}>
        <b>{moneyText(payment.amountMinor, payment.currency, lang)}</b>
        <small style={{ color: aiReview.borderColor }}>{aiReview.label}</small>
      </div>
      <div style={commandStyles.managementRowActions}>
        <button disabled={disabled} style={commandStyles.acceptButton} onClick={(event) => { event.stopPropagation(); onApprove() }}>{isAr ? 'قبول' : 'Approve'}</button>
        <button disabled={disabled} style={commandStyles.rejectButton} onClick={(event) => { event.stopPropagation(); onReject() }}>{isAr ? 'رفض' : 'Reject'}</button>
        <button style={commandStyles.blueButton} onClick={(event) => { event.stopPropagation(); window.location.hash = `/payment/receipt/${payment.id}` }}>{isAr ? 'تفاصيل' : 'Details'}</button>
      </div>
    </article>
  )
}

function AdminIdDocumentLine({
  doc,
  disabled,
  isAr,
  onApprove,
  onReject,
}: {
  doc: PlatformIdDocumentReview
  disabled: boolean
  isAr: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')

  async function loadDocument() {
    setLoadState('loading')
    try {
      const url = await fetchIdDocumentBlobUrl(doc.id)
      setBlobUrl(url)
      setLoadState('idle')
    } catch {
      setLoadState('error')
    }
  }

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  return (
    <article style={commandStyles.managementRow}>
      <div>
        <strong>{doc.displayName}</strong>
        <small>{doc.email || (isAr ? 'بدون بريد إلكتروني' : 'No email')}</small>
      </div>
      <span>{doc.idDocumentMimeType || '-'}</span>
      {blobUrl ? (
        doc.idDocumentMimeType === 'application/pdf' ? (
          <a href={blobUrl} target="_blank" rel="noreferrer" style={commandStyles.blueButton}>
            {isAr ? 'فتح PDF' : 'Open PDF'}
          </a>
        ) : (
          <img src={blobUrl} alt="ID document" style={{ maxWidth: 160, maxHeight: 120, borderRadius: 8, objectFit: 'cover' }} />
        )
      ) : (
        <button style={commandStyles.secondaryCommand} disabled={loadState === 'loading'} onClick={() => void loadDocument()}>
          {loadState === 'loading' ? (isAr ? 'جار التحميل...' : 'Loading...') : loadState === 'error' ? (isAr ? 'إعادة المحاولة' : 'Retry') : isAr ? 'عرض المستند' : 'View document'}
        </button>
      )}
      <div style={commandStyles.managementRowActions}>
        <button disabled={disabled} style={commandStyles.acceptButton} onClick={onApprove}>{isAr ? 'قبول' : 'Approve'}</button>
        <button disabled={disabled} style={commandStyles.rejectButton} onClick={onReject}>{isAr ? 'رفض' : 'Reject'}</button>
      </div>
    </article>
  )
}

function AdminManualIdUploadPanel({ isAr }: { isAr: boolean }) {
  const [email, setEmail] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [foundUser, setFoundUser] = useState<PlatformIdDocumentReview | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error' | 'done'>('idle')
  const [message, setMessage] = useState('')

  async function runLookup() {
    const trimmed = email.trim()
    if (!trimmed) return
    setLookupState('loading')
    setFoundUser(null)
    setUploadState('idle')
    setMessage('')
    try {
      const user = await lookupAdminUserByEmail(trimmed)
      setFoundUser(user)
      setLookupState('idle')
    } catch {
      setLookupState('error')
      setMessage(isAr ? 'لم يتم العثور على عميل بهذا البريد الإلكتروني.' : 'No customer found with that email.')
    }
  }

  async function runUpload() {
    if (!foundUser || !file) return
    setUploadState('uploading')
    setMessage('')
    try {
      const updated = await uploadIdDocumentForUser(foundUser.id, file)
      setFoundUser(updated)
      setFile(null)
      setUploadState('done')
      setMessage(isAr ? 'تم رفع المستند بنجاح وهو الآن بانتظار المراجعة.' : 'Document uploaded successfully and is now pending review.')
    } catch {
      setUploadState('error')
      setMessage(isAr ? 'تعذر رفع المستند. حاول مرة أخرى.' : 'Could not upload the document. Try again.')
    }
  }

  return (
    <article style={{ ...commandStyles.managementRow, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <strong>{isAr ? 'رفع يدوي (واتساب / بريد إلكتروني)' : 'Manual upload (WhatsApp / email)'}</strong>
      <small>
        {isAr
          ? 'ابحث عن العميل عبر بريده الإلكتروني، ثم ارفع المستند المستلم عبر واتساب أو البريد نيابة عنه.'
          : "Find the customer by their account email, then upload the document received via WhatsApp or email on their behalf."}
      </small>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="email"
          placeholder={isAr ? 'البريد الإلكتروني للعميل' : 'Customer email'}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{ flex: '1 1 220px', padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc' }}
        />
        <button
          style={commandStyles.secondaryCommand}
          disabled={lookupState === 'loading' || !email.trim()}
          onClick={() => void runLookup()}
        >
          {lookupState === 'loading' ? (isAr ? 'جار البحث...' : 'Searching...') : isAr ? 'بحث' : 'Find'}
        </button>
      </div>
      {foundUser && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.04)' }}>
          <div>
            <strong>{foundUser.displayName}</strong>
            <small style={{ display: 'block' }}>{foundUser.email}</small>
            <small style={{ display: 'block' }}>{isAr ? 'الحالة الحالية: ' : 'Current status: '}{foundUser.idDocumentStatus || (isAr ? 'لا يوجد' : 'None')}</small>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <button
              style={commandStyles.acceptButton}
              disabled={!file || uploadState === 'uploading'}
              onClick={() => void runUpload()}
            >
              {uploadState === 'uploading' ? (isAr ? 'جار الرفع...' : 'Uploading...') : isAr ? 'رفع المستند' : 'Upload document'}
            </button>
          </div>
        </div>
      )}
      {message && <small style={{ color: uploadState === 'error' || lookupState === 'error' ? '#c0392b' : '#2e7d32' }}>{message}</small>}
    </article>
  )
}

function ShamCashReconciliationPanel({
  data,
  expanded,
  isAr,
  lang,
  targetPayment,
  inputValue,
  onChangeInputValue,
  onSave,
}: {
  data: ReturnType<typeof createShamCashReconciliation>
  expanded?: boolean
  isAr: boolean
  lang: Lang
  targetPayment?: PlatformPaymentProof
  inputValue: string
  onChangeInputValue: (value: string) => void
  onSave: (paymentId: string, value: string) => void
}) {
  const targetReference = targetPayment ? (targetPayment.providerRef || targetPayment.id.slice(0, 10).toUpperCase()) : null
  const effectiveValue = inputValue || (targetPayment ? String(targetPayment.amountMinor) : '')
  return (
    <section style={commandStyles.shamCashPanel}>
      <div style={commandStyles.shamCashHeader}>
        <div>
          <small>{isAr ? 'ربط مالي داخلي' : 'Internal finance link'}</small>
          <h3>{isAr ? 'مطابقة حساب شام كاش' : 'Sham Cash account reconciliation'}</h3>
        </div>
        <span style={data.isMatched ? commandStyles.confirmedPill : commandStyles.warningPill}>
          {data.statusLabel}
        </span>
      </div>
      <div style={commandStyles.shamCashGrid}>
        <div style={commandStyles.moneyCommandCard}>
          <small>{isAr ? 'المتوقع حسب SYBNB' : 'Expected by SYBNB'}</small>
          <strong style={commandTone('gold')}>{moneyText(data.expectedMinor, 'SYP', lang)}</strong>
        </div>
        <div style={commandStyles.moneyCommandCard}>
          <small>{isAr ? 'الموجود في شام كاش' : 'In Sham Cash account'}</small>
          <strong style={commandTone(data.isMatched ? 'green' : 'red')}>{data.accountMinor == null ? (isAr ? 'غير مربوط' : 'Not linked') : moneyText(data.accountMinor, 'SYP', lang)}</strong>
        </div>
        <div style={commandStyles.moneyCommandCard}>
          <small>{isAr ? 'فرق المطابقة' : 'Reconciliation difference'}</small>
          <strong style={commandTone(data.isMatched ? 'green' : 'red')}>{moneyText(data.differenceMinor, 'SYP', lang)}</strong>
        </div>
      </div>
      <div style={commandStyles.shamCashReconcileRow}>
        <div>
          <small>{isAr ? 'مطابقة دفعة محددة' : 'Reconcile a specific payment'}</small>
          <strong>{targetReference || (isAr ? 'اختر دفعة من القائمة' : 'Select a payment from the list')}</strong>
        </div>
        <input
          type="text"
          inputMode="numeric"
          value={effectiveValue}
          onChange={(event) => onChangeInputValue(event.target.value)}
          disabled={!targetPayment}
          aria-label={isAr ? 'رصيد شام كاش الحقيقي لهذه الدفعة' : 'Real Sham Cash balance for this payment'}
          style={{ minWidth: 140, padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc' }}
        />
        <button style={commandStyles.outlineGold} disabled={!targetPayment} onClick={() => targetPayment && onSave(targetPayment.id, effectiveValue)}>
          {isAr ? 'تحديث رصيد شام كاش' : 'Update Sham Cash balance'}
        </button>
      </div>
      <p style={commandStyles.aiFinalNote}>{data.controlNote}</p>
      <div style={commandStyles.outcomeGrid}>
        <article style={commandStyles.outcomeCard}>
          <strong>{isAr ? 'إذا قبلت الإدارة' : 'If admin accepts'}</strong>
          <p>{isAr ? 'تتحول الدفعة إلى محمية داخل SYBNB، يتأكد الحجز، تسجل عمولة المنصة، ويبقى صرف المضيف معلقا حتى انتهاء الإقامة.' : 'Payment becomes protected in SYBNB, booking is confirmed, platform commission is recorded, and host payout stays held until checkout.'}</p>
        </article>
        <article style={commandStyles.outcomeCard}>
          <strong>{isAr ? 'إذا رفضت الإدارة' : 'If admin refuses'}</strong>
          <p>{isAr ? 'لا يتأكد الحجز، لا يتم صرف المضيف، لا تسجل عمولة نهائية، ويرسل للعميل سبب الرفض أو طلب رفع إثبات جديد.' : 'Booking is not confirmed, host payout is blocked, final commission is not booked, and the guest receives the refusal reason or a request to upload proof again.'}</p>
        </article>
      </div>
      {expanded && (
        <div style={commandStyles.managementList}>
          {data.items.length === 0 ? (
            <AdminEmptyLine text={isAr ? 'لا توجد دفعات شام كاش حالية للمطابقة.' : 'No Sham Cash payments are currently available to reconcile.'} />
          ) : data.items.map((item) => (
            <div key={item.id} style={commandStyles.managementRow}>
              <div>
                <strong>{item.reference}</strong>
                <small>{isAr ? 'رمز شام كاش' : 'Sham Cash code'}</small>
              </div>
              <span>{item.status}</span>
              <b>{moneyText(item.amountMinor, 'SYP', lang)}</b>
              <small>{item.note}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function AdminBookingLine({
  booking,
  disabled,
  isAr,
  lang,
  selected,
  onApprove,
  onReject,
  onSelect,
}: {
  booking: PlatformReviewBooking
  disabled: boolean
  isAr: boolean
  lang: Lang
  selected: boolean
  onApprove: () => void
  onReject: () => void
  onSelect: () => void
}) {
  const title = booking.listing ? listingTitleText(booking.listing, lang) : booking.id.slice(0, 8).toUpperCase()
  return (
    <article style={{ ...commandStyles.managementRow, ...(selected ? commandStyles.selectedCard : {}) }} onClick={onSelect}>
      <div>
        <strong>{title}</strong>
        <small>{booking.id.slice(0, 8).toUpperCase()}</small>
      </div>
      <span>{statusText(booking.status, lang)}</span>
      <b>{moneyText(booking.amountMinor, booking.currency, lang)}</b>
      <div style={commandStyles.managementRowActions}>
        {!disabled && <button style={commandStyles.acceptButton} onClick={(event) => { event.stopPropagation(); onApprove() }}>{isAr ? 'تأكيد' : 'Confirm'}</button>}
        {!disabled && <button style={commandStyles.rejectButton} onClick={(event) => { event.stopPropagation(); onReject() }}>{isAr ? 'رفض' : 'Reject'}</button>}
        <button style={commandStyles.blueButton} onClick={(event) => { event.stopPropagation(); window.location.hash = `/booking/${booking.id}` }}>{isAr ? 'تفاصيل' : 'Details'}</button>
      </div>
    </article>
  )
}

function paymentListingTitle(payment: PlatformPaymentProof | undefined, lang: Lang) {
  const listing = payment?.booking?.listing
  if (listing) return listingTitleText(listing, lang)
  if (payment?.provider === 'seller_plan') return lang === 'ar' ? 'دفعة خطة بائع' : 'Seller plan payment'
  return lang === 'ar' ? 'بدون حجز مرتبط' : 'No linked booking'
}

function paymentHostName(payment: PlatformPaymentProof | undefined, lang: Lang) {
  return (
    payment?.booking?.listing?.owner?.displayName ||
    payment?.payer?.displayName ||
    (lang === 'ar' ? 'غير معروف' : 'Unknown')
  )
}

function bookingReference(payment: PlatformPaymentProof | undefined) {
  const id = payment?.bookingId || payment?.booking?.id || payment?.id
  if (!id) return '—'
  return `BK-${id.slice(0, 4).toUpperCase()}-${id.slice(4, 8).toUpperCase()}`
}

function shortBookingReference(booking: PlatformReviewBooking | undefined) {
  if (!booking?.id) return '—'
  return `BK-${booking.id.slice(0, 4).toUpperCase()}-${booking.id.slice(4, 8).toUpperCase()}`
}

function createShortRentLedger(totalMinor: number) {
  const divisor = 1 + STR_CLEANING_RATE + STR_TAX_RATE
  const rentMinor = Math.round(totalMinor / divisor)
  const cleaningFeeMinor = Math.round(rentMinor * STR_CLEANING_RATE)
  const taxesMinor = Math.max(0, totalMinor - rentMinor - cleaningFeeMinor)
  const adminCommissionMinor = Math.round(rentMinor * STR_ADMIN_COMMISSION_RATE)
  const hostPayoutMinor = Math.max(0, rentMinor + cleaningFeeMinor - adminCommissionMinor)
  return {
    adminCommissionMinor,
    cleaningFeeMinor,
    hostPayoutMinor,
    rentMinor,
    taxesMinor,
    totalMinor,
  }
}

function readStoredShamCashMap(key: string): Record<string, number> {
  if (typeof window === 'undefined') return {}
  const raw = window.localStorage.getItem(key)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const entries = Object.entries(parsed).filter(([, value]) => Number.isFinite(Number(value)))
    return Object.fromEntries(entries.map(([id, value]) => [id, Math.round(Number(value))]))
  } catch {
    return {}
  }
}

// Reconciliation is per Sham Cash payment, not a single global balance. Each pending payment's own
// amountMinor is what must be matched — summing every pending payment into one aggregate balance
// (the previous design) let reconciling the total silently "cover" whichever payment got approved
// first, leaving unrelated bookings falsely marked matched or mismatched.
function createShamCashReconciliation(realPayments: PlatformPaymentProof[], displayPayments: PlatformPaymentProof[], lang: Lang, accountByPayment: Record<string, number>) {
  const shamCashPayments = realPayments.filter((payment) => isShamCashProvider(payment.provider))
  const sourcePayments = shamCashPayments.length ? shamCashPayments : displayPayments.filter((payment) => isShamCashProvider(payment.provider) || payment.provider === 'LOCAL_WALLET')
  const expectedMinor = sourcePayments.reduce((sum, payment) => sum + payment.amountMinor, 0)
  const reconciledPayments = sourcePayments.filter((payment) => accountByPayment[payment.id] === payment.amountMinor)
  const hasAnyEntry = sourcePayments.some((payment) => accountByPayment[payment.id] != null)
  const accountMinor = hasAnyEntry ? reconciledPayments.reduce((sum, payment) => sum + payment.amountMinor, 0) : null
  const hasExternalAccount = accountMinor != null
  const differenceMinor = hasExternalAccount ? accountMinor - expectedMinor : expectedMinor
  const isMatched = sourcePayments.length > 0 && reconciledPayments.length === sourcePayments.length
  const isAr = lang === 'ar'
  return {
    accountMinor,
    canApprove: isMatched,
    controlNote: hasExternalAccount
      ? (isMatched
        ? (isAr ? 'تمت المطابقة مع رصيد شام كاش المدخل. يمكن قبول الدفع بعد مراجعة الإدارة.' : 'Matched against the entered Sham Cash balance. Admin can approve after review.')
        : (isAr ? 'يوجد فرق بين سجل SYBNB وحساب شام كاش. لا تقبل الدفع قبل حل الفرق.' : 'There is a difference between the SYBNB ledger and Sham Cash. Do not approve before resolving it.'))
      : (isAr ? 'لا يوجد ربط حي مع شام كاش بعد. أدخل رصيد الحساب الحقيقي أو اربط API قبل قبول الدفع.' : 'No live Sham Cash feed is connected yet. Enter the real account balance or connect an API before approval.'),
    differenceMinor,
    expectedMinor,
    isMatched,
    statusLabel: hasExternalAccount
      ? (isMatched ? (isAr ? 'الأرقام متطابقة' : 'Numbers match') : (isAr ? 'يوجد فرق' : 'Mismatch'))
      : (isAr ? 'ينتظر الربط' : 'Awaiting link'),
    items: sourcePayments.slice(0, 6).map((payment) => {
      const itemMatched = accountByPayment[payment.id] === payment.amountMinor
      return {
        id: payment.id,
        amountMinor: payment.amountMinor,
        reference: payment.providerRef || payment.id.slice(0, 10).toUpperCase(),
        status: statusText(payment.status, lang),
        note: lang === 'ar'
          ? (itemMatched ? 'مطابق مع حساب شام كاش' : 'يحتاج مراجعة شام كاش')
          : (itemMatched ? 'Matched with Sham Cash account' : 'Needs Sham Cash review'),
      }
    }),
  }
}

function isShamCashProvider(provider: string | null | undefined) {
  const normalized = String(provider || '').toUpperCase()
  return normalized.includes('SHAM') || normalized.includes('LOCAL_WALLET') || normalized.includes('SYRIAN_LOCAL_WALLET')
}

function commandTone(tone: string): CSSProperties {
  const colors: Record<string, string> = {
    blue: '#5268ff',
    gold: '#e6b80d',
    green: '#20d29b',
    red: '#ff4d73',
    white: '#f7f7fb',
  }
  return { color: colors[tone] || colors.white }
}

// Deterministic checklist derived from real payment fields (status, proof presence, amount
// threshold) -- previously branded as "AI Brain" with a fabricated confidence percentage attached
// to each branch (88/74/82/94), none of which were computed from anything. No AI/ML is involved
// here or anywhere else in the payment-review flow; this is a plain rule-based checklist to help
// an admin spot things worth double-checking before approving/rejecting a real payment.
function createPaymentReviewChecklist(payment: PlatformPaymentProof | undefined, isAr: boolean) {
  if (!payment) {
    return {
      label: isAr ? 'لا يوجد دفع محدد' : 'No payment selected',
      title: isAr ? 'اختر دفعة لعرض قائمة المراجعة' : 'Select a payment to see its review checklist',
      borderColor: '#8e93a3',
      reasons: [],
    }
  }

  const provider = payment.provider || 'LOCAL_WALLET'
  const amount = payment.amountMinor || 0
  const hasProof = Boolean(payment.proofAssetUrl || payment.providerRef)
  const isLarge = amount >= 50000000
  const isRejected = payment.status === 'REJECTED'
  const isApproved = payment.status === 'APPROVED'

  if (isRejected) {
    return {
      label: isAr ? 'سبب رفض' : 'Reject reason',
      title: isAr ? 'دفعة مرفوضة' : 'Payment already rejected',
      borderColor: '#ff4d73',
      reasons: [
        isAr ? 'حالة إثبات الدفع مرفوضة في السجل.' : 'Payment proof is already rejected in the ledger.',
        isAr ? 'لا يتم تأكيد الحجز قبل رفع سبب الرفض للعميل.' : 'Booking should not be confirmed before the guest receives the rejection reason.',
      ],
    }
  }

  if (!hasProof) {
    return {
      label: isAr ? 'مراجعة مطلوبة' : 'Review needed',
      title: isAr ? 'لا يوجد إثبات دفع مرفق' : 'No payment proof attached',
      borderColor: '#e6b80d',
      reasons: [
        isAr ? 'لا يوجد مستند دفع أو رمز مراجعة واضح.' : 'No clear payment document or review code is attached.',
        isAr ? 'يجب طلب إثبات الدفع من العميل قبل قبول الحجز.' : 'Request proof from the guest before accepting the booking.',
      ],
    }
  }

  if (isLarge) {
    return {
      label: isAr ? 'تدقيق إضافي' : 'Extra audit',
      title: isAr ? 'مبلغ مرتفع يستحق تدقيقاً إضافياً' : 'High-value amount worth an extra check',
      borderColor: '#e6b80d',
      reasons: [
        isAr ? 'قيمة المعاملة أعلى من المتوسط.' : 'Transaction value is above the normal average.',
        isAr ? 'راجع تطابق المبلغ مع الحجز قبل القبول.' : 'Verify the amount matches the booking before approval.',
      ],
    }
  }

  return {
    label: isAr ? 'يبدو جاهزاً' : 'Looks ready',
    title: isApproved ? (isAr ? 'الدفع مؤكد في السجل' : 'Payment is confirmed in ledger') : (isAr ? 'لا مشاكل ظاهرة في هذه الدفعة' : 'No issues found with this payment'),
    borderColor: '#20d29b',
    reasons: [
      provider === 'LOCAL_WALLET'
        ? (isAr ? 'طريقة الدفع محلية ومطابقة لمسار الحجز.' : 'Local payment method matches the booking lane.')
        : (isAr ? 'طريقة الدفع مسجلة في الطلب.' : 'Payment method is recorded on the request.'),
      isAr ? 'لا يوجد تكرار واضح أو تعارض في رقم المراجعة.' : 'No clear duplicate or review-code conflict detected.',
      isAr ? 'الإعلان والحجز والمبلغ متطابقة قبل قرار الإدارة.' : 'Listing, booking, and amount match before admin decision.',
    ],
  }
}

function createCashMatchChecklist(isAr: boolean, missingAccount: boolean) {
  return {
    label: isAr ? 'إيقاف قبل القرار' : 'Hold before decision',
    title: isAr ? 'يتطلب مطابقة شام كاش' : 'Requires a Sham Cash match',
    borderColor: '#e6b80d',
    reasons: [
      missingAccount
        ? (isAr ? 'لا يوجد رصيد حساب شام كاش مؤكد للمطابقة.' : 'No confirmed Sham Cash account balance is available.')
        : (isAr ? 'يوجد فرق بين سجل SYBNB وحساب شام كاش.' : 'SYBNB ledger and Sham Cash account do not match.'),
      isAr ? 'لا تقبل الدفع قبل تأكيد استلام المال فعليا.' : 'Do not approve payment before real money receipt is confirmed.',
      isAr ? 'يمكن طلب إثبات جديد أو تحديث رصيد شام كاش.' : 'Request new proof or update Sham Cash balance.',
    ],
  }
}

function isBookingAwaitingApproval(booking: PlatformReviewBooking) {
  const status = booking.status.toUpperCase()
  return !isBookingConfirmed(booking) && !isBookingDisputed(booking) && !status.includes('REJECT') && !status.includes('CANCEL')
}

function isBookingConfirmed(booking: PlatformReviewBooking) {
  const status = booking.status.toUpperCase()
  return status.includes('CONFIRM') || status.includes('APPROV') || status.includes('PAID') || status.includes('PROGRESS') || status.includes('COMPLETED')
}

function isBookingDisputed(booking: PlatformReviewBooking) {
  const status = booking.status.toUpperCase()
  return status.includes('DISPUT') || status.includes('CONFLICT') || status.includes('ESCALAT')
}

// Real timestamps where the schema actually tracks one for this step; '—' everywhere else
// (previously a fixed ['10:02 AM', '10:05 AM', ...] array shown identically for every booking
// regardless of its actual history). Booking.createdAt/guestCheckedInAt/guestCheckedOutAt and
// PaymentProof.reviewedAt cover about half of the 13 pipeline steps -- the rest (client search,
// account opened, terms accepted, host confirmation, guest review, host payout, transaction
// closed) have no backing timestamp field anywhere in the schema, so they honestly show '—'.
function flowStepTime(index: number, isAr: boolean, payment: PlatformPaymentProof | undefined, booking: PlatformReviewBooking | undefined) {
  const formatTime = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleTimeString(isAr ? 'ar-SY' : 'en-US', { hour: 'numeric', minute: '2-digit' }) : undefined

  const timeByIndex: Record<number, string | undefined> = {
    3: formatTime(booking?.createdAt || payment?.booking?.createdAt),
    6: formatTime(payment?.reviewedAt),
    8: formatTime(booking?.guestCheckedInAt || payment?.booking?.guestCheckedInAt),
    9: formatTime(booking?.guestCheckedOutAt || payment?.booking?.guestCheckedOutAt),
  }
  return timeByIndex[index] || '—'
}

const commandStyles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#07080d', color: '#f7f7fb', padding: '18px 24px 88px', display: 'grid', gap: 18, fontFamily: 'inherit' },
  header: { alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'grid', gap: 16, gridTemplateColumns: 'auto 1fr auto', margin: '0 -24px', padding: '0 24px 18px' },
  strBrandLockup: { alignItems: 'center', display: 'flex', gap: 12, minWidth: 0 },
  watermark: { background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 5, color: '#8e93a3', fontSize: 12, fontWeight: 800, letterSpacing: 0, padding: '7px 10px', whiteSpace: 'nowrap' },
  flowButtons: { display: 'flex', gap: 10 },
  circleButton: { alignItems: 'center', background: '#181926', border: '1px solid rgba(255,255,255,.08)', borderRadius: 999, color: '#fff', display: 'grid', fontSize: 22, fontWeight: 950, height: 48, placeItems: 'center', width: 48 },
  breadcrumb: { color: '#8e93a3', display: 'flex', gap: 10, justifyContent: 'center' },
  adminIdentity: { alignItems: 'center', display: 'flex', gap: 14 },
  logoBlock: { background: '#4760ff', borderRadius: 6, color: '#fff', display: 'grid', fontWeight: 950, height: 34, placeItems: 'center', width: 34 },
  avatar: { background: 'linear-gradient(135deg,#d7c4ab,#23324b)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, color: '#fff', display: 'grid', fontWeight: 950, height: 34, placeItems: 'center', width: 34 },
  notify: { color: '#ff4d73', fontSize: 16 },
  departmentGroups: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 },
  departmentGroup: { background: '#0d0f18', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, overflow: 'hidden' },
  departmentGroupHeader: { alignItems: 'center', background: 'transparent', border: 'none', color: '#c7cbdb', cursor: 'pointer', display: 'flex', gap: 12, minHeight: 56, padding: '10px 16px', width: '100%' },
  departmentGroupHeaderActive: { background: 'rgba(82,104,255,.12)', color: '#fff' },
  departmentGroupChevron: { color: '#5268ff', fontSize: 14, width: 14 },
  departmentGroupLabel: { display: 'flex', flex: 1, flexDirection: 'column', gap: 2, textAlign: 'start' },
  departmentTabs: { alignItems: 'center', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 16px' },
  departmentTab: { alignItems: 'center', background: '#11131d', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, color: '#8e93a3', display: 'flex', gap: 8, fontWeight: 900, justifyContent: 'center', minHeight: 44, minWidth: 116, padding: '0 14px', whiteSpace: 'nowrap' },
  departmentTabActive: { background: 'rgba(82,104,255,.26)', border: '1px solid rgba(82,104,255,.75)', color: '#5268ff', boxShadow: '0 0 0 1px rgba(82,104,255,.14) inset' },
  statsGrid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' },
  warningBanner: { alignItems: 'center', background: 'rgba(230,184,13,.12)', border: '1px solid rgba(230,184,13,.42)', borderRadius: 8, color: '#e6b80d', display: 'flex', gap: 14, justifyContent: 'space-between', padding: '14px 16px' },
  adminV2Grid: { alignItems: 'start', display: 'grid', gap: 20, gridTemplateColumns: 'minmax(270px, .9fr) minmax(420px, 1.15fr) minmax(330px, 1fr)' },
  leftRail: { display: 'grid', gap: 16 },
  centerPanel: { background: '#10121b', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, display: 'grid', gap: 18, minHeight: 560, padding: 20 },
  rightQueue: { display: 'grid', gap: 14 },
  protectionFlags: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' },
  managementGroups: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' },
  managementGroupCard: { background: '#10121b', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, display: 'grid', gap: 14, padding: 16 },
  managementGroupHeader: { display: 'grid', gap: 4 },
  groupStatsGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' },
  statCard: { background: '#11121a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, display: 'grid', gap: 8, minHeight: 84, padding: 14 },
  footerGroups: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  footerGroupButton: { alignItems: 'center', background: '#10121b', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: '#d9deea', display: 'flex', justifyContent: 'space-between', minHeight: 58, padding: '10px 12px', textAlign: 'start' },
  footerGroupButtonActive: { background: 'rgba(82,104,255,.2)', border: '1px solid rgba(82,104,255,.78)', boxShadow: '0 0 0 1px rgba(82,104,255,.18) inset' },
  commandViewPanel: { background: '#10121b', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, display: 'grid', gap: 14, padding: 16 },
  commandViewHeader: { alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' },
  commandNotice: { background: 'rgba(32,210,155,.12)', border: '1px solid rgba(32,210,155,.35)', borderRadius: 999, color: '#20d29b', fontSize: 12, fontWeight: 900, padding: '6px 10px' },
  outboxPanel: { background: 'rgba(82,104,255,.08)', border: '1px solid rgba(82,104,255,.35)', borderRadius: 8, color: '#d9deea', display: 'grid', gap: 8, padding: 12 },
  payoutState: { border: '1px solid rgba(230,184,13,.45)', borderRadius: 999, color: '#e6b80d', fontSize: 12, fontWeight: 950, justifySelf: 'start', padding: '6px 10px' },
  managementList: { display: 'grid', gap: 10 },
  sectionHeadRow: { display: 'grid', gap: 4, color: '#f7f7fb', padding: '4px 2px' },
  managementRow: { alignItems: 'center', background: '#0d0e14', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, color: '#f7f7fb', display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', minHeight: 62, padding: 12, textAlign: 'start' },
  selectedCard: { border: '1px solid rgba(82,104,255,.85)', boxShadow: '0 0 0 1px rgba(82,104,255,.2) inset' },
  managementRowActions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(74px, 1fr))' },
  moneyCommandGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' },
  moneyCommandCard: { background: '#0d0e14', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, display: 'grid', gap: 10, padding: 14 },
  shamCashPanel: { background: '#0d0e14', border: '1px solid rgba(230,184,13,.35)', borderRadius: 8, display: 'grid', gap: 14, padding: 16 },
  shamCashHeader: { alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' },
  shamCashGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  shamCashReconcileRow: { alignItems: 'center', background: '#11131d', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 10, padding: 12 },
  outcomeGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  outcomeCard: { background: '#10121b', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, display: 'grid', gap: 8, padding: 12 },
  aiRail: { alignItems: 'center', display: 'flex', gap: 14, justifyContent: 'space-between' },
  linkButton: { background: 'transparent', border: 0, color: '#5268ff', fontWeight: 900, textDecoration: 'underline' },
  aiPills: { alignItems: 'center', display: 'flex', gap: 10, marginInlineStart: 'auto' },
  aiDecisionCard: { background: '#0d0e14', border: '1px solid #20d29b', borderRadius: 8, display: 'grid', gap: 12, padding: 16 },
  aiDecisionHeader: { alignItems: 'center', display: 'grid', gap: 14, gridTemplateColumns: 'auto 1fr auto' },
  aiDecisionBadge: { borderRadius: 999, color: '#06130f', fontSize: 12, fontWeight: 950, padding: '7px 12px' },
  aiReasonGrid: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  aiReasonLine: { background: '#10121b', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, margin: 0, padding: 10 },
  aiFinalNote: { color: '#9ca3b6', margin: 0 },
  aiMiniDecision: { background: 'rgba(32,210,155,.08)', border: '1px solid rgba(32,210,155,.22)', borderRadius: 8, color: '#d9deea', display: 'grid', gap: 4, padding: 10 },
  aiRowDecision: { display: 'grid', gap: 4 },
  commandGrid: { display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))' },
  proofColumn: { display: 'grid', gap: 14 },
  sectionHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  countBadge: { background: '#e6b80d', borderRadius: 5, color: '#111', display: 'inline-grid', fontSize: 13, height: 20, marginInlineEnd: 8, placeItems: 'center', width: 24 },
  proofList: { display: 'grid', gap: 14 },
  emptyProofCard: { background: '#11121a', border: '1px dashed rgba(255,255,255,.18)', borderRadius: 8, color: '#9ca3b6', display: 'grid', gap: 8, minHeight: 120, padding: 18, placeContent: 'center', textAlign: 'center' },
  proofCard: { background: '#11121a', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, display: 'grid', gap: 12, padding: 14 },
  proofTop: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  proofInfo: { display: 'grid', gap: 3 },
  proofMoney: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  proofActions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))' },
  pipelineCard: { background: '#11121a', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, display: 'grid', gap: 14, padding: 20 },
  pipelinePulse: { color: '#5268ff', fontSize: 30 },
  pipelineList: { display: 'grid', gap: 13 },
  pipelineStep: { alignItems: 'center', color: '#697082', display: 'grid', gap: 10, gridTemplateColumns: '72px 1fr 30px' },
  pipelineActive: { color: '#e6b80d', fontWeight: 950 },
  sidePanels: { display: 'grid', gap: 20 },
  sideCard: { background: '#11121a', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, display: 'grid', gap: 14, padding: 20 },
  cardTitleRow: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  confirmedPill: { background: '#20d29b', borderRadius: 5, color: '#06130f', fontSize: 12, fontWeight: 950, padding: '5px 10px' },
  warningPill: { background: '#e6b80d', borderRadius: 5, color: '#111', fontSize: 12, fontWeight: 950, padding: '5px 10px' },
  hostRow: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  hostAvatar: { background: 'linear-gradient(135deg,#d7c4ab,#23324b)', borderRadius: 999, display: 'grid', fontWeight: 950, height: 54, placeItems: 'center', width: 54 },
  checkLine: { alignItems: 'center', display: 'flex', gap: 10, justifyContent: 'space-between', margin: 0 },
  feeLine: { display: 'flex', justifyContent: 'space-between', margin: 0 },
  feeStrong: { borderTop: '1px solid rgba(255,255,255,.08)', fontWeight: 950, paddingTop: 12 },
  feeDanger: { color: '#ff4d73', fontSize: 13 },
  drawerGrid: { display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' },
  drawerCard: { background: '#0d0e14', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, display: 'grid', gap: 16, padding: 24 },
  walletTimeline: { borderInlineStart: '2px solid rgba(255,255,255,.18)', display: 'grid', gap: 14, paddingInlineStart: 18 },
  signalLine: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', margin: 0, padding: 12 },
  riskPair: { display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' },
  actionBar: { alignItems: 'center', background: 'rgba(7,8,13,.94)', borderTop: '1px solid rgba(255,255,255,.12)', bottom: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', insetInline: 0, padding: '12px 24px', position: 'fixed', zIndex: 10 },
  acceptButton: { background: '#20c987', border: 0, borderRadius: 8, color: '#fff', fontWeight: 950, minHeight: 44, padding: '0 14px' },
  rejectButton: { background: '#ff4d73', border: 0, borderRadius: 8, color: '#fff', fontWeight: 950, minHeight: 44, padding: '0 14px' },
  goldButton: { background: '#e6b80d', border: 0, borderRadius: 8, color: '#111', fontWeight: 950, minHeight: 44, padding: '0 14px' },
  blueButton: { background: '#4760ff', border: 0, borderRadius: 8, color: '#fff', fontWeight: 950, minHeight: 44, padding: '0 14px' },
  disputeButton: { background: 'transparent', border: '1px solid #ff744d', borderRadius: 8, color: '#ff744d', fontWeight: 950, minHeight: 44, padding: '0 14px' },
  outlineGold: { background: 'transparent', border: '1px solid #e6b80d', borderRadius: 8, color: '#e6b80d', fontWeight: 950, minHeight: 44, padding: '0 14px' },
  secondaryCommand: { background: 'transparent', border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, color: '#d9deea', fontWeight: 950, minHeight: 44, padding: '0 14px' },
}

function AdminMetric({ label, value, icon, tone }: { label: string; value: string; icon: string; tone: 'red' | 'gold' | 'green' | 'blue' }) {
  return (
    <article className={`admin-metric ${tone}`}>
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  )
}

function ReviewSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      {hasChildren ? <div style={styles.grid}>{children}</div> : <p style={styles.empty}>{empty}</p>}
    </section>
  )
}

function ListingReviewCard({
  listing,
  labels,
  lang,
  disabled,
  onDecision,
}: {
  listing: PlatformListing
  labels: { approve: string; reject: string; price: string; details: string }
  lang: Lang
  disabled: boolean
  onDecision: (decision: 'APPROVE' | 'REJECT') => void
}) {
  return (
    <article style={styles.card}>
      <span style={styles.status}>{statusText(listing.status, lang)}</span>
      <h3 style={styles.cardTitle}>{listingTitleText(listing, lang)}</h3>
      <p style={styles.cardBody}>{listingDescriptionText(listing, lang)}</p>
      <div style={styles.meta}>
        <span>{labels.price}</span>
        <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
      </div>
      <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>
        {labels.details}
      </button>
      <DecisionActions labels={labels} disabled={disabled} onDecision={onDecision} />
    </article>
  )
}

function PaymentReviewCard({
  payment,
  labels,
  lang,
  disabled,
  onDecision,
}: {
  payment: PlatformPaymentProof
  labels: { approve: string; reject: string; price: string; provider: string; details: string }
  lang: Lang
  disabled: boolean
  onDecision: (decision: 'APPROVE' | 'REJECT') => void
}) {
  const isApproved = payment.status === 'APPROVED'
  const isRejected = payment.status === 'REJECTED'
  const isFinal = isApproved || isRejected
  const confirmationText = isApproved
    ? lang === 'ar'
      ? 'تم إرسال تأكيد الدفع للعميل'
      : 'Payment confirmation sent to client'
    : lang === 'ar'
      ? 'تم إرسال نتيجة الرفض للعميل'
      : 'Payment rejection sent to client'

  return (
    <article style={styles.card}>
      <span style={styles.status}>{statusText(payment.status, lang)}</span>
      <h3 style={styles.cardTitle}>{payment.providerRef || payment.id.slice(0, 8).toUpperCase()}</h3>
      <div style={styles.meta}>
        <span>{labels.provider}</span>
        <strong>{providerText(payment.provider, lang)}</strong>
      </div>
      <div style={styles.meta}>
        <span>{labels.price}</span>
        <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>{moneyText(payment.amountMinor, payment.currency, lang)}</strong>
      </div>
      {!isFinal && (
        <p style={styles.moneyReceivedWarning}>
          {lang === 'ar' ? 'وافق فقط بعد التأكد من استلام المال ومطابقة الإثبات.' : 'Approve only after confirming money was received and proof matches.'}
        </p>
      )}
      <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/payment/receipt/${payment.id}`)}>
        {labels.details}
      </button>
      {isFinal ? (
        <p style={{ ...styles.confirmationNote, ...(isApproved ? styles.confirmationNoteApproved : styles.confirmationNoteRejected) }}>
          {confirmationText}
        </p>
      ) : (
        <DecisionActions labels={labels} disabled={disabled} onDecision={onDecision} />
      )}
    </article>
  )
}

function BookingReviewCard({
  booking,
  labels,
  lang,
  disabled,
  onDecision,
}: {
  booking: PlatformReviewBooking
  labels: { approve: string; reject: string; price: string; listing: string; details: string }
  lang: Lang
  disabled: boolean
  onDecision: (decision: 'APPROVE' | 'REJECT') => void
}) {
  const title = booking.listing ? listingTitleText(booking.listing, lang) : booking.id.slice(0, 8).toUpperCase()

  return (
    <article style={styles.card}>
      <span style={styles.status}>{statusText(booking.status, lang)}</span>
      <h3 style={styles.cardTitle}>{title}</h3>
      <div style={styles.meta}>
        <span>{labels.listing}</span>
        <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>{booking.listing?.division ? divisionText(booking.listing.division, lang) : booking.listingId.slice(0, 8).toUpperCase()}</strong>
      </div>
      <div style={styles.meta}>
        <span>{labels.price}</span>
        <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>{moneyText(booking.amountMinor, booking.currency, lang)}</strong>
      </div>
      <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/booking/${booking.id}`)}>
        {labels.details}
      </button>
      <DecisionActions labels={labels} disabled={disabled} onDecision={onDecision} />
    </article>
  )
}

function GiftReviewCard({
  gift,
  labels,
  lang,
  disabled,
  onDecision,
}: {
  gift: PlatformWalletGift
  labels: { approve: string; reject: string; price: string; details: string }
  lang: Lang
  disabled: boolean
  onDecision: (decision: 'APPROVE' | 'REJECT') => void
}) {
  return (
    <article style={styles.card}>
      <span style={styles.status}>{statusText(gift.status, lang)}</span>
      <h3 style={styles.cardTitle}>{gift.message || gift.id.slice(0, 8).toUpperCase()}</h3>
      <div style={styles.meta}>
        <span>{labels.price}</span>
        <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>{moneyText(gift.amountMinor, gift.currency, lang)}</strong>
      </div>
      <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/wallet/gift/claim/${gift.id}`)}>
        {labels.details}
      </button>
      <DecisionActions labels={labels} disabled={disabled} onDecision={onDecision} />
    </article>
  )
}

function DecisionActions({
  labels,
  disabled,
  onDecision,
}: {
  labels: { approve: string; reject: string }
  disabled: boolean
  onDecision: (decision: 'APPROVE' | 'REJECT') => void
}) {
  return (
    <div style={styles.actions}>
      <button disabled={disabled} style={styles.primaryButton} onClick={() => onDecision('APPROVE')}>
        {labels.approve}
      </button>
      <button disabled={disabled} style={styles.dangerButton} onClick={() => onDecision('REJECT')}>
        {labels.reject}
      </button>
    </div>
  )
}

function AuditLogCard({
  entry,
  labels,
  lang,
}: {
  entry: PlatformAdminAuditLog
  labels: { actor: string; entity: string; details: string }
  lang: Lang
}) {
  const date = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SY' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(entry.createdAt))
  const actorName = entry.actor?.displayName || entry.actor?.email || entry.actorUserId?.slice(0, 8) || (lang === 'ar' ? 'النظام' : 'System')
  const detailRoute = auditDetailRoute(entry)

  return (
    <article style={styles.auditCard}>
      <div style={styles.auditHeader}>
        <strong>{auditActionText(entry.action, lang)}</strong>
        <span>{date}</span>
      </div>
      <div style={styles.meta}>
        <span>{labels.entity}</span>
        <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {auditEntityText(entry.entityType, lang)} / {entry.entityId.slice(0, 8).toUpperCase()}
        </strong>
      </div>
      <div style={styles.meta}>
        <span>{labels.actor}</span>
        <strong>{actorName}</strong>
      </div>
      {detailRoute && (
        <button style={styles.secondaryButton} onClick={() => (window.location.hash = detailRoute)}>
          {labels.details}
        </button>
      )}
    </article>
  )
}

function auditActionText(action: string, lang: Lang) {
  const labels: Record<string, Record<Lang, string>> = {
    APPROVE: { ar: 'موافقة', en: 'Approve' },
    APPROVED: { ar: 'تمت الموافقة', en: 'Approved' },
    REJECT: { ar: 'رفض', en: 'Reject' },
    REJECTED: { ar: 'تم الرفض', en: 'Rejected' },
    CREATE: { ar: 'إنشاء', en: 'Create' },
    CREATED: { ar: 'تم الإنشاء', en: 'Created' },
    BOOKING_CONFIRMED: { ar: 'تم تأكيد الحجز', en: 'Booking confirmed' },
    BOOKING_DISPUTED: { ar: 'تم فتح نزاع للحجز', en: 'Booking disputed' },
    DRIVER_ARRIVING: { ar: 'السائق في الطريق', en: 'Driver arriving' },
    DRIVER_ASSIGNED: { ar: 'تم تعيين السائق', en: 'Driver assigned' },
    DRIVER_COMPLETED: { ar: 'تم إنهاء الرحلة', en: 'Driver completed' },
    DRIVER_DRIVER_ARRIVING: { ar: 'السائق في الطريق', en: 'Driver arriving' },
    DRIVER_IN_PROGRESS: { ar: 'الرحلة قيد التنفيذ', en: 'Driver in progress' },
    HOST_CONFIRMED: { ar: 'أكد المضيف الطلب', en: 'Host confirmed' },
    HOST_LISTING_APPROVED: { ar: 'تم قبول إعلان المضيف', en: 'Host listing approved' },
    HOST_LISTING_PAUSED: { ar: 'تم إيقاف إعلان المضيف', en: 'Host listing paused' },
    PAYMENT_APPROVED: { ar: 'تم قبول الدفع', en: 'Payment approved' },
    PAYMENT_REJECTED: { ar: 'تم رفض الدفع', en: 'Payment rejected' },
    REVIEW_APPROVED: { ar: 'تمت الموافقة في المراجعة', en: 'Review approved' },
    REVIEW_REJECTED: { ar: 'تم الرفض في المراجعة', en: 'Review rejected' },
    RIDE_REQUESTED: { ar: 'تم طلب رحلة', en: 'Ride requested' },
    SR_DRIVER_ASSIGNED: { ar: 'تم تعيين سائق SR', en: 'SR driver assigned' },
    UPDATE: { ar: 'تحديث', en: 'Update' },
    UPDATED: { ar: 'تم التحديث', en: 'Updated' },
  }
  return labels[action]?.[lang] || (lang === 'ar' ? action.replace(/_/g, ' ') : action.replace(/_/g, ' '))
}

function auditEntityText(entityType: string, lang: Lang) {
  const labels: Record<string, Record<Lang, string>> = {
    booking: { ar: 'حجز', en: 'Booking' },
    bookings: { ar: 'حجوزات', en: 'Bookings' },
    gift: { ar: 'هدية', en: 'Gift' },
    gifts: { ar: 'هدايا', en: 'Gifts' },
    listing: { ar: 'إعلان', en: 'Listing' },
    listings: { ar: 'إعلانات', en: 'Listings' },
    payment: { ar: 'دفع', en: 'Payment' },
    payments: { ar: 'مدفوعات', en: 'Payments' },
    payment_proofs: { ar: 'إثبات دفع', en: 'Payment proof' },
    ride_requests: { ar: 'رحلات', en: 'Ride requests' },
  }
  return labels[entityType.toLowerCase()]?.[lang] || entityType.replace(/_/g, ' ')
}

function auditDetailRoute(entry: PlatformAdminAuditLog) {
  const entityType = entry.entityType.toLowerCase()
  if (entityType === 'listings' || entityType === 'listing') return `/listing/${entry.entityId}`
  if (entityType === 'bookings' || entityType === 'booking') return `/booking/${entry.entityId}`
  if (entityType === 'payments' || entityType === 'payment' || entityType === 'payment_proofs') return `/payment/receipt/${entry.entityId}`
  if (entityType === 'ride_requests') return '/driver'
  return ''
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1040, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118' },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: '6px 0', fontSize: 36, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, maxWidth: 720, lineHeight: 1.6 },
  heroActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 },
  secondaryButton: { minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', padding: '0 14px', fontWeight: 900 },
  tools: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 12, display: 'grid', gap: 10 },
  searchInput: { minHeight: 46, border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: '0 14px', fontWeight: 900 },
  filters: { display: 'flex', gap: 8, overflowX: 'auto' },
  filterButton: { minHeight: 40, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', padding: '0 12px', fontWeight: 900, whiteSpace: 'nowrap' },
  filterActive: { minHeight: 40, border: 0, borderRadius: 8, background: '#20d29b', color: '#07110e', padding: '0 12px', fontWeight: 950, whiteSpace: 'nowrap' },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', display: 'grid', gap: 4, padding: 14 },
  section: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 14 },
  sectionTitle: { fontSize: 22, margin: '0 0 12px' },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  empty: { color: '#9aa6ba', margin: 0 },
  card: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 14, display: 'grid', gap: 10 },
  auditCard: { border: '1px solid #30384d', borderRadius: 8, background: '#0f1524', padding: 14, display: 'grid', gap: 10 },
  auditHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#f7d45f', fontSize: 13 },
  status: { color: '#20d29b', fontSize: 12, fontWeight: 900 },
  cardTitle: { margin: 0, fontSize: 20, lineHeight: 1.15 },
  cardBody: { color: '#9aa6ba', margin: 0, lineHeight: 1.55 },
  meta: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#20d29b', color: '#07110e', fontWeight: 950 },
  dangerButton: { minHeight: 44, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 950 },
  moneyReceivedWarning: { border: '1px solid rgba(255,204,0,.34)', borderRadius: 8, background: 'rgba(255,204,0,.08)', color: '#ffe381', fontWeight: 900, lineHeight: 1.45, margin: 0, padding: '10px 12px' },
  confirmationNote: { borderRadius: 8, margin: 0, padding: '12px 14px', fontWeight: 950, textAlign: 'center' },
  confirmationNoteApproved: { background: 'rgba(32,210,155,.12)', border: '1px solid rgba(32,210,155,.45)', color: '#77ffd7' },
  confirmationNoteRejected: { background: 'rgba(255,96,96,.12)', border: '1px solid rgba(255,96,96,.45)', color: '#ffd1d1' },
}
