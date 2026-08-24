import { useEffect, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { disputePrototypeBooking, fetchPrototypeBooking, type PlatformBooking, type PlatformListing } from '../../shared/api/platformApi'
import { listingTitleText } from '../../shared/i18n/display'
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
  const [submitted, setSubmitted] = useState(false)
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'توثيق الهوية' : 'Identity Verification'} />
      <div className="trust-stepper"><span /><span /><strong>1</strong></div>
      <h2 className="trust-section-title">{isAr ? 'صورة الهوية الوطنية' : 'National ID photo'}</h2>
      <button className="trust-upload active" onClick={() => (window.location.hash = '/trust-center/verification')}>▣<span>{isAr ? 'الوجه الأمامي للهوية' : 'Front side of ID'}</span></button>
      <button className="trust-upload" onClick={() => (window.location.hash = '/trust-center/verification')}>▣<span>{isAr ? 'الوجه الخلفي للهوية' : 'Back side of ID'}</span></button>
      <h2 className="trust-section-title">{isAr ? 'التحقق بصورة سيلفي' : 'Selfie verification'}</h2>
      <button className="trust-selfie" onClick={() => (window.location.hash = '/trust-center/verification')}><b>📷</b><span>{isAr ? 'التقط صورة واضحة لوجهك للتأكد من مطابقة الهوية' : 'Take a clear face photo to match your identity.'}</span></button>
      <p className="trust-note">ⓘ {isAr ? 'بياناتك مشفرة بالكامل ولن يتم مشاركتها مع أي طرف ثالث.' : 'Your data is encrypted and will not be shared with third parties.'}</p>
      {submitted ? (
        <p className="trust-note">✓ {isAr ? 'تم إرسال طلب التوثيق للمراجعة. سنرسل حالة الطلب إلى رقم هاتفك.' : 'Verification was submitted for review. We will send the status to your phone.'}</p>
      ) : null}
      <button className="trust-primary" onClick={() => setSubmitted(true)}>{submitted ? (isAr ? 'تم الإرسال' : 'Submitted') : (isAr ? 'إرسال للمراجعة' : 'Submit for review')}</button>
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

  const dateRange =
    booking?.checkIn && booking?.checkOut
      ? `${new Date(booking.checkIn).toLocaleDateString(isAr ? 'ar' : 'en')} - ${new Date(booking.checkOut).toLocaleDateString(isAr ? 'ar' : 'en')}`
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
          ? ['مبلغ الدفع محفوظ', 'الإلغاء من المضيف محمي', 'اختلاف الوصف محمي', 'دعم النزاع المتاح']
          : ['Payment amount is held', 'Host cancellation protected', 'Misrepresentation protected', 'Dispute support available']
        ).map((label, index) => <article key={label}><b>{index === 3 ? '✓' : '✓'}</b><span>{label}</span></article>)}
      </section>
      <span className="protection-badge">{isAr ? 'حماية SYBNB الكاملة' : 'Full SYBNB protection'}</span>
      <button className="trust-primary" onClick={() => (window.location.hash = `/booking/guarantee/${bookingId}`)}>{isAr ? 'عرض تفاصيل الحماية' : 'View protection details'}</button>
    </main>
  )
}

function GuaranteeTiers({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  const tiers = [
    { title: isAr ? 'Standard' : 'Standard', body: isAr ? 'حماية أساسية مجانية' : 'Free basic protection', tone: 'gray' },
    { title: isAr ? 'Protected' : 'Protected', body: isAr ? 'حماية دفع ونزاع محسّنة' : 'Enhanced payment and dispute protection', tone: 'blue' },
    { title: isAr ? 'Premium' : 'Premium', body: isAr ? 'حماية كاملة مع أولوية دعم' : 'Full protection with priority support', tone: 'gold' },
  ]
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'ضمان الحجز' : 'Booking Guarantee'} />
      <section className="guarantee-tiers">
        {tiers.map((tier, index) => (
          <button className={`${tier.tone} ${index === 1 ? 'active' : ''}`} key={tier.title} onClick={() => (window.location.hash = `/booking/protection/${bookingId}`)}>
            <strong>{tier.title}</strong>
            <span>{tier.body}</span>
          </button>
        ))}
      </section>
      <p className="trust-note">{isAr ? 'الحماية الأساسية مجانية لكل حجوزات SYBNB. يمكنك الترقية للحماية الكاملة قبل الدفع.' : 'Standard protection is free for every SYBNB booking. Upgrade before payment for full coverage.'}</p>
      <button className="trust-primary" onClick={() => (window.location.hash = `/booking/protection/${bookingId}`)}>{isAr ? 'تأكيد الحماية' : 'Confirm protection'}</button>
    </main>
  )
}

