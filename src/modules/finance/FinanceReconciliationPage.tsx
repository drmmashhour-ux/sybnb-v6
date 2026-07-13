import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminPayouts,
  fetchAdminRevenueSummary,
  fetchPrototypeAdminAuditLog,
  fetchPrototypeReviewQueue,
  releaseAdminPayout,
  type AdminPayout,
  type PlatformAdminAuditLog,
  type PlatformPaymentProof,
  type PlatformReviewBooking,
  type PlatformReviewQueue,
  type PlatformRevenueSummary,
} from '../../shared/api/platformApi'
import { moneyText, providerText, statusText } from '../../shared/i18n/display'
import { cancellationProtectionFeeMinor, strAdminShareMinor } from '../../shared/financeModel'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للإدارة',
    title: 'مصالحة المال',
    subtitle: 'لوحة واحدة لمراجعة الأموال المحمية، إثباتات الدفع، وتحويلات المالك — كلها بيانات حقيقية من قاعدة البيانات.',
    protectedFunds: 'أموال محمية',
    pendingProofs: 'إثباتات بانتظار القرار',
    payoutHold: 'تحويلات مضيف بانتظار الصرف',
    officialOnly: 'الدفع الرسمي فقط',
    officialCopy: 'أي دفع خارج SYBNB لا يدخل الحماية ولا يظهر في سجل المصالحة.',
    proofQueue: 'طابور إثباتات الدفع',
    adminReviewTitle: 'مراجعة الدفعات - الإدارة',
    hostPayoutReview: 'مراجعة صرف المضيفين',
    payoutQueue: 'مسار تحويل المالك',
    payoutHoldNote: 'يبقى الصرف معلقاً حتى {days} يوماً بعد انتهاء الإقامة، ولا يظهر إلا بعد اكتمال الحجز بلا نزاع مفتوح.',
    readyToRelease: 'جاهز للصرف',
    waitingHold: 'ينتظر انتهاء فترة الاحتجاز',
    releasing: 'جار التحرير...',
    releaseError: 'تعذر تحرير هذا التحويل.',
    ledger: 'سجل التدقيق',
    release: 'تحرير التحويل',
    review: 'مراجعة',
    receipt: 'الإيصال',
    booking: 'الحجز',
    provider: 'المزوّد',
    amount: 'المبلغ',
    status: 'الحالة',
    empty: 'لا توجد عناصر حالياً.',
    loading: 'جار التحميل',
    error: 'تعذر تحميل بيانات المصالحة',
    lanes: ['استلام الإثبات', 'مراجعة الإدارة', 'تأكيد الحجز', 'تحرير المالك'],
    incomeProjection: 'توقع الإيراد',
    incomeProjectionNote: 'إيراد SYBNB الفعلي المحصّل: عمولة حجوزات الاستضافة، رسوم حماية الإلغاء (غير مستردة)، ورسوم خطط البائعين/الوكلاء/المطورين.',
    totalCollected: 'إجمالي العمولة المحصّلة',
    dailyAverage: 'متوسط يومي',
    next30Days: 'توقع ٣٠ يوماً القادمة',
    next90Days: 'توقع ٩٠ يوماً القادمة',
    basedOnDays: 'بناءً على {days} يوماً من بيانات حقيقية',
    noRevenueYet: 'لا توجد عمولة محصّلة بعد — التوقع سيظهر بعد أول دفعة يوافق عليها المدير.',
    srNote: 'رحلات SR: {count} رحلة مكتملة بقيمة أجرة إجمالية {fare} — هذه أرباح السائقين، والمنصة لا تُحصّل عمولة من رحلات SR حالياً.',
    projectionCaveat: 'هذا امتداد خطي بسيط لمتوسط حقيقي، وليس تنبؤاً بالذكاء الاصطناعي — كلما زادت بيانات الحجوزات الحقيقية، زادت دقته.',
    whatIf: 'حاسبة افتراضية (ماذا لو)',
    whatIfNote: 'أدخل افتراضاتك الخاصة — هذه ليست بيانات حقيقية، لكن الحساب يستخدم نفس صيغة عمولة SYBNB الفعلية (تنظيف ٥٪ + ضريبة ٢٪ + عمولة استضافة ١٠٪ من الإيجار الصافي).',
    strBookingsPerMonth: 'حجوزات استضافة شهرياً',
    strAvgPriceSyp: 'متوسط سعر الحجز (ل.س)',
    strUsdSharePercent: 'نسبة الدفع بالدولار (٪)',
    strProtectionPercent: 'نسبة شراء حماية الإلغاء (٪)',
    srRidesPerMonth: 'رحلات SR شهرياً',
    srAvgFareSyp: 'متوسط أجرة الرحلة (ل.س)',
    srUsdSharePercent: 'نسبة الدفع بالدولار (٪)',
    monthlyRevenue: 'الإيراد الشهري المتوقع',
    annualRevenue: 'الإيراد السنوي المتوقع',
    srDriverVolumeNote: 'أجرة رحلات SR الشهرية المفترضة: {fare} — أرباح سائقين، ليست إيراد منصة (لا عمولة على SR حالياً).',
  },
  en: {
    back: 'Back to admin',
    title: 'Finance Reconciliation',
    subtitle: 'One control room for protected funds, payment proofs, and owner payout release — all real, database-backed figures.',
    protectedFunds: 'Protected funds',
    pendingProofs: 'Proofs waiting decision',
    payoutHold: 'Host payouts awaiting release',
    officialOnly: 'Official payments only',
    officialCopy: 'Payments outside SYBNB are not protected and do not appear in reconciliation.',
    proofQueue: 'Payment proof queue',
    adminReviewTitle: 'Admin Payment Review',
    hostPayoutReview: 'Host payout review',
    payoutQueue: 'Owner payout lane',
    payoutHoldNote: 'Payout stays held for {days} days after the stay ends, and only appears once the booking is completed with no open dispute.',
    readyToRelease: 'Ready to release',
    waitingHold: 'Waiting out the hold period',
    releasing: 'Releasing...',
    releaseError: 'Could not release this payout.',
    ledger: 'Audit log',
    release: 'Release payout',
    review: 'Review',
    receipt: 'Receipt',
    booking: 'Booking',
    provider: 'Provider',
    amount: 'Amount',
    status: 'Status',
    empty: 'No items right now.',
    loading: 'Loading',
    error: 'Could not load reconciliation data',
    lanes: ['Proof received', 'Admin review', 'Booking confirmed', 'Owner released'],
    incomeProjection: 'Income projection',
    incomeProjectionNote: 'Real SYBNB revenue collected: booking host commission, non-refundable cancellation-protection fees, and seller/dealer/developer plan fees.',
    totalCollected: 'Total commission collected',
    dailyAverage: 'Daily average',
    next30Days: 'Next 30 days (projected)',
    next90Days: 'Next 90 days (projected)',
    basedOnDays: 'Based on {days} days of real data',
    noRevenueYet: 'No commission collected yet — a projection will appear after the first admin-approved payment.',
    srNote: '{count} completed SR rides worth {fare} in total fares — that\'s driver earnings; the platform currently collects no commission on SR rides.',
    projectionCaveat: 'This is a simple linear extrapolation of a real average, not an AI forecast — accuracy improves as more real booking data accumulates.',
    whatIf: 'What-if calculator',
    whatIfNote: 'Enter your own assumptions — this is not real data, but the math uses the real SYBNB commission formula (5% cleaning + 2% tax + 10% host commission on net rent).',
    strBookingsPerMonth: 'STR bookings per month',
    strAvgPriceSyp: 'Average booking price (SYP)',
    strUsdSharePercent: 'Share paid in USD (%)',
    strProtectionPercent: 'Share buying cancellation protection (%)',
    srRidesPerMonth: 'SR rides per month',
    srAvgFareSyp: 'Average ride fare (SYP)',
    srUsdSharePercent: 'Share paid in USD (%)',
    monthlyRevenue: 'Projected monthly revenue',
    annualRevenue: 'Projected annual revenue',
    srDriverVolumeNote: 'Assumed monthly SR fare volume: {fare} — driver earnings, not platform revenue (no SR commission today).',
  },
}

