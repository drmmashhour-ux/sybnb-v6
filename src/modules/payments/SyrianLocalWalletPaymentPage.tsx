import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
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
} from '../../../countries/syria/payments/localWallet'
import {
  fetchPrototypeBooking,
  getStoredGuestSession,
  submitPrototypeLocalWalletProof,
  uploadPaymentProofFile,
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
    mode: 'الدفع بالحوالة أو شام كاش',
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
    adminTitle: 'متابعة دفعتك',
    viewBooking: 'عرض الحجز',
    submittedReference: 'رقم العملية المرسل',
    proof: 'إثبات الدفع',
    hostTitle: 'حالة المضيف',
    hostUnderReview: 'الدفع قيد المراجعة',
    hostApproved: 'تم تأكيد الدفع ويمكن متابعة الحجز.',
    hostRejected: 'تم رفض الدفع. يمكن للضيف إعادة إرسال الإثبات.',
    bookingStatus: 'حالة دفع الحجز',
    manualOnly: 'يتم التحويل عبر تطبيق المحفظة أو شام كاش. ارفع صورة الإيصال هنا ويؤكده فريق SYBNB.',
    seed: 'حالة المراجعة',
    security: 'حالة الدفع',
    validationPassed: 'تم التحقق من الحقول',
    validationFailed: 'يوجد خطأ في بيانات الدفع',
    duplicateBlocked: 'منع التكرار',
    hash: 'رمز المراجعة',
    riskFlags: 'ملاحظات المخاطر',
    noRisk: 'لا توجد ملاحظات',
    lockedDecision: 'تم إغلاق القرار',
    dbStatus: 'الحالة',
    proofId: 'الرقم المرجعي',
    receipt: 'فتح الإيصال',
    dashboard: 'فتح حسابي',
    savePayment: 'حفظ معلومات الدفع',
    printPayment: 'طباعة معلومات الدفع',
    apiError: 'تعذر الاتصال بواجهة الدفع',
    saving: 'جار الحفظ',
    adminConfirmedTitle: 'تم تأكيد الدفع والحجز',
    adminConfirmedBody: 'أكدت الإدارة استلام المال ومطابقة إثبات الدفع. أصبح الحجز مؤكداً ويمكن للعميل متابعة رحلته من حسابه.',
    phoneMessageTitle: 'متابعة الحجز',
    phoneMessageBody: 'تم تأكيد حجزك في SYBNB. سجّل الدخول بالبريد الإلكتروني لمتابعة تفاصيل الحجز والرحلة حتى الانتهاء.',
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
    mode: 'Pay by bank transfer or Sham Cash',
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
    adminTitle: 'Your payment',
    viewBooking: 'View booking',
    submittedReference: 'Submitted reference',
    proof: 'Payment proof',
    hostTitle: 'Host status',
    hostUnderReview: 'Payment under review',
    hostApproved: 'Payment confirmed. Booking can continue.',
    hostRejected: 'Payment rejected. Guest can resubmit proof.',
    bookingStatus: 'Booking payment status',
    manualOnly: 'The transfer happens in your wallet or Sham Cash app. Upload your receipt here and the SYBNB team confirms it.',
    seed: 'Review status',
    security: 'Payment status',
    validationPassed: 'Fields validated',
    validationFailed: 'Payment data has an error',
    duplicateBlocked: 'Duplicate blocked',
    hash: 'Review hash',
    riskFlags: 'Risk flags',
    noRisk: 'No risk notes',
    lockedDecision: 'Decision locked',
    dbStatus: 'Status',
    proofId: 'Reference',
    receipt: 'Open receipt',
    dashboard: 'Open my account',
    savePayment: 'Save Payment Info',
    printPayment: 'Print Payment Info',
    apiError: 'Payment API request failed',
    saving: 'Saving',
    adminConfirmedTitle: 'Payment and booking confirmed',
    adminConfirmedBody: 'Admin confirmed the money was received and the proof matches. The reservation is now confirmed and the guest can continue the trip from the account.',
    phoneMessageTitle: 'Continue your booking',
    phoneMessageBody: 'Your SYBNB booking is confirmed. Sign in with your email to follow booking and trip details until completion.',
    reservationConfirmed: 'Reservation confirmed',
    adminReviewApproved: 'Admin confirmed receipt',
    continueTrip: 'Continue trip from my account',
    demoProof: 'Add quick proof for review',
    demoProofHelp: 'Adds a proof file to the request, while payment acceptance remains admin-only.',
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'Paiement par portefeuille local syrien / QR',
    subtitle: 'Envoyez la preuve de virement uniquement dans SYBNB pour que la réservation reste protégée.',
    mode: 'Paiement par virement ou Sham Cash',
    recipient: 'Destinataire',
    maskedAccount: 'Compte',
    amountDue: 'Montant dû',
    currency: 'Devise',
    qrValue: 'Numéro de paiement sous le QR',
    qrPayload: 'Contenu du QR',
    formTitle: 'Envoyer la preuve de virement',
    transactionReference: 'Référence de transaction',
    senderName: 'Nom de l’expéditeur',
    senderPhone: 'Téléphone de l’expéditeur',
    submit: 'Envoyer pour vérification',
    adminTitle: 'Votre paiement',
    viewBooking: 'Voir la réservation',
    submittedReference: 'Référence envoyée',
    proof: 'Preuve de paiement',
    hostTitle: 'Statut côté hôte',
    hostUnderReview: 'Paiement en cours de vérification',
    hostApproved: 'Paiement confirmé. La réservation peut se poursuivre.',
    hostRejected: 'Paiement refusé. Le voyageur peut renvoyer une preuve.',
    bookingStatus: 'Statut du paiement de la réservation',
    manualOnly: 'Le virement se fait dans votre application de portefeuille ou Sham Cash. Téléversez votre reçu ici et l’équipe SYBNB le confirme.',
    seed: 'Statut de la vérification',
    security: 'État du paiement',
    validationPassed: 'Champs validés',
    validationFailed: 'Les données de paiement contiennent une erreur',
    duplicateBlocked: 'Doublon bloqué',
    hash: 'Code de vérification',
    riskFlags: 'Signalements de risque',
    noRisk: 'Aucun signalement',
    lockedDecision: 'Décision verrouillée',
    dbStatus: 'Statut',
    proofId: 'Référence',
    receipt: 'Ouvrir le reçu',
    dashboard: 'Ouvrir mon compte',
    savePayment: 'Enregistrer les infos de paiement',
    printPayment: 'Imprimer les infos de paiement',
    apiError: 'La requête de paiement a échoué',
    saving: 'Enregistrement',
    adminConfirmedTitle: 'Paiement et réservation confirmés',
    adminConfirmedBody: 'L’administration a confirmé la réception des fonds et la conformité de la preuve. La réservation est maintenant confirmée et le voyageur peut suivre son voyage depuis son compte.',
    phoneMessageTitle: 'Suivre votre réservation',
    phoneMessageBody: 'Votre réservation SYBNB est confirmée. Connectez-vous avec votre courriel pour suivre les détails de la réservation et du voyage jusqu’à la fin.',
    reservationConfirmed: 'Réservation confirmée',
    adminReviewApproved: 'Réception confirmée par l’administration',
    continueTrip: 'Suivre le voyage depuis mon compte',
    demoProof: 'Ajouter une preuve rapide pour vérification',
    demoProofHelp: 'Ajoute un fichier de preuve à la demande; l’acceptation du paiement reste réservée à l’administration.',
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
  fr: {
    PENDING_REVIEW: 'En attente de vérification',
    APPROVED: 'Approuvé',
    REJECTED: 'Refusé',
  },
}

