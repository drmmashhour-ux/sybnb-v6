import { useEffect, useMemo, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchBookingThread,
  fetchListingInquiryThread,
  fetchMyInquiries,
  fetchPrototypeHostOverview,
  fetchPrototypeOverview,
  fetchPrototypeReviewQueue,
  getStoredStaffSession,
  sendBookingMessage,
  sendListingInquiryMessage,
  type PlatformBooking,
  type PlatformListing,
  type PlatformMessage,
  type PlatformMyInquiryThread,
  type PlatformOverview,
  type PlatformPaymentProof,
  type PlatformRideRequest,
} from '../../shared/api/platformApi'

const MESSAGING_ELIGIBLE_BOOKING_STATUSES = ['CONFIRMED', 'COMPLETED', 'DISPUTED']
import { listingTitleText, moneyText, providerText, statusText } from '../../shared/i18n/display'

// The narrower shape shared by both sources this page draws staff bookings from: the admin
// review queue returns full listings, but the host overview's "requests" only include this
// subset — and this page only ever reads these fields, so the state holds the common subset.
type StaffBookingListing = Pick<PlatformListing, 'id' | 'division' | 'titleAr' | 'titleEn' | 'priceMinor' | 'currency' | 'status'>

type Props = {
  lang: Lang
}

type Thread = {
  id: string
  title: string
  subtitle: string
  status: string
  rawStatus?: string
  href: string
  type: 'booking' | 'payment' | 'ride' | 'gift' | 'inquiry'
  listingId?: string
  priority: 'urgent' | 'waiting' | 'new' | 'closed'
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    previous: 'السابق',
    next: 'التالي',
    title: 'IMMOContact',
    subtitle: 'مركز تواصل موحد لكل طلبات الحجز والزيارة والدفع والهدايا ورحلات SR.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    error: 'تعذر تحميل مركز التواصل',
    open: 'فتح التفاصيل',
    support: 'ملاحظة للدعم',
    supportCopy: 'اختر الطلب المناسب وافتح التفاصيل. كل قرار أو دفع أو مراجعة محفوظ في قاعدة البيانات وسجل التدقيق.',
    status: 'الحالة',
    all: 'الكل',
    unified: 'الصندوق الموحد',
    conversation: 'المحادثة',
    context: 'السياق',
    quickTemplates: 'قوالب سريعة',
    assigned: 'المسؤول',
    linkedRecord: 'السجل المرتبط',
    trust: 'الثقة',
    noThread: 'اختر محادثة من القائمة.',
    templates: ['تعليمات الوصول', 'تذكير الدفع', 'تأكيد الزيارة', 'تم تعيين السائق', 'نحتاج معلومات إضافية'],
    bookings: 'طلبات وحجوزات',
    payments: 'مدفوعات',
    rides: 'رحلات SR',
    gifts: 'هدايا',
    inquiries: 'استفسارات',
    empty: 'لا توجد محادثات أو طلبات بعد.',
    balance: 'رصيد المحفظة',
    sla: 'SLA',
    aiNext: 'اقتراح AI',
    aiNextCopy: 'أرسل رد سريع، اربط المهمة بالعمليات، ثم تابع السجل المالي عند الحاجة.',
    teamHandoff: 'تسليم للفريق',
    financeLink: 'فتح المالية',
    operationsLink: 'فتح العمليات',
    trustSignal: 'إشارة الثقة',
    riskLevel: 'مستوى المخاطر',
    lockedTitle: 'التواصل غير متاح بعد',
    lockedCopy: 'يفتح التواصل مع المضيف وفريق الدعم بعد تأكيد حجزك ودفع القيمة داخل SYBNB. أكمل الحجز أولاً.',
    noMessagingForType: 'التواصل المباشر متاح لطلبات الحجز فقط. استخدم هذا السجل للاطلاع على التفاصيل.',
    messagingNotEligible: 'التواصل يفتح بعد تأكيد الحجز.',
    noMessagesYet: 'لا توجد رسائل بعد. ابدأ المحادثة.',
    messagePlaceholder: 'اكتب رسالتك...',
    send: 'إرسال',
    sending: 'جار الإرسال...',
    sendError: 'تعذر إرسال الرسالة.',
    loadEarlier: 'تحميل رسائل أقدم',
    loadingEarlier: 'جار التحميل...',
  },
  en: {
    back: 'Back to landing',
    previous: 'Previous',
    next: 'Next',
    title: 'IMMOContact',
    subtitle: 'A single contact center for booking, visit, payment, gift, and SR ride follow-up.',
    refresh: 'Refresh',
    loading: 'Loading',
    error: 'Could not load contact center',
    open: 'Open details',
    support: 'Support note',
    supportCopy: 'Choose the relevant request and open its details. Every decision, payment, and review is stored in the database and audit trail.',
    status: 'Status',
    all: 'All',
    unified: 'Unified inbox',
    conversation: 'Conversation',
    context: 'Context',
    quickTemplates: 'Quick templates',
    assigned: 'Assigned admin',
    linkedRecord: 'Linked record',
    trust: 'Trust',
    noThread: 'Choose a conversation from the list.',
    templates: ['Check-in instructions', 'Payment reminder', 'Visit confirmation', 'Driver assigned', 'Need more information'],
    bookings: 'Requests and bookings',
    payments: 'Payments',
    rides: 'SR rides',
    gifts: 'Gifts',
    inquiries: 'Inquiries',
    empty: 'No conversations or requests yet.',
    balance: 'Wallet balance',
    sla: 'SLA',
    aiNext: 'AI suggestion',
    aiNextCopy: 'Send a fast reply, connect the task to operations, then follow the finance record when needed.',
    teamHandoff: 'Team handoff',
    financeLink: 'Open finance',
    operationsLink: 'Open operations',
    trustSignal: 'Trust signal',
    riskLevel: 'Risk level',
    lockedTitle: 'Messaging is not available yet',
    lockedCopy: 'Messaging with the host and support team opens once your booking is confirmed and paid inside SYBNB. Complete a booking first.',
    noMessagingForType: 'Direct messaging is only available for booking requests. Use this record to review details.',
    messagingNotEligible: 'Messaging opens once the booking is confirmed.',
    noMessagesYet: 'No messages yet. Start the conversation.',
    messagePlaceholder: 'Write your message...',
    send: 'Send',
    sending: 'Sending...',
    sendError: 'Could not send the message.',
    loadEarlier: 'Load earlier messages',
    loadingEarlier: 'Loading...',
  },
  fr: {
    back: 'Retour à l’accueil',
    previous: 'Précédent',
    next: 'Suivant',
    title: 'IMMOContact',
    subtitle: 'Un centre de contact unique pour le suivi des réservations, des visites, des paiements, des cadeaux et des courses SR.',
    refresh: 'Actualiser',
    loading: 'Chargement',
    error: 'Impossible de charger le centre de contact',
    open: 'Ouvrir les détails',
    support: 'Note pour le support',
    supportCopy: 'Choisissez la demande concernée et ouvrez ses détails. Chaque décision, paiement et vérification est enregistré dans la base de données et le journal d’audit.',
    status: 'Statut',
    all: 'Tout',
    unified: 'Boîte de réception unifiée',
    conversation: 'Conversation',
    context: 'Contexte',
    quickTemplates: 'Modèles rapides',
    assigned: 'Administrateur responsable',
    linkedRecord: 'Dossier associé',
    trust: 'Confiance',
    noThread: 'Choisissez une conversation dans la liste.',
    templates: ['Instructions d’arrivée', 'Rappel de paiement', 'Confirmation de visite', 'Chauffeur attribué', 'Informations supplémentaires requises'],
    bookings: 'Demandes et réservations',
    payments: 'Paiements',
    rides: 'Courses SR',
    gifts: 'Cadeaux',
    inquiries: 'Demandes de renseignements',
    empty: 'Aucune conversation ni demande pour l’instant.',
    balance: 'Solde du portefeuille',
    sla: 'SLA',
    aiNext: 'Suggestion de l’IA',
    aiNextCopy: 'Envoyez une réponse rapide, associez la tâche aux opérations, puis suivez le dossier financier au besoin.',
    teamHandoff: 'Transfert à l’équipe',
    financeLink: 'Ouvrir les finances',
    operationsLink: 'Ouvrir les opérations',
    trustSignal: 'Indicateur de confiance',
    riskLevel: 'Niveau de risque',
    lockedTitle: 'La messagerie n’est pas encore disponible',
    lockedCopy: 'La messagerie avec l’hôte et l’équipe de support s’ouvre une fois votre réservation confirmée et payée dans SYBNB. Effectuez d’abord une réservation.',
    noMessagingForType: 'La messagerie directe est disponible uniquement pour les demandes de réservation. Utilisez ce dossier pour consulter les détails.',
    messagingNotEligible: 'La messagerie s’ouvre une fois la réservation confirmée.',
    noMessagesYet: 'Aucun message pour l’instant. Commencez la conversation.',
    messagePlaceholder: 'Écrivez votre message...',
    send: 'Envoyer',
    sending: 'Envoi...',
    sendError: 'Impossible d’envoyer le message.',
    loadEarlier: 'Charger les messages précédents',
    loadingEarlier: 'Chargement...',
  },
}

