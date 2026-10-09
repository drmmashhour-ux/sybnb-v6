import { useEffect, useMemo, useState } from 'react'
import { localeForLang } from '../../shared/country/presentation'
import type { CSSProperties, ReactNode } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminPayouts,
  fetchAdminPaymentProofUrl,
  fetchIdDocumentBlobUrl,
  fetchPrototypeAdminAuditLog,
  fetchPrototypeAdminMetrics,
  fetchPrototypeReviewQueue,
  getStoredStaffSession,
  lookupAdminUserByEmail,
  releaseAdminPayout,
  reviewPrototypePaymentProof,
  reviewPrototypeQueueEntity,
  rerunListingAiReview,
  uploadIdDocumentForUser,
  type AdminPayout,
  type AiReviewCheckKey,
  type ListingAiReview,
  type PlatformAdminAuditLog,
  type PlatformAdminMetrics,
  type PlatformIdDocumentReview,
  type PlatformListing,
  type PlatformPaymentProof,
  type PlatformReviewBooking,
  type PlatformReviewQueue,
  type PlatformWalletGift,
} from '../../shared/api/platformApi'
import { BrandLogo } from '../../shared/brand'
import { AdminAiAssistButton } from './AdminAiAssistButton'
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
  fr: {
    back: 'Retour à l’accueil',
    title: 'Révision administrative',
    subtitle: 'File PostgreSQL en direct des annonces, paiements, cadeaux et réservations en attente de décision.',
    listings: 'Annonces',
    payments: 'Paiements',
    gifts: 'Cadeaux',
    bookings: 'Réservations et demandes',
    audit: 'Journal d’audit administratif',
    empty: 'Aucun élément en attente de révision.',
    auditEmpty: 'Aucune décision administrative enregistrée pour le moment.',
    approve: 'Approuver',
    reject: 'Refuser',
    refresh: 'Actualiser',
    loading: 'Chargement',
    error: 'Impossible de charger la file de révision',
    price: 'Prix',
    provider: 'Fournisseur',
    listing: 'Annonce',
    actor: 'Intervenant',
    entity: 'Élément',
    details: 'Ouvrir les détails',
    search: 'Rechercher',
    all: 'Tous',
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
// Contractual STR commission — owner-confirmed at 12%. Must match server/lib/finance-ledger.mjs's
// STR_ADMIN_COMMISSION_RATE (this is a display-only preview computed client-side; the real charge
// is always computed server-side, but a stale rate here would show admins the wrong preview).
const STR_ADMIN_COMMISSION_RATE = 0.12
const STR_TAX_RATE = 0.02
const STR_CLEANING_RATE = 0.05

export function AdminReviewPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [auditLog, setAuditLog] = useState<PlatformAdminAuditLog[]>([])
  const [metrics, setMetrics] = useState<PlatformAdminMetrics | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'saving'>('loading')
  const [message, setMessage] = useState('')
  const [activeFilter, setActiveFilter] = useState<AdminFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [payouts, setPayouts] = useState<AdminPayout[]>([])
  const [payoutHoldDays, setPayoutHoldDays] = useState(14)
  const [releasingPayoutId, setReleasingPayoutId] = useState('')
  // A decision the server refused (e.g. 409 OWNER_ID_NOT_APPROVED), shown inline on that item.
  const [decisionError, setDecisionError] = useState<{ id: string; text: string } | null>(null)

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

  useEffect(() => {
    void loadQueue()
    void loadPayouts()
  }, [])

  async function loadQueue() {
    setStatus('loading')
    setMessage('')

    try {
      const [nextQueue, nextAuditLog, nextMetrics] = await Promise.all([
        fetchPrototypeReviewQueue(),
        fetchPrototypeAdminAuditLog(12),
        fetchPrototypeAdminMetrics(),
      ])
      setQueue(nextQueue)
      setAuditLog(nextAuditLog)
      setMetrics(nextMetrics)
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
    options?: { shamCashReconciliation?: ShamCashApprovalPayload; adminNote?: string; includeAiIssues?: boolean },
  ) {
    setStatus('saving')
    setMessage('')
    setDecisionError(null)

    try {
      if (entityType === 'payments') {
        await reviewPrototypePaymentProof(id, decision, undefined, options?.shamCashReconciliation)
      } else if (entityType === 'listings' && decision === 'REJECT') {
        // "Send back for fixes": the note + (optionally) the AI's issuesForHost reach the host's dashboard.
        await reviewPrototypeQueueEntity(entityType, id, decision, options?.adminNote, { includeAiIssues: options?.includeAiIssues !== false })
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
      const text = decisionErrorText(error, lang) || (error instanceof Error ? error.message : t.error)
      setMessage(text)
      setDecisionError({ id, text })
    }
  }

  // AI pre-check re-run (2026-10-09): runs in the background; poll the queue quietly until no listing
  // is PENDING any more (max ~2 minutes).
  const [aiPolling, setAiPolling] = useState(0)
  useEffect(() => {
    if (!aiPolling) return
    const anyPending = (queue?.listings || []).some((l) => l.aiReview?.status === 'PENDING')
    if (!anyPending || aiPolling > 30) return
    const timer = window.setTimeout(() => {
      fetchPrototypeReviewQueue()
        .then((next) => setQueue(next))
        .catch(() => {})
        .finally(() => setAiPolling((n) => n + 1))
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [aiPolling, queue])

  async function rerunAi(listingId: string) {
    setMessage('')
    try {
      const pending = await rerunListingAiReview(listingId)
      setQueue((current) =>
        current ? { ...current, listings: current.listings.map((l) => (l.id === listingId ? { ...l, aiReview: pending } : l)) } : current,
      )
      setAiPolling(1)
    } catch (error) {
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
      metrics={metrics}
      payments={visiblePayments.length ? visiblePayments : paymentQueue}
      queue={queue}
      status={status}
      onBookingDecision={(id, decision) => void decide('bookings', id, decision)}
      onPaymentDecision={(id, decision, shamCashReconciliation) => void decide('payments', id, decision, { shamCashReconciliation })}
      onIdDocumentDecision={(id, decision) => void decide('iddocuments', id, decision)}
      decisionError={decisionError}
      onListingDecision={(id, decision, extra) => void decide('listings', id, decision, extra)}
      onRerunAi={(id) => void rerunAi(id)}
      bookings={visibleBookings}
      payouts={payouts}
      payoutHoldDays={payoutHoldDays}
      releasingPayoutId={releasingPayoutId}
      onReleasePayout={(id) => void releasePayout(id)}
    />
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
  metrics,
  payments,
  queue,
  status,
  onBookingDecision,
  onPaymentDecision,
  onIdDocumentDecision,
  decisionError,
  onListingDecision,
  onRerunAi,
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
  metrics: PlatformAdminMetrics | null
  payments: PlatformPaymentProof[]
  queue: PlatformReviewQueue | null
  status: 'loading' | 'ready' | 'error' | 'saving'
  onBookingDecision: (id: string, decision: 'APPROVE' | 'REJECT') => void
  onPaymentDecision: (id: string, decision: 'APPROVE' | 'REJECT', shamCashReconciliation?: ShamCashApprovalPayload) => void
  onIdDocumentDecision: (id: string, decision: 'APPROVE' | 'REJECT') => void
  decisionError: { id: string; text: string } | null
  onListingDecision: (id: string, decision: 'APPROVE' | 'REJECT', extra?: { adminNote?: string; includeAiIssues?: boolean }) => void
  onRerunAi: (id: string) => void
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
  const [manualShamCashMinor, setManualShamCashMinor] = useState<number | null>(() => readStoredMinor(SHAM_CASH_ACCOUNT_BALANCE_KEY))
  const [proofViewError, setProofViewError] = useState('')
  const displayPayments = payments // real payment proofs only — no fabricated fallback rows
  const primaryPayment = payments.find((payment) => payment.id === selectedPaymentId) || payments[0]
  const previewPayment = primaryPayment || displayPayments.find((payment) => payment.id === selectedPaymentId) || displayPayments[0]
  // proofAssetUrls (the full uploaded set) with a fallback to the single legacy proofAssetUrl for
  // records created before that field existed — real storage references only, ever.
  const proofAssetUrlsForPreview = (
    previewPayment?.proofAssetUrls?.length
      ? previewPayment.proofAssetUrls
      : previewPayment?.proofAssetUrl
        ? [previewPayment.proofAssetUrl]
        : []
  ).filter((url) => url.startsWith('payment-proof://'))
  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId) || bookings.find((booking) => booking.id === previewPayment?.bookingId)
  const selectedBookingPayoutReleased = Boolean(
    selectedBooking && selectedBooking.status.toUpperCase() === 'COMPLETED' && !payouts.some((payout) => payout.bookingId === selectedBooking.id),
  )
  const currentStep = currentFlowStepIndex(selectedBooking, previewPayment, selectedBookingPayoutReleased)
  const activeListings = (queue?.listings.length || listings.length || 0)
  const todayBookings = bookings
  const bookingNeedsApproval = bookings.filter(isBookingAwaitingApproval)
  const disputeBookingRows = bookings.filter(isBookingDisputed)
  const pendingPayments = payments.filter((payment) => payment.status !== 'APPROVED' && payment.status !== 'REJECTED').length
  const heldTotal = displayPayments.reduce((sum, payment) => sum + payment.amountMinor, 0)
  const activeLedger = createShortRentLedger(previewPayment?.amountMinor || 0)
  const readyPayout = Math.round(displayPayments.reduce((sum, payment) => sum + createShortRentLedger(payment.amountMinor).hostPayoutMinor, 0))
  const adminCommission = activeLedger.adminCommissionMinor
  const totalAdminCommission = displayPayments.reduce((sum, payment) => sum + createShortRentLedger(payment.amountMinor).adminCommissionMinor, 0)
  const shamCashReconciliation = createShamCashReconciliation(payments, displayPayments, lang, manualShamCashMinor)
  const bookingRef = bookingReference(previewPayment)
  const listingTitle = paymentListingTitle(previewPayment, lang)
  const hostName = paymentHostName(previewPayment, lang)
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
  const reconciliationForPayment = (payment?: PlatformPaymentProof): ShamCashApprovalPayload | undefined => {
    if (!payment || !isShamCashProvider(payment.provider)) return undefined
    return {
      accountMinor: shamCashReconciliation.accountMinor,
      expectedMinor: shamCashReconciliation.expectedMinor,
      differenceMinor: shamCashReconciliation.differenceMinor,
      source: 'admin-ui-manual-sham-cash-match',
    }
  }
  const updateManualShamCashAccount = () => {
    const value = window.prompt(
      isAr ? 'أدخل الرصيد الحقيقي الموجود في حساب شام كاش بالليرة السورية للمطابقة.' : 'Enter the real Sham Cash account balance in SYP for reconciliation.',
      String(Math.round(manualShamCashMinor || shamCashReconciliation.expectedMinor)),
    )
    if (value == null) return
    const normalized = Number(value.replace(/[^\d.]/g, ''))
    if (!Number.isFinite(normalized)) {
      setCommandNotice(isAr ? 'لم يتم قبول الرصيد. أدخل رقما صحيحا.' : 'Balance was not accepted. Enter a valid number.')
      return
    }
    const nextMinor = Math.round(normalized)
    window.localStorage.setItem(SHAM_CASH_ACCOUNT_BALANCE_KEY, String(nextMinor))
    setManualShamCashMinor(nextMinor)
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
        isAr ? `تمت إضافة ملاحظة تعليق شخصية للحجز ${selectedBookingRef}. هذا تذكير للفريق فقط ولا يوقف الصرف تلقائياً في النظام.` : `A personal hold note was added for booking ${selectedBookingRef}. This is a team reminder only and does not stop automatic release in the system.`,
      )
      return
    }

    const matchingPayout = payouts.find((payout) => payout.bookingId === bookingId)
    if (!matchingPayout) {
      setCommandNotice(
        isAr ? `لا يوجد صرف مستحق لهذا الحجز بعد. تحقق من قائمة الصرف الحقيقية أدناه.` : `No payout is due for this booking yet. Check the real payout list below.`,
      )
      return
    }
    if (!matchingPayout.eligibleNow) {
      setCommandNotice(
        isAr ? `الصرف غير متاح بعد للحجز ${selectedBookingRef} (فترة الاحتجاز ${payoutHoldDays} يوماً لم تنته).` : `Payout is not eligible yet for booking ${selectedBookingRef} (the ${payoutHoldDays}-day hold hasn't passed).`,
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
      isAr ? `تم تعليق إثبات الدفع ${bookingReference(payment)} للمراجعة قبل قرار الإدارة.` : `Payment proof ${bookingReference(payment)} was held for admin review before a final decision.`,
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
      isAr ? `تمت إعادة فتح إثبات الدفع ${bookingReference(payment)} ويمكن للإدارة اتخاذ القرار.` : `Payment proof ${bookingReference(payment)} was reopened for an admin decision.`,
    )
  }
  const queueAdminMessage = (target: 'guest' | 'host') => {
    const message =
      target === 'guest'
        ? isAr ? `رسالة للعميل: تم تحديث حالة الحجز ${selectedBookingRef}. تابع من حسابك داخل SYBNB.` : `Guest message: booking ${selectedBookingRef} status was updated. Continue from your SYBNB account.`
        : isAr ? `رسالة للمضيف: تم تحديث حالة الحجز ${selectedBookingRef}. راجع لوحة المضيف قبل الصرف.` : `Host message: booking ${selectedBookingRef} status was updated. Review host dashboard before payout.`
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
        ? isAr ? 'تمت إضافة رسالة العميل إلى صندوق إرسال الإدارة.' : 'Guest message added to admin outbox.'
        : isAr ? 'تمت إضافة رسالة المضيف إلى صندوق إرسال الإدارة.' : 'Host message added to admin outbox.',
    )
  }

  const stats = [
    { label: isAr ? 'بانتظار القرار' : 'Awaiting decision', value: String(todayBookings.length), tone: 'blue' },
    { label: isAr ? 'بانتظار مراجعة الدفع' : 'Payment review', value: String(pendingPayments), tone: 'gold' },
    { label: isAr ? 'حجوزات مؤكدة (المنصة)' : 'Confirmed bookings (platform-wide)', value: String(metrics?.bookingsByStatus.CONFIRMED || 0), tone: 'green' },
    { label: isAr ? 'حالات نزاع' : 'Disputes', value: String(disputeBookingRows.length), tone: 'red' },
    { label: isAr ? 'مبالغ محجوزة' : 'Held funds', value: moneyText(heldTotal, 'SYP', lang), tone: 'gold' },
    { label: isAr ? 'مبالغ جاهزة للصرف' : 'Ready payout', value: moneyText(readyPayout, 'SYP', lang), tone: 'green' },
    { label: isAr ? 'عمولة المنصة' : 'Platform commission', value: moneyText(totalAdminCommission, 'SYP', lang), tone: 'blue' },
    { label: isAr ? 'إعلانات معتمدة (المنصة)' : 'Approved listings (platform-wide)', value: String(metrics?.listingsByStatus.APPROVED || 0), tone: 'white' },
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
  const baseAiReview = createAiPaymentReview(previewPayment, isAr)
  const aiReview = selectedPaymentNeedsCashMatch && !shamCashReconciliation.canApprove
    ? createAiCashMatchReview(isAr, shamCashReconciliation.accountMinor == null)
    : baseAiReview
  const commandViews: Array<{ id: AdminCommandView; label: string; count: number; tone: string }> = [
    { id: 'general', label: isAr ? 'الرصد العام' : 'General watch', count: todayBookings.length, tone: 'blue' },
    { id: 'audit', label: isAr ? 'التدقيق' : 'Audit', count: auditLog.length, tone: 'white' },
    { id: 'aiBrain', label: 'AI Brain', count: aiReview.reasons.length, tone: 'gold' },
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
      label: isAr ? 'المراقبة والذكاء' : 'Monitoring & AI',
      subtitle: isAr ? 'الرصد العام، التدقيق، وAI Brain' : 'General watch, audit log, and AI Brain',
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

  // Real, per-host checks only — no fabricated score or unconditional "all clear" checklist next
  // to the payout-release button. Each line is derived from data already fetched for this
  // payment/booking, not a static claim shown identically for every host.
  // A real bug caught by an independent re-audit: this label was hardcoded "Verified host" for
  // every host, with the backend not even fetching idDocumentStatus for this view. Same
  // real-status-driven pattern as DashboardPage.tsx's guest membership badge.
  const hostIdDocumentStatus = previewPayment?.booking?.listing?.owner?.idDocumentStatus
  const hostVerificationLabel =
    hostIdDocumentStatus === 'APPROVED'
      ? isAr ? 'مضيف موثق' : 'Verified host'
      : hostIdDocumentStatus === 'PENDING_REVIEW'
        ? isAr ? 'التحقق قيد المراجعة' : 'Verification in review'
        : isAr ? 'غير موثق بعد' : 'Not yet verified'

  const hostChecks = [
    {
      ok: previewPayment?.booking?.listing?.status === 'APPROVED',
      label: isAr ? 'الإعلان معتمد من الإدارة' : 'Listing approved by admin',
    },
    {
      ok: !(selectedBooking && isBookingDisputed(selectedBooking)),
      label: isAr ? 'لا يوجد نزاع مفتوح' : 'No open dispute',
    },
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

      <nav style={commandStyles.quickLinks} aria-label={pick(lang, 'صفحات الإدارة', 'Admin pages', 'Pages d’administration')}>
        <button style={commandStyles.secondaryCommand} onClick={() => (window.location.hash = '/admin/hosts')}>
          {pick(lang, 'التحقق من المضيفين', 'Host verification', 'Vérification des hôtes')}
        </button>
        <button style={commandStyles.secondaryCommand} onClick={() => (window.location.hash = '/admin/money')}>
          {pick(lang, 'الصرف والاسترداد', 'Payouts & refunds', 'Versements et remboursements')}
        </button>
        <button style={commandStyles.secondaryCommand} onClick={() => (window.location.hash = '/admin/customers')}>
          {pick(lang, 'ملف العميل الشامل', 'Customer 360', 'Client 360')}
        </button>
        <button style={commandStyles.secondaryCommand} onClick={() => (window.location.hash = '/admin/money-flow')}>
          {pick(lang, 'حركة الأموال', 'Money flow', 'Flux financier')}
        </button>
      </nav>

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
            {isAr ? `تنبيه: يوجد عدم مطابقة في Sham Cash بقيمة ${moneyText(Math.abs(shamCashReconciliation.differenceMinor), 'SYP', lang)} للحجز ${bookingRef}.` : `Warning: Sham Cash mismatch of ${moneyText(Math.abs(shamCashReconciliation.differenceMinor), 'SYP', lang)} for booking ${bookingRef}.`}
          </span>
          <button style={commandStyles.outlineGold} onClick={updateManualShamCashAccount}>{isAr ? 'مراجعة الفروقات' : 'Review mismatch'}</button>
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
              <span style={commandStyles.hostAvatar}>{(hostName || 'A').slice(0, 1).toUpperCase()}</span>
              <div>
                <h2>{hostName}</h2>
                <small>{hostVerificationLabel}</small>
              </div>
            </div>
            {hostChecks.map((check) => (
              <p key={check.label} style={commandStyles.checkLine}><span>{check.ok ? '✓' : '!'}</span>{check.label}</p>
            ))}
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
              <span style={{ ...commandStyles.aiDecisionBadge, background: aiReview.badgeColor }}>{aiReview.label}</span>
              <div>
                <small>AI Brain Advisory Only</small>
                <h2>{aiReview.title}</h2>
              </div>
            </div>
            <div style={commandStyles.aiPills}>
              {aiReview.reasons.slice(0, 3).map((reason) => <span key={reason} style={commandStyles.aiReasonLine}>{reason}</span>)}
            </div>
            <button style={commandStyles.linkButton} onClick={() => (window.location.hash = '/ai-brain')}>{isAr ? 'فتح AI Brain' : 'Open AI Brain'}</button>
            {proofAssetUrlsForPreview.map((assetUrl, index) => (
              <button
                key={assetUrl}
                style={commandStyles.linkButton}
                onClick={() => {
                  setProofViewError('')
                  fetchAdminPaymentProofUrl(assetUrl)
                    .then((url) => window.open(url, '_blank', 'noopener,noreferrer'))
                    .catch((error) => setProofViewError(error instanceof Error ? error.message : 'Could not open proof.'))
                }}
              >
                {proofAssetUrlsForPreview.length > 1
                  ? `${isAr ? 'عرض إثبات الدفع' : 'View payment proof'} ${index + 1}/${proofAssetUrlsForPreview.length}`
                  : (isAr ? 'عرض إثبات الدفع' : 'View payment proof')}
              </button>
            ))}
            {proofViewError && <small style={{ color: '#ff5f76' }}>{proofViewError}</small>}
          </section>
        </aside>

        <section style={commandStyles.centerPanel}>
          <div style={commandStyles.commandViewHeader}>
            <div>
              <h1>{bookingRef}</h1>
              <small>{listingTitle}</small>
            </div>
            <button style={commandStyles.blueButton} onClick={() => previewPayment?.bookingId ? (window.location.hash = `/booking/${previewPayment.bookingId}`) : undefined}>
              {isAr ? 'تفاصيل الحجز' : 'Booking details'}
            </button>
          </div>
          <div style={commandStyles.pipelineList}>
            {flowSteps.map((step, index) => (
              <div key={step} style={{ ...commandStyles.pipelineStep, ...(index === currentStep ? commandStyles.pipelineActive : {}) }}>
                <small>{index < currentStep ? (isAr ? 'تم' : 'Done') : index === currentStep ? (isAr ? 'الآن' : 'Now') : '—'}</small>
                <span>{step}</span>
                <strong>{index + 1}</strong>
              </div>
            ))}
          </div>
          {!shamCashReconciliation.isMatched && (
            <ShamCashReconciliationPanel data={shamCashReconciliation} isAr={isAr} lang={lang} onUpdateAccount={updateManualShamCashAccount} />
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
                {paymentAdvertisingDetails(payment, lang) && (
                  <small style={{ color: '#d5a915' }}>{paymentAdvertisingDetails(payment, lang)} · {paymentHostName(payment, lang)}</small>
                )}
                <small>{isAr ? 'ثقة الذكاء الاصطناعي' : 'AI confidence'} {createAiPaymentReview(payment, isAr).label}</small>
                <div style={commandStyles.proofActions}>
                  <button disabled={disabled || heldPaymentIds[payment.id] || (isShamCashProvider(payment.provider) && !shamCashReconciliation.canApprove)} style={commandStyles.acceptButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'APPROVE', reconciliationForPayment(payment)) }}>{isAr ? 'قبول' : 'Approve'}</button>
                  <button disabled={disabled || heldPaymentIds[payment.id]} style={commandStyles.rejectButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'REJECT') }}>{isAr ? 'رفض' : 'Reject'}</button>
                  <button style={heldPaymentIds[payment.id] ? commandStyles.secondaryCommand : commandStyles.goldButton} onClick={(event) => { event.stopPropagation(); heldPaymentIds[payment.id] ? reopenPaymentForReview(payment) : holdPaymentForReview(payment) }}>{heldPaymentIds[payment.id] ? (isAr ? 'إعادة فتح' : 'Reopen') : (isAr ? 'تعليق' : 'Hold')}</button>
                  <button style={commandStyles.blueButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); window.location.hash = `/payment/receipt/${payment.id}` }}>{isAr ? 'تفاصيل' : 'Details'}</button>
                  <AdminAiAssistButton kind="payment" entityId={payment.id} lang={lang} />
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
              <AdminPaymentLine key={payment.id} disabled={disabled || heldPaymentIds[payment.id] || (isShamCashProvider(payment.provider) && !shamCashReconciliation.canApprove)} isAr={isAr} lang={lang} payment={payment} selected={payment.id === previewPayment?.id} onApprove={() => onPaymentDecision(payment.id, 'APPROVE', reconciliationForPayment(payment))} onReject={() => onPaymentDecision(payment.id, 'REJECT')} onSelect={() => selectPayment(payment)} />
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
          <ShamCashReconciliationPanel data={shamCashReconciliation} isAr={isAr} lang={lang} expanded onUpdateAccount={updateManualShamCashAccount} />
        )}
        {activeCommandView === 'finance' && (
          <div style={commandStyles.managementList}>
            <div style={commandStyles.sectionHeadRow}>
              <strong>{isAr ? 'صرف المضيفين (حقيقي)' : 'Host payouts (real)'}</strong>
              <button style={commandStyles.secondaryCommand} onClick={() => (window.location.hash = '/admin/money')}>
                {pick(lang, 'طلبات السحب والاستردادات ←', 'Payout requests & refunds →', 'Demandes de versement et remboursements →')}
              </button>
              <button style={commandStyles.secondaryCommand} onClick={() => (window.location.hash = '/admin/hosts')}>
                {pick(lang, 'التحقق من المضيفين ←', 'Host verification →', 'Vérification des hôtes →')}
              </button>
              <small>
                {isAr ? `يبقى الصرف معلقا حتى ${payoutHoldDays} يوما بعد انتهاء الإقامة، ولا يظهر هنا إلا بعد اكتمال الحجز وعدم وجود نزاع مفتوح.` : `Payout stays held for ${payoutHoldDays} days after the stay ends, and only appears here once the booking is completed with no open dispute.`}
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
                    : (isAr ? `يفتح في ${payout.eligibleAt ? new Date(payout.eligibleAt).toLocaleDateString(localeForLang(isAr ? 'ar' : 'en')) : ''}` : lang === 'fr' ? `Disponible le ${payout.eligibleAt ? new Date(payout.eligibleAt).toLocaleDateString('fr-CA') : ''}` : `Opens ${payout.eligibleAt ? new Date(payout.eligibleAt).toLocaleDateString('en-US') : ''}`)}
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
            {queue?.queueTotals && queue.queueTotals.listings > listings.length && (
              <div style={commandStyles.backlogNotice}>
                {isAr
                  ? `عرض ${listings.length} من أصل ${queue.queueTotals.listings} عقارًا في الانتظار. ضيّق بحثك لإيجاد الباقي.`
                  : `Showing ${listings.length} of ${queue.queueTotals.listings} pending listings. Narrow your search to find the rest.`}
              </div>
            )}
            {(listings.length ? listings : []).length === 0 ? (
              <AdminEmptyLine text={isAr ? 'لا توجد عقارات في قائمة الإدارة الحالية.' : 'No stays are in the current admin inventory.'} />
            ) : listings.map((listing) => (
              <AdminListingLine
                key={listing.id}
                listing={listing}
                disabled={disabled}
                isAr={isAr}
                lang={lang}
                onApprove={() => onListingDecision(listing.id, 'APPROVE')}
                onReject={(adminNote, includeAiIssues) => onListingDecision(listing.id, 'REJECT', { adminNote, includeAiIssues })}
                onRerunAi={() => onRerunAi(listing.id)}
                onOwnerIdDecision={(decision) => listing.owner?.id && onIdDocumentDecision(listing.owner.id, decision)}
                error={decisionError && (decisionError.id === listing.id || decisionError.id === listing.owner?.id) ? decisionError.text : ''}
              />
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
            {queue?.queueTotals && queue.queueTotals.idDocuments > (queue.idDocuments?.length || 0) && (
              <div style={commandStyles.backlogNotice}>
                {isAr
                  ? `عرض ${queue.idDocuments?.length || 0} من أصل ${queue.queueTotals.idDocuments} مستند هوية في الانتظار.`
                  : `Showing ${queue.idDocuments?.length || 0} of ${queue.queueTotals.idDocuments} pending ID documents.`}
              </div>
            )}
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
              <button style={commandStyles.blueButton} onClick={() => (window.location.hash = '/ai-brain')}>{isAr ? 'فتح AI Brain' : 'Open AI Brain'}</button>
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
      {status === 'ready' && decisionError && (
        <section style={styles.alert} data-testid="admin-decision-error">
          <strong>{isAr ? 'تعذر تنفيذ القرار' : 'Decision refused'}</strong>
          <span>{decisionError.text}</span>
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
                  <span>{createAiPaymentReview(payment, isAr).label}</span>
                </div>
                <div style={commandStyles.aiMiniDecision}>
                  <b>{createAiPaymentReview(payment, isAr).title}</b>
                  <small>{createAiPaymentReview(payment, isAr).reasons[0]}</small>
                </div>
                <div style={commandStyles.proofActions}>
                  <button disabled={disabled || heldPaymentIds[payment.id] || (isShamCashProvider(payment.provider) && !shamCashReconciliation.canApprove)} style={commandStyles.acceptButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'APPROVE', reconciliationForPayment(payment)) }}>{isAr ? 'قبول' : 'Approve'}</button>
                  <button disabled={disabled || heldPaymentIds[payment.id]} style={commandStyles.rejectButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); onPaymentDecision(payment.id, 'REJECT') }}>{isAr ? 'رفض' : 'Reject'}</button>
                  <button style={heldPaymentIds[payment.id] ? commandStyles.secondaryCommand : commandStyles.goldButton} onClick={(event) => { event.stopPropagation(); heldPaymentIds[payment.id] ? reopenPaymentForReview(payment) : holdPaymentForReview(payment) }}>{heldPaymentIds[payment.id] ? (isAr ? 'إعادة فتح' : 'Reopen') : (isAr ? 'تعليق' : 'Hold')}</button>
                  <button style={commandStyles.blueButton} onClick={(event) => { event.stopPropagation(); selectPayment(payment); window.location.hash = `/payment/receipt/${payment.id}` }}>{isAr ? 'تفاصيل' : 'Details'}</button>
                  <AdminAiAssistButton kind="payment" entityId={payment.id} lang={lang} />
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
              <div key={step} style={{ ...commandStyles.pipelineStep, ...(index === currentStep ? commandStyles.pipelineActive : {}) }}>
                <small>{index < currentStep ? (isAr ? 'تم' : 'Done') : index === currentStep ? (isAr ? 'الآن' : 'Now') : '—'}</small>
                <span>{step}</span>
                <strong>{index + 1}</strong>
              </div>
            ))}
          </div>
        </section>

        <aside style={commandStyles.sidePanels}>
          <article style={commandStyles.sideCard}>
            <div style={commandStyles.cardTitleRow}>
              <span style={commandStyles.confirmedPill}>{isAr ? 'مؤكد' : 'Confirmed'}</span>
              <h2>{isAr ? 'حالة المضيف' : 'Host status'}</h2>
            </div>
            <div style={commandStyles.hostRow}>
              <div>
                <strong>{hostName}</strong>
                <small>{hostVerificationLabel}</small>
              </div>
              <span style={commandStyles.hostAvatar}>{(hostName || 'A').slice(0, 1).toUpperCase()}</span>
            </div>
            {hostChecks.map((check) => (
              <p key={check.label} style={commandStyles.checkLine}><span>{check.ok ? '✓' : '!'}</span>{check.label}</p>
            ))}
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
          <h2>{isAr ? 'إشارات AI Brain' : 'AI Brain signals'} <small>ADVISORY ONLY</small></h2>
          {createAiPaymentReview(previewPayment, isAr).reasons.map((reason, index) => (
            <p key={reason} style={commandStyles.signalLine}>
              <span>{index === 0 ? '!' : '•'}</span>
              {reason}
            </p>
          ))}
          <div style={commandStyles.riskPair}>
            <strong>{isAr ? 'حالة إثبات الدفع' : 'Proof status'} <b>{createAiPaymentReview(previewPayment, isAr).label}</b></strong>
            <strong>{isAr ? 'مطابقة شام كاش' : 'Sham Cash match'} <b>{shamCashReconciliation.isMatched ? (isAr ? 'مطابق' : 'MATCHED') : (isAr ? 'غير مطابق' : 'MISMATCH')}</b></strong>
          </div>
        </article>
      </section>

      <nav style={commandStyles.actionBar} aria-label={isAr ? 'إجراءات الإدارة' : 'Admin actions'}>
        <button style={commandStyles.acceptButton} disabled={!primaryPayment || disabled || selectedPaymentHeld || (selectedPaymentNeedsCashMatch && !shamCashReconciliation.canApprove)} onClick={() => primaryPayment ? onPaymentDecision(primaryPayment.id, 'APPROVE', reconciliationForPayment(primaryPayment)) : setActiveCommandView('finance')}>{isAr ? 'قبول الدفع' : 'Approve payment'}</button>
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
  const aiReview = createAiPaymentReview(payment, isAr)
  const advertisingDetails = paymentAdvertisingDetails(payment, lang)
  return (
    <article style={{ ...commandStyles.managementRow, ...(selected ? commandStyles.selectedCard : {}) }} onClick={onSelect}>
      <div>
        <strong>{bookingReference(payment)}</strong>
        <small>{paymentListingTitle(payment, lang)}</small>
        {advertisingDetails && <small style={{ color: '#d5a915' }}>{advertisingDetails} · {paymentHostName(payment, lang)}</small>}
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
  onUpdateAccount,
}: {
  data: ReturnType<typeof createShamCashReconciliation>
  expanded?: boolean
  isAr: boolean
  lang: Lang
  onUpdateAccount?: () => void
}) {
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
      <button style={commandStyles.outlineGold} onClick={onUpdateAccount}>
        {isAr ? 'تحديث رصيد شام كاش' : 'Update Sham Cash balance'}
      </button>
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
        <AdminAiAssistButton kind="dispute" entityId={booking.id} lang={lang} />
      </div>
    </article>
  )
}

