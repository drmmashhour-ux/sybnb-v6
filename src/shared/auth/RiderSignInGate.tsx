import { useState } from 'react'
import { confirmOtp, requestOtp, signInRiderWithEmailCode } from '../api/platformApi'
import { STAYS_ONLY } from '../brand/brandName'

// Passenger / guest entry point: a verified email code is the only step. No password, no sign-up
// form. Hosts, sellers, car sellers, construction companies and drivers keep their account sign-in.
// codeFree: checkout mode. A brand-new email continues with no code (verified later, before payment
// proof); an email that already has an account is sent a code and must enter it.
type Props = { lang: string; onSignedIn: () => void; codeFree?: boolean }

const COPY = {
  ar: {
    title: 'تحقق من بريدك لطلب الرحلة أو الحجز',
    hint: 'لا تحتاج إلى حساب أو كلمة مرور. أدخل بريدك وسنرسل لك رمزاً.',
    email: 'البريد الإلكتروني',
    send: 'إرسال الرمز',
    code: 'الرمز المكوّن من 6 أرقام',
    verify: 'تأكيد ومتابعة',
    error: 'تعذر إكمال التحقق. حاول مرة أخرى.',
    cont: 'متابعة',
    freeHint: 'لا تحتاج إلى حساب أو كلمة مرور. أدخل بريدك للمتابعة، وسنطلب تأكيده قبل رفع إثبات الدفع.',
    existing: 'هذا البريد لديه حساب. أرسلنا إليك رمزاً، أدخله للمتابعة.',
    staysTitle: 'تحقق من بريدك لإكمال الحجز',
    partner: 'هذا البريد مسجّل كحساب مضيف أو إدارة، ولا يمكن استخدامه للحجز كضيف. استخدم بريداً آخر للحجز، أو سجّل الدخول بكلمة المرور من «تسجيل الدخول».',
    codeWrong: 'الرمز غير صحيح. تحقق منه وحاول مرة أخرى.',
    codeGone: 'انتهت صلاحية الرمز أو استُخدم. اضغط «إرسال رمز جديد».',
    locked: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
    tooSoon: 'انتظر دقيقة قبل طلب رمز جديد.',
    resend: 'إرسال رمز جديد',
    otherEmail: 'استخدام بريد آخر',
  },
  en: {
    title: 'Verify your email to request a ride or book',
    hint: 'No account or password needed. Enter your email and we will send you a code.',
    email: 'Email address',
    send: 'Send code',
    code: '6-digit code',
    verify: 'Verify and continue',
    error: 'Could not complete verification. Please try again.',
    cont: 'Continue',
    freeHint: 'No account or password needed. Enter your email to continue; we will ask you to confirm it before you upload payment proof.',
    existing: 'This email already has an account. We sent you a code; enter it to continue.',
    staysTitle: 'Verify your email to complete your booking',
    partner: 'This email is registered as a host or admin account and cannot book as a guest. Use another email to book, or sign in with your password from "Log in".',
    codeWrong: 'That code is not correct. Check it and try again.',
    codeGone: 'This code has expired or was already used. Tap "Send a new code".',
    locked: 'Too many attempts. Please wait a little and try again.',
    tooSoon: 'Please wait a minute before requesting a new code.',
    resend: 'Send a new code',
    otherEmail: 'Use another email',
  },
  fr: {
    title: 'Vérifiez votre e-mail pour demander une course ou réserver',
    hint: "Aucun compte ni mot de passe requis. Entrez votre e-mail et nous enverrons un code.",
    email: 'Adresse e-mail',
    send: 'Envoyer le code',
    code: 'Code à 6 chiffres',
    verify: 'Vérifier et continuer',
    error: 'La vérification a échoué. Réessayez.',
    cont: 'Continuer',
    freeHint: "Aucun compte ni mot de passe requis. Entrez votre e-mail pour continuer ; nous vous demanderons de le confirmer avant d'envoyer la preuve de paiement.",
    existing: 'Cet e-mail a déjà un compte. Nous vous avons envoyé un code ; saisissez-le pour continuer.',
    staysTitle: 'Vérifiez votre e-mail pour finaliser la réservation',
    partner: "Cet e-mail est un compte hôte ou administrateur et ne peut pas réserver en tant que voyageur. Utilisez un autre e-mail, ou connectez-vous avec votre mot de passe via « Connexion ».",
    codeWrong: 'Ce code est incorrect. Vérifiez-le et réessayez.',
    codeGone: 'Ce code a expiré ou a déjà été utilisé. Appuyez sur « Envoyer un nouveau code ».',
    locked: 'Trop de tentatives. Patientez un peu puis réessayez.',
    tooSoon: "Patientez une minute avant de demander un nouveau code.",
    resend: 'Envoyer un nouveau code',
    otherEmail: 'Utiliser un autre e-mail',
  },
}