export function ImmocontactPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [inquiryThreadsRaw, setInquiryThreadsRaw] = useState<PlatformMyInquiryThread[]>([])
  const [staffBookings, setStaffBookings] = useState<Array<PlatformBooking & { listing?: StaffBookingListing }>>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [activeType, setActiveType] = useState<Thread['type'] | 'all'>('all')
  const [activeThreadId, setActiveThreadId] = useState('')
  const [threadMessages, setThreadMessages] = useState<PlatformMessage[]>([])
  const [messagesStatus, setMessagesStatus] = useState<'idle' | 'loading' | 'locked' | 'error'>('idle')
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'error'>('idle')

  const staffSession = getStoredStaffSession()
  const isStaff = Boolean(staffSession)
  const isAdminViewer = Boolean(staffSession?.user.roles.includes('ADMIN'))

  useEffect(() => {
    void loadOverview()
  }, [])

  const hasQualifyingBooking = (overview?.bookings || []).some((booking) =>
    MESSAGING_ELIGIBLE_BOOKING_STATUSES.includes(booking.status),
  )
  // The inbox must never be fully hidden just because the guest has no CONFIRMED booking yet:
  // listing inquiries, payment/ride/gift and in-progress booking threads are all reachable flows,
  // and a guest who sent an inquiry has to be able to read the host's reply here. Booking *messaging*
  // for a non-qualifying booking is still gated per-thread (messagesStatus='locked' in the effect
  // below). Only lock the whole page when there is genuinely nothing to show.
  const hasAnyInboxContent =
    inquiryThreadsRaw.length > 0 ||
    (overview?.payments?.length ?? 0) > 0 ||
    (overview?.rides?.length ?? 0) > 0 ||
    (overview?.gifts?.sent?.length ?? 0) > 0 ||
    (overview?.gifts?.claimed?.length ?? 0) > 0 ||
    (overview?.bookings?.length ?? 0) > 0
  const messagingLocked = !isStaff && status === 'ready' && !hasQualifyingBooking && !hasAnyInboxContent

  const bookingThreads = useMemo(
    () => (isStaff ? staffBookings : overview?.bookings || []).map((booking) => bookingThread(booking, lang)),
    [isStaff, lang, overview?.bookings, staffBookings],
  )
  const paymentThreads = useMemo(
    () => (overview?.payments || []).map((payment) => paymentThread(payment, lang)),
    [lang, overview?.payments],
  )
  const rideThreads = useMemo(
    () => (overview?.rides || []).map((ride) => rideThread(ride, lang)),
    [lang, overview?.rides],
  )
  const giftThreads = useMemo(
    () => [
      ...(overview?.gifts.sent || []).map((gift) => giftThread(gift, 'sent', lang)),
      ...(overview?.gifts.claimed || []).map((gift) => giftThread(gift, 'claimed', lang)),
    ],
    [lang, overview?.gifts.claimed, overview?.gifts.sent],
  )
  const inquiryThreads = useMemo(
    () => inquiryThreadsRaw.map((thread) => inquiryThread(thread, lang)),
    [inquiryThreadsRaw, lang],
  )
  const allThreads = useMemo(
    () => [...bookingThreads, ...paymentThreads, ...rideThreads, ...giftThreads, ...inquiryThreads],
    [bookingThreads, giftThreads, paymentThreads, rideThreads, inquiryThreads],
  )
  const visibleThreads = activeType === 'all' ? allThreads : allThreads.filter((thread) => thread.type === activeType)
  const activeThread = visibleThreads.find((thread) => thread.id === activeThreadId) || visibleThreads[0]
  const filterItems: Array<{ id: Thread['type'] | 'all'; label: string; count: number }> = [
    { id: 'all', label: t.all, count: allThreads.length },
    { id: 'booking', label: t.bookings, count: bookingThreads.length },
    { id: 'payment', label: t.payments, count: paymentThreads.length },
    { id: 'ride', label: t.rides, count: rideThreads.length },
    { id: 'gift', label: t.gifts, count: giftThreads.length },
    { id: 'inquiry', label: t.inquiries, count: inquiryThreads.length },
  ]

  async function loadOverview() {
    setStatus('loading')
    setMessage('')

    try {
      if (isStaff) {
        if (isAdminViewer) {
          const queue = await fetchPrototypeReviewQueue()
          setStaffBookings(queue.bookings)
        } else {
          const hostOverview = await fetchPrototypeHostOverview()
          setStaffBookings(hostOverview.requests)
        }
      } else {
        const [nextOverview, nextInquiries] = await Promise.all([
          fetchPrototypeOverview(),
          fetchMyInquiries().catch(() => []),
        ])
        setOverview(nextOverview)
        setInquiryThreadsRaw(nextInquiries)
      }
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  useEffect(() => {
    if (!activeThread || (activeThread.type !== 'booking' && activeThread.type !== 'inquiry')) {
      setThreadMessages([])
      setMessagesStatus('idle')
      setHasMoreMessages(false)
      return
    }
    if (activeThread.type === 'booking' && activeThread.rawStatus && !MESSAGING_ELIGIBLE_BOOKING_STATUSES.includes(activeThread.rawStatus)) {
      setThreadMessages([])
      setMessagesStatus('locked')
      setHasMoreMessages(false)
      return
    }

    let cancelled = false
    setMessagesStatus('loading')
    const load =
      activeThread.type === 'inquiry' && activeThread.listingId
        ? fetchListingInquiryThread(activeThread.listingId)
        : fetchBookingThread(activeThread.id, isStaff)
    load
      .then((thread) => {
        if (!cancelled) {
          setThreadMessages(thread.messages)
          setHasMoreMessages(thread.hasMore)
          setMessagesStatus('idle')
        }
      })
      .catch(() => {
        if (!cancelled) setMessagesStatus('locked')
      })
    return () => {
      cancelled = true
    }
  }, [activeThread?.id, activeThread?.type, activeThread?.rawStatus, activeThread?.listingId, isStaff])

  async function loadEarlierMessages() {
    if (!activeThread || (activeThread.type !== 'booking' && activeThread.type !== 'inquiry') || !threadMessages.length) return
    setLoadingEarlier(true)
    try {
      const oldestId = threadMessages[0].id
      const thread =
        activeThread.type === 'inquiry' && activeThread.listingId
          ? await fetchListingInquiryThread(activeThread.listingId, oldestId)
          : await fetchBookingThread(activeThread.id, isStaff, oldestId)
      setThreadMessages((current) => [...thread.messages, ...current])
      setHasMoreMessages(thread.hasMore)
    } finally {
      setLoadingEarlier(false)
    }
  }

  async function sendMessage() {
    if (!activeThread || (activeThread.type !== 'booking' && activeThread.type !== 'inquiry') || !messageInput.trim()) return
    setSendStatus('sending')
    try {
      const sent =
        activeThread.type === 'inquiry' && activeThread.listingId
          ? await sendListingInquiryMessage(activeThread.listingId, messageInput.trim())
          : await sendBookingMessage(activeThread.id, messageInput.trim(), isStaff)
      setThreadMessages((current) => [...current, sent])
      setMessageInput('')
      setSendStatus('idle')
    } catch {
      setSendStatus('error')
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} className="immo-inbox-page">
      <section style={navStyles.flowNav} aria-label={pick(lang, 'التنقل بين الخطوات', 'Step navigation', 'Navigation entre les étapes')}>
        <button style={navStyles.arrowButton} onClick={() => (window.location.hash = '/stays')} aria-label={t.previous}>
          ‹
        </button>
        <button style={navStyles.arrowButton} onClick={() => (window.location.hash = '/account/open')} aria-label={t.next}>
          ›
        </button>
      </section>

      <button className="immo-back" onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section className="immo-hero">
        <p>SYBNB V6</p>
        <h1>{t.title}</h1>
        <span>{t.subtitle}</span>
        <div className="immo-stats">
          <Stat label={t.bookings} value={String(bookingThreads.length)} />
          <Stat label={t.payments} value={String(paymentThreads.length)} />
          <Stat label={t.rides} value={String(rideThreads.length)} />
          <Stat label={t.gifts} value={String(giftThreads.length)} />
          <Stat label={t.balance} value={moneyText(overview?.wallet?.cachedBalanceMinor || 0, 'SYP', lang)} />
        </div>
        <button disabled={status === 'loading'} onClick={() => void loadOverview()}>
          {status === 'loading' ? t.loading : t.refresh}
        </button>
      </section>

      {status === 'error' && <section className="immo-alert">{message}</section>}

      {messagingLocked ? (
        <section className="immo-alert">
          <strong>{t.lockedTitle}</strong>
          <p>{t.lockedCopy}</p>
        </section>
      ) : (
      <>
      <section className="immo-inbox-shell">
        <aside className="immo-thread-list">
          <div className="immo-section-head">
            <span>{t.unified}</span>
            <strong>{visibleThreads.length}</strong>
          </div>
          <div className="immo-filter-row">
            {filterItems.map((item) => (
              <button
                className={activeType === item.id ? 'active' : ''}
                key={item.id}
                onClick={() => {
                  setActiveType(item.id)
                  setActiveThreadId('')
                }}
              >
                {item.label} <b>{item.count}</b>
              </button>
            ))}
          </div>
          <div className="immo-thread-stack">
            {visibleThreads.length ? visibleThreads.map((thread) => (
              <ThreadCard
                active={activeThread?.id === thread.id}
                key={thread.id}
                lang={lang}
                thread={thread}
                onSelect={() => setActiveThreadId(thread.id)}
              />
            )) : <p className="immo-empty">{t.empty}</p>}
          </div>
        </aside>

        <section className="immo-conversation">
          <div className="immo-section-head">
            <span>{t.conversation}</span>
            {activeThread && <strong>{threadTypeText(activeThread.type, lang)}</strong>}
          </div>
          {activeThread ? (
            <>
              {isStaff && (
              <section className="immo-command-strip">
                <article>
                  <span>{t.sla}</span>
                  <strong>{activeThread.priority === 'urgent' ? (pick(lang, '١٥ دقيقة', '15 min', '15 min')) : (pick(lang, '٤ ساعات', '4 hours', '4 heures'))}</strong>
                </article>
                <article>
                  <span>{t.trustSignal}</span>
                  <strong>{activeThread.type === 'payment' ? (pick(lang, 'دفع محمي', 'Protected payment', 'Paiement protégé')) : (pick(lang, 'سجل مرتبط', 'Linked record', 'Dossier associé'))}</strong>
                </article>
                <article>
                  <span>{t.riskLevel}</span>
                  <strong>{activeThread.priority === 'urgent' ? (pick(lang, 'مرتفع', 'High', 'Élevé')) : (pick(lang, 'طبيعي', 'Normal', 'Normal'))}</strong>
                </article>
              </section>
              )}
              <article className="immo-chat-card">
                <span>{activeThread.status}</span>
                <h2>{activeThread.title}</h2>
                <p>{activeThread.subtitle}</p>
              </article>
              <div className="immo-message-stack">
                {activeThread.type !== 'booking' && activeThread.type !== 'inquiry' ? (
                  <p className="immo-empty">{t.noMessagingForType}</p>
                ) : messagesStatus === 'loading' ? (
                  <p className="immo-empty">{t.loading}</p>
                ) : messagesStatus === 'locked' ? (
                  <p className="immo-empty">{t.messagingNotEligible}</p>
                ) : threadMessages.length === 0 ? (
                  <p className="immo-empty">{t.noMessagesYet}</p>
                ) : (
                  <>
                  {hasMoreMessages && (
                    <button className="immo-load-earlier" disabled={loadingEarlier} onClick={() => void loadEarlierMessages()}>
                      {loadingEarlier ? t.loadingEarlier : t.loadEarlier}
                    </button>
                  )}
                  {threadMessages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      align={msg.senderRole === 'GUEST' ? 'user' : 'admin'}
                      text={`${msg.sender?.displayName || msg.senderRole}: ${msg.body}`}
                    />
                  ))}
                  </>
                )}
              </div>
              {(activeThread.type === 'booking' || activeThread.type === 'inquiry') && messagesStatus === 'idle' && (
                <div className="immo-message-input-row">
                  <textarea
                    value={messageInput}
                    onChange={(event) => setMessageInput(event.target.value)}
                    placeholder={t.messagePlaceholder}
                  />
                  <button disabled={!messageInput.trim() || sendStatus === 'sending'} onClick={() => void sendMessage()}>
                    {sendStatus === 'sending' ? t.sending : t.send}
                  </button>
                  {sendStatus === 'error' && <p className="immo-alert">{t.sendError}</p>}
                </div>
              )}
              {isStaff && (
              <div className="immo-template-row">
                {t.templates.map((template) => (
                  <button key={template} onClick={() => setMessageInput(template)}>
                    {template}
                  </button>
                ))}
              </div>
              )}
              {isStaff && (
              <article className="immo-ai-next">
                <strong>{t.aiNext}</strong>
                <p>{t.aiNextCopy}</p>
                <div>
                  <button onClick={() => (window.location.hash = '/operations')}>{t.operationsLink}</button>
                  <button onClick={() => (window.location.hash = '/finance')}>{t.financeLink}</button>
                </div>
              </article>
              )}
            </>
          ) : (
            <p className="immo-empty">{t.noThread}</p>
          )}
        </section>

        <aside className="immo-context-panel">
          <div className="immo-section-head">
            <span>{t.context}</span>
            <strong>AI</strong>
          </div>
          {activeThread ? (
            <>
              <ContextRow label={t.linkedRecord} value={activeThread.id.slice(0, 12).toUpperCase()} />
              <ContextRow label={t.status} value={activeThread.status} />
              {isStaff && (
                <ContextRow label={t.teamHandoff} value={activeThread.priority === 'urgent' ? (pick(lang, 'الدعم + المالية', 'Support + finance', 'Support + finances')) : (pick(lang, 'الدعم', 'Support', 'Support'))} />
              )}
              <ContextRow label={t.trust} value={pick(lang, 'محمي عبر SYBNB', 'Protected by SYBNB', 'Protégé par SYBNB')} />
              <button className="immo-open-record" onClick={() => (window.location.hash = activeThread.href)}>
                {t.open}
              </button>
              {activeThread.type === 'booking' && (
                <button className="immo-open-record secondary" onClick={() => (window.location.hash = `/booking/protection/${activeThread.id}`)}>
                  {pick(lang, 'حماية الحجز', 'Booking protection', 'Protection de la réservation')}
                </button>
              )}
            </>
          ) : <p className="immo-empty">{t.noThread}</p>}
        </aside>
      </section>

      <section className="immo-support">
        <strong>{t.support}</strong>
        <p>{t.supportCopy}</p>
      </section>
      </>
      )}
    </main>
  )
}

