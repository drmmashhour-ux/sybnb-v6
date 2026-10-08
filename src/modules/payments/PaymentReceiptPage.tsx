import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchPrototypePaymentProof, type PlatformPaymentProof } from '../../shared/api/platformApi'
import { listingTitleText, moneyText, providerText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
  proofId: string
}

const copy = {
  ar: {
    back: 'العودة للوحة',
    title: 'فاتورة رسمية',
    subtitle: 'إثبات دفع محفوظ ومربوط بالحجز من قاعدة البيانات.',
    letterhead: 'SYBNB PLATFORM',
    invoice: 'رقم الفاتورة',
    paidTotal: 'إجمالي المبلغ المدفوع',
    share: 'مشاركة',
    download: 'حفظ الفاتورة',
    print: 'طباعة الفاتورة',
    held: 'محجوز',
    loading: 'جار التحميل',
    error: 'تعذر تحميل الإيصال',
    proof: 'رقم الإثبات',
    booking: 'رقم الحجز',
    listing: 'الإعلان',
    payer: 'الدافع',
    host: 'المضيف',
    provider: 'طريقة الدفع',
    reference: 'رقم العملية',
    amount: 'المبلغ',
    status: 'الحالة',
    reviewed: 'وقت المراجعة',
    openBooking: 'فتح الإعلان',
    trustCenter: 'مركز الثقة',
    paymentStatus: 'حالة الدفع',
    protection: 'حماية الحجز',
    protectedFunds: 'مبلغك محمي',
    protectedCopy: 'لن يتم تحويل المبلغ للمضيف حتى تأكيد الحجز ومراجعة فريق SYBNB.',
    warning: 'لا تعتمد أي دفعة خارج SYBNB ضمن الحماية.',
    rejectedTitle: 'لم تتم الموافقة على الدفع',
    rejectedCopy: 'راجعت الإدارة هذه الدفعة ولم تتم الموافقة عليها. تواصل مع الدعم أو أعد إرسال إثبات دفع صحيح.',
    timeline: ['تم الإرسال', 'قيد المراجعة', 'موافقة المضيف', 'تحرير المبلغ'],
    pending: 'بانتظار مراجعة فريق SYBNB',
  },
  en: {
    back: 'Back to dashboard',
    title: 'Official Receipt',
    subtitle: 'Saved payment proof connected to its booking from the database.',
    letterhead: 'SYBNB PLATFORM',
    invoice: 'Invoice number',
    paidTotal: 'Total paid',
    share: 'Share',
    download: 'Save Receipt',
    print: 'Print Receipt',
    held: 'Held',
    loading: 'Loading',
    error: 'Could not load receipt',
    proof: 'Proof ID',
    booking: 'Booking ID',
    listing: 'Listing',
    payer: 'Payer',
    host: 'Host',
    provider: 'Payment method',
    reference: 'Transaction reference',
    amount: 'Amount',
    status: 'Status',
    reviewed: 'Reviewed at',
    openBooking: 'Open listing',
    trustCenter: 'Trust Center',
    paymentStatus: 'Payment status',
    protection: 'Booking protection',
    protectedFunds: 'Your money is protected',
    protectedCopy: 'Funds are not released to the host until booking confirmation and SYBNB team review.',
    warning: 'Payments outside SYBNB are not covered by protection.',
    rejectedTitle: 'This payment was not approved',
    rejectedCopy: 'Our team reviewed this payment and did not approve it. Contact support or resubmit a valid payment proof.',
    timeline: ['Submitted', 'Under review', 'Host approved', 'Released'],
    pending: 'Waiting for SYBNB review',
  },
}

