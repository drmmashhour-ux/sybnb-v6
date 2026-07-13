import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createStaffAccountSession,
  resetPasswordWithEmailCode,
  sendEmailVerificationCode,
  verifyEmailVerificationCode,
} from '../../shared/api/platformApi'

type StaffRole = 'ADMIN' | 'HOST' | 'DRIVER'

type Props = {
  lang: Lang
  role: StaffRole
  returnPath: string
}

const labels = {
  ar: {
    title: 'بوابة الدخول الداخلية',
    subtitle: 'هذه الصفحة مخصصة للفريق الداخلي فقط. سجّل الدخول أو أنشئ جلسة اختبار قبل متابعة لوحة التحكم.',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    forgotPassword: 'نسيت كلمة المرور',
    resetPasswordCta: 'تحديث كلمة المرور',
    backToSignIn: 'العودة لتسجيل الدخول',
    admin: 'دخول الإدارة',
    host: 'دخول المضيف',
    driver: 'دخول السائق',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    newPassword: 'كلمة المرور الجديدة',
    phone: 'رقم الهاتف',
    code: 'رمز التحقق عبر البريد',
    sendCode: 'إرسال الرمز',
    resendCode: 'إعادة الإرسال',
    confirmCode: 'تأكيد الرمز',
    confirmingCode: 'جار التأكيد...',
    sendingCode: 'جار الإرسال...',
    codeSentReal: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.',
    codeSentDev: 'تم إنشاء رمز تحقق (بيئة تطوير — لا يوجد بريد فعلي).',
    codeConfirmed: 'تم تأكيد البريد الإلكتروني.',
    codeInvalid: 'رمز التحقق غير صحيح أو منتهي الصلاحية.',
    demoCode: 'رمز التحقق (تطوير فقط)',
    opening: 'جار فتح الجلسة...',
    resetting: 'جار تحديث كلمة المرور...',
    note: 'العميل لا يرى هذه اللوحات أثناء رحلة الحجز.',
    error: 'تعذر فتح الجلسة الداخلية.',
    required: 'أدخل البريد الإلكتروني ورقم الهاتف وكلمة المرور، ثم أكّد رمز البريد قبل طلب الدخول.',
    resetRequired: 'أدخل البريد الإلكتروني وكلمة المرور الجديدة، ثم أكّد رمز البريد.',
    resetSuccess: 'تم تحديث كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.',
  },
  en: {
    title: 'Internal Access Gate',
    subtitle: 'This page is for internal team access only. Sign in or create a test session before continuing to the dashboard.',
    signIn: 'Sign in',
    signUp: 'Sign up',
    forgotPassword: 'Forgot password',
    resetPasswordCta: 'Update password',
    backToSignIn: 'Back to sign in',
    admin: 'Open admin',
    host: 'Open host',
    driver: 'Open driver',
    email: 'Email address',
    password: 'Password',
    newPassword: 'New password',
    phone: 'Phone number',
    code: 'Email verification code',
    sendCode: 'Send code',
    resendCode: 'Resend code',
    confirmCode: 'Confirm code',
    confirmingCode: 'Confirming...',
    sendingCode: 'Sending...',
    codeSentReal: 'A verification code was sent to your email.',
    codeSentDev: 'A verification code was generated (dev environment — no real email sent).',
    codeConfirmed: 'Email confirmed.',
    codeInvalid: 'Incorrect or expired verification code.',
    demoCode: 'Verification code (dev only)',
    opening: 'Opening session...',
    resetting: 'Updating password...',
    note: 'Guests do not see these dashboards during the booking trip.',
    error: 'Could not open internal session.',
    required: 'Enter email, phone, and password, then confirm the email code before requesting access.',
    resetRequired: 'Enter your email and a new password, then confirm the email code.',
    resetSuccess: 'Password updated. Sign in with the new password.',
  },
}