function ThreadCard({ active, lang, onSelect, thread }: { active: boolean; lang: Lang; onSelect: () => void; thread: Thread }) {
  return (
    <button className={`immo-thread-card ${active ? 'active' : ''} ${thread.priority}`} onClick={onSelect}>
      <div>
        <span>{threadTypeText(thread.type, lang)}</span>
        <strong>{thread.title}</strong>
        <p>{thread.subtitle}</p>
      </div>
      <small>{thread.status}</small>
    </button>
  )
}

function MessageBubble({ align, text }: { align: 'system' | 'user' | 'admin'; text: string }) {
  return <p className={`immo-message ${align}`}>{text}</p>
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <article className="immo-context-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function threadTypeText(type: Thread['type'], lang: Lang) {
  const labels: Record<Thread['type'], Record<Lang, string>> = {
    booking: { ar: 'حجز', en: 'Booking', fr: 'Réservation' },
    payment: { ar: 'دفع', en: 'Payment', fr: 'Paiement' },
    ride: { ar: 'رحلة', en: 'Ride', fr: 'Course' },
    gift: { ar: 'هدية', en: 'Gift', fr: 'Cadeau' },
    inquiry: { ar: 'استفسار', en: 'Inquiry', fr: 'Demande de renseignements' },
  }
  return labels[type][lang]
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="immo-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function bookingThread(booking: PlatformBooking & { listing?: StaffBookingListing }, lang: Lang): Thread {
  const listing = booking.listing
  const title = listing ? listingTitleText(listing, lang) : booking.id
  return {
    id: booking.id,
    title,
    subtitle: moneyText(booking.amountMinor, booking.currency, lang),
    status: statusText(booking.status, lang),
    rawStatus: booking.status,
    href: `/booking/${booking.id}`,
    type: 'booking',
    priority: booking.status === 'DISPUTED' ? 'urgent' : booking.status === 'REQUESTED' ? 'new' : 'waiting',
  }
}

