import { useEffect, useMemo, useState } from 'react'
import { phonePlaceholder } from '../../shared/country/presentation'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import {
  confirmOtp,
  createSellerAccountSession,
  fetchSellerOverview,
  getStoredSellerSession,
  requestOtp,
  submitSellerPlanProof,
} from '../../shared/api/platformApi'
import { SELLER_PLANS, pickSellerRole } from './sellerData'
import type { SellerPlanId } from './sellerData'
import type { CSSVars } from '../../shared/theme/cssVars'
import { PaymentCapsule } from '../payments/PaymentCapsule'
import { PaymentProofUpload, paymentProofReference } from '../payments/PaymentProofUpload'

type Props = {
  flow?: 'advertising' | 'listing' | 'platform-sale'
  lang: Lang
}

const ROLE_STORAGE_KEY = 'sybnb_v6_selected_seller_role'
const FLOW_STORAGE_KEY = 'sybnb_v6_sell_flow'
const AD_PLAN_STORAGE_KEY = 'sybnb_v6_advertising_plan'
const AD_FOLLOW_CODE_STORAGE_KEY = 'sybnb_v6_ad_follow_code'
const AD_UPLOADED_FILES_STORAGE_KEY = 'sybnb_v6_ad_uploaded_files'
const AD_BUSINESS_TYPE_STORAGE_KEY = 'sybnb_v6_ad_business_type'
const AD_BUSINESS_TYPES = [
  {
    id: 'restaurant',
    label: { ar: 'مطعم', en: 'Restaurant' },
    helper: { ar: 'صور المطعم، المنيو، اللوغو، السجل أو الترخيص.', en: 'Restaurant photos, menu, logo, commercial record or license.' },
  },
  {
    id: 'hotel',
    label: { ar: 'فندق / ضيافة', en: 'Hotel / hospitality' },
    helper: { ar: 'صور الغرف والخدمات وترخيص المنشأة.', en: 'Room photos, service photos, and business license.' },
  },
  {
    id: 'market',
    label: { ar: 'متجر / سوق', en: 'Shop / marketplace' },
    helper: { ar: 'صور المنتجات، الشعار، وسجل النشاط.', en: 'Product photos, logo, and business registration.' },
  },
  {
    id: 'cars',
    label: { ar: 'سيارات / وكيل', en: 'Cars / dealer' },
    helper: { ar: 'صور السيارات، رخصة المعرض أو الوكيل، السجل، وملفات المركبات.', en: 'Car photos, showroom or dealer license, registration, and vehicle files.' },
  },
  {
    id: 'newProject',
    label: { ar: 'مشروع جديد', en: 'New project' },
    helper: { ar: 'صور المشروع، المخططات، رخص البناء، التفويض، وملفات الوحدات.', en: 'Project photos, plans, building permits, authorization, and unit files.' },
  },
  {
    id: 'service',
    label: { ar: 'خدمات', en: 'Services' },
    helper: { ar: 'وصف الخدمة، صور العمل، وسجل النشاط.', en: 'Service description, work photos, and business registration.' },
  },
] as const
const SELLER_PAYMENT_METHODS = [
  {
    id: 'shamCash',
    label: { ar: 'Sham Cash', en: 'Sham Cash' },
    helper: { ar: 'ادفع عبر شام كاش ثم أكّد مرجع العملية.', en: 'Pay via Sham Cash, then confirm the transaction reference.' },
    destinationTitle: { ar: 'كود شام كاش للدفع', en: 'Sham Cash payment code' },
    destinationCode: 'SYBNB-SHAM-ADV',
    destinationHint: {
      ar: 'ادفع لهذا الكود، واكتب كود المتابعة في ملاحظة العملية.',
      en: 'Pay to this code and write the follow-up code in the transaction note.',
    },
  },
  {
    id: 'localWallet',
    label: { ar: 'المحفظة المحلية السورية', en: 'Syrian Local Wallet' },
    helper: { ar: 'ادفع من المحفظة ثم أكّد أن الدفعة تمت.', en: 'Pay from the local wallet, then confirm payment was completed.' },
    destinationTitle: { ar: 'كود المحفظة المحلية', en: 'Local wallet code' },
    destinationCode: 'SYBNB-WALLET-ADV',
    destinationHint: {
      ar: 'حوّل للمحفظة ثم ارفع صورة تأكيد الدفع.',
      en: 'Transfer to the wallet, then upload the payment confirmation image.',
    },
  },
  {
    id: 'bankTransfer',
    label: { ar: 'تحويل بنكي', en: 'Bank transfer' },
    helper: { ar: 'حوّل المبلغ ثم احتفظ بإثبات الدفع للرفع في الخطوة التالية.', en: 'Transfer the amount and keep the proof for the next upload step.' },
    destinationTitle: { ar: 'مرجع التحويل البنكي', en: 'Bank transfer reference' },
    destinationCode: 'SYBNB-BANK-ADV',
    destinationHint: {
      ar: 'اكتب كود المتابعة في سبب التحويل.',
      en: 'Write the follow-up code in the transfer reason.',
    },
  },
  {
    id: 'creditCard',
    label: { ar: 'بطاقة ائتمان', en: 'Credit card' },
    helper: { ar: 'ادفع بالبطاقة ثم انتقل لرفع ملفات العقار.', en: 'Pay by card, then continue to upload property files.' },
    destinationTitle: { ar: 'مرجع بوابة البطاقة', en: 'Card gateway reference' },
    destinationCode: 'SYBNB-CARD-ADV',
    destinationHint: {
      ar: 'استخدم هذا المرجع في صفحة الدفع الآمن.',
      en: 'Use this reference in the secure card payment page.',
    },
  },
] as const

type SellerPaymentMethodId = (typeof SELLER_PAYMENT_METHODS)[number]['id']
type AdvertisingBusinessTypeId = (typeof AD_BUSINESS_TYPES)[number]['id']

function pickAdvertisingBusinessType(value: string | null) {
  return AD_BUSINESS_TYPES.find((item) => item.id === value) ?? AD_BUSINESS_TYPES[0]
}

function createAdminFollowCode() {
  const suffix = `${Date.now()}`.slice(-6)
  return `ADV-${suffix}`
}


function readStoredFollowCode() {
  const stored = window.sessionStorage.getItem(AD_FOLLOW_CODE_STORAGE_KEY)
  return stored || createAdminFollowCode()
}

