import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeWalletGift,
  fetchPrototypeWallet,
  type PlatformWallet,
  type PlatformWalletGift,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'

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
    prepaid: 'أكواد وهدايا',
    safety: 'أمان المحفظة',
    safetyRows: ['سجل حركات غير قابل للتعديل', 'إثبات الدفع مرتبط بالحجز', 'منع الدفع خارج SYBNB', 'مراجعة الإدارة للحركات الحساسة'],
    sendGiftQuick: 'إرسال هدية',
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
    prepaid: 'Codes and gifts',
    safety: 'Wallet safety',
    safetyRows: ['Immutable ledger trail', 'Payment proof connected to booking', 'Outside-SYBNB payment warning', 'Admin review for sensitive moves'],
    sendGiftQuick: 'Send gift',
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
  fr: {
    back: 'Retour à l’accueil',
    title: 'Mon portefeuille financier',
    titleEn: 'My Financial Wallet',
    subtitle: 'Solde et cadeaux réels enregistrés dans la base de données.',
    trusted: 'V6 VÉRIFIÉ',
    accountId: 'Numéro de compte',
    protected: 'Portefeuille protégé',
    protectedCopy: 'Chaque mouvement est inscrit au registre comptable et peut être vérifié par l’administration.',
    available: 'Disponible',
    held: 'Fonds retenus',
    refunds: 'Remboursements',
    prepaid: 'Codes et cadeaux',
    safety: 'Sécurité du portefeuille',
    safetyRows: ['Historique des mouvements non modifiable', 'Preuve de paiement liée à la réservation', 'Avertissement contre les paiements hors SYBNB', 'Vérification par l’administration des mouvements sensibles'],
    sendGiftQuick: 'Envoyer un cadeau',
    paymentStatus: 'Statut du paiement',
    trustCenter: 'Centre de confiance',
    financeLanes: 'Circuits financiers',
    protectedFunds: 'Fonds de réservation protégés',
    protectedFundsShort: 'Fonds protégés',
    refunded: 'Remboursés',
    inReview: 'En vérification',
    heldShort: 'Retenus',
    refundLane: 'Remboursement / litige',
    giftLane: 'Cadeaux et codes prépayés',
    adminLane: 'Audit de l’administration',
    balance: 'Solde',
    entries: 'Mouvements du portefeuille',
    recipientPhone: 'Téléphone du destinataire',
    amount: 'Montant du cadeau',
    message: 'Message du cadeau',
    send: 'Envoyer le cadeau',
    claimFlow: 'Ouvrir le lien de réception',
    refresh: 'Actualiser',
    status: 'Statut',
    gift: 'Cadeau',
    saving: 'Enregistrement',
    error: 'L’opération du portefeuille a échoué',
    empty: 'Aucun mouvement pour le moment.',
    marketNote: 'Comme les portefeuilles financiers modernes : le solde est clair, les fonds retenus sont séparés et chaque preuve suit un circuit de vérification.',
  },
}