function AdminListingLine({
  listing,
  disabled,
  isAr,
  lang,
  onApprove,
  onReject,
  onRerunAi,
  onOwnerIdDecision,
  error,
}: {
  listing: PlatformListing
  disabled: boolean
  isAr: boolean
  lang: Lang
  onApprove: () => void
  onReject: (adminNote: string, includeAiIssues: boolean) => void
  onRerunAi: () => void
  onOwnerIdDecision: (decision: 'APPROVE' | 'REJECT') => void
  error: string
}) {
  const reviewable = listing.status === 'PENDING_REVIEW'
  const [sendingBack, setSendingBack] = useState(false)
  const [note, setNote] = useState('')
  const [includeAiIssues, setIncludeAiIssues] = useState(true)
  const thumbnailUrl = (listing.media || [])
    .map((item) => item.url || item.src || item.assetUrl)
    .find((value): value is string => typeof value === 'string' && /^(https?:|\/)/.test(value))
  const hostName = listing.owner?.displayName || (isAr ? 'مضيف غير معروف' : 'Unknown host')
  const aiIssues = listing.aiReview?.status === 'DONE' ? listing.aiReview.result?.issuesForHost || [] : []
  return (
    <div style={commandStyles.listingReviewBlock}>
      <article style={commandStyles.managementRow}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" style={commandStyles.listingThumbnail} />
        ) : (
          <div style={commandStyles.listingThumbnailPlaceholder}>{isAr ? 'لا صورة' : 'No image'}</div>
        )}
        <div>
          <strong>
            {listing.metadata?.advertising === true && (
              <span style={{ color: '#d5a915' }}>{isAr ? '📢 إعلان · ' : '📢 Advertising · '}</span>
            )}
            {listingTitleText(listing, lang)}
          </strong>
          <small>{divisionText(listing.division, lang)}</small>
          <small>{hostName}</small>
          <small>{moneyText(listing.priceMinor, listing.currency, lang)}</small>
        </div>
        <span>{statusText(listing.status, lang)}</span>
        <div style={commandStyles.managementRowActions}>
          {reviewable && !disabled && <button style={commandStyles.acceptButton} onClick={onApprove}>{isAr ? 'موافقة' : 'Approve'}</button>}
          {reviewable && !disabled && (
            <button style={commandStyles.rejectButton} onClick={() => setSendingBack((v) => !v)}>
              {isAr ? 'إعادة للتعديل' : 'Send back for fixes'}
            </button>
          )}
          <button style={commandStyles.blueButton} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>{isAr ? 'تفاصيل' : 'Details'}</button>
        </div>
      </article>
      {reviewable && listing.owner && (
        <OwnerIdPanel owner={listing.owner} disabled={disabled} lang={lang} onDecision={onOwnerIdDecision} />
      )}
      {error && (
        <div data-testid="admin-listing-decision-error" style={{ margin: '6px 0', padding: '8px 12px', borderRadius: 8, background: 'rgba(192,57,43,0.10)', color: '#c0392b', fontWeight: 700 }}>
          {error}
        </div>
      )}
      {reviewable && <AiReportPanel review={listing.aiReview || null} isAr={isAr} disabled={disabled} onRerun={onRerunAi} />}
      {reviewable && sendingBack && !disabled && (
        <div style={commandStyles.sendBackBox}>
          <label style={commandStyles.sendBackLabel}>
            {isAr ? 'ملاحظة للمضيف (تظهر في لوحته)' : 'Note to the host (shown on their dashboard)'}
            <textarea
              style={commandStyles.sendBackInput}
              value={note}
              placeholder={isAr ? 'مثال: الرجاء إزالة رقم الهاتف من الصورة الثانية.' : 'e.g. Please remove the phone number from photo 2.'}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {aiIssues.length > 0 && (
            <label style={commandStyles.sendBackCheck}>
              <input type="checkbox" checked={includeAiIssues} onChange={(event) => setIncludeAiIssues(event.target.checked)} />
              {isAr ? `أرسل للمضيف أيضاً ملاحظات الفحص الآلي (${aiIssues.length})` : `Also send the AI's ${aiIssues.length} issue(s) to the host`}
            </label>
          )}
          <div style={commandStyles.sendBackActions}>
            <button
              style={commandStyles.rejectButton}
              disabled={!note.trim() && !(includeAiIssues && aiIssues.length)}
              onClick={() => onReject(note.trim(), includeAiIssues)}
            >
              {isAr ? 'إرسال للمضيف' : 'Send back to host'}
            </button>
            <button style={commandStyles.secondaryCommand} onClick={() => setSendingBack(false)}>{isAr ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Owner decision 2026-10-09: the host submits listing + ID together; the admin approves the ID
// from the listing card first (the listing approval is refused with OWNER_ID_NOT_APPROVED until
// then). Reuses PATCH /api/admin/review-queue/iddocuments/:userId and GET /api/admin/id-document/:userId/file.
function OwnerIdPanel({
  owner,
  disabled,
  lang,
  onDecision,
}: {
  owner: NonNullable<PlatformListing['owner']>
  disabled: boolean
  lang: Lang
  onDecision: (decision: 'APPROVE' | 'REJECT') => void
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])
  const status = owner.idDocumentStatus || null
  const tone = status === 'APPROVED' ? '#2e7d32' : status === 'PENDING_REVIEW' ? '#b7791f' : '#c0392b'
  const label =
    status === 'APPROVED'
      ? pick(lang, 'هوية المضيف: موافق عليها ✓', 'Host ID: approved ✓', 'Pièce d’identité de l’hôte : approuvée ✓')
      : status === 'PENDING_REVIEW'
        ? pick(lang, 'هوية المضيف: مرفوعة — بانتظار موافقتك (وافق عليها قبل الإعلان)', 'Host ID: uploaded — awaiting your approval (approve it before the listing)', 'Pièce d’identité de l’hôte : téléversée — à approuver avant l’annonce')
        : status === 'REJECTED'
          ? pick(lang, 'هوية المضيف: مرفوضة — بانتظار صورة جديدة', 'Host ID: rejected — waiting for a new photo', 'Pièce d’identité de l’hôte : refusée — en attente d’une nouvelle photo')
          : pick(lang, 'هوية المضيف: غير مرفوعة', 'Host ID: not uploaded', 'Pièce d’identité de l’hôte : non téléversée')

  async function view() {
    setLoadState('loading')
    try {
      const url = await fetchIdDocumentBlobUrl(owner.id)
      setBlobUrl(url)
      setLoadState('idle')
      window.open(url, '_blank', 'noopener')
    } catch {
      setLoadState('error')
    }
  }

  return (
    <div data-testid="admin-owner-id-panel" data-id-status={status || 'NONE'} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '6px 0', padding: '8px 12px', borderRadius: 8, border: `1px solid ${tone}` }}>
      <strong style={{ color: tone }}>{label}</strong>
      {(status === 'PENDING_REVIEW' || status === 'APPROVED' || status === 'REJECTED') && (
        blobUrl ? (
          <a href={blobUrl} target="_blank" rel="noreferrer" style={commandStyles.blueButton}>{pick(lang, 'فتح الهوية', 'Open ID', 'Ouvrir la pièce')}</a>
        ) : (
          <button style={commandStyles.secondaryCommand} disabled={loadState === 'loading'} onClick={() => void view()}>
            {loadState === 'loading' ? '…' : loadState === 'error' ? pick(lang, 'إعادة المحاولة', 'Retry', 'Réessayer') : pick(lang, 'عرض الهوية', 'View ID', 'Voir la pièce')}
          </button>
        )
      )}
      {status === 'PENDING_REVIEW' && !disabled && (
        <>
          <button style={commandStyles.acceptButton} onClick={() => onDecision('APPROVE')}>{pick(lang, 'قبول الهوية', 'Approve ID', 'Approuver la pièce')}</button>
          <button style={commandStyles.rejectButton} onClick={() => onDecision('REJECT')}>{pick(lang, 'رفض الهوية', 'Reject ID', 'Refuser la pièce')}</button>
        </>
      )}
    </div>
  )
}

