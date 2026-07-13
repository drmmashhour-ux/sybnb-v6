import { useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
export { isTrustProtectionRoute } from './trustRoutes'

type Props = {
  lang: Lang
  path: string
}

const TRUST_SCORE = 94
const DEFAULT_BOOKING = 'BK-2026-0042'

export function TrustProtectionRoutes({ lang, path }: Props) {
  const pathParts = path.split('/')
  const bookingId = pathParts[pathParts.length - 1] || DEFAULT_BOOKING

  if (path === '/trust-center/verification') return <TrustVerification lang={lang} />
  if (path === '/trust-center/score') return <TrustScoreBreakdown lang={lang} />
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
      <section className="trust-score-card">
        <span className="trust-score-check">✓</span>
        <strong>{TRUST_SCORE}</strong>
        <h2>{isAr ? 'مستوى الثقة ممتاز' : 'Excellent trust level'}</h2>
        <p>{isAr ? 'هويتك موثقة بالكامل تقريباً. أكمل الخطوات المتبقية للوصول للدرجة الكاملة.' : 'Your profile is almost fully trusted. Complete the remaining steps to reach the full score.'}</p>
      </section>

      <section className="trust-list">
        <TrustRow done label={isAr ? 'توثيق الهاتف' : 'Phone verified'} />
        <TrustRow done label={isAr ? 'البريد الإلكتروني' : 'Email verified'} />
        <TrustRow active label={isAr ? 'الهوية الوطنية' : 'National ID'} href="/trust-center/verification" />
        <TrustRow label={isAr ? 'بصمة الوجه' : 'Face verification'} href="/trust-center/verification" />
      </section>

      <section className="trust-action-grid">
        <button className="danger" onClick={() => (window.location.hash = '/trust-center/sos')}><b>!</b>{isAr ? 'طوارئ SOS' : 'SOS'}</button>
        <button onClick={() => (window.location.hash = '/immocontact')}><b>⚑</b>{isAr ? 'تقرير صامت' : 'Silent report'}</button>
        <button onClick={() => (window.location.hash = '/operations')}><b>⌖</b>{isAr ? 'مشاركة الموقع' : 'Share location'}</button>
      </section>

      <button className="trust-primary" onClick={() => (window.location.hash = '/trust-center/score')}>{isAr ? 'رفع درجة الثقة' : 'Improve trust score'}</button>
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

function TrustScoreBreakdown({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const rows = [
    [isAr ? 'توثيق الهوية' : 'Identity verification', 25, 25, 'green'],
    [isAr ? 'توثيق الهاتف' : 'Phone verification', 20, 20, 'green'],
    [isAr ? 'تاريخ الحجوزات' : 'Booking history', 18, 20, 'gold'],
    [isAr ? 'التقييمات المستلمة' : 'Received reviews', 17, 20, 'gold'],
    [isAr ? 'سرعة الرد' : 'Response speed', 10, 15, 'gold'],
    [isAr ? 'إكمال الملف الشخصي' : 'Profile completion', 4, 10, 'gray'],
  ] as const

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'تفاصيل الدرجة' : 'Score Breakdown'} />
      <section className="trust-score-break">
        <strong>{TRUST_SCORE}<small>/ 100</small></strong>
        <span>{isAr ? 'درجة الموثوقية الحالية' : 'Current trust score'}</span>
      </section>
      <section className="trust-bars">
        {rows.map(([label, value, total, tone]) => (
          <article key={label}>
            <div><strong>{label}</strong><span>{value}/{total}</span></div>
            <i><b className={tone} style={{ width: `${(value / total) * 100}%` }} /></i>
          </article>
        ))}
      </section>
      <h2 className="trust-section-title">{isAr ? 'كيف ترفع درجتك؟' : 'How to improve?'}</h2>
      <TrustSuggestion title={isAr ? 'أكمل ملفك الشخصي' : 'Complete your profile'} body={isAr ? 'إضافة وصف شخصي وصورة واضحة يمنحك +6 نقاط إضافية.' : 'Add a personal bio and clear photo for +6 points.'} action={isAr ? 'تعديل الملف' : 'Edit profile'} />
      <TrustSuggestion title={isAr ? 'تحسين سرعة الرد' : 'Improve response speed'} body={isAr ? 'الرد على الرسائل خلال أقل من ساعة يزيد درجتك بمقدار +5.' : 'Replying within one hour increases your score by +5.'} action={isAr ? 'عرض الإحصائيات' : 'View stats'} muted />
    </main>
  )
}

function TrustSos({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  return (
    <main className="trust-phone trust-sos-page" dir={isAr ? 'rtl' : 'ltr'}>
      <h1>{isAr ? 'طوارئ SOS' : 'SOS Emergency'}</h1>
      <p>{isAr ? 'هل تشعر بعدم الأمان؟ نحن هنا للمساعدة.' : 'Feeling unsafe? We are here to help.'}</p>
      <button className="sos-pulse" onClick={() => (window.location.hash = '/immocontact')}>SOS</button>
      <strong>{isAr ? 'اضغط مطولاً لمدة 3 ثوان' : 'Hold for 3 seconds'}</strong>
      <span>{isAr ? 'سيتواصل فريق دعم SYBNB معك في أقرب وقت ممكن' : 'The SYBNB support team will reach out to you as soon as possible.'}</span>
      <div className="trust-sos-actions">
        <button onClick={() => (window.location.hash = '/immocontact')}>{isAr ? 'تقديم بلاغ صامت' : 'Submit silent report'} <b>⌁</b></button>
        <button onClick={() => (window.location.hash = '/immocontact')}>{isAr ? 'تحدث مع الدعم الفني' : 'Talk to support'} <b>○</b></button>
      </div>
    </main>
  )
}

function BookingProtectionHub({ lang, bookingId }: { lang: Lang; bookingId: string }) {
  const isAr = lang === 'ar'
  const shortId = bookingIdLabel(bookingId)
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'حماية الحجز' : 'Booking Protection'} />
      <section className="booking-protected-card">
        <small>{isAr ? 'محمي' : 'Protected'}</small>
        <span>{shortId} ♢</span>
        <h2>{isAr ? 'فيلا النخيل الملكية' : 'Royal Palm Villa'}</h2>
        <p>15 - 22 {isAr ? 'يونيو 2026' : 'June 2026'}</p>
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
  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'فتح نزاع' : 'Open Dispute'} />
      <span className="booking-code">{bookingIdLabel(bookingId)}</span>
      <section className="dispute-chips">
        {(isAr ? ['إلغاء', 'وصف غير صحيح', 'مشكلة دفع'] : ['Cancellation', 'Wrong description', 'Payment issue']).map((label, index) => (
          <button className={index === 1 ? 'active' : ''} key={label} onClick={() => (window.location.hash = `/booking/dispute/${bookingId}`)}>{label}</button>
        ))}
      </section>
      <label className="dispute-field">
        <span>{isAr ? 'وصف المشكلة' : 'Problem description'}</span>
        <textarea placeholder={isAr ? 'اشرح ما حدث بوضوح...' : 'Explain clearly what happened...'} />
      </label>
      <button className="trust-upload active" onClick={() => (window.location.hash = '/immocontact')}>＋<span>{isAr ? 'إضافة صورة أو إثبات' : 'Add photo or evidence'}</span></button>
      <p className="trust-note">{isAr ? 'يراجع فريق SYBNB النزاع في أقرب وقت ممكن.' : 'The SYBNB team reviews the dispute as soon as possible.'}</p>
      <button className="trust-danger" onClick={() => (window.location.hash = '/trust-center/sos')}>{isAr ? 'تصعيد فوري' : 'Emergency escalation'}</button>
      <button className="trust-primary" onClick={() => (window.location.hash = `/booking/dispute-closed/${bookingId}`)}>{isAr ? 'إرسال النزاع' : 'Submit dispute'}</button>
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

function TrustSuggestion({ title, body, action, muted = false }: { title: string; body: string; action: string; muted?: boolean }) {
  return (
    <article className="trust-suggestion">
      <h3>{title}</h3>
      <p>{body}</p>
      <button className={muted ? 'muted' : ''} onClick={() => (window.location.hash = muted ? '/status' : '/dashboard')}>{action}</button>
    </article>
  )
}

function bookingIdLabel(id: string) {
  if (id.startsWith('BK-')) return id
  return `BK-${id.slice(0, 8).toUpperCase()}`
}
