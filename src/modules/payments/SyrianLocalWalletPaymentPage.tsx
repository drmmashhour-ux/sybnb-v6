import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  bookingPaymentStatusFromManualReview,
  createSyrianLocalWalletQrPayload,
  createSyrianLocalWalletSubmission,
  SYRIAN_LOCAL_WALLET_QR_ASSET,
  SYRIAN_LOCAL_WALLET_QR_NUMBER,
  syrianLocalWalletInstructions,
  syrianLocalWalletRecipient,
  type ManualPaymentStatus,
  type SyrianLocalWalletSubmission,
  validateSyrianLocalWalletSubmission,
} from '../../engines/payments/syrianLocalWallet'
import {
  fetchPrototypeBooking,
  submitPrototypeLocalWalletProof,
  type PlatformPaymentProof,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'
import type { CSSVars } from '../../shared/theme/cssVars'
import { PaymentCapsule } from './PaymentCapsule'
import { PaymentProofUpload, paymentProofReference } from './PaymentProofUpload'

type Props = {
  lang: Lang
  bookingId?: string
  amountMinor?: number
  currency?: string
}

const CONFIRMED_PAYMENT_STORAGE_KEY = 'sybnb_v6_confirmed_payment'

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'الدفع عبر المحفظة المحلية السورية',
    subtitle: 'أرسل إثبات التحويل داخل SYBNB فقط ليبقى الحجز محمياً.',
    mode: 'مراجعة يدوية / قاعدة بيانات مباشرة',
    recipient: 'المستلم',
    maskedAccount: 'الحساب',
    amountDue: 'المبلغ المستحق',
    currency: 'العملة',
    qrValue: 'رقم الدفع أسفل QR',
    qrPayload: 'محتوى QR',
    formTitle: 'إرسال إثبات التحويل',
    transactionReference: 'رقم العملية',
    senderName: 'اسم المرسل',
    senderPhone: 'هاتف المرسل',
    submit: 'إرسال للمراجعة',
    adminTitle: 'تتبع إثبات الدفع',
    viewBooking: 'عرض الحجز',
    submittedReference: 'رقم العملية المرسل',
    proof: 'إثبات الدفع',
    hostTitle: 'حالة المضيف',
    hostUnderReview: 'الدفع قيد المراجعة',
    hostApproved: 'تم تأكيد الدفع ويمكن متابعة الحجز.',
    hostRejected: 'تم رفض الدفع. يمكن للضيف إعادة إرسال الإثبات.',
    bookingStatus: 'حالة دفع الحجز',
    manualOnly: 'يتم التحويل في تطبيق المحفظة السورية الخارجي. تحفظ SYBNB الإثبات في قاعدة البيانات لمراجعة فريق SYBNB.',
    seed: 'حالة المراجعة',
    security: 'طبقة الأمان',
    validationPassed: 'تم التحقق من الحقول',
    validationFailed: 'يوجد خطأ في بيانات الدفع',
    duplicateBlocked: 'منع التكرار',
    hash: 'رمز المراجعة',
    riskFlags: 'ملاحظات المخاطر',
    noRisk: 'لا توجد ملاحظات',
    lockedDecision: 'تم إغلاق القرار',
    dbStatus: 'حالة قاعدة البيانات',
    proofId: 'رقم إثبات قاعدة البيانات',
    receipt: 'فتح الإيصال',
    dashboard: 'فتح حسابي',
    savePayment: 'حفظ معلومات الدفع',
    printPayment: 'طباعة معلومات الدفع',
    apiError: 'تعذر الاتصال بواجهة الدفع',
    saving: 'جار الحفظ',
    adminConfirmedTitle: 'تم تأكيد الدفع والحجز',
    adminConfirmedBody: 'أكدت الإدارة استلام المال ومطابقة إثبات الدفع. أصبح الحجز مؤكداً ويمكن للعميل متابعة رحلته من حسابه.',
    phoneMessageTitle: 'رسالة الهاتف للعميل',
    phoneMessageBody: 'تم تأكيد حجزك في SYBNB. استخدم تسجيل الدخول برقم هاتفك لمتابعة تفاصيل الحجز والرحلة حتى الانتهاء.',
    reservationConfirmed: 'الحجز مؤكد',
    adminReviewApproved: 'الإدارة أكدت الاستلام',
    continueTrip: 'متابعة الرحلة من حسابي',
    demoProof: 'إضافة إثبات سريع للمراجعة',
    demoProofHelp: 'يضيف ملف إثبات إلى الطلب، ويبقى قرار قبول الدفع بيد الإدارة فقط.',
  },
  en: {
    back: 'Back to landing',
    title: 'Syrian Local Wallet / QR Payment',
    subtitle: 'Submit transfer proof inside SYBNB only so the booking stays protected.',
    mode: 'Manual review / live database',
    recipient: 'Recipient',
    maskedAccount: 'Account',
    amountDue: 'Amount due',
    currency: 'Currency',
    qrValue: 'Payment number under QR',
    qrPayload: 'QR payload',
    formTitle: 'Submit transfer proof',
    transactionReference: 'Transaction reference',
    senderName: 'Sender name',
    senderPhone: 'Sender phone',
    submit: 'Submit for review',
    adminTitle: 'Payment proof tracking',
    viewBooking: 'View booking',
    submittedReference: 'Submitted reference',
    proof: 'Payment proof',
    hostTitle: 'Host status',
    hostUnderReview: 'Payment under review',
    hostApproved: 'Payment confirmed. Booking can continue.',
    hostRejected: 'Payment rejected. Guest can resubmit proof.',
    bookingStatus: 'Booking payment status',
    manualOnly: 'The transfer happens in the external Syrian wallet app. SYBNB stores the proof in PostgreSQL for SYBNB team review.',
    seed: 'Review status',
    security: 'Security layer',
    validationPassed: 'Fields validated',
    validationFailed: 'Payment data has an error',
    duplicateBlocked: 'Duplicate blocked',
    hash: 'Review hash',
    riskFlags: 'Risk flags',
    noRisk: 'No risk notes',
    lockedDecision: 'Decision locked',
    dbStatus: 'Database status',
    proofId: 'Database proof ID',
    receipt: 'Open receipt',
    dashboard: 'Open my account',
    savePayment: 'Save Payment Info',
    printPayment: 'Print Payment Info',
    apiError: 'Payment API request failed',
    saving: 'Saving',
    adminConfirmedTitle: 'Payment and booking confirmed',
    adminConfirmedBody: 'Admin confirmed the money was received and the proof matches. The reservation is now confirmed and the guest can continue the trip from the account.',
    phoneMessageTitle: 'Phone message to guest',
    phoneMessageBody: 'Your SYBNB booking is confirmed. Sign in with your phone number to follow booking and trip details until completion.',
    reservationConfirmed: 'Reservation confirmed',
    adminReviewApproved: 'Admin confirmed receipt',
    continueTrip: 'Continue trip from my account',
    demoProof: 'Add quick proof for review',
    demoProofHelp: 'Adds a proof file to the request, while payment acceptance remains admin-only.',
  },
}