export function StaffAccessPage({ lang, role, returnPath }: Props) {
  const t = labels[lang]
  const isAr = lang === 'ar'
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'forgotPassword'>('signIn')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [email, setEmail] = useState(defaultEmail(role))
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [phone, setPhone] = useState(defaultPhone(role))
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeConfirmed, setCodeConfirmed] = useState(false)
  const [codeBusy, setCodeBusy] = useState<'idle' | 'sending' | 'confirming'>('idle')
  const [devCode, setDevCode] = useState('')
  const [message, setMessage] = useState('')
  const [isErrorMessage, setIsErrorMessage] = useState(false)

  const actionLabel = role === 'ADMIN' ? t.admin : role === 'DRIVER' ? t.driver : t.host
  const otpPurpose = mode === 'forgotPassword' ? 'password-reset' : 'staff-login'

  function resetCodeState() {
    setCodeSent(false)
    setCodeConfirmed(false)
    setCode('')
    setDevCode('')
    setMessage('')
    setIsErrorMessage(false)
  }

  function switchMode(next: 'signIn' | 'signUp' | 'forgotPassword') {
    setMode(next)
    resetCodeState()
  }

  async function sendCode() {
    if (!email.trim()) return
    setCodeBusy('sending')
    setCode('')
    setCodeConfirmed(false)
    setDevCode('')
    try {
      const result = await sendEmailVerificationCode(email.trim(), otpPurpose)
      setCodeSent(true)
      setIsErrorMessage(false)
      if (result.devCode) {
        setDevCode(result.devCode)
        setMessage(t.codeSentDev)
      } else {
        setMessage(t.codeSentReal)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
      setIsErrorMessage(true)
    } finally {
      setCodeBusy('idle')
    }
  }

  async function confirmCode() {
    setCodeBusy('confirming')
    try {
      await verifyEmailVerificationCode(email.trim(), code.trim(), otpPurpose)
      setCodeConfirmed(true)
      setMessage(t.codeConfirmed)
      setIsErrorMessage(false)
    } catch {
      setCodeConfirmed(false)
      setMessage(t.codeInvalid)
      setIsErrorMessage(true)
    } finally {
      setCodeBusy('idle')
    }
  }

  async function openSession() {
    if (mode === 'forgotPassword') return
    if (!email.trim() || !phone.trim() || !password.trim() || !codeConfirmed) {
      setIsErrorMessage(true)
      setMessage(t.required)
      return
    }

    setStatus('loading')
    try {
      await createStaffAccountSession(role, {
        email: email.trim(),
        password,
        phone: phone.trim(),
        mode,
      })
      window.dispatchEvent(new Event('sybnb-session-changed'))
      window.location.hash = returnPath
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
      setIsErrorMessage(true)
    }
  }

  async function submitPasswordReset() {
    if (!email.trim() || !newPassword.trim() || !codeConfirmed) {
      setIsErrorMessage(true)
      setMessage(t.resetRequired)
      return
    }

    setStatus('loading')
    try {
      await resetPasswordWithEmailCode(email.trim(), newPassword)
      setStatus('idle')
      setNewPassword('')
      setIsErrorMessage(false)
      setMessage(t.resetSuccess)
      switchMode('signIn')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
      setIsErrorMessage(true)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <span style={styles.badge}>{role}</span>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        {mode !== 'forgotPassword' && (
          <div style={styles.segmented}>
            <button style={mode === 'signIn' ? styles.segmentActive : styles.segment} onClick={() => switchMode('signIn')}>
              {t.signIn}
            </button>
            <button style={mode === 'signUp' ? styles.segmentActive : styles.segment} onClick={() => switchMode('signUp')}>
              {t.signUp}
            </button>
          </div>
        )}
        <div style={styles.formGrid}>
          <label style={styles.label}>
            {t.email}
            <input
              style={styles.input}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                resetCodeState()
              }}
              dir="ltr"
            />
          </label>
          {mode === 'forgotPassword' ? (
            <label style={styles.label}>
              {t.newPassword}
              <input style={styles.input} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" dir="ltr" />
            </label>
          ) : (
            <>
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
              <label style={styles.label}>
                {t.phone}
                <input style={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} dir="ltr" />
              </label>
            </>
          )}
          <label style={styles.label}>
            {t.code}
            <div style={styles.codeRow}>
              <input style={styles.input} value={code} onChange={(event) => { setCode(event.target.value); setCodeConfirmed(false) }} dir="ltr" />
              <button style={styles.codeButton} onClick={() => void sendCode()} disabled={!email.includes('@') || codeBusy !== 'idle'}>
                {codeBusy === 'sending' ? t.sendingCode : codeSent ? t.resendCode : t.sendCode}
              </button>
              <button
                style={styles.codeButton}
                onClick={() => void confirmCode()}
                disabled={!codeSent || code.trim().length < 4 || codeBusy !== 'idle'}
              >
                {codeConfirmed ? '✓' : codeBusy === 'confirming' ? t.confirmingCode : t.confirmCode}
              </button>
            </div>
          </label>
        </div>
        {devCode && (
          <div style={styles.smsBox}>
            <small>
              {t.demoCode}: <b dir="ltr">{devCode}</b>
            </small>
          </div>
        )}
        {message && <p style={isErrorMessage ? styles.error : styles.note}>{message}</p>}
        {mode === 'forgotPassword' ? (
          <button style={styles.primary} onClick={() => void submitPasswordReset()} disabled={status === 'loading'}>
            {status === 'loading' ? t.resetting : t.resetPasswordCta}
          </button>
        ) : (
          <button style={styles.primary} onClick={() => void openSession()} disabled={status === 'loading'}>
            {status === 'loading' ? t.opening : actionLabel}
          </button>
        )}
        <button style={styles.linkButton} onClick={() => switchMode(mode === 'forgotPassword' ? 'signIn' : 'forgotPassword')}>
          {mode === 'forgotPassword' ? t.backToSignIn : t.forgotPassword}
        </button>
        <p style={styles.note}>{t.note}</p>
      </section>
    </main>
  )
}

function defaultEmail(role: StaffRole) {
  if (role === 'ADMIN') return 'admin@sybnb.local'
  if (role === 'DRIVER') return 'driver@sybnb.local'
  return 'host@sybnb.local'
}

function defaultPhone(role: StaffRole) {
  if (role === 'ADMIN') return '+963900000099'
  if (role === 'DRIVER') return '+963900000077'
  return '+963900000050'
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '70vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background: '#080a10',
    color: '#fff',
  },
  card: {
    width: 'min(620px, 100%)',
    border: '1px solid #27324d',
    borderRadius: 18,
    background: '#101522',
    padding: 32,
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
    fontSize: 34,
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
    background: '#4760ff',
    color: '#fff',
    fontWeight: 900,
    fontSize: 18,
    cursor: 'pointer',
    marginTop: 18,
  },
  linkButton: {
    background: 'transparent',
    border: 0,
    color: '#8fa2ff',
    fontWeight: 800,
    cursor: 'pointer',
    marginTop: 12,
    padding: 0,
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
    border: '1px solid #4760ff',
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
    border: '1px solid #27324d',
    borderRadius: 12,
    background: '#0b1220',
    color: '#fff',
    padding: '0 14px',
    fontSize: 16,
  },
  codeRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 8,
  },
  codeButton: {
    minHeight: 48,
    border: '1px solid #22d28f',
    borderRadius: 12,
    background: '#08251c',
    color: '#22d28f',
    fontWeight: 900,
    padding: '0 16px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  note: {
    marginTop: 18,
    color: '#22d28f',
    fontWeight: 700,
  },
  error: {
    marginTop: 18,
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
