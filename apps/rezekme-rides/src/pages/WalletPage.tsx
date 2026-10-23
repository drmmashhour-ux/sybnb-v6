import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { getStoredGuestSession } from '@platform/shared/api/platformApi'
import { publicWebOrigin } from '@platform/shared/native/nativeShell'

/**
 * Rezekme wallet (the balance the rider pays rides from). Add money by:
 *  - card (Stripe Checkout, 3-D Secure): credited as soon as Stripe confirms the payment;
 *  - Sham Cash: the rider transfers, submits the reference, an admin checks the money arrived and credits it.
 * USD amounts are whole dollars (same as ride fares).
 */
const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'
const SHAM_QR = ((import.meta.env.VITE_SHAMCASH_QR_URL as string | undefined) || '').trim() || '/assets/payments/syrian-local-wallet-qr-clean.jpg'
const CHIPS = [10, 20, 50, 100]
const MIN = 5
const MAX = 500

type Entry = { id: string; type: string; amountMinor: number; note?: string | null; createdAt: string }
type WalletInfo = { availableMinor: number; heldMinor?: number; entries?: Entry[] }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getStoredGuestSession()?.token
  if (!token) throw new Error('Sign in to continue.')
  const response = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } } & T
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || `Request failed: ${response.status}`)
  return payload
}

