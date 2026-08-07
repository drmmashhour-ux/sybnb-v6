import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  requestEmailOtp,
  resendEmailOtp,
  verifyEmailOtp,
  type EmailOtpPurpose,
} from '../api/platformApi'

type EmailOtpCapsuleProps = {
  email: string
  lang: 'ar' | 'en'
  onVerified: (result: { token?: string; user?: unknown }) => void
  purpose?: EmailOtpPurpose
  disabled?: boolean
}

// The single reusable email-OTP capsule: send -> enter code -> verify, with a
// resend cooldown. Backed entirely by the server-side OTP engine — the code is
// generated, emailed, and verified on the backend (never in the browser). Drop this
// in anywhere verification is needed instead of re-implementing the flow per page.
export function EmailOtpCapsule({
  email,
  lang,
  onVerified,
  purpose = 'EMAIL_VERIFICATION',
  disabled,
}: EmailOtpCapsuleProps) {
  const isAr = lang === 'ar'
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const timer = useRef<number | null>(null)

  const t = isAr
    ? {
        send: 'إرسال الرمز',
        resend: 'إعادة إرسال الرمز',
        verify: 'تأكيد الرمز',
        verified: 'تم التحقق ✓',
        codePlaceholder: 'أدخل الرمز',
        sent: 'أرسلنا رمز التحقق إلى بريدك الإلكتروني.',
        invalid: 'رمز غير صحيح أو منتهي.',
        emailNeeded: 'أدخل بريدًا إلكترونيًا صالحًا أولًا.',
        resendIn: 'إعادة الإرسال بعد',
      }
    : {
        send: 'Send code',
        resend: 'Resend code',
        verify: 'Confirm code',
        verified: 'Verified ✓',
        codePlaceholder: 'Enter code',
        sent: 'We emailed a verification code to your email.',
        invalid: 'Invalid or expired code.',
        emailNeeded: 'Enter a valid email first.',
        resendIn: 'Resend in',
      }

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current)
  }, [])

  function startCooldown(seconds: number) {
    setCooldown(seconds)
    if (timer.current) window.clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          if (timer.current) window.clearInterval(timer.current)
          return 0
        }
        return value - 1
      })
    }, 1000)
  }

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  async function send(isResend: boolean) {
    if (!emailValid) {
      setMessage(t.emailNeeded)
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await (isResend ? resendEmailOtp : requestEmailOtp)(email.trim(), purpose)
      setSent(true)
      setVerified(false)
      setMessage(t.sent)
      startCooldown(30)
    } catch (error) {
      setMessage((error as Error).message || t.invalid)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    setMessage('')
    try {
      const result = await verifyEmailOtp(email.trim(), code.trim(), purpose)
      setVerified(true)
      onVerified({ token: result.token, user: result.user })
    } catch (error) {
      setMessage((error as Error).message || t.invalid)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={styles.row}>
        <button
          type="button"
          style={styles.button}
          disabled={disabled || busy || !emailValid || cooldown > 0}
          onClick={() => void send(sent)}
        >
          {cooldown > 0 ? `${t.resendIn} ${cooldown}s` : sent ? t.resend : t.send}
        </button>
        <input
          dir="ltr"
          inputMode="numeric"
          style={styles.input}
          value={code}
          placeholder={t.codePlaceholder}
          disabled={!sent || disabled}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
            setVerified(false)
          }}
        />
        <button
          type="button"
          style={styles.button}
          disabled={disabled || busy || !sent || code.trim().length < 6 || verified}
          onClick={() => void verify()}
        >
          {verified ? t.verified : t.verify}
        </button>
      </div>
      {message ? <p style={styles.notice}>{message}</p> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  button: {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.06)',
    color: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
  },
  input: {
    flex: 1,
    minWidth: 120,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.04)',
    color: 'inherit',
    letterSpacing: 4,
    textAlign: 'center',
  },
  notice: { fontSize: 13, opacity: 0.85, margin: 0 },
}
