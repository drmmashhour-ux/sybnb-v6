import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { confirmOtp, createGuestAccountSession, requestOtp, submitGuestIdDocument } from '../../shared/api/platformApi'
import { emailIdSubmissionLink, SUPPORT_EMAIL, SUPPORT_WHATSAPP_LOCAL, whatsappIdSubmissionLink } from '../../shared/support/contactChannels'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'

type Props = {
  lang: Lang
  listingId?: string
  flow?: 'stays' | 'rentals' | 'ride' | 'generic'
  returnPath?: string
}

const CUSTOMER_GATE_KEY = 'sybnb-v6-customer-account-ready'
const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'

const copy = {
  ar: {
    back: 'رجوع',
    next: 'التالي',
    title: 'حساب الإيجار اليومي',
    rentalsTitle: 'حساب الإيجار الشهري',
    rideTitle: 'حساب SR Ride',
    genericTitle: 'إنشاء حساب SYBNB',
    gateTitle: 'يرجى تسجيل الدخول للمتابعة',
    gateChip: 'طلب إيجار',
    rideGateChip: 'طلب رحلة',
    subtitle: 'أنشئ الحساب أو سجّل الدخول قبل إرسال طلب الحجز. الدفع لا يبدأ من هذه الخطوة.',
    rentalsSubtitle: 'أنشئ الحساب أو سجّل الدخول قبل متابعة طلب الإيجار الشهري. الدفع لا يبدأ قبل فتح الطلب الصحيح.',
    rideSubtitle: 'أنشئ الحساب أو سجّل الدخول قبل إرسال طلب الرحلة. يلزم حساب مؤكد قبل إرسال الطلب.',
    genericSubtitle: 'أنشئ حسابك بالبريد الإلكتروني للاستفادة من كل خدمات SYBNB. الدفع لا يبدأ من هذه الخطوة.',
    signup: 'تسجيل حساب جديد',
    signin: 'تسجيل الدخول',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    email: 'البريد الإلكتروني',
    phone: 'رقم الهاتف (اختياري)',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    sendCode: 'إرسال الرمز إلى البريد',
    sending: 'جارٍ الإرسال…',
    resendCode: 'إعادة إرسال الرمز',
    code: 'رمز التحقق',
    confirmCode: 'تأكيد الرمز',
    openAccount: 'فتح الحساب والمتابعة',
    signInAccount: 'تسجيل الدخول والمتابعة',
    error: 'أكمل البيانات المطلوبة، تأكد من كلمة المرور، ثم اطلب رمز البريد الإلكتروني وأكّده قبل فتح الحساب.',
    invalidEmail: 'أدخل بريداً إلكترونياً صحيحاً لإرسال الرمز.',
    networkError: 'تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.',
    codeSentPrefix: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني',
    idDocumentTitle: 'إثبات الهوية (اختياري الآن)',
    idDocumentHelp: 'ارفع صورة واضحة عن هويتك الشخصية أو جواز السفر الآن، أو لاحقاً قبل الدفع. مطلوب مرة واحدة فقط قبل تأكيد أول حجز.',
    idDocumentCta: 'اضغط لرفع صورة الهوية',
    idDocumentEmpty: 'لم يتم رفع الهوية بعد. يمكنك رفعها لاحقاً قبل الدفع.',
    idDocumentRequired: 'ارفع صورة عن هويتك قبل الدفع.',
    codeSent: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.',
    ready: 'تم تجهيز حساب العميل. يمكنك الآن إرسال طلب الحجز.',
    rentalsReady: 'تم تجهيز حساب العميل. يمكنك الآن متابعة طلب الإيجار.',
    rideReady: 'تم تجهيز حساب العميل. يمكنك الآن متابعة طلب الرحلة.',
    genericReady: 'تم إنشاء حسابك بنجاح.',
    policy: 'بعد فتح الحساب يعود العميل إلى تفاصيل الإعلان لإرسال الطلب. الدفع يأتي بعد إنشاء الطلب فقط.',
    rentalsPolicy: 'بعد فتح الحساب يعود العميل إلى صفحة الإيجار الشهري لمراجعة الاختيارات ومتابعة الطلب. الدفع يأتي بعد إنشاء الطلب فقط.',
    ridePolicy: 'بعد فتح الحساب يعود العميل إلى SR Ride لإدخال نقطة الانطلاق والوجهة وطلب السائق.',
    genericPolicy: 'حساب واحد لكل خدمات SYBNB داخل سوريا. الدفع لا يبدأ من هذه الخطوة.',
  },
  en: {
    back: 'Back',
    next: 'Next',
    title: 'Short-Term Rental Account',
    rentalsTitle: 'Monthly Rental Account',
    rideTitle: 'SR Ride Account',
    genericTitle: 'Create your SYBNB account',
    gateTitle: 'Please sign in to continue',
    gateChip: 'Rental request',
    rideGateChip: 'Ride request',
    subtitle: 'Create an account or sign in before sending the booking request. Payment does not start from this step.',
    rentalsSubtitle: 'Create an account or sign in before continuing the monthly rental request. Payment starts only after the correct request is opened.',
    rideSubtitle: 'Create an account or sign in before requesting a ride. A verified account is required before dispatch.',
    genericSubtitle: 'Create your account with your email to use all SYBNB services. Payment does not start from this step.',
    signup: 'Create new account',
    signin: 'Sign in',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email address',
    phone: 'Phone number (optional)',
    password: 'Password',
    repeatPassword: 'Repeat password',
    sendCode: 'Email me the code',
    sending: 'Sending…',
    resendCode: 'Resend code',
    code: 'Verification code',
    confirmCode: 'Confirm code',
    openAccount: 'Open account and continue',
    signInAccount: 'Sign in and continue',
    error: 'Complete the required details, confirm the password, then request and confirm the email code before opening the account.',
    invalidEmail: 'Enter a valid email address to receive the code.',
    networkError: 'Could not reach the server. Check your connection and try again.',
    codeSentPrefix: 'Verification code sent to your email',
    idDocumentTitle: 'ID verification (optional for now)',
    idDocumentHelp: 'Upload a clear photo of your national ID or passport now, or later before payment. Required once, before your first booking is confirmed.',
    idDocumentCta: 'Tap to upload your ID photo',
    idDocumentEmpty: 'No ID uploaded yet. You can add it later before payment.',
    idDocumentRequired: 'Upload a photo of your ID before payment.',
    codeSent: 'Verification code sent to your email.',
    ready: 'Guest account is ready. You can now send the booking request.',
    rentalsReady: 'Guest account is ready. You can now continue the rental request.',
    rideReady: 'Guest account is ready. You can now continue the ride request.',
    genericReady: 'Your account is ready.',
    policy: 'After opening the account, the guest returns to the stay details to send the booking request. Payment comes only after the booking request is created.',
    rentalsPolicy: 'After opening the account, the renter returns to the monthly rental page to review choices and continue the request. Payment comes only after the request is created.',
    ridePolicy: 'After opening the account, the client returns to SR Ride to enter pickup, destination, and request a driver.',
    genericPolicy: 'One account for all SYBNB services in Syria. Payment does not start from this step.',
  },
}