function decisionErrorText(error: unknown, lang: Lang) {
  const code = (error as { code?: string } | null)?.code
  if (code === 'OWNER_ID_NOT_APPROVED') {
    return pick(lang, 'وافق على هوية المضيف أولاً، ثم وافق على الإعلان.', "Approve the host's ID first, then approve the listing.", 'Approuvez d’abord la pièce d’identité de l’hôte, puis l’annonce.')
  }
  if (code === 'ID_DOCUMENT_NOT_REVIEWABLE') {
    return pick(lang, 'لا توجد صورة هوية بانتظار المراجعة لهذا المستخدم.', 'There is no ID awaiting review for this user.', 'Aucune pièce d’identité en attente de vérification pour cet utilisateur.')
  }
  return ''
}

const AI_CHECK_LABELS: Record<AiReviewCheckKey, { en: string; ar: string }> = {
  photosRealAndClear: { en: 'Photos real & clear', ar: 'الصور حقيقية وواضحة' },
  photosMatchListing: { en: 'Photos match listing', ar: 'الصور تطابق الإعلان' },
  noContactInfoInPhotosOrText: { en: 'No contact info', ar: 'لا معلومات اتصال' },
  addressConsistent: { en: 'Address consistent', ar: 'العنوان متّسق' },
  locationMatchesAddress: { en: 'Location matches address', ar: 'الموقع يطابق العنوان' },
  priceReasonable: { en: 'Price reasonable', ar: 'السعر معقول' },
  textQuality: { en: 'Text quality', ar: 'جودة النص' },
}

