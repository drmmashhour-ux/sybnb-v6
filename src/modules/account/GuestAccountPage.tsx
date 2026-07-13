import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createGuestAccountSession,
  sendEmailVerificationCode,
  submitGuestIdDocument,
  verifyEmailVerificationCode,
} from '../../shared/api/platformApi'
import { emailIdSubmissionLink, SUPPORT_EMAIL, SUPPORT_WHATSAPP_LOCAL, whatsappIdSubmissionLink } from '../../shared/support/contactChannels'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'

type Props = {
  lang: Lang
  listingId?: string
  flow?: 'stays' | 'rentals' | 'buy' | 'ride' | 'generic'
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
    buyTitle: 'حساب شراء العقار',
    rideTitle: 'حساب SR Ride',
    gateTitle: 'يرجى تسجيل الدخول للمتابعة',
    gateChip: 'طلب إيجار',
    buyGateChip: 'طلب شراء',
    rideGateChip: 'طلب رحلة',
    subtitle: 'أنشئ الحساب أو سجّل الدخول قبل إرسال طلب الحجز. الدفع لا يبدأ من هذه الخطوة.',
    rentalsSubtitle: 'أنشئ الحساب أو سجّل الدخول قبل متابعة طلب الإيجار الشهري. الدفع لا يبدأ قبل فتح الطلب الصحيح.',
    buySubtitle: 'أنشئ الحساب أو سجّل الدخول قبل متابعة طلب شراء العقار. الدفع لا يبدأ قبل فتح الطلب الصحيح.',
    rideSubtitle: 'أنشئ الحساب أو سجّل الدخول قبل إرسال طلب الرحلة. لا يمكن طلب سائق بدون رقم هاتف وحساب مؤكد.',
    signup: 'تسجيل حساب جديد',
    signin: 'تسجيل الدخول',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    email: 'البريد الإلكتروني',
    phone: 'رقم الهاتف',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    referralCode: 'رمز الإحالة (اختياري)',
    sendCode: 'إرسال رمز إلى البريد',
    resendCode: 'إعادة الإرسال',
    sendingCode: 'جارٍ الإرسال...',
    code: 'رمز التحقق',
    confirmCode: 'تأكيد الرمز',
    confirmingCode: 'جارٍ التأكيد...',
    openAccount: 'فتح الحساب والمتابعة',
    signInAccount: 'تسجيل الدخول والمتابعة',
    error: 'أكمل البيانات المطلوبة، تأكد من كلمة المرور، ثم أرسل رمز البريد الإلكتروني وأكده قبل فتح الحساب.',
    idDocumentTitle: 'إثبات الهوية (اختياري الآن)',
    idDocumentHelp: 'ارفع صورة واضحة عن هويتك الشخصية أو جواز السفر الآن، أو لاحقاً قبل الدفع. مطلوب مرة واحدة فقط قبل تأكيد أول حجز.',
    idDocumentCta: 'اضغط لرفع صورة الهوية',
    idDocumentEmpty: 'لم يتم رفع الهوية بعد. يمكنك رفعها لاحقاً قبل الدفع.',
    idDocumentRequired: 'ارفع صورة عن هويتك قبل الدفع.',
    codeSentReal: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.',
    codeSentDev: 'بيئة التطوير: لا يُرسل بريد فعلي خارج بيئة الإنتاج، لذا الرمز معروض هنا مباشرة للاختبار فقط.',
    codeConfirmed: 'تم تأكيد البريد الإلكتروني.',
    codeInvalid: 'الرمز غير صحيح أو منتهي الصلاحية. اطلب رمزاً جديداً.',
    ready: 'تم تجهيز حساب العميل. يمكنك الآن إرسال طلب الحجز.',
    rentalsReady: 'تم تجهيز حساب العميل. يمكنك الآن متابعة طلب الإيجار.',
    buyReady: 'تم تجهيز حساب العميل. يمكنك الآن متابعة طلب الشراء.',
    rideReady: 'تم تجهيز حساب العميل. يمكنك الآن متابعة طلب الرحلة.',
    policy: 'بعد فتح الحساب يعود العميل إلى تفاصيل الإعلان لإرسال الطلب. الدفع يأتي بعد إنشاء الطلب فقط.',
    rentalsPolicy: 'بعد فتح الحساب يعود العميل إلى صفحة الإيجار الشهري لمراجعة الاختيارات ومتابعة الطلب. الدفع يأتي بعد إنشاء الطلب فقط.',
    buyPolicy: 'بعد فتح الحساب يعود العميل إلى صفحة شراء العقار لمراجعة الاختيارات ومتابعة الطلب. الدفع يأتي بعد إنشاء الطلب فقط.',
    ridePolicy: 'بعد فتح الحساب يعود العميل إلى SR Ride لإدخال نقطة الانطلاق والوجهة وطلب السائق.',
  },
  en: {
    back: 'Back',
    next: 'Next',
    title: 'Short-Term Rental Account',
    rentalsTitle: 'Monthly Rental Account',
    buyTitle: 'Property Purchase Account',
    rideTitle: 'SR Ride Account',
    gateTitle: 'Please sign in to continue',
    gateChip: 'Rental request',
    buyGateChip: 'Purchase request',
    rideGateChip: 'Ride request',
    subtitle: 'Create an account or sign in before sending the booking request. Payment does not start from this step.',
    rentalsSubtitle: 'Create an account or sign in before continuing the monthly rental request. Payment starts only after the correct request is opened.',
    buySubtitle: 'Create an account or sign in before continuing the property purchase request. Payment starts only after the correct request is opened.',
    rideSubtitle: 'Create an account or sign in before requesting a ride. A verified phone and account are required before dispatch.',
    signup: 'Create new account',
    signin: 'Sign in',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email address',
    phone: 'Phone number',
    password: 'Password',
    repeatPassword: 'Repeat password',
    referralCode: 'Referral code (optional)',
    sendCode: 'Send code to email',
    resendCode: 'Resend',
    sendingCode: 'Sending...',
    code: 'Verification code',
    confirmCode: 'Confirm code',
    confirmingCode: 'Confirming...',
    openAccount: 'Open account and continue',
    signInAccount: 'Sign in and continue',
    error: 'Complete the required details, confirm the password, then send and confirm the email code before opening the account.',
    idDocumentTitle: 'ID verification (optional for now)',
    idDocumentHelp: 'Upload a clear photo of your national ID or passport now, or later before payment. Required once, before your first booking is confirmed.',
    idDocumentCta: 'Tap to upload your ID photo',
    idDocumentEmpty: 'No ID uploaded yet. You can add it later before payment.',
    idDocumentRequired: 'Upload a photo of your ID before payment.',
    codeSentReal: 'Verification code sent to your email.',
    codeSentDev: 'Dev environment: no real email is sent outside production, so the code is shown here directly for testing only.',
    codeConfirmed: 'Email confirmed.',
    codeInvalid: 'That code is wrong or expired. Request a new one.',
    ready: 'Guest account is ready. You can now send the booking request.',
    rentalsReady: 'Guest account is ready. You can now continue the rental request.',
    buyReady: 'Guest account is ready. You can now continue the purchase request.',
    rideReady: 'Guest account is ready. You can now continue the ride request.',
    policy: 'After opening the account, the guest returns to the stay details to send the booking request. Payment comes only after the booking request is created.',
    rentalsPolicy: 'After opening the account, the renter returns to the monthly rental page to review choices and continue the request. Payment comes only after the request is created.',
    buyPolicy: 'After opening the account, the buyer returns to the property purchase page to review choices and continue the request. Payment comes only after the request is created.',
    ridePolicy: 'After opening the account, the client returns to SR Ride to enter pickup, destination, and request a driver.',
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
  const [referralCode, setReferralCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [codeConfirmed, setCodeConfirmed] = useState(false)
  const [codeBusy, setCodeBusy] = useState<'idle' | 'sending' | 'confirming'>('idle')
  const [devCode, setDevCode] = useState('')
  const [idDocumentFiles, setIdDocumentFiles] = useState<string[]>([])
  // The real File object (the one that actually gets uploaded) — kept separate from the
  // display-only name list above, which feeds the shared PaymentProofUpload component.
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [isErrorMessage, setIsErrorMessage] = useState(false)
  const [saving, setSaving] = useState(false)

  function addIdDocumentFiles(fileList: FileList | null) {
    const selected = Array.from(fileList || [])
    const file = selected[selected.length - 1]
    if (!file) return
    setIdDocumentFile(file)
    setIdDocumentFiles([file.name])
  }
  const returnPath = listingId ? `/listing/${listingId}` : sanitizeReturnPath(explicitReturnPath) || readStoredReturnPath()
  const isRentalsFlow = flow === 'rentals' || returnPath.startsWith('/rentals')
  const isBuyFlow = flow === 'buy' || returnPath.startsWith('/buy')
  const isRideFlow = flow === 'ride' || returnPath.startsWith('/ride')
  const title = isRideFlow ? t.rideTitle : isBuyFlow ? t.buyTitle : isRentalsFlow ? t.rentalsTitle : t.title
  const subtitle = isRideFlow ? t.rideSubtitle : isBuyFlow ? t.buySubtitle : isRentalsFlow ? t.rentalsSubtitle : t.subtitle
  const gateTitle = isRentalsFlow || isBuyFlow || isRideFlow ? t.gateTitle : title
  const readyMessage = isRideFlow ? t.rideReady : isBuyFlow ? t.buyReady : isRentalsFlow ? t.rentalsReady : t.ready
  const policy = isRideFlow ? t.ridePolicy : isBuyFlow ? t.buyPolicy : isRentalsFlow ? t.rentalsPolicy : t.policy
  const gateChip = isRideFlow ? t.rideGateChip : isBuyFlow ? t.buyGateChip : t.gateChip

  async function sendCode() {
    setCodeBusy('sending')
    setCodeConfirmed(false)
    setCode('')
    setDevCode('')
    try {
      const result = await sendEmailVerificationCode(email.trim())
      setCodeSent(true)
      if (result.devCode) {
        setDevCode(result.devCode)
        setMessage(t.codeSentDev)
        setIsErrorMessage(false)
      } else {
        setMessage(t.codeSentReal)
        setIsErrorMessage(false)
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
      await verifyEmailVerificationCode(email.trim(), code.trim())
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

  async function complete() {
    const signupMissing =
      mode === 'signup' &&
      (firstName.trim().length < 2 ||
        lastName.trim().length < 2 ||
        password !== repeatPassword)
    if (
      signupMissing ||
      !email.includes('@') ||
      phone.trim().length < 8 ||
      password.length < 8 ||
      !codeConfirmed
    ) {
      setMessage(t.error)
      setIsErrorMessage(true)
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
        referralCode: referralCode.trim() || undefined,
      })
      if (mode === 'signup' && idDocumentFile) {
        await submitGuestIdDocument(idDocumentFile)
      }
      sessionStorage.setItem(CUSTOMER_GATE_KEY, '1')
      if (listingId) sessionStorage.setItem(`${CUSTOMER_GATE_KEY}:${listingId}`, '1')
      if (!listingId) sessionStorage.removeItem(GUEST_RETURN_PATH_KEY)
      setMessage(readyMessage)
      setIsErrorMessage(false)
      window.location.hash = returnPath
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
      setIsErrorMessage(true)
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
        <p style={styles.eyebrow}>{isRideFlow || isBuyFlow || isRentalsFlow ? `${gateChip} — ${title}` : 'SYBNB V6'}</p>
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
              <input style={styles.input} value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder={t.firstName} />
              <input style={styles.input} value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder={t.lastName} />
            </>
          ) : null}
          <input
            dir="ltr"
            style={styles.input}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setCodeSent(false)
              setCodeConfirmed(false)
            }}
            placeholder={t.email}
          />
          <input dir="ltr" inputMode="tel" style={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t.phone} />
          <input style={styles.input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t.password} />
          {mode === 'signup' ? <input style={styles.input} type="password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} placeholder={t.repeatPassword} /> : null}
          {mode === 'signup' ? (
            <input
              dir="ltr"
              style={styles.input}
              value={referralCode}
              onChange={(event) => setReferralCode(event.target.value)}
              placeholder={t.referralCode}
            />
          ) : null}
        </div>
        <div style={styles.codeRow}>
          <button
            style={styles.secondaryButton}
            onClick={() => void sendCode()}
            disabled={!email.includes('@') || codeBusy !== 'idle'}
          >
            {codeBusy === 'sending' ? t.sendingCode : codeSent ? t.resendCode : t.sendCode}
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
          />
          <button
            style={styles.secondaryButton}
            disabled={!codeSent || code.trim().length < 4 || codeBusy !== 'idle'}
            onClick={() => void confirmCode()}
          >
            {codeConfirmed ? '✓' : codeBusy === 'confirming' ? t.confirmingCode : t.confirmCode}
          </button>
        </div>
        {codeSent ? (
          <div style={styles.codeBoxes} dir="ltr" aria-label={t.code}>
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} style={styles.codeBox}>{code[index] || ''}</span>
            ))}
          </div>
        ) : null}
        {devCode ? (
          <p style={styles.notice} dir="ltr">
            DEV CODE: <strong>{devCode}</strong>
          </p>
        ) : null}
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
          <strong
            role={isErrorMessage ? 'alert' : 'status'}
            aria-live={isErrorMessage ? 'assertive' : 'polite'}
            style={isErrorMessage ? styles.error : styles.success}
          >
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
  primaryButton: { minHeight: 58, border: 0, borderRadius: 12, background: '#4760ff', color: '#fff', fontWeight: 950, padding: '0 16px', fontSize: 16 },
  secondaryButton: { minHeight: 54, border: '1px solid #30384d', borderRadius: 12, background: '#111118', color: '#fff', fontWeight: 900, padding: '0 14px' },
  policy: { border: '1px solid rgba(213,169,21,.35)', borderRadius: 8, background: 'rgba(213,169,21,.08)', color: '#d5a915', padding: 12, margin: 0, lineHeight: 1.6 },
  notice: { border: '1px solid rgba(82,104,255,.45)', borderRadius: 8, background: 'rgba(82,104,255,.1)', color: '#dce3ff', padding: 12, margin: 0, lineHeight: 1.6, fontWeight: 850 },
  success: { color: '#20d29b' },
  error: { color: '#ff8f9f' },
}
