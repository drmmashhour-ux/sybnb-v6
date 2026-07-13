import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeWalletGift,
  fetchPrototypeWallet,
  type PlatformWallet,
  type PlatformWalletGift,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'
import { roundUsdUpToStep } from '../../shared/currency'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'محفظتي المالية',
    titleEn: 'My Financial Wallet',
    subtitle: 'رصيد وهدايا حقيقية محفوظة في قاعدة البيانات.',
    trusted: 'V6 موثوق',
    accountId: 'رقم الحساب',
    protected: 'محفظة محمية',
    protectedCopy: 'كل حركة تمر عبر سجل محاسبي وقابلة للمراجعة من الإدارة.',
    available: 'متاح للاستخدام',
    held: 'مبالغ محجوزة',
    refunds: 'قناة الاسترداد',
    prepaid: 'هدايا مستلمة',
    usdWalletBalance: 'رصيد الدولار',
    safety: 'أمان المحفظة',
    safetyRows: ['سجل حركات غير قابل للتعديل', 'إثبات الدفع مرتبط بالحجز', 'منع الدفع خارج SYBNB', 'مراجعة الإدارة للحركات الحساسة'],
    topup: 'شحن المحفظة',
    sendGiftQuick: 'إرسال هدية',
    audit: 'تدقيق الهدايا',
    paymentStatus: 'حالة الدفع',
    trustCenter: 'مركز الثقة',
    financeLanes: 'مسارات المال',
    protectedFunds: 'أموال الحجوزات المحمية',
    protectedFundsShort: 'الأموال المحمية',
    refunded: 'مسترجعة',
    inReview: 'قيد المراجعة',
    heldShort: 'محجوزة',
    refundLane: 'استرداد / نزاع',
    giftLane: 'هدايا وأكواد مسبقة',
    adminLane: 'تدقيق الإدارة',
    balance: 'الرصيد',
    entries: 'حركات المحفظة',
    recipientPhone: 'هاتف المستلم',
    amount: 'قيمة الهدية',
    currencySyp: 'ليرة سورية',
    currencyUsd: 'دولار أمريكي',
    roundedAmount: 'المبلغ بعد التقريب (لأقرب ٥$)',
    message: 'رسالة الهدية',
    send: 'إرسال الهدية',
    claimFlow: 'فتح رابط الاستلام',
    refresh: 'تحديث',
    status: 'الحالة',
    gift: 'الهدية',
    saving: 'جار الحفظ',
    error: 'تعذر تنفيذ عملية المحفظة',
    empty: 'لا توجد حركات بعد.',
    marketNote: 'مثل المحافظ الحديثة: الرصيد واضح، المال المحجوز منفصل، وكل إثبات له مسار مراجعة.',
  },
  en: {
    back: 'Back to landing',
    title: 'My Financial Wallet',
    titleEn: 'My Financial Wallet',
    subtitle: 'Real balance and gifts stored in PostgreSQL.',
    trusted: 'V6 TRUSTED',
    accountId: 'Account ID',
    protected: 'Protected wallet',
    protectedCopy: 'Every movement is ledger-backed and reviewable by admin.',
    available: 'Available to use',
    held: 'Held funds',
    refunds: 'Refund lane',
    prepaid: 'Gifts received',
    usdWalletBalance: 'USD wallet balance',
    safety: 'Wallet safety',
    safetyRows: ['Immutable ledger trail', 'Payment proof connected to booking', 'Outside-SYBNB payment warning', 'Admin review for sensitive moves'],
    topup: 'Top up wallet',
    sendGiftQuick: 'Send gift',
    audit: 'Gift audit',
    paymentStatus: 'Payment status',
    trustCenter: 'Trust Center',
    financeLanes: 'Money lanes',
    protectedFunds: 'Protected booking funds',
    protectedFundsShort: 'Protected Funds',
    refunded: 'Refunded',
    inReview: 'In Review',
    heldShort: 'Held',
    refundLane: 'Refund / dispute',
    giftLane: 'Gifts and prepaid codes',
    adminLane: 'Admin audit',
    balance: 'Balance',
    entries: 'Wallet entries',
    recipientPhone: 'Recipient phone',
    amount: 'Gift amount',
    currencySyp: 'Syrian Pound',
    currencyUsd: 'US Dollar',
    roundedAmount: 'Amount after rounding (nearest $5)',
    message: 'Gift message',
    send: 'Send gift',
    claimFlow: 'Open claim link',
    refresh: 'Refresh',
    status: 'Status',
    gift: 'Gift',
    saving: 'Saving',
    error: 'Wallet action failed',
    empty: 'No entries yet.',
    marketNote: 'Like modern finance wallets: balance is clear, held money is separated, and every proof has a review lane.',
  },
}

