import { useEffect, useState } from 'react'
import { IdPrivacyBadge } from '../../shared/trust/IdPrivacyBadge'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { disputePrototypeBooking, fetchPrototypeBooking, submitGuestIdDocument, type PlatformBooking, type PlatformListing } from '../../shared/api/platformApi'
import { listingTitleText } from '../../shared/i18n/display'
import { CaseStatusCapsule, type CaseStatusMap, type CaseStatusOutcome, type CaseStatusStepDef } from '../../shared/capsules/CaseStatusCapsule'
export { isTrustProtectionRoute } from './trustRoutes'

type Props = {
  lang: Lang
  path: string
}

const DEFAULT_BOOKING = 'BK-2026-0042'

export function TrustProtectionRoutes({ lang, path }: Props) {
  const pathParts = path.split('/')
  const bookingId = pathParts[pathParts.length - 1] || DEFAULT_BOOKING

  if (path === '/trust-center/verification') return <TrustVerification lang={lang} />
  if (path === '/trust-center/sos') return <TrustSos lang={lang} />
  if (path.startsWith('/booking/guarantee/')) return <GuaranteeTiers lang={lang} bookingId={bookingId} />
  if (path.startsWith('/booking/payment-status/')) return <PaymentProofStatus lang={lang} bookingId={bookingId} />
  if (path.startsWith('/booking/dispute-closed/')) return <DisputeClosedFeedback lang={lang} bookingId={bookingId} />
  if (path.startsWith('/booking/dispute/')) return <DisputeFlow lang={lang} bookingId={bookingId} />
  if (path.startsWith('/booking/protection/')) return <BookingProtectionHub lang={lang} bookingId={bookingId} />
  return <TrustCenterHome lang={lang} />
}

function TrustCenterHome({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'مركز الثقة' : 'Trust Center'} />
      {/* No trust-score computation exists yet — a specific invented number (was hardcoded 94) would
          be a false, unverifiable claim. Show the real, verifiable step instead: identity verification. */}
      <section className="trust-score-card">
        <h2>{isAr ? 'وثّق هويتك' : 'Verify your identity'}</h2>
        <p>{isAr ? 'رفع مستند هوية معتمد يزيد ثقة المضيفين والمشترين بحسابك.' : 'Uploading an approved ID document increases how much hosts and buyers trust your account.'}</p>
      </section>

      <section className="trust-list">
        <TrustRow active label={isAr ? 'الهوية الوطنية' : 'National ID'} href="/trust-center/verification" />
      </section>

      <section className="trust-action-grid">
        <button className="danger" onClick={() => (window.location.hash = '/trust-center/sos')}><b>!</b>{isAr ? 'الدعم' : 'Support'}</button>
        <button onClick={() => (window.location.hash = '/immocontact')}><b>⚑</b>{isAr ? 'تقديم بلاغ' : 'Submit a report'}</button>
      </section>
    </main>
  )
}

function TrustVerification({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'submitted' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit() {
    if (!file) return
    setStatus('uploading')
    setError('')
    try {
      await submitGuestIdDocument(file)
      setStatus('submitted')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : (isAr ? 'تعذر إرسال المستند.' : 'Could not submit the document.'))
    }
  }

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'توثيق الهوية' : 'Identity Verification'} />
      <div className="trust-stepper"><span /><span /><strong>1</strong></div>
      <h2 className="trust-section-title">{isAr ? 'صورة الهوية الوطنية' : 'National ID photo'}</h2>
      <label className="trust-upload active" style={{ cursor: 'pointer' }}>
        <input
          accept="image/png,image/jpeg,application/pdf"
          style={{ display: 'none' }}
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        ▣<span>{file ? file.name : (isAr ? 'ارفع صورة الهوية الوطنية' : 'Upload your national ID photo')}</span>
      </label>
      <IdPrivacyBadge lang={lang} />
      <p className="trust-note">ⓘ {isAr ? 'بياناتك مشفرة بالكامل ولن يتم مشاركتها مع أي طرف ثالث.' : 'Your data is encrypted and will not be shared with third parties.'}</p>
      {status === 'submitted' && (
        <p className="trust-note">✓ {isAr ? 'تم إرسال طلب التوثيق للمراجعة. ستظهر حالة الطلب في حسابك بعد مراجعة الإدارة.' : 'Verification was submitted for review. The status will appear on your account once admin reviews it.'}</p>
      )}
      {status === 'error' && <p className="trust-note">{error}</p>}
      <button
        className="trust-primary"
        disabled={!file || status === 'uploading' || status === 'submitted'}
        onClick={() => void submit()}
      >
        {status === 'submitted'
          ? (isAr ? 'تم الإرسال' : 'Submitted')
          : status === 'uploading'
            ? (isAr ? 'جارٍ الإرسال...' : 'Sending...')
            : (isAr ? 'إرسال للمراجعة' : 'Submit for review')}
      </button>
    </main>
  )
}