function paymentThread(payment: PlatformPaymentProof, lang: Lang): Thread {
  return {
    id: payment.id,
    title: payment.providerRef || providerText(payment.provider, lang),
    subtitle: moneyText(payment.amountMinor, payment.currency, lang),
    status: statusText(payment.status, lang),
    href: `/payment/receipt/${payment.id}`,
    type: 'payment',
    priority: payment.status === 'PENDING_ADMIN_REVIEW' ? 'urgent' : payment.status === 'APPROVED' ? 'closed' : 'waiting',
  }
}

function rideThread(ride: PlatformRideRequest, lang: Lang): Thread {
  return {
    id: ride.id,
    title: String(ride.metadata.pickup || ride.id.slice(0, 8).toUpperCase()),
    subtitle: String(ride.metadata.dropoff || moneyText(ride.fareMinor || 0, ride.currency, lang)),
    status: statusText(ride.status, lang),
    href: '/ride',
    type: 'ride',
    priority: ride.status === 'REQUESTED' ? 'new' : ride.status === 'COMPLETED' ? 'closed' : 'waiting',
  }
}

function inquiryThread(thread: PlatformMyInquiryThread, lang: Lang): Thread {
  const listing = thread.listing
  const lastMessage = thread.messages[0]
  return {
    id: thread.id,
    listingId: thread.listingId || listing?.id,
    title: listing ? listingTitleText(listing, lang) : thread.id,
    subtitle: listing ? moneyText(listing.priceMinor, listing.currency, lang) : '',
    status: lastMessage ? (lastMessage.senderRole === 'GUEST' ? (pick(lang, 'بانتظار الرد', 'Awaiting reply', 'En attente de réponse')) : (pick(lang, 'تم الرد', 'Replied', 'Répondu'))) : (pick(lang, 'جديد', 'New', 'Nouveau')),
    href: listing ? `/listing/${listing.id}` : '/',
    type: 'inquiry',
    priority: lastMessage?.senderRole === 'GUEST' ? 'waiting' : 'new',
  }
}

function giftThread(gift: Record<string, unknown>, direction: 'sent' | 'claimed', lang: Lang): Thread {
  return {
    id: `${direction}-${String(gift.id || Math.random())}`,
    title: direction === 'sent' ? (pick(lang, 'هدية مرسلة', 'Sent gift', 'Cadeau envoyé')) : (pick(lang, 'هدية مستلمة', 'Claimed gift', 'Cadeau reçu')),
    subtitle: moneyText(Number(gift.amountMinor || 0), String(gift.currency || 'SYP'), lang),
    status: statusText(String(gift.status || '-'), lang),
    href: '/wallet',
    type: 'gift',
    priority: String(gift.status || '').includes('PENDING') ? 'waiting' : 'closed',
  }
}

const navStyles = {
  flowNav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  arrowButton: { width: 46, height: 46, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 30, fontWeight: 950, display: 'grid', placeItems: 'center' },
} as const