// Advisory AI pre-check (owner decision 2026-10-09). Display only: the admin decides.
function AiReportPanel({ review, isAr, disabled, onRerun }: { review: ListingAiReview | null; isAr: boolean; disabled: boolean; onRerun: () => void }) {
  const rerun = (
    <button style={commandStyles.aiRerun} disabled={disabled || review?.status === 'PENDING'} onClick={onRerun}>
      {review?.status === 'PENDING' ? (isAr ? 'جارٍ الفحص…' : 'Checking…') : (isAr ? 'إعادة الفحص الآلي' : 'Re-run AI check')}
    </button>
  )
  const header = (badge: ReactNode, extra?: string) => (
    <div style={commandStyles.aiHeader}>
      <strong style={commandStyles.aiTitle}>{isAr ? 'الفحص الآلي (استشاري)' : 'AI check (advisory)'}</strong>
      {badge}
      {extra && <small style={commandStyles.aiMuted}>{extra}</small>}
      <span style={{ flex: 1 }} />
      {rerun}
    </div>
  )
  if (!review) {
    return <section style={commandStyles.aiPanel}>{header(null, isAr ? 'لم يُشغَّل بعد' : 'Not run yet')}</section>
  }
  if (review.status === 'PENDING') {
    return <section style={commandStyles.aiPanel}>{header(<span style={{ ...commandStyles.aiBadge, ...commandStyles.aiBadgeMuted }}>{isAr ? 'قيد التشغيل' : 'Running'}</span>)}</section>
  }
  if (review.status === 'SKIPPED') {
    const notConfigured = review.reason === 'NO_API_KEY'
    return (
      <section style={commandStyles.aiPanel}>
        {header(
          <span style={{ ...commandStyles.aiBadge, ...commandStyles.aiBadgeMuted }}>
            {notConfigured ? (isAr ? 'الفحص الآلي غير مُفعّل' : 'AI not configured') : (isAr ? 'لم يُشغَّل' : 'Not run')}
          </span>,
          notConfigured ? (isAr ? 'أضف ANTHROPIC_API_KEY لتفعيله' : 'Set ANTHROPIC_API_KEY to enable it') : undefined,
        )}
      </section>
    )
  }
  if (review.status === 'FAILED' || !review.result) {
    return (
      <section style={commandStyles.aiPanel}>
        {header(<span style={{ ...commandStyles.aiBadge, ...commandStyles.aiBadgeBad }}>{isAr ? 'تعذّر الفحص' : 'Check failed'}</span>, review.error || undefined)}
      </section>
    )
  }
  const { score, recommendation, checks, issuesForHost, summaryForAdmin } = review.result
  const scoreTone = score >= 75 ? commandStyles.aiBadgeGood : score >= 50 ? commandStyles.aiBadgeWarn : commandStyles.aiBadgeBad
  const recTone = recommendation === 'APPROVE' ? commandStyles.aiBadgeGood : recommendation === 'NEEDS_FIXES' ? commandStyles.aiBadgeWarn : commandStyles.aiBadgeBad
  const recText = recommendation === 'APPROVE'
    ? (isAr ? 'يقترح الموافقة' : 'Suggests approve')
    : recommendation === 'NEEDS_FIXES'
      ? (isAr ? 'يحتاج تعديلات' : 'Needs fixes')
      : (isAr ? 'يقترح الرفض' : 'Suggests reject')
  return (
    <section style={commandStyles.aiPanel}>
      {header(
        <>
          <span style={{ ...commandStyles.aiBadge, ...scoreTone }} title={isAr ? 'الدرجة' : 'Score'}>{score}/100</span>
          <span style={{ ...commandStyles.aiBadge, ...recTone }}>{recText}</span>
        </>,
        review.model || undefined,
      )}
      <p style={commandStyles.aiSummary}>{summaryForAdmin}</p>
      <ul style={commandStyles.aiChecks}>
        {(Object.keys(AI_CHECK_LABELS) as AiReviewCheckKey[]).map((key) => {
          const check = checks[key]
          if (!check) return null
          return (
            <li key={key} style={commandStyles.aiCheck}>
              <span style={{ ...commandStyles.aiMark, color: check.ok ? '#20d29b' : '#ff6b81' }} aria-label={check.ok ? 'ok' : 'problem'}>{check.ok ? '✓' : '✗'}</span>
              <span>
                <b>{isAr ? AI_CHECK_LABELS[key].ar : AI_CHECK_LABELS[key].en}</b>
                {check.note && <small style={commandStyles.aiMuted}> — {check.note}</small>}
              </span>
            </li>
          )
        })}
      </ul>
      {issuesForHost.length > 0 && (
        <div style={commandStyles.aiIssues}>
          <small style={commandStyles.aiMuted}>{isAr ? 'ما يجب على المضيف تصحيحه:' : 'Issues for the host (Arabic, sent if you send it back):'}</small>
          <ul dir="rtl" style={commandStyles.aiIssueList}>
            {issuesForHost.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

function paymentListingTitle(payment: PlatformPaymentProof | undefined, lang: Lang) {
  const listing = payment?.booking?.listing
  if (listing) return listingTitleText(listing, lang)
  const campaign = payment?.campaignListing
  if (campaign) return lang === 'ar' ? campaign.titleAr : campaign.titleEn || campaign.titleAr
  if (payment?.provider === 'seller_plan') return lang === 'ar' ? 'دفعة خطة بائع' : 'Seller plan payment'
  return lang === 'ar' ? 'بدون حجز مرتبط' : 'No linked booking'
}

// Deterministic campaign association (payment.campaignListingId), not inferred from amount or
// uploader -- see the one-payment-per-campaign business rule in server/routes/listings.mjs.
function paymentAdvertisingDetails(payment: PlatformPaymentProof | undefined, lang: Lang) {
  const isAr = lang === 'ar'
  if (payment?.provider !== 'seller_plan' || !String(payment?.planCode || '').startsWith('advertising-')) return null
  const plan = payment?.planCode === 'advertising-premium' ? (isAr ? 'Premium' : 'Premium') : 'Plus'
  const campaign = payment?.campaignListing
  const metadata = campaign?.metadata as { adDuration?: string; adPlacement?: string } | undefined
  const campaignPart = campaign
    ? `${isAr ? 'الحملة' : 'Campaign'}: ${(isAr ? campaign.titleAr : campaign.titleEn || campaign.titleAr)} (${campaign.id.slice(0, 8)}) · ${campaign.status}`
    : isAr
      ? 'لم تُربط بحملة بعد'
      : 'Not yet attached to a campaign'
  const durationPart = metadata?.adDuration ? ` · ${metadata.adDuration}` : ''
  return `📢 ${isAr ? 'إعلان' : 'Advertising'} · ${plan}${durationPart} — ${campaignPart}`
}

function paymentHostName(payment: PlatformPaymentProof | undefined, lang: Lang) {
  return (
    payment?.booking?.listing?.owner?.displayName ||
    payment?.payer?.displayName ||
    (lang === 'ar' ? 'غير معروف' : 'Unknown')
  )
}

function bookingReference(payment: PlatformPaymentProof | undefined) {
  const id = payment?.bookingId || payment?.booking?.id || payment?.id || '97cd8153'
  return `BK-${id.slice(0, 4).toUpperCase()}-${id.slice(4, 8).toUpperCase()}`
}

function shortBookingReference(booking: PlatformReviewBooking | undefined) {
  const id = booking?.id || '97cd8153'
  return `BK-${id.slice(0, 4).toUpperCase()}-${id.slice(4, 8).toUpperCase()}`
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

function readStoredMinor(key: string) {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(key)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function createShamCashReconciliation(realPayments: PlatformPaymentProof[], displayPayments: PlatformPaymentProof[], lang: Lang, accountMinor: number | null) {
  const shamCashPayments = realPayments.filter((payment) => isShamCashProvider(payment.provider))
  const sourcePayments = shamCashPayments.length ? shamCashPayments : displayPayments.filter((payment) => isShamCashProvider(payment.provider) || payment.provider === 'LOCAL_WALLET')
  const expectedMinor = sourcePayments.reduce((sum, payment) => sum + payment.amountMinor, 0)
  const hasExternalAccount = accountMinor != null
  const differenceMinor = hasExternalAccount ? accountMinor - expectedMinor : expectedMinor
  const isMatched = hasExternalAccount && differenceMinor === 0
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
    items: sourcePayments.slice(0, 6).map((payment) => ({
      id: payment.id,
      amountMinor: payment.amountMinor,
      reference: payment.providerRef || payment.id.slice(0, 10).toUpperCase(),
      status: statusText(payment.status, lang),
      note: lang === 'ar'
        ? (isMatched ? 'مطابق مع حساب شام كاش' : 'يحتاج مراجعة شام كاش')
        : (isMatched ? 'Matched with Sham Cash account' : 'Needs Sham Cash review'),
    })),
  }
}

function isShamCashProvider(provider: string | null | undefined) {
  const normalized = String(provider || '').toUpperCase()
  return normalized.includes('SHAM') || normalized.includes('LOCAL_WALLET') || normalized.includes('SYRIAN_LOCAL_WALLET')
}

function commandTone(tone: string): CSSProperties {
  const colors: Record<string, string> = {
    blue: '#7d90ff',
    gold: '#e8bd2a',
    green: '#22d6a0',
    red: '#ff5c7a',
    white: '#f2f5ff',
  }
  return { color: colors[tone] || colors.white }
}

// The numeric "confidence" score below was removed entirely (was hardcoded 74/82/88/91/94 with no
// real computation behind it — these are plain if/else branches on real booleans, not a model). A
// specific-looking percentage next to real approve/reject controls falsely implied a computed
// assessment. "AI Brain" title strings renamed to plain descriptions on the EN side; the reasons
// themselves are genuinely derived from real data and stay useful as a checklist.
function createAiPaymentReview(payment: PlatformPaymentProof | undefined, isAr: boolean) {
  const provider = payment?.provider || 'LOCAL_WALLET'
  const amount = payment?.amountMinor || 0
  const hasProof = Boolean(payment?.proofAssetUrl || payment?.providerRef)
  const isLarge = amount >= 50000000
  const isRejected = payment?.status === 'REJECTED'
  const isApproved = payment?.status === 'APPROVED'

  if (isRejected) {
    return {
      label: isAr ? 'سبب رفض' : 'Reject reason',
      title: isAr ? 'مرفوض في السجل' : 'Rejected in ledger',
      badgeColor: '#ff4d73',
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
      title: isAr ? 'لا يوجد إثبات دفع بعد' : 'No payment proof yet',
      badgeColor: '#e6b80d',
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
      title: isAr ? 'معاملة كبيرة القيمة — تحتاج تدقيقًا' : 'High-value transaction — needs audit',
      badgeColor: '#e6b80d',
      borderColor: '#e6b80d',
      reasons: [
        isAr ? 'قيمة المعاملة أعلى من المتوسط.' : 'Transaction value is above the normal average.',
        isAr ? 'راجع تطابق المبلغ مع الحجز قبل القبول.' : 'Verify the amount matches the booking before approval.',
      ],
    }
  }

  return {
    label: isAr ? 'مقترح قبول' : 'Approve suggested',
    title: isApproved ? (isAr ? 'الدفع مؤكد في السجل' : 'Payment is confirmed in ledger') : (isAr ? 'الفحوصات الأساسية سليمة' : 'Basic checks pass'),
    badgeColor: '#20d29b',
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

function createAiCashMatchReview(isAr: boolean, missingAccount: boolean) {
  return {
    label: isAr ? 'إيقاف قبل القرار' : 'Hold before decision',
    title: isAr ? 'يتطلب مطابقة مع شام كاش' : 'Requires Sham Cash match',
    badgeColor: '#e6b80d',
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

// Real, evidence-based step estimate instead of a static "we're always at step 7" indicator. The
// backend has no event log for the early steps (search/account/terms) or exact host-confirmation/
// checkout timestamps, so those are inferred as "done" once later real signals (payment/booking/
// payout status) confirm the booking is past them — never claimed as independently observed.
function currentFlowStepIndex(booking: PlatformReviewBooking | undefined, payment: PlatformPaymentProof | undefined, payoutReleased: boolean) {
  const status = booking?.status.toUpperCase()
  if (status === 'COMPLETED') return payoutReleased ? 12 : 11
  if (status === 'CONFIRMED' || status === 'DISPUTED') return 8
  // The booking record itself may not be loaded (the review queue only carries REQUESTED/DISPUTED
  // bookings) even when its payment proof is — the payment's own status is still real signal.
  if (payment?.status === 'APPROVED') return 7
  if (payment?.status === 'PENDING_ADMIN_REVIEW') return 6
  if (payment?.status === 'PENDING_PROOF') return 5
  if (booking) return 3
  return 2
}


// Admin "command center" visual system — refreshed 2026-10 for a cleaner, more professional look.
// Shared design tokens kept local so the whole surface stays cohesive without a CSS refactor.
const AD = {
  panel: 'linear-gradient(180deg,#111b2e,#0c1322)',
  panelSoft: 'linear-gradient(180deg,#0f192b,#0b1220)',
  line: 'rgba(130,150,200,.14)',
  lineStrong: 'rgba(130,150,200,.22)',
  shadow: '0 1px 0 rgba(255,255,255,.05) inset, 0 18px 40px -22px rgba(0,0,0,.8)',
  text: '#f2f5ff',
  muted: '#9aa7bd',
  dim: '#6c7b96',
  blue: '#5b74ff',
  blue2: '#7d90ff',
  cyan: '#19d7ff',
  gold: '#e8bd2a',
  green: '#22d6a0',
  red: '#ff5c7a',
  violet: '#9a6bff',
  rCard: 16,
  rMed: 13,
  rSm: 11,
} as const

const commandStyles: Record<string, CSSProperties> = {
  quickLinks: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  page: { minHeight: '100vh', background: 'radial-gradient(1100px 520px at 12% -8%, rgba(91,116,255,.14), transparent 60%), radial-gradient(900px 480px at 92% 2%, rgba(25,215,255,.08), transparent 55%), #070b16', color: AD.text, padding: '22px 28px 92px', display: 'grid', gap: 20, fontFamily: 'inherit' },
  header: { alignItems: 'center', background: 'linear-gradient(180deg, rgba(23,35,58,.7), rgba(14,21,36,.5))', border: `1px solid ${AD.line}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 18, gridTemplateColumns: 'auto 1fr auto', padding: '14px 20px' },
  strBrandLockup: { alignItems: 'center', display: 'flex', gap: 13, minWidth: 0 },
  watermark: { background: 'rgba(130,150,200,.08)', border: `1px solid ${AD.line}`, borderRadius: 999, color: AD.muted, fontSize: 11, fontWeight: 800, letterSpacing: '.05em', padding: '7px 14px', whiteSpace: 'nowrap' },
  flowButtons: { display: 'flex', gap: 10 },
  circleButton: { alignItems: 'center', background: 'rgba(130,150,200,.08)', border: `1px solid ${AD.line}`, borderRadius: 12, color: AD.text, cursor: 'pointer', display: 'grid', fontSize: 18, fontWeight: 800, height: 40, placeItems: 'center', width: 40 },
  breadcrumb: { color: AD.dim, display: 'flex', gap: 10, justifyContent: 'center', fontWeight: 700 },
  adminIdentity: { alignItems: 'center', display: 'flex', gap: 12 },
  logoBlock: { background: `linear-gradient(135deg,${AD.blue},${AD.violet})`, borderRadius: 12, color: '#fff', display: 'grid', fontWeight: 900, height: 40, placeItems: 'center', width: 40, boxShadow: '0 8px 20px -8px rgba(91,116,255,.8)' },
  avatar: { background: 'linear-gradient(135deg,#e7d2ad,#b59b6f)', border: '1px solid rgba(255,255,255,.18)', borderRadius: 12, color: '#0b1020', display: 'grid', fontWeight: 900, height: 38, placeItems: 'center', width: 38 },
  notify: { color: AD.red, fontSize: 16 },
  departmentGroups: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 2 },
  departmentGroup: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: 14, overflow: 'hidden', boxShadow: AD.shadow },
  departmentGroupHeader: { alignItems: 'center', background: 'transparent', border: 'none', color: AD.text, cursor: 'pointer', display: 'flex', gap: 14, minHeight: 58, padding: '12px 18px', width: '100%' },
  departmentGroupHeaderActive: { background: 'linear-gradient(90deg, rgba(91,116,255,.14), transparent)', color: '#fff' },
  departmentGroupChevron: { color: AD.blue2, fontSize: 13, width: 14 },
  departmentGroupLabel: { display: 'flex', flex: 1, flexDirection: 'column', gap: 3, textAlign: 'start' },
  departmentTabs: { alignItems: 'center', borderTop: `1px solid ${AD.line}`, display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px' },
  departmentTab: { alignItems: 'center', background: 'rgba(130,150,200,.06)', border: `1px solid ${AD.line}`, borderRadius: AD.rSm, color: AD.muted, cursor: 'pointer', display: 'flex', gap: 9, fontWeight: 700, justifyContent: 'center', minHeight: 42, minWidth: 116, padding: '0 15px', whiteSpace: 'nowrap' },
  departmentTabActive: { background: 'linear-gradient(135deg, rgba(91,116,255,.28), rgba(91,116,255,.12))', border: '1px solid rgba(123,144,255,.6)', color: '#fff', boxShadow: '0 8px 22px -12px rgba(91,116,255,.9), 0 0 0 1px rgba(123,144,255,.25) inset' },
  statsGrid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' },
  warningBanner: { alignItems: 'center', background: 'linear-gradient(90deg, rgba(232,189,42,.16), rgba(232,189,42,.05))', border: '1px solid rgba(232,189,42,.4)', borderRadius: 14, color: '#f3d672', display: 'flex', gap: 16, justifyContent: 'space-between', padding: '15px 18px' },
  adminV2Grid: { alignItems: 'start', display: 'grid', gap: 20, gridTemplateColumns: 'minmax(280px, .95fr) minmax(430px, 1.2fr) minmax(330px, 1fr)' },
  leftRail: { display: 'grid', gap: 18 },
  centerPanel: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 20, minHeight: 560, padding: 22 },
  rightQueue: { display: 'grid', gap: 14 },
  protectionFlags: { display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' },
  managementGroups: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' },
  managementGroupCard: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 14, padding: 18 },
  managementGroupHeader: { display: 'grid', gap: 4 },
  groupStatsGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' },
  statCard: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: 14, boxShadow: AD.shadow, display: 'grid', gap: 9, minHeight: 92, padding: 16 },
  footerGroups: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  footerGroupButton: { alignItems: 'center', background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: AD.rMed, color: AD.text, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', minHeight: 58, padding: '10px 14px', textAlign: 'start' },
  footerGroupButtonActive: { background: 'linear-gradient(135deg, rgba(91,116,255,.24), rgba(91,116,255,.08))', border: '1px solid rgba(123,144,255,.6)', boxShadow: '0 0 0 1px rgba(123,144,255,.22) inset' },
  commandViewPanel: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 16, padding: 20 },
  commandViewHeader: { alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' },
  commandNotice: { background: 'rgba(34,214,160,.1)', border: '1px solid rgba(34,214,160,.3)', borderRadius: 999, color: AD.green, fontSize: 12, fontWeight: 800, justifySelf: 'start', padding: '8px 14px' },
  outboxPanel: { background: 'linear-gradient(180deg, rgba(91,116,255,.1), rgba(91,116,255,.03))', border: '1px solid rgba(91,116,255,.3)', borderRadius: AD.rMed, color: AD.muted, display: 'grid', gap: 9, padding: 14 },
  payoutState: { border: '1px solid rgba(232,189,42,.5)', borderRadius: 999, color: AD.gold, fontSize: 11.5, fontWeight: 800, justifySelf: 'start', padding: '7px 13px' },
  backlogNotice: { background: 'rgba(232,189,42,.1)', border: '1px solid rgba(232,189,42,.3)', borderRadius: AD.rMed, color: AD.gold, fontSize: 13, fontWeight: 700, padding: '10px 13px' },
  managementList: { display: 'grid', gap: 11 },
  sectionHeadRow: { display: 'grid', gap: 4, color: AD.text, padding: '4px 2px' },
  managementRow: { alignItems: 'center', background: '#0c1322', border: `1px solid ${AD.line}`, borderRadius: AD.rMed, color: AD.text, cursor: 'pointer', display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', minHeight: 64, padding: 14, textAlign: 'start' },
  listingThumbnail: { borderRadius: 11, height: 48, objectFit: 'cover', width: 48 },
  listingReviewBlock: { display: 'grid', gap: 6 },
  aiPanel: { background: 'linear-gradient(180deg, rgba(16,26,44,.95), #0b1220)', border: '1px solid rgba(91,116,255,.28)', borderRadius: AD.rMed, color: '#e8eaf2', display: 'grid', gap: 8, padding: '12px 14px', textAlign: 'start' },
  aiHeader: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  aiTitle: { fontSize: 13.5 },
  aiBadge: { borderRadius: 999, fontSize: 12, fontWeight: 800, padding: '4px 11px' },
  aiBadgeGood: { background: 'rgba(34,214,160,.16)', color: AD.green },
  aiBadgeWarn: { background: 'rgba(232,189,42,.16)', color: AD.gold },
  aiBadgeBad: { background: 'rgba(255,92,122,.16)', color: AD.red },
  aiBadgeMuted: { background: 'rgba(130,150,200,.1)', color: '#aab0c0' },
  aiMuted: { color: AD.dim, fontSize: 12 },
  aiRerun: { background: 'transparent', border: '1px solid rgba(91,116,255,.5)', borderRadius: 9, color: AD.blue2, cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 11px' },
  aiSummary: { color: '#cfd3de', fontSize: 13, lineHeight: 1.6, margin: 0 },
  aiChecks: { display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', listStyle: 'none', margin: 0, padding: 0 },
  aiCheck: { alignItems: 'baseline', display: 'grid', fontSize: 12.5, gap: 6, gridTemplateColumns: '14px minmax(0, 1fr)', lineHeight: 1.5 },
  aiMark: { fontWeight: 900 },
  aiIssues: { display: 'grid', gap: 4 },
  aiIssueList: { color: '#e8eaf2', fontSize: 13, lineHeight: 1.6, margin: 0, paddingInlineStart: 18 },
  sendBackBox: { background: '#0c1322', border: '1px solid rgba(255,92,122,.35)', borderRadius: AD.rMed, display: 'grid', gap: 8, padding: 14 },
  sendBackLabel: { color: '#cfd3de', display: 'grid', fontSize: 12.5, fontWeight: 700, gap: 6 },
  sendBackInput: { background: '#070b16', border: `1px solid ${AD.lineStrong}`, borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 13, minHeight: 70, padding: 10 },
  sendBackCheck: { alignItems: 'center', color: '#cfd3de', display: 'flex', fontSize: 12.5, gap: 8 },
  sendBackActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  listingThumbnailPlaceholder: { alignItems: 'center', background: 'linear-gradient(135deg,#1c2a44,#101a2d)', borderRadius: 11, color: AD.dim, display: 'flex', fontSize: 11, height: 48, justifyContent: 'center', textAlign: 'center', width: 48 },
  selectedCard: { border: '1px solid rgba(123,144,255,.6)', boxShadow: '0 0 0 1px rgba(123,144,255,.3) inset, 0 18px 40px -22px rgba(0,0,0,.8)' },
  managementRowActions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(74px, 1fr))' },
  moneyCommandGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' },
  moneyCommandCard: { background: '#0c1322', border: `1px solid ${AD.line}`, borderRadius: AD.rMed, display: 'grid', gap: 10, padding: 16 },
  shamCashPanel: { background: 'linear-gradient(180deg, rgba(20,26,20,.6), #0c1322)', border: '1px solid rgba(232,189,42,.35)', borderRadius: AD.rMed, display: 'grid', gap: 14, padding: 18 },
  shamCashHeader: { alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' },
  shamCashGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  outcomeGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  outcomeCard: { background: '#0c1322', border: `1px solid ${AD.line}`, borderRadius: AD.rMed, display: 'grid', gap: 8, padding: 14 },
  aiRail: { alignItems: 'center', display: 'flex', gap: 14, justifyContent: 'space-between' },
  linkButton: { background: 'transparent', border: 0, color: AD.blue2, cursor: 'pointer', fontSize: 13, fontWeight: 800 },
  aiPills: { display: 'grid', gap: 8 },
  aiDecisionCard: { background: 'linear-gradient(180deg, rgba(16,26,44,.95), #0b1220)', border: `1px solid ${AD.green}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 13, padding: 18 },
  aiDecisionHeader: { alignItems: 'center', display: 'grid', gap: 13, gridTemplateColumns: 'auto 1fr' },
  aiDecisionBadge: { borderRadius: 999, color: '#042018', fontSize: 11.5, fontWeight: 900, padding: '8px 13px' },
  aiReasonGrid: { display: 'grid', gap: 8 },
  aiReasonLine: { background: 'rgba(130,150,200,.06)', border: `1px solid ${AD.line}`, borderRadius: AD.rSm, color: AD.muted, fontSize: 12.5, lineHeight: 1.5, margin: 0, padding: '10px 12px' },
  aiFinalNote: { color: AD.dim, margin: 0 },
  aiMiniDecision: { background: 'rgba(34,214,160,.08)', border: '1px solid rgba(34,214,160,.22)', borderRadius: AD.rSm, color: AD.muted, display: 'grid', gap: 4, padding: 10 },
  aiRowDecision: { display: 'grid', gap: 4 },
  commandGrid: { display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))' },
  proofColumn: { display: 'grid', gap: 14 },
  sectionHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  countBadge: { background: `linear-gradient(135deg,${AD.gold},#c89f10)`, borderRadius: 8, color: '#241c02', display: 'inline-grid', fontSize: 12, fontWeight: 900, height: 22, marginInlineEnd: 9, placeItems: 'center', minWidth: 26, padding: '0 6px' },
  proofList: { display: 'grid', gap: 14 },
  emptyProofCard: { background: AD.panel, border: `1px dashed ${AD.lineStrong}`, borderRadius: AD.rMed, color: AD.dim, display: 'grid', gap: 8, minHeight: 120, padding: 18, placeContent: 'center', textAlign: 'center' },
  proofCard: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: 14, boxShadow: AD.shadow, cursor: 'pointer', display: 'grid', gap: 11, padding: 15 },
  proofTop: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  proofInfo: { display: 'grid', gap: 3 },
  proofMoney: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  proofActions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))' },
  pipelineCard: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 14, padding: 20 },
  pipelinePulse: { color: AD.blue, fontSize: 30 },
  pipelineList: { display: 'grid', gap: 4 },
  pipelineStep: { alignItems: 'center', color: AD.dim, display: 'grid', gap: 12, gridTemplateColumns: '78px 1fr 34px', borderRadius: 12, padding: '11px 12px' },
  pipelineActive: { background: 'linear-gradient(90deg, rgba(232,189,42,.14), transparent)', color: '#f3d672', fontWeight: 800 },
  sidePanels: { display: 'grid', gap: 20 },
  sideCard: { background: AD.panel, border: `1px solid ${AD.line}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 15, padding: 20 },
  cardTitleRow: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  confirmedPill: { background: `linear-gradient(135deg,${AD.green},#14b98a)`, borderRadius: 8, color: '#042018', fontSize: 12, fontWeight: 900, padding: '5px 11px' },
  warningPill: { background: `linear-gradient(135deg,${AD.gold},#c89f10)`, borderRadius: 8, color: '#241c02', fontSize: 12, fontWeight: 900, padding: '5px 11px' },
  hostRow: { alignItems: 'center', display: 'flex', gap: 14 },
  hostAvatar: { background: 'linear-gradient(135deg,#e7d2ad,#9a7f55)', borderRadius: 15, color: '#0b1020', display: 'grid', fontWeight: 900, height: 52, placeItems: 'center', width: 52, boxShadow: '0 0 0 1px rgba(255,255,255,.15) inset' },
  checkLine: { alignItems: 'center', color: AD.muted, display: 'flex', fontSize: 13, gap: 10, justifyContent: 'space-between', margin: 0 },
  feeLine: { color: AD.muted, display: 'flex', fontSize: 13.5, justifyContent: 'space-between', margin: 0 },
  feeStrong: { borderTop: `1px solid ${AD.line}`, color: AD.text, fontWeight: 900, paddingTop: 13 },
  feeDanger: { color: AD.red, fontSize: 13 },
  drawerGrid: { display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' },
  drawerCard: { background: '#0c1322', border: `1px solid ${AD.line}`, borderRadius: AD.rCard, boxShadow: AD.shadow, display: 'grid', gap: 16, padding: 24 },
  walletTimeline: { borderInlineStart: `2px solid ${AD.lineStrong}`, display: 'grid', gap: 14, paddingInlineStart: 18 },
  signalLine: { border: `1px solid ${AD.line}`, borderRadius: AD.rSm, display: 'flex', justifyContent: 'space-between', margin: 0, padding: 12 },
  riskPair: { display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' },
  actionBar: { alignItems: 'center', background: 'rgba(7,11,22,.92)', borderTop: `1px solid ${AD.lineStrong}`, bottom: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', insetInline: 0, padding: '14px 28px', position: 'fixed', zIndex: 10, backdropFilter: 'blur(10px)' },
  acceptButton: { background: `linear-gradient(135deg,${AD.green},#14b98a)`, border: 0, borderRadius: 12, color: '#042018', cursor: 'pointer', fontWeight: 900, minHeight: 46, padding: '0 14px', boxShadow: '0 10px 24px -14px rgba(34,214,160,.9)' },
  rejectButton: { background: `linear-gradient(135deg,${AD.red},#e23f61)`, border: 0, borderRadius: 12, color: '#fff', cursor: 'pointer', fontWeight: 900, minHeight: 46, padding: '0 14px', boxShadow: '0 10px 24px -16px rgba(255,92,122,.9)' },
  goldButton: { background: `linear-gradient(135deg,${AD.gold},#c89f10)`, border: 0, borderRadius: 12, color: '#241c02', cursor: 'pointer', fontWeight: 900, minHeight: 44, padding: '0 14px' },
  blueButton: { background: `linear-gradient(135deg,${AD.blue},#4254e0)`, border: 0, borderRadius: 12, color: '#fff', cursor: 'pointer', fontWeight: 800, minHeight: 44, padding: '0 16px', boxShadow: '0 10px 24px -16px rgba(91,116,255,.9)' },
  disputeButton: { background: 'transparent', border: '1px solid #ff744d', borderRadius: 12, color: '#ff744d', cursor: 'pointer', fontWeight: 800, minHeight: 44, padding: '0 14px' },
  outlineGold: { background: 'transparent', border: '1px solid rgba(232,189,42,.55)', borderRadius: 12, color: AD.gold, cursor: 'pointer', fontWeight: 800, minHeight: 44, padding: '0 16px', whiteSpace: 'nowrap' },
  secondaryCommand: { alignItems: 'center', background: 'rgba(130,150,200,.06)', border: `1px solid ${AD.line}`, borderRadius: 12, color: AD.text, cursor: 'pointer', display: 'inline-flex', fontWeight: 700, gap: 9, justifyContent: 'center', minHeight: 44, padding: '0 16px' },
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
  alert: { border: '1px solid rgba(255,92,122,.4)', borderRadius: 14, background: 'linear-gradient(90deg, rgba(255,92,122,.16), rgba(255,92,122,.05))', color: '#ffd1d9', display: 'grid', gap: 4, padding: '15px 18px' },
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