export function GuestAccountPage({ lang, listingId, flow = 'stays', returnPath: explicitReturnPath }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [codeConfirmed, setCodeConfirmed] = useState(false)
  const [idDocumentFiles, setIdDocumentFiles] = useState<string[]>([])
  // The real File object (the one that actually gets uploaded) — kept separate from the
  // display-only name list above, which feeds the shared PaymentProofUpload component.
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'error' | 'success' | 'info'>('info')
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)

  // Always surface a status; never swallow an OTP/API error silently.
  function setStatus(text: string, nextTone: 'error' | 'success' | 'info') {
    setMessage(text)
    setTone(nextTone)
  }

  function addIdDocumentFiles(fileList: FileList | null) {
    const selected = Array.from(fileList || [])
    const file = selected[selected.length - 1]
    if (!file) return
    setIdDocumentFile(file)
    setIdDocumentFiles([file.name])
  }
  const returnPath = listingId ? `/listing/${listingId}` : sanitizeReturnPath(explicitReturnPath) || readStoredReturnPath()
  const isGenericFlow = flow === 'generic'
  const isRentalsFlow = flow === 'rentals' || returnPath.startsWith('/rentals')
  const isRideFlow = flow === 'ride' || returnPath.startsWith('/ride')
  const title = isRideFlow ? t.rideTitle : isRentalsFlow ? t.rentalsTitle : isGenericFlow ? t.genericTitle : t.title
  const subtitle = isRideFlow ? t.rideSubtitle : isRentalsFlow ? t.rentalsSubtitle : isGenericFlow ? t.genericSubtitle : t.subtitle
  const gateTitle = isRentalsFlow || isRideFlow ? t.gateTitle : title
  const readyMessage = isRideFlow ? t.rideReady : isRentalsFlow ? t.rentalsReady : isGenericFlow ? t.genericReady : t.ready
  const policy = isRideFlow ? t.ridePolicy : isRentalsFlow ? t.rentalsPolicy : isGenericFlow ? t.genericPolicy : t.policy
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const codeInstruction = isAr
    ? `رسالة من المنصة: أرسلنا رمز التحقق إلى بريدك الإلكتروني ${maskEmail(email)}. أدخل الرمز ثم اضغط تأكيد.`
    : `Platform message: we sent the verification code to your email ${maskEmail(email)}. Enter it, then press confirm.`

  // Surface the server's exact message (e.g. "code has expired" / "code is not correct") so invalid
  // and expired states are distinct; fall back to a clear network message. Never swallow the error.
  function errText(err: unknown) {
    return err instanceof Error && err.message ? err.message : t.networkError
  }

  async function complete() {
    const signupMissing =
      mode === 'signup' &&
      (firstName.trim().length < 2 ||
        lastName.trim().length < 2 ||
        password !== repeatPassword)
    if (
      signupMissing ||
      !emailValid ||
      password.length < 8 ||
      !codeSent ||
      code.trim().length < 4 ||
      !codeConfirmed
    ) {
      setStatus(t.error, 'error')
      return
    }

    setSaving(true)
    try {
      await createGuestAccountSession({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
      })
      if (mode === 'signup' && idDocumentFile) {
        await submitGuestIdDocument(idDocumentFile)
      }
      sessionStorage.setItem(CUSTOMER_GATE_KEY, '1')
      if (listingId) sessionStorage.setItem(`${CUSTOMER_GATE_KEY}:${listingId}`, '1')
      if (!listingId) sessionStorage.removeItem(GUEST_RETURN_PATH_KEY)
      setStatus(readyMessage, 'success')
      // A real bug caught by an independent re-audit: `window.location.hash = returnPath` is a
      // no-op (fires no `hashchange` event) whenever returnPath already equals the current hash --
      // exactly the case for a gated route like /ride, whose own gate redirect set returnPath to
      // itself. Without this, App's route-gate state never re-evaluates and a first-time signup
      // strands the user on this screen after a successful account creation. Fixed the same way
      // StaffAccessPage.tsx already does for staff login: dispatch the session-changed event App
      // already listens for, so the re-render happens regardless of whether the hash itself changes.
      window.dispatchEvent(new Event('sybnb-session-changed'))
      window.location.hash = returnPath
    } catch (error) {
      setStatus(errText(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.flowNav} aria-label={isAr ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button style={styles.arrowButton} onClick={() => (window.location.hash = returnPath)} aria-label={t.back}>
          ×
        </button>
        <button style={styles.arrowButton} onClick={() => void complete()} aria-label={t.next} disabled={saving}>
          →
        </button>
      </section>

      <section style={styles.panel}>
        <p style={styles.logo}>SYBNB</p>
        <p style={styles.eyebrow}>{isRideFlow ? `${t.rideGateChip} — ${title}` : isRentalsFlow ? `${t.gateChip} — ${title}` : 'SYBNB V6'}</p>
        <h1 style={styles.title}>{gateTitle}</h1>
        <p style={styles.body}>{subtitle}</p>
        <div style={styles.modeSwitch} role="tablist" aria-label={isAr ? 'نوع الحساب' : 'Account mode'}>
          <button style={mode === 'signup' ? styles.modeButtonActive : styles.modeButton} onClick={() => setMode('signup')}>
            {t.signup}
          </button>
          <button style={mode === 'signin' ? styles.modeButtonActive : styles.modeButton} onClick={() => setMode('signin')}>
            {t.signin}
          </button>
        </div>
        <div style={styles.formGrid}>
          {mode === 'signup' ? (
            <>
              <input style={styles.input} value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder={t.firstName} aria-label={t.firstName} />
              <input style={styles.input} value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder={t.lastName} aria-label={t.lastName} />
            </>
          ) : null}
          <input dir="ltr" type="email" autoComplete="email" style={styles.input} value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t.email} aria-label={t.email} aria-invalid={email.trim().length > 0 && !emailValid} />
          {email.trim().length > 0 && !emailValid ? (
            <small role="alert" style={styles.fieldHint}>{t.invalidEmail}</small>
          ) : null}
          <input dir="ltr" inputMode="tel" style={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t.phone} aria-label={t.phone} />
          <input style={styles.input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t.password} aria-label={t.password} />
          {mode === 'signup' ? <input style={styles.input} type="password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} placeholder={t.repeatPassword} aria-label={t.repeatPassword} /> : null}
        </div>
        <div style={styles.codeRow}>
          <button
            style={styles.secondaryButton}
            onClick={async () => {
              if (!emailValid) {
                setStatus(t.invalidEmail, 'error')
                return
              }
              setSending(true)
              try {
                const res = await requestOtp({ email: email.trim(), purpose: 'account-verify' })
                setCodeSent(true)
                setCodeConfirmed(false)
                setStatus(`${t.codeSentPrefix} (${res.maskedEmail || maskEmail(email)}).`, 'info')
              } catch (err) {
                setStatus(errText(err), 'error')
              } finally {
                setSending(false)
              }
            }}
            disabled={sending || !emailValid}
          >
            {sending ? t.sending : codeSent ? t.resendCode : t.sendCode}
          </button>
          <input
            dir="ltr"
            inputMode="numeric"
            style={styles.input}
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
              setCodeConfirmed(false)
            }}
            placeholder={t.code}
            aria-label={t.code}
          />
          <button
            style={styles.secondaryButton}
            disabled={!codeSent || code.trim().length < 4}
            onClick={async () => {
              try {
                const ok = await confirmOtp({ email: email.trim(), purpose: 'account-verify', code: code.trim() })
                setCodeConfirmed(ok)
                setStatus(ok ? readyMessage : t.error, ok ? 'success' : 'error')
              } catch (err) {
                setCodeConfirmed(false)
                setStatus(errText(err), 'error')
              }
            }}
          >
            {codeConfirmed ? '✓' : t.confirmCode}
          </button>
        </div>
        {codeSent ? (
          <div style={styles.codeBoxes} dir="ltr" aria-label={t.code}>
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} style={styles.codeBox}>{code[index] || ''}</span>
            ))}
          </div>
        ) : null}
        {codeSent ? <p style={styles.notice}>{codeInstruction}</p> : null}
        {mode === 'signup' && (
          <PaymentProofUpload
            lang={lang}
            files={idDocumentFiles}
            onAddFiles={addIdDocumentFiles}
            title={t.idDocumentTitle}
            cta={t.idDocumentCta}
            help={t.idDocumentHelp}
            emptyText={t.idDocumentEmpty}
          />
        )}
        {mode === 'signup' && email.trim() && (
          <p style={styles.notice}>
            {isAr
              ? `تفضل واتساب أو إيميل؟ أرسل صورة إثبات هويتك مع بريدك الإلكتروني (${email.trim()}) إلى `
              : `Prefer WhatsApp or email? Send your ID photo with your account email (${email.trim()}) to `}
            <a href={whatsappIdSubmissionLink(email.trim(), lang)} target="_blank" rel="noreferrer" style={{ color: '#dce3ff' }}>
              {isAr ? 'واتساب' : 'WhatsApp'} ({SUPPORT_WHATSAPP_LOCAL})
            </a>
            {isAr ? ' أو ' : ' or '}
            <a href={emailIdSubmissionLink(email.trim(), lang)} style={{ color: '#dce3ff' }}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        )}
        <p style={styles.policy}>{policy}</p>
        {message ? (
          <strong role="status" aria-live="polite" style={tone === 'error' ? styles.error : tone === 'success' ? styles.success : styles.infoText}>
            {message}
          </strong>
        ) : null}
        <button style={styles.primaryButton} onClick={() => void complete()} disabled={saving}>
          {saving ? '...' : mode === 'signup' ? t.openAccount : t.signInAccount}
        </button>
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

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return 'xxxxxxxxxxxx'
  if (digits.length <= 4) return `${'x'.repeat(8)}${digits}`
  return `${'x'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`
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
  page: { minHeight: 'calc(100vh - 160px)', background: '#08090e', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, alignContent: 'center', maxWidth: 430, margin: '0 auto', width: '100%' },
  flowNav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', alignSelf: 'end' },
  arrowButton: { width: 46, height: 46, borderRadius: 999, border: 0, background: 'transparent', color: '#fff', fontSize: 30, fontWeight: 800, display: 'grid', placeItems: 'center' },
  panel: { border: 0, borderRadius: 0, background: 'transparent', padding: 0, display: 'grid', gap: 22, textAlign: 'center' },
  logo: { justifySelf: 'center', borderRadius: 8, background: '#12131b', color: '#fff', fontSize: 28, fontWeight: 950, letterSpacing: 1, margin: 0, padding: '10px 28px' },
  eyebrow: { justifySelf: 'center', color: '#9fb0ff', borderRadius: 999, background: '#111429', fontWeight: 900, fontSize: 13, margin: 0, padding: '8px 18px' },
  title: { margin: 0, fontSize: 30, lineHeight: 1.12 },
  body: { color: '#9aa6ba', lineHeight: 1.65, margin: 0 },
  formGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', textAlign: 'start' },
  modeSwitch: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, border: '1px solid #202334', borderRadius: 14, padding: 5, background: '#111118' },
  modeButton: { minHeight: 50, border: '1px solid transparent', borderRadius: 12, background: 'transparent', color: '#6f7485', fontWeight: 950, padding: '0 12px' },
  modeButtonActive: { minHeight: 50, border: '1px solid rgba(82,104,255,.12)', borderRadius: 12, background: '#20212b', color: '#fff', fontWeight: 950, padding: '0 12px' },
  codeRow: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  input: { minHeight: 54, border: '1px solid #232638', borderRadius: 13, background: '#111118', color: '#fff', padding: '0 14px', fontWeight: 800 },
  codeBoxes: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 },
  codeBox: { minHeight: 52, border: '1px solid #232638', borderRadius: 10, background: '#111118', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 950 },
  primaryButton: { minHeight: 58, border: 0, borderRadius: 12, background: '#5268ff', color: '#fff', fontWeight: 950, padding: '0 16px', fontSize: 16 },
  secondaryButton: { minHeight: 54, border: '1px solid #30384d', borderRadius: 12, background: '#111118', color: '#fff', fontWeight: 900, padding: '0 14px' },
  policy: { border: '1px solid rgba(213,169,21,.35)', borderRadius: 8, background: 'rgba(213,169,21,.08)', color: '#d5a915', padding: 12, margin: 0, lineHeight: 1.6 },
  notice: { border: '1px solid rgba(82,104,255,.45)', borderRadius: 8, background: 'rgba(82,104,255,.1)', color: '#dce3ff', padding: 12, margin: 0, lineHeight: 1.6, fontWeight: 850 },
  success: { color: '#20d29b' },
  error: { color: '#ff8f9f' },
  infoText: { color: '#9fb0ff' },
  fieldHint: { color: '#ff8f9f', fontWeight: 700, marginTop: -6 },
}
