import { useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { confirmOtp, createStaffAccountSession, requestOtp } from '../../shared/api/platformApi'

type StaffRole = 'ADMIN' | 'HOST' | 'DRIVER'

type Props = {
  lang: Lang
  role: StaffRole
  returnPath: string
}

const labels = {
  ar: {
    title: 'بوابة الدخول الداخلية',
    // Was "سجّل الدخول أو أنشئ جلسة اختبار" -- a real bug audit found self-registration is not
    // actually supported for ADMIN/DRIVER (the backend rejects it), so "create a session" here was
    // a promise the page couldn't keep. Sign-in only, for these two roles.
    subtitle: 'هذه الصفحة مخصصة للفريق الداخلي فقط. سجّل الدخول بحسابك الحالي للمتابعة إلى لوحة التحكم.',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    admin: 'دخول الإدارة',
    host: 'دخول المضيف',
    hostSignUp: 'إنشاء حساب مضيف',
    driver: 'دخول السائق',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    phone: 'رقم الهاتف',
    code: 'رمز الدخول',
    sendCode: 'إرسال الرمز إلى البريد',
    codeSent: 'تم إرسال الرمز إلى بريدك الإلكتروني. أدخل الرمز ثم تابع.',
    codeInvalid: 'رمز الدخول غير صحيح. اطلب الرمز وأدخله قبل المتابعة.',
    demoCode: 'رمز الدخول المرسل',
    opening: 'جار فتح الجلسة...',
    note: 'العميل لا يرى هذه اللوحات أثناء رحلة الحجز.',
    error: 'تعذر فتح الجلسة الداخلية.',
    required: 'أدخل البريد الإلكتروني وكلمة المرور قبل طلب الدخول.',
  },
  en: {
    title: 'Internal Access Gate',
    subtitle: 'This page is for internal team access only. Sign in with your existing account to continue to the dashboard.',
    signIn: 'Sign in',
    signUp: 'Sign up',
    admin: 'Open admin',
    host: 'Open host',
    hostSignUp: 'Create host account',
    driver: 'Open driver',
    email: 'Email address',
    password: 'Password',
    phone: 'Phone number',
    code: 'Access code',
    sendCode: 'Email me the code',
    codeSent: 'Code sent to your email. Enter the code, then continue.',
    codeInvalid: 'Incorrect access code. Send the code and enter it before continuing.',
    demoCode: 'Sent access code',
    opening: 'Opening session...',
    note: 'Guests do not see these dashboards during the booking trip.',
    error: 'Could not open internal session.',
    required: 'Enter email and password before requesting access.',
  },
  fr: {
    title: 'Portail d’accès interne',
    subtitle: 'Cette page est réservée à l’équipe interne. Connectez-vous avec votre compte existant pour accéder au tableau de bord.',
    signIn: 'Se connecter',
    signUp: 'S’inscrire',
    admin: 'Accès administration',
    host: 'Accès hôte',
    hostSignUp: 'Créer un compte hôte',
    driver: 'Accès chauffeur',
    email: 'Adresse courriel',
    password: 'Mot de passe',
    phone: 'Numéro de téléphone',
    code: 'Code d’accès',
    sendCode: 'M’envoyer le code par courriel',
    codeSent: 'Code envoyé à votre adresse courriel. Saisissez le code, puis continuez.',
    codeInvalid: 'Code d’accès incorrect. Envoyez le code et saisissez-le avant de continuer.',
    demoCode: 'Code d’accès envoyé',
    opening: 'Ouverture de la session...',
    note: 'Les clients ne voient pas ces tableaux de bord pendant le parcours de réservation.',
    error: 'Impossible d’ouvrir la session interne.',
    required: 'Saisissez l’adresse courriel et le mot de passe avant de demander l’accès.',
  },
}

export function StaffAccessPage({ lang, role, returnPath }: Props) {
  const t = labels[lang]
  const isAr = lang === 'ar'
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [status, setStatus] = useState<'idle' | 'codeSent' | 'loading' | 'error'>('idle')
  // HOST is a real customer-facing role (see below) — pre-filling a shared default identity risks a
  // first-time host missing it and having their OTP sent to a mailbox they don't control. Start blank.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')

  // A real bug audit found "Create account" was a nonfunctional promise for ADMIN/DRIVER: the
  // backend's PUBLIC_REGISTER_ROLES (server/routes/auth.mjs) only allows self-registration for
  // GUEST/HOST/SELLER, so createStaffAccountSession's register() call for ADMIN/DRIVER always
  // 403s (ROLE_REGISTRATION_FORBIDDEN) and silently falls back to login() -- both tabs ended up
  // doing the exact same thing, with no visible difference at all. HOST genuinely can self-register
  // here, so only HOST gets the toggle; ADMIN/DRIVER are sign-in only, matching real capability.
  const canSelfRegister = role === 'HOST'
  const baseActionLabel = role === 'ADMIN' ? t.admin : role === 'DRIVER' ? t.driver : t.host
  const actionLabel = canSelfRegister && mode === 'signUp' ? t.hostSignUp : baseActionLabel
  // Every role signs in over email OTP -- an independent admin-experience audit found ADMIN/DRIVER
  // were still hardcoded to the phone/SMS channel here, and Syria's country profile has SMS
  // disabled entirely (communications.sms: false). requestOtp/confirmOtp over phone therefore
  // always 403s (OTP_CHANNEL_NOT_ENABLED), and openSession() requires the OTP to succeed before it
  // ever calls the real login -- so there was literally no way for an admin or driver to sign in
  // through this screen. createStaffAccountSession() already treats email as the account identity
  // and phone as optional contact for every role (see its own comment), so switching the OTP
  // channel to match is a pure bug fix, not a new design.
  const isHost = role === 'HOST'
  // A stay host is a customer, not internal staff — show host-oriented wording (no "internal team
  // only" framing). ADMIN/DRIVER keep the internal-gate copy.
  const gateTitle = isHost ? pick(lang, 'دخول المضيفين', 'Host sign in', 'Connexion hôte') : t.title
  const gateSubtitle = isHost
    ? pick(
        lang,
        'سجّل الدخول أو أنشئ حساب مضيف لإدراج مكانك وإدارة إقاماتك وطلبات الضيوف.',
        'Sign in or create a host account to list your place and manage your stays and guest requests.',
        'Connectez-vous ou créez un compte hôte pour publier votre logement et gérer vos séjours et les demandes des voyageurs.',
      )
    : t.subtitle
  const gateNote = isHost
    ? pick(
        lang,
        'من هنا تدير إقاماتك، طلبات الضيوف، والدفع المحمي.',
        'Manage your stays, guest requests, and protected payments here.',
        'Gérez ici vos séjours, les demandes des voyageurs et les paiements protégés.',
      )
    : t.note
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const requiredMsg = t.required
  // Owner decision 2026-10-08: EVERY admin sign-in needs the password AND a fresh code emailed for
  // that sign-in. The server enforces it (POST /api/auth/login refuses an ADMIN account without a
  // recently verified 'admin-login' code, consumed single-use); this screen just asks for it.
  const isAdmin = role === 'ADMIN'
  const otpPurpose = isAdmin ? 'admin-login' : 'staff-login'

  async function openSession() {
    const identityMissing = !emailValid || !password.trim()
    if (identityMissing) {
      setCodeError(requiredMsg)
      return
    }
    const verified = await confirmOtp({ email: email.trim(), purpose: otpPurpose, code: code.trim() }).catch(() => false)
    if (!verified) {
      setCodeError(t.codeInvalid)
      return
    }

    setStatus('loading')
    try {
      await createStaffAccountSession(role, {
        email,
        password,
        phone,
        mode,
      })
      window.dispatchEvent(new Event('sybnb-session-changed'))
      window.location.hash = returnPath
    } catch (err) {
      // The code was consumed by this attempt (or was never valid for an admin login): a new one is
      // needed for the next try.
      const codeRequired = (err as { code?: string } | null)?.code === 'ADMIN_LOGIN_CODE_REQUIRED'
      if (codeRequired) {
        setCode('')
        setCodeError(pick(lang, 'رمز الدخول غير صالح لهذا الدخول. اطلب رمزاً جديداً.', 'That code is not valid for this sign-in. Request a new code.', 'Ce code n’est pas valable pour cette connexion. Demandez un nouveau code.'))
        setStatus('idle')
      } else {
        setStatus('error')
      }
    }
  }

  async function sendCode() {
    if (!emailValid) {
      setCodeError(requiredMsg)
      return
    }
    try {
      await requestOtp({ email: email.trim(), purpose: otpPurpose })
      setCodeError('')
      setStatus('codeSent')
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : t.codeInvalid)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <span style={styles.badge}>{role}</span>
        <h1 style={styles.title}>{gateTitle}</h1>
        <p style={styles.body}>{gateSubtitle}</p>
        {isAdmin && (
          <p style={styles.adminNotice}>
            {pick(
              lang,
              'لحماية لوحة الإدارة: كل دخول يحتاج كلمة المرور ورمزاً جديداً من 6 أرقام يُرسل إلى بريدك. تنتهي جلسة الإدارة بعد 12 ساعة.',
              'To protect the admin panel, every sign-in needs your password and a new 6-digit code sent to your email. Admin sessions end after 12 hours.',
              'Pour protéger l’administration, chaque connexion exige votre mot de passe et un nouveau code à 6 chiffres envoyé par courriel. La session admin expire après 12 heures.',
            )}
          </p>
        )}
        {canSelfRegister && (
          <div style={styles.segmented}>
            <button style={mode === 'signIn' ? styles.segmentActive : styles.segment} onClick={() => setMode('signIn')}>
              {t.signIn}
            </button>
            <button style={mode === 'signUp' ? styles.segmentActive : styles.segment} onClick={() => setMode('signUp')}>
              {t.signUp}
            </button>
          </div>
        )}
        <div style={styles.formGrid}>
          <label style={styles.label}>
            {t.email}
            <input style={styles.input} value={email} onChange={(event) => setEmail(event.target.value)} dir="ltr" />
          </label>
          <label style={styles.label}>
            {t.password}
            <input
              style={styles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              dir="ltr"
            />
          </label>
          {!isAdmin && (
            <label style={styles.label}>
              {pick(lang, 'رقم الهاتف (اختياري)', 'Phone number (optional)', 'Numéro de téléphone (facultatif)')}
              <input style={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} dir="ltr" />
            </label>
          )}
          <label style={styles.label}>
            {t.code}
            <div style={styles.codeRow}>
              <input style={styles.input} value={code} onChange={(event) => setCode(event.target.value)} dir="ltr" />
              <button style={styles.codeButton} onClick={sendCode} disabled={!emailValid}>
                {status === 'codeSent' ? pick(lang, 'إعادة إرسال الرمز', 'Resend code', 'Renvoyer le code') : t.sendCode}
              </button>
            </div>
          </label>
        </div>
        {status === 'codeSent' && (
          <p style={styles.note}>
            {t.codeSent} <b dir="ltr">{email}</b>
          </p>
        )}
        {codeError && <p style={styles.error}>{codeError}</p>}
        <button style={styles.primary} onClick={openSession} disabled={status === 'loading'}>
          {status === 'loading' ? t.opening : actionLabel}
        </button>
        {status === 'error' && <p style={styles.error}>{t.error}</p>}
        <p style={styles.note}>{gateNote}</p>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '70vh',
    display: 'grid',
    placeItems: 'center',
    padding: '24px 16px',
    background: '#080a10',
    color: '#fff',
  },
  card: {
    width: 'min(620px, 100%)',
    boxSizing: 'border-box',
    minWidth: 0,
    border: '1px solid #27324d',
    borderRadius: 18,
    background: '#101522',
    padding: 'clamp(18px, 5vw, 32px)',
    boxShadow: '0 24px 80px rgba(0,0,0,.35)',
  },
  badge: {
    display: 'inline-flex',
    border: '1px solid #e1b60f',
    borderRadius: 999,
    color: '#e1b60f',
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 800,
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 'clamp(26px, 6vw, 34px)',
  },
  body: {
    color: '#aab4ca',
    lineHeight: 1.8,
    margin: '14px 0 24px',
  },
  primary: {
    width: '100%',
    minHeight: 56,
    border: 0,
    borderRadius: 12,
    background: '#5268ff',
    color: '#fff',
    fontWeight: 900,
    fontSize: 18,
    cursor: 'pointer',
    marginTop: 18,
  },
  segmented: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 18,
  },
  segment: {
    minHeight: 48,
    border: '1px solid #27324d',
    borderRadius: 12,
    background: '#0c111d',
    color: '#aab4ca',
    fontWeight: 900,
    cursor: 'pointer',
  },
  segmentActive: {
    minHeight: 48,
    border: '1px solid #5268ff',
    borderRadius: 12,
    background: '#18224a',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  formGrid: {
    display: 'grid',
    gap: 12,
  },
  label: {
    display: 'grid',
    gap: 8,
    color: '#d9e1f5',
    fontWeight: 800,
  },
  input: {
    minHeight: 48,
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #27324d',
    borderRadius: 12,
    background: '#0b1220',
    color: '#fff',
    padding: '0 14px',
    fontSize: 16,
  },
  codeRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
  },
  codeButton: {
    minHeight: 48,
    border: '1px solid #22d28f',
    borderRadius: 12,
    background: '#08251c',
    color: '#22d28f',
    fontWeight: 900,
    padding: '0 12px',
    maxWidth: 180,
    lineHeight: 1.3,
    cursor: 'pointer',
  },
  adminNotice: {
    margin: '0 0 20px',
    border: '1px solid rgba(225,182,15,.45)',
    borderRadius: 12,
    background: 'rgba(225,182,15,.08)',
    color: '#f3dc8a',
    padding: '12px 14px',
    lineHeight: 1.7,
    fontWeight: 700,
  },
  note: {
    marginTop: 18,
    color: '#22d28f',
    fontWeight: 700,
  },
  error: {
    color: '#ff4d73',
    fontWeight: 800,
  },
  smsBox: {
    border: '1px solid rgba(34, 210, 143, .45)',
    borderRadius: 12,
    background: '#071e18',
    color: '#d9fff1',
    padding: 14,
    marginTop: 14,
    lineHeight: 1.7,
  },
}