export function FinanceReconciliationPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [auditLog, setAuditLog] = useState<PlatformAdminAuditLog[]>([])
  const [payouts, setPayouts] = useState<AdminPayout[]>([])
  const [payoutHoldDays, setPayoutHoldDays] = useState(14)
  const [releasingId, setReleasingId] = useState('')
  const [releaseError, setReleaseError] = useState('')
  const [revenue, setRevenue] = useState<PlatformRevenueSummary | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  const [whatIfStrBookings, setWhatIfStrBookings] = useState('40')
  const [whatIfStrAvgPrice, setWhatIfStrAvgPrice] = useState('300000')
  const [whatIfStrUsdPercent, setWhatIfStrUsdPercent] = useState('30')
  const [whatIfStrProtectionPercent, setWhatIfStrProtectionPercent] = useState('20')
  const [whatIfSrRides, setWhatIfSrRides] = useState('90')
  const [whatIfSrAvgFare, setWhatIfSrAvgFare] = useState('35000')
  const [whatIfSrUsdPercent, setWhatIfSrUsdPercent] = useState('30')

  const whatIf = useMemo(() => {
    const strBookings = Math.max(0, Number(whatIfStrBookings) || 0)
    const strAvgPriceSyp = Math.max(0, Number(whatIfStrAvgPrice) || 0)
    const strUsdPercent = Math.min(100, Math.max(0, Number(whatIfStrUsdPercent) || 0))
    const strProtectionPercent = Math.min(100, Math.max(0, Number(whatIfStrProtectionPercent) || 0))
    const srRides = Math.max(0, Number(whatIfSrRides) || 0)
    const srAvgFareSyp = Math.max(0, Number(whatIfSrAvgFare) || 0)
    const srUsdPercent = Math.min(100, Math.max(0, Number(whatIfSrUsdPercent) || 0))

    const strUsdBookings = Math.round(strBookings * (strUsdPercent / 100))
    const strSypBookings = strBookings - strUsdBookings
    const strAvgPriceUsd = sypMinorToRoundedUsdMinor(strAvgPriceSyp)

    const sypCommissionPerBooking = strAdminShareMinor(strAvgPriceSyp)
    const usdCommissionPerBooking = strAdminShareMinor(strAvgPriceUsd)
    const sypProtectionPerBooking = cancellationProtectionFeeMinor(strAvgPriceSyp)
    const usdProtectionPerBooking = cancellationProtectionFeeMinor(strAvgPriceUsd)

    const monthlySypRevenue =
      strSypBookings * sypCommissionPerBooking +
      strSypBookings * (strProtectionPercent / 100) * sypProtectionPerBooking
    const monthlyUsdRevenue =
      strUsdBookings * usdCommissionPerBooking +
      strUsdBookings * (strProtectionPercent / 100) * usdProtectionPerBooking

    const srUsdRides = Math.round(srRides * (srUsdPercent / 100))
    const srSypRides = srRides - srUsdRides
    const srAvgFareUsd = sypMinorToRoundedUsdMinor(srAvgFareSyp)
    const srSypFareVolume = srSypRides * srAvgFareSyp
    const srUsdFareVolume = srUsdRides * srAvgFareUsd

    // Annual is derived from the same rounded monthly figure shown on screen (not the unrounded
    // intermediate), so it always reads as exactly 12x the displayed monthly number.
    const roundedMonthlySyp = Math.round(monthlySypRevenue)
    const roundedMonthlyUsd = Math.round(monthlyUsdRevenue)

    return {
      monthlySypRevenue: roundedMonthlySyp,
      monthlyUsdRevenue: roundedMonthlyUsd,
      annualSypRevenue: roundedMonthlySyp * 12,
      annualUsdRevenue: roundedMonthlyUsd * 12,
      srSypFareVolume,
      srUsdFareVolume,
    }
  }, [
    whatIfStrBookings,
    whatIfStrAvgPrice,
    whatIfStrUsdPercent,
    whatIfStrProtectionPercent,
    whatIfSrRides,
    whatIfSrAvgFare,
    whatIfSrUsdPercent,
  ])

  useEffect(() => {
    void loadFinance()
  }, [])

  async function loadFinance() {
    setStatus('loading')
    setMessage('')
    try {
      const [nextQueue, nextAuditLog, nextPayouts, nextRevenue] = await Promise.all([
        fetchPrototypeReviewQueue(),
        fetchPrototypeAdminAuditLog(10),
        fetchAdminPayouts(),
        fetchAdminRevenueSummary(),
      ])
      setQueue(nextQueue)
      setAuditLog(nextAuditLog)
      setPayouts(nextPayouts.payouts)
      setPayoutHoldDays(nextPayouts.holdDays)
      setRevenue(nextRevenue)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function releasePayout(bookingId: string) {
    setReleasingId(bookingId)
    setReleaseError('')
    try {
      await releaseAdminPayout(bookingId)
      const nextPayouts = await fetchAdminPayouts()
      setPayouts(nextPayouts.payouts)
    } catch (error) {
      setReleaseError(error instanceof Error ? error.message : t.releaseError)
    } finally {
      setReleasingId('')
    }
  }

  const payments = queue?.payments || []
  const bookings = queue?.bookings || []
  const protectedMinor = useMemo(() => {
    const paymentTotal = payments.reduce((sum, payment) => sum + payment.amountMinor, 0)
    const bookingTotal = bookings.reduce((sum, booking) => sum + booking.amountMinor, 0)
    return paymentTotal + bookingTotal
  }, [bookings, payments])
  const payoutHoldMinor = useMemo(() => payouts.reduce((sum, payout) => sum + payout.hostPayoutMinor, 0), [payouts])

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>SYBNB V6 FINANCE</p>
          <h1 style={styles.title}>{t.title}</h1>
          <p style={styles.body}>{t.subtitle}</p>
        </div>
        <article style={styles.warning}>
          <strong>{t.officialOnly}</strong>
          <span>{t.officialCopy}</span>
        </article>
      </section>

      {status === 'error' && (
        <section style={styles.error}>
          <strong>{t.error}</strong>
          <span>{message}</span>
        </section>
      )}

      <section style={styles.stats}>
        <FinanceStat label={t.protectedFunds} value={moneyText(protectedMinor, 'SYP', lang)} tone="#20d29b" />
        <FinanceStat label={t.pendingProofs} value={String(payments.length)} tone="#5268ff" />
        <FinanceStat label={t.payoutHold} value={moneyText(payoutHoldMinor, 'SYP', lang)} tone="#e5b80b" />
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <div style={styles.reviewHeader}>
            <span style={styles.pendingPill}>{payments.length} {isAr ? 'بانتظار المراجعة' : 'Pending'}</span>
            <h2 style={styles.cardTitle}>{t.adminReviewTitle}</h2>
          </div>
          {status === 'loading' && <p style={styles.empty}>{t.loading}</p>}
          {payments.length ? payments.slice(0, 4).map((payment) => (
            <PaymentProofRow key={payment.id} payment={payment} lang={lang} labels={t} />
          )) : status !== 'loading' && <p style={styles.empty}>{t.empty}</p>}
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.ledger}</h2>
          <div style={styles.timeline}>
            {t.lanes.map((lane, index) => (
              <span key={lane} style={index <= 2 ? styles.timelineActive : undefined}>{lane}</span>
            ))}
          </div>
          <div style={styles.stack}>
            {auditLog.length ? auditLog.slice(0, 6).map((entry) => (
              <article key={entry.id} style={styles.auditRow}>
                <strong>{entry.action.replace(/_/g, ' ')}</strong>
                <span>{entry.entityType} / {entry.entityId.slice(0, 8).toUpperCase()}</span>
              </article>
            )) : <p style={styles.empty}>{t.empty}</p>}
          </div>
        </article>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t.hostPayoutReview}</h2>
        <p style={styles.empty}>{t.payoutHoldNote.replace('{days}', String(payoutHoldDays))}</p>
        {releaseError && <p style={{ ...styles.empty, color: '#ff8aa0' }}>{releaseError}</p>}
        <div style={styles.payoutTable}>
          {payouts.length ? payouts.map((payout) => (
            <article key={payout.bookingId} style={styles.financeRow}>
              <span style={{ ...styles.riskDot, background: payout.eligibleNow ? '#20d29b' : '#e5b80b' }} />
              <div>
                <strong>{payout.listingTitle || payout.bookingId.slice(0, 8).toUpperCase()}</strong>
                <small dir="ltr">{payout.hostName || payout.hostId?.slice(0, 8).toUpperCase()}</small>
              </div>
              <b>{moneyText(payout.hostPayoutMinor, payout.currency, lang)}</b>
              <span>{payout.eligibleNow ? t.readyToRelease : t.waitingHold}</span>
              <button
                disabled={!payout.eligibleNow || releasingId === payout.bookingId}
                onClick={() => void releasePayout(payout.bookingId)}
              >
                {releasingId === payout.bookingId ? t.releasing : t.release}
              </button>
            </article>
          )) : <p style={styles.empty}>{t.empty}</p>}
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t.incomeProjection}</h2>
        <p style={styles.empty}>{t.incomeProjectionNote}</p>
        {revenue && revenue.byCurrency.length ? (
          revenue.byCurrency.map((entry) => (
            <div key={entry.currency}>
              <p style={styles.empty}>
                <b dir="ltr">{entry.currency}</b>
              </p>
              <section style={styles.stats}>
                <FinanceStat label={t.totalCollected} value={moneyText(entry.totalRevenueMinor, entry.currency, lang)} tone="#20d29b" />
                <FinanceStat label={t.dailyAverage} value={moneyText(entry.projection.dailyAverageMinor, entry.currency, lang)} tone="#5268ff" />
                <FinanceStat label={t.next30Days} value={moneyText(entry.projection.next30DaysMinor, entry.currency, lang)} tone="#e5b80b" />
                <FinanceStat label={t.next90Days} value={moneyText(entry.projection.next90DaysMinor, entry.currency, lang)} tone="#ff5f7d" />
              </section>
              <p style={styles.empty}>{t.basedOnDays.replace('{days}', String(entry.projection.elapsedDays))}</p>
            </div>
          ))
        ) : (
          <p style={styles.empty}>{t.noRevenueYet}</p>
        )}
        {revenue && (
          <p style={styles.empty}>
            {t.srNote
              .replace('{count}', String(revenue.srRidesCompletedCount))
              .replace('{fare}', moneyText(revenue.srRidesFareVolumeMinor, 'SYP', lang))}
          </p>
        )}
        <p style={styles.empty}>{t.projectionCaveat}</p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t.whatIf}</h2>
        <p style={styles.empty}>{t.whatIfNote}</p>
        <div style={styles.grid}>
          <div style={styles.payoutTable}>
            <label style={styles.label}>
              {t.strBookingsPerMonth}
              <input style={styles.numberInput} dir="ltr" value={whatIfStrBookings} onChange={(event) => setWhatIfStrBookings(event.target.value)} />
            </label>
            <label style={styles.label}>
              {t.strAvgPriceSyp}
              <input style={styles.numberInput} dir="ltr" value={whatIfStrAvgPrice} onChange={(event) => setWhatIfStrAvgPrice(event.target.value)} />
            </label>
            <label style={styles.label}>
              {t.strUsdSharePercent}
              <input style={styles.numberInput} dir="ltr" value={whatIfStrUsdPercent} onChange={(event) => setWhatIfStrUsdPercent(event.target.value)} />
            </label>
            <label style={styles.label}>
              {t.strProtectionPercent}
              <input style={styles.numberInput} dir="ltr" value={whatIfStrProtectionPercent} onChange={(event) => setWhatIfStrProtectionPercent(event.target.value)} />
            </label>
          </div>
          <div style={styles.payoutTable}>
            <label style={styles.label}>
              {t.srRidesPerMonth}
              <input style={styles.numberInput} dir="ltr" value={whatIfSrRides} onChange={(event) => setWhatIfSrRides(event.target.value)} />
            </label>
            <label style={styles.label}>
              {t.srAvgFareSyp}
              <input style={styles.numberInput} dir="ltr" value={whatIfSrAvgFare} onChange={(event) => setWhatIfSrAvgFare(event.target.value)} />
            </label>
            <label style={styles.label}>
              {t.srUsdSharePercent}
              <input style={styles.numberInput} dir="ltr" value={whatIfSrUsdPercent} onChange={(event) => setWhatIfSrUsdPercent(event.target.value)} />
            </label>
          </div>
        </div>

        <p style={styles.empty}>
          <b>{t.monthlyRevenue}</b>
        </p>
        <section style={styles.stats}>
          <FinanceStat label="SYP" value={moneyText(whatIf.monthlySypRevenue, 'SYP', lang)} tone="#20d29b" />
          <FinanceStat label="USD" value={moneyText(whatIf.monthlyUsdRevenue, 'USD', lang)} tone="#20d29b" />
        </section>
        <p style={styles.empty}>
          <b>{t.annualRevenue}</b>
        </p>
        <section style={styles.stats}>
          <FinanceStat label="SYP" value={moneyText(whatIf.annualSypRevenue, 'SYP', lang)} tone="#5268ff" />
          <FinanceStat label="USD" value={moneyText(whatIf.annualUsdRevenue, 'USD', lang)} tone="#5268ff" />
        </section>
        <p style={styles.empty}>
          {t.srDriverVolumeNote.replace(
            '{fare}',
            `${moneyText(whatIf.srSypFareVolume, 'SYP', lang)} + ${moneyText(whatIf.srUsdFareVolume, 'USD', lang)}`,
          )}
        </p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t.booking}</h2>
        <div style={styles.bookingGrid}>
          {bookings.slice(0, 4).map((booking) => (
            <BookingFinanceCard key={booking.id} booking={booking} lang={lang} labels={t} />
          ))}
          {!bookings.length && status !== 'loading' && <p style={styles.empty}>{t.empty}</p>}
        </div>
      </section>
    </main>
  )
}

function FinanceStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article style={{ ...styles.stat, borderColor: `${tone}66` }}>
      <span>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
    </article>
  )
}

function PaymentProofRow({ payment, lang, labels }: { payment: PlatformPaymentProof; lang: Lang; labels: typeof copy.ar }) {
  return (
    <article style={styles.financeRow}>
      <span style={{ ...styles.riskDot, background: payment.status === 'PENDING_REVIEW' ? '#e5b80b' : '#20d29b' }} />
      <div>
        <strong>{payment.providerRef || payment.id.slice(0, 8).toUpperCase()}</strong>
        <small>{labels.provider}: {providerText(payment.provider, lang)}</small>
      </div>
      <b>{moneyText(payment.amountMinor, payment.currency, lang)}</b>
      <button onClick={() => (window.location.hash = '/admin/review')}>{labels.review}</button>
      <button onClick={() => (window.location.hash = `/payment/receipt/${payment.id}`)}>{labels.receipt}</button>
    </article>
  )
}

function BookingFinanceCard({ booking, lang, labels }: { booking: PlatformReviewBooking; lang: Lang; labels: typeof copy.ar }) {
  return (
    <article style={styles.bookingCard}>
      <span>{statusText(booking.status, lang)}</span>
      <strong>{booking.id.slice(0, 8).toUpperCase()}</strong>
      <div style={styles.meta}>
        <span>{labels.amount}</span>
        <b>{moneyText(booking.amountMinor, booking.currency, lang)}</b>
      </div>
      <button onClick={() => (window.location.hash = `/booking/${booking.id}`)}>{labels.review}</button>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1180, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e2942', borderRadius: 8, background: 'linear-gradient(135deg, #111827, #0b1020)', padding: 18, display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(250px, 360px)' },
  eyebrow: { margin: 0, color: '#e5b80b', fontWeight: 950, letterSpacing: 2, fontSize: 11 },
  title: { margin: '6px 0', fontSize: 42, lineHeight: 1.04 },
  body: { margin: 0, color: '#9aa6ba', lineHeight: 1.65, maxWidth: 720 },
  warning: { border: '1px solid rgba(229,184,11,.45)', borderRadius: 8, background: 'rgba(229,184,11,.1)', padding: 14, display: 'grid', gap: 8, alignContent: 'center', color: '#f7d45f' },
  error: { border: '1px solid rgba(255,95,125,.5)', borderRadius: 8, background: 'rgba(255,95,125,.12)', color: '#ffd1d1', padding: 14, display: 'grid', gap: 4 },
  stats: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 10 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' },
  card: { border: '1px solid #1e2942', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 12 },
  cardTitle: { margin: 0, fontSize: 22 },
  empty: { margin: 0, color: '#9aa6ba' },
  financeRow: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 10, gridTemplateColumns: '14px minmax(0, 1fr) minmax(90px, 140px) auto auto', alignItems: 'center' },
  riskDot: { width: 10, height: 44, borderRadius: 999 },
  reviewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pendingPill: { border: '1px solid rgba(229,184,11,.55)', borderRadius: 999, color: '#e5b80b', padding: '6px 10px', fontWeight: 950, fontSize: 12 },
  payoutTable: { display: 'grid', gap: 10 },
  timeline: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' },
  timelineActive: { borderColor: 'rgba(32,210,155,.5)', background: 'rgba(32,210,155,.12)', color: '#20d29b' },
  stack: { display: 'grid', gap: 8 },
  auditRow: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
  bookingGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  bookingCard: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 10 },
  meta: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
  label: { display: 'grid', gap: 7, color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  numberInput: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: '0 14px', fontWeight: 900 },
}