export function WalletPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [wallets, setWallets] = useState<PlatformWallet[]>([])
  const [gift, setGift] = useState<PlatformWalletGift | null>(null)
  const [recipientPhone, setRecipientPhone] = useState('+963900000001')
  const [amountMinor, setAmountMinor] = useState('50000')
  const [giftCurrency, setGiftCurrency] = useState<'SYP' | 'USD'>('SYP')
  const [message, setMessage] = useState(isAr ? 'هدية من محفظة SYBNB' : 'Gift from SYBNB Wallet')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [notice, setNotice] = useState('')
  // The primary (SYP) wallet drives the main balance hero and stats grid, matching the existing
  // layout; a USD wallet (opened lazily the first time a USD gift/payment lands — see
  // recordWalletEntry) gets its own small summary card below instead of being added into these
  // SYP-labeled totals, which would silently mix two currencies into one number.
  const sypWallet = wallets.find((entry) => entry.currency === 'SYP') || null
  const usdWallet = wallets.find((entry) => entry.currency === 'USD') || null
  const entries = sypWallet?.entries || []
  const allEntries = wallets.flatMap((entry) => entry.entries || [])
  const availableMinor = sypWallet?.cachedBalanceMinor || 0
  // Real net still-held amount (HOLD entries not yet reversed by a matching RELEASE) — for a
  // guest wallet this is normally 0, since payout holds apply to host wallets, not guest ones.
  // Previously this was a fabricated 28%-of-balance guess shown even on a genuine $0 wallet.
  const heldMinor = entries.reduce((sum, entry) => {
    const type = String(entry.type || '')
    const amount = Number(entry.amountMinor || entry.amount || 0)
    if (type === 'HOLD') return sum + amount
    if (type === 'RELEASE') return sum - amount
    return sum
  }, 0)
  const refundMinor = entries.reduce((sum, entry) => {
    const type = String(entry.type || '')
    return type.includes('REFUND') ? sum + Number(entry.amountMinor || entry.amount || 0) : sum
  }, 0)
  const giftsReceivedMinor = entries.reduce((sum, entry) => {
    return entry.referenceType === 'wallet_gift' ? sum + Number(entry.amountMinor || entry.amount || 0) : sum
  }, 0)

  useEffect(() => {
    void refreshWallet()
  }, [])

  async function refreshWallet() {
    setNotice('')
    try {
      setWallets(await fetchPrototypeWallet())
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setNotice(error instanceof Error ? error.message : t.error)
    }
  }

  async function sendGift() {
    setStatus('saving')
    setNotice('')

    try {
      const rawAmount = Math.max(0, Math.round(Number(amountMinor) || 0))
      const nextGift = await createPrototypeWalletGift({
        recipientPhone,
        // Cash/card USD amounts are rounded up to the nearest $5 so neither side needs to make
        // change; SYP amounts are sent exactly as entered.
        amountMinor: giftCurrency === 'USD' ? roundUsdUpToStep(rawAmount) : rawAmount,
        currency: giftCurrency,
        message,
      })
      setGift(nextGift)
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setNotice(error instanceof Error ? error.message : t.error)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <div style={styles.heroText}>
          <p style={styles.trusted}>{t.trusted} ♢</p>
          <h1 style={styles.title}>{t.title}</h1>
          <p style={styles.body}>{t.titleEn}</p>
        </div>
        <div style={styles.brandCoin}>SY</div>
      </section>

      <section style={styles.balanceHero}>
        <div style={styles.balanceTop}>
          <span style={styles.protectedBadge}>{t.protected}</span>
          <small>{t.accountId}: SY-992-B82</small>
        </div>
        <div style={styles.balanceColumns}>
          <article>
            <span>{t.available} / Available Balance</span>
            <strong style={styles.availableValue} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(availableMinor, 'SYP', lang)}</strong>
          </article>
          <article>
            <span>{t.protectedFundsShort} / Protected Funds</span>
            <strong style={styles.protectedValue} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(heldMinor, 'SYP', lang)}</strong>
          </article>
        </div>
        <div style={styles.statusPills}>
          <span>{t.heldShort}</span>
          <span>{t.inReview}</span>
          <span>{t.refunded}</span>
        </div>
      </section>

      {notice && <section style={{ ...styles.alert, ...(status === 'error' ? styles.error : {}) }}>{notice}</section>}

      <section style={styles.statsGrid}>
        {[
          [t.available, availableMinor, '#20d29b'],
          [t.held, heldMinor, '#e5b80b'],
          [t.refunds, refundMinor, '#5268ff'],
          [t.prepaid, giftsReceivedMinor, '#ff5f7d'],
        ].map(([label, value, color]) => (
          <article key={String(label)} style={{ ...styles.statCard, borderColor: `${color}55` }}>
            <span style={styles.statDot}>{String(label)}</span>
            <strong style={{ color: String(color) }} dir={isAr ? 'rtl' : 'ltr'}>
              {moneyText(Number(value), 'SYP', lang)}
            </strong>
          </article>
        ))}
        {usdWallet && (
          <article style={{ ...styles.statCard, borderColor: '#20d29b55' }}>
            <span style={styles.statDot}>{t.usdWalletBalance}</span>
            <strong style={{ color: '#20d29b' }} dir="ltr">
              {moneyText(usdWallet.cachedBalanceMinor, 'USD', lang)}
            </strong>
          </article>
        )}
      </section>

      <section style={styles.iconActions}>
        {[
          ['⊕', t.topup, '/payment/local-wallet'],
          ['□', t.sendGiftQuick, '/wallet/gift/claim'],
          ['▤', t.audit, '/wallet/admin/gift-audit'],
          ['◷', t.paymentStatus, '/status'],
          ['♢', t.trustCenter, '/trust-center'],
        ].map(([icon, label, route]) => (
          <button key={String(label)} style={styles.iconButton} onClick={() => (window.location.hash = String(route))}>
            <span>{icon}</span>
            <strong>{label}</strong>
          </button>
        ))}
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.financeLanes}</h2>
          <div style={styles.laneGrid}>
            {[
              [t.protectedFunds, t.held, '#20d29b'],
              [t.refundLane, t.refunds, '#5268ff'],
              [t.giftLane, t.prepaid, '#e5b80b'],
              [t.adminLane, t.safety, '#ff5f7d'],
            ].map(([title, meta, color]) => (
              <div key={String(title)} style={styles.lane}>
                <span style={{ ...styles.laneIcon, background: `${color}22`, color: String(color) }}>●</span>
                <strong>{title}</strong>
                <small>{meta}</small>
              </div>
            ))}
          </div>
          <p style={styles.note}>{t.marketNote}</p>
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.safety}</h2>
          <div style={styles.stack}>
            {t.safetyRows.map((row, index) => (
              <div key={row} style={styles.safetyRow}>
                <strong>{index + 1}</strong>
                <span>{row}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.gift}</h2>
          <label style={styles.label}>
            {t.recipientPhone}
            <input dir="ltr" style={styles.input} value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} />
          </label>
          <label style={styles.label}>
            {t.amount}
            <input dir="ltr" style={styles.input} value={amountMinor} onChange={(event) => setAmountMinor(event.target.value)} />
          </label>
          <div style={styles.actions}>
            <button
              style={giftCurrency === 'SYP' ? styles.primaryButton : styles.secondaryButton}
              onClick={() => setGiftCurrency('SYP')}
              type="button"
            >
              {t.currencySyp}
            </button>
            <button
              style={giftCurrency === 'USD' ? styles.primaryButton : styles.secondaryButton}
              onClick={() => setGiftCurrency('USD')}
              type="button"
            >
              {t.currencyUsd}
            </button>
          </div>
          {giftCurrency === 'USD' && (
            <div style={styles.meta}>
              <span>{t.roundedAmount}</span>
              <strong dir="ltr">{moneyText(roundUsdUpToStep(Number(amountMinor) || 0), 'USD', lang)}</strong>
            </div>
          )}
          <label style={styles.label}>
            {t.message}
            <input style={styles.input} value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <div style={styles.actions}>
            <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void sendGift()}>
              {status === 'saving' ? t.saving : t.send}
            </button>
          </div>
          {gift && (
            <div style={styles.meta}>
              <span>{t.status}</span>
              <strong dir={isAr ? 'rtl' : 'ltr'}>{statusText(gift.status, lang)}</strong>
            </div>
          )}
          {gift && (
            <button
              style={styles.secondaryButton}
              onClick={() => {
                window.location.hash = `/wallet/gift/claim/${gift.id}`
              }}
            >
              {t.claimFlow}
            </button>
          )}
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.entries}</h2>
          {allEntries.length ? (
            <div style={styles.stack}>
              {allEntries.map((entry, index) => (
                <div key={String(entry.id || index)} style={styles.entry}>
                  <strong>{statusText(String(entry.type || '-'), lang)}</strong>
                  <span dir={isAr ? 'rtl' : 'ltr'}>
                    {moneyText(Number(entry.amountMinor || entry.amount || 0), String(entry.currency || 'SYP'), lang)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={styles.empty}>{t.empty}</p>
          )}
          <button style={styles.secondaryButton} onClick={() => void refreshWallet()}>
            {t.refresh}
          </button>
        </article>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#090a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 22, maxWidth: 1100, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center' },
  heroText: { display: 'grid', gap: 6, justifyItems: 'end' },
  trusted: { justifySelf: 'start', border: '1px solid rgba(32,210,155,.35)', borderRadius: 999, background: 'rgba(32,210,155,.12)', color: '#20d29b', padding: '8px 14px', margin: 0, fontWeight: 950 },
  brandCoin: { width: 70, height: 70, borderRadius: 18, background: '#e5b80b', color: '#08090f', display: 'grid', placeItems: 'center', fontWeight: 950, fontSize: 26 },
  eyebrow: { color: '#20d29b', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  balanceHero: { border: '1px solid #282d3d', borderRadius: 8, background: '#12131b', boxShadow: '0 22px 70px rgba(0,0,0,.38)', padding: 30, display: 'grid', gap: 26 },
  balanceTop: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#697386', fontWeight: 900 },
  balanceColumns: { display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' },
  availableValue: { color: '#e5b80b', fontSize: 56, lineHeight: 1 },
  protectedValue: { color: '#20d29b', fontSize: 46, lineHeight: 1 },
  statusPills: { display: 'flex', gap: 10, justifyContent: 'end', flexWrap: 'wrap' },
  iconActions: { display: 'grid', gap: 18, gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))' },
  iconButton: { minHeight: 90, border: 0, background: 'transparent', color: '#fff', display: 'grid', gap: 10, justifyItems: 'center', fontWeight: 900 },
  protectedCard: { border: '1px solid rgba(32,210,155,.4)', borderRadius: 8, background: 'rgba(32,210,155,.08)', padding: 16, display: 'grid', gap: 10, alignContent: 'center' },
  protectedBadge: { width: 'fit-content', border: '1px solid rgba(32,210,155,.45)', borderRadius: 999, color: '#20d29b', padding: '6px 10px', fontSize: 12, fontWeight: 950 },
  balance: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', display: 'flex', justifyContent: 'space-between', gap: 12, padding: 14, color: '#9aa6ba' },
  alert: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 14 },
  error: { borderColor: 'rgba(255,96,96,.45)', background: 'rgba(255,96,96,.1)', color: '#ffd1d1' },
  statsGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  statCard: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 10 },
  statDot: { color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  commandGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 12 },
  cardTitle: { margin: 0, fontSize: 22 },
  laneGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' },
  lane: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 7 },
  laneIcon: { width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 12 },
  note: { margin: 0, color: '#9aa6ba', lineHeight: 1.6 },
  safetyRow: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'flex', gap: 10, alignItems: 'center', color: '#cbd5e1' },
  label: { display: 'grid', gap: 7, color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  input: { minHeight: 52, border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: '0 14px', fontWeight: 900 },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 48, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  meta: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12, color: '#9aa6ba' },
  stack: { display: 'grid', gap: 8 },
  entry: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12, color: '#9aa6ba' },
  empty: { color: '#9aa6ba', margin: 0 },
}