function TrustSos({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  // IMPORTANT (safety/honesty): this screen previously claimed local authorities are contacted
  // automatically and that precise location is sent to "AI Brain" — neither is implemented; the
  // button only opened a support chat. A real user in danger relying on that false promise instead
  // of calling emergency services directly would be genuinely harmful. Copy corrected to describe
  // exactly what happens: it opens a chat with SYBNB support — nothing is dispatched automatically.
  return (
    <main className="trust-phone trust-sos-page" dir={isAr ? 'rtl' : 'ltr'}>
      <h1>{isAr ? 'التواصل مع الدعم' : 'Contact Support'}</h1>
      <p>{isAr ? 'إذا كنت في خطر حقيقي، اتصل بالطوارئ المحلية فوراً. هذا الزر يفتح محادثة مع فريق دعم SYBNB.' : 'If you are in real danger, call local emergency services immediately. This button opens a chat with SYBNB support.'}</p>
      <button className="sos-pulse" onClick={() => (window.location.hash = '/immocontact')}>{isAr ? 'تواصل مع الدعم' : 'Contact support'}</button>
      <span>{isAr ? 'لا يتم إبلاغ أي جهة تلقائياً — الزر يفتح محادثة دعم فقط.' : 'Nothing is contacted automatically — this only opens a support chat.'}</span>
      <div className="trust-sos-actions">
        <button onClick={() => (window.location.hash = '/immocontact')}>{isAr ? 'تقديم بلاغ' : 'Submit a report'} <b>⌁</b></button>
        <button onClick={() => (window.location.hash = '/immocontact')}>{isAr ? 'تحدث مع الدعم الفني' : 'Talk to support'} <b>○</b></button>
      </div>
    </main>
  )
}

function BookingProtectionHub({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  const shortId = bookingIdLabel(bookingId)
  const [booking, setBooking] = useState<(PlatformBooking & { listing?: PlatformListing }) | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchPrototypeBooking(bookingId)
      .then((result) => { if (!cancelled) setBooking(result) })
      .catch(() => { if (!cancelled) setBooking(null) })
    return () => {
      cancelled = true
    }
  }, [bookingId])

  // Check-in/check-out are midnight-UTC dates -- an explicit UTC timeZone keeps this in sync
  // with what was actually booked for any viewer west of UTC (same bug/fix as DashboardPage.tsx).
  const dateRange =
    booking?.checkIn && booking?.checkOut
      ? `${new Date(booking.checkIn).toLocaleDateString(isAr ? 'ar' : 'en', { timeZone: 'UTC' })} - ${new Date(booking.checkOut).toLocaleDateString(isAr ? 'ar' : 'en', { timeZone: 'UTC' })}`
      : ''

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'حماية الحجز' : 'Booking Protection'} />
      <section className="booking-protected-card">
        <small>{isAr ? 'محمي' : 'Protected'}</small>
        <span>{shortId} ♢</span>
        <h2>{booking?.listing ? listingTitleText(booking.listing, lang) : shortId}</h2>
        {dateRange && <p>{dateRange}</p>}
      </section>
      <h2 className="trust-section-title">{isAr ? 'ما الذي تتم حمايته؟' : 'What is protected?'}</h2>
      <section className="protection-list">
        {(isAr
          ? ['يُحتجز المبلغ بانتظار التسوية', 'تُطبَّق سياسة إلغاء المضيف', 'تُراجَع بلاغات اختلاف الوصف', 'مراجعة النزاعات متاحة']
          : ['Payment held pending settlement', 'Host-cancellation policy applies', 'Misrepresentation reports reviewed', 'Dispute review available']
        ).map((label, index) => <article key={label}><b>{index === 3 ? '✓' : '✓'}</b><span>{label}</span></article>)}
      </section>
      <span className="protection-badge">{isAr ? 'حماية الحجز عبر SYBNB' : 'SYBNB booking protection'}</span>
      <button className="trust-primary" onClick={() => (window.location.hash = `/booking/guarantee/${bookingId}`)}>{isAr ? 'عرض تفاصيل الحماية' : 'View protection details'}</button>
    </main>
  )
}