const statusLabel: Record<Lang, Record<ManualPaymentStatus, string>> = {
  ar: {
    PENDING_REVIEW: 'قيد المراجعة',
    APPROVED: 'تمت الموافقة',
    REJECTED: 'مرفوض',
  },
  en: {
    PENDING_REVIEW: 'Pending review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
  },
}

export function SyrianLocalWalletPaymentPage({ lang, bookingId = 'BK-2026-0042', amountMinor = 10, currency = 'SYP' }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const defaultTransactionReference = `SLW-${bookingId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`
  const [transactionReference, setTransactionReference] = useState(defaultTransactionReference)
  const [senderName, setSenderName] = useState(isAr ? 'ضيف SYBNB' : 'SYBNB Guest')
  const [senderPhone, setSenderPhone] = useState('+963 900 000 001')
  const [uploadedProofFiles, setUploadedProofFiles] = useState<string[]>([])
  const [submission, setSubmission] = useState<SyrianLocalWalletSubmission>(() =>
    createSyrianLocalWalletSubmission({
      bookingId,
      userId: 'USR-LOCAL-WALLET-001',
      amount: Math.max(Number(amountMinor || 10), 1),
      transactionReference: defaultTransactionReference,
      senderName: isAr ? 'ضيف SYBNB' : 'SYBNB Guest',
      senderPhone: '+963 900 000 001',
      proofUrl: undefined,
    }),
  )
  const [paymentProof, setPaymentProof] = useState<PlatformPaymentProof | null>(null)
  const [apiState, setApiState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    let cancelled = false

    void fetchPrototypeBooking(bookingId)
      .then((booking) => {
        if (cancelled) return
        const existing = (booking.payments || []).filter((proof) => proof.provider === 'syrian_local_wallet')
        const latest = existing[existing.length - 1]
        if (latest && latest.status !== 'REJECTED') setPaymentProof(latest)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [bookingId])
  const bookingPaymentStatus = useMemo(
    () => bookingPaymentStatusFromManualReview(submission.status),
    [submission.status],
  )
  const amountDue = Math.max(Number(amountMinor || 10), 1)
  const proofReference = paymentProofReference('local-wallet-proof', uploadedProofFiles)
  const qrPayload = useMemo(
    () =>
      createSyrianLocalWalletQrPayload({
        bookingId,
        amount: amountDue,
        currency,
        transactionReference,
      }),
    [amountDue, bookingId, currency, transactionReference],
  )
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    let cancelled = false

    void QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: {
        dark: '#07111f',
        light: '#f8fbff',
      },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    })

    return () => {
      cancelled = true
    }
  }, [qrPayload])

  const hostStatus =
    submission.status === 'APPROVED'
      ? t.hostApproved
      : submission.status === 'REJECTED'
        ? t.hostRejected
        : t.hostUnderReview
  const isAdminApproved = paymentProof?.status === 'APPROVED' || submission.status === 'APPROVED'
  const displayedBookingStatus = isAdminApproved ? t.reservationConfirmed : statusText(bookingPaymentStatus, lang)
  const displayedHostStatus = isAdminApproved ? t.hostApproved : hostStatus
  const displayedReviewStatus = isAdminApproved ? t.adminReviewApproved : statusLabel[lang][submission.status]
  const capsuleStatus =
    isAdminApproved
      ? 'confirmed'
      : paymentProof
        ? 'admin'
        : apiState === 'saving'
          ? 'proof'
          : transactionReference.trim().length >= 6
            ? 'ready'
            : 'locked'

  useEffect(() => {
    if (!isAdminApproved) return

    window.sessionStorage.setItem(
      CONFIRMED_PAYMENT_STORAGE_KEY,
      JSON.stringify({
        confirmedAt: new Date().toISOString(),
        bookingId,
        amountMinor: amountDue,
        currency,
        transactionReference,
        senderName,
        senderPhone,
        paymentProofId: paymentProof?.id || null,
        status: 'APPROVED',
      }),
    )
  }, [amountDue, bookingId, currency, isAdminApproved, paymentProof?.id, senderName, senderPhone, transactionReference])

  const validation = validateSyrianLocalWalletSubmission({
    bookingId,
    userId: 'USR-LOCAL-WALLET-001',
    amount: amountDue,
    transactionReference,
    senderName,
    senderPhone,
    proofUrl: proofReference || undefined,
  }, paymentProof ? [] : [submission.status === 'PENDING_REVIEW' ? '' : submission.transactionReference].filter(Boolean))
  const canSubmitProof = validation.ok && uploadedProofFiles.length > 0

  async function submitProof() {
    if (!canSubmitProof) return

    setApiState('saving')
    setApiError('')

    try {
      const localSubmission = createSyrianLocalWalletSubmission({
        bookingId,
        userId: 'USR-LOCAL-WALLET-001',
        amount: amountDue,
        transactionReference,
        senderName,
        senderPhone,
        proofUrl: proofReference,
      })
      const proof = await submitPrototypeLocalWalletProof({
        bookingId,
        amountMinor: amountDue,
        currency,
        proofAssetUrl: proofReference,
        providerRef: transactionReference,
      })

      setPaymentProof(proof)
      setSubmission(localSubmission)
      setApiState('idle')
    } catch (error) {
      setApiState('error')
      setApiError(error instanceof Error ? error.message : t.apiError)
    }
  }

  function addProofFiles(fileList: FileList | null) {
    const names = Array.from(fileList || []).map((file) => file.name).filter(Boolean)
    if (!names.length) return
    setUploadedProofFiles((current) => Array.from(new Set([...current, ...names])))
  }

  function addDemoProofFile() {
    setUploadedProofFiles((current) =>
      Array.from(new Set([...current, `SYBNB-payment-proof-${bookingId.slice(0, 8).toUpperCase()}.png`])),
    )
  }

  function paymentExportPayload() {
    return {
      exportedAt: new Date().toISOString(),
      bookingId,
      transactionReference,
      qrNumber: SYRIAN_LOCAL_WALLET_QR_NUMBER,
      recipient: syrianLocalWalletRecipient.name[lang],
      account: syrianLocalWalletRecipient.maskedAccount,
      amount: amountDue,
      currency,
      senderName,
      senderPhone,
      proofFiles: uploadedProofFiles,
      paymentProofId: paymentProof?.id || null,
      reservationStatus: displayedBookingStatus,
      reviewStatus: displayedReviewStatus,
      adminConfirmed: isAdminApproved,
    }
  }

  function savePaymentInfo() {
    const payload = JSON.stringify(paymentExportPayload(), null, 2)
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sybnb-payment-${bookingId}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function printPaymentInfo() {
    window.print()
  }

  return (
    <main className="wallet-page" dir={isAr ? 'rtl' : 'ltr'} style={{ '--accent': '#19d7ff' } as CSSVars}>
      <section style={flowStyles.nav} aria-label={isAr ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button style={flowStyles.arrow} onClick={() => (window.location.hash = `/booking/${bookingId}`)} aria-label={isAr ? 'السابق' : 'Back'}>
          ‹
        </button>
        <button
          style={flowStyles.arrow}
          disabled={apiState === 'saving' || (!isAdminApproved && !paymentProof && !canSubmitProof)}
          onClick={() => {
            if (paymentProof) {
              window.location.hash = `/payment/receipt/${paymentProof.id}`
              return
            }
            if (isAdminApproved) {
              window.location.hash = '/dashboard'
              return
            }
            void submitProof()
          }}
          aria-label={isAr ? 'التالي' : 'Next'}
        >
          ›
        </button>
      </section>

      <button className="back-button" onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section className="wallet-hero">
        <span className="wallet-chip">{t.mode}</span>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
      </section>

      <PaymentCapsule
        lang={lang}
        methodLabel={isAr ? 'محفظة محلية / شام كاش' : 'Local wallet / Sham Cash'}
        amountLabel={moneyText(amountDue, currency, lang)}
        destinationCode={transactionReference}
        followCode={bookingId}
        proofCount={uploadedProofFiles.length}
        status={capsuleStatus}
      />

      <section className="wallet-card wallet-actions" aria-label={isAr ? 'حفظ وطباعة معلومات الدفع' : 'Save and print payment information'}>
        <button onClick={savePaymentInfo}>{t.savePayment}</button>
        <button onClick={printPaymentInfo}>{t.printPayment}</button>
      </section>

      <section className="wallet-grid">
        <article className="wallet-card qr-card">
          <div className="qr-shell">
            <img src={qrDataUrl || SYRIAN_LOCAL_WALLET_QR_ASSET} alt={t.title} />
          </div>
          <div className="qr-number" aria-label={t.qrValue}>
            <span>{t.qrValue}</span>
            <strong dir="ltr">{transactionReference}</strong>
            <small dir="ltr">{SYRIAN_LOCAL_WALLET_QR_NUMBER}</small>
          </div>
          <div className="qr-payload">
            <span>{t.qrPayload}</span>
            <code dir="ltr">{qrPayload}</code>
          </div>
          <p>{syrianLocalWalletInstructions[lang]}</p>
        </article>

        <article className="wallet-card">
          <h2>{t.recipient}</h2>
          <div className="wallet-stat">
            <span>{t.recipient}</span>
            <strong>{syrianLocalWalletRecipient.name[lang]}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.maskedAccount}</span>
            <strong dir="ltr">{syrianLocalWalletRecipient.maskedAccount}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.amountDue}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(amountDue, currency, lang)}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.currency}</span>
            <strong>{isAr && currency === 'SYP' ? 'ل.س' : currency}</strong>
          </div>
          <p className="wallet-note">{t.manualOnly}</p>
        </article>
      </section>

      <section className="wallet-grid">
        <article className="wallet-card">
          <h2>{t.formTitle}</h2>
          <label>
            <span>{t.transactionReference}</span>
            <input value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} />
          </label>
          <label>
            <span>{t.senderName}</span>
            <input value={senderName} onChange={(event) => setSenderName(event.target.value)} />
          </label>
          <label>
            <span>{t.senderPhone}</span>
            <input dir="ltr" value={senderPhone} onChange={(event) => setSenderPhone(event.target.value)} />
          </label>
          <PaymentProofUpload lang={lang} files={uploadedProofFiles} onAddFiles={addProofFiles} />
          <button type="button" className="wallet-secondary" onClick={addDemoProofFile}>
            {t.demoProof}
          </button>
          <p className="wallet-note">{t.demoProofHelp}</p>
          <button className="wallet-primary" disabled={apiState === 'saving' || !canSubmitProof} onClick={submitProof}>
            {apiState === 'saving' ? t.saving : t.submit}
          </button>
          <div className={`wallet-security ${apiState === 'error' || !validation.ok ? 'bad' : 'ok'}`}>
            <strong>{t.security}</strong>
            {apiState === 'error' ? (
              <span>{apiError}</span>
            ) : (
              <span>{validation.ok ? t.validationPassed : t.validationFailed}</span>
            )}
            {!validation.ok && <small>{validation.errors.join(', ')}</small>}
            {validation.errors.includes('duplicate_transaction_reference') && <small>{t.duplicateBlocked}</small>}
          </div>
        </article>

        <article className="wallet-card">
          <h2>{t.adminTitle}</h2>
          <div className="wallet-stat">
            <span>{t.viewBooking}</span>
            <strong dir="ltr">{paymentProof ? submission.bookingId : bookingId}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.submittedReference}</span>
            <strong dir="ltr">{submission.transactionReference}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.proofId}</span>
            <strong dir="ltr">{paymentProof?.id ? paymentProof.id.slice(0, 8).toUpperCase() : '-'}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.dbStatus}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{statusText(paymentProof?.status, lang)}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.proof}</span>
            <strong>{submission.proofUrl ? uploadedProofFiles.length || '✓' : '-'}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.hash}</span>
            <strong dir="ltr">{submission.verificationHash}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.riskFlags}</span>
            <strong>{submission.riskFlags.length ? submission.riskFlags.join(', ') : t.noRisk}</strong>
          </div>
          {paymentProof && (
            <button className="wallet-primary" onClick={() => (window.location.hash = `/payment/receipt/${paymentProof.id}`)}>
              {t.receipt}
            </button>
          )}
          {(paymentProof || isAdminApproved) && (
            <button onClick={() => (window.location.hash = '/dashboard')}>
              {t.dashboard}
            </button>
          )}
        </article>
      </section>

      {isAdminApproved && (
        <section className="wallet-card wallet-approved-banner">
          <div>
            <strong>{t.adminConfirmedTitle}</strong>
            <p>{t.adminConfirmedBody}</p>
          </div>
          <div className="wallet-phone-message">
            <span>{t.phoneMessageTitle}</span>
            <p>{t.phoneMessageBody}</p>
          </div>
          <button className="wallet-primary" onClick={() => (window.location.hash = '/dashboard')}>
            {t.continueTrip}
          </button>
        </section>
      )}

      <section className={`wallet-card wallet-status ${isAdminApproved ? 'approved' : ''}`}>
        <div>
          <span>{t.bookingStatus}</span>
          <strong dir={isAr ? 'rtl' : 'ltr'}>{isAdminApproved ? `✓ ${displayedBookingStatus}` : displayedBookingStatus}</strong>
        </div>
        <div>
          <span>{t.hostTitle}</span>
          <strong>{isAdminApproved ? `✓ ${displayedHostStatus}` : displayedHostStatus}</strong>
        </div>
        <div>
          <span>{t.seed}</span>
          <strong>{isAdminApproved ? `✓ ${displayedReviewStatus}` : displayedReviewStatus}</strong>
        </div>
      </section>
    </main>
  )
}

const flowStyles = {
  nav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  arrow: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
} as const
