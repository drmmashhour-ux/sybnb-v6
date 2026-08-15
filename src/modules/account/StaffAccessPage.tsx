import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
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
    subtitle: 'هذه الصفحة مخصصة للفريق الداخلي فقط. سجّل الدخول أو أنشئ جلسة اختبار قبل متابعة لوحة التحكم.',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    admin: 'دخول الإدارة',
    host: 'دخول المضيف',
    driver: 'دخول السائق',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    phone: 'رقم الهاتف',
    code: 'رمز الدخول',
    sendCode: 'إرسال الرمز',
    codeSent: 'تم إرسال الرمز إلى رقم الهاتف. أدخل الرمز ثم تابع.',
    codeInvalid: 'رمز الدخول غير صحيح. اطلب الرمز وأدخله قبل المتابعة.',
    demoCode: 'رمز الدخول المرسل',
    opening: 'جار فتح الجلسة...',
    note: 'العميل لا يرى هذه اللوحات أثناء رحلة الحجز.',
    error: 'تعذر فتح الجلسة الداخلية.',
    required: 'أدخل البريد الإلكتروني ورقم الهاتف وكلمة المرور قبل طلب الدخول.',
  },
  en: {
    title: 'Internal Access Gate',
    subtitle: 'This page is for internal team access only. Sign in or create a test session before continuing to the dashboard.',
    signIn: 'Sign in',
    signUp: 'Sign up',
    admin: 'Open admin',
    host: 'Open host',
    driver: 'Open driver',
    email: 'Email address',
    password: 'Password',
    phone: 'Phone number',
    code: 'Access code',
    sendCode: 'Send code',
    codeSent: 'Code sent to the phone number. Enter the code, then continue.',
    codeInvalid: 'Incorrect access code. Send the code and enter it before continuing.',
    demoCode: 'Sent access code',
    opening: 'Opening session...',
    note: 'Guests do not see these dashboards during the booking trip.',
    error: 'Could not open internal session.',
    required: 'Enter email, phone, and password before requesting access.',
  },
}

export function StaffAccessPage({ lang, role, returnPath }: Props) {
  const t = labels[lang]
  const isAr = lang === 'ar'
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [status, setStatus] = useState<'idle' | 'codeSent' | 'loading' | 'error'>('idle')
  const [email, setEmail] = useState(defaultEmail(role))
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState(defaultPhone(role))
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')

  const actionLabel = role === 'ADMIN' ? t.admin : role === 'DRIVER' ? t.driver : t.host
  // HOST is a real customer-facing role → email verification (email-only Syria config), phone optional.
  // ADMIN/DRIVER remain on their existing internal phone flow (out of scope).
  const isHost = role === 'HOST'
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const requiredMsg = isHost ? (isAr ? 'أدخل البريد الإلكتروني وكلمة المرور قبل طلب الدخول.' : 'Enter email and password before requesting access.') : t.required

  async function openSession() {
    const identityMissing = isHost ? !emailValid || !password.trim() : !email.trim() || !phone.trim() || !password.trim()
    if (identityMissing) {
      setCodeError(requiredMsg)
      return
    }
    const verified = await confirmOtp(
      isHost ? { email: email.trim(), purpose: 'staff-login', code: code.trim() } : { phone: phone.trim(), purpose: 'staff-login', code: code.trim() },
    ).catch(() => false)
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
    } catch {
      setStatus('error')
    }
  }

  async function sendCode() {
    if (isHost && !emailValid) {
      setCodeError(requiredMsg)
      return
    }
    try {
      await requestOtp(isHost ? { email: email.trim(), purpose: 'staff-login' } : { phone: phone.trim(), purpose: 'staff-login' })
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
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        <div style={styles.segmented}>
          <button style={mode === 'signIn' ? styles.segmentActive : styles.segment} onClick={() => setMode('signIn')}>
            {t.signIn}
          </button>
          <button style={mode === 'signUp' ? styles.segmentActive : styles.segment} onClick={() => setMode('signUp')}>
            {t.signUp}
          </button>
        </div>
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
          <label style={styles.label}>
            {isHost ? (isAr ? 'رقم الهاتف (اختياري)' : 'Phone number (optional)') : t.phone}
            <input style={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} dir="ltr" />
          </label>
          <label style={styles.label}>
            {t.code}
            <div style={styles.codeRow}>
              <input style={styles.input} value={code} onChange={(event) => setCode(event.target.value)} dir="ltr" />
              <button style={styles.codeButton} onClick={sendCode} disabled={isHost && !emailValid}>
                {status === 'codeSent' ? (isAr ? 'إعادة إرسال الرمز' : 'Resend code') : isHost ? (isAr ? 'إرسال الرمز إلى البريد' : 'Email me the code') : t.sendCode}
              </button>
            </div>
          </label>
        </div>
        {status === 'codeSent' && (
          <p style={styles.note}>
            {isHost ? (isAr ? 'تم إرسال رمز الدخول إلى بريدك الإلكتروني.' : 'Access code sent to your email.') : t.codeSent}{' '}
            <b dir="ltr">{isHost ? email : phone}</b>
          </p>
        )}
        {codeError && <p style={styles.error}>{codeError}</p>}
        <button style={styles.primary} onClick={openSession} disabled={status === 'loading'}>
          {status === 'loading' ? t.opening : actionLabel}
        </button>
        {status === 'error' && <p style={styles.error}>{t.error}</p>}
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
    border: '1px solid #27324d',
    borderRadius: 12,
    background: '#0b1220',
    color: '#fff',
    padding: '0 14px',
    fontSize: 16,
  },
  codeRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
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
