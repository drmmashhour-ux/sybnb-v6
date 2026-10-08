import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { pick, text, type Lang } from '../../engines/language/languageEngine'
import {
  canSendPaymentGateForReview,
  canStartPaymentGate,
  canUploadPaymentGateProof,
  createPlatformPaymentQrPayload,
  createStripeReference,
  normalizePaymentGateMethod,
  platformPaymentGateMethods,
} from '../../engines/payments/platformPaymentGate'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import { fetchSellerOverview, getStoredSellerSession, submitSellerPlanProof, uploadPaymentProofFile } from '../../shared/api/platformApi'
import { PaymentCapsule } from '../payments/PaymentCapsule'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'

type Props = {
  lang: Lang
  methodId: string
}

const AD_FOLLOW_CODE_STORAGE_KEY = 'sybnb_v6_ad_follow_code'
const AD_PLAN_STORAGE_KEY = 'sybnb_v6_advertising_plan'
const AD_PAYMENT_FILES_STORAGE_KEY = 'sybnb_v6_ad_payment_files'

function readFollowCode() {
  const stored = window.sessionStorage.getItem(AD_FOLLOW_CODE_STORAGE_KEY)
  if (stored) return stored
  const next = `ADV-${`${Date.now()}`.slice(-6)}`
  window.sessionStorage.setItem(AD_FOLLOW_CODE_STORAGE_KEY, next)
  return next
}

