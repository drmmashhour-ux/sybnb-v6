import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { getStoredGuestSession } from '../../shared/api/platformApi'
import { goToExternalPayment } from '../../shared/api/authStorage'

import { publicWebOrigin } from '../../shared/native/nativeShell'
/**
 * Rezekme Stays wallet: MSH points (1 MSH = $1), the same platform credit riders use on
 * rides.rezekme.com (one account, one USD wallet). Buy points by card (Stripe Checkout, credited as
 * soon as Stripe confirms) or Sham Cash (reference -> admin confirms the money arrived -> credited),
 * then pay a stay from them (booking page "Pay with MSH points"). Owner decision 2026-10-22.
 */
const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'
const SHAM_QR = ((import.meta.env.VITE_SHAMCASH_QR_URL as string | undefined) || '').trim() || '/assets/payments/syrian-local-wallet-qr-clean.jpg'
const CHIPS = [10, 20, 50, 100]
const MIN = 5
const MAX = 500
export const WALLET_RETURN_KEY = 'rzk-wallet-return-booking'

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

export function MshPointsWalletPage({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [amount, setAmount] = useState<number>(20)
  const [custom, setCustom] = useState('')
  const [method, setMethod] = useState<'card' | 'sham'>('card')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [returnBooking] = useState(() => { try { return sessionStorage.getItem(WALLET_RETURN_KEY) || '' } catch { return '' } })

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
      goToExternalPayment(r.url)
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); setBusy(false) }
  }
  const sendProof = async () => {
    if (!valid || !ref.trim() || busy) return
    setBusy(true); setMsg(null)
    try {
      await call('POST', '/api/wallet/topup-proof', { amountMinor: value, currency: 'USD', providerRef: ref.trim() })
      setRef('')
      setMsg({ kind: 'ok', text: t('تم إرسال إثبات التحويل. بعد أن يؤكد المشرف وصول المبلغ تُضاف النقاط إلى محفظتك.', 'Transfer proof sent. Once an admin confirms the money arrived the points are added to your wallet.', 'Preuve envoyée. Après confirmation par l’administrateur, les points sont ajoutés.') })
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={S.page} data-testid="msh-wallet">
      <h1 style={S.h1}>{t('محفظتي — نقاط MSH', 'My wallet — MSH points', 'Mon portefeuille — points MSH')}</h1>
      <section style={S.balance} data-testid="msh-balance">
        <span style={S.muted}>{t('رصيد نقاط MSH المتاح', 'Your MSH points balance', 'Votre solde de points MSH')}</span>
        <strong style={S.big}>{wallet ? `${wallet.availableMinor} MSH` : '…'}</strong>
        <span style={S.muted}>{wallet ? `= $${wallet.availableMinor}` : ''} · {t('1 نقطة MSH = 1 دولار', '1 MSH point = $1', '1 point MSH = 1 $')}</span>
        <span style={S.muted}>{t('رصيد لدفع الإقامات والرحلات الحقيقية على Rezekme فقط (1 نقطة = 1$)، ويتأكد الحجز فوراً.', 'A balance used only to pay real stays and rides on Rezekme (1 point = $1); bookings are confirmed instantly.', 'Un solde servant uniquement à payer de vrais séjours et courses Rezekme (1 point = 1 $) ; confirmation immédiate.')}</span>
      </section>

      {returnBooking && (
        <button type="button" style={S.primary} data-testid="wallet-back-to-booking" onClick={() => { try { sessionStorage.removeItem(WALLET_RETURN_KEY) } catch { /* ignore */ } window.location.hash = `/booking/${returnBooking}` }}>
          {t('العودة لإكمال دفع الحجز', 'Back to pay your booking', 'Retour au paiement de la réservation')}
        </button>
      )}

      <section style={S.card}>
        <strong>{t('شحن رصيد المحفظة', 'Add funds to your wallet', 'Alimenter votre portefeuille')}</strong>
        <div style={S.chips}>
          {CHIPS.map((c) => (
            <button key={c} type="button" style={!custom.trim() && amount === c ? S.chipOn : S.chip} onClick={() => { setAmount(c); setCustom('') }}>${c}</button>
          ))}
          <input style={S.custom} inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('مبلغ آخر', 'Other', 'Autre')} aria-label={t('مبلغ آخر', 'Other amount', 'Autre montant')} />
        </div>
        <span style={valid ? S.muted : S.warn}>{rangeText}</span>
        <div style={S.tabs}>
          <button type="button" style={method === 'card' ? S.tabOn : S.tab} onClick={() => setMethod('card')}>{t('بطاقة ائتمانية', 'Credit card', 'Carte bancaire')}</button>
          <button type="button" style={method === 'sham' ? S.tabOn : S.tab} onClick={() => setMethod('sham')}>Sham Cash</button>
        </div>
        {method === 'card' ? (
          <div style={S.body}>
            <span style={S.muted}>{t('ستنتقل إلى Stripe للدفع الآمن. يُضاف الرصيد فور تأكيد الدفع.', 'You will pay securely on Stripe. The funds are added as soon as the payment is confirmed.', 'Paiement sécurisé sur Stripe. Le solde est crédité dès la confirmation.')}</span>
            <button type="button" data-testid="topup-card" style={valid && !busy ? S.primary : S.primaryOff} disabled={!valid || busy} onClick={() => void payCard()}>
              {busy ? '…' : t(`اشحن $${valid ? value : ''} بالبطاقة`, `Add $${valid ? value : ''} by card`, `Ajouter ${valid ? value : ''} $ par carte`)}
            </button>
          </div>
        ) : (
          <div style={S.body}>
            <span style={S.muted}>{t(`حوّل $${valid ? value : ''} إلى حساب Rezekme عبر Sham Cash ثم اكتب رقم المرجع.`, `Send $${valid ? value : ''} to the Rezekme account on Sham Cash, then enter the reference.`, `Envoyez ${valid ? value : ''} $ au compte Rezekme via Sham Cash puis saisissez la référence.`)}</span>
            <img src={SHAM_QR} alt="Sham Cash QR" style={S.qr} />
            <input data-testid="topup-sham-ref" style={S.input} dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('رقم مرجع التحويل', 'Transfer reference number', 'Référence du transfert')} />
            <button type="button" data-testid="topup-sham" style={valid && ref.trim() && !busy ? S.primary : S.primaryOff} disabled={!valid || !ref.trim() || busy} onClick={() => void sendProof()}>
              {busy ? '…' : t('إرسال إثبات الدفع', 'Submit payment proof', 'Envoyer la preuve')}
            </button>
            <span style={S.muted}>{t('تُضاف النقاط بعد تأكيد المشرف.', 'Credited after an admin confirms.', 'Crédité après confirmation de l’administrateur.')}</span>
          </div>
        )}
        {msg && <div style={msg.kind === 'ok' ? S.ok : S.err} role="status" data-testid="topup-msg">{msg.text}</div>}
      </section>

      {wallet?.entries && wallet.entries.length > 0 && (
        <section style={S.card}>
          <strong>{t('آخر العمليات', 'Recent activity', 'Activité récente')}</strong>
          {wallet.entries.slice(0, 8).map((e) => (
            <div key={e.id} style={S.row}>
              <span style={S.muted}>{new Date(e.createdAt).toLocaleDateString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'))} · {e.note || e.type}</span>
              <strong dir="ltr">{['CREDIT', 'REFUND', 'RELEASE'].includes(e.type) ? '+' : '−'}{e.amountMinor} MSH</strong>
            </div>
          ))}
        </section>
      )}
    </main>
  )
}

