import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { getKeepSignedIn, setKeepSignedIn } from '../../shared/api/authStorage'
import { confirmOtp, createGuestAccountSession, getStoredGuestSession, requestOtp, resetPassword, signInGuestAccount } from '../../shared/api/platformApi'

// Airbnb-style account flow, one question per screen:
//   1. email            -> "Log in or sign up"
//   2. password         -> returning users are signed in right here (email + password only)
//   3. finish sign-up   -> only when no account matched: name + the 6-digit code we just emailed
// The server still requires a verified email OTP for every registration (auth.mjs) -- that rule is
// unchanged; we simply only ask for it from people who are actually creating an account.
// ID upload is no longer asked at sign-up: it stays required once, before the first booking is
// confirmed (BookingDetailPage / TrustProtectionRoutes), exactly as before.

type Props = {
  lang: Lang
  listingId?: string
  flow?: 'stays' | 'rentals' | 'ride' | 'generic'
  returnPath?: string
}

type Step = 'email' | 'password' | 'finish' | 'reset'

const CUSTOMER_GATE_KEY = 'sybnb-v6-customer-account-ready'
const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'

const copy = {
  ar: {
    forgot: 'نسيت كلمة المرور؟',
    resetTitle: 'إعادة تعيين كلمة المرور',
    resetBody: (masked: string) => `أرسلنا رمزاً من 6 أرقام إلى ${masked}. أدخله ثم اختر كلمة مرور جديدة.`,
    newPassword: 'كلمة المرور الجديدة',
    resetSave: 'حفظ كلمة المرور والدخول',
    resetDone: 'تم تغيير كلمة المرور. تم تسجيل الخروج من الأجهزة الأخرى.',
    emailTitle: 'تسجيل الدخول أو إنشاء حساب',
    welcome: 'أهلاً بك في SYBNB',
    email: 'البريد الإلكتروني',
    continue: 'متابعة',
    passwordTitle: 'أدخل كلمة المرور',
    password: 'كلمة المرور',
    passwordHint: 'جديد في SYBNB؟ اختر كلمة مرور من 8 أحرف على الأقل.',
    show: 'إظهار',
    keepSignedIn: 'إبقائي مسجّلاً على هذا الجهاز',
    keepSignedInHint: 'لا تفعّلها على جهاز مشترك أو عام.',
    hide: 'إخفاء',
    finishTitle: 'إكمال التسجيل',
    finishBody: (masked: string) => `لا يوجد حساب بهذا البريد بعد. أرسلنا رمزاً من 6 أرقام إلى ${masked}.`,
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    code: 'رمز التحقق',
    resend: 'إعادة إرسال الرمز',
    resent: 'تم إرسال رمز جديد.',
    agree: 'موافقة ومتابعة',
    back: 'رجوع',
    edit: 'تعديل',
    invalidEmail: 'أدخل بريداً إلكترونياً صحيحاً.',
    shortPassword: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.',
    missingName: 'أدخل الاسم الأول واسم العائلة.',
    missingCode: 'أدخل الرمز المكوّن من 6 أرقام.',
    wrongPassword: 'هذا البريد لديه حساب، لكن كلمة المرور غير صحيحة. حاول مرة أخرى.',
    networkError: 'تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.',
    terms: 'بالضغط على «موافقة ومتابعة» أوافق على شروط استخدام SYBNB. الدفع لا يبدأ من هذه الخطوة.',
    ready: 'تم. حسابك جاهز.',
  },
  en: {
    forgot: 'Forgot password?',
    resetTitle: 'Reset your password',
    resetBody: (masked: string) => `We sent a 6-digit code to ${masked}. Enter it, then choose a new password.`,
    newPassword: 'New password',
    resetSave: 'Save password and log in',
    resetDone: 'Password changed. Other devices have been signed out.',
    emailTitle: 'Log in or sign up',
    welcome: 'Welcome to SYBNB',
    email: 'Email',
    continue: 'Continue',
    passwordTitle: 'Enter your password',
    password: 'Password',
    passwordHint: 'New to SYBNB? Choose a password with at least 8 characters.',
    show: 'Show',
    keepSignedIn: 'Keep me signed in on this device',
    keepSignedInHint: "Don't tick this on a shared or public computer.",
    hide: 'Hide',
    finishTitle: 'Finish signing up',
    finishBody: (masked: string) => `No account uses this email yet. We sent a 6-digit code to ${masked}.`,
    firstName: 'First name',
    lastName: 'Last name',
    code: 'Verification code',
    resend: 'Resend code',
    resent: 'A new code is on its way.',
    agree: 'Agree and continue',
    back: 'Back',
    edit: 'Edit',
    invalidEmail: 'Enter a valid email address.',
    shortPassword: 'Your password needs at least 8 characters.',
    missingName: 'Enter your first and last name.',
    missingCode: 'Enter the 6-digit code.',
    wrongPassword: 'This email already has an account, but the password is incorrect. Try again.',
    networkError: 'Could not reach the server. Check your connection and try again.',
    terms: 'By selecting Agree and continue, I agree to the SYBNB Terms of Service. Payment does not start from this step.',
    ready: 'Done. Your account is ready.',
  },
  fr: {
    forgot: 'Mot de passe oublié?',
    resetTitle: 'Réinitialiser votre mot de passe',
    resetBody: (masked: string) => `Nous avons envoyé un code à 6 chiffres à ${masked}. Saisissez-le, puis choisissez un nouveau mot de passe.`,
    newPassword: 'Nouveau mot de passe',
    resetSave: 'Enregistrer et se connecter',
    resetDone: 'Mot de passe modifié. Les autres appareils ont été déconnectés.',
    emailTitle: 'Connexion ou inscription',
    welcome: 'Bienvenue sur SYBNB',
    email: 'Courriel',
    continue: 'Continuer',
    passwordTitle: 'Saisissez votre mot de passe',
    password: 'Mot de passe',
    passwordHint: 'Nouveau sur SYBNB? Choisissez un mot de passe d’au moins 8 caractères.',
    show: 'Afficher',
    keepSignedIn: 'Rester connecté sur cet appareil',
    keepSignedInHint: 'Ne cochez pas cette case sur un ordinateur partagé ou public.',
    hide: 'Masquer',
    finishTitle: 'Terminer l’inscription',
    finishBody: (masked: string) => `Aucun compte n’utilise encore ce courriel. Nous avons envoyé un code à 6 chiffres à ${masked}.`,
    firstName: 'Prénom',
    lastName: 'Nom',
    code: 'Code de vérification',
    resend: 'Renvoyer le code',
    resent: 'Un nouveau code est en route.',
    agree: 'Accepter et continuer',
    back: 'Retour',
    edit: 'Modifier',
    invalidEmail: 'Saisissez une adresse courriel valide.',
    shortPassword: 'Votre mot de passe doit comporter au moins 8 caractères.',
    missingName: 'Saisissez votre prénom et votre nom.',
    missingCode: 'Saisissez le code à 6 chiffres.',
    wrongPassword: 'Ce courriel est déjà associé à un compte, mais le mot de passe est incorrect. Réessayez.',
    networkError: 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
    terms: 'En sélectionnant « Accepter et continuer », j’accepte les conditions d’utilisation de SYBNB. Le paiement ne commence pas à cette étape.',
    ready: 'C’est fait. Votre compte est prêt.',
  },
}

