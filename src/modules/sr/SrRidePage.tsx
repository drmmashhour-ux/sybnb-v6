import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { srRideFilterGroupsFromConfig, type VisualFilterSelection } from '../../engines/filters'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  cancelPrototypeSrRide,
  confirmStripePayment,
  createPrototypeSrRide,
  createSavedPlace,
  createStripeRideCheckoutSession,
  deleteSavedPlace,
  enablePushNotifications,
  fetchBusinessMembership,
  fetchPrototypeSrRide,
  fetchPrototypeSrRideThread,
  fetchSavedPlaces,
  fetchSrQuote,
  fetchStripePaymentStatus,
  resolveApiUrl,
  sendPrototypeSrRideMessage,
  sharePrototypeSrRide,
  submitPrototypeLocalWalletProof,
  submitPrototypeSrRideReview,
  triggerSrSos,
  type PlatformMessage,
  type PlatformRideRequest,
  type PlatformSavedPlace,
  type PlatformSrQuote,
} from '../../shared/api/platformApi'

const ACTIVE_RIDE_STATUSES = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const RIDER_CANCELLABLE_STATUSES = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING']
// Matches MESSAGING_ELIGIBLE_RIDE_STATUSES in server/routes/messages.mjs.
const MESSAGING_ELIGIBLE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']
// Matches LIVE_TRACKING_STATUSES in server/routes/sr-rides.mjs.
const LIVE_TRACKING_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
import { moneyText, statusText } from '../../shared/i18n/display'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { RideMap } from '../../shared/maps/RideMap'
import { isSrRideLocationConfirmed, type SrRideLocationSource } from './srRideLocationGuard'
import { srFallbackFareMinor } from './srFareModel'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'سير',
    subtitle: 'طلب رحلة حقيقي محفوظ، يُعرض مباشرة على السائقين المتاحين ليقبلوه بأنفسهم.',
    mode: 'وضع بيانات منخفض',
    pickup: 'نقطة الانطلاق',
    dropoff: 'الوجهة',
    category: 'الفئة',
    fare: 'الأجرة التقديرية',
    distance: 'المسافة التقديرية',
    distanceApprox: '(تقريبية بحسب العنوان)',
    addressUnrecognized: 'تعذّر التعرف على العنوان المدخل. السعر والمسافة تقدير افتراضي وليسا مبنيين على عنوانك الفعلي — تحقق من كتابة اسم الحي بشكل صحيح.',
    request: 'طلب الرحلة',
    refresh: 'تحديث الحالة',
    status: 'حالة الرحلة',
    rideId: 'رقم الرحلة',
    driver: 'السائق',
    location: 'الموقع',
    accuracy: 'دقة الموقع',
    saved: 'تم حفظ الرحلة',
    error: 'تعذر تنفيذ طلب SR',
    saving: 'جار الحفظ',
    gps: 'استخدام موقعي الحالي',
    manualHint: 'يمكن متابعة الطلب حتى بدون GPS عبر العناوين اليدوية.',
    locationNotConfirmed: 'يرجى تأكيد نقطة الانطلاق والوجهة (بالكتابة أو عبر GPS) قبل طلب الرحلة.',
    driverNotAssigned: 'لم يُعيّن سائق بعد',
    verifiedDriver: 'هوية موثقة',
    waitingForDriver: 'بانتظار قبول أحد السائقين القريبين للرحلة...',
    stillLooking: 'ما زلنا نبحث عن سائق. يمكنك متابعة الانتظار أو إلغاء الطلب.',
    etaPrefix: 'على بُعد ~',
    etaSuffix: ' دقيقة',
    driverAssigned: 'تم تعيين سائق لرحلتك.',
    driverArriving: 'السائق في طريقه إليك الآن.',
    inProgress: 'الرحلة جارية الآن.',
    completed: 'اكتملت الرحلة. شكراً لاستخدامك سير.',
    receiptFare: 'المبلغ المدفوع',
    receiptDistance: 'المسافة',
    payTitle: 'تأكيد الدفع',
    payCopy: 'ادفع الأجرة للسائق مباشرة (نقداً أو تحويل)، ثم أدخل رقم مرجع العملية هنا ليتحقق منها فريق SYBNB.',
    payReferencePlaceholder: 'رقم مرجع العملية',
    payCashButton: 'دفعت نقداً للسائق',
    payCardButton: 'الدفع بالبطاقة',
    payCardRedirecting: 'جارٍ التحويل إلى الدفع…',
    payCardConfirming: 'جارٍ تأكيد الدفع…',
    payCashHint: 'أو ادفع نقداً مباشرةً للسائق، ثم أكّد هنا. سيتحقق فريق SYBNB.',
    payOr: 'أو',
    paySubmit: 'إرسال إثبات الدفع',
    paySubmitting: 'جار الإرسال...',
    paymentPending: 'تم إرسال إثبات الدفع، بانتظار المراجعة.',
    paymentConfirmed: 'تم تأكيد الدفع.',
    paymentRejected: 'تعذر قبول إثبات الدفع السابق. يرجى إرسال رقم مرجع صحيح.',
    cancellationFeeLabel: 'رسوم الإلغاء',
    payFeeTitle: 'تأكيد دفع رسوم الإلغاء',
    payFeeCopy: 'كان السائق قد بدأ التوجه إليك بالفعل. ادفع رسوم الإلغاء له مباشرة (نقداً أو تحويل)، ثم أدخل رقم مرجع العملية هنا ليتحقق منها فريق SYBNB.',
    cancellationFeeWarning: 'قد يترتب على الإلغاء الآن رسوم إلغاء تقريبية قدرها {amount} لأن السائق بدأ التوجه إليك بالفعل.',
    chatTitle: 'راسل السائق',
    chatEmpty: 'لا توجد رسائل بعد.',
    chatPlaceholder: 'اكتب رسالة...',
    chatSend: 'إرسال',
    shareTrip: 'شارك رحلتي',
    sharing: 'جار المشاركة...',
    shareCopied: '✓ تم نسخ رابط المشاركة',
    shareTitle: 'رحلتي مع سير',
    shareText: 'تابع رحلتي مباشرة عبر هذا الرابط.',
    scheduleForLater: 'جدولة الرحلة لوقت لاحق',
    scheduleRide: 'جدولة الرحلة',
    scheduledFor: 'مجدولة في',
    accessibilityRequired: 'أحتاج مركبة تسمح بالوصول لذوي الاحتياجات الخاصة',
    savePlaceLabelPlaceholder: 'اسم المكان (مثال: المنزل)',
    savePlaceButton: 'حفظ عنوان الانطلاق',
    stop: 'محطة',
    addStop: '+ إضافة محطة',
    removeStop: 'إزالة',
    promoCodePlaceholder: 'كود الخصم (اختياري)',
    promoDiscountApplied: 'خصم الكود',
    enableNotifications: 'تفعيل الإشعارات',
    enablingNotifications: 'جار التفعيل...',
    notificationsEnabled: 'الإشعارات مفعّلة',
    billToBusiness: 'احتساب الرحلة على حساب {company}',
    billedToBusiness: 'محتسبة على حساب الشركة',
    shareable: 'رحلة مشتركة — وفّر 15% إذا شاركك السائق راكباً آخر على نفس الطريق',
    sharedRide: 'رحلة مشتركة',
    rateTitle: 'قيّم رحلتك',
    rateSubmit: 'إرسال التقييم',
    rateSubmitting: 'جار الإرسال',
    rateCommentPlaceholder: 'ملاحظة اختيارية عن الرحلة (غير إلزامية)',
    rateThanks: 'شكراً لتقييمك',
    yourRating: 'تقييمك',
    tipTitle: 'أضف بقشيشاً للسائق',
    tipHint: 'يذهب البقشيش بالكامل للسائق — بدون أي عمولة.',
    tipCustom: 'مبلغ آخر',
    tipNone: 'بدون بقشيش',
    tipSubmit: 'إرسال البقشيش',
    tipSubmitting: 'جارٍ الإرسال',
    tipThanks: 'شكراً! تم تسجيل بقشيشك.',
    tipCashNote: 'نقداً للسائق',
    cancelled: 'تم إلغاء الرحلة.',
    cancel: 'إلغاء الرحلة',
    cancelling: 'جار الإلغاء',
    newRide: 'طلب رحلة جديدة',
    sos: 'طوارئ SOS',
    sosConfirm: 'هل أنت في حالة طوارئ؟ سيتم تنبيه فريق SYBNB فوراً مع موقعك وتفاصيل الرحلة.',
    sosSending: 'جار إرسال التنبيه...',
    sosSent: '✓ تم إرسال تنبيه الطوارئ. فريق SYBNB على علم الآن.',
    sosFailed: 'تعذر إرسال تنبيه الطوارئ. حاول مجدداً أو اتصل بالطوارئ مباشرة.',
  },
  en: {
    back: 'Back to landing',
    title: 'SR Ride',
    subtitle: 'A real ride request, saved and broadcast live to available drivers to self-accept.',
    mode: 'Low-data mode',
    pickup: 'Pickup',
    dropoff: 'Dropoff',
    category: 'Category',
    fare: 'Estimated fare',
    distance: 'Estimated distance',
    distanceApprox: '(approximate, from address text)',
    addressUnrecognized: "We couldn't recognize this address. The price and distance are a rough default, not based on your actual location — check that the neighborhood name is spelled correctly.",
    request: 'Request ride',
    refresh: 'Refresh status',
    status: 'Ride status',
    rideId: 'Ride ID',
    driver: 'Driver',
    location: 'Location',
    accuracy: 'Accuracy',
    saved: 'Ride saved',
    error: 'Could not complete SR request',
    saving: 'Saving',
    gps: 'Use my current location',
    manualHint: 'The request can continue without GPS through manual addresses.',
    locationNotConfirmed: 'Please confirm both pickup and dropoff (by typing or via GPS) before requesting a ride.',
    driverNotAssigned: 'Not assigned yet',
    verifiedDriver: 'Verified identity',
    waitingForDriver: 'Waiting for a nearby driver to accept the ride...',
    stillLooking: 'Still finding you a driver. You can keep waiting or cancel the request.',
    etaPrefix: '~',
    etaSuffix: ' min away',
    driverAssigned: 'A driver has been assigned to your ride.',
    driverArriving: 'Your driver is on the way to you.',
    inProgress: 'Your ride is now in progress.',
    completed: 'Ride completed. Thanks for riding with SR.',
    receiptFare: 'Amount charged',
    receiptDistance: 'Distance',
    payTitle: 'Confirm payment',
    payCopy: "Pay the fare directly to the driver (cash or transfer), then enter the transaction reference here so SYBNB can verify it.",
    payReferencePlaceholder: 'Transaction reference',
    payCashButton: 'I paid the driver in cash',
    payCardButton: 'Pay by card',
    payCardRedirecting: 'Redirecting to payment…',
    payCardConfirming: 'Confirming payment…',
    payCashHint: 'Or pay the driver in cash directly, then confirm here. SYBNB will verify it.',
    payOr: 'or',
    paySubmit: 'Submit payment proof',
    paySubmitting: 'Submitting...',
    paymentPending: 'Payment proof submitted, awaiting review.',
    paymentConfirmed: 'Payment confirmed.',
    paymentRejected: 'The previous payment proof could not be accepted. Please submit a valid reference.',
    cancellationFeeLabel: 'Cancellation fee',
    payFeeTitle: 'Confirm cancellation fee payment',
    payFeeCopy: 'Your driver had already started heading your way. Pay the cancellation fee directly to them (cash or transfer), then enter the transaction reference here so SYBNB can verify it.',
    cancellationFeeWarning: 'Cancelling now may incur an estimated cancellation fee of {amount} because your driver has already started heading your way.',
    chatTitle: 'Message your driver',
    chatEmpty: 'No messages yet.',
    chatPlaceholder: 'Type a message...',
    chatSend: 'Send',
    shareTrip: 'Share my trip',
    sharing: 'Sharing...',
    shareCopied: '✓ Share link copied',
    shareTitle: 'My SR ride',
    shareText: 'Follow my ride live via this link.',
    scheduleForLater: 'Schedule for later',
    scheduleRide: 'Schedule ride',
    scheduledFor: 'Scheduled for',
    accessibilityRequired: 'I need a wheelchair-accessible vehicle',
    savePlaceLabelPlaceholder: 'Place name (e.g. Home)',
    savePlaceButton: 'Save pickup address',
    stop: 'Stop',
    addStop: '+ Add stop',
    removeStop: 'Remove',
    promoCodePlaceholder: 'Promo code (optional)',
    promoDiscountApplied: 'Promo discount',
    enableNotifications: 'Enable notifications',
    enablingNotifications: 'Enabling...',
    notificationsEnabled: 'Notifications enabled',
    billToBusiness: 'Bill this ride to {company}',
    billedToBusiness: 'Billed to your company account',
    shareable: 'Share your ride — save 15% if a driver pools you with another rider along the way',
    sharedRide: 'Shared ride',
    rateTitle: 'Rate your ride',
    rateSubmit: 'Submit rating',
    rateSubmitting: 'Submitting',
    rateCommentPlaceholder: 'Optional note about the ride',
    rateThanks: 'Thanks for your rating',
    yourRating: 'Your rating',
    tipTitle: 'Add a tip for your driver',
    tipHint: 'Tips go 100% to the driver — no commission is taken.',
    tipCustom: 'Custom',
    tipNone: 'No tip',
    tipSubmit: 'Send tip',
    tipSubmitting: 'Sending',
    tipThanks: 'Thank you! Your tip was recorded.',
    tipCashNote: 'Cash to driver',
    cancelled: 'This ride was cancelled.',
    cancel: 'Cancel ride',
    cancelling: 'Cancelling',
    newRide: 'Request a new ride',
    sos: 'SOS emergency',
    sosConfirm: 'Are you in an emergency? SYBNB will be alerted immediately with your location and trip details.',
    sosSending: 'Sending alert...',
    sosSent: '✓ Emergency alert sent. The SYBNB team has been notified.',
    sosFailed: 'Could not send the emergency alert. Try again or call emergency services directly.',
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'SR Ride',
    subtitle: 'Une vraie demande de course, enregistrée et diffusée en direct aux chauffeurs disponibles, qui l’acceptent eux-mêmes.',
    mode: 'Mode données réduites',
    pickup: 'Point de départ',
    dropoff: 'Destination',
    category: 'Catégorie',
    fare: 'Tarif estimé',
    distance: 'Distance estimée',
    distanceApprox: '(approximative, d’après l’adresse saisie)',
    addressUnrecognized: 'Nous n’avons pas pu reconnaître cette adresse. Le prix et la distance sont une estimation par défaut, qui ne repose pas sur votre position réelle — vérifiez l’orthographe du nom du quartier.',
    request: 'Demander une course',
    refresh: 'Actualiser le statut',
    status: 'Statut de la course',
    rideId: 'N° de course',
    driver: 'Chauffeur',
    location: 'Position',
    accuracy: 'Précision',
    saved: 'Course enregistrée',
    error: 'Impossible de finaliser la demande SR',
    saving: 'Enregistrement',
    gps: 'Utiliser ma position actuelle',
    manualHint: 'La demande peut se poursuivre sans GPS grâce aux adresses saisies manuellement.',
    locationNotConfirmed: 'Veuillez confirmer le point de départ et la destination (en les saisissant ou par GPS) avant de demander une course.',
    driverNotAssigned: 'Pas encore attribué',
    verifiedDriver: 'Identité vérifiée',
    waitingForDriver: 'En attente qu’un chauffeur à proximité accepte la course...',
    stillLooking: 'Recherche d’un chauffeur en cours. Vous pouvez patienter ou annuler la demande.',
    etaPrefix: '~',
    etaSuffix: ' min',
    driverAssigned: 'Un chauffeur a été attribué à votre course.',
    driverArriving: 'Votre chauffeur est en route vers vous.',
    inProgress: 'Votre course est en cours.',
    completed: 'Course terminée. Merci d’avoir voyagé avec SR.',
    receiptFare: 'Montant facturé',
    receiptDistance: 'Distance',
    payTitle: 'Confirmer le paiement',
    payCopy: 'Payez le tarif directement au chauffeur (en espèces ou par virement), puis saisissez ici la référence de la transaction afin que SYBNB puisse la vérifier.',
    payReferencePlaceholder: 'Référence de la transaction',
    payCashButton: 'J’ai payé le chauffeur en espèces',
    payCardButton: 'Payer par carte',
    payCardRedirecting: 'Redirection vers le paiement…',
    payCardConfirming: 'Confirmation du paiement…',
    payCashHint: 'Ou payez le chauffeur en espèces directement, puis confirmez ici. SYBNB le vérifiera.',
    payOr: 'ou',
    paySubmit: 'Envoyer la preuve de paiement',
    paySubmitting: 'Envoi...',
    paymentPending: 'Preuve de paiement envoyée, en attente de vérification.',
    paymentConfirmed: 'Paiement confirmé.',
    paymentRejected: 'La preuve de paiement précédente n’a pas pu être acceptée. Veuillez envoyer une référence valide.',
    cancellationFeeLabel: 'Frais d’annulation',
    payFeeTitle: 'Confirmer le paiement des frais d’annulation',
    payFeeCopy: 'Votre chauffeur avait déjà commencé à se diriger vers vous. Payez-lui directement les frais d’annulation (en espèces ou par virement), puis saisissez ici la référence de la transaction afin que SYBNB puisse la vérifier.',
    cancellationFeeWarning: 'Annuler maintenant peut entraîner des frais d’annulation estimés à {amount}, car votre chauffeur a déjà commencé à se diriger vers vous.',
    chatTitle: 'Écrire à votre chauffeur',
    chatEmpty: 'Aucun message pour l’instant.',
    chatPlaceholder: 'Écrivez un message...',
    chatSend: 'Envoyer',
    shareTrip: 'Partager mon trajet',
    sharing: 'Partage...',
    shareCopied: '✓ Lien de partage copié',
    shareTitle: 'Ma course SR',
    shareText: 'Suivez ma course en direct grâce à ce lien.',
    scheduleForLater: 'Planifier pour plus tard',
    scheduleRide: 'Planifier la course',
    scheduledFor: 'Planifiée pour le',
    accessibilityRequired: 'J’ai besoin d’un véhicule accessible en fauteuil roulant',
    savePlaceLabelPlaceholder: 'Nom du lieu (ex. : Domicile)',
    savePlaceButton: 'Enregistrer l’adresse de départ',
    stop: 'Arrêt',
    addStop: '+ Ajouter un arrêt',
    removeStop: 'Retirer',
    promoCodePlaceholder: 'Code promo (facultatif)',
    promoDiscountApplied: 'Réduction promo',
    enableNotifications: 'Activer les notifications',
    enablingNotifications: 'Activation...',
    notificationsEnabled: 'Notifications activées',
    billToBusiness: 'Facturer cette course à {company}',
    billedToBusiness: 'Facturée au compte de votre entreprise',
    shareable: 'Partagez votre course — économisez 15 % si un chauffeur vous jumelle avec un autre passager sur le trajet',
    sharedRide: 'Course partagée',
    rateTitle: 'Évaluez votre course',
    rateSubmit: 'Envoyer l’évaluation',
    rateSubmitting: 'Envoi',
    rateCommentPlaceholder: 'Remarque facultative sur la course',
    rateThanks: 'Merci pour votre évaluation',
    yourRating: 'Votre évaluation',
    tipTitle: 'Ajoutez un pourboire pour votre chauffeur',
    tipHint: 'Le pourboire revient à 100 % au chauffeur — aucune commission.',
    tipCustom: 'Autre montant',
    tipNone: 'Pas de pourboire',
    tipSubmit: 'Envoyer le pourboire',
    tipSubmitting: 'Envoi',
    tipThanks: 'Merci ! Votre pourboire a été enregistré.',
    tipCashNote: 'Espèces au chauffeur',
    cancelled: 'Cette course a été annulée.',
    cancel: 'Annuler la course',
    cancelling: 'Annulation',
    newRide: 'Demander une nouvelle course',
    sos: 'Urgence SOS',
    sosConfirm: 'Êtes-vous en situation d’urgence ? SYBNB sera alerté immédiatement avec votre position et les détails de la course.',
    sosSending: 'Envoi de l’alerte...',
    sosSent: '✓ Alerte d’urgence envoyée. L’équipe SYBNB a été prévenue.',
    sosFailed: 'Impossible d’envoyer l’alerte d’urgence. Réessayez ou appelez les secours directement.',
  },
}

