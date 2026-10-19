import { useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { confirmOtp, requestOtp, resetPassword } from '../../shared/api/platformApi'

// Forgot password, shared by the seller, host and staff screens (the guest screen has its own copy).
// Three small steps: email -> emailed 6-digit code + new password -> done (go back and sign in).
// Uses the same server rules as the guest reset: a verified 'password-reset' code, then the new password.
type Props = { lang: Lang; initialEmail?: string; onClose: () => void; admin?: boolean }

export function ForgotPasswordPanel({ lang, initialEmail = '', onClose, admin = false }: Props) {
  const [email, setEmail] = useState(initialEmail)
  const [step, setStep] = useState<'ask' | 'code' | 'done'>('ask')
  const [code, setCode] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const fail = (err: unknown) =>
    setError(err instanceof Error && err.message ? err.message : pick(lang, 'تعذّر المتابعة. حاول مرة أخرى.', 'Could not continue. Please try again.', 'Impossible de continuer. Veuillez réessayer.'))

  async function sendCode() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError(pick(lang, 'أدخل بريداً إلكترونياً صحيحاً.', 'Enter a valid email.', 'Saisissez un courriel valide.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await requestOtp({ email: email.trim(), purpose: 'password-reset' })
      if (admin) await requestOtp({ email: email.trim(), purpose: 'admin-reset-sms' })
      setStep('code')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (code.trim().length !== 6 || password.length < 8 || (admin && smsCode.trim().length !== 6)) {
      setError(pick(lang, 'أدخل الرمز المكوّن من 6 أرقام وكلمة مرور من 8 أحرف على الأقل.', 'Enter the 6-digit code and a password of at least 8 characters.', 'Saisissez le code à 6 chiffres et un mot de passe d’au moins 8 caractères.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const ok = await confirmOtp({ email: email.trim(), purpose: 'password-reset', code: code.trim() })
      if (!ok) {
        setError(pick(lang, 'الرمز غير صحيح.', 'The code is not correct.', 'Le code est incorrect.'))
        return
      }
      if (admin) {
        const smsOk = await confirmOtp({ email: email.trim(), purpose: 'admin-reset-sms', code: smsCode.trim() })
        if (!smsOk) {
          setError(pick(lang, 'رمز الرسالة النصية غير صحيح.', 'The text-message code is not correct.', 'Le code reçu par texto est incorrect.'))
          return
        }
      }
      await resetPassword(email, password)
      setStep('done')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={s.box} role="group" aria-label={pick(lang, 'إعادة تعيين كلمة المرور', 'Reset password', 'Réinitialiser le mot de passe')}>
      <strong>{pick(lang, 'إعادة تعيين كلمة المرور', 'Reset your password', 'Réinitialiser votre mot de passe')}</strong>
      {step === 'ask' && (
        <>
          <label style={s.label}>
            {pick(lang, 'البريد الإلكتروني', 'Email', 'Courriel')}
            <input style={s.input} dir="ltr" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="button" style={s.primary} disabled={busy} onClick={() => void sendCode()}>
            {busy ? '…' : pick(lang, 'أرسل الرمز', 'Email me a code', 'M’envoyer un code')}
          </button>
        </>
      )}
      {step === 'code' && (
        <>
          <small>{pick(lang, `أرسلنا رمزاً من 6 أرقام إلى ${email.trim()}.`, `We sent a 6-digit code to ${email.trim()}.`, `Nous avons envoyé un code à 6 chiffres à ${email.trim()}.`)}</small>
          <label style={s.label}>
            {pick(lang, 'الرمز', 'Code', 'Code')}
            <input style={s.input} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          {admin && (
            <label style={s.label}>
              {pick(lang, 'رمز الرسالة النصية', 'Code from the text message', 'Code reçu par texto')}
              <input style={s.input} dir="ltr" inputMode="numeric" autoComplete="off" maxLength={6} value={smsCode} onChange={(e) => setSmsCode(e.target.value)} />
            </label>
          )}
          <label style={s.label}>
            {pick(lang, 'كلمة المرور الجديدة', 'New password', 'Nouveau mot de passe')}
            <input style={s.input} dir="ltr" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="button" style={s.link} aria-pressed={show} onClick={() => setShow((v) => !v)}>
            {show ? pick(lang, 'إخفاء كلمة المرور', 'Hide password', 'Masquer le mot de passe') : pick(lang, 'إظهار كلمة المرور', 'Show password', 'Afficher le mot de passe')}
          </button>
          <button type="button" style={s.primary} disabled={busy} onClick={() => void save()}>
            {busy ? '…' : pick(lang, 'حفظ كلمة المرور', 'Save new password', 'Enregistrer le mot de passe')}
          </button>
        </>
      )}
      {step === 'done' && (
        <small role="status">{pick(lang, 'تم تغيير كلمة المرور. سجّل الدخول بها الآن.', 'Password changed. You can sign in with it now.', 'Mot de passe modifié. Vous pouvez vous connecter.')}</small>
      )}
      {error && <strong role="alert" style={{ color: '#ff8f9f' }}>{error}</strong>}
      <button type="button" style={s.link} onClick={onClose}>
        {step === 'done' ? pick(lang, 'العودة لتسجيل الدخول', 'Back to sign in', 'Retour à la connexion') : pick(lang, 'إلغاء', 'Cancel', 'Annuler')}
      </button>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  box: { display: 'grid', gap: 10, border: '1px solid rgba(128,128,128,0.4)', borderRadius: 12, padding: 14 },
  label: { display: 'grid', gap: 6, fontWeight: 700, fontSize: 14 },
  input: { minHeight: 44, borderRadius: 8, border: '1px solid #30384d', background: '#151a28', color: '#fff', padding: '0 12px', fontSize: 16 },
  primary: { minHeight: 46, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 900, fontSize: 15, cursor: 'pointer', padding: '0 16px' },
  link: { justifySelf: 'start', border: 0, background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: 13 },
}
