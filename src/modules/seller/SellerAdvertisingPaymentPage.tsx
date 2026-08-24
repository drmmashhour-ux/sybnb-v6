import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
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
import { PaymentProofUpload, paymentProofReference } from '../payments/PaymentProofUpload'

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

  const title = method.label[lang]
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
    { label: isAr ? 'تأكيد المبلغ' : 'Confirm amount', done: amountConfirmed },
    { label: isAr ? 'الدفع وإدخال المرجع' : 'Pay and enter reference', done: paymentStarted && hasPaymentReference },
    { label: isAr ? 'رفع تأكيد الدفع والملفات' : 'Upload payment confirmation and files', done: proofUploaded },
    { label: isAr ? 'مراجعة الإدارة قبل النشر' : 'Admin review before publishing', done: false },
  ]

  async function addPaymentFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (files.length === 0) return

    const nextFiles = [...paymentUploadedFiles, ...files.map((file) => file.name)]
    setPaymentUploadedFiles(nextFiles)
    setProofUploaded(true)
    window.sessionStorage.setItem(paymentFilesStorageKey, JSON.stringify(nextFiles))

    const session = getStoredSellerSession()
    if (!session) {
      setProofUploadError(isAr ? 'سجّل الدخول أولاً لرفع إثبات الدفع.' : 'Sign in first to upload payment proof.')
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setPaymentProofUrls((current) => [...current, ...urls])
      setProofUploadError('')
    } catch (error) {
      setProofUploadError(error instanceof Error ? error.message : (isAr ? 'تعذر رفع الملف.' : 'Could not upload the file.'))
    }
  }

  async function submitForReview() {
    const reference = paymentReference.trim() || `${method.destinationCode}-${followCode}`
    setSubmitState('saving')
    setSubmitError('')

    try {
      await submitSellerPlanProof({
        amountMinor,
        currency: 'USD',
        providerRef: reference,
        proofAssetUrl: paymentProofUrls[0] || paymentProofReference('advertising-payment-proof', paymentUploadedFiles),
        proofAssetUrls: paymentProofUrls,
        planCode: 'advertising',
        sellerType: 'advertising',
      })
      setPaymentReference(reference)
      await refreshStatus()
      setSubmitState('idle')
      navigate('/sell/submitted')
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : isAr ? 'تعذر إرسال الطلب للمراجعة.' : 'Could not submit the request for review.')
    }
  }

  return (
    <main className="seller-page seller-payment-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-account-head">
        <button className="back-button seller-back" onClick={() => navigate('/advertising/account')}>
          {isAr ? 'العودة للحساب' : 'Back to account'}
        </button>
        <BrandLogo logo="plus" size="nav" />
      </section>

      <section className="seller-financial-panel">
        <p className="eyebrow">{isAr ? 'صفحة الدفع المالية' : 'Financial payment page'}</p>
        <h1>{title}</h1>
        <p>{isAr ? 'راجع المبلغ، أكّد الدفع، ثم ارفع إثبات العملية للإدارة.' : 'Review the amount, pay, then upload the proof for admin review.'}</p>

        <div className="seller-payment-amount-box">
          <div>
            <span>{isAr ? 'المبلغ المطلوب' : 'Payment amount'}</span>
            <strong>{amountLabel}</strong>
          </div>
          <label>
            <input checked={amountConfirmed} type="checkbox" onChange={(event) => setAmountConfirmed(event.target.checked)} />
            <span>{isAr ? 'أؤكد أن المبلغ صحيح قبل الدفع' : 'I confirm this amount before paying'}</span>
          </label>
        </div>

        <div className="seller-payment-destination">
          <span>{method.codeTitle[lang]}</span>
          <strong dir="ltr">{method.destinationCode}</strong>
          <small>
            {isAr ? 'كود المتابعة:' : 'Follow-up code:'} <b dir="ltr">{followCode}</b>
          </small>
        </div>

        <PaymentCapsule
          amountLabel={amountLabel}
          destinationCode={method.destinationCode}
          followCode={followCode}
          lang={lang}
          methodLabel={method.label[lang]}
          proofCount={paymentUploadedFiles.length}
          status={capsuleStatus}
        />

        {methodKey === 'shamCash' && (
          <div className="seller-sham-qr-panel">
            {qrDataUrl ? (
              <img className="seller-sham-qr" src={qrDataUrl} alt={isAr ? 'رمز QR شام كاش للدفع' : 'Sham Cash payment QR code'} />
            ) : (
              <div className="seller-sham-qr seller-sham-qr-loading" aria-label={isAr ? 'جار إنشاء QR شام كاش' : 'Generating Sham Cash QR'} />
            )}
            <div>
              <strong>{isAr ? 'امسح QR للدفع' : 'Scan QR to pay'}</strong>
              <span dir="ltr">{method.destinationCode}</span>
              <small>{isAr ? 'اكتب كود المتابعة في ملاحظة العملية.' : 'Write the follow-up code in the transaction note.'}</small>
            </div>
          </div>
        )}

        {methodKey === 'creditCard' && (
          <div className="seller-stripe-panel">
            <strong>{isAr ? 'بوابة Stripe الآمنة' : 'Secure Stripe gateway'}</strong>
            <span>
              {isAr
                ? 'إدخال بيانات البطاقة يتم داخل Stripe فقط، وخدمة الإعلان لا تعمل قبل رفع تأكيد الدفع وموافقة الإدارة.'
                : 'Card entry happens inside Stripe only, and the advertising service does not run before payment confirmation upload and admin approval.'}
            </span>
            <small>{isAr ? 'مفتاح التشغيل:' : 'Runtime key:'} <b dir="ltr">VITE_STRIPE_PUBLISHABLE_KEY</b></small>
            {!stripeConfigured && (
              <em>
                {isAr
                  ? 'Stripe غير متصل الآن. لا يتم تشغيل الإعلان قبل رفع تأكيد الدفع وموافقة الإدارة.'
                  : 'Stripe is not connected yet. The ad will not run before payment confirmation upload and admin approval.'}
              </em>
            )}
          </div>
        )}

        <label className="seller-payment-reference">
          <small>{isAr ? 'رقم العملية / المرجع' : 'Transaction / reference number'}</small>
          <input dir="ltr" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder={`${method.destinationCode}-${followCode}`} />
        </label>

        <div className="seller-payment-lock-note">
          <strong>{isAr ? 'قفل أمان الدفع' : 'Payment safety lock'}</strong>
          <span>
            {isAr
              ? 'لا يتم تشغيل الإعلان أو نشر الخدمة قبل إدخال مرجع الدفع، رفع تأكيد الدفع، وتحقق الإدارة من استلام المال.'
              : 'The ad/service will not run before a payment reference, uploaded payment confirmation, and admin verification that money was received.'}
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
            ? isAr
              ? 'تم فتح مسار الدفع'
              : 'Payment route opened'
            : methodKey === 'creditCard'
              ? stripeConfigured
                ? isAr
                  ? 'فتح Stripe Checkout'
                  : 'Open Stripe Checkout'
                : isAr
                  ? 'تسجيل مرجع Stripe'
                  : 'Record Stripe reference'
              : isAr
                ? 'ادفع الآن'
                : 'Pay now'}
        </button>

        <div className="seller-payment-documents">
          {method.usesStripe && (
            <div className="seller-stripe-result">
              <strong>{isAr ? 'بانتظار مراجعة الدفع' : 'Waiting for payment review'}</strong>
              <span>
                {isAr
                  ? 'ارفع تأكيد Stripe أو إيصال الدفع، ثم أرسله للإدارة. الإدارة توافق فقط بعد التأكد من استلام المال.'
                  : 'Upload the Stripe confirmation or payment receipt, then send it to admin. Admin approves only after confirming money was received.'}
              </span>
            </div>
          )}
          <PaymentProofUpload
            cta={isAr ? 'رفع تأكيد الدفع والمستندات' : 'Upload payment confirmation and documents'}
            disabled={!canUploadProof}
            emptyText={isAr ? 'لم يتم رفع أي ملف بعد. ارفع إثبات الدفع أو مستند الإعلان بصيغة PDF أو PNG أو JPG.' : 'No files uploaded yet. Upload payment proof or advertising documents as PDF, PNG, or JPG.'}
            files={paymentUploadedFiles}
            help={isAr ? 'ارفع إيصال الدفع، تأكيد Stripe، أو مستند الإعلان. يمكن رفع أكثر من ملف.' : 'Upload the receipt, Stripe confirmation, or advertising documents. Multiple files are allowed.'}
            lang={lang}
            onAddFiles={(files) => void addPaymentFiles(files)}
            title={isAr ? 'مكان رفع المستندات' : 'Document upload place'}
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
            <strong>{isAr ? 'بانتظار مراجعة الإدارة' : 'Waiting for admin review'}</strong>
            <span>
              {isAr
                ? 'تم إرسال الطلب لفريق SYBNB الحقيقي. الإدارة توافق فقط بعد التأكد من استلام المال.'
                : 'The request was sent to the real SYBNB team. Admin approves only after confirming money was received.'}
            </span>
            <button type="button" onClick={() => void refreshStatus()}>
              {isAr ? 'تحديث حالة المراجعة' : 'Refresh review status'}
            </button>
          </div>
        ) : sellerProfileStatus === 'APPROVED' ? (
          <div className="seller-admin-waiting-panel confirmed">
            <strong>{isAr ? 'تم تأكيد الدفع من الإدارة' : 'Payment confirmed by admin'}</strong>
          </div>
        ) : (
          <button className="seller-primary-button" disabled={!canSendToAdmin || submitState === 'saving'} onClick={() => void submitForReview()}>
            {submitState === 'saving' ? (isAr ? 'جارٍ الإرسال...' : 'Submitting...') : isAr ? 'إرسال للإدارة' : 'Send to admin'}
          </button>
        )}
      </section>
    </main>
  )
}