function readStoredPaymentFiles(key: string) {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function SellerAdvertisingPaymentPage({ lang, methodId }: Props) {
  const isAr = lang === 'ar'
  const methodKey = normalizePaymentGateMethod(methodId)
  const method = platformPaymentGateMethods[methodKey]
  const followCode = useMemo(() => readFollowCode(), [])
  const paymentFilesStorageKey = useMemo(() => `${AD_PAYMENT_FILES_STORAGE_KEY}:${followCode}:${methodKey}`, [followCode, methodKey])
  const storedPlan = window.localStorage.getItem(AD_PLAN_STORAGE_KEY)
  const amountMinor = storedPlan === 'premium' ? 4900 : 1900
  const amountLabel = storedPlan === 'premium' ? '$49' : '$19'
  // Distinct per-tier plan codes (not a single 'advertising' code for both) so the server's price
  // catalog (server/routes/payments.mjs) can validate the submitted amount against the real price
  // for the tier actually chosen, and so admin can tell plans apart in review.
  const planCode = storedPlan === 'premium' ? 'advertising-premium' : 'advertising-plus'
  const currency = 'USD'
  const [amountConfirmed, setAmountConfirmed] = useState(false)
  const [paymentStarted, setPaymentStarted] = useState(false)
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentUploadedFiles, setPaymentUploadedFiles] = useState<string[]>(() => readStoredPaymentFiles(paymentFilesStorageKey))
  const [proofUploaded, setProofUploaded] = useState(() => readStoredPaymentFiles(paymentFilesStorageKey).length > 0)
  // Real uploaded proof URL — previously only file NAMES were captured, so admin had nothing real to
  // review before approving an advertising payment.
  const [paymentProofUrls, setPaymentProofUrls] = useState<string[]>([])
  const [proofUploadError, setProofUploadError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [stripeSucceeded, setStripeSucceeded] = useState(false)
  // Real, backend-verified review status — replaces the old client-only sessionStorage proof
  // that only "admin" reviewers on the same browser tab could ever see.
  const [sellerProfileStatus, setSellerProfileStatus] = useState<string | null>(null)
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [submitError, setSubmitError] = useState('')

  const title = text(method.label, lang)
  const hasPaymentReference = paymentReference.trim().length >= 4
  const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''
  const stripeConfigured = method.usesStripe ? stripePublishableKey.length > 0 : true
  const canStartPayment = canStartPaymentGate({ amountConfirmed })
  const canUploadProof = canUploadPaymentGateProof({
    hasPaymentReference,
    paymentStarted,
    requiresExternalProof: method.requiresExternalProof,
  })
  const canSendToAdmin =
    sellerProfileStatus !== 'PENDING_REVIEW' &&
    sellerProfileStatus !== 'APPROVED' &&
    // An external-proof method must have a REAL uploaded proof asset, not just a stale 'uploaded'
    // flag (which can survive a failed upload or a reload with only file names persisted).
    (!method.requiresExternalProof || paymentProofUrls.length > 0) &&
    canSendPaymentGateForReview({
      hasPaymentReference,
      paymentSucceeded: method.usesStripe ? stripeSucceeded : false,
      proofUploaded,
      requiresExternalProof: method.requiresExternalProof,
    })
  const capsuleStatus =
    sellerProfileStatus === 'APPROVED'
      ? 'confirmed'
      : sellerProfileStatus === 'PENDING_REVIEW'
        ? 'admin'
        : proofUploaded
          ? 'proof'
          : paymentStarted
            ? 'ready'
            : 'locked'

  async function refreshStatus() {
    try {
      const overview = await fetchSellerOverview()
      setSellerProfileStatus(overview.sellerProfile?.documentStatus ?? null)
    } catch {
      // No seller session yet, or the request failed — leave status as-is.
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [])
  const qrPayload = useMemo(
    () =>
      createPlatformPaymentQrPayload({
        amountMinor,
        currency,
        destinationCode: method.destinationCode,
        followCode,
        provider: method.provider,
        purpose: 'advertising_plan',
      }),
    [amountMinor, currency, followCode, method.destinationCode, method.provider],
  )

  useEffect(() => {
    const storedFiles = readStoredPaymentFiles(paymentFilesStorageKey)
    setAmountConfirmed(false)
    setPaymentStarted(false)
    setPaymentReference('')
    setPaymentUploadedFiles(storedFiles)
    setProofUploaded(storedFiles.length > 0)
    setStripeSucceeded(false)
  }, [methodKey, paymentFilesStorageKey])

  useEffect(() => {
    if (methodKey !== 'shamCash') return
    let cancelled = false

    void QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
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
  }, [methodKey, qrPayload])

  const paymentSteps = [
    { label: pick(lang, 'تأكيد المبلغ', 'Confirm amount', 'Confirmer le montant'), done: amountConfirmed },
    { label: pick(lang, 'الدفع وإدخال المرجع', 'Pay and enter reference', 'Payer et saisir la référence'), done: paymentStarted && hasPaymentReference },
    { label: pick(lang, 'رفع تأكيد الدفع والملفات', 'Upload payment confirmation and files', 'Téléverser la confirmation de paiement et les fichiers'), done: proofUploaded },
    { label: pick(lang, 'مراجعة الإدارة قبل النشر', 'Admin review before publishing', 'Vérification par l’administration avant publication'), done: false },
  ]

  async function addPaymentFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (files.length === 0) return

    const nextFiles = [...paymentUploadedFiles, ...files.map((file) => file.name)]
    setPaymentUploadedFiles(nextFiles)
    window.sessionStorage.setItem(paymentFilesStorageKey, JSON.stringify(nextFiles))

    const session = getStoredSellerSession()
    if (!session) {
      setProofUploadError(pick(lang, 'سجّل الدخول أولاً لرفع إثبات الدفع.', 'Sign in first to upload payment proof.', 'Connectez-vous d’abord pour téléverser la preuve de paiement.'))
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      // Only mark the proof as uploaded once a REAL asset URL exists (previously set true before the
      // upload, so a failed upload still let the request be 'sent to admin' with no document).
      setPaymentProofUrls((current) => {
        const merged = [...current, ...urls]
        setProofUploaded(merged.length > 0)
        return merged
      })
      setProofUploadError('')
    } catch (error) {
      setProofUploadError(error instanceof Error ? error.message : (pick(lang, 'تعذر رفع الملف.', 'Could not upload the file.', 'Impossible de téléverser le fichier.')))
    }
  }

  async function submitForReview() {
    const reference = paymentReference.trim() || `${method.destinationCode}-${followCode}`
    // Never submit an external-proof payment without a real uploaded proof asset. The server drops
    // a non-'payment-proof://' placeholder, which would create an admin review with no document.
    if (method.requiresExternalProof && paymentProofUrls.length === 0) {
      setSubmitState('error')
      setSubmitError(pick(lang, 'ارفع إثبات الدفع الحقيقي قبل الإرسال.', 'Upload a real payment proof before submitting.', 'Téléversez une véritable preuve de paiement avant l’envoi.'))
      return
    }
    setSubmitState('saving')
    setSubmitError('')

    try {
      await submitSellerPlanProof({
        amountMinor,
        currency: 'USD',
        providerRef: reference,
        proofAssetUrl: paymentProofUrls[0] || undefined,
        proofAssetUrls: paymentProofUrls,
        planCode,
        sellerType: 'advertising',
      })
      setPaymentReference(reference)
      await refreshStatus()
      setSubmitState('idle')
      navigate('/sell/submitted')
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : pick(lang, 'تعذر إرسال الطلب للمراجعة.', 'Could not submit the request for review.', 'Impossible d’envoyer la demande pour vérification.'))
    }
  }

  return (
    <main className="seller-page seller-payment-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-account-head">
        <button className="back-button seller-back" onClick={() => navigate('/advertising/account')}>
          {pick(lang, 'العودة للحساب', 'Back to account', 'Retour au compte')}
        </button>
        <BrandLogo logo="plus" size="nav" />
      </section>

      <section className="seller-financial-panel">
        <p className="eyebrow">{pick(lang, 'صفحة الدفع المالية', 'Financial payment page', 'Page de paiement')}</p>
        <h1>{title}</h1>
        <p>{pick(lang, 'راجع المبلغ، أكّد الدفع، ثم ارفع إثبات العملية للإدارة.', 'Review the amount, pay, then upload the proof for admin review.', 'Vérifiez le montant, payez, puis téléversez la preuve pour vérification par l’administration.')}</p>

        <div className="seller-payment-amount-box">
          <div>
            <span>{pick(lang, 'المبلغ المطلوب', 'Payment amount', 'Montant du paiement')}</span>
            <strong>{amountLabel}</strong>
          </div>
          <label>
            <input checked={amountConfirmed} type="checkbox" onChange={(event) => setAmountConfirmed(event.target.checked)} />
            <span>{pick(lang, 'أؤكد أن المبلغ صحيح قبل الدفع', 'I confirm this amount before paying', 'Je confirme ce montant avant de payer')}</span>
          </label>
        </div>

        <div className="seller-payment-destination">
          <span>{text(method.codeTitle, lang)}</span>
          <strong dir="ltr">{method.destinationCode}</strong>
          <small>
            {pick(lang, 'كود المتابعة:', 'Follow-up code:', 'Code de suivi :')} <b dir="ltr">{followCode}</b>
          </small>
        </div>

        <PaymentCapsule
          amountLabel={amountLabel}
          destinationCode={method.destinationCode}
          followCode={followCode}
          lang={lang}
          methodLabel={text(method.label, lang)}
          proofCount={paymentUploadedFiles.length}
          status={capsuleStatus}
        />

        {methodKey === 'shamCash' && (
          <div className="seller-sham-qr-panel">
            {qrDataUrl ? (
              <img className="seller-sham-qr" src={qrDataUrl} alt={pick(lang, 'رمز QR شام كاش للدفع', 'Sham Cash payment QR code', 'Code QR de paiement Sham Cash')} />
            ) : (
              <div className="seller-sham-qr seller-sham-qr-loading" aria-label={pick(lang, 'جار إنشاء QR شام كاش', 'Generating Sham Cash QR', 'Génération du code QR Sham Cash')} />
            )}
            <div>
              <strong>{pick(lang, 'امسح QR للدفع', 'Scan QR to pay', 'Scannez le code QR pour payer')}</strong>
              <span dir="ltr">{method.destinationCode}</span>
              <small>{pick(lang, 'اكتب كود المتابعة في ملاحظة العملية.', 'Write the follow-up code in the transaction note.', 'Inscrivez le code de suivi dans la note de la transaction.')}</small>
            </div>
          </div>
        )}

        {methodKey === 'creditCard' && (
          <div className="seller-stripe-panel">
            <strong>{pick(lang, 'بوابة Stripe الآمنة', 'Secure Stripe gateway', 'Passerelle sécurisée Stripe')}</strong>
            <span>
              {pick(lang, 'إدخال بيانات البطاقة يتم داخل Stripe فقط، وخدمة الإعلان لا تعمل قبل رفع تأكيد الدفع وموافقة الإدارة.', 'Card entry happens inside Stripe only, and the advertising service does not run before payment confirmation upload and admin approval.', 'La saisie de la carte se fait uniquement dans Stripe, et le service publicitaire ne démarre pas avant le téléversement de la confirmation de paiement et l’approbation de l’administration.')}
            </span>
            <small>{pick(lang, 'مفتاح التشغيل:', 'Runtime key:', 'Clé d’exécution :')} <b dir="ltr">VITE_STRIPE_PUBLISHABLE_KEY</b></small>
            {!stripeConfigured && (
              <em>
                {pick(lang, 'Stripe غير متصل الآن. لا يتم تشغيل الإعلان قبل رفع تأكيد الدفع وموافقة الإدارة.', 'Stripe is not connected yet. The ad will not run before payment confirmation upload and admin approval.', 'Stripe n’est pas encore connecté. L’annonce ne sera pas diffusée avant le téléversement de la confirmation de paiement et l’approbation de l’administration.')}
              </em>
            )}
          </div>
        )}

        <label className="seller-payment-reference">
          <small>{pick(lang, 'رقم العملية / المرجع', 'Transaction / reference number', 'Numéro de transaction / de référence')}</small>
          <input dir="ltr" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder={`${method.destinationCode}-${followCode}`} />
        </label>

        <div className="seller-payment-lock-note">
          <strong>{pick(lang, 'قفل أمان الدفع', 'Payment safety lock', 'Verrou de sécurité du paiement')}</strong>
          <span>
            {pick(lang, 'لا يتم تشغيل الإعلان أو نشر الخدمة قبل إدخال مرجع الدفع، رفع تأكيد الدفع، وتحقق الإدارة من استلام المال.', 'The ad/service will not run before a payment reference, uploaded payment confirmation, and admin verification that money was received.', 'L’annonce ou le service ne démarrera pas sans une référence de paiement, une confirmation de paiement téléversée et la vérification par l’administration de la réception des fonds.')}
          </span>
        </div>

        <button
          className="seller-pay-now-button seller-primary-button"
          disabled={!canStartPayment}
          onClick={() => {
            setPaymentStarted(true)
            if (methodKey === 'creditCard') {
              // Record a reference for the proof flow only. A card payment is NEVER "confirmed"
              // from client state — real Stripe confirmation is server-verified (not yet enabled),
              // so this must not assert success. The ad still requires proof upload + admin review.
              const stripeReference = createStripeReference(followCode)
              setPaymentReference((current) => current || stripeReference)
            }
          }}
        >
          {paymentStarted
            ? pick(lang, 'تم فتح مسار الدفع', 'Payment route opened', 'Parcours de paiement ouvert')
            : methodKey === 'creditCard'
              ? stripeConfigured
                ? pick(lang, 'فتح Stripe Checkout', 'Open Stripe Checkout', 'Ouvrir Stripe Checkout')
                : pick(lang, 'تسجيل مرجع Stripe', 'Record Stripe reference', 'Enregistrer la référence Stripe')
              : pick(lang, 'ادفع الآن', 'Pay now', 'Payer maintenant')}
        </button>

        <div className="seller-payment-documents">
          {method.usesStripe && (
            <div className="seller-stripe-result">
              <strong>{pick(lang, 'بانتظار مراجعة الدفع', 'Waiting for payment review', 'En attente de vérification du paiement')}</strong>
              <span>
                {pick(lang, 'ارفع تأكيد Stripe أو إيصال الدفع، ثم أرسله للإدارة. الإدارة توافق فقط بعد التأكد من استلام المال.', 'Upload the Stripe confirmation or payment receipt, then send it to admin. Admin approves only after confirming money was received.', 'Téléversez la confirmation Stripe ou le reçu de paiement, puis envoyez-le à l’administration. L’administration n’approuve qu’après avoir confirmé la réception des fonds.')}
              </span>
            </div>
          )}
          <PaymentProofUpload
            cta={pick(lang, 'رفع تأكيد الدفع والمستندات', 'Upload payment confirmation and documents', 'Téléverser la confirmation de paiement et les documents')}
            disabled={!canUploadProof}
            emptyText={pick(lang, 'لم يتم رفع أي ملف بعد. ارفع إثبات الدفع أو مستند الإعلان بصيغة PDF أو PNG أو JPG.', 'No files uploaded yet. Upload payment proof or advertising documents as PDF, PNG, or JPG.', 'Aucun fichier téléversé pour l’instant. Téléversez la preuve de paiement ou les documents publicitaires en PDF, PNG ou JPG.')}
            files={paymentUploadedFiles}
            help={pick(lang, 'ارفع إيصال الدفع، تأكيد Stripe، أو مستند الإعلان. يمكن رفع أكثر من ملف.', 'Upload the receipt, Stripe confirmation, or advertising documents. Multiple files are allowed.', 'Téléversez le reçu, la confirmation Stripe ou les documents publicitaires. Plusieurs fichiers sont acceptés.')}
            lang={lang}
            onAddFiles={(files) => void addPaymentFiles(files)}
            title={pick(lang, 'مكان رفع المستندات', 'Document upload place', 'Zone de téléversement des documents')}
          />
          <div className="seller-payment-step-list">
            {paymentSteps.map((step) => (
              <span className={step.done ? 'active' : ''} key={step.label}>
                {step.label}
              </span>
            ))}
          </div>
        </div>

        {submitState === 'error' && <small className="seller-plan-error">{submitError}</small>}
        {sellerProfileStatus === 'PENDING_REVIEW' ? (
          <div className="seller-admin-waiting-panel">
            <strong>{pick(lang, 'بانتظار مراجعة الإدارة', 'Waiting for admin review', 'En attente de vérification par l’administration')}</strong>
            <span>
              {pick(lang, 'تم إرسال الطلب لفريق SYBNB الحقيقي. الإدارة توافق فقط بعد التأكد من استلام المال.', 'The request was sent to the real SYBNB team. Admin approves only after confirming money was received.', 'La demande a été envoyée à l’équipe SYBNB. L’administration n’approuve qu’après avoir confirmé la réception des fonds.')}
            </span>
            <button type="button" onClick={() => void refreshStatus()}>
              {pick(lang, 'تحديث حالة المراجعة', 'Refresh review status', 'Actualiser le statut de la vérification')}
            </button>
          </div>
        ) : sellerProfileStatus === 'APPROVED' ? (
          <div className="seller-admin-waiting-panel confirmed">
            <strong>{pick(lang, 'تم تأكيد الدفع من الإدارة', 'Payment confirmed by admin', 'Paiement confirmé par l’administration')}</strong>
          </div>
        ) : (
          <button className="seller-primary-button" disabled={!canSendToAdmin || submitState === 'saving'} onClick={() => void submitForReview()}>
            {submitState === 'saving' ? (pick(lang, 'جارٍ الإرسال...', 'Submitting...', 'Envoi...')) : pick(lang, 'إرسال للإدارة', 'Send to admin', 'Envoyer à l’administration')}
          </button>
        )}
      </section>
    </main>
  )
}