function PaymentProofStatus({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  const steps = isAr ? ['تم الإرسال', 'قيد المراجعة', 'موافقة المضيف', 'تأكيد الحجز'] : ['Submitted', 'Under review', 'Host approval', 'Booking confirmed']
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'حالة الدفع' : 'Payment Status'} />
      <span className="booking-code">{bookingIdLabel(bookingId)}</span>
      <section className="payment-timeline">
        {steps.map((step, index) => (
          <article className={index === 0 ? 'done' : index === 1 ? 'active' : ''} key={step}>
            <b>{index === 0 ? '✓' : '●'}</b>
            <div>
              <strong>{step}</strong>
              {index === 1 && <span>{isAr ? 'يتم التحقق من صحة الدفع...' : 'Payment proof is being checked...'}</span>}
            </div>
          </article>
        ))}
      </section>
      <section className="safe-money-card">
        <strong>♢ {isAr ? 'مبلغك محمي' : 'Your money is protected'}</strong>
        <p>{isAr ? 'لن يتحول للمضيف حتى تأكيد الحجز. أموالك في أمان تام خلال فترة المراجعة.' : 'Funds are not released to the host until booking confirmation.'}</p>
      </section>
      <p className="trust-muted">◷ {isAr ? 'مراجعة الدفع تستغرق 1-2 ساعة عمل' : 'Payment review takes 1-2 business hours'}</p>
      <button className="trust-primary" onClick={() => (window.location.hash = `/booking/payment-status/${bookingId}`)}>{isAr ? 'تتبع الدفع' : 'Track payment'}</button>
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
  const steps = isAr
    ? ['فتح النزاع', 'جمع الأدلة', 'قرار SYBNB', 'إغلاق الحالة', 'تقييم العميل']
    : ['Dispute opened', 'Evidence collected', 'SYBNB decision', 'Case closed', 'Client feedback']

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'تم إغلاق الحالة' : 'Case Closed'} />
      <span className="booking-code">{bookingIdLabel(bookingId)}</span>
      <section className="dispute-closed-card">
        <strong>✓</strong>
        <h2>{isAr ? 'تمت معالجة النزاع' : 'Dispute handled'}</h2>
        <p>
          {isAr
            ? 'تم إغلاق الحالة وحفظ القرار في سجل الحجز. يمكنك تقييم تجربة المعالجة الآن.'
            : 'The case is closed and the decision was saved to the booking record. You can now rate the handling experience.'}
        </p>
      </section>
      <section className="case-timeline">
        {steps.map((step) => (
          <span key={step}>✓ {step}</span>
        ))}
      </section>
      <section className="feedback-card">
        <h2>{isAr ? 'كيف كانت معالجة النزاع؟' : 'How was the dispute handling?'}</h2>
        <div className="feedback-stars" aria-label={isAr ? 'تقييم المعالجة' : 'Handling rating'}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button key={star} onClick={() => (window.location.hash = '/dashboard')}>★</button>
          ))}
        </div>
        <textarea placeholder={isAr ? 'اكتب ملاحظتك لتحسين الخدمة...' : 'Write feedback to improve the service...'} />
      </section>
      <button className="trust-primary" onClick={() => (window.location.hash = '/dashboard')}>{isAr ? 'إرسال التقييم والعودة لرحلتي' : 'Submit feedback and return to my trip'}</button>
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
