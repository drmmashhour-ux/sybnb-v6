import { useEffect, useMemo, useState } from 'react'
import { phonePlaceholder } from '../../shared/country/presentation'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import {
  confirmOtp,
  createSellerAccountSession,
  fetchSellerOverview,
  getStoredSellerSession,
  requestOtp,
  signOutAllLocalSessions,
  submitSellerPlanProof,
  uploadPaymentProofFile,
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
    label: { ar: 'مطعم', en: 'Restaurant', fr: 'Restaurant' },
    helper: { ar: 'صور المطعم، المنيو، اللوغو، السجل أو الترخيص.', en: 'Restaurant photos, menu, logo, commercial record or license.', fr: 'Photos du restaurant, menu, logo, registre de commerce ou permis.' },
  },
  {
    id: 'hotel',
    label: { ar: 'فندق / ضيافة', en: 'Hotel / hospitality', fr: 'Hôtel / hébergement' },
    helper: { ar: 'صور الغرف والخدمات وترخيص المنشأة.', en: 'Room photos, service photos, and business license.', fr: 'Photos des chambres, photos des services et permis d’exploitation.' },
  },
  {
    id: 'market',
    label: { ar: 'متجر / سوق', en: 'Shop / marketplace', fr: 'Boutique / marché' },
    helper: { ar: 'صور المنتجات، الشعار، وسجل النشاط.', en: 'Product photos, logo, and business registration.', fr: 'Photos des produits, logo et immatriculation de l’entreprise.' },
  },
  {
    id: 'cars',
    label: { ar: 'سيارات / وكيل', en: 'Cars / dealer', fr: 'Voitures / concessionnaire' },
    helper: { ar: 'صور السيارات، رخصة المعرض أو الوكيل، السجل، وملفات المركبات.', en: 'Car photos, showroom or dealer license, registration, and vehicle files.', fr: 'Photos des voitures, permis de salle d’exposition ou de concessionnaire, immatriculation et dossiers des véhicules.' },
  },
  {
    id: 'newProject',
    label: { ar: 'مشروع جديد', en: 'New project', fr: 'Nouveau projet' },
    helper: { ar: 'صور المشروع، المخططات، رخص البناء، التفويض، وملفات الوحدات.', en: 'Project photos, plans, building permits, authorization, and unit files.', fr: 'Photos du projet, plans, permis de construire, mandat et fichiers des unités.' },
  },
  {
    id: 'service',
    label: { ar: 'خدمات', en: 'Services', fr: 'Services' },
    helper: { ar: 'وصف الخدمة، صور العمل، وسجل النشاط.', en: 'Service description, work photos, and business registration.', fr: 'Description du service, photos des réalisations et immatriculation de l’entreprise.' },
  },
] as const
const SELLER_PAYMENT_METHODS = [
  {
    id: 'shamCash',
    label: { ar: 'Sham Cash', en: 'Sham Cash', fr: 'Sham Cash' },
    helper: { ar: 'ادفع عبر شام كاش ثم أكّد مرجع العملية.', en: 'Pay via Sham Cash, then confirm the transaction reference.', fr: 'Payez avec Sham Cash, puis confirmez la référence de la transaction.' },
    destinationTitle: { ar: 'كود شام كاش للدفع', en: 'Sham Cash payment code', fr: 'Code de paiement Sham Cash' },
    destinationCode: 'SYBNB-SHAM-ADV',
    destinationHint: {
      ar: 'ادفع لهذا الكود، واكتب كود المتابعة في ملاحظة العملية.',
      en: 'Pay to this code and write the follow-up code in the transaction note.',
      fr: 'Payez à ce code et inscrivez le code de suivi dans la note de la transaction.',
    },
  },
  {
    id: 'localWallet',
    label: { ar: 'المحفظة المحلية السورية', en: 'Syrian Local Wallet', fr: 'Portefeuille local syrien' },
    helper: { ar: 'ادفع من المحفظة ثم أكّد أن الدفعة تمت.', en: 'Pay from the local wallet, then confirm payment was completed.', fr: 'Payez depuis le portefeuille local, puis confirmez que le paiement a été effectué.' },
    destinationTitle: { ar: 'كود المحفظة المحلية', en: 'Local wallet code', fr: 'Code du portefeuille local' },
    destinationCode: 'SYBNB-WALLET-ADV',
    destinationHint: {
      ar: 'حوّل للمحفظة ثم ارفع صورة تأكيد الدفع.',
      en: 'Transfer to the wallet, then upload the payment confirmation image.',
      fr: 'Effectuez le transfert vers le portefeuille, puis téléversez l’image de confirmation du paiement.',
    },
  },
  {
    id: 'bankTransfer',
    label: { ar: 'تحويل بنكي', en: 'Bank transfer', fr: 'Virement bancaire' },
    helper: { ar: 'حوّل المبلغ ثم احتفظ بإثبات الدفع للرفع في الخطوة التالية.', en: 'Transfer the amount and keep the proof for the next upload step.', fr: 'Virez le montant et conservez la preuve pour l’étape de téléversement suivante.' },
    destinationTitle: { ar: 'مرجع التحويل البنكي', en: 'Bank transfer reference', fr: 'Référence du virement bancaire' },
    destinationCode: 'SYBNB-BANK-ADV',
    destinationHint: {
      ar: 'اكتب كود المتابعة في سبب التحويل.',
      en: 'Write the follow-up code in the transfer reason.',
      fr: 'Inscrivez le code de suivi dans le motif du virement.',
    },
  },
  {
    id: 'creditCard',
    label: { ar: 'بطاقة ائتمان', en: 'Credit card', fr: 'Carte de crédit' },
    helper: { ar: 'ادفع بالبطاقة ثم انتقل لرفع ملفات العقار.', en: 'Pay by card, then continue to upload property files.', fr: 'Payez par carte, puis continuez pour téléverser les fichiers du bien.' },
    destinationTitle: { ar: 'مرجع بوابة البطاقة', en: 'Card gateway reference', fr: 'Référence de la passerelle de paiement par carte' },
    destinationCode: 'SYBNB-CARD-ADV',
    destinationHint: {
      ar: 'استخدم هذا المرجع في صفحة الدفع الآمن.',
      en: 'Use this reference in the secure card payment page.',
      fr: 'Utilisez cette référence sur la page sécurisée de paiement par carte.',
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
  // Real uploaded proof/document URLs (payment-proof:// references) — previously these forms only
  // ever captured file NAMES, so admin had nothing real to review before approving a paid plan or a
  // platform-sale document set.
  const [paymentProofUrls, setPaymentProofUrls] = useState<string[]>([])
  const [accountUploadedUrls, setAccountUploadedUrls] = useState<string[]>([])
  const [proofUploadError, setProofUploadError] = useState('')
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
          pick(lang, `مستند حساب ${index + 1}.pdf`, `account-document-${index + 1}.pdf`, `document-compte-${index + 1}.pdf`),
        )
  // EMAIL is the verification identity (email-only Syria config). Phone is optional contact.
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const accountIdentityReady =
    accountMode === 'signup'
      ? Boolean(
          firstName.trim() &&
            lastName.trim() &&
            emailValid &&
            password.length >= 8 &&
            password === repeatPassword,
        )
      : Boolean(emailValid && password.length >= 8)
  // Every flow now requires a real, backend-approved plan/review proof before it counts as
  // ready — advertising and platform-sale used to skip this via client-only "admin lane" flags.
  const accountReadyForNext =
    accountIdentityReady && mobileCodeConfirmed && accountFileConfirmed && accountSentToAdmin && paymentConfirmed
  const flowSteps = [
    {
      label: accountMode === 'signup' ? (pick(lang, 'إنشاء الحساب', 'Create account', 'Créer le compte')) : pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter'),
      done: accountIdentityReady,
    },
    {
      label: pick(lang, 'إرسال الرمز', 'Send code', 'Envoyer le code'),
      done: mobileCodeSent,
    },
    {
      label: pick(lang, 'تأكيد الرمز', 'Confirm code', 'Confirmer le code'),
      done: mobileCodeConfirmed,
    },
    {
      label: pick(lang, 'رفع مستندات الحساب', 'Upload account documents', 'Téléverser les documents du compte'),
      done: accountDocumentCount > 0 && accountFileConfirmed,
    },
    {
      label: pick(lang, 'إرسال للإدارة', 'Send to admin', 'Envoyer à l’administration'),
      done: accountSentToAdmin,
    },
    {
      label: isPlatformSaleFlow ? (pick(lang, 'إرسال طلب البيع للمراجعة', 'Submit sale request for review', 'Envoyer la demande de vente pour vérification')) : pick(lang, 'رفع تأكيد الدفع', 'Upload payment confirmation', 'Téléverser la confirmation de paiement'),
      done: isPlatformSaleFlow ? sellerProfileStatus !== null : Boolean(paymentReference.trim() && paymentProofAdded),
    },
    {
      label: pick(lang, 'تأكيد الإدارة', 'Admin confirmation', 'Confirmation de l’administration'),
      done: paymentConfirmed,
    },
    {
      label: pick(lang, 'منشور', 'Published', 'Publié'),
      done: accountReadyForNext,
    },
  ]

  async function addAccountDocumentFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    setAccountUploadedFiles((current) => {
      const nextFiles = Array.from(new Set([...current, ...files.map((file) => file.name)]))
      setAccountDocumentCount(nextFiles.length)
      return nextFiles
    })
    setAccountFileReviewed(false)
    setAccountFileConfirmed(false)
    setAccountSentToAdmin(false)
    setSubmitState('idle')
    setSubmitError('')

    const session = getStoredSellerSession()
    if (!session) {
      setProofUploadError(pick(lang, 'سجّل الدخول أولاً لرفع المستندات.', 'Sign in first to upload documents.', 'Connectez-vous d’abord pour téléverser des documents.'))
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setAccountUploadedUrls((current) => [...current, ...urls])
      setProofUploadError('')
    } catch (error) {
      setProofUploadError(error instanceof Error ? error.message : (pick(lang, 'تعذر رفع الملف.', 'Could not upload the file.', 'Impossible de téléverser le fichier.')))
    }
  }

  async function addPaymentProofFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    setPaymentProofFiles((current) => Array.from(new Set([...current, ...files.map((file) => file.name)])))
    setPaymentProofAdded(true)
    setSubmitState('idle')
    setSubmitError('')

    const session = getStoredSellerSession()
    if (!session) {
      setProofUploadError(pick(lang, 'سجّل الدخول أولاً لرفع إثبات الدفع.', 'Sign in first to upload payment proof.', 'Connectez-vous d’abord pour téléverser la preuve de paiement.'))
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setPaymentProofUrls((current) => [...current, ...urls])
      setProofUploadError('')
    } catch (error) {
      setProofUploadError(error instanceof Error ? error.message : (pick(lang, 'تعذر رفع الملف.', 'Could not upload the file.', 'Impossible de téléverser le fichier.')))
    }
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
        proofAssetUrl: paymentProofUrls[0] || paymentProofReference('seller-plan-payment-proof', paymentProofFiles),
        proofAssetUrls: paymentProofUrls,
        planCode: plan.id,
        legalName: `${firstName.trim()} ${lastName.trim()}`.trim() || undefined,
        sellerType: role.id,
      })
      await refreshSellerPlanStatus()
      setPlanSubmitState('idle')
    } catch (error) {
      setPlanSubmitState('error')
      setPlanSubmitError(
        error instanceof Error ? error.message : pick(lang, 'تعذر إرسال الدفع للمراجعة.', 'Could not submit payment for review.', 'Impossible d’envoyer le paiement pour vérification.'),
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
        proofAssetUrl: accountUploadedUrls[0] || paymentProofReference('platform-sale-documents', accountUploadedFiles),
        proofAssetUrls: accountUploadedUrls,
        planCode: 'platform-sale',
        legalName: `${firstName.trim()} ${lastName.trim()}`.trim() || undefined,
        sellerType: role.id,
      })
      await refreshSellerPlanStatus()
      setPlanSubmitState('idle')
    } catch (error) {
      setPlanSubmitState('error')
      setPlanSubmitError(
        error instanceof Error ? error.message : pick(lang, 'تعذر إرسال الطلب للمراجعة.', 'Could not submit the request for review.', 'Impossible d’envoyer la demande pour vérification.'),
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
        accountMode === 'signup' ? pick(lang, 'أدخل الاسم الأول واسم العائلة والبريد الإلكتروني وكلمة مرور من 8 أحرف على الأقل.', 'Enter first name, last name, email, and a password with at least 8 characters.', 'Saisissez le prénom, le nom de famille, l’adresse courriel et un mot de passe d’au moins 8 caractères.') : pick(lang, 'أدخل البريد الإلكتروني وكلمة مرور من 8 أحرف على الأقل.', 'Enter email and a password with at least 8 characters.', 'Saisissez l’adresse courriel et un mot de passe d’au moins 8 caractères.'),
      )
      return
    }

    if (accountMode === 'signup' && password !== repeatPassword) {
      setSubmitState('error')
      setSubmitError(pick(lang, 'كلمة المرور وتأكيد كلمة المرور غير متطابقين.', 'Password and repeated password do not match.', 'Le mot de passe et sa confirmation ne correspondent pas.'))
      return
    }

    if (!mobileCodeSent || !mobileCodeConfirmed) {
      setSubmitState('error')
      setSubmitError(
        pick(lang, 'أرسل رمز التحقق إلى بريدك الإلكتروني ثم أكّده قبل المتابعة.', 'Send the verification code to your email, then confirm it before continuing.', 'Envoyez le code de vérification à votre adresse courriel, puis confirmez-le avant de continuer.'),
      )
      return
    }

    if (accountDocumentCount < 1 || !accountFileReviewed || !accountFileConfirmed) {
      setSubmitState('error')
      setSubmitError(
        pick(lang, 'أضف مستنداً واحداً على الأقل بصيغة PDF أو PNG أو JPG، راجعه، ثم أكّد المستندات قبل الإرسال.', 'Upload at least one document as PDF, PNG, or JPG, review it, then confirm documents before sending.', 'Téléversez au moins un document en PDF, PNG ou JPG, vérifiez-le, puis confirmez les documents avant l’envoi.'),
      )
      return
    }

    if (!accountSentToAdmin) {
      setSubmitState('error')
      setSubmitError(pick(lang, 'أرسل الحساب للإدارة لتأكيده قبل المتابعة.', 'Send the account to admin confirmation before continuing.', 'Envoyez le compte pour confirmation par l’administration avant de continuer.'))
      return
    }

    if (!paymentConfirmed) {
      setSubmitState('error')
      setSubmitError(
        isPlatformSaleFlow
          ? pick(lang, 'يجب أن توافق الإدارة على طلب البيع والمستندات قبل المتابعة.', 'Admin must approve the platform-sale request and documents before continuing.', 'L’administration doit approuver la demande de vente par la plateforme et les documents avant de continuer.')
          : pick(lang, 'ارفع تأكيد الدفع، ثم انتظر موافقة الإدارة الحقيقية قبل المتابعة.', 'Upload payment confirmation, then wait for real admin approval before continuing.', 'Téléversez la confirmation de paiement, puis attendez l’approbation réelle de l’administration avant de continuer.'),
      )
      return
    }

    setSubmitState('submitting')
    setSubmitError('')

    try {
      window.localStorage.setItem(FLOW_STORAGE_KEY, isAdvertisingFlow ? 'advertising' : isPlatformSaleFlow ? 'platform-sale' : 'listing')
      window.localStorage.setItem(AD_PLAN_STORAGE_KEY, isPlatformSaleFlow ? 'platform-sale' : plan.id)
      await createSellerAccountSession({
        displayName: trimmedName || (pick(lang, 'حساب بائع', 'Seller account', 'Compte vendeur')),
        email: trimmedEmail,
        password,
        phone: trimmedPhone || undefined,
        sellerRole: role.id,
        planCode: isPlatformSaleFlow ? 'platform-sale' : plan.id,
      })
      navigate(isPlatformSaleFlow ? '/sell/submitted' : '/sell/listing-wizard')
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : pick(lang, 'تعذر إنشاء الحساب.', 'Unable to create account.', 'Impossible de créer le compte.'))
    }
  }

  return (
    <main className="seller-page seller-account-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-account-head">
        <button className="back-button seller-back" onClick={() => navigate('/')}>
          {pick(lang, 'العودة', 'Back', 'Retour')}
        </button>
        <div className="seller-account-auth-actions" aria-label={pick(lang, 'إجراءات الدخول', 'Login actions', 'Actions de connexion')}>
          <button
            type="button"
            onClick={() => {
              setAccountMode('signin')
              setSubmitState('idle')
              setSubmitError('')
            }}
          >
            {pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter')}
          </button>
          <button
            type="button"
            onClick={async () => {
              // SEC-002: revoke every session this clear() is about to discard before discarding it.
              await signOutAllLocalSessions()
              navigate('/')
            }}
          >
            {pick(lang, 'تسجيل الخروج', 'Sign out', 'Se déconnecter')}
          </button>
        </div>
        <BrandLogo logo="plus" size="nav" />
      </section>

      <section className="seller-account-grid">
        <div className="seller-form-card">
          <p className="eyebrow">
            {isAdvertisingFlow
              ? pick(lang, 'حساب الإعلان', 'Advertising account', 'Compte publicitaire')
              : isPlatformSaleFlow
                ? pick(lang, 'حساب البيع عبر المنصة', 'Platform-managed sale account', 'Compte de vente gérée par la plateforme')
                : pick(lang, 'حساب النشر', 'Publishing account', 'Compte de publication')}
          </p>
          <h1>
            {isAdvertisingFlow
              ? pick(lang, 'أنشئ حساباً لحجز مساحة إعلانية', 'Create an account to book advertising', 'Créez un compte pour réserver de la publicité')
              : isPlatformSaleFlow
                ? pick(lang, 'أنشئ حساباً لبيع العقار عبر SYBNB', 'Create an account to sell through SYBNB', 'Créez un compte pour vendre par l’intermédiaire de SYBNB')
                : pick(lang, 'أنشئ حساباً لإكمال النشر', 'Create an account to continue listing', 'Créez un compte pour poursuivre la publication')}
          </h1>
          <p>
            {isAdvertisingFlow
              ? pick(lang, 'أنشئ الحساب، أكّد رمز البريد الإلكتروني، أضف مستندات الحساب، ثم أكّد الدفع قبل إرسال الطلب للإدارة.', 'Create the account, verify the email code, add account documents, then confirm payment before admin review.', 'Créez le compte, vérifiez le code reçu par courriel, ajoutez les documents du compte, puis confirmez le paiement avant la vérification par l’administration.')
              : isPlatformSaleFlow
                ? pick(lang, 'أنشئ الحساب، أكّد رمز البريد، ارفع إثبات الملكية أو التفويض، ثم ترسل الإدارة كود المتابعة وتستلم SYBNB إدارة البيع.', 'Create the account, verify the email code, upload ownership or authorization, then admin confirms the follow-up code and SYBNB manages the sale.', 'Créez le compte, vérifiez le code reçu par courriel, téléversez la preuve de propriété ou le mandat ; l’administration confirme ensuite le code de suivi et SYBNB gère la vente.')
                : pick(lang, 'بعد إنشاء الحساب، اختر طريقة الدفع، أكّد الدفع، ثم أضف ملفات العقار والتفويض قبل المراجعة.', 'After account creation, choose a payment method, confirm payment, then add property and authorization files before review.', 'Après la création du compte, choisissez un mode de paiement, confirmez le paiement, puis ajoutez les fichiers du bien et du mandat avant la vérification.')}
          </p>
          <div className="seller-account-mode-switch" role="tablist" aria-label={pick(lang, 'طريقة الدخول', 'Account access mode', 'Mode d’accès au compte')}>
            <button
              className={accountMode === 'signup' ? 'active' : ''}
              type="button"
              onClick={() => {
                setAccountMode('signup')
                setSubmitState('idle')
                setSubmitError('')
              }}
            >
              {pick(lang, 'تسجيل حساب جديد', 'Sign up', 'S’inscrire')}
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
              {pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter')}
            </button>
          </div>

          {isAdvertisingFlow ? (
            <div className="seller-selected-role" style={{ '--accent': '#d5a915' } as CSSVars}>
              <span>{pick(lang, 'المسار المختار', 'Selected path', 'Parcours choisi')}</span>
              <strong>{pick(lang, 'عميل إعلاني', 'Advertising client', 'Client publicitaire')}</strong>
              <small>
                {pick(lang, 'يريد حجز بانر أو مساحة إعلانية داخل المنصة.', 'Books a banner or promotional placement inside the platform.', 'Réserve une bannière ou un emplacement promotionnel sur la plateforme.')}
              </small>
            </div>
          ) : isPlatformSaleFlow ? (
            <div className="seller-selected-role" style={{ '--accent': '#20d29b' } as CSSVars}>
              <span>{pick(lang, 'المسار المختار', 'Selected path', 'Parcours choisi')}</span>
              <strong>{pick(lang, 'البيع عبر المنصة', 'Sell by platform', 'Vente par la plateforme')}</strong>
              <small>
                {pick(lang, `${role.label[lang]} - SYBNB تراجع المستندات وتدير عملية البيع بعد الموافقة، وعمولة المنصة 5% عند إتمام البيع.`, `${role.label[lang]} - SYBNB reviews documents and manages the sale after approval, with a 5% platform commission when the sale closes.`, `${role.label[lang]} - SYBNB vérifie les documents et gère la vente après approbation, avec une commission de plateforme de 5 % à la conclusion de la vente.`)}
              </small>
            </div>
          ) : (
            <div className="seller-selected-role" style={{ '--accent': role.accent } as CSSVars}>
              <span>{pick(lang, 'الدور المختار', 'Selected role', 'Rôle choisi')}</span>
              <strong>{role.label[lang]}</strong>
              <small>{role.description[lang]}</small>
            </div>
          )}

          {isAdvertisingFlow && (
            <div className="seller-business-type-panel">
              <div>
                <strong>{pick(lang, 'نوع النشاط الإعلاني', 'Advertising business type', 'Type d’activité publicitaire')}</strong>
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
                  <span>{pick(lang, 'الاسم الأول', 'First name', 'Prénom')}</span>
                  <input
                    autoComplete="given-name"
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={pick(lang, 'مثال: سارة', 'e.g. Sara', 'ex. : Sara')}
                    type="text"
                    value={firstName}
                  />
                </label>
                <label>
                  <span>{pick(lang, 'اسم العائلة', 'Last name', 'Nom de famille')}</span>
                  <input
                    autoComplete="family-name"
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={pick(lang, 'مثال: محمود', 'e.g. Mahmoud', 'ex. : Mahmoud')}
                    type="text"
                    value={lastName}
                  />
                </label>
              </>
            )}
            <label>
              <span>{pick(lang, 'البريد الإلكتروني', 'Email', 'Courriel')}</span>
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
              <span>{pick(lang, 'رقم الهاتف (اختياري)', 'Phone number (optional)', 'Numéro de téléphone (facultatif)')}</span>
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
                <span>{pick(lang, 'كلمة المرور', 'Password', 'Mot de passe')}</span>
                <input
                  autoComplete={accountMode === 'signup' ? 'new-password' : 'current-password'}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={accountMode === 'signup' ? (pick(lang, 'إنشاء كلمة مرور', 'Create password', 'Créer un mot de passe')) : pick(lang, 'كلمة مرور الحساب', 'Account password', 'Mot de passe du compte')}
                  type="password"
                  value={password}
                />
              </label>
              {accountMode === 'signup' && (
                <label>
                  <span>{pick(lang, 'تأكيد كلمة المرور', 'Repeat password', 'Confirmer le mot de passe')}</span>
                  <input
                    autoComplete="new-password"
                    onChange={(event) => setRepeatPassword(event.target.value)}
                    placeholder={pick(lang, 'أعد كتابة كلمة المرور', 'Repeat password', 'Confirmer le mot de passe')}
                    type="password"
                    value={repeatPassword}
                  />
                </label>
              )}
            </div>
            <div className="seller-verification-box">
              <div>
                <strong>{pick(lang, 'توثيق البريد الإلكتروني', 'Email verification', 'Vérification du courriel')}</strong>
                <span>
                  {mobileCodeSent
                    ? pick(lang, `تم إرسال رمز التحقق إلى بريدك الإلكتروني ${email.trim()}. أدخل الرمز المستلم.`, `Verification code sent to your email ${email.trim()}. Enter the received code.`, `Code de vérification envoyé à votre adresse ${email.trim()}. Saisissez le code reçu.`)
                    : pick(lang, 'أرسل رمز تحقق إلى بريدك الإلكتروني قبل إنشاء الحساب.', 'Send a verification code to your email before creating the account.', 'Envoyez un code de vérification à votre adresse courriel avant de créer le compte.')}
                </span>
              </div>
              <button
                type="button"
                disabled={!emailValid}
                onClick={async () => {
                  try {
                    await requestOtp({ email: email.trim(), purpose: 'seller-login' })
                    setMobileCodeSent(true)
                    setMobileCode('')
                    setMobileCodeConfirmed(false)
                    setAccountSentToAdmin(false)
                    setSubmitState('idle')
                    setSubmitError('')
                  } catch (err) {
                    setSubmitState('error')
                    setSubmitError(err instanceof Error ? err.message : pick(lang, 'تعذر إرسال الرمز.', 'Could not send code.', 'Impossible d’envoyer le code.'))
                  }
                }}
              >
                {mobileCodeSent ? (pick(lang, 'إعادة إرسال الرمز', 'Resend code', 'Renvoyer le code')) : pick(lang, 'إرسال الرمز إلى البريد', 'Email me the code', 'M’envoyer le code par courriel')}
              </button>
              <label>
                <small>{pick(lang, 'رمز التحقق', 'Verification code', 'Code de vérification')}</small>
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
                    const ok = await confirmOtp({ email: email.trim(), purpose: 'seller-login', code: mobileCode.trim() })
                    if (!ok) {
                      setSubmitState('error')
                      setSubmitError(pick(lang, 'الرمز غير صحيح.', 'The code is not correct.', 'Le code est incorrect.'))
                      return
                    }
                  } catch (err) {
                    setSubmitState('error')
                    setSubmitError(err instanceof Error ? err.message : pick(lang, 'الرمز غير صحيح.', 'The code is not correct.', 'Le code est incorrect.'))
                    return
                  }
                  setSubmitState('idle')
                  setSubmitError('')
                  setMobileCodeConfirmed(true)
                  setAccountSentToAdmin(false)
                }}
              >
                {mobileCodeConfirmed ? (pick(lang, 'تم تأكيد الرمز', 'Code confirmed', 'Code confirmé')) : pick(lang, 'تأكيد الرمز', 'Confirm code', 'Confirmer le code')}
              </button>
            </div>
            <div className={`seller-account-file-box ${accountFileConfirmed ? 'confirmed' : ''}`}>
              <div>
                <strong>
                  {isAdvertisingFlow
                    ? pick(lang, 'مستندات وصور الإعلان', 'Advertising documents and photos', 'Documents et photos publicitaires')
                    : isPlatformSaleFlow ? pick(lang, 'مستندات البيع عبر المنصة', 'Platform sale documents', 'Documents de vente par la plateforme') : pick(lang, 'مستندات وصور البائع والعقار', 'Seller and property documents', 'Documents du vendeur et du bien')}
                </strong>
                <span>
                  {!isAdvertisingFlow
                    ? isPlatformSaleFlow ? pick(lang, 'ارفع إثبات الملكية أو التفويض وصور العقار أو المنتج وأي عقد يثبت حق SYBNB في إدارة البيع.', 'Upload ownership proof or authorization, property/product photos, and any agreement proving SYBNB can manage the sale.', 'Téléversez la preuve de propriété ou le mandat, les photos du bien ou du produit, et toute entente attestant que SYBNB peut gérer la vente.') : pick(lang, 'ارفع إثبات الملكية، التفويض، صور العقار، المخططات، أو ملفات السيارة/المشروع بصيغة PDF أو PNG أو JPG.', 'Upload ownership proof, authorization, property photos, plans, or car/project files as PDF, PNG, or JPG.', 'Téléversez la preuve de propriété, le mandat, les photos du bien, les plans ou les fichiers du véhicule ou du projet en PDF, PNG ou JPG.')
                    : businessType === 'restaurant'
                    ? pick(lang, 'ارفع صور المطعم، المنيو، اللوغو، السجل التجاري أو الترخيص بصيغة PDF أو PNG أو JPG.', 'Upload restaurant photos, menu, logo, commercial record or license as PDF, PNG, or JPG.', 'Téléversez les photos du restaurant, le menu, le logo, le registre de commerce ou le permis en PDF, PNG ou JPG.')
                    : selectedBusinessType.helper[lang]}
                </span>
              </div>
              {adminFollowCode && (
                <div className="seller-admin-follow-code">
                  <span>{pick(lang, 'كود المتابعة مع الإدارة', 'Admin follow-up code', 'Code de suivi avec l’administration')}</span>
                  <strong dir="ltr">{adminFollowCode}</strong>
                </div>
              )}
              <PaymentProofUpload
                cta={
                  isAdvertisingFlow
                    ? pick(lang, 'رفع مستندات الحساب والإعلان', 'Upload account and advertising documents', 'Téléverser les documents du compte et de la publicité')
                    : isPlatformSaleFlow ? pick(lang, 'رفع مستندات البيع عبر المنصة', 'Upload platform-sale documents', 'Téléverser les documents de vente par la plateforme') : pick(lang, 'رفع مستندات الحساب والعقار', 'Upload account and property documents', 'Téléverser les documents du compte et du bien')
                }
                emptyText={pick(lang, 'لم يتم رفع أي مستند بعد. ارفع ملف PDF أو PNG أو JPG.', 'No documents uploaded yet. Upload PDF, PNG, or JPG.', 'Aucun document téléversé pour l’instant. Téléversez un PDF, PNG ou JPG.')}
                files={visibleAccountFiles}
                help={
                  !isAdvertisingFlow
                    ? isPlatformSaleFlow ? pick(lang, 'ارفع هوية المالك، التفويض، صور العقار أو المنتج، وأي مستند يوضح السعر المطلوب وشروط البيع. يمكن رفع أكثر من ملف.', 'Upload owner ID, authorization, property or product photos, and any document showing asking price and sale terms. Multiple files are allowed.', 'Téléversez la pièce d’identité du propriétaire, le mandat, les photos du bien ou du produit, et tout document indiquant le prix demandé et les conditions de vente. Plusieurs fichiers sont acceptés.') : pick(lang, 'ارفع مستندات المالك، التفويض، صور العقار، ملفات السيارة، أو ملفات المشروع الجديد. يمكن رفع أكثر من ملف.', 'Upload owner documents, authorization, property photos, car files, or new-project files. Multiple files are allowed.', 'Téléversez les documents du propriétaire, le mandat, les photos du bien, les fichiers du véhicule ou du nouveau projet. Plusieurs fichiers sont acceptés.')
                    : businessType === 'restaurant'
                    ? pick(lang, 'ارفع صور المطعم، المنيو، اللوغو، السجل التجاري أو الترخيص.', 'Upload restaurant photos, menu, logo, commercial record, or license.', 'Téléversez les photos du restaurant, le menu, le logo, le registre de commerce ou le permis.')
                    : selectedBusinessType.helper[lang]
                }
                lang={lang}
                onAddFiles={(files) => void addAccountDocumentFiles(files)}
                title={
                  isAdvertisingFlow
                    ? pick(lang, 'مستندات وصور الإعلان', 'Advertising documents and photos', 'Documents et photos publicitaires')
                    : isPlatformSaleFlow ? pick(lang, 'مستندات البيع عبر المنصة', 'Platform sale documents', 'Documents de vente par la plateforme') : pick(lang, 'مستندات وصور البائع والعقار', 'Seller and property documents', 'Documents du vendeur et du bien')
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
                  {pick(lang, 'حذف آخر مستند', 'Remove last document', 'Supprimer le dernier document')}
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
                {accountFileReviewed ? (pick(lang, 'تمت مراجعة المستند', 'Document reviewed', 'Document vérifié')) : pick(lang, 'مراجعة المستند', 'Review document', 'Vérifier le document')}
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
                {accountFileConfirmed ? (pick(lang, 'تم تأكيد المستند', 'Document confirmed', 'Document confirmé')) : pick(lang, 'تأكيد المستند', 'Confirm document', 'Confirmer le document')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!accountFileConfirmed) {
                    setSubmitState('error')
                    setSubmitError(
                      pick(lang, 'ارفع مستندات الحساب، راجعها، ثم أكّدها. بعدها زر الإرسال سيرسل الملفات للإدارة مباشرة.', 'Upload, review, and confirm account documents. Then Send will send the files directly to admin.', 'Téléversez, vérifiez et confirmez les documents du compte. Le bouton Envoyer transmettra ensuite les fichiers directement à l’administration.'),
                    )
                    return
                  }
                  setSubmitState('idle')
                  setSubmitError('')
                  setAccountSentToAdmin(true)
                  setAdminFollowCode((current) => current || createAdminFollowCode())
                }}
              >
                {accountSentToAdmin ? (pick(lang, 'تم إرسال الملفات للإدارة', 'Files sent to admin', 'Fichiers envoyés à l’administration')) : pick(lang, 'إرسال الملفات للإدارة', 'Send files to admin', 'Envoyer les fichiers à l’administration')}
              </button>
            </div>
          </div>
          {submitState === 'error' && (
            <div className="seller-inline-alert seller-account-alert">
              <strong>{pick(lang, 'تعذر إنشاء الحساب', 'Account could not be created', 'Le compte n’a pas pu être créé')}</strong>
              <span>{submitError}</span>
            </div>
          )}
        </div>

        <aside className="seller-plan-card" style={{ '--accent': isPlatformSaleFlow ? '#20d29b' : plan.accent } as CSSVars}>
          <p className="eyebrow">
            {isPlatformSaleFlow
              ? pick(lang, 'بيع عبر المنصة', 'Sell by platform', 'Vente par la plateforme')
              : isAdvertisingFlow
                ? pick(lang, 'اختر خطة الإعلان', 'Choose advertising plan', 'Choisir un forfait publicitaire')
                : pick(lang, 'اختر خطة النشر', 'Choose publishing plan', 'Choisir un forfait de publication')}
          </p>
          {isPlatformSaleFlow ? (
            <>
              <div className="seller-plan-detail seller-platform-sale-panel">
                <h2>{pick(lang, 'SYBNB تدير البيع', 'SYBNB-managed sale', 'Vente gérée par SYBNB')}</h2>
                <ul>
                  <li>{pick(lang, 'لا توجد خطة نشر مقدماً لهذا المسار.', 'No publishing plan is charged upfront in this path.', 'Aucun forfait de publication n’est facturé d’avance dans ce parcours.')}</li>
                  <li>{pick(lang, 'الإدارة تراجع الملكية والتفويض والسعر المطلوب.', 'Admin reviews ownership, authorization, and asking price.', 'L’administration vérifie la propriété, le mandat et le prix demandé.')}</li>
                  <li>{pick(lang, 'بعد الموافقة، يتابع فريق المنصة التواصل والبيع حسب الاتفاق، وتطبق عمولة 5% عند إتمام البيع.', 'After approval, the platform team manages communication and sale according to the agreement, with a 5% commission when the sale closes.', 'Après approbation, l’équipe de la plateforme gère la communication et la vente conformément à l’entente, avec une commission de 5 % à la conclusion de la vente.')}</li>
                </ul>
              </div>
              <div className="seller-payment-note">
                <strong>{pick(lang, 'مراجعة الإدارة', 'Admin review', 'Vérification par l’administration')}</strong>
                <span>
                  {pick(lang, 'هذا المسار لا ينتقل إلى بوابة دفع الخطة. الإجراء المطلوب هو اعتماد المستندات وكود المتابعة.', 'This path does not enter plan payment. The required action is document approval and follow-up code confirmation.', 'Ce parcours ne comporte pas de paiement de forfait. L’action requise est l’approbation des documents et la confirmation du code de suivi.')}
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
                <strong>{pick(lang, 'طرق الدفع المتاحة', 'Available payment methods', 'Modes de paiement disponibles')}</strong>
                <span>{pick(lang, 'اختر الطريقة لفتح صفحة الدفع المالية الآمنة.', 'Choose a method to open the secure financial payment page.', 'Choisissez un mode pour ouvrir la page de paiement sécurisée.')}</span>
              </div>
              <div className="seller-payment-methods" aria-label={pick(lang, 'اختيار طريقة الدفع', 'Choose payment method', 'Choisir le mode de paiement')}>
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
                {pick(lang, 'بعد إرسال المستندات، يراجعها فريق SYBNB الحقيقي عبر لوحة الإدارة قبل فتح متابعة البيع.', 'After documents are sent, the real SYBNB team reviews them from the admin dashboard before opening sale follow-up.', 'Une fois les documents envoyés, l’équipe SYBNB les vérifie depuis le tableau de bord d’administration avant d’ouvrir le suivi de la vente.')}
              </span>
              {sellerProfileStatus === 'APPROVED' ? (
                <div className="seller-admin-waiting-panel confirmed">
                  <strong>{pick(lang, 'وافقت الإدارة على طلب البيع', 'Admin approved the sale request', 'L’administration a approuvé la demande de vente')}</strong>
                  <span>{pick(lang, 'سيتواصل فريق SYBNB معك لمتابعة تفاصيل البيع.', 'The SYBNB team will contact you to follow up on sale details.', 'L’équipe SYBNB communiquera avec vous pour assurer le suivi des détails de la vente.')}</span>
                </div>
              ) : sellerProfileStatus === 'PENDING_REVIEW' ? (
                <div className="seller-admin-waiting-panel">
                  <strong>{pick(lang, 'بانتظار مراجعة الإدارة', 'Waiting for admin review', 'En attente de vérification par l’administration')}</strong>
                  <span>
                    {pick(lang, 'تم إرسال الطلب لفريق SYBNB الحقيقي. لا يمكن للعميل أو البائع تأكيد هذا الطلب من هنا.', 'The request was sent to the real SYBNB team. The buyer or seller cannot confirm it from this page.', 'La demande a été envoyée à l’équipe SYBNB. Ni l’acheteur ni le vendeur ne peuvent la confirmer depuis cette page.')}
                  </span>
                  <button type="button" disabled={planSubmitState === 'saving'} onClick={() => void refreshSellerPlanStatus()}>
                    {pick(lang, 'تحديث حالة المراجعة', 'Refresh review status', 'Actualiser le statut de la vérification')}
                  </button>
                </div>
              ) : (
                <div className="seller-admin-waiting-panel">
                  <strong>{pick(lang, 'إرسال طلب البيع للمراجعة', 'Submit sale request for review', 'Envoyer la demande de vente pour vérification')}</strong>
                  <span>
                    {sellerProfileStatus === 'REJECTED'
                      ? pick(lang, 'رفضت الإدارة الطلب السابق. راجع المستندات ثم أعد الإرسال.', 'Admin rejected the previous request. Review the documents, then resubmit.', 'L’administration a refusé la demande précédente. Vérifiez les documents, puis renvoyez-la.')
                      : pick(lang, 'أرسل المستندات المرفوعة أعلاه لمراجعة حقيقية من فريق SYBNB.', 'Send the documents uploaded above for a real SYBNB team review.', 'Envoyez les documents téléversés ci-dessus pour qu’ils soient vérifiés par l’équipe SYBNB.')}
                  </span>
                  {planSubmitState === 'error' && <small className="seller-plan-error">{planSubmitError}</small>}
                  <button type="button" disabled={!accountSentToAdmin || planSubmitState === 'saving'} onClick={() => void submitPlatformSaleRequest()}>
                    {planSubmitState === 'saving' ? (pick(lang, 'جارٍ الإرسال...', 'Submitting...', 'Envoi...')) : pick(lang, 'إرسال للمراجعة', 'Submit for review', 'Envoyer pour vérification')}
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
                {paymentMethod.destinationHint[lang]} {pick(lang, 'كود المتابعة:', 'Follow-up code:', 'Code de suivi :')}{' '}
                <b dir="ltr">{adminFollowCode}</b>
              </small>
            </div>
            <div className="seller-payment-amount-box">
              <div>
                <span>{pick(lang, 'المبلغ المطلوب', 'Payment amount', 'Montant du paiement')}</span>
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
                <span>{pick(lang, 'أؤكد أن المبلغ صحيح قبل الدفع', 'I confirm this amount before paying', 'Je confirme ce montant avant de payer')}</span>
              </label>
              <button
                className="seller-pay-now-button"
                disabled={!paymentAmountConfirmed}
                onClick={() => {
                  setPaymentStarted(true)
                  setPaymentReference((current) => current || `${paymentMethod.destinationCode}-${adminFollowCode}`)
                }}
              >
                {paymentStarted ? (pick(lang, 'تم بدء الدفع', 'Payment started', 'Paiement commencé')) : pick(lang, 'ادفع الآن', 'Pay now', 'Payer maintenant')}
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
                <div className="seller-sham-qr" aria-label={pick(lang, 'رمز QR شام كاش', 'Sham Cash QR', 'Code QR Sham Cash')}>
                  {Array.from({ length: 49 }, (_, index) => (
                    <i key={index} className={(index + adminFollowCode.length + paymentMethod.destinationCode.length) % 3 === 0 ? 'on' : ''} />
                  ))}
                </div>
                <div>
                  <strong>{pick(lang, 'امسح QR أو ادفع بالكود', 'Scan QR or pay by code', 'Scannez le code QR ou payez avec le code')}</strong>
                  <span dir="ltr">{paymentMethod.destinationCode}</span>
                  <small>{pick(lang, 'اكتب هذا الكود في ملاحظة الدفع:', 'Write this code in the payment note:', 'Inscrivez ce code dans la note du paiement :')} <b dir="ltr">{adminFollowCode}</b></small>
                </div>
              </div>
            )}
            {selectedPaymentMethod === 'localWallet' && (
              <div className="seller-method-instructions">
                <strong>{pick(lang, 'خطوات المحفظة', 'Wallet steps', 'Étapes du portefeuille')}</strong>
                <span>{pick(lang, 'افتح المحفظة المحلية، حوّل إلى الكود أعلاه، ثم ارفع صورة تأكيد الدفع.', 'Open the local wallet, transfer to the code above, then upload the payment confirmation image.', 'Ouvrez le portefeuille local, effectuez le transfert vers le code ci-dessus, puis téléversez l’image de confirmation du paiement.')}</span>
              </div>
            )}
            {selectedPaymentMethod === 'bankTransfer' && (
              <div className="seller-method-instructions">
                <strong>{pick(lang, 'بيانات التحويل', 'Transfer details', 'Détails du virement')}</strong>
                <span>{pick(lang, 'استخدم مرجع التحويل أعلاه وضع كود المتابعة في سبب التحويل.', 'Use the reference above and put the follow-up code in the transfer reason.', 'Utilisez la référence ci-dessus et indiquez le code de suivi dans le motif du virement.')}</span>
              </div>
            )}
            {selectedPaymentMethod === 'creditCard' && (
              <div className="seller-card-payment-form">
                <div className="seller-card-amount">
                  <span>{pick(lang, 'المبلغ المطلوب', 'Amount due', 'Montant dû')}</span>
                  <strong>{planAmountLabel}</strong>
                </div>
                <label>
                  <small>{pick(lang, 'اسم حامل البطاقة', 'Cardholder name', 'Nom du titulaire de la carte')}</small>
                  <input value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} placeholder={pick(lang, 'الاسم كما هو على البطاقة', 'Name on card', 'Nom figurant sur la carte')} />
                </label>
                <label>
                  <small>{pick(lang, 'رقم البطاقة', 'Card number', 'Numéro de carte')}</small>
                  <input dir="ltr" inputMode="numeric" maxLength={19} value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} placeholder="4242 4242 4242 4242" />
                </label>
                <div className="seller-card-row">
                  <label>
                    <small>{pick(lang, 'تاريخ الانتهاء', 'Expiry date', 'Date d’expiration')}</small>
                    <input dir="ltr" inputMode="numeric" maxLength={5} value={cardExpiry} onChange={(event) => setCardExpiry(event.target.value)} placeholder="MM/YY" />
                  </label>
                  <label>
                    <small>{pick(lang, 'CVV', 'CVV', 'CVV')}</small>
                    <input dir="ltr" inputMode="numeric" maxLength={4} value={cardCvv} onChange={(event) => setCardCvv(event.target.value)} placeholder="123" />
                  </label>
                </div>
              </div>
            )}
            <label className="seller-payment-reference">
              <small>{pick(lang, 'رقم العملية / المرجع', 'Transaction / reference number', 'Numéro de transaction / de référence')}</small>
              <input
                dir="ltr"
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder={selectedPaymentMethod === 'shamCash' ? 'SC-2026-0042' : 'PAY-2026-0042'}
                value={paymentReference}
              />
            </label>
            <PaymentProofUpload
              cta={pick(lang, 'رفع تأكيد الدفع', 'Upload payment confirmation', 'Téléverser la confirmation de paiement')}
              disabled={!paymentStarted}
              emptyText={pick(lang, 'لم يتم رفع تأكيد الدفع بعد.', 'No payment confirmation uploaded yet.', 'Aucune confirmation de paiement téléversée pour l’instant.')}
              files={paymentProofFiles}
              help={pick(lang, 'ارفع إيصال الدفع أو صورة التحويل قبل موافقة الإدارة.', 'Upload payment receipt or transfer screenshot before admin approval.', 'Téléversez le reçu de paiement ou une capture d’écran du virement avant l’approbation de l’administration.')}
              lang={lang}
              onAddFiles={(files) => void addPaymentProofFiles(files)}
              title={pick(lang, 'مستندات الدفع', 'Payment documents', 'Documents de paiement')}
            />
            {sellerProfileStatus === 'APPROVED' ? (
              <div className="seller-admin-waiting-panel confirmed">
                <strong>{pick(lang, 'تم تأكيد الدفع من الإدارة', 'Payment confirmed by admin', 'Paiement confirmé par l’administration')}</strong>
                <span>{pick(lang, 'يمكنك المتابعة لإنهاء فتح الحساب.', 'You can continue to finish opening the account.', 'Vous pouvez continuer pour finaliser l’ouverture du compte.')}</span>
              </div>
            ) : sellerProfileStatus === 'PENDING_REVIEW' ? (
              <div className="seller-admin-waiting-panel">
                <strong>{pick(lang, 'بانتظار مراجعة الإدارة', 'Waiting for admin review', 'En attente de vérification par l’administration')}</strong>
                <span>
                  {pick(lang, 'تم إرسال إثبات الدفع لفريق SYBNB. لا يمكن لأحد غير الإدارة تأكيد استلام المال.', 'Payment proof was sent to the SYBNB team. Only admin can confirm money received.', 'La preuve de paiement a été envoyée à l’équipe SYBNB. Seule l’administration peut confirmer la réception des fonds.')}
                </span>
                <button type="button" disabled={planSubmitState === 'saving'} onClick={() => void refreshSellerPlanStatus()}>
                  {pick(lang, 'تحديث حالة المراجعة', 'Refresh review status', 'Actualiser le statut de la vérification')}
                </button>
              </div>
            ) : (
              <div className="seller-admin-waiting-panel">
                <strong>{pick(lang, 'إرسال الدفع للمراجعة', 'Submit payment for review', 'Envoyer le paiement pour vérification')}</strong>
                <span>
                  {sellerProfileStatus === 'REJECTED'
                    ? pick(lang, 'رفضت الإدارة الإثبات السابق. ارفع مرجعاً وإثباتاً جديدين ثم أعد الإرسال.', 'Admin rejected the previous proof. Upload a new reference and proof, then resubmit.', 'L’administration a refusé la preuve précédente. Téléversez une nouvelle référence et une nouvelle preuve, puis renvoyez-les.')
                    : pick(lang, 'أدخل رقم العملية وارفع الإثبات أعلاه، ثم أرسله للمراجعة الحقيقية من فريق SYBNB.', 'Enter the transaction reference and upload proof above, then submit it for real SYBNB team review.', 'Saisissez la référence de la transaction et téléversez la preuve ci-dessus, puis envoyez-la pour vérification par l’équipe SYBNB.')}
                </span>
                {planSubmitState === 'error' && <small className="seller-plan-error">{planSubmitError}</small>}
                <button
                  type="button"
                  disabled={!paymentReference.trim() || !paymentProofAdded || planSubmitState === 'saving'}
                  onClick={() => void submitPlanPayment()}
                >
                  {planSubmitState === 'saving' ? (pick(lang, 'جارٍ الإرسال...', 'Submitting...', 'Envoi...')) : pick(lang, 'إرسال للمراجعة', 'Submit for review', 'Envoyer pour vérification')}
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
              {pick(lang, 'رجوع', 'Back', 'Retour')}
            </button>
            {!isAdvertisingFlow && (
              <button
                className="seller-primary-button"
                disabled={submitState === 'submitting' || !accountReadyForNext}
                onClick={submitAccount}
              >
                {submitState === 'submitting'
                  ? pick(lang, 'جار إنشاء الحساب', 'Creating account', 'Création du compte')
                  : pick(lang, 'التالي', 'Next', 'Suivant')}
              </button>
            )}
            {accountReadyForNext && (
              <button
                className="seller-secondary-button seller-signout-button"
                onClick={async () => {
                  // SEC-002: server-side revocation before the local clear (see above).
                  await signOutAllLocalSessions()
                  window.localStorage.removeItem(AD_PLAN_STORAGE_KEY)
                  navigate('/')
                }}
              >
                {pick(lang, 'تسجيل الخروج', 'Sign out', 'Se déconnecter')}
              </button>
            )}
          </div>
        </aside>
      </section>
    </main>
  )
}