// Server errors arrive in English; show the guest a message in their language instead.
function friendlyError(caught: unknown, t: (typeof COPY)['ar']): string {
  const code = (caught as { code?: string } | null)?.code || ''
  if (code === 'GUEST_SESSION_NOT_ALLOWED') return t.partner
  if (code === 'OTP_CODE_INVALID') return t.codeWrong
  if (code === 'OTP_NOT_FOUND' || code === 'OTP_EXPIRED' || code === 'OTP_ALREADY_USED') return t.codeGone
  if (code === 'OTP_LOCKED' || code === 'RATE_LIMITED') return t.locked
  if (code === 'OTP_RESEND_TOO_SOON') return t.tooSoon
  return t.error
}

function copyFor(lang: string) {
  return lang === 'ar' ? COPY.ar : lang === 'fr' ? COPY.fr : COPY.en
}

export function RiderSignInGate({ lang, onSignedIn, codeFree = false }: Props) {
  const t = copyFor(lang)
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Set once /api/otp/verify accepted the code: a retry then only re-asks for the session instead of
  // re-verifying an already-accepted code (which the server would report as 'no active code').
  const [codeAccepted, setCodeAccepted] = useState(false)

  async function continueWithoutCode() {
    setBusy(true)
    setError('')
    try {
      await signInRiderWithEmailCode(email, { skipCode: true })
      onSignedIn()
    } catch (caught) {
      if ((caught as { code?: string })?.code === 'GUEST_SESSION_CODE_REQUIRED') {
        try {
          await requestOtp({ email: email.trim(), purpose: 'guest-login' })
          setNotice(t.existing)
          setStep('code')
        } catch (sendError) {
          setError(friendlyError(sendError, t))
        }
      } else {
        setError(friendlyError(caught, t))
      }
    } finally {
      setBusy(false)
    }
  }

  async function sendCode() {
    setBusy(true)
    setError('')
    try {
      await requestOtp({ email: email.trim(), purpose: 'guest-login' })
      setCode('')
      setCodeAccepted(false)
      setStep('code')
    } catch (caught) {
      setError(friendlyError(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    setBusy(true)
    setError('')
    try {
      if (!codeAccepted) {
        const verified = await confirmOtp({ email: email.trim(), purpose: 'guest-login', code: code.trim() })
        if (!verified) throw new Error(t.error)
        setCodeAccepted(true)
      }
      await signInRiderWithEmailCode(email)
      onSignedIn()
    } catch (caught) {
      const errCode = (caught as { code?: string } | null)?.code
      if (errCode === 'GUEST_SESSION_NOT_ALLOWED' || errCode === 'GUEST_SESSION_CODE_REQUIRED') setCodeAccepted(false)
      if (errCode === 'GUEST_SESSION_NOT_ALLOWED') { setStep('email'); setNotice('') }
      setError(friendlyError(caught, t))
    } finally {
      setBusy(false)
    }
  }

  const box = { background: '#0c1220', border: '1px solid #263651', borderRadius: 12, padding: 16, marginBottom: 12, color: '#eef1f8' } as const
  const input = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #263651', background: '#0a0f1d', color: '#eef1f8', marginTop: 6, boxSizing: 'border-box' } as const
  const link = { background: 'none', border: 0, padding: 0, color: '#7dd3fc', textDecoration: 'underline', cursor: busy ? 'default' : 'pointer', font: 'inherit' } as const
  const button = { marginTop: 10, padding: '10px 14px', borderRadius: 8, border: 0, background: '#38bdf8', color: '#0a0f1d', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 } as const

  return (
    <div style={box}>
      <strong style={{ display: 'block', marginBottom: 6 }}>{STAYS_ONLY ? t.staysTitle : t.title}</strong>
      <p style={{ margin: '0 0 10px', opacity: 0.8 }}>{codeFree ? t.freeHint : t.hint}</p>
      {notice ? <p style={{ margin: '0 0 10px', color: '#7dd3fc' }}>{notice}</p> : null}
      {step === 'email' ? (
        <>
          <label style={{ display: 'block' }}>
            {t.email}
            <input style={input} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <button style={button} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={() => void (codeFree ? continueWithoutCode() : sendCode())}>
            {codeFree ? t.cont : t.send}
          </button>
        </>
      ) : (
        <>
          <label style={{ display: 'block' }}>
            {t.code}
            <input style={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
          </label>
          <button style={button} disabled={busy || code.length !== 6} onClick={() => void verifyCode()}>
            {t.verify}
          </button>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" style={link} disabled={busy} onClick={() => void sendCode()}>{t.resend}</button>
            <button type="button" style={link} disabled={busy} onClick={() => { setStep('email'); setCode(''); setNotice(''); setError(''); setCodeAccepted(false) }}>{t.otherEmail}</button>
          </div>
        </>
      )}
      {error ? <p role="alert" style={{ color: '#fca5a5', margin: '10px 0 0' }}>{error}</p> : null}
    </div>
  )
}