export function SyrianLocalWalletPaymentPage({ lang, bookingId = 'BK-2026-0042', amountMinor = 10, currency = 'SYP' }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const defaultTransactionReference = `SLW-${bookingId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`
  const [transactionReference, setTransactionReference] = useState(defaultTransactionReference)
  // Start blank so the guest enters their REAL sender name/phone — a pre-filled placeholder ("SYBNB
  // Guest", a dummy number) left unedited gives the admin meaningless data to reconcile against.
  const [senderName, setSenderName] = useState('')
  const [senderPhone, setSenderPhone] = useState('')
  const [uploadedProofFiles, setUploadedProofFiles] = useState<string[]>([])
  // Real uploaded proof URLs (payment-proof:// references), parallel to uploadedProofFiles' names —
  // the last one wins as the proof actually sent to admin. Previously this whole flow only ever
  // captured the file's NAME, so admin had nothing real to review before releasing money.
  const [uploadedProofUrls, setUploadedProofUrls] = useState<string[]>([])
  const [proofUploadError, setProofUploadError] = useState('')
  const [submission, setSubmission] = useState<SyrianLocalWalletSubmission>(() =>
    createSyrianLocalWalletSubmission({
      bookingId,
      userId: 'USR-LOCAL-WALLET-001',
      amount: Math.max(Number(amountMinor || 10), 1),
      transactionReference: defaultTransactionReference,
      senderName: '',
      senderPhone: '',
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
  // Real uploaded file reference sent to admin — falls back to the old name-only reference only if
  // an upload is still in flight (validation below requires at least one real URL to submit).
  const proofReference = uploadedProofUrls[0] || paymentProofReference('local-wallet-proof', uploadedProofFiles)
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
  const canSubmitProof = validation.ok && uploadedProofUrls.length > 0

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
        proofAssetUrls: uploadedProofUrls,
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

  async function addProofFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const session = getStoredGuestSession()
    if (!session) {
      setProofUploadError(pick(lang, 'سجّل الدخول أولاً لرفع إثبات الدفع.', 'Sign in first to upload payment proof.', 'Connectez-vous d’abord pour téléverser la preuve de paiement.'))
      return
    }
    setProofUploadError('')
    setUploadedProofFiles((current) => Array.from(new Set([...current, ...files.map((file) => file.name)])))
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setUploadedProofUrls((current) => [...current, ...urls])
    } catch (error) {
      setProofUploadError(error instanceof Error ? error.message : t.apiError)
    }
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
      <section style={flowStyles.nav} aria-label={pick(lang, 'التنقل بين الخطوات', 'Step navigation', 'Navigation entre les étapes')}>
        <button style={flowStyles.arrow} onClick={() => (window.location.hash = `/booking/${bookingId}`)} aria-label={pick(lang, 'السابق', 'Back', 'Précédent')}>
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
          aria-label={pick(lang, 'التالي', 'Next', 'Suivant')}
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
        methodLabel={pick(lang, 'محفظة محلية / شام كاش', 'Local wallet / Sham Cash', 'Portefeuille local / Sham Cash')}
        amountLabel={moneyText(amountDue, currency, lang)}
        destinationCode={transactionReference}
        followCode={bookingId}
        proofCount={uploadedProofFiles.length}
        status={capsuleStatus}
      />

      <section className="wallet-card wallet-actions" aria-label={pick(lang, 'حفظ وطباعة معلومات الدفع', 'Save and print payment information', 'Enregistrer et imprimer les informations de paiement')}>
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
          <PaymentProofUpload lang={lang} files={uploadedProofFiles} onAddFiles={(files) => void addProofFiles(files)} />
          {proofUploadError && <p className="wallet-note" style={{ color: '#ff5f76' }}>{proofUploadError}</p>}
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