const categories = ['SR Bike', 'SR Economy', 'SR Comfort', 'SR SUV', 'SR Van']

const rideCategoryByFilter: Record<string, string> = {
  bike: 'SR Bike',
  economy: 'SR Economy',
  comfort: 'SR Comfort',
  familyVan: 'SR SUV',
  van: 'SR Van',
}

// Reverse of the above: keep the category strip and the filter-panel category selection in sync.
const filterKeyByCategory: Record<string, string> = {
  'SR Bike': 'bike',
  'SR Economy': 'economy',
  'SR Comfort': 'comfort',
  'SR SUV': 'familyVan',
  'SR Van': 'van',
}

export function SrRidePage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const PICKUP_DEFAULT_TEXT = pick(lang, 'دمشق، المالكي', 'Damascus, Malki', 'Damas, Malki')
  const DROPOFF_DEFAULT_TEXT = pick(lang, 'دمشق، المزة', 'Damascus, Mezzeh', 'Damas, Mezzeh')
  const [pickup, setPickup] = useState(PICKUP_DEFAULT_TEXT)
  const [dropoff, setDropoff] = useState(DROPOFF_DEFAULT_TEXT)
  // SEC-F1-adjacent UX-4A fix (Priority A, refined twice after adversarial
  // review): the two lines above are display defaults, not real addresses.
  // Without tracking below, requestRide() could submit them as a genuine
  // trip with zero user interaction. Each endpoint's SOURCE is tracked
  // (not a bare touched boolean, which can't distinguish a trustworthy GPS
  // fix from a later hand-edit that invalidates it), and manual-source text
  // is additionally checked against the literal seeded default above (an
  // edit-then-revert-to-placeholder must still be rejected) -- see
  // srRideLocationGuard.ts for the full two-round reasoning and enforced
  // semantics. Enforced in requestRide() itself, not just the submit
  // button's disabled state.
  const [pickupSource, setPickupSource] = useState<SrRideLocationSource>('default')
  const [dropoffSource, setDropoffSource] = useState<SrRideLocationSource>('default')
  const [category, setCategory] = useState(categories[0])
  const [lowDataMode, setLowDataMode] = useState(true)
  const [accuracyMeters, setAccuracyMeters] = useState<number | undefined>()
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | undefined>()
  const [ride, setRide] = useState<PlatformRideRequest | null>(null)
  const [driverPhotoUrl, setDriverPhotoUrl] = useState<string | null>(null)
  const [quote, setQuote] = useState<PlatformSrQuote | null>(null)
  const [rideFilters, setRideFilters] = useState<VisualFilterSelection>({
    srRideCategory: 'economy',
    srRideRoute: 'cityRide',
    srRideFeatures: ['instantConfirm', 'ac'],
  })
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [payProviderRef, setPayProviderRef] = useState('')
  const [payStatus, setPayStatus] = useState<'idle' | 'saving' | 'submitted' | 'error'>('idle')
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [cardStatus, setCardStatus] = useState<'idle' | 'redirecting' | 'confirming' | 'error'>('idle')
  const [tipStatus, setTipStatus] = useState<'idle' | 'saving' | 'submitted' | 'error'>('idle')
  const [tipAmountMinor, setTipAmountMinor] = useState(0)
  const [tipCustom, setTipCustom] = useState('')
  const [tipRef, setTipRef] = useState('')
  const [chatMessages, setChatMessages] = useState<PlatformMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatStatus, setChatStatus] = useState<'idle' | 'sending' | 'error'>('idle')
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle')
  const [sosState, setSosState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [scheduleForLater, setScheduleForLater] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const [accessibilityRequired, setAccessibilityRequired] = useState(false)
  const [stops, setStops] = useState<string[]>([])
  // Stable, trimmed, non-empty stop list — used both for the fare estimate (so the preview matches
  // what the server will charge for a multi-stop trip) and the ride request. Memoized on `stops` so
  // it only changes when the rider actually edits a stop, not on every render.
  const trimmedStops = useMemo(() => stops.map((stop) => stop.trim()).filter(Boolean), [stops])
  const [promoCode, setPromoCode] = useState('')
  const [pushStatus, setPushStatus] = useState<'idle' | 'enabling' | 'enabled' | 'error'>('idle')
  const [businessAccountName, setBusinessAccountName] = useState<string | null>(null)
  const [billToBusinessAccount, setBillToBusinessAccount] = useState(false)
  const [shareable, setShareable] = useState(false)
  const [riderCount, setRiderCount] = useState(1)
  const [bagCount, setBagCount] = useState(0)
  const [savedPlaces, setSavedPlaces] = useState<PlatformSavedPlace[]>([])
  const [newPlaceLabel, setNewPlaceLabel] = useState('')
  const [savingPlace, setSavingPlace] = useState(false)
  const rideFilterGroups = useMemo(() => srRideFilterGroupsFromConfig(), [])

  // Pre-quote estimate derived from the SAME rate model the server uses (srFareModel), so it
  // matches the server's own estimated fare instead of a stale flat rate several times too high.
  const fallbackFareMinor = useMemo(() => srFallbackFareMinor(category, lowDataMode), [category, lowDataMode])

  const fareMinor = ride?.fareMinor ?? quote?.fareMinor ?? fallbackFareMinor
  // CAPSULE_RULES.noFakeTrustSignal: quote.estimated alone doesn't distinguish "GPS was imprecise
  // but we still recognized the neighborhood" from "we recognized nothing at all". Both pickup AND
  // dropoff coords coming back null (the gazetteer geocoder found no match for either) means the
  // whole distance/price is a blind default, not a real estimate.
  const addressUnrecognized = Boolean(quote?.estimated) && !quote?.pickupCoords && !quote?.dropoffCoords

  // Stripe-for-SR: learn whether the card rail is configured (controls the "Pay by card" button),
  // and if the rider has just returned from Stripe Checkout (?session_id=... on the #/sr route),
  // confirm the charge and refresh the ride so its payment state flips to confirmed.
  useEffect(() => {
    let cancelled = false
    fetchStripePaymentStatus()
      .then((s) => {
        if (!cancelled) setStripeConfigured(Boolean(s.configured))
      })
      .catch(() => {})
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    if (sessionId) {
      setCardStatus('confirming')
      confirmStripePayment(sessionId)
        .then(async (proof) => {
          if (cancelled) return
          setCardStatus('idle')
          // Strip the query param so a refresh doesn't re-confirm.
          const clean = window.location.pathname + window.location.hash
          window.history.replaceState(null, '', clean)
          if (proof?.rideId) setRide(await fetchPrototypeSrRide(proof.rideId))
        })
        .catch((error) => {
          if (cancelled) return
          setCardStatus('error')
          setMessage(error instanceof Error ? error.message : t.error)
        })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ride) return
    const timer = window.setTimeout(() => {
      fetchSrQuote({ pickup, dropoff, category, lowDataMode, pickupCoords, stops: trimmedStops, riderCount, bagCount, scheduled: scheduleForLater }).then(setQuote).catch(() => setQuote(null))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [pickup, dropoff, category, lowDataMode, pickupCoords, ride, trimmedStops, riderCount, bagCount, scheduleForLater])

  useEffect(() => {
    fetchSavedPlaces().then(setSavedPlaces).catch(() => setSavedPlaces([]))
    fetchBusinessMembership()
      .then((result) => setBusinessAccountName(result.isMember ? result.businessAccountName : null))
      .catch(() => setBusinessAccountName(null))
  }, [])

  async function saveCurrentPickupAsPlace() {
    if (!newPlaceLabel.trim() || !pickup.trim()) return
    setSavingPlace(true)
    try {
      const place = await createSavedPlace({
        label: newPlaceLabel.trim(),
        address: pickup,
        lat: pickupCoords?.lat,
        lng: pickupCoords?.lng,
      })
      setSavedPlaces((previous) => [...previous, place])
      setNewPlaceLabel('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setSavingPlace(false)
    }
  }

  async function removeSavedPlace(placeId: string) {
    try {
      await deleteSavedPlace(placeId)
      setSavedPlaces((previous) => previous.filter((place) => place.id !== placeId))
    } catch {
      // Non-critical -- the place simply stays in the list; the next load will reconcile it.
    }
  }

  useEffect(() => {
    // Keep tracking through the whole live lifecycle (assigned → arriving → in progress),
    // not just while waiting for a driver, so the rider follows the trip end to end.
    if (!ride || !ACTIVE_RIDE_STATUSES.includes(ride.status)) return
    const interval = window.setInterval(() => {
      fetchPrototypeSrRide(ride.id).then(setRide).catch(() => {})
    }, 4000)
    return () => window.clearInterval(interval)
  }, [ride])

  useEffect(() => {
    if (!ride || !MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status)) return
    let cancelled = false
    function poll() {
      if (!ride) return
      fetchPrototypeSrRideThread(ride.id)
        .then((thread) => {
          if (!cancelled) setChatMessages(thread.messages)
        })
        .catch(() => {})
    }
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [ride?.id, ride?.status])

  async function sendChatMessage() {
    if (!ride || !chatInput.trim()) return
    setChatStatus('sending')
    try {
      const sent = await sendPrototypeSrRideMessage(ride.id, chatInput.trim())
      setChatMessages((previous) => [...previous, sent])
      setChatInput('')
      setChatStatus('idle')
    } catch (error) {
      setChatStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  // Safety Phase 1 (2026-10-10): pull SOS on this active ride. Confirm first (a mis-tap must not
  // raise a false alarm), attach device geolocation when the browser allows it, and fall back to a
  // location-less SOS if geolocation is unavailable or denied -- the alert must still go out.
  async function triggerSos() {
    if (!ride) return
    if (!window.confirm(t.sosConfirm)) return
    setSosState('sending')
    setMessage('')
    const send = async (coords: { lat?: number; lng?: number }) => {
      try {
        await triggerSrSos(ride.id, coords)
        setSosState('sent')
        setMessage(t.sosSent)
      } catch (error) {
        setSosState('error')
        setMessage(error instanceof Error ? error.message : t.sosFailed)
      }
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => void send({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => void send({}),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
      )
    } else {
      void send({})
    }
  }

  async function shareTrip() {
    if (!ride) return
    setShareStatus('sharing')
    try {
      const { rideId, exp, sig } = await sharePrototypeSrRide(ride.id)
      const shareUrl = `${window.location.origin}${window.location.pathname}#/ride/shared/${rideId}?exp=${exp}&sig=${sig}`
      if (navigator.share) {
        await navigator.share({ title: t.shareTitle, text: t.shareText, url: shareUrl })
        setShareStatus('idle')
      } else {
        await navigator.clipboard.writeText(shareUrl)
        setShareStatus('copied')
      }
    } catch (error) {
      // The user closing the native share sheet without picking anything throws AbortError -- not
      // a real failure, so it shouldn't surface as one.
      if (error instanceof Error && error.name === 'AbortError') {
        setShareStatus('idle')
        return
      }
      setShareStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function enableNotifications() {
    setPushStatus('enabling')
    try {
      await enablePushNotifications(false)
      setPushStatus('enabled')
    } catch (error) {
      setPushStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  // signDriverPhotoUrl() mints a fresh signature+expiry on every fetch (server/lib/storage.mjs), so
  // naively rendering ride.driver.driverProfile.photoUrl directly would give <img> a new src on
  // every 4s poll -- interrupting the in-flight image load before it ever finishes decoding. Only
  // re-resolve when the driver actually changes, not on every poll of the same driver.
  useEffect(() => {
    const photoUrl = ride?.driver?.driverProfile?.photoUrl
    setDriverPhotoUrl(photoUrl ? resolveApiUrl(photoUrl) : null)
  }, [ride?.driverId])

  async function useCurrentLocation() {
    setMessage('')
    if (!navigator.geolocation) {
      setAccuracyMeters(undefined)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAccuracyMeters(Math.round(position.coords.accuracy))
        setPickupCoords({ lat: position.coords.latitude, lng: position.coords.longitude })
        setPickup(pick(lang, 'موقعي الحالي', 'Current location', 'Position actuelle'))
        setPickupSource('gps')
      },
      () => {
        setAccuracyMeters(undefined)
        setPickupCoords(undefined)
        setMessage(t.manualHint)
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    )
  }

  async function requestRide() {
    // SEC-F1-adjacent UX-4A fix (Priority A): enforced here, in the actual
    // submission path -- not only via the button's disabled attribute --
    // so this can't be bypassed by any other future call site of
    // requestRide() forgetting to check the button state first.
    if (!isSrRideLocationConfirmed({
              pickupSource,
              dropoffSource,
              pickup,
              dropoff,
              pickupDefaultText: PICKUP_DEFAULT_TEXT,
              dropoffDefaultText: DROPOFF_DEFAULT_TEXT,
            })) {
      setStatus('error')
      setMessage(t.locationNotConfirmed)
      return
    }

    setStatus('saving')
    setMessage('')

    try {
      const nextRide = await createPrototypeSrRide({
        pickup,
        dropoff,
        category,
        currency: 'USD',
        lowDataMode,
        accuracyMeters,
        pickupCoords,
        routeType: String(rideFilters.srRideRoute || ''),
        features: Array.isArray(rideFilters.srRideFeatures) ? rideFilters.srRideFeatures : [],
        scheduledFor: scheduleForLater && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        accessibilityRequired,
        stops: stops.map((stop) => stop.trim()).filter(Boolean),
        riderCount,
        bagCount,
        promoCode: promoCode.trim() || undefined,
        billToBusinessAccount: businessAccountName ? billToBusinessAccount : undefined,
        shareable,
      })
      setRide(nextRide)
      setStatus('idle')
      setMessage(t.saved)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function updateRideFilters(next: VisualFilterSelection) {
    setRideFilters(next)
    const nextCategory = String(next.srRideCategory || 'economy')
    setCategory(rideCategoryByFilter[nextCategory] || 'SR Economy')
  }

  async function refreshRide() {
    if (!ride) return
    setStatus('saving')
    setMessage('')

    try {
      setRide(await fetchPrototypeSrRide(ride.id))
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function cancelRide() {
    if (!ride) return
    setStatus('saving')
    setMessage('')

    try {
      setRide(await cancelPrototypeSrRide(ride.id))
      setStatus('idle')
      setMessage(t.cancelled)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function submitReview() {
    if (!ride || reviewRating < 1) return
    setReviewStatus('saving')
    try {
      await submitPrototypeSrRideReview({ rideId: ride.id, rating: reviewRating, comment: reviewComment.trim() || undefined })
      setRide(await fetchPrototypeSrRide(ride.id))
      setReviewStatus('idle')
    } catch (error) {
      setReviewStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function submitPayment() {
    if (!ride || !payProviderRef.trim()) return
    setPayStatus('saving')
    try {
      // amountMinor/currency are sent for display continuity only -- the server derives the real
      // charge from the ride's own locked fareMinor (or, for a cancelled ride, its
      // cancellationFeeMinor), never trusts this value (see server/routes/payments.mjs's
      // local-wallet-proof handler).
      const amountMinor = ride.status === 'CANCELLED' ? ride.cancellationFeeMinor || 0 : ride.fareMinor || 0
      await submitPrototypeLocalWalletProof({
        rideId: ride.id,
        amountMinor,
        currency: ride.currency,
        providerRef: payProviderRef.trim(),
      })
      setRide(await fetchPrototypeSrRide(ride.id))
      setPayStatus('submitted')
    } catch (error) {
      setPayStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  // #191 (2026-10-10): cash / paid-to-driver. No transaction reference — the rider confirms they paid
  // the driver the fare in cash; an operator approves it, and settlement books only the platform's
  // commission against the driver (who holds the cash). Same server endpoint, method:'cash'.
  async function submitCashPayment() {
    if (!ride) return
    setPayStatus('saving')
    try {
      const amountMinor = ride.status === 'CANCELLED' ? ride.cancellationFeeMinor || 0 : ride.fareMinor || 0
      await submitPrototypeLocalWalletProof({
        rideId: ride.id,
        amountMinor,
        currency: ride.currency,
        method: 'cash',
      })
      setRide(await fetchPrototypeSrRide(ride.id))
      setPayStatus('submitted')
    } catch (error) {
      setPayStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  // Stripe-for-SR Option A: redirect the rider to Stripe's hosted Checkout for the locked fare.
  async function payByCard() {
    if (!ride) return
    setCardStatus('redirecting')
    try {
      const { url } = await createStripeRideCheckoutSession(ride.id)
      window.location.assign(url)
    } catch (error) {
      setCardStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function submitTip() {
    if (!ride || tipAmountMinor <= 0 || !tipRef.trim()) return
    setTipStatus('saving')
    try {
      // A tip is a SEPARATE payment from the fare, settled 100% to the driver with no commission.
      // The server re-caps the amount against the ride's own fare, so the client figure is advisory.
      await submitPrototypeLocalWalletProof({
        rideId: ride.id,
        amountMinor: tipAmountMinor,
        currency: ride.currency,
        providerRef: tipRef.trim(),
        kind: 'tip',
      })
      setRide(await fetchPrototypeSrRide(ride.id))
      setTipStatus('submitted')
    } catch (error) {
      setTipStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function renderPaymentSection(title: string, copy: string) {
    // Ignore tip proofs here -- this section is about the FARE payment state only; a tip is a
    // separate proof (provider starts with 'tip') handled by its own panel.
    const latestProof = (ride?.paymentProofs || []).find((p) => !(p.provider || '').startsWith('tip'))
    if (latestProof?.status === 'APPROVED') {
      return <div style={styles.message}>✓ {t.paymentConfirmed}</div>
    }
    if (latestProof?.status === 'PENDING_ADMIN_REVIEW') {
      return <div style={styles.message}>{t.paymentPending}</div>
    }
    // A REJECTED proof falls through to the form below so the rider can resubmit.
    return (
      <div style={styles.card}>
        <strong>{title}</strong>
        <span>{copy}</span>
        {latestProof?.status === 'REJECTED' && <p style={styles.addressWarning}>{t.paymentRejected}</p>}
        <input
          style={styles.payInput}
          value={payProviderRef}
          onChange={(event) => setPayProviderRef(event.target.value)}
          placeholder={t.payReferencePlaceholder}
        />
        <button disabled={!payProviderRef.trim() || payStatus === 'saving'} style={styles.primaryButton} onClick={() => void submitPayment()}>
          {payStatus === 'saving' ? t.paySubmitting : t.paySubmit}
        </button>
        <div style={styles.payCashDivider}>{t.payOr}</div>
        <span style={styles.payCashHint}>{t.payCashHint}</span>
        <button disabled={payStatus === 'saving'} style={styles.secondaryButton} onClick={() => void submitCashPayment()}>
          {payStatus === 'saving' ? t.paySubmitting : t.payCashButton}
        </button>
        {stripeConfigured && (
          <>
            <div style={styles.payCashDivider}>{t.payOr}</div>
            <button
              disabled={cardStatus === 'redirecting' || cardStatus === 'confirming'}
              style={styles.primaryButton}
              onClick={() => void payByCard()}
            >
              💳 {cardStatus === 'redirecting' ? t.payCardRedirecting : cardStatus === 'confirming' ? t.payCardConfirming : t.payCardButton}
            </button>
          </>
        )}
      </div>
    )
  }

  function startNewRide() {
    setRide(null)
    setQuote(null)
    setStatus('idle')
    setMessage('')
  }

  const canCancel = Boolean(ride && RIDER_CANCELLABLE_STATUSES.includes(ride.status))
  const isTerminal = Boolean(ride && ['COMPLETED', 'CANCELLED'].includes(ride.status))
  // Client-side estimate only, purely so the rider isn't surprised before an irreversible action --
  // the real fee (if any) is computed and stored server-side at the moment of cancellation. Keep
  // this rate in sync with RIDE_CANCELLATION_FEE_PERCENT in server/routes/sr-rides.mjs.
  const driverAlreadyCommitted = Boolean(ride && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status))
  const estimatedCancellationFeeMinor = driverAlreadyCommitted && ride?.fareMinor ? Math.round((ride.fareMinor * 15) / 100) : 0

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>SR / SYBNB</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        {pushStatus !== 'enabled' && (
          <button
            style={styles.secondaryButton}
            disabled={pushStatus === 'enabling'}
            onClick={() => void enableNotifications()}
          >
            {pushStatus === 'enabling' ? t.enablingNotifications : t.enableNotifications}
          </button>
        )}
        {pushStatus === 'enabled' && <span style={styles.verifiedBadge}>✓ {t.notificationsEnabled}</span>}
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <div style={styles.mapPreview}>
            <span style={styles.dot} />
            <strong>{t.location}</strong>
            <p>{t.manualHint}</p>
          </div>

          <button style={styles.secondaryButton} onClick={() => void useCurrentLocation()}>
            {t.gps}
          </button>

          {!ride && savedPlaces.length > 0 && (
            <div style={styles.savedPlacesRow}>
              {savedPlaces.map((place) => (
                <span key={place.id} style={styles.savedPlaceChip}>
                  <button
                    type="button"
                    style={styles.chipButton}
                    onClick={() => {
                      setPickup(place.address)
                      setPickupSource('saved')
                      setPickupCoords(undefined)
                    }}
                  >
                    {place.label}
                  </button>
                  <button
                    type="button"
                    style={styles.chipButton}
                    onClick={() => {
                      setDropoff(place.address)
                      setDropoffSource('saved')
                    }}
                  >
                    → {t.dropoff}
                  </button>
                  <button type="button" style={styles.chipButton} onClick={() => void removeSavedPlace(place.id)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <label style={styles.label}>
            {t.pickup}
            <input
              style={styles.input}
              value={pickup}
              onChange={(event) => {
                setPickup(event.target.value)
                setPickupSource('manual')
                // A hand-edit invalidates any earlier GPS fix -- the
                // coordinates no longer necessarily correspond to this
                // text, so they must not ride along to requestRide()
                // (UX-4A Priority A, GPS-then-destructive-edit case).
                setPickupCoords(undefined)
                setAccuracyMeters(undefined)
              }}
            />
          </label>

          {!ride && (
            <div style={styles.savePlaceRow}>
              <input
                style={styles.payInput}
                value={newPlaceLabel}
                onChange={(event) => setNewPlaceLabel(event.target.value)}
                placeholder={t.savePlaceLabelPlaceholder}
              />
              <button
                type="button"
                disabled={!newPlaceLabel.trim() || !pickup.trim() || savingPlace}
                style={styles.secondaryButton}
                onClick={() => void saveCurrentPickupAsPlace()}
              >
                {t.savePlaceButton}
              </button>
            </div>
          )}

          {!ride &&
            stops.map((stop, index) => (
              <label key={index} style={styles.label}>
                {t.stop} {index + 1}
                <div style={styles.savePlaceRow}>
                  <input
                    style={styles.input}
                    value={stop}
                    onChange={(event) =>
                      setStops((previous) => previous.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)))
                    }
                  />
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={() => setStops((previous) => previous.filter((_, valueIndex) => valueIndex !== index))}
                  >
                    {t.removeStop}
                  </button>
                </div>
              </label>
            ))}

          {!ride && stops.length < 3 && (
            <button type="button" style={styles.secondaryButton} onClick={() => setStops((previous) => [...previous, ''])}>
              {t.addStop}
            </button>
          )}

          <label style={styles.label}>
            {t.dropoff}
            <input
              style={styles.input}
              value={dropoff}
              onChange={(event) => {
                setDropoff(event.target.value)
                setDropoffSource('manual')
              }}
            />
          </label>

          <section style={styles.categoryCapsule}>
            <span style={styles.categoryTitle}>{t.category}</span>
            <div style={styles.categoryStrip}>
              {categories.map((item) => (
                <button
                  key={item}
                  style={item === category ? styles.categoryActive : styles.categoryButton}
                  onClick={() => {
                    setCategory(item)
                    // Keep the filter-panel category in sync, so toggling a feature chip (which runs
                    // updateRideFilters and re-derives category from srRideCategory) can't silently
                    // revert the strip's choice back to Economy.
                    setRideFilters((previous) => ({ ...previous, srRideCategory: filterKeyByCategory[item] || 'economy' }))
                  }}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section style={styles.touchFilters}>
            <div style={styles.filtersHead}>
              <strong>{t.category}</strong>
              <span>{selectedFilterLabels(rideFilterGroups, rideFilters, lang).length}</span>
            </div>
            <VisualFilterPanel
              compact
              groups={rideFilterGroups}
              lang={lang}
              selection={rideFilters}
              onChange={updateRideFilters}
            />
          </section>

          <label style={styles.toggle}>
            <input checked={lowDataMode} type="checkbox" onChange={(event) => setLowDataMode(event.target.checked)} />
            <span>{t.mode}</span>
          </label>

          <div style={styles.stat}>
            <span>{t.distance}</span>
            <strong dir="ltr">
              {quote ? `${quote.distanceKm} km` : '-'} {quote?.estimated ? t.distanceApprox : ''}
            </strong>
          </div>

          <div style={styles.stat}>
            <span>{t.fare}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(fareMinor, ride?.currency || quote?.currency || 'USD', lang)}</strong>
          </div>

          {quote?.estimatedMinutes ? (
            <div style={styles.stat}>
              <span>{isAr ? '\u0627\u0644\u0648\u0642\u062a \u0627\u0644\u062a\u0642\u0631\u064a\u0628\u064a' : 'Est. time'}</span>
              <strong dir="ltr">
                {quote.estimatedMinutes} {isAr ? '\u062f\u0642\u064a\u0642\u0629' : 'min'}
              </strong>
            </div>
          ) : null}

          {!ride ? (
            <div style={styles.stat}>
              <span>{isAr ? 'عدد الركاب' : 'Riders'}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" aria-label="fewer riders" onClick={() => setRiderCount((n) => Math.max(1, n - 1))} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18, lineHeight: '1' }}>−</button>
                <strong dir="ltr">{riderCount}</strong>
                <button type="button" aria-label="more riders" onClick={() => setRiderCount((n) => Math.min(8, n + 1))} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18, lineHeight: '1' }}>+</button>
              </span>
            </div>
          ) : null}

          {!ride ? (
            <div style={styles.stat}>
              <span>{isAr ? 'عدد الحقائب' : 'Bags'}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" aria-label="fewer bags" onClick={() => setBagCount((n) => Math.max(0, n - 1))} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18, lineHeight: '1' }}>−</button>
                <strong dir="ltr">{bagCount}</strong>
                <button type="button" aria-label="more bags" onClick={() => setBagCount((n) => Math.min(10, n + 1))} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18, lineHeight: '1' }}>+</button>
              </span>
            </div>
          ) : null}

          {!ride && quote && ((quote.trafficMultiplier ?? 1) > 1 || quote.isNight || quote.scheduled || (quote.fuelSurchargePercent ?? 0) > 0 || (quote.demandMultiplier ?? 1) > 1 || quote.airportTrip || (quote.stopsFee ?? 0) > 0 || (quote.bagsFee ?? 0) > 0 || (quote.ridersFee ?? 0) > 0) ? (
            <div style={styles.addressWarning} dir={isAr ? 'rtl' : 'ltr'}>
              {(isAr ? 'تسعير متغير: ' : 'Dynamic pricing: ') +
                [
                  (quote.trafficMultiplier ?? 1) > 1
                    ? (quote.trafficSource === 'google'
                        ? (isAr ? `زحمة +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%` : `traffic +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%`)
                        : (isAr ? `ذروة +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%` : `peak +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%`))
                    : null,
                  quote.isNight
                    ? (isAr ? `ليلي +${Math.round(((quote.nightMultiplier ?? 1) - 1) * 100)}%` : `night +${Math.round(((quote.nightMultiplier ?? 1) - 1) * 100)}%`)
                    : null,
                  quote.scheduled
                    ? (isAr ? `حجز مسبق +${Math.round(((quote.scheduleMultiplier ?? 1) - 1) * 100)}%` : `scheduled +${Math.round(((quote.scheduleMultiplier ?? 1) - 1) * 100)}%`)
                    : null,
                  (quote.fuelSurchargePercent ?? 0) > 0
                    ? (isAr ? `وقود +${quote.fuelSurchargePercent}%` : `fuel +${quote.fuelSurchargePercent}%`)
                    : null,
                  (quote.demandMultiplier ?? 1) > 1
                    ? (isAr ? `طلب ×${quote.demandMultiplier}` : `demand ×${quote.demandMultiplier}`)
                    : null,
                  quote.airportTrip
                    ? (isAr ? `مطار $${quote.airportSurcharge}` : `airport $${quote.airportSurcharge}`)
                    : null,
                  (quote.stopsFee ?? 0) > 0
                    ? (isAr ? `محطات $${quote.stopsFee}` : `stops $${quote.stopsFee}`)
                    : null,
                  (quote.bagsFee ?? 0) > 0
                    ? (isAr ? `حقائب $${quote.bagsFee}` : `bags $${quote.bagsFee}`)
                    : null,
                  (quote.ridersFee ?? 0) > 0
                    ? (isAr ? `ركاب $${quote.ridersFee}` : `riders $${quote.ridersFee}`)
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
            </div>
          ) : null}

          {!ride && addressUnrecognized && <div style={styles.addressWarning}>⚠ {t.addressUnrecognized}</div>}

          {!ride && (
            <label style={styles.scheduleRow}>
              <input type="checkbox" checked={shareable} onChange={(event) => setShareable(event.target.checked)} />
              {t.shareable}
            </label>
          )}

          {!ride && (
            <label style={styles.scheduleRow}>
              <input
                type="checkbox"
                checked={accessibilityRequired}
                onChange={(event) => setAccessibilityRequired(event.target.checked)}
              />
              {t.accessibilityRequired}
            </label>
          )}

          {!ride && (
            <label style={styles.scheduleRow}>
              <input type="checkbox" checked={scheduleForLater} onChange={(event) => setScheduleForLater(event.target.checked)} />
              {t.scheduleForLater}
            </label>
          )}
          {!ride && scheduleForLater && (
            <input
              type="datetime-local"
              style={styles.payInput}
              value={scheduledFor}
              min={new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16)}
              onChange={(event) => setScheduledFor(event.target.value)}
            />
          )}

          {!ride && (
            <input
              style={styles.payInput}
              value={promoCode}
              onChange={(event) => setPromoCode(event.target.value)}
              placeholder={t.promoCodePlaceholder}
            />
          )}

          {!ride && businessAccountName && (
            <label style={styles.scheduleRow}>
              <input
                type="checkbox"
                checked={billToBusinessAccount}
                onChange={(event) => setBillToBusinessAccount(event.target.checked)}
              />
              {t.billToBusiness.replace('{company}', businessAccountName)}
            </label>
          )}

          <button
            disabled={
              status === 'saving' ||
              (scheduleForLater && !scheduledFor) ||
              !isSrRideLocationConfirmed({
              pickupSource,
              dropoffSource,
              pickup,
              dropoff,
              pickupDefaultText: PICKUP_DEFAULT_TEXT,
              dropoffDefaultText: DROPOFF_DEFAULT_TEXT,
            })
            }
            style={styles.primaryButton}
            onClick={() => void requestRide()}
          >
            {status === 'saving' ? t.saving : scheduleForLater ? t.scheduleRide : t.request}
          </button>
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.status}</h2>
          <Info label={t.rideId} value={ride ? ride.id.slice(0, 8).toUpperCase() : '-'} />
          <Info label={t.status} value={statusText(ride?.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
          {ride && (ride.pickupCoords || ride.dropoffCoords || ride.driver?.location) && (
            <RideMap
              pickup={ride.pickupCoords}
              dropoff={ride.dropoffCoords}
              stops={(ride.stops || []).filter((stop) => stop.lat != null && stop.lng != null).map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number }))}
              driverLocation={ride.driver?.location}
            />
          )}
          {driverPhotoUrl && <img src={driverPhotoUrl} alt="" style={styles.driverPhoto} />}
          {ride?.driver?.isVerified && <span style={styles.verifiedBadge}>✓ {t.verifiedDriver}</span>}
          <Info label={t.driver} value={driverIdentityLabel(ride, t)} />
          <Info label={t.pickup} value={String(ride?.metadata.pickup || pickup)} />
          {ride?.stops?.map((stop, index) => (
            <Info key={index} label={`${t.stop} ${index + 1}`} value={stop.address} />
          ))}
          <Info label={t.dropoff} value={String(ride?.metadata.dropoff || dropoff)} />
          <Info label={t.accuracy} value={accuracyMeters ? `${accuracyMeters}m` : pick(lang, 'يدوي', 'manual', 'manuelle')} />
          {ride?.accessibilityRequired && <div style={styles.message}>♿ {t.accessibilityRequired}</div>}
          {ride?.businessAccountId && <div style={styles.message}>🏢 {t.billedToBusiness}</div>}
          {ride?.shareable && <div style={styles.message}>🤝 {t.sharedRide}</div>}

          {ride && MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status) && (
            <div style={styles.card}>
              <strong>{t.chatTitle}</strong>
              <div style={styles.chatMessages}>
                {chatMessages.length === 0 && <span style={styles.chatEmpty}>{t.chatEmpty}</span>}
                {chatMessages.map((entry) => (
                  <div
                    key={entry.id}
                    style={entry.senderRole === 'RIDER' ? styles.chatBubbleMine : styles.chatBubbleTheirs}
                  >
                    {entry.body}
                  </div>
                ))}
              </div>
              <div style={styles.chatInputRow}>
                <input
                  style={styles.chatInput}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder={t.chatPlaceholder}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void sendChatMessage()
                  }}
                />
                <button disabled={!chatInput.trim() || chatStatus === 'sending'} style={styles.secondaryButton} onClick={() => void sendChatMessage()}>
                  {t.chatSend}
                </button>
              </div>
            </div>
          )}

          {ride?.status === 'DRAFT' && ride.scheduledFor && (
            <div style={styles.message}>
              {t.scheduledFor} {new Date(ride.scheduledFor).toLocaleString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'))}
            </div>
          )}
          {ride && ['REQUESTED', 'MATCHING'].includes(ride.status) && (
            <div style={styles.message}>{ride.matchTimedOut ? t.stillLooking : t.waitingForDriver}</div>
          )}
          {ride?.status === 'DRIVER_ASSIGNED' && (
            <div style={styles.message}>{t.driverAssigned}{typeof ride.etaToPickupMinutes === 'number' ? ` · ${t.etaPrefix}${ride.etaToPickupMinutes}${t.etaSuffix}` : ''}</div>
          )}
          {ride?.status === 'DRIVER_ARRIVING' && (
            <div style={styles.message}>{t.driverArriving}{typeof ride.etaToPickupMinutes === 'number' ? ` · ${t.etaPrefix}${ride.etaToPickupMinutes}${t.etaSuffix}` : ''}</div>
          )}
          {ride && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status) && typeof ride.metadata.pickupCode === 'string' && (
            <div
              style={{
                display: 'grid',
                gap: 4,
                justifyItems: 'center',
                textAlign: 'center',
                border: '2px solid #19d7ff',
                borderRadius: 12,
                background: 'rgba(25,215,255,.08)',
                padding: '14px 16px',
                margin: '4px 0',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 800, color: '#19d7ff' }}>
                {pick(lang, 'أظهر هذا الرمز لسائقك', 'Show this code to your driver', 'Montrez ce code à votre chauffeur')}
              </span>
              <strong dir="ltr" style={{ fontSize: 40, letterSpacing: 10, fontWeight: 950 }}>
                {String(ride.metadata.pickupCode)}
              </strong>
              <span style={{ fontSize: 12, color: '#9aa6ba' }}>
                {pick(
                  lang,
                  'لن تبدأ الرحلة قبل أن يؤكد السائق هذا الرمز.',
                  'The trip only starts once the driver confirms this code.',
                  "La course ne démarre qu'une fois ce code confirmé par le chauffeur.",
                )}
              </span>
            </div>
          )}
          {ride?.status === 'IN_PROGRESS' && (
            <div style={styles.message}>{t.inProgress}</div>
          )}
          {ride?.status === 'COMPLETED' && (
            <>
              <div style={styles.message}>{t.completed}</div>
              <div style={styles.stat}>
                <span>{t.receiptFare}</span>
                <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.fareMinor ?? 0, ride.currency, lang)}</strong>
              </div>
              {!!ride.discountMinor && (
                <div style={styles.stat}>
                  <span>{t.promoDiscountApplied}</span>
                  <strong dir={isAr ? 'rtl' : 'ltr'}>-{moneyText(ride.discountMinor, ride.currency, lang)}</strong>
                </div>
              )}
              {typeof ride.metadata.distanceKm === 'number' && (
                <div style={styles.stat}>
                  <span>{t.receiptDistance}</span>
                  <strong dir="ltr">{ride.metadata.distanceKm} km</strong>
                </div>
              )}
              {renderPaymentSection(t.payTitle, t.payCopy)}
              {(ride.fareMinor ?? 0) > 0 &&
              !(ride.paymentProofs || []).some((p) => (p.provider || '').startsWith('tip')) ? (
                tipStatus === 'submitted' ? (
                  <div style={styles.message}>✓ {t.tipThanks}</div>
                ) : (
                  <div style={styles.card}>
                    <strong>{t.tipTitle}</strong>
                    <span style={styles.payCashHint}>{t.tipHint}</span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[10, 15, 20].map((pct) => {
                        const amt = Math.round(((ride.fareMinor ?? 0) * pct) / 100)
                        const active = tipAmountMinor === amt && tipCustom === ''
                        return (
                          <button
                            key={pct}
                            style={active ? { ...styles.secondaryButton, borderColor: '#19d7ff', color: '#19d7ff' } : styles.secondaryButton}
                            onClick={() => {
                              setTipCustom('')
                              setTipAmountMinor(amt)
                            }}
                          >
                            {pct}% · {moneyText(amt, ride.currency, lang)}
                          </button>
                        )
                      })}
                    </div>
                    <input
                      style={styles.payInput}
                      inputMode="decimal"
                      placeholder={t.tipCustom}
                      value={tipCustom}
                      onChange={(event) => {
                        const v = event.target.value.replace(/[^0-9.]/g, '')
                        setTipCustom(v)
                        const major = parseFloat(v)
                        setTipAmountMinor(Number.isFinite(major) ? Math.round(major * 100) : 0)
                      }}
                    />
                    <input
                      style={styles.payInput}
                      placeholder={t.payReferencePlaceholder}
                      value={tipRef}
                      onChange={(event) => setTipRef(event.target.value)}
                    />
                    <button
                      disabled={tipAmountMinor <= 0 || !tipRef.trim() || tipStatus === 'saving'}
                      style={styles.primaryButton}
                      onClick={() => void submitTip()}
                    >
                      {tipStatus === 'saving'
                        ? t.tipSubmitting
                        : `${t.tipSubmit}${tipAmountMinor > 0 ? ' · ' + moneyText(tipAmountMinor, ride.currency, lang) : ''}`}
                    </button>
                  </div>
                )
              ) : null}
              {ride.review ? (
                <div style={styles.message}>
                  {t.yourRating}: {'★'.repeat(ride.review.rating)}
                  {'☆'.repeat(5 - ride.review.rating)}
                </div>
              ) : (
                <div style={styles.card}>
                  <strong>{t.rateTitle}</strong>
                  <div style={styles.starRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} style={n <= reviewRating ? styles.starActive : styles.star} onClick={() => setReviewRating(n)}>
                        ★
                      </button>
                    ))}
                  </div>
                  <textarea
                    style={styles.reviewTextarea}
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    placeholder={t.rateCommentPlaceholder}
                  />
                  <button disabled={reviewRating < 1 || reviewStatus === 'saving'} style={styles.primaryButton} onClick={() => void submitReview()}>
                    {reviewStatus === 'saving' ? t.rateSubmitting : t.rateSubmit}
                  </button>
                </div>
              )}
            </>
          )}
          {ride?.status === 'CANCELLED' && (
            <>
              <div style={{ ...styles.message, ...styles.error }}>{t.cancelled}</div>
              {typeof ride.cancellationFeeMinor === 'number' && ride.cancellationFeeMinor > 0 && (
                <>
                  <div style={styles.stat}>
                    <span>{t.cancellationFeeLabel}</span>
                    <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.cancellationFeeMinor, ride.currency, lang)}</strong>
                  </div>
                  {renderPaymentSection(t.payFeeTitle, t.payFeeCopy)}
                </>
              )}
            </>
          )}

          {ride && LIVE_TRACKING_STATUSES.includes(ride.status) && (
            <button disabled={shareStatus === 'sharing'} style={styles.secondaryButton} onClick={() => void shareTrip()}>
              {shareStatus === 'copied' ? t.shareCopied : shareStatus === 'sharing' ? t.sharing : t.shareTrip}
            </button>
          )}

          {ride && ride.status !== 'DRAFT' && ACTIVE_RIDE_STATUSES.includes(ride.status) && (
            <button
              style={styles.sosButton}
              disabled={sosState === 'sending' || sosState === 'sent'}
              onClick={() => void triggerSos()}
            >
              {sosState === 'sending' ? t.sosSending : sosState === 'sent' ? t.sosSent : `${t.sos} ⚠`}
            </button>
          )}

          {canCancel && estimatedCancellationFeeMinor > 0 && (
            <p style={styles.addressWarning}>
              {t.cancellationFeeWarning.replace('{amount}', moneyText(estimatedCancellationFeeMinor, ride?.currency || 'USD', lang))}
            </p>
          )}

          <div style={styles.actions}>
            <button disabled={!ride || isTerminal || status === 'saving'} style={styles.secondaryButton} onClick={() => void refreshRide()}>
              {t.refresh}
            </button>
            {isTerminal ? (
              <button disabled={status === 'saving'} style={styles.primaryButton} onClick={startNewRide}>
                {t.newRide}
              </button>
            ) : (
              <button disabled={!canCancel || status === 'saving'} style={styles.cancelButton} onClick={() => void cancelRide()}>
                {status === 'saving' ? t.cancelling : t.cancel}
              </button>
            )}
          </div>

          {message && (
            <div style={{ ...styles.message, ...(status === 'error' ? styles.error : {}) }}>
              {message}
            </div>
          )}
        </article>
      </section>
    </main>
  )
}

// CAPSULE_RULES.noFakeTrustSignal: only ever renders real data returned by the API (driver's real
// displayName + real vehicle fields) -- never fabricates a name or vehicle when the API omits one.
function driverIdentityLabel(ride: PlatformRideRequest | null, t: { driverNotAssigned: string }): string {
  if (!ride?.driver) return t.driverNotAssigned
  const vehicle = [ride.driver.driverProfile?.vehicleMake, ride.driver.driverProfile?.vehicleModel].filter(Boolean).join(' ')
  const plate = ride.driver.driverProfile?.vehiclePlate
  // Never show a rating for a driver with none yet -- an invented "0.0" or a hidden zero would be
  // exactly the kind of unbacked claim CAPSULE_RULES.noFakeTrustSignal exists to prevent.
  const rating = ride.driver.averageRating !== null ? `★${ride.driver.averageRating} (${ride.driver.ratingCount})` : null
  return [ride.driver.displayName, vehicle, plate, rating].filter(Boolean).join(' · ')
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.stat}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#070b12', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1040, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e2a3c', borderRadius: 8, padding: 18, background: '#101722' },
  eyebrow: { color: '#19d7ff', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: '6px 0', fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, maxWidth: 720, lineHeight: 1.6 },
  grid: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12 },
  driverPhoto: { width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #263651' },
  verifiedBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  cardTitle: { fontSize: 22, margin: 0 },
  mapPreview: { minHeight: 170, border: '1px solid #263651', borderRadius: 8, background: 'linear-gradient(135deg,#0c1220,#122033)', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 18, position: 'relative', overflow: 'hidden' },
  dot: { width: 24, height: 24, borderRadius: 999, background: '#19d7ff', boxShadow: '0 0 0 16px rgba(25,215,255,.13), 0 0 36px rgba(25,215,255,.55)' },
  label: { display: 'grid', gap: 7, color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  input: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 14px', fontWeight: 900 },
  categoryCapsule: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', display: 'grid', gap: 10, padding: 12 },
  categoryTitle: { color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  categoryStrip: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' },
  categoryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  categoryActive: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 12px' },
  touchFilters: { border: '1px solid #263651', borderRadius: 18, background: '#070b12', padding: 12, display: 'grid', gap: 10 },
  filtersHead: { alignItems: 'center', color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 12 },
  toggle: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', fontWeight: 900 },
  stat: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#9aa6ba', display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 14px' },
  cancelButton: { minHeight: 48, border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 14px' },
  sosButton: { minHeight: 56, border: '2px solid #ff4c73', borderRadius: 10, background: 'transparent', color: '#ff4c73', fontWeight: 950, fontSize: 16, width: '100%' },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' },
  message: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, fontWeight: 900 },
  error: { borderColor: 'rgba(255,96,96,.45)', background: 'rgba(255,96,96,.1)', color: '#ffd1d1' },
  addressWarning: { border: '1px solid rgba(255,176,32,.45)', borderRadius: 8, background: 'rgba(255,176,32,.1)', color: '#ffd98a', padding: 12, fontWeight: 800, fontSize: 13, lineHeight: 1.4 },
  starRow: { display: 'flex', gap: 6 },
  star: { border: 0, background: 'transparent', color: '#3a4459', fontSize: 28, padding: 0, cursor: 'pointer' },
  starActive: { border: 0, background: 'transparent', color: '#e5b80b', fontSize: 28, padding: 0, cursor: 'pointer' },
  reviewTextarea: { minHeight: 64, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: 10, fontFamily: 'inherit', resize: 'vertical' },
  payInput: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  payCashDivider: { textAlign: 'center', color: '#5c6b85', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 },
  payCashHint: { color: '#9aa6ba', fontSize: 13, lineHeight: 1.4 },
  chatMessages: { display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' },
  chatEmpty: { color: '#5c6b85', fontSize: 13 },
  chatBubbleMine: { justifySelf: 'end', maxWidth: '80%', borderRadius: '10px 10px 2px 10px', background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.35)', color: '#e7fff6', padding: '8px 10px', fontSize: 13 },
  chatBubbleTheirs: { justifySelf: 'start', maxWidth: '80%', borderRadius: '10px 10px 10px 2px', background: '#0d1420', border: '1px solid #263651', color: '#e7ecf5', padding: '8px 10px', fontSize: 13 },
  chatInputRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  chatInput: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  scheduleRow: { display: 'flex', alignItems: 'center', gap: 8, color: '#9aa6ba', fontWeight: 800, fontSize: 14 },
  savedPlacesRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  savedPlaceChip: { display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #263651', borderRadius: 999, background: '#131e2e', padding: '2px 2px 2px 10px', fontSize: 13, color: '#fff' },
  chipButton: { border: 0, background: 'transparent', color: '#19d7ff', fontWeight: 800, fontSize: 13, padding: '4px 6px', cursor: 'pointer' },
  savePlaceRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
}