export function PaymentReceiptPage({ lang, proofId }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [proof, setProof] = useState<PlatformPaymentProof | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadProof()
  }, [proofId])

  async function loadProof() {
    setStatus('loading')
    setMessage('')

    try {
      setProof(await fetchPrototypePaymentProof(proofId))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  const listing = proof?.booking?.listing
  const listingTitle = listing ? listingTitleText(listing, lang) : '-'
  const shareReceipt = () => {
    const text = proof ? `${t.title} INV-${proof.id.slice(0, 8).toUpperCase()}` : t.title
    if (navigator.share) {
      void navigator.share({ title: t.letterhead, text })
      return
    }
    void navigator.clipboard?.writeText(text)
  }
  const downloadReceipt = () => {
    if (!proof) return

    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        receipt: proof,
      },
      null,
      2,
    )
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sybnb-receipt-${proof.id.slice(0, 8).toUpperCase()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const printReceipt = () => {
    window.print()
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.flowNav} aria-label={isAr ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button
          style={styles.arrowButton}
          onClick={() => (window.location.hash = proof?.bookingId ? `/booking/${proof.bookingId}` : '/dashboard')}
          aria-label={isAr ? 'السابق' : 'Back'}
        >
          ‹
        </button>
        <button style={styles.arrowButton} onClick={() => (window.location.hash = '/dashboard')} aria-label={isAr ? 'التالي' : 'Next'}>
          ›
        </button>
      </section>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>SYBNB V6</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {status === 'error' && <section style={styles.alert}>{message}</section>}

      {proof && (
        <>
          <section style={styles.invoiceShell}>
            <header style={styles.invoiceHeader}>
              <span style={styles.invoiceBadge}>{t.title}</span>
              <strong>{t.letterhead}</strong>
              <b>■</b>
            </header>
            <section style={styles.invoiceHero}>
              <div>
                <small>{t.booking}</small>
                <strong dir="ltr">{proof.bookingId || '-'}</strong>
              </div>
              <div>
                <small>{t.invoice}</small>
                <strong dir="ltr">INV-{proof.id.slice(0, 8).toUpperCase()}</strong>
              </div>
              <div style={styles.invoiceListing}>
                <h2>{listingTitle}</h2>
                <p>{String(listing?.location?.city || listing?.location?.area || '-')}</p>
              </div>
            </section>
            <Info label={t.status} value={proof.status === 'PENDING_ADMIN_REVIEW' ? t.pending : statusText(proof.status, lang)} dir={isAr ? 'rtl' : 'ltr'} strong />
            <Info label={t.paidTotal} value={moneyText(proof.amountMinor, proof.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} strong />
            <Info label={t.proof} value={proof.id.toUpperCase()} />
            <Info label={t.booking} value={proof.bookingId || '-'} />
            <Info label={t.listing} value={listingTitle} />
            <Info label={t.payer} value={proof.user?.displayName || proof.booking?.guest?.displayName || proof.userId.slice(0, 8).toUpperCase()} />
            <Info label={t.host} value={listing?.owner?.displayName || listing?.ownerId?.slice(0, 8).toUpperCase() || '-'} />
            <Info label={t.provider} value={providerText(proof.provider, lang)} dir={isAr ? 'rtl' : 'ltr'} />
            <Info label={t.reference} value={proof.providerRef || '-'} />
            <Info label={t.reviewed} value={proof.reviewedAt ? new Date(proof.reviewedAt).toLocaleString() : '-'} />
          </section>

          {proof.status === 'REJECTED' ? (
            <section style={styles.protectionPanel}>
              <span style={styles.invoiceBadge}>{statusText(proof.status, lang)}</span>
              <strong>{t.rejectedTitle}</strong>
              <p>{t.rejectedCopy}</p>
            </section>
          ) : (
            <section style={styles.protectionPanel}>
              <span style={styles.invoiceBadge}>{t.held}</span>
              <strong>{t.protectedFunds}</strong>
              <p>{t.protectedCopy}</p>
              <div style={styles.timeline}>
                {t.timeline.map((step, index) => (
                  <span key={step} style={index <= (proof.status === 'APPROVED' ? 3 : 1) ? styles.timelineActive : styles.timelineStep}>
                    {index <= (proof.status === 'APPROVED' ? 3 : 1) ? '✓' : '•'} {step}
                  </span>
                ))}
              </div>
              <small>{t.warning}</small>
            </section>
          )}

          <section style={styles.actions}>
            <button style={styles.secondaryButton} onClick={shareReceipt}>{t.share}</button>
            <button style={styles.primaryButton} onClick={downloadReceipt}>{t.download}</button>
            <button style={styles.secondaryButton} onClick={printReceipt}>{t.print}</button>
            <button style={styles.secondaryButton} onClick={() => (window.location.hash = '/trust-center')}>
              {t.trustCenter}
            </button>
            {proof.bookingId && (
              <>
                <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/booking/payment-status/${proof.bookingId}`)}>
                  {t.paymentStatus}
                </button>
                <button style={styles.primaryButton} onClick={() => (window.location.hash = `/booking/protection/${proof.bookingId}`)}>
                  {t.protection}
                </button>
              </>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function Info({ label, value, dir = 'ltr', strong = false }: { label: string; value: string; dir?: 'ltr' | 'rtl'; strong?: boolean }) {
  return (
    <article style={strong ? styles.infoStrong : styles.info}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 18, maxWidth: 980, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  flowNav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 8 },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  invoiceShell: { border: '1px solid #282d3d', borderRadius: 8, background: '#111118', padding: 30, display: 'grid', gap: 16 },
  invoiceHeader: { display: 'grid', gridTemplateColumns: '1fr auto 32px', gap: 12, alignItems: 'center' },
  invoiceBadge: { width: 'fit-content', border: '1px solid rgba(229,184,11,.55)', borderRadius: 999, color: '#e5b80b', padding: '7px 12px', fontWeight: 950, fontSize: 12 },
  invoiceHero: { border: '1px solid #282d3d', borderRadius: 8, padding: 18, display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr 1.6fr', alignItems: 'center' },
  invoiceListing: { textAlign: 'end' },
  protectionPanel: { border: '1px solid rgba(32,210,155,.55)', borderRadius: 8, background: 'rgba(32,210,155,.06)', padding: 18, display: 'grid', gap: 12 },
  timeline: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  timelineStep: { borderTop: '2px solid #30384d', color: '#8f96a8', fontWeight: 900, padding: '14px 8px 0', textAlign: 'center' },
  timelineActive: { borderTop: '2px solid #20d29b', color: '#20d29b', fontWeight: 950, padding: '14px 8px 0', textAlign: 'center' },
  receipt: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  info: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', padding: 12, display: 'grid', gap: 6 },
  infoStrong: { border: '1px solid rgba(32,210,155,.45)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, display: 'grid', gap: 6 },
  actions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 48, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#9aa6ba', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
}
