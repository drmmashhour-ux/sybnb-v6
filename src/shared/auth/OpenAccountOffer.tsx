import { useEffect, useState } from 'react'
import {
  confirmOtp,
  fetchAccountSetup,
  getStoredGuestSession,
  requestOtp,
  submitAccountSetup,
  verifyGuestEmail,
  type AccountSetupState,
} from '../api/platformApi'

// Owner decision 2026-10-22: a guest who booked with only an email (card payment, no account) is
// offered -- after paying, never before -- a free account to follow the booking and receive notices
// and offers. Optional and dismissible. If the email is not proven yet (code-free checkout) a 6-digit
// code is sent in-page first, so nobody can turn someone else's address into an account.
type Props = { lang: string }

const COPY = {
  ar: {
    title: 'هل تريد فتح حساب مجاني؟',
    why: 'تابع حجزك في أي وقت، وتواصل مع المضيف، واستلم التنبيهات والعروض.',
    password: 'اختر كلمة مرور (8 أحرف على الأقل)',
    marketing: 'أرسلوا لي العروض والتنبيهات بالبريد الإلكتروني',
    create: 'فتح الحساب',
    later: 'ليس الآن',
    codeSent: 'أرسلنا رمزاً من 6 أرقام إلى بريدك لتأكيده:',
    code: 'الرمز',
    confirm: 'تأكيد وفتح الحساب',
    done: 'تم فتح حسابك. يمكنك تسجيل الدخول ببريدك وكلمة المرور.',
    weak: 'كلمة المرور قصيرة: 8 أحرف على الأقل.',
    wrongCode: 'الرمز غير صحيح أو انتهت صلاحيته. حاول مرة أخرى.',
    error: 'تعذر فتح الحساب الآن. حاول مرة أخرى.',
  },
  en: {
    title: 'Would you like a free account?',
    why: 'Follow your booking any time, message your host, and get notices and offers.',
    password: 'Choose a password (at least 8 characters)',
    marketing: 'Email me offers and notices',
    create: 'Open my account',
    later: 'Not now',
    codeSent: 'We sent a 6-digit code to your email to confirm it:',
    code: 'Code',
    confirm: 'Confirm and open account',
    done: 'Your account is open. You can sign in with your email and password.',
    weak: 'Password too short: at least 8 characters.',
    wrongCode: 'That code is wrong or expired. Please try again.',
    error: 'Could not open the account right now. Please try again.',
  },
  fr: {
    title: 'Voulez-vous un compte gratuit ?',
    why: 'Suivez votre réservation à tout moment, écrivez à l’hôte et recevez avis et offres.',
    password: 'Choisissez un mot de passe (8 caractères minimum)',
    marketing: 'Envoyez-moi offres et avis par e-mail',
    create: 'Ouvrir mon compte',
    later: 'Pas maintenant',
    codeSent: 'Nous avons envoyé un code à 6 chiffres à votre e-mail pour le confirmer :',
    code: 'Code',
    confirm: 'Confirmer et ouvrir le compte',
    done: 'Votre compte est ouvert. Connectez-vous avec votre e-mail et votre mot de passe.',
    weak: 'Mot de passe trop court : 8 caractères minimum.',
    wrongCode: 'Code incorrect ou expiré. Réessayez.',
    error: 'Impossible d’ouvrir le compte pour le moment. Réessayez.',
  },
}

const DISMISS_KEY = 'rzk-account-offer-dismissed'

export function OpenAccountOffer({ lang }: Props) {
  const t = lang === 'ar' ? COPY.ar : lang === 'fr' ? COPY.fr : COPY.en
  const [state, setState] = useState<AccountSetupState | null>(null)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  const [password, setPassword] = useState('')
  const [marketing, setMarketing] = useState(true)
  const [step, setStep] = useState<'form' | 'code' | 'done'>('form')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const email = getStoredGuestSession()?.user?.email || ''

  useEffect(() => {
    let cancelled = false
    fetchAccountSetup().then((next) => { if (!cancelled) setState(next) }).catch(() => { if (!cancelled) setState(null) })
    return () => { cancelled = true }
  }, [])

  if (dismissed || !state || (!state.offer && step !== 'done')) return null

  async function finish() {
    await submitAccountSetup({ password, marketing })
    setStep('done')
  }

  async function start() {
    setError('')
    if (password.length < 8) { setError(t.weak); return }
    setBusy(true)
    try {
      if (state?.emailUnverified) {
        await requestOtp({ email, purpose: 'guest-login' })
        setStep('code')
      } else {
        await finish()
      }
    } catch {
      setError(t.error)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setError('')
    setBusy(true)
    try {
      const ok = await confirmOtp({ email, purpose: 'guest-login', code: code.trim() }).catch(() => false)
      if (!ok) { setError(t.wrongCode); return }
      await verifyGuestEmail()
      await finish()
    } catch {
      setError(t.error)
    } finally {
      setBusy(false)
    }
  }

  function later() {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  const box = { border: '1px solid rgba(125,211,252,.45)', borderRadius: 12, background: 'rgba(56,189,248,.08)', color: '#eef1f8', padding: 16, display: 'grid', gap: 10 } as const
  const input = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #263651', background: '#0a0f1d', color: '#eef1f8', boxSizing: 'border-box' } as const
  const primary = { padding: '10px 14px', borderRadius: 8, border: 0, background: '#38bdf8', color: '#0a0f1d', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 } as const
  const ghost = { padding: '10px 14px', borderRadius: 8, border: '1px solid #33415c', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' } as const

  if (step === 'done') {
    return <section style={box} role="status" data-testid="account-offer-done"><strong>✓ {t.done}</strong></section>
  }

  return (
    <section style={box} aria-label={t.title} data-testid="account-offer">
      <strong style={{ fontSize: 17 }}>{t.title}</strong>
      <span style={{ opacity: 0.85, lineHeight: 1.6 }}>{t.why}</span>
      {email ? <span dir="ltr" style={{ opacity: 0.7 }}>{email}</span> : null}
      {step === 'form' ? (
        <>
          <label style={{ display: 'grid', gap: 6 }}>
            {t.password}
            <input style={input} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
            {t.marketing}
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={primary} disabled={busy} onClick={() => void start()}>{t.create}</button>
            <button type="button" style={ghost} disabled={busy} onClick={later}>{t.later}</button>
          </div>
        </>
      ) : (
        <>
          <span style={{ color: '#7dd3fc' }}>{t.codeSent}</span>
          <label style={{ display: 'grid', gap: 6 }}>
            {t.code}
            <input style={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
          </label>
          <button type="button" style={primary} disabled={busy || code.length !== 6} onClick={() => void confirm()}>{t.confirm}</button>
        </>
      )}
      {error ? <p role="alert" style={{ color: '#fca5a5', margin: 0 }}>{error}</p> : null}
    </section>
  )
}