const S: Record<string, CSSProperties> = {
  page: { maxWidth: 520, margin: '0 auto', padding: '16px 16px 96px', display: 'grid', gap: 14, boxSizing: 'border-box', color: '#eef1f8' },
  h1: { margin: 0, fontSize: 24 },
  balance: { background: 'linear-gradient(135deg,#1b2340,#0d1220)', border: '1px solid #2b3658', borderRadius: 16, padding: 16, display: 'grid', gap: 4 },
  big: { fontSize: 40, lineHeight: 1.1 },
  card: { border: '1px solid #263651', borderRadius: 16, padding: 14, display: 'grid', gap: 10, background: '#0c1220' },
  muted: { color: '#9aa6ba', fontSize: 14, lineHeight: 1.5 },
  warn: { color: '#fca5a5', fontSize: 14 },
  chips: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  chip: { minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1.5px solid #33415c', background: 'transparent', color: '#eef1f8', fontWeight: 700, fontSize: 16, cursor: 'pointer' },
  chipOn: { minHeight: 44, padding: '0 16px', borderRadius: 12, border: '2px solid #38bdf8', background: '#38bdf8', color: '#0a0f1d', fontWeight: 800, fontSize: 16, cursor: 'pointer' },
  custom: { minHeight: 44, width: 96, borderRadius: 12, border: '1.5px solid #33415c', background: '#0a0f1d', color: '#eef1f8', padding: '0 10px', fontSize: 16, boxSizing: 'border-box' },
  tabs: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tab: { minHeight: 44, padding: '0 16px', borderRadius: 999, border: '1.5px solid #33415c', background: 'transparent', color: '#cbd5e1', fontWeight: 600, cursor: 'pointer' },
  tabOn: { minHeight: 44, padding: '0 16px', borderRadius: 999, border: '1.5px solid #38bdf8', background: 'rgba(56,189,248,.15)', color: '#eef1f8', fontWeight: 800, cursor: 'pointer' },
  body: { display: 'grid', gap: 10 },
  input: { minHeight: 48, borderRadius: 12, border: '1.5px solid #33415c', background: '#0a0f1d', color: '#eef1f8', padding: '0 12px', fontSize: 16, boxSizing: 'border-box', width: '100%' },
  qr: { width: 170, borderRadius: 10, background: '#fff' },
  primary: { minHeight: 52, borderRadius: 14, border: 0, background: '#38bdf8', color: '#0a0f1d', fontWeight: 800, fontSize: 17, cursor: 'pointer' },
  primaryOff: { minHeight: 52, borderRadius: 14, border: 0, background: '#33415c', color: '#9aa6ba', fontWeight: 800, fontSize: 17 },
  ok: { background: 'rgba(32,210,155,.12)', color: '#86efac', borderRadius: 10, padding: '10px 12px', fontSize: 15, fontWeight: 600 },
  err: { background: 'rgba(252,165,165,.12)', color: '#fca5a5', borderRadius: 10, padding: '10px 12px', fontSize: 15 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 15 },
}
