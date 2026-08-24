import React, { useEffect, useMemo, useRef, useState } from 'react'

type Lang = 'ar' | 'en'

type GiftCodeVerifyProps = {
  lang?: Lang
  phoneMasked?: string
  onVerified?: (code: string) => void | boolean | Promise<void | boolean>
  onBack?: () => void
}

const T = {
  ar: {
    title: 'أدخل رمز الاستلام',
    subtitle: 'اطلب رمز الاستلام المكون من 6 أرقام من الشخص الذي أرسل لك الهدية.',
    codeLabel: 'رمز الاستلام',
    attempts: 'المحاولات المتبقية',
    wrong: 'الرمز غير صحيح. حاول مرة أخرى.',
    locked: 'تم إيقاف المحاولة مؤقتاً لحماية الهدية.',
    security: 'لن تطلب SYBNB هذا الرمز منك أبداً.',
    back: 'رجوع',
    verify: 'تأكيد الرمز',
  },
  en: {
    title: 'Enter claim code',
    subtitle: 'Ask the person who sent you this gift for the 6-digit claim code.',
    codeLabel: 'Claim code',
    attempts: 'Attempts left',
    wrong: 'The code is not correct. Try again.',
    locked: 'Attempts are paused temporarily to protect this gift.',
    security: 'SYBNB will never ask you for this code.',
    back: 'Back',
    verify: 'Verify code',
  },
}

const boxStyle: React.CSSProperties = {
  width: 46,
  height: 56,
  borderRadius: 14,
  border: '1px solid #2c3448',
  background: '#0d1320',
  color: '#fff',
  textAlign: 'center',
  fontSize: 24,
  fontWeight: 900,
}

export function GiftCodeVerify({ lang = 'ar', phoneMasked = '+963 9•• ••• ••42', onVerified, onBack }: GiftCodeVerifyProps) {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [attempts, setAttempts] = useState(3)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const isAr = lang === 'ar'
  const t = T[lang]

  const code = useMemo(() => digits.join(''), [digits])
  const complete = code.length === 6

  function setDigit(index: number, value: string) {
    const nextChar = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = nextChar
    setDigits(next)
    setError('')
    if (nextChar && index < 5) inputs.current[index + 1]?.focus()
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputs.current[index - 1]?.focus()
    if (event.key === 'ArrowLeft') inputs.current[Math.max(0, index - 1)]?.focus()
    if (event.key === 'ArrowRight') inputs.current[Math.min(5, index + 1)]?.focus()
  }

  function onPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('')
    const next = Array.from({ length: 6 }, (_, index) => pasted[index] ?? '')
    setDigits(next)
    inputs.current[Math.min(pasted.length, 5)]?.focus()
  }

  async function verify() {
    if (!complete || attempts <= 0 || verifying) return
    setVerifying(true)
    setError('')

    try {
      const accepted = await onVerified?.(code)
      if (accepted === false) {
        throw new Error('verification_failed')
      }
    } catch {
      setDigits(['', '', '', '', '', ''])
      setAttempts((value) => Math.max(0, value - 1))
      setError(attempts - 1 <= 0 ? t.locked : t.wrong)
      inputs.current[0]?.focus()
    } finally {
      setVerifying(false)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f7f7fb', padding: 20, fontFamily: '"Cairo","Tajawal",Inter,sans-serif' }}>
      <section style={{ maxWidth: 480, margin: '0 auto' }}>
        <button type="button" onClick={onBack} style={{ minHeight: 44, border: '1px solid #2c3448', borderRadius: 12, background: '#111827', color: '#fff', padding: '0 14px', marginBottom: 22 }}>
          {t.back}
        </button>
        <h1 style={{ margin: 0, fontSize: 30 }}>{t.title}</h1>
        <p style={{ color: '#9aa6ba', lineHeight: 1.7 }}>{t.subtitle}</p>
        <div dir="ltr" style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center', padding: '0 12px', borderRadius: 999, background: 'rgba(79,108,255,.12)', color: '#bfcaee', marginBottom: 20 }}>
          {phoneMasked}
        </div>

        <div style={{ borderRadius: 22, border: '1px solid #1e1e2a', background: '#111118', padding: 20 }}>
          <div style={{ color: '#9aa6ba', fontWeight: 800, marginBottom: 12 }}>{t.codeLabel}</div>
          <div dir="ltr" style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(node) => { inputs.current[index] = node }}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => onKeyDown(index, event)}
                onPaste={onPaste}
                inputMode="numeric"
                maxLength={1}
                aria-label={`${t.codeLabel} ${index + 1}`}
                style={boxStyle}
              />
            ))}
          </div>

          {error && <div style={{ marginTop: 14, color: '#ff5f76', fontWeight: 800 }}>{error}</div>}

          <div style={{ borderRadius: 14, background: '#171b29', padding: 12, marginTop: 18 }}>
            <div style={{ color: '#9aa6ba', fontSize: 12 }}>{t.attempts}</div>
            <strong>{attempts}</strong>
          </div>

          <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid rgba(213,169,21,.35)', background: 'rgba(213,169,21,.10)', color: '#d5a915', padding: 12, lineHeight: 1.6 }}>
            {t.security}
          </div>

          <button
            type="button"
            disabled={!complete || attempts <= 0 || verifying}
            onClick={() => void verify()}
            style={{ width: '100%', minHeight: 56, marginTop: 16, border: 0, borderRadius: 16, background: 'linear-gradient(135deg,#4f6cff,#19d7ff)', color: '#fff', fontWeight: 900, fontSize: 16, opacity: complete && attempts > 0 && !verifying ? 1 : .45 }}
          >
            {t.verify}
          </button>
        </div>
      </section>
    </main>
  )
}

export default GiftCodeVerify