function readStoredUploadedFiles() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(AD_UPLOADED_FILES_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function SellerAccountPage({ flow = 'listing', lang }: Props) {
  const isAr = lang === 'ar'
  const role = useMemo(() => pickSellerRole(window.localStorage.getItem(ROLE_STORAGE_KEY)), [])
  const isAdvertisingFlow = flow === 'advertising'
  const isPlatformSaleFlow = flow === 'platform-sale'
  const requiresPlanPayment = !isAdvertisingFlow && !isPlatformSaleFlow
  const [accountMode, setAccountMode] = useState<'signup' | 'signin'>('signup')
  const [selectedPlan, setSelectedPlan] = useState<SellerPlanId>('plus')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [mobileCodeSent, setMobileCodeSent] = useState(false)
  const [mobileCode, setMobileCode] = useState('')
  const [mobileCodeConfirmed, setMobileCodeConfirmed] = useState(false)
  const [accountDocumentCount, setAccountDocumentCount] = useState(() => readStoredUploadedFiles().length)
  const [accountUploadedFiles, setAccountUploadedFiles] = useState<string[]>(() => readStoredUploadedFiles())
  const [accountFileReviewed, setAccountFileReviewed] = useState(false)
  const [accountFileConfirmed, setAccountFileConfirmed] = useState(false)
  const [accountSentToAdmin, setAccountSentToAdmin] = useState(false)
  const [adminFollowCode, setAdminFollowCode] = useState(() => readStoredFollowCode())
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<SellerPaymentMethodId>('shamCash')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentProofAdded, setPaymentProofAdded] = useState(false)
  const [paymentProofFiles, setPaymentProofFiles] = useState<string[]>([])
  const [paymentAmountConfirmed, setPaymentAmountConfirmed] = useState(false)
  const [paymentStarted, setPaymentStarted] = useState(false)
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  // Real, backend-verified plan status (replaces the old client-only "admin lane" that could
  // fake payment approval from the browser, for every flow: listing plan, advertising, and
  // platform-sale). null = no plan/review proof submitted yet.
  const [sellerProfileStatus, setSellerProfileStatus] = useState<string | null>(null)
  const [planSubmitState, setPlanSubmitState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [planSubmitError, setPlanSubmitError] = useState('')
  const paymentConfirmed = sellerProfileStatus === 'APPROVED'
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [submitError, setSubmitError] = useState('')
  const [businessType, setBusinessType] = useState<AdvertisingBusinessTypeId>(() => pickAdvertisingBusinessType(window.localStorage.getItem(AD_BUSINESS_TYPE_STORAGE_KEY)).id)
  const visiblePlans = SELLER_PLANS
  const plan = visiblePlans.find((item) => item.id === selectedPlan) ?? visiblePlans[0]
  const selectedBusinessType = pickAdvertisingBusinessType(businessType)
  const paymentMethod =
    SELLER_PAYMENT_METHODS.find((method) => method.id === selectedPaymentMethod) ?? SELLER_PAYMENT_METHODS[0]
  const planAmountLabel = plan.id === 'premium' ? '$49' : '$19'
  const paymentCapsuleStatus = paymentConfirmed
    ? 'confirmed'
    : sellerProfileStatus === 'PENDING_REVIEW'
      ? 'admin'
      : paymentProofAdded
        ? 'proof'
        : paymentStarted
          ? 'ready'
          : 'locked'
  const visibleAccountFiles =
    accountUploadedFiles.length > 0
      ? accountUploadedFiles
      : Array.from({ length: accountDocumentCount }, (_, index) =>
          isAr ? `مستند حساب ${index + 1}.pdf` : `account-document-${index + 1}.pdf`,
        )
  const accountIdentityReady =
    accountMode === 'signup'
      ? Boolean(
          firstName.trim() &&
            lastName.trim() &&
            email.trim() &&
            phone.trim() &&
            password.length >= 8 &&
            password === repeatPassword,
        )
      : Boolean(email.trim() && phone.trim() && password.length >= 8)
  // Every flow now requires a real, backend-approved plan/review proof before it counts as
  // ready — advertising and platform-sale used to skip this via client-only "admin lane" flags.
  const accountReadyForNext =
    accountIdentityReady && mobileCodeConfirmed && accountFileConfirmed && accountSentToAdmin && paymentConfirmed
  const flowSteps = [
    {
      label: accountMode === 'signup' ? (isAr ? 'إنشاء الحساب' : 'Create account') : isAr ? 'تسجيل الدخول' : 'Sign in',
      done: accountIdentityReady,
    },
    {
      label: isAr ? 'إرسال الرمز' : 'Send code',
      done: mobileCodeSent,
    },
    {
      label: isAr ? 'تأكيد الرمز' : 'Confirm code',
      done: mobileCodeConfirmed,
    },
    {
      label: isAr ? 'رفع مستندات الحساب' : 'Upload account documents',
      done: accountDocumentCount > 0 && accountFileConfirmed,
    },
    {
      label: isAr ? 'إرسال للإدارة' : 'Send to admin',
      done: accountSentToAdmin,
    },
    {
      label: isPlatformSaleFlow ? (isAr ? 'إرسال طلب البيع للمراجعة' : 'Submit sale request for review') : isAr ? 'رفع تأكيد الدفع' : 'Upload payment confirmation',
      done: isPlatformSaleFlow ? sellerProfileStatus !== null : Boolean(paymentReference.trim() && paymentProofAdded),
    },
    {
      label: isAr ? 'تأكيد الإدارة' : 'Admin confirmation',
      done: paymentConfirmed,
    },
    {
      label: isAr ? 'منشور' : 'Published',
      done: accountReadyForNext,
    },
  ]

  function addAccountDocumentFiles(fileList: FileList | null) {
    const names = Array.from(fileList || []).map((file) => file.name).filter(Boolean)
    if (!names.length) return

    setAccountUploadedFiles((current) => {
      const nextFiles = Array.from(new Set([...current, ...names]))
      setAccountDocumentCount(nextFiles.length)
      return nextFiles
    })
    setAccountFileReviewed(false)
    setAccountFileConfirmed(false)
    setAccountSentToAdmin(false)
    setSubmitState('idle')
    setSubmitError('')
  }

  function addPaymentProofFiles(fileList: FileList | null) {
    const names = Array.from(fileList || []).map((file) => file.name).filter(Boolean)
    if (!names.length) return

    setPaymentProofFiles((current) => Array.from(new Set([...current, ...names])))
    setPaymentProofAdded(true)
    setSubmitState('idle')
    setSubmitError('')
  }

  async function refreshSellerPlanStatus() {
    try {
      const overview = await fetchSellerOverview()
      setSellerProfileStatus(overview.sellerProfile?.documentStatus ?? null)
    } catch {
      // No seller session yet, or the request failed — leave status as-is.
    }
  }

  async function submitPlanPayment() {
    if (!paymentReference.trim() || !paymentProofAdded) return
    setPlanSubmitState('saving')
    setPlanSubmitError('')

    try {
      await submitSellerPlanProof({
        amountMinor: plan.id === 'premium' ? 4900 : 1900,
        currency: 'USD',
        providerRef: paymentReference.trim(),
        proofAssetUrl: paymentProofReference('seller-plan-payment-proof', paymentProofFiles),
        planCode: plan.id,
        legalName: `${firstName.trim()} ${lastName.trim()}`.trim() || undefined,
        sellerType: role.id,
      })
      await refreshSellerPlanStatus()
      setPlanSubmitState('idle')
    } catch (error) {
      setPlanSubmitState('error')
      setPlanSubmitError(
        error instanceof Error ? error.message : isAr ? 'تعذر إرسال الدفع للمراجعة.' : 'Could not submit payment for review.',
      )
    }
  }

  // Platform-sale has no upfront plan fee (SYBNB takes a commission on close instead), so this
  // submits a real zero-amount review request through the same backend pipeline instead of the
  // old client-only "admin lane" buttons that never touched the database.
  async function submitPlatformSaleRequest() {
    if (!accountSentToAdmin) return
    setPlanSubmitState('saving')
    setPlanSubmitError('')

    try {
      await submitSellerPlanProof({
        amountMinor: 0,
        currency: 'USD',
        providerRef: adminFollowCode,
        proofAssetUrl: paymentProofReference('platform-sale-documents', accountUploadedFiles),
        planCode: 'platform-sale',
        legalName: `${firstName.trim()} ${lastName.trim()}`.trim() || undefined,
        sellerType: role.id,
      })
      await refreshSellerPlanStatus()
      setPlanSubmitState('idle')
    } catch (error) {
      setPlanSubmitState('error')
      setPlanSubmitError(
        error instanceof Error ? error.message : isAr ? 'تعذر إرسال الطلب للمراجعة.' : 'Could not submit the request for review.',
      )
    }
  }

  useEffect(() => {
    window.sessionStorage.setItem(AD_FOLLOW_CODE_STORAGE_KEY, adminFollowCode)
  }, [adminFollowCode])

  useEffect(() => {
    window.sessionStorage.setItem(AD_UPLOADED_FILES_STORAGE_KEY, JSON.stringify(accountUploadedFiles))
  }, [accountUploadedFiles])

  useEffect(() => {
    window.localStorage.setItem(AD_BUSINESS_TYPE_STORAGE_KEY, businessType)
  }, [businessType])

  // Create the real backend account as soon as identity + phone are verified, well before the
  // final "complete" step — the plan-payment proof below needs a real auth session to submit to,
  // and previously the account was only created at the very end (after payment was "confirmed"),
  // which was impossible to satisfy for real. Applies to all three flows: the advertising and
  // platform-sale flows previously never created a real account or submitted a real review
  // request at all, relying entirely on client-only state that anyone could fake.
  useEffect(() => {
    if (!accountIdentityReady || !mobileCodeConfirmed) return
    if (getStoredSellerSession()) {
      void refreshSellerPlanStatus()
      return
    }
    void createSellerAccountSession({
      displayName: `${firstName.trim()} ${lastName.trim()}`.trim() || email.trim(),
      email: email.trim(),
      password,
      phone: phone.trim(),
      sellerRole: role.id,
      planCode: isPlatformSaleFlow ? 'platform-sale' : isAdvertisingFlow ? 'advertising' : plan.id,
    }).then(() => refreshSellerPlanStatus())
  }, [accountIdentityReady, mobileCodeConfirmed])

  const submitAccount = async () => {
    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()
    const trimmedName = `${trimmedFirstName} ${trimmedLastName}`.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedPhone = phone.trim()

    if (!trimmedEmail || password.length < 8 || (accountMode === 'signup' && (!trimmedFirstName || !trimmedLastName))) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? accountMode === 'signup'
            ? 'أدخل الاسم الأول واسم العائلة والبريد الإلكتروني وكلمة مرور من 8 أحرف على الأقل.'
            : 'أدخل البريد الإلكتروني وكلمة مرور من 8 أحرف على الأقل.'
          : accountMode === 'signup'
            ? 'Enter first name, last name, email, and a password with at least 8 characters.'
            : 'Enter email and a password with at least 8 characters.',
      )
      return
    }

    if (accountMode === 'signup' && password !== repeatPassword) {
      setSubmitState('error')
      setSubmitError(isAr ? 'كلمة المرور وتأكيد كلمة المرور غير متطابقين.' : 'Password and repeated password do not match.')
      return
    }

    if (!trimmedPhone || !mobileCodeSent || !mobileCodeConfirmed) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? 'أدخل رقم الهاتف، أرسل رمز التحقق، ثم أكّد الرمز قبل المتابعة.'
          : 'Enter a phone number, send the verification code, then confirm the code before continuing.',
      )
      return
    }

    if (accountDocumentCount < 1 || !accountFileReviewed || !accountFileConfirmed) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? 'أضف مستنداً واحداً على الأقل بصيغة PDF أو PNG أو JPG، راجعه، ثم أكّد المستندات قبل الإرسال.'
          : 'Upload at least one document as PDF, PNG, or JPG, review it, then confirm documents before sending.',
      )
      return
    }

    if (!accountSentToAdmin) {
      setSubmitState('error')
      setSubmitError(isAr ? 'أرسل الحساب للإدارة لتأكيده قبل المتابعة.' : 'Send the account to admin confirmation before continuing.')
      return
    }

    if (!paymentConfirmed) {
      setSubmitState('error')
      setSubmitError(
        isPlatformSaleFlow
          ? isAr
            ? 'يجب أن توافق الإدارة على طلب البيع والمستندات قبل المتابعة.'
            : 'Admin must approve the platform-sale request and documents before continuing.'
          : isAr
          ? 'ارفع تأكيد الدفع، ثم انتظر موافقة الإدارة الحقيقية قبل المتابعة.'
          : 'Upload payment confirmation, then wait for real admin approval before continuing.',
      )
      return
    }

    setSubmitState('submitting')
    setSubmitError('')

    try {
      window.localStorage.setItem(FLOW_STORAGE_KEY, isAdvertisingFlow ? 'advertising' : isPlatformSaleFlow ? 'platform-sale' : 'listing')
      window.localStorage.setItem(AD_PLAN_STORAGE_KEY, isPlatformSaleFlow ? 'platform-sale' : plan.id)
      await createSellerAccountSession({
        displayName: trimmedName || (isAr ? 'حساب بائع' : 'Seller account'),
        email: trimmedEmail,
        password,
        phone: trimmedPhone || undefined,
        sellerRole: role.id,
        planCode: isPlatformSaleFlow ? 'platform-sale' : plan.id,
      })
      navigate(isPlatformSaleFlow ? '/sell/submitted' : '/sell/listing-wizard')
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : isAr ? 'تعذر إنشاء الحساب.' : 'Unable to create account.')
    }
  }

  return (
    <main className="seller-page seller-account-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-account-head">
        <button className="back-button seller-back" onClick={() => navigate('/')}>
          {isAr ? 'العودة' : 'Back'}
        </button>
        <div className="seller-account-auth-actions" aria-label={isAr ? 'إجراءات الدخول' : 'Login actions'}>
          <button
            type="button"
            onClick={() => {
              setAccountMode('signin')
              setSubmitState('idle')
              setSubmitError('')
            }}
          >
            {isAr ? 'تسجيل الدخول' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={() => {
              window.sessionStorage.clear()
              navigate('/')
            }}
          >
            {isAr ? 'تسجيل الخروج' : 'Sign out'}
          </button>
        </div>
        <BrandLogo logo="plus" size="nav" />
      </section>

      <section className="seller-account-grid">
        <div className="seller-form-card">
          <p className="eyebrow">
            {isAdvertisingFlow
              ? isAr
                ? 'حساب الإعلان'
                : 'Advertising account'
              : isPlatformSaleFlow
                ? isAr
                  ? 'حساب البيع عبر المنصة'
                  : 'Platform-managed sale account'
                : isAr
                  ? 'حساب النشر'
                  : 'Publishing account'}
          </p>
          <h1>
            {isAdvertisingFlow
              ? isAr
                ? 'أنشئ حساباً لحجز مساحة إعلانية'
                : 'Create an account to book advertising'
              : isPlatformSaleFlow
                ? isAr
                  ? 'أنشئ حساباً لبيع العقار عبر SYBNB'
                  : 'Create an account to sell through SYBNB'
                : isAr
                  ? 'أنشئ حساباً لإكمال النشر'
                  : 'Create an account to continue listing'}
          </h1>
          <p>
            {isAdvertisingFlow
              ? isAr
                ? 'أنشئ الحساب، أكّد رقم الهاتف، أضف مستندات الحساب، ثم أكّد الدفع قبل إرسال الطلب للإدارة.'
                : 'Create the account, verify the phone, add account documents, then confirm payment before admin review.'
              : isPlatformSaleFlow
                ? isAr
                  ? 'أنشئ الحساب، أكّد الهاتف، ارفع إثبات الملكية أو التفويض، ثم ترسل الإدارة كود المتابعة وتستلم SYBNB إدارة البيع.'
                  : 'Create the account, verify the phone, upload ownership or authorization, then admin confirms the follow-up code and SYBNB manages the sale.'
                : isAr
                  ? 'بعد إنشاء الحساب، اختر طريقة الدفع، أكّد الدفع، ثم أضف ملفات العقار والتفويض قبل المراجعة.'
                  : 'After account creation, choose a payment method, confirm payment, then add property and authorization files before review.'}
          </p>
          <div className="seller-account-mode-switch" role="tablist" aria-label={isAr ? 'طريقة الدخول' : 'Account access mode'}>
            <button
              className={accountMode === 'signup' ? 'active' : ''}
              type="button"
              onClick={() => {
                setAccountMode('signup')
                setSubmitState('idle')
                setSubmitError('')
              }}
            >
              {isAr ? 'تسجيل حساب جديد' : 'Sign up'}
            </button>
            <button
              className={accountMode === 'signin' ? 'active' : ''}
              type="button"
              onClick={() => {
                setAccountMode('signin')
                setRepeatPassword('')
                setSubmitState('idle')
                setSubmitError('')
              }}
            >
              {isAr ? 'تسجيل الدخول' : 'Sign in'}
            </button>
          </div>

          {isAdvertisingFlow ? (
            <div className="seller-selected-role" style={{ '--accent': '#d5a915' } as CSSVars}>
              <span>{isAr ? 'المسار المختار' : 'Selected path'}</span>
              <strong>{isAr ? 'عميل إعلاني' : 'Advertising client'}</strong>
              <small>
                {isAr
                  ? 'يريد حجز بانر أو مساحة إعلانية داخل المنصة.'
                  : 'Books a banner or promotional placement inside the platform.'}
              </small>
            </div>
          ) : isPlatformSaleFlow ? (
            <div className="seller-selected-role" style={{ '--accent': '#20d29b' } as CSSVars}>
              <span>{isAr ? 'المسار المختار' : 'Selected path'}</span>
              <strong>{isAr ? 'البيع عبر المنصة' : 'Sell by platform'}</strong>
              <small>
                {isAr
                  ? `${role.label[lang]} - SYBNB تراجع المستندات وتدير عملية البيع بعد الموافقة، وعمولة المنصة 5% عند إتمام البيع.`
                  : `${role.label[lang]} - SYBNB reviews documents and manages the sale after approval, with a 5% platform commission when the sale closes.`}
              </small>
            </div>
          ) : (
            <div className="seller-selected-role" style={{ '--accent': role.accent } as CSSVars}>
              <span>{isAr ? 'الدور المختار' : 'Selected role'}</span>
              <strong>{role.label[lang]}</strong>
              <small>{role.description[lang]}</small>
            </div>
          )}

          {isAdvertisingFlow && (
            <div className="seller-business-type-panel">
              <div>
                <strong>{isAr ? 'نوع النشاط الإعلاني' : 'Advertising business type'}</strong>
                <span>{selectedBusinessType.helper[lang]}</span>
              </div>
              <div className="seller-business-type-options">
                {AD_BUSINESS_TYPES.map((item) => (
                  <button
                    className={item.id === businessType ? 'active' : ''}
                    key={item.id}
                    type="button"
                    onClick={() => setBusinessType(item.id)}
                  >
                    {item.label[lang]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="seller-form-grid">
            {accountMode === 'signup' && (
              <>
                <label>
                  <span>{isAr ? 'الاسم الأول' : 'First name'}</span>
                  <input
                    autoComplete="given-name"
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={isAr ? 'مثال: سارة' : 'e.g. Sara'}
                    type="text"
                    value={firstName}
                  />
                </label>
                <label>
                  <span>{isAr ? 'اسم العائلة' : 'Last name'}</span>
                  <input
                    autoComplete="family-name"
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={isAr ? 'مثال: محمود' : 'e.g. Mahmoud'}
                    type="text"
                    value={lastName}
                  />
                </label>
              </>
            )}
            <label>
              <span>{isAr ? 'البريد الإلكتروني' : 'Email'}</span>
              <input
                autoComplete="email"
                dir="ltr"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seller@example.com"
                type="email"
                value={email}
              />
            </label>
            <label>
              <span>{isAr ? 'رقم الهاتف' : 'Phone number'}</span>
              <input
                autoComplete="tel"
                dir="ltr"
                onChange={(event) => {
                  setPhone(event.target.value)
                  setMobileCodeSent(false)
                  setMobileCode('')
                  setMobileCodeConfirmed(false)
                  setAccountSentToAdmin(false)
                }}
                placeholder={phonePlaceholder()}
                type="tel"
                value={phone}
              />
            </label>
            <div className="seller-password-stack">
              <label>
                <span>{isAr ? 'كلمة المرور' : 'Password'}</span>
                <input
                  autoComplete={accountMode === 'signup' ? 'new-password' : 'current-password'}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={accountMode === 'signup' ? (isAr ? 'إنشاء كلمة مرور' : 'Create password') : isAr ? 'كلمة مرور الحساب' : 'Account password'}
                  type="password"
                  value={password}
                />
              </label>
              {accountMode === 'signup' && (
                <label>
                  <span>{isAr ? 'تأكيد كلمة المرور' : 'Repeat password'}</span>
                  <input
                    autoComplete="new-password"
                    onChange={(event) => setRepeatPassword(event.target.value)}
                    placeholder={isAr ? 'أعد كتابة كلمة المرور' : 'Repeat password'}
                    type="password"
                    value={repeatPassword}
                  />
                </label>
              )}
            </div>
            <div className="seller-verification-box">
              <div>
                <strong>{isAr ? 'توثيق رقم الهاتف' : 'Mobile verification'}</strong>
                <span>
                  {mobileCodeSent
                    ? isAr
                      ? `تم إرسال رمز التحقق إلى ${phone.trim()}. أدخل الرمز المستلم.`
                      : `Verification code sent to ${phone.trim()}. Enter the received code.`
                    : isAr
                      ? 'أرسل رمز تحقق قبل إنشاء الحساب.'
                      : 'Send a verification code before creating the account.'}
                </span>
              </div>
              <button
                type="button"
                disabled={!phone.trim()}
                onClick={async () => {
                  try {
                    await requestOtp({ phone: phone.trim(), purpose: 'seller-login' })
                    setMobileCodeSent(true)
                    setMobileCode('')
                    setMobileCodeConfirmed(false)
                    setAccountSentToAdmin(false)
                    setSubmitState('idle')
                    setSubmitError('')
                  } catch (err) {
                    setSubmitState('error')
                    setSubmitError(err instanceof Error ? err.message : isAr ? 'تعذر إرسال الرمز.' : 'Could not send code.')
                  }
                }}
              >
                {mobileCodeSent ? (isAr ? 'إعادة إرسال الرمز' : 'Resend code') : isAr ? 'إرسال الرمز' : 'Send code'}
              </button>
              <label>
                <small>{isAr ? 'رمز التحقق' : 'Verification code'}</small>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  onChange={(event) => {
                    setMobileCode(event.target.value)
                    setMobileCodeConfirmed(false)
                    setAccountSentToAdmin(false)
                  }}
                  placeholder="123456"
                  value={mobileCode}
                />
              </label>
              <button
                type="button"
                disabled={!mobileCodeSent || mobileCode.trim().length !== 6}
                onClick={async () => {
                  try {
                    const ok = await confirmOtp({ phone: phone.trim(), purpose: 'seller-login', code: mobileCode.trim() })
                    if (!ok) {
                      setSubmitState('error')
                      setSubmitError(isAr ? 'رمز الهاتف غير صحيح.' : 'Incorrect mobile code.')
                      return
                    }
                  } catch (err) {
                    setSubmitState('error')
                    setSubmitError(err instanceof Error ? err.message : isAr ? 'رمز الهاتف غير صحيح.' : 'Incorrect mobile code.')
                    return
                  }
                  setSubmitState('idle')
                  setSubmitError('')
                  setMobileCodeConfirmed(true)
                  setAccountSentToAdmin(false)
                }}
              >
                {mobileCodeConfirmed ? (isAr ? 'تم تأكيد الرمز' : 'Code confirmed') : isAr ? 'تأكيد الرمز' : 'Confirm code'}
              </button>
            </div>
            <div className={`seller-account-file-box ${accountFileConfirmed ? 'confirmed' : ''}`}>
              <div>
                <strong>
                  {isAdvertisingFlow
                    ? isAr
                      ? 'مستندات وصور الإعلان'
                      : 'Advertising documents and photos'
                    : isAr
                      ? isPlatformSaleFlow
                        ? 'مستندات البيع عبر المنصة'
                        : 'مستندات وصور البائع والعقار'
                      : isPlatformSaleFlow
                        ? 'Platform sale documents'
                        : 'Seller and property documents'}
                </strong>
                <span>
                  {!isAdvertisingFlow
                    ? isAr
                      ? isPlatformSaleFlow
                        ? 'ارفع إثبات الملكية أو التفويض وصور العقار أو المنتج وأي عقد يثبت حق SYBNB في إدارة البيع.'
                        : 'ارفع إثبات الملكية، التفويض، صور العقار، المخططات، أو ملفات السيارة/المشروع بصيغة PDF أو PNG أو JPG.'
                      : isPlatformSaleFlow
                        ? 'Upload ownership proof or authorization, property/product photos, and any agreement proving SYBNB can manage the sale.'
                        : 'Upload ownership proof, authorization, property photos, plans, or car/project files as PDF, PNG, or JPG.'
                    : businessType === 'restaurant'
                    ? isAr
                      ? 'ارفع صور المطعم، المنيو، اللوغو، السجل التجاري أو الترخيص بصيغة PDF أو PNG أو JPG.'
                      : 'Upload restaurant photos, menu, logo, commercial record or license as PDF, PNG, or JPG.'
                    : selectedBusinessType.helper[lang]}
                </span>
              </div>
              {adminFollowCode && (
                <div className="seller-admin-follow-code">
                  <span>{isAr ? 'كود المتابعة مع الإدارة' : 'Admin follow-up code'}</span>
                  <strong dir="ltr">{adminFollowCode}</strong>
                </div>
              )}
              <PaymentProofUpload
                cta={
                  isAdvertisingFlow
                    ? isAr
                      ? 'رفع مستندات الحساب والإعلان'
                      : 'Upload account and advertising documents'
                    : isAr
                      ? isPlatformSaleFlow
                        ? 'رفع مستندات البيع عبر المنصة'
                        : 'رفع مستندات الحساب والعقار'
                      : isPlatformSaleFlow
                        ? 'Upload platform-sale documents'
                        : 'Upload account and property documents'
                }
                emptyText={isAr ? 'لم يتم رفع أي مستند بعد. ارفع ملف PDF أو PNG أو JPG.' : 'No documents uploaded yet. Upload PDF, PNG, or JPG.'}
                files={visibleAccountFiles}
                help={
                  !isAdvertisingFlow
                    ? isAr
                      ? isPlatformSaleFlow
                        ? 'ارفع هوية المالك، التفويض، صور العقار أو المنتج، وأي مستند يوضح السعر المطلوب وشروط البيع. يمكن رفع أكثر من ملف.'
                        : 'ارفع مستندات المالك، التفويض، صور العقار، ملفات السيارة، أو ملفات المشروع الجديد. يمكن رفع أكثر من ملف.'
                      : isPlatformSaleFlow
                        ? 'Upload owner ID, authorization, property or product photos, and any document showing asking price and sale terms. Multiple files are allowed.'
                        : 'Upload owner documents, authorization, property photos, car files, or new-project files. Multiple files are allowed.'
                    : businessType === 'restaurant'
                    ? isAr
                      ? 'ارفع صور المطعم، المنيو، اللوغو، السجل التجاري أو الترخيص.'
                      : 'Upload restaurant photos, menu, logo, commercial record, or license.'
                    : selectedBusinessType.helper[lang]
                }
                lang={lang}
                onAddFiles={addAccountDocumentFiles}
                title={
                  isAdvertisingFlow
                    ? isAr
                      ? 'مستندات وصور الإعلان'
                      : 'Advertising documents and photos'
                    : isAr
                      ? isPlatformSaleFlow
                        ? 'مستندات البيع عبر المنصة'
                        : 'مستندات وصور البائع والعقار'
                      : isPlatformSaleFlow
                        ? 'Platform sale documents'
                        : 'Seller and property documents'
                }
              />
              {accountDocumentCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAccountDocumentCount((current) => Math.max(0, current - 1))
                    setAccountUploadedFiles((current) => current.slice(0, -1))
                    setAccountFileReviewed(false)
                    setAccountFileConfirmed(false)
                    setAccountSentToAdmin(false)
                    setSubmitState('idle')
                    setSubmitError('')
                  }}
                >
                  {isAr ? 'حذف آخر مستند' : 'Remove last document'}
                </button>
              )}
              <button
                type="button"
                disabled={accountDocumentCount < 1}
                onClick={() => {
                  setAccountFileReviewed(true)
                  setAccountFileConfirmed(false)
                  setAccountSentToAdmin(false)
                  setSubmitState('idle')
                  setSubmitError('')
                }}
              >
                {accountFileReviewed ? (isAr ? 'تمت مراجعة المستند' : 'Document reviewed') : isAr ? 'مراجعة المستند' : 'Review document'}
              </button>
              <button
                type="button"
                disabled={!accountFileReviewed}
                onClick={() => {
                  setAccountFileConfirmed(true)
                  setAccountSentToAdmin(false)
                  setSubmitState('idle')
                  setSubmitError('')
                }}
              >
                {accountFileConfirmed ? (isAr ? 'تم تأكيد المستند' : 'Document confirmed') : isAr ? 'تأكيد المستند' : 'Confirm document'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!accountFileConfirmed) {
                    setSubmitState('error')
                    setSubmitError(
                      isAr
                        ? 'ارفع مستندات الحساب، راجعها، ثم أكّدها. بعدها زر الإرسال سيرسل الملفات للإدارة مباشرة.'
                        : 'Upload, review, and confirm account documents. Then Send will send the files directly to admin.',
                    )
                    return
                  }
                  setSubmitState('idle')
                  setSubmitError('')
                  setAccountSentToAdmin(true)
                  setAdminFollowCode((current) => current || createAdminFollowCode())
                }}
              >
                {accountSentToAdmin ? (isAr ? 'تم إرسال الملفات للإدارة' : 'Files sent to admin') : isAr ? 'إرسال الملفات للإدارة' : 'Send files to admin'}
              </button>
            </div>
          </div>
          {submitState === 'error' && (
            <div className="seller-inline-alert seller-account-alert">
              <strong>{isAr ? 'تعذر إنشاء الحساب' : 'Account could not be created'}</strong>
              <span>{submitError}</span>
            </div>
          )}
        </div>

        <aside className="seller-plan-card" style={{ '--accent': isPlatformSaleFlow ? '#20d29b' : plan.accent } as CSSVars}>
          <p className="eyebrow">
            {isPlatformSaleFlow
              ? isAr
                ? 'بيع عبر المنصة'
                : 'Sell by platform'
              : isAdvertisingFlow
                ? isAr
                  ? 'اختر خطة الإعلان'
                  : 'Choose advertising plan'
                : isAr
                  ? 'اختر خطة النشر'
                  : 'Choose publishing plan'}
          </p>
          {isPlatformSaleFlow ? (
            <>
              <div className="seller-plan-detail seller-platform-sale-panel">
                <h2>{isAr ? 'SYBNB تدير البيع' : 'SYBNB-managed sale'}</h2>
                <ul>
                  <li>{isAr ? 'لا توجد خطة نشر مقدماً لهذا المسار.' : 'No publishing plan is charged upfront in this path.'}</li>
                  <li>{isAr ? 'الإدارة تراجع الملكية والتفويض والسعر المطلوب.' : 'Admin reviews ownership, authorization, and asking price.'}</li>
                  <li>{isAr ? 'بعد الموافقة، يتابع فريق المنصة التواصل والبيع حسب الاتفاق، وتطبق عمولة 5% عند إتمام البيع.' : 'After approval, the platform team manages communication and sale according to the agreement, with a 5% commission when the sale closes.'}</li>
                </ul>
              </div>
              <div className="seller-payment-note">
                <strong>{isAr ? 'مراجعة الإدارة' : 'Admin review'}</strong>
                <span>
                  {isAr
                    ? 'هذا المسار لا ينتقل إلى بوابة دفع الخطة. الإجراء المطلوب هو اعتماد المستندات وكود المتابعة.'
                    : 'This path does not enter plan payment. The required action is document approval and follow-up code confirmation.'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="seller-plan-options">
                {visiblePlans.map((item) => (
                  <button
                    className={`seller-plan-option ${item.id === selectedPlan ? 'active' : ''}`}
                    key={item.id}
                    onClick={() => setSelectedPlan(item.id)}
                    style={{ '--accent': item.accent } as CSSVars}
                  >
                    <span>{item.label[lang]}</span>
                    <strong>{item.price}</strong>
                  </button>
                ))}
              </div>
              <div className="seller-plan-detail">
                <h2>
                  {plan.label[lang]} {!isAdvertisingFlow && <span>{plan.name}</span>}
                </h2>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature.en}>{feature[lang]}</li>
                  ))}
                </ul>
              </div>
              <div className="seller-payment-note">
                <strong>{isAr ? 'طرق الدفع المتاحة' : 'Available payment methods'}</strong>
                <span>{isAr ? 'اختر الطريقة لفتح صفحة الدفع المالية الآمنة.' : 'Choose a method to open the secure financial payment page.'}</span>
              </div>
              <div className="seller-payment-methods" aria-label={isAr ? 'اختيار طريقة الدفع' : 'Choose payment method'}>
                {SELLER_PAYMENT_METHODS.map((method) => (
                  <button
                    className={`seller-payment-method ${method.id === selectedPaymentMethod ? 'active' : ''}`}
                    key={method.id}
                    onClick={() => {
                      window.localStorage.setItem(AD_PLAN_STORAGE_KEY, selectedPlan)
                      setSelectedPaymentMethod(method.id)
                      setPaymentReference('')
                      setPaymentProofAdded(false)
                      setPaymentProofFiles([])
                      setPaymentAmountConfirmed(false)
                      setPaymentStarted(false)
                      setCardNumber('')
                      setCardExpiry('')
                      setCardCvv('')
                      setCardHolder('')
                      if (isAdvertisingFlow) navigate(`/advertising/payment/${method.id}`)
                    }}
                  >
                    {method.label[lang]}
                  </button>
                ))}
              </div>
            </>
          )}
          {isPlatformSaleFlow && (
            <div className={`seller-payment-confirmation ${paymentConfirmed ? 'confirmed' : ''}`}>
              <span>
                {isAr
                  ? 'بعد إرسال المستندات، يراجعها فريق SYBNB الحقيقي عبر لوحة الإدارة قبل فتح متابعة البيع.'
                  : 'After documents are sent, the real SYBNB team reviews them from the admin dashboard before opening sale follow-up.'}
              </span>
              {sellerProfileStatus === 'APPROVED' ? (
                <div className="seller-admin-waiting-panel confirmed">
                  <strong>{isAr ? 'وافقت الإدارة على طلب البيع' : 'Admin approved the sale request'}</strong>
                  <span>{isAr ? 'سيتواصل فريق SYBNB معك لمتابعة تفاصيل البيع.' : 'The SYBNB team will contact you to follow up on sale details.'}</span>
                </div>
              ) : sellerProfileStatus === 'PENDING_REVIEW' ? (
                <div className="seller-admin-waiting-panel">
                  <strong>{isAr ? 'بانتظار مراجعة الإدارة' : 'Waiting for admin review'}</strong>
                  <span>
                    {isAr
                      ? 'تم إرسال الطلب لفريق SYBNB الحقيقي. لا يمكن للعميل أو البائع تأكيد هذا الطلب من هنا.'
                      : 'The request was sent to the real SYBNB team. The buyer or seller cannot confirm it from this page.'}
                  </span>
                  <button type="button" disabled={planSubmitState === 'saving'} onClick={() => void refreshSellerPlanStatus()}>
                    {isAr ? 'تحديث حالة المراجعة' : 'Refresh review status'}
                  </button>
                </div>
              ) : (
                <div className="seller-admin-waiting-panel">
                  <strong>{isAr ? 'إرسال طلب البيع للمراجعة' : 'Submit sale request for review'}</strong>
                  <span>
                    {sellerProfileStatus === 'REJECTED'
                      ? isAr
                        ? 'رفضت الإدارة الطلب السابق. راجع المستندات ثم أعد الإرسال.'
                        : 'Admin rejected the previous request. Review the documents, then resubmit.'
                      : isAr
                        ? 'أرسل المستندات المرفوعة أعلاه لمراجعة حقيقية من فريق SYBNB.'
                        : 'Send the documents uploaded above for a real SYBNB team review.'}
                  </span>
                  {planSubmitState === 'error' && <small className="seller-plan-error">{planSubmitError}</small>}
                  <button type="button" disabled={!accountSentToAdmin || planSubmitState === 'saving'} onClick={() => void submitPlatformSaleRequest()}>
                    {planSubmitState === 'saving' ? (isAr ? 'جارٍ الإرسال...' : 'Submitting...') : isAr ? 'إرسال للمراجعة' : 'Submit for review'}
                  </button>
                </div>
              )}
            </div>
          )}
          {requiresPlanPayment && <div className={`seller-payment-confirmation ${paymentConfirmed ? 'confirmed' : ''}`}>
            <span>{paymentMethod.helper[lang]}</span>
            <div className="seller-payment-destination">
              <span>{paymentMethod.destinationTitle[lang]}</span>
              <strong dir="ltr">{paymentMethod.destinationCode}</strong>
              <small>
                {paymentMethod.destinationHint[lang]} {isAr ? 'كود المتابعة:' : 'Follow-up code:'}{' '}
                <b dir="ltr">{adminFollowCode}</b>
              </small>
            </div>
            <div className="seller-payment-amount-box">
              <div>
                <span>{isAr ? 'المبلغ المطلوب' : 'Payment amount'}</span>
                <strong>{planAmountLabel}</strong>
              </div>
              <label>
                <input
                  checked={paymentAmountConfirmed}
                  type="checkbox"
                  onChange={(event) => {
                    setPaymentAmountConfirmed(event.target.checked)
                    setPaymentStarted(false)
                    setPaymentProofAdded(false)
                  }}
                />
                <span>{isAr ? 'أؤكد أن المبلغ صحيح قبل الدفع' : 'I confirm this amount before paying'}</span>
              </label>
              <button
                className="seller-pay-now-button"
                disabled={!paymentAmountConfirmed}
                onClick={() => {
                  setPaymentStarted(true)
                  setPaymentReference((current) => current || `${paymentMethod.destinationCode}-${adminFollowCode}`)
                }}
              >
                {paymentStarted ? (isAr ? 'تم بدء الدفع' : 'Payment started') : isAr ? 'ادفع الآن' : 'Pay now'}
              </button>
            </div>
            <PaymentCapsule
              amountLabel={planAmountLabel}
              destinationCode={paymentMethod.destinationCode}
              followCode={adminFollowCode}
              lang={lang}
              methodLabel={paymentMethod.label[lang]}
              proofCount={paymentProofFiles.length}
              status={paymentCapsuleStatus}
            />
            {selectedPaymentMethod === 'shamCash' && (
              <div className="seller-sham-qr-panel">
                <div className="seller-sham-qr" aria-label={isAr ? 'رمز QR شام كاش' : 'Sham Cash QR'}>
                  {Array.from({ length: 49 }, (_, index) => (
                    <i key={index} className={(index + adminFollowCode.length + paymentMethod.destinationCode.length) % 3 === 0 ? 'on' : ''} />
                  ))}
                </div>
                <div>
                  <strong>{isAr ? 'امسح QR أو ادفع بالكود' : 'Scan QR or pay by code'}</strong>
                  <span dir="ltr">{paymentMethod.destinationCode}</span>
                  <small>{isAr ? 'اكتب هذا الكود في ملاحظة الدفع:' : 'Write this code in the payment note:'} <b dir="ltr">{adminFollowCode}</b></small>
                </div>
              </div>
            )}
            {selectedPaymentMethod === 'localWallet' && (
              <div className="seller-method-instructions">
                <strong>{isAr ? 'خطوات المحفظة' : 'Wallet steps'}</strong>
                <span>{isAr ? 'افتح المحفظة المحلية، حوّل إلى الكود أعلاه، ثم ارفع صورة تأكيد الدفع.' : 'Open the local wallet, transfer to the code above, then upload the payment confirmation image.'}</span>
              </div>
            )}
            {selectedPaymentMethod === 'bankTransfer' && (
              <div className="seller-method-instructions">
                <strong>{isAr ? 'بيانات التحويل' : 'Transfer details'}</strong>
                <span>{isAr ? 'استخدم مرجع التحويل أعلاه وضع كود المتابعة في سبب التحويل.' : 'Use the reference above and put the follow-up code in the transfer reason.'}</span>
              </div>
            )}
            {selectedPaymentMethod === 'creditCard' && (
              <div className="seller-card-payment-form">
                <div className="seller-card-amount">
                  <span>{isAr ? 'المبلغ المطلوب' : 'Amount due'}</span>
                  <strong>{planAmountLabel}</strong>
                </div>
                <label>
                  <small>{isAr ? 'اسم حامل البطاقة' : 'Cardholder name'}</small>
                  <input value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} placeholder={isAr ? 'الاسم كما هو على البطاقة' : 'Name on card'} />
                </label>
                <label>
                  <small>{isAr ? 'رقم البطاقة' : 'Card number'}</small>
                  <input dir="ltr" inputMode="numeric" maxLength={19} value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} placeholder="4242 4242 4242 4242" />
                </label>
                <div className="seller-card-row">
                  <label>
                    <small>{isAr ? 'تاريخ الانتهاء' : 'Expiry date'}</small>
                    <input dir="ltr" inputMode="numeric" maxLength={5} value={cardExpiry} onChange={(event) => setCardExpiry(event.target.value)} placeholder="MM/YY" />
                  </label>
                  <label>
                    <small>{isAr ? 'CVV' : 'CVV'}</small>
                    <input dir="ltr" inputMode="numeric" maxLength={4} value={cardCvv} onChange={(event) => setCardCvv(event.target.value)} placeholder="123" />
                  </label>
                </div>
              </div>
            )}
            <label className="seller-payment-reference">
              <small>{isAr ? 'رقم العملية / المرجع' : 'Transaction / reference number'}</small>
              <input
                dir="ltr"
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder={selectedPaymentMethod === 'shamCash' ? 'SC-2026-0042' : 'PAY-2026-0042'}
                value={paymentReference}
              />
            </label>
            <PaymentProofUpload
              cta={isAr ? 'رفع تأكيد الدفع' : 'Upload payment confirmation'}
              disabled={!paymentStarted}
              emptyText={isAr ? 'لم يتم رفع تأكيد الدفع بعد.' : 'No payment confirmation uploaded yet.'}
              files={paymentProofFiles}
              help={isAr ? 'ارفع إيصال الدفع أو صورة التحويل قبل موافقة الإدارة.' : 'Upload payment receipt or transfer screenshot before admin approval.'}
              lang={lang}
              onAddFiles={addPaymentProofFiles}
              title={isAr ? 'مستندات الدفع' : 'Payment documents'}
            />
            {sellerProfileStatus === 'APPROVED' ? (
              <div className="seller-admin-waiting-panel confirmed">
                <strong>{isAr ? 'تم تأكيد الدفع من الإدارة' : 'Payment confirmed by admin'}</strong>
                <span>{isAr ? 'يمكنك المتابعة لإنهاء فتح الحساب.' : 'You can continue to finish opening the account.'}</span>
              </div>
            ) : sellerProfileStatus === 'PENDING_REVIEW' ? (
              <div className="seller-admin-waiting-panel">
                <strong>{isAr ? 'بانتظار مراجعة الإدارة' : 'Waiting for admin review'}</strong>
                <span>
                  {isAr
                    ? 'تم إرسال إثبات الدفع لفريق SYBNB. لا يمكن لأحد غير الإدارة تأكيد استلام المال.'
                    : 'Payment proof was sent to the SYBNB team. Only admin can confirm money received.'}
                </span>
                <button type="button" disabled={planSubmitState === 'saving'} onClick={() => void refreshSellerPlanStatus()}>
                  {isAr ? 'تحديث حالة المراجعة' : 'Refresh review status'}
                </button>
              </div>
            ) : (
              <div className="seller-admin-waiting-panel">
                <strong>{isAr ? 'إرسال الدفع للمراجعة' : 'Submit payment for review'}</strong>
                <span>
                  {sellerProfileStatus === 'REJECTED'
                    ? isAr
                      ? 'رفضت الإدارة الإثبات السابق. ارفع مرجعاً وإثباتاً جديدين ثم أعد الإرسال.'
                      : 'Admin rejected the previous proof. Upload a new reference and proof, then resubmit.'
                    : isAr
                      ? 'أدخل رقم العملية وارفع الإثبات أعلاه، ثم أرسله للمراجعة الحقيقية من فريق SYBNB.'
                      : 'Enter the transaction reference and upload proof above, then submit it for real SYBNB team review.'}
                </span>
                {planSubmitState === 'error' && <small className="seller-plan-error">{planSubmitError}</small>}
                <button
                  type="button"
                  disabled={!paymentReference.trim() || !paymentProofAdded || planSubmitState === 'saving'}
                  onClick={() => void submitPlanPayment()}
                >
                  {planSubmitState === 'saving' ? (isAr ? 'جارٍ الإرسال...' : 'Submitting...') : isAr ? 'إرسال للمراجعة' : 'Submit for review'}
                </button>
              </div>
            )}
          </div>}
          <div className="seller-flow-steps">
            {flowSteps.map((step) => (
              <span key={step.label} className={step.done ? 'active' : ''}>
                {step.label}
              </span>
            ))}
          </div>
          <div className="seller-account-actions">
            <button className="seller-secondary-button" onClick={() => navigate('/sell')}>
              {isAr ? 'رجوع' : 'Back'}
            </button>
            {!isAdvertisingFlow && (
              <button
                className="seller-primary-button"
                disabled={submitState === 'submitting' || !accountReadyForNext}
                onClick={submitAccount}
              >
                {submitState === 'submitting'
                  ? isAr
                    ? 'جار إنشاء الحساب'
                    : 'Creating account'
                  : isAr
                    ? 'التالي'
                    : 'Next'}
              </button>
            )}
            {accountReadyForNext && (
              <button
                className="seller-secondary-button seller-signout-button"
                onClick={() => {
                  window.sessionStorage.clear()
                  window.localStorage.removeItem(AD_PLAN_STORAGE_KEY)
                  navigate('/')
                }}
              >
                {isAr ? 'تسجيل الخروج' : 'Sign out'}
              </button>
            )}
          </div>
        </aside>
      </section>
    </main>
  )
}
