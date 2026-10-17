import { useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { redeemEmailLoginLink } from '../../shared/api/platformApi'

// Landing page of the emailed "open my booking" link (#/open/<token>). The token is redeemed only on
// a tap (not on page load) so email link scanners that prefetch the URL cannot burn the one-time link.
export function OpenBookingLinkPage({ token, lang }: { token: string; lang: Lang }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function open() {
    setState('busy')
    setMessage('')
    try {
      const { bookingId } = await redeemEmailLoginLink(token)
      window.location.hash = bookingId ? `/booking/${bookingId}` : '/dashboard'
    } catch (caught) {
      setState('error')
      setMessage(caught instanceof Error ? caught.message : pick(lang, 'الرابط غير صالح أو منتهي.', 'This link is invalid or expired.', 'Ce lien est invalide ou expiré.'))
    }
  }

  const box = { maxWidth: 480, margin: '24px auto', background: '#0c1220', border: '1px solid #263651', borderRadius: 12, padding: 20, color: '#eef1f8', textAlign: 'center' } as const
  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={box}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{pick(lang, 'افتح حجزك', 'Open your booking', 'Ouvrir votre réservation')}</h1>
      <p style={{ opacity: 0.8, margin: '0 0 14px' }}>
        {pick(lang, 'اضغط للمتابعة. سيتم تأكيد بريدك الإلكتروني وفتح حسابك تلقائياً.', 'Tap to continue. Your email will be confirmed and your account opened automatically.', 'Touchez pour continuer. Votre e-mail sera confirmé et votre compte ouvert automatiquement.')}
      </p>
      <button
        disabled={state === 'busy'}
        onClick={() => void open()}
        style={{ padding: '12px 18px', borderRadius: 8, border: 0, background: '#38bdf8', color: '#0a0f1d', fontWeight: 700, opacity: state === 'busy' ? 0.6 : 1 }}
      >
        {pick(lang, 'فتح الحجز', 'Open my booking', 'Ouvrir ma réservation')}
      </button>
      {state === 'error' ? <p role="alert" style={{ color: '#fca5a5', marginTop: 12 }}>{message}</p> : null}
    </main>
  )
}