function GuaranteeTiers({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  // Only two protection levels actually exist server-side: every booking gets free Standard
  // protection, and cancellationProtectionPurchased is a single optional paid add-on (see
  // server/lib/finance-ledger.mjs CANCELLATION_PROTECTION_RATE) — there is no third "Premium"
  // tier or per-tier pricing anywhere in the backend, so it was removed rather than shown as if
  // it were a real, selectable product.
  const tiers = [
    { title: isAr ? 'Standard' : 'Standard', body: isAr ? 'حماية أساسية مجانية لكل الحجوزات' : 'Free basic protection on every booking', tone: 'gray' },
    { title: isAr ? 'Protected' : 'Protected', body: isAr ? 'إضافة حماية إلغاء اختيارية بمقابل رسوم' : 'Optional paid cancellation-protection add-on', tone: 'blue' },
  ]
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'ضمان الحجز' : 'Booking Guarantee'} />
      <section className="guarantee-tiers">
        {tiers.map((tier) => (
          <article className={tier.tone} key={tier.title}>
            <strong>{tier.title}</strong>
            <span>{tier.body}</span>
          </article>
        ))}
      </section>
      <p className="trust-note">{isAr ? 'الحماية الأساسية مجانية لكل حجوزات SYBNB. حماية الإلغاء الاختيارية تُختار عند الدفع.' : 'Standard protection is free for every SYBNB booking. The optional cancellation-protection add-on is chosen at payment time.'}</p>
      <button className="trust-primary" onClick={() => (window.location.hash = `/booking/protection/${bookingId}`)}>{isAr ? 'عرض حماية حجزي' : 'View my booking protection'}</button>
    </main>
  )
}