export function GuestAccountPage({ lang, listingId, returnPath: explicitReturnPath }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(() => getKeepSignedIn())
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'error' | 'success' | 'info'>('info')
  const focusRef = useRef<HTMLInputElement>(null)

  const returnPath = listingId ? `/listing/${listingId}` : sanitizeReturnPath(explicitReturnPath) || readStoredReturnPath()
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  useEffect(() => {
    focusRef.current?.focus()
  }, [step])

  // Already signed in (persisted session): never ask again -- go straight back to where they were.
  useEffect(() => {
    if (getStoredGuestSession()) finishAndReturn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function say(text: string, nextTone: 'error' | 'success' | 'info' = 'error') {
    setMessage(text)
    setTone(nextTone)
  }

  function errText(err: unknown) {
    return err instanceof Error && err.message ? err.message : t.networkError
  }

  function finishAndReturn() {
    sessionStorage.setItem(CUSTOMER_GATE_KEY, '1')
    if (listingId) sessionStorage.setItem(`${CUSTOMER_GATE_KEY}:${listingId}`, '1')
    if (!listingId) sessionStorage.removeItem(GUEST_RETURN_PATH_KEY)
    say(t.ready, 'success')
    // Dispatch the session event so App re-evaluates its route gate even when the hash is unchanged.
    window.dispatchEvent(new Event('sybnb-session-changed'))
    window.location.hash = returnPath
  }

  function submitEmail() {
    if (!emailValid) return say(t.invalidEmail)
    say('')
    setStep('password')
  }

  async function submitPassword() {
    if (password.length < 8) return say(t.shortPassword)
    setBusy(true)
    say('')
    setKeepSignedIn(remember)
    try {
      // Returning user: email + password is all the server needs.
      await signInGuestAccount(email, password)
      finishAndReturn()
      return
    } catch {
      // No match -> treat as a new account and email the verification code.
    }
    try {
      await requestOtp({ email: email.trim(), purpose: 'account-verify' })
      setCode('')
      setStep('finish')
    } catch (err) {
      say(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function resendCode() {
    setBusy(true)
    try {
      await requestOtp({ email: email.trim(), purpose: 'account-verify' })
      say(t.resent, 'info')
    } catch (err) {
      say(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function startReset() {
    if (!emailValid) return say(t.invalidEmail)
    setBusy(true)
    say('')
    try {
      await requestOtp({ email: email.trim(), purpose: 'password-reset' })
      setCode('')
      setPassword('')
      setStep('reset')
    } catch (err) {
      say(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitReset() {
    if (code.trim().length !== 6) return say(t.missingCode)
    if (password.length < 8) return say(t.shortPassword)
    setBusy(true)
    say('')
    setKeepSignedIn(remember)
    try {
      const ok = await confirmOtp({ email: email.trim(), purpose: 'password-reset', code: code.trim() })
      if (!ok) {
        say(t.missingCode)
        return
      }
      await resetPassword(email, password)
      await signInGuestAccount(email, password)
      say(t.resetDone, 'success')
      finishAndReturn()
    } catch (err) {
      say(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitFinish() {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) return say(t.missingName)
    if (code.trim().length !== 6) return say(t.missingCode)
    setBusy(true)
    say('')
    try {
      const ok = await confirmOtp({ email: email.trim(), purpose: 'account-verify', code: code.trim() })
      if (!ok) {
        say(t.missingCode)
        return
      }
      await createGuestAccountSession({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), password })
      finishAndReturn()
    } catch (err) {
      const text = errText(err)
      // The email already had an account and the password typed on step 2 was wrong.
      if (/invalid login credentials/i.test(text)) {
        setPassword('')
        setStep('password')
        say(t.wrongPassword)
      } else {
        say(text)
      }
    } finally {
      setBusy(false)
    }
  }

  const title = step === 'email' ? t.emailTitle : step === 'password' ? t.passwordTitle : step === 'reset' ? t.resetTitle : t.finishTitle

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <header style={styles.header}>
          {step === 'email' ? (
            <button style={styles.iconButton} onClick={() => (window.location.hash = returnPath)} aria-label={t.back}>
              ×
            </button>
          ) : (
            <button style={styles.iconButton} onClick={() => { say(''); setStep(step === 'finish' || step === 'reset' ? 'password' : 'email') }} aria-label={t.back}>
              {isAr ? '›' : '‹'}
            </button>
          )}
          <h1 style={styles.headerTitle}>{title}</h1>
          <span style={styles.iconSpacer} />
        </header>

        <form
          style={styles.body}
          onSubmit={(event) => {
            event.preventDefault()
            if (busy) return
            if (step === 'email') submitEmail()
            else if (step === 'password') void submitPassword()
            else if (step === 'reset') void submitReset()
            else void submitFinish()
          }}
        >
          {step === 'email' ? (
            <>
              <h2 style={styles.welcome}>{t.welcome}</h2>
              <input
                ref={focusRef}
                dir="ltr"
                type="email"
                autoComplete="email"
                style={styles.input}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t.email}
                aria-label={t.email}
              />
            </>
          ) : null}

          {step !== 'email' ? (
            <div style={styles.emailChip}>
              <span dir="ltr">{email.trim()}</span>
              <button type="button" style={styles.linkButton} onClick={() => { say(''); setStep('email') }}>
                {t.edit}
              </button>
            </div>
          ) : null}

          {step === 'password' ? (
            <>
              <div style={styles.passwordWrap}>
                <input
                  ref={focusRef}
                  dir="ltr"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  style={{ ...styles.input, ...styles.passwordInput }}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t.password}
                  aria-label={t.password}
                />
                <button type="button" style={styles.showButton} onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? t.hide : t.show}
                </button>
              </div>
              <button type="button" style={styles.linkButton} onClick={() => void startReset()} disabled={busy}>
                {t.forgot}
              </button>
              <p style={styles.hint}>{t.passwordHint}</p>
              <label style={styles.rememberRow}>
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>
                  {t.keepSignedIn}
                  <small style={styles.rememberHint}>{t.keepSignedInHint}</small>
                </span>
              </label>
            </>
          ) : null}

          {step === 'reset' ? (
            <>
              <p style={styles.hint}>{t.resetBody(maskEmail(email))}</p>
              <input
                ref={focusRef}
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                style={{ ...styles.input, ...styles.codeInput }}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                aria-label={t.code}
              />
              <button type="button" style={styles.linkButton} onClick={() => void startReset()} disabled={busy}>
                {t.resend}
              </button>
              <div style={styles.passwordWrap}>
                <input
                  dir="ltr"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  style={{ ...styles.input, ...styles.passwordInput }}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t.newPassword}
                  aria-label={t.newPassword}
                />
                <button type="button" style={styles.showButton} onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? t.hide : t.show}
                </button>
              </div>
            </>
          ) : null}

          {step === 'finish' ? (
            <>
              <p style={styles.hint}>{t.finishBody(maskEmail(email))}</p>
              <input
                ref={focusRef}
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                style={{ ...styles.input, ...styles.codeInput }}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                aria-label={t.code}
              />
              <button type="button" style={styles.linkButton} onClick={() => void resendCode()} disabled={busy}>
                {t.resend}
              </button>
              <div style={styles.nameRow}>
                <input style={styles.input} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder={t.firstName} aria-label={t.firstName} />
                <input style={styles.input} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder={t.lastName} aria-label={t.lastName} />
              </div>
              <p style={styles.terms}>{t.terms}</p>
            </>
          ) : null}

          {message ? (
            <strong role="status" aria-live="polite" style={tone === 'error' ? styles.error : tone === 'success' ? styles.success : styles.info}>
              {message}
            </strong>
          ) : null}

          <button type="submit" style={{ ...styles.primaryButton, opacity: busy ? 0.7 : 1 }} disabled={busy}>
            {busy ? '…' : step === 'finish' ? t.agree : step === 'reset' ? t.resetSave : t.continue}
          </button>
        </form>
      </section>
    </main>
  )
}

function maskEmail(value: string) {
  const [user, domain] = value.trim().split('@')
  if (!domain) return value.trim() || 'you@email'
  const maskedUser = user.length <= 2 ? `${user[0] || ''}•` : `${user.slice(0, 2)}••${user.slice(-1)}`
  return `${maskedUser}@${domain}`
}

function readStoredReturnPath() {
  if (typeof window === 'undefined') return '/stays'
  const stored = sessionStorage.getItem(GUEST_RETURN_PATH_KEY)
  const sanitized = sanitizeReturnPath(stored)
  if (sanitized) return sanitized
  return '/stays'
}

function sanitizeReturnPath(value?: string | null) {
  if (!value?.startsWith('/')) return ''
  if (value.startsWith('/account/open')) return ''
  return value
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: 'calc(100vh - 160px)', background: '#08090e', color: '#fff', padding: '24px 16px 90px', display: 'grid', alignContent: 'start', justifyItems: 'center' },
  card: { width: '100%', maxWidth: 520, border: '1px solid #232638', borderRadius: 16, background: '#0e0f16', overflow: 'hidden' },
  header: { display: 'grid', gridTemplateColumns: '44px 1fr 44px', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #232638' },
  headerTitle: { margin: 0, fontSize: 16, fontWeight: 900, textAlign: 'center' },
  iconButton: { width: 36, height: 36, borderRadius: 999, border: 0, background: 'transparent', color: '#fff', fontSize: 24, fontWeight: 700, cursor: 'pointer' },
  iconSpacer: { width: 36 },
  body: { display: 'grid', gap: 14, padding: 24 },
  welcome: { margin: '0 0 4px', fontSize: 22, fontWeight: 900 },
  input: { minHeight: 56, border: '1px solid #2c3046', borderRadius: 10, background: '#111118', color: '#fff', padding: '0 14px', fontWeight: 700, fontSize: 16, boxSizing: 'border-box' },
  codeInput: { textAlign: 'center', letterSpacing: 10, fontSize: 24 },
  nameRow: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  passwordWrap: { position: 'relative', display: 'grid' },
  passwordInput: { width: '100%', paddingRight: 84 },
  // The password box is always left-to-right, so the Show/Hide toggle sits on its physical right in
  // both Arabic and English and never covers the typed characters.
  showButton: { position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer' },
  emailChip: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: '1px solid #232638', borderRadius: 10, padding: '10px 14px', color: '#cfd6ea', fontWeight: 700 },
  linkButton: { justifySelf: 'start', border: 0, background: 'transparent', color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', padding: 0 },
  hint: { margin: 0, color: '#9aa6ba', lineHeight: 1.6, fontSize: 14 },
  rememberRow: { display: 'flex', gap: 10, alignItems: 'flex-start', color: '#cfd6ea', fontWeight: 700, cursor: 'pointer' },
  rememberHint: { display: 'block', color: '#7f879a', fontWeight: 500, fontSize: 12, marginTop: 2 },
  terms: { margin: 0, color: '#7f879a', lineHeight: 1.6, fontSize: 12 },
  primaryButton: { minHeight: 54, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer' },
  success: { color: '#20d29b' },
  error: { color: '#ff8f9f' },
  info: { color: '#9fb0ff' },
}
