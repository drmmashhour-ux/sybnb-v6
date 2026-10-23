import { useEffect, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { fetchMshPointsBalance, payBookingWithWallet } from '../../shared/api/platformApi'
import { WALLET_RETURN_KEY } from '../wallet-live/MshPointsWalletPage'

// "Pay with MSH points" on a USD stay (1 MSH = $1). Enough points -> one tap, confirmed instantly
// (server: POST /api/bookings/:id/pay-with-wallet). Not enough -> buy points, then come back.
export function MshPayOption({ lang, bookingId, totalMinor, onPaid }: { lang: Lang; bookingId: string; totalMinor: number; onPaid: () => void }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [balance, setBalance] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    fetchMshPointsBalance().then((b) => { if (!cancelled) setBalance(b) }).catch(() => { if (!cancelled) setBalance(0) })
    return () => { cancelled = true }
  }, [])
  const enough = balance !== null && balance >= totalMinor

  async function pay() {
    setBusy(true); setError('')
    try {
      await payBookingWithWallet(bookingId)
      onPaid()
    } catch (e) {
      const code = (e as { code?: string })?.code
      setError(code === 'WALLET_INSUFFICIENT_FUNDS'
        ? t('رصيد نقاط MSH غير كافٍ لهذا الحجز.', 'Not enough MSH points for this booking.', 'Pas assez de points MSH pour cette réservation.')
        : t('تعذر الدفع بالنقاط الآن. حاول مرة أخرى.', 'Could not pay with points right now. Please try again.', 'Paiement par points impossible pour le moment. Réessayez.'))
      setBusy(false)
    }
  }
  function buyPoints() {
    try { sessionStorage.setItem(WALLET_RETURN_KEY, bookingId) } catch { /* ignore */ }
    window.location.hash = '/wallet'
  }

  const card = { border: '1px solid rgba(56,189,248,.5)', borderRadius: 12, background: 'rgba(56,189,248,.08)', color: '#eef1f8', padding: 14, display: 'grid', gap: 8, textAlign: 'start' } as const
  const primary = { minHeight: 46, borderRadius: 10, border: 0, background: '#38bdf8', color: '#0a0f1d', fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 } as const
  const ghost = { minHeight: 44, borderRadius: 10, border: '1px solid #38bdf8', background: 'transparent', color: '#7dd3fc', fontWeight: 700, cursor: 'pointer' } as const
  return (
    <div style={card} data-testid="msh-pay">
      <strong>{t('الدفع بنقاط MSH', 'Pay with MSH points', 'Payer avec des points MSH')}</strong>
      <small style={{ color: '#9aa6ba' }}>
        {t(`المطلوب ${totalMinor} MSH · رصيدك ${balance ?? '…'} MSH (1 نقطة = 1$). يتأكد الحجز فوراً.`, `Needed ${totalMinor} MSH · your balance ${balance ?? '…'} MSH (1 point = $1). Confirmed instantly.`, `Requis ${totalMinor} MSH · votre solde ${balance ?? '…'} MSH (1 point = 1 $). Confirmé immédiatement.`)}
      </small>
      {enough ? (
        <button type="button" style={primary} disabled={busy} data-testid="msh-pay-btn" onClick={() => void pay()}>
          {busy ? '…' : t(`ادفع ${totalMinor} MSH`, `Pay ${totalMinor} MSH`, `Payer ${totalMinor} MSH`)}
        </button>
      ) : (
        <button type="button" style={ghost} data-testid="msh-buy-btn" onClick={buyPoints}>
          {t('اشترِ نقاط MSH (بطاقة أو شام كاش)', 'Buy MSH points (card or Sham Cash)', 'Acheter des points MSH (carte ou Sham Cash)')}
        </button>
      )}
      {error ? <small role="alert" style={{ color: '#fca5a5' }}>{error}</small> : null}
    </div>
  )
}