export function WalletPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [wallet, setWallet] = useState<PlatformWallet | null>(null)
  const [gift, setGift] = useState<PlatformWalletGift | null>(null)
  const [giftClaimCode, setGiftClaimCode] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('+963900000001')
  const [amountMinor, setAmountMinor] = useState('50000')
  const [message, setMessage] = useState(pick(lang, 'هدية من محفظة SYBNB', 'Gift from SYBNB Wallet', 'Cadeau du portefeuille SYBNB'))
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [notice, setNotice] = useState('')
  const entries = wallet?.entries || []
  // Real balance only — never substitute a fabricated number when the wallet is empty/unavailable
  // (the page claims "real balance stored in PostgreSQL"; showing invented money there is misleading).
  // Use the server-computed figures (aggregated over the FULL ledger). cachedBalanceMinor is the
  // settled/available balance; held is outstanding HOLD-minus-RELEASE. The previous client math
  // (balance - sum(HOLD) over only the last 25 entries) double-counted holds and never netted out
  // releases, so a released payout showed as still-held with zero available.
  const availableMinor = wallet?.availableMinor ?? (wallet?.cachedBalanceMinor || 0)
  const heldMinor = wallet?.heldMinor ?? 0
  const refundMinor = wallet?.refundMinor ?? 0

  useEffect(() => {
    void refreshWallet()
  }, [])

  async function refreshWallet() {
    setNotice('')
    try {
      setWallet(await fetchPrototypeWallet())
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
      const result = await createPrototypeWalletGift({
        recipientPhone,
        amountMinor: Math.max(0, Math.round(Number(amountMinor) || 0)),
        currency: 'SYP',
        message,
      })
      setGift(result.gift)
      setGiftClaimCode(result.claimCode)
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
          {wallet?.id && <small>{t.accountId}: SY-{wallet.id.slice(0, 8).toUpperCase()}</small>}
        </div>
        <div style={styles.balanceColumns}>
          <article>
            <span>{t.available} / Available Balance</span>
            <strong style={styles.availableValue} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(availableMinor, wallet?.currency || 'SYP', lang)}</strong>
          </article>
          <article>
            <span>{t.protectedFundsShort} / Protected Funds</span>
            <strong style={styles.protectedValue} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(heldMinor, wallet?.currency || 'SYP', lang)}</strong>
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
          [t.prepaid, gift ? gift.amountMinor : 0, '#ff5f7d'],
        ].map(([label, value, color]) => (
          <article key={String(label)} style={{ ...styles.statCard, borderColor: `${color}55` }}>
            <span style={styles.statDot}>{String(label)}</span>
            <strong style={{ color: String(color) }} dir={isAr ? 'rtl' : 'ltr'}>
              {moneyText(Number(value), wallet?.currency || 'SYP', lang)}
            </strong>
          </article>
        ))}
      </section>

      <section style={styles.iconActions}>
        {(
          [
            ['□', t.sendGiftQuick, () => document.getElementById('gift-compose')?.scrollIntoView({ behavior: 'smooth' })],
            ['◷', t.paymentStatus, () => { window.location.hash = '/status' }],
            ['♢', t.trustCenter, () => { window.location.hash = '/trust-center' }],
          ] as Array<[string, string, () => void]>
        ).map(([icon, label, onClick]) => (
          <button key={label} style={styles.iconButton} onClick={onClick}>
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
        <article id="gift-compose" style={styles.card}>
          <h2 style={styles.cardTitle}>{t.gift}</h2>
          <label style={styles.label}>
            {t.recipientPhone}
            <input dir="ltr" style={styles.input} value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} />
          </label>
          <label style={styles.label}>
            {t.amount}
            <input dir="ltr" style={styles.input} value={amountMinor} onChange={(event) => setAmountMinor(event.target.value)} />
          </label>
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
          {gift && giftClaimCode && (
            <div style={styles.meta}>
              <span>{pick(lang, 'رمز الاستلام — شاركه مع المستلم', 'Claim code — share it with the recipient', 'Code de réception — partagez-le avec le destinataire')}</span>
              <strong dir="ltr" style={{ letterSpacing: 4, fontSize: 20 }}>{giftClaimCode}</strong>
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
          {entries.length ? (
            <div style={styles.stack}>
              {entries.map((entry, index) => (
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
  auditPanel: { border: '1px solid #1e1e2a', borderLeft: '5px solid #5268ff', borderRadius: 8, background: '#111118', padding: 20, display: 'grid', gap: 16, gridTemplateColumns: 'minmax(180px, .7fr) minmax(0, 1fr)', alignItems: 'center', boxShadow: '0 16px 40px rgba(0,0,0,.32)' },
  auditIcon: { color: '#5268ff', fontSize: 26 },
  auditButton: { gridColumn: '1 / -1', minHeight: 46, border: 0, borderRadius: 8, background: '#20202c', color: '#fff', fontWeight: 950 },
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