function PaymentProofStatus({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  const [booking, setBooking] = useState<(PlatformBooking & { payments?: Array<{ provider?: string; status?: string }> }) | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchPrototypeBooking(bookingId)
      .then((result) => { if (!cancelled) setBooking(result as typeof booking) })
      .catch(() => { if (!cancelled) setBooking(null) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [bookingId])

  // Real status from the backend (2026-10-22) -- this page used to show a fixed "under review /
  // host approval / 1-2 hours" timeline even for a card payment that was already confirmed.
  const payments = booking?.payments || []
  const paidByCard = payments.some((p) => p.provider === 'stripe' && p.status === 'APPROVED')
  const proofPending = payments.some((p) => p.status === 'PENDING_ADMIN_REVIEW')
  const status = booking?.status || ''
  const steps = isAr
    ? ['الدفع', paidByCard ? 'تم التحقق من البطاقة' : 'مراجعة الإيصال', 'موافقة المضيف', 'تأكيد الحجز']
    : ['Payment', paidByCard ? 'Card verified' : 'Receipt review', 'Host approval', 'Booking confirmed']
  // How many steps are done: 0 nothing paid yet, 1 receipt sent, 2 payment verified (waiting for host), 4 confirmed.
  const done = status === 'CONFIRMED' || status === 'COMPLETED' ? 4 : status === 'REQUESTED' ? 2 : proofPending ? 1 : 0
  const cancelled = status === 'CANCELLED'
  const note = cancelled
    ? pick(lang, 'تم إلغاء هذا الحجز.', 'This booking was cancelled.', 'Cette réservation a été annulée.')
    : done === 4
      ? paidByCard
        ? pick(lang, 'تم الدفع بالبطاقة وتأكيد حجزك تلقائياً.', 'Paid by card — your booking was confirmed automatically.', 'Payé par carte — réservation confirmée automatiquement.')
        : pick(lang, 'تم تأكيد حجزك.', 'Your booking is confirmed.', 'Votre réservation est confirmée.')
      : done === 2
        ? pick(lang, 'تم التحقق من الدفع، بانتظار موافقة المضيف.', 'Payment verified, waiting for the host to accept.', 'Paiement vérifié, en attente de l’hôte.')
        : done === 1
          ? pick(lang, 'أرسلت إيصال الدفع، ويراجعه الفريق عادة خلال 1-2 ساعة عمل.', 'Your receipt was sent; the team usually reviews it within 1-2 business hours.', 'Reçu envoyé ; vérification en général sous 1 à 2 heures ouvrées.')
          : pick(lang, 'لم يتم الدفع بعد.', 'Not paid yet.', 'Pas encore payé.')
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'حالة الدفع' : 'Payment Status'} />
      <span className="booking-code">{bookingIdLabel(bookingId)}</span>
      {!loaded ? (
        <p className="trust-muted">{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p>
      ) : (
        <>
          <section className="payment-timeline" data-testid="payment-timeline">
            {steps.map((step, index) => (
              <article className={!cancelled && index < done ? 'done' : !cancelled && index === done ? 'active' : ''} key={step}>
                <b>{!cancelled && index < done ? '✓' : '●'}</b>
                <div><strong>{step}</strong></div>
              </article>
            ))}
          </section>
          <p className="trust-note" data-testid="payment-status-note">{note}</p>
        </>
      )}
      <section className="safe-money-card">
        <strong>♢ {isAr ? 'ادفع عبر قنوات SYBNB المعتمدة فقط' : 'Pay only through SYBNB-approved channels'}</strong>
        <p>{isAr ? 'لا يُحوَّل المبلغ للمضيف قبل إتمام الإقامة.' : 'Funds are not released to the host until the stay is completed.'}</p>
      </section>
      <button className="trust-primary" onClick={() => (window.location.hash = `/booking/${bookingId}`)}>{pick(lang, 'عرض الحجز', 'View booking', 'Voir la réservation')}</button>
    </main>
  )
}

function DisputeFlow({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  const [reason, setReason] = useState<'cancellation' | 'wrong-description' | 'payment-issue'>('wrong-description')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState('')
  const reasonLabels: Record<typeof reason, string> = isAr
    ? { cancellation: 'إلغاء', 'wrong-description': 'وصف غير صحيح', 'payment-issue': 'مشكلة دفع' }
    : { cancellation: 'Cancellation', 'wrong-description': 'Wrong description', 'payment-issue': 'Payment issue' }

  async function submit() {
    if (!note.trim()) {
      setError(isAr ? 'اكتب وصف المشكلة أولاً.' : 'Write a problem description first.')
      return
    }
    setStatus('saving')
    setError('')
    try {
      await disputePrototypeBooking(bookingId, `${reasonLabels[reason]}: ${note.trim()}`)
      window.location.hash = `/booking/dispute-closed/${bookingId}`
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : (isAr ? 'تعذر إرسال النزاع.' : 'Could not submit the dispute.'))
    }
  }

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'فتح نزاع' : 'Open Dispute'} />
      <span className="booking-code">{bookingIdLabel(bookingId)}</span>
      <section className="dispute-chips">
        {(Object.keys(reasonLabels) as Array<typeof reason>).map((key) => (
          <button className={key === reason ? 'active' : ''} key={key} onClick={() => setReason(key)}>{reasonLabels[key]}</button>
        ))}
      </section>
      <label className="dispute-field">
        <span>{isAr ? 'وصف المشكلة' : 'Problem description'}</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={isAr ? 'اشرح ما حدث بوضوح...' : 'Explain clearly what happened...'}
        />
      </label>
      {/* Real evidence-file upload isn't wired to any storage yet — direct the guest to a channel
          that actually delivers the file, same pattern used for ID documents. */}
      <button className="trust-upload active" onClick={() => (window.location.hash = '/immocontact')}>＋<span>{isAr ? 'أرسل صورة أو إثبات عبر المحادثة' : 'Send photo or evidence via chat'}</span></button>
      {error && <p className="trust-note" style={{ color: '#ff5f76' }}>{error}</p>}
      <button className="trust-primary" disabled={status === 'saving'} onClick={() => void submit()}>
        {status === 'saving' ? (isAr ? 'جار الإرسال...' : 'Submitting...') : isAr ? 'إرسال النزاع' : 'Submit dispute'}
      </button>
    </main>
  )
}

