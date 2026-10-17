import { useState } from 'react'
import { confirmOtp, getStoredGuestSession, isGuestEmailUnverified, requestOtp, verifyGuestEmail } from '../api/platformApi'

// Shown to a guest who started checkout without an emailed code. They must prove the email before
// uploading payment proof, paying by card or messaging a host. Renders nothing for verified accounts.
type Props = { lang: string; onVerified?: () => void }

const COPY = {
  ar: { title: 'أكّد بريدك قبل رفع إثبات الدفع', send: 'إرسال الرمز', code: 'الرمز المكوّن من 6 أرقام', verify: 'تأكيد', sent: 'أرسلنا الرمز إلى بريدك.', error: 'تعذر التأكيد. حاول مرة أخرى.' },
  en: { title: 'Confirm your email before uploading payment proof', send: 'Send code', code: '6-digit code', verify: 'Confirm', sent: 'We sent the code to your email.', error: 'Could not confirm. Please try again.' },
  fr: { title: "Confirmez votre e-mail avant d'envoyer la preuve de paiement", send: 'Envoyer le code', code: 'Code à 6 chiffres', verify: 'Confirmer', sent: 'Nous avons envoyé le code à votre e-mail.', error: 'Confirmation impossible. Réessayez.' },
}

export function VerifyEmailBox({ lang, onVerified }: Props) {
  const t = lang === 'ar' ? COPY.ar : lang === 'fr' ? COPY.fr : COPY.en
  const [needed, setNeeded] = useState(() => isGuestEmailUnverified())
  const [step, setStep] = useState<'send' | 'code'>('send')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const email = getStoredGuestSession()?.user?.email || ''
  if (!needed) return null

  async function send() {
    setBusy(true)
    setError('')
    try {
      await requestOtp({ email, purpose: 'guest-login' })
      setStep('code')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.error)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    setError('')
    try {
      const ok = await confirmOtp({ email, purpose: 'guest-login', code: code.trim() })
      if (!ok) throw new Error(t.error)
      await verifyGuestEmail()
      setNeeded(false)
      onVerified?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.error)
    } finally {
      setBusy(false)
    }
  }

  const box = { background: '#0c1220', border: '1px solid #263651', borderRadius: 12, padding: 16, marginBottom: 12, color: '#eef1f8' } as const
  const input = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #263651', background: '#0a0f1d', color: '#eef1f8', marginTop: 6, boxSizing: 'border-box' } as const
  const button = { marginTop: 10, padding: '10px 14px', borderRadius: 8, border: 0, background: '#38bdf8', color: '#0a0f1d', fontWeight: 700, opacity: busy ? 0.6 : 1 } as const
  return (
    <div style={box}>
      <strong style={{ display: 'block', marginBottom: 6 }}>{t.title}</strong>
      <p dir="ltr" style={{ margin: '0 0 10px', opacity: 0.8 }}>{email}</p>
      {step === 'send' ? (
        <button style={button} disabled={busy || !email} onClick={() => void send()}>{t.send}</button>
      ) : (
        <>
          <p style={{ margin: '0 0 6px', color: '#7dd3fc' }}>{t.sent}</p>
          <label style={{ display: 'block' }}>
            {t.code}
            <input style={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
          </label>
          <button style={button} disabled={busy || code.length !== 6} onClick={() => void verify()}>{t.verify}</button>
        </>
      )}
      {error ? <p role="alert" style={{ color: '#fca5a5', margin: '10px 0 0' }}>{error}</p> : null}
    </div>
  )
}