export function WalletPage({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [amount, setAmount] = useState<number>(20)
  const [custom, setCustom] = useState('')
  const [method, setMethod] = useState<'card' | 'sham'>('card')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(() => {
    call<{ wallet: WalletInfo | null }>('GET', '/api/wallet?currency=USD').then((r) => setWallet(r.wallet ?? { availableMinor: 0, entries: [] })).catch(() => setWallet({ availableMinor: 0, entries: [] }))
  }, [])
  useEffect(() => { load() }, [load])

  // Returned from Stripe: confirm and credit (the webhook credits too; both are idempotent).
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('topup_session_id')
    if (!sessionId) return
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    setBusy(true)
    call<{ creditedMinor: number }>('POST', '/api/wallet/stripe/confirm-topup', { sessionId })
      .then((r) => { setMsg({ kind: 'ok', text: t(`تمت إضافة ${r.creditedMinor} نقطة MSH إلى محفظتك.`, `${r.creditedMinor} MSH points were added to your wallet.`, `${r.creditedMinor} points MSH ajoutés à votre portefeuille.`) }); load() })
      .catch((e) => setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = custom.trim() ? Math.round(Number(custom)) : amount
  const valid = Number.isInteger(value) && value >= MIN && value <= MAX
  const rangeText = t(`المبلغ من $${MIN} إلى $${MAX}`, `Amount from $${MIN} to $${MAX}`, `Montant de ${MIN} $ à ${MAX} $`)

  const payCard = async () => {
    if (!valid || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await call<{ url: string }>('POST', '/api/payments/stripe/guest-checkout-session', { purpose: 'topup', fareMinor: value, currency: 'USD', origin: publicWebOrigin() })
      window.location.href = r.url
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); setBusy(false) }
  }
  const sendProof = async () => {
    if (!valid || !ref.trim() || busy) return
    setBusy(true); setMsg(null)
    try {
      await call('POST', '/api/wallet/topup-proof', { amountMinor: value, currency: 'USD', providerRef: ref.trim() })
      setRef('')
      setMsg({ kind: 'ok', text: t('تم إرسال إثبات التحويل. بعد أن يؤكد المشرف وصول المبلغ يُضاف إلى محفظتك.', 'Transfer proof sent. Once an admin confirms the money arrived it is added to your wallet.', 'Preuve envoyée. Après confirmation par l’administrateur, le montant est ajouté.') })
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={S.page}>
      <h1 style={S.h1}>{t('المحفظة', 'Wallet', 'Portefeuille')}</h1>
      <section style={S.balance} data-guide="wallet-balance">
        <span style={S.muted}>{t('رصيد نقاط MSH المتاح', 'Your MSH points balance', 'Votre solde de points MSH')}</span>
        <strong style={S.big}>{wallet ? `${wallet.availableMinor} MSH` : '…'}</strong>
        <span style={S.muted}>{wallet ? `= $${wallet.availableMinor}` : ''} · {t('1 نقطة MSH = 1 دولار', '1 MSH point = $1', '1 point MSH = 1 $')}</span>
        <span style={S.muted}>{t('نقاط MSH هي رصيد منصة Rezekme: تُدفع منها رحلاتك قبل أن تبدأ.', 'MSH points are your Rezekme platform credit: your rides are paid from them before they start.', 'Les points MSH sont votre crédit Rezekme : vos courses sont payées avec avant le départ.')}</span>
      </section>

      <section style={S.card}>
        <strong>{t('شحن رصيد المحفظة', 'Add funds to your wallet', 'Alimenter votre portefeuille')}</strong>
        <div style={S.chips} data-guide="topup-amount">
          {CHIPS.map((c) => (
            <button key={c} type="button" style={!custom.trim() && amount === c ? S.chipOn : S.chip} onClick={() => { setAmount(c); setCustom('') }}>${c}</button>
          ))}
          <input style={S.custom} inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('مبلغ آخر', 'Other', 'Autre')} aria-label={t('مبلغ آخر', 'Other amount', 'Autre montant')} />
        </div>
        <span style={valid ? S.muted : S.warn}>{rangeText}</span>

        <div style={S.tabs}>
          <button type="button" data-guide="topup-tab-card" style={method === 'card' ? S.tabOn : S.tab} onClick={() => setMethod('card')}>{t('بطاقة ائتمانية', 'Credit card', 'Carte bancaire')}</button>
          <button type="button" data-guide="topup-tab-sham" style={method === 'sham' ? S.tabOn : S.tab} onClick={() => setMethod('sham')}>Sham Cash</button>
        </div>

        {method === 'card' ? (
          <div style={S.body}>
            <span style={S.muted}>{t('ستنتقل إلى Stripe للدفع الآمن (3D Secure). يُضاف الرصيد فور تأكيد الدفع.', 'You will pay securely on Stripe (3-D Secure). The balance is added as soon as the payment is confirmed.', 'Paiement sécurisé sur Stripe (3-D Secure). Le solde est ajouté dès la confirmation.')}</span>
            <button type="button" data-guide="topup-card" style={valid && !busy ? S.primary : S.primaryOff} disabled={!valid || busy} onClick={() => void payCard()}>
              {busy ? '…' : t(`اشحن $${valid ? value : ''} بالبطاقة`, `Add $${valid ? value : ''} by card`, `Ajouter ${valid ? value : ''} $ par carte`)}
            </button>
          </div>
        ) : (
          <div style={S.body}>
            <span style={S.muted}>{t(`حوّل $${valid ? value : ''} إلى حساب Rezekme عبر Sham Cash ثم اكتب رقم المرجع.`, `Send $${valid ? value : ''} to the Rezekme account on Sham Cash, then enter the reference.`, `Envoyez ${valid ? value : ''} $ au compte Rezekme via Sham Cash puis saisissez la référence.`)}</span>
            <img data-guide="shamcash-qr" src={SHAM_QR} alt="Sham Cash QR" style={S.qr} />
            <input data-guide="shamcash-ref" style={S.input} dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('رقم مرجع التحويل', 'Transfer reference number', 'Référence du transfert')} />
            <button type="button" data-guide="shamcash-submit" style={valid && ref.trim() && !busy ? S.primary : S.primaryOff} disabled={!valid || !ref.trim() || busy} onClick={() => void sendProof()}>
              {busy ? '…' : t('إرسال إثبات الدفع', 'Submit payment proof', 'Envoyer la preuve')}
            </button>
            <span style={S.muted}>{t('يُضاف الرصيد بعد تأكيد المشرف.', 'Credited after an admin confirms.', 'Crédité après confirmation de l’administrateur.')}</span>
          </div>
        )}
        {msg && <div style={msg.kind === 'ok' ? S.ok : S.err} role="status">{msg.text}</div>}
      </section>

      <section style={S.card} data-guide="msh-card">
        <strong>{t('عن MSH', 'About MSH', 'À propos de MSH')}</strong>
        <span style={S.muted}>{t('نقاط MSH هنا رصيد داخل منصة Rezekme (ليست عملة رقمية على بلوك تشين). رمز MSH الحقيقي على الشبكة لم يُطلق بعد؛ وما يوجد حالياً رمز تجريبي على شبكة Sepolia بلا قيمة مالية، للعرض فقط.', 'MSH points here are credit inside the Rezekme platform (not a blockchain coin). The real on-chain MSH token is not launched; the only token that exists is a test token on Sepolia with no money value, view-only.', 'Les points MSH sont ici un crédit interne Rezekme (pas une cryptomonnaie). Le vrai jeton MSH n’est pas lancé ; il existe seulement un jeton de test Sepolia sans valeur, en lecture seule.')}</span>
        <a href="#/wallet/msh" style={S.link}>{t('عرض رصيد MSH التجريبي', 'View my MSH test balance', 'Voir mon solde MSH de test')} →</a>
      </section>

      {wallet?.entries && wallet.entries.length > 0 && (
        <section style={S.card}>
          <strong>{t('آخر العمليات', 'Recent activity', 'Activité récente')}</strong>
          {wallet.entries.slice(0, 8).map((e) => (
            <div key={e.id} style={S.row}>
              <span style={S.muted}>{new Date(e.createdAt).toLocaleDateString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'))} · {e.type}</span>
              <strong dir="ltr">{['CREDIT', 'REFUND', 'RELEASE'].includes(e.type) ? '+' : '−'}${e.amountMinor}</strong>
            </div>
          ))}
        </section>
      )}
    </main>
  )
}

const S: Record<string, CSSProperties> = {
  page: { maxWidth: 480, margin: '0 auto', padding: '16px 16px 96px', display: 'grid', gap: 14, boxSizing: 'border-box' },
  h1: { margin: 0, fontSize: 26 },
  balance: { background: '#111', color: '#fff', borderRadius: 16, padding: 16, display: 'grid', gap: 4 },
  big: { fontSize: 40, lineHeight: 1.1 },
  card: { border: '1px solid #e2e2e2', borderRadius: 16, padding: 14, display: 'grid', gap: 10, background: '#fff' },
  muted: { color: '#666', fontSize: 14, lineHeight: 1.45 },
  warn: { color: '#b42318', fontSize: 14 },
  chips: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  chip: { minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1.5px solid #ccc', background: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer' },
  chipOn: { minHeight: 44, padding: '0 16px', borderRadius: 12, border: '2px solid #111', background: '#111', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer' },
  custom: { minHeight: 44, width: 96, borderRadius: 12, border: '1.5px solid #ccc', padding: '0 10px', fontSize: 16, boxSizing: 'border-box' },
  tabs: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tab: { minHeight: 44, padding: '0 16px', borderRadius: 999, border: '1.5px solid #ccc', background: '#fff', fontWeight: 600, cursor: 'pointer' },
  tabOn: { minHeight: 44, padding: '0 16px', borderRadius: 999, border: '1.5px solid #111', background: '#f5f5f5', fontWeight: 800, cursor: 'pointer' },
  body: { display: 'grid', gap: 10 },
  input: { minHeight: 48, borderRadius: 12, border: '1.5px solid #ccc', padding: '0 12px', fontSize: 16, boxSizing: 'border-box', width: '100%' },
  qr: { width: 170, borderRadius: 10 },
  primary: { minHeight: 52, borderRadius: 14, border: 0, background: '#000', color: '#fff', fontWeight: 800, fontSize: 17, cursor: 'pointer' },
  primaryOff: { minHeight: 52, borderRadius: 14, border: 0, background: '#bbb', color: '#fff', fontWeight: 800, fontSize: 17 },
  ok: { background: '#e6f6ec', color: '#0a5a2a', borderRadius: 10, padding: '10px 12px', fontSize: 15, fontWeight: 600 },
  err: { background: '#fde8e6', color: '#9b1c12', borderRadius: 10, padding: '10px 12px', fontSize: 15 },
  link: { minHeight: 44, display: 'inline-flex', alignItems: 'center', fontWeight: 700, color: '#111' },
  row: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 15 },
}