function DisputeClosedFeedback({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  const [booking, setBooking] = useState<PlatformBooking | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Fetch-on-mount (same pattern as BookingProtectionHub above): this screen is reached via a full
  // navigation from DisputeFlow, and may also be reached later via back/forward nav or a bookmark,
  // so it must never render a stale or assumed status -- only what the backend says right now.
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    fetchPrototypeBooking(bookingId)
      .then((result) => {
        if (cancelled) return
        setBooking(result)
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setBooking(null)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [bookingId])

  const steps: CaseStatusStepDef[] = isAr
    ? [
        { key: 'opened', label: 'فتح النزاع' },
        { key: 'review', label: 'قيد المراجعة من SYBNB' },
      ]
    : [
        { key: 'opened', label: 'Dispute opened' },
        { key: 'review', label: 'Under review by SYBNB' },
      ]

  // CAPSULE_RULES.noFabricatedResolution: every branch below must come straight from the real
  // booking.status returned by the backend -- never a hardcoded "closed"/"decision made" claim.
  const statusMap: CaseStatusMap = {
    DISPUTED: {
      stepIndex: 1,
      pending: true,
      title: isAr ? 'تم إرسال النزاع' : 'Dispute Submitted',
      body: isAr
        ? 'تم إرسال نزاعك وحجزك الآن قيد المراجعة. سنُحدّث هذه الصفحة بمجرد أن يتخذ فريق SYBNB قراراً.'
        : "Your dispute was submitted and your booking is now under review. We'll update you here once SYBNB makes a decision.",
    },
    CONFIRMED: {
      stepIndex: 1,
      pending: false,
      title: isAr ? 'تمت مراجعة النزاع' : 'Dispute Reviewed',
      body: isAr
        ? 'راجع فريق SYBNB هذا النزاع، وتم تأكيد الحجز كما هو دون أي تغيير.'
        : 'SYBNB reviewed this dispute. The booking was confirmed — no change was made.',
    },
    CANCELLED: {
      stepIndex: 1,
      pending: false,
      title: isAr ? 'تمت مراجعة النزاع' : 'Dispute Reviewed',
      body: isAr
        ? 'راجع فريق SYBNB هذا النزاع وتم إلغاء الحجز. تم تقديم طلب استرداد المبلغ وهو الآن قيد المعالجة.'
        : 'SYBNB reviewed this dispute and the booking was cancelled. A refund was requested and is being processed.',
    },
  }

  const fallback: CaseStatusOutcome = {
    stepIndex: 0,
    pending: true,
    title: isAr ? 'تم إرسال النزاع' : 'Dispute Submitted',
    body: isAr
      ? 'تم إرسال نزاعك. راجع لوحة التحكم لمعرفة آخر حالة.'
      : 'Your dispute was submitted. Check your dashboard for the latest status.',
  }

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'حالة النزاع' : 'Dispute Status'} />
      <CaseStatusCapsule
        status={booking?.status || ''}
        steps={steps}
        statusMap={statusMap}
        fallback={fallback}
        loading={!loaded}
        loadingLabel={isAr ? 'جارٍ التحميل...' : 'Loading...'}
        caseLabel={bookingIdLabel(bookingId)}
      />
      <button className="trust-primary" onClick={() => (window.location.hash = '/dashboard')}>{isAr ? 'العودة لرحلتي' : 'Return to my trip'}</button>
    </main>
  )
}

function TrustHeader({ title }: { title: string }) {
  return (
    <header className="trust-header">
      <button onClick={() => window.history.back()}>‹</button>
      <h1>{title}</h1>
      <span>♢</span>
    </header>
  )
}

function TrustRow({ label, done = false, active = false, href }: { label: string; done?: boolean; active?: boolean; href?: string }) {
  return (
    <button className={active ? 'active' : ''} onClick={() => href && (window.location.hash = href)}>
      <b>{done ? '✓' : active ? '◷' : '○'}</b>
      <span>{label}</span>
      <small>‹</small>
    </button>
  )
}


function bookingIdLabel(id: string) {
  if (id.startsWith('BK-')) return id
  return `BK-${id.slice(0, 8).toUpperCase()}`
}
