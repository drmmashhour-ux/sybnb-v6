import { useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { markHostGuestCheckpoint } from '../../shared/api/platformApi'

// Opened when the host scans the guest's arrival QR. One tap marks the guest as checked in using the
// existing host check-in rule (confirmed bookings only, owner host only).
export function HostCheckinPage({ bookingId, lang }: { bookingId: string; lang: Lang }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function confirmArrival() {
    setState('busy')
    setMessage('')
    try {
      await markHostGuestCheckpoint(bookingId, 'CHECK_IN', 'host')
      setState('done')
    } catch (caught) {
      setState('error')
      setMessage(caught instanceof Error ? caught.message : pick(lang, 'تعذر تأكيد الوصول.', 'Could not confirm arrival.', "Impossible de confirmer l'arrivée."))
    }
  }

  const box = { maxWidth: 480, margin: '24px auto', background: '#0c1220', border: '1px solid #263651', borderRadius: 12, padding: 20, color: '#eef1f8', textAlign: 'center' } as const
  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={box}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{pick(lang, 'تأكيد وصول الضيف', 'Confirm guest arrival', "Confirmer l'arrivée de l'invité")}</h1>
      <p style={{ opacity: 0.8, margin: '0 0 14px' }}>
        {pick(lang, 'سجّل الدخول كمضيف ثم اضغط للتأكيد. يعمل هذا فقط على الحجوزات المؤكدة لعقاراتك.', 'Sign in as the host, then tap to confirm. This only works on confirmed bookings for your own listings.', "Connectez-vous en tant qu'hôte puis touchez pour confirmer. Fonctionne uniquement pour les réservations confirmées de vos annonces.")}
      </p>
      {state === 'done' ? (
        <p role="status" style={{ color: '#86efac', fontWeight: 700 }}>{pick(lang, 'تم تأكيد وصول الضيف.', 'Guest arrival confirmed.', "Arrivée de l'invité confirmée.")}</p>
      ) : (
        <button
          disabled={state === 'busy'}
          onClick={() => void confirmArrival()}
          style={{ padding: '12px 18px', borderRadius: 8, border: 0, background: '#38bdf8', color: '#0a0f1d', fontWeight: 700, opacity: state === 'busy' ? 0.6 : 1 }}
        >
          {pick(lang, 'تأكيد وصول الضيف', 'Confirm guest arrival', "Confirmer l'arrivée")}
        </button>
      )}
      {state === 'error' ? <p role="alert" style={{ color: '#fca5a5', marginTop: 12 }}>{message}</p> : null}
    </main>
  )
}
