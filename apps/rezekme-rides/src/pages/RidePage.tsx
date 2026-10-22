import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { srRideFilterGroupsFromConfig, type VisualFilterSelection } from '@platform/engines/filters'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import {
  cancelPrototypeSrRide,
  confirmStripePayment,
  confirmStripeSetup,
  createSavedPlace,
  createStripeRideCheckoutSession,
  deleteSavedPlace,
  enablePushNotifications,
  fetchBusinessMembership,
  fetchPrototypeSrRide,
  getStoredGuestSession,
  fetchPrototypeSrRideThread,
  fetchSavedPlaces,
  fetchRideInvoice,
  fetchSavedCard,
  fetchStripePaymentStatus,
  createStripeSetupSession,
  deleteSavedCard,
  openRideInvoice,
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
  type RideInvoice,
  type SavedCard,
  fetchRideWallet,
  createGuestPreRideCheckout,
} from '@platform/shared/api/platformApi'

const ACTIVE_RIDE_STATUSES = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const RIDER_CANCELLABLE_STATUSES = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING']
// Matches MESSAGING_ELIGIBLE_RIDE_STATUSES in server/routes/messages.mjs.
const MESSAGING_ELIGIBLE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']
// Matches LIVE_TRACKING_STATUSES in server/routes/sr-rides.mjs.
const LIVE_TRACKING_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
import { moneyText, statusText } from '@platform/shared/i18n/display'
import { selectedFilterLabels, VisualFilterPanel } from '@platform/shared/filters/VisualFilterPanel'
import { addSrRideBonus, changeSrRideCategory, createSrRideWithCoords, fetchSrAvailability, fetchSrQuoteWithCoords, type CategoryAvailability, type Coords, type StopCoords, submitWalletTopupProof } from '../api'
import { MapHero } from '../maps/MapHero'
import { SeatIcon, VehicleArt, type VehicleKind } from './VehicleArt'
import { PlaceInput } from '../maps/PlaceInput'
import { reverseGeocode } from '../maps/geo'
import { rememberPosition, type DropTarget, type LatLng } from '../maps/mapTypes'

// On-device list of the rider's last 5 destinations (localStorage only; never sent anywhere).
type RecentDestination = { text: string; lat?: number; lng?: number }
const RECENTS_KEY = 'sr.recentDestinations'
function loadRecents(): RecentDestination[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENTS_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is RecentDestination => Boolean(item) && typeof (item as RecentDestination).text === 'string' && (item as RecentDestination).text.trim() !== '')
      .slice(0, 5)
  } catch {
    return []
  }
}
function storeRecent(entry: RecentDestination): RecentDestination[] {
  const next = [entry, ...loadRecents().filter((item) => item.text.trim().toLowerCase() !== entry.text.trim().toLowerCase())].slice(0, 5)
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* storage blocked: the list just isn't remembered */
  }
  return next
}
import { isSrRideLocationConfirmed, type SrRideLocationSource } from './srRideLocationGuard'
import { srFallbackFareMinor, loadSrRates } from './srFareModel'
import { RecordingControls } from './RecordingControls'
import { PaymentPicker, type PayMethod } from './PaymentPicker'
import { RideSignInPanel } from './RideSignInPanel'
import { AssistantBox, ReportProblem } from './HelpTools'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'Rezekme',
    subtitle: 'طلب رحلة حقيقي محفوظ، يُعرض مباشرة على السائقين المتاحين ليقبلوه بأنفسهم.',
    mode: 'وضع بيانات منخفض',
    pickup: 'نقطة الانطلاق',
    dropoff: 'الوجهة',
    category: 'الفئة',
    rideOptions: 'خيارات الرحلة',
    selected: 'محدد',
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
    error: 'تعذر تنفيذ طلب الرحلة',
    saving: 'جار الحفظ',
    gps: 'استخدام موقعي الحالي',
    manualHint: 'يمكن متابعة الطلب حتى بدون GPS عبر العناوين اليدوية.',
    locationNotConfirmed: 'يرجى تأكيد نقطة الانطلاق والوجهة (بالكتابة أو عبر GPS) قبل طلب الرحلة.',
    driverNotAssigned: 'لم يُعيّن سائق بعد',
    verifiedDriver: 'هوية موثقة',
    autoPayTitle: 'الدفع التلقائي بالبطاقة',
    autoPayHint: 'احفظ بطاقة مرة واحدة لتُخصم الأجرة تلقائياً بعد كل رحلة — بدون أي خطوة.',
    addCard: 'إضافة بطاقة',
    addingCard: 'جارٍ الفتح…',
    removeCard: 'إزالة',
    autoPayOn: 'الدفع التلقائي مُفعّل',
    cardEndingIn: 'تنتهي بـ',
    safetyTitle: 'سائقك ومركبته',
    safetyHint: 'احتفظ بهذه التفاصيل لأمانك. إن حدث أي طارئ شاركها مع شخص تثق به.',
    vehicleLabel: 'المركبة',
    plateLabel: 'رقم اللوحة',
    ratingLabel: 'التقييم',
    saveForSafety: 'حفظ/مشاركة للأمان',
    savedConfirm: 'تم حفظ التفاصيل',
    copiedConfirm: 'تم نسخ التفاصيل',
    waitingForDriver: 'بانتظار قبول أحد السائقين القريبين للرحلة...',
    stillLooking: 'ما زلنا نبحث عن سائق. يمكنك متابعة الانتظار أو إلغاء الطلب.',
    etaPrefix: 'على بُعد ~',
    etaSuffix: ' دقيقة',
    driverAssigned: 'تم تعيين سائق لرحلتك.',
    driverArriving: 'السائق في طريقه إليك الآن.',
    inProgress: 'الرحلة جارية الآن.',
    completed: 'اكتملت الرحلة. شكراً لاستخدامك Rezekme.',
    receiptFare: 'المبلغ المدفوع',
    receiptDistance: 'المسافة',
    payTitle: 'تأكيد الدفع',
    payCopy: 'ادفع الأجرة للسائق مباشرة (نقداً أو تحويل)، ثم أدخل رقم مرجع العملية هنا ليتحقق منها فريق Rezekme.',
    payReferencePlaceholder: 'رقم مرجع العملية',
    payCashButton: 'دفعت نقداً للسائق',
    payCardButton: 'الدفع بالبطاقة',
    payCardRedirecting: 'جارٍ التحويل إلى الدفع…',
    payCardConfirming: 'جارٍ تأكيد الدفع…',
    payCashHint: 'أو ادفع نقداً مباشرةً للسائق، ثم أكّد هنا. سيتحقق فريق Rezekme.',
    payOr: 'أو',
    paySubmit: 'إرسال إثبات الدفع',
    paySubmitting: 'جار الإرسال...',
    paymentPending: 'تم إرسال إثبات الدفع، بانتظار المراجعة.',
    paymentConfirmed: 'تم تأكيد الدفع.',
    paymentRejected: 'تعذر قبول إثبات الدفع السابق. يرجى إرسال رقم مرجع صحيح.',
    cancellationFeeLabel: 'رسوم الإلغاء',
    payFeeTitle: 'تأكيد دفع رسوم الإلغاء',
    payFeeCopy: 'تطبق رسوم إلغاء. حوّل المبلغ إلى حساب منصة Rezekme — سيحصل السائق على حصته بعد مراجعة المشرف. أدخل رقم مرجع التحويل أدناه.',
    cancellationFeeWarning: 'قد يترتب على الإلغاء الآن رسوم إلغاء تقريبية قدرها {amount} لأن السائق بدأ التوجه إليك بالفعل.',
    chatTitle: 'راسل السائق',
    chatEmpty: 'لا توجد رسائل بعد.',
    chatPlaceholder: 'اكتب رسالة...',
    chatSend: 'إرسال',
    shareTrip: 'شارك رحلتي',
    sharing: 'جار المشاركة...',
    shareCopied: '✓ تم نسخ رابط المشاركة',
    shareTitle: 'رحلتي مع Rezekme',
    shareText: 'تابع رحلتي مباشرة عبر هذا الرابط.',
    scheduleForLater: 'جدولة الرحلة لوقت لاحق',
    scheduleRide: 'جدولة الرحلة',
    scheduledFor: 'مجدولة في',
    accessibilityRequired: 'أحتاج مركبة تسمح بالوصول لذوي الاحتياجات الخاصة',
    deliveryOnly: 'توصيل طرد — بدون راكب (السائق يستلم ويسلّم الطرد)',
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
    invoiceTitle: 'فاتورة Rezekme',
    downloadInvoice: 'عرض / تنزيل الفاتورة',
    cancelled: 'تم إلغاء الرحلة.',
    cancel: 'إلغاء الرحلة',
    cancelling: 'جار الإلغاء',
    newRide: 'طلب رحلة جديدة',
    sos: 'طوارئ SOS',
    sosConfirm: 'هل أنت في حالة طوارئ؟ سيتم تنبيه فريق Rezekme فوراً مع موقعك وتفاصيل الرحلة.',
    sosSending: 'جار إرسال التنبيه...',
    sosSent: '✓ تم إرسال تنبيه الطوارئ. فريق Rezekme على علم الآن.',
    sosFailed: 'تعذر إرسال تنبيه الطوارئ. حاول مجدداً أو اتصل بالطوارئ مباشرة.',
  },
  en: {
    back: 'Back to landing',
    title: 'Rezekme',
    subtitle: 'A real ride request, saved and broadcast live to available drivers to self-accept.',
    mode: 'Low-data mode',
    pickup: 'Pickup',
    dropoff: 'Dropoff',
    category: 'Category',
    rideOptions: 'Ride options',
    selected: 'selected',
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
    error: 'Could not complete the ride request',
    saving: 'Saving',
    gps: 'Use my current location',
    manualHint: 'The request can continue without GPS through manual addresses.',
    locationNotConfirmed: 'Please confirm both pickup and dropoff (by typing or via GPS) before requesting a ride.',
    driverNotAssigned: 'Not assigned yet',
    verifiedDriver: 'Verified identity',
    autoPayTitle: 'Automatic card payment',
    autoPayHint: 'Save a card once and the fare is charged automatically after each ride — no steps.',
    addCard: 'Add a card',
    addingCard: 'Opening…',
    removeCard: 'Remove',
    autoPayOn: 'Auto-pay is on',
    cardEndingIn: 'ending in',
    safetyTitle: 'Your driver & vehicle',
    safetyHint: 'Keep these details for your safety. If anything happens, share them with someone you trust.',
    vehicleLabel: 'Vehicle',
    plateLabel: 'Plate number',
    ratingLabel: 'Rating',
    saveForSafety: 'Save / share for safety',
    savedConfirm: 'Details saved',
    copiedConfirm: 'Details copied',
    waitingForDriver: 'Waiting for a nearby driver to accept the ride...',
    stillLooking: 'Still finding you a driver. You can keep waiting or cancel the request.',
    etaPrefix: '~',
    etaSuffix: ' min away',
    driverAssigned: 'A driver has been assigned to your ride.',
    driverArriving: 'Your driver is on the way to you.',
    inProgress: 'Your ride is now in progress.',
    completed: 'Ride completed. Thanks for riding with Rezekme.',
    receiptFare: 'Amount charged',
    receiptDistance: 'Distance',
    payTitle: 'Confirm payment',
    payCopy: "Transfer the fare to the Rezekme platform account (see QR below or contact support), then enter the transfer reference here.",
    payReferencePlaceholder: 'Transaction reference',
    payCashButton: 'I paid the driver in cash',
    payCardButton: 'Pay by card',
    payCardRedirecting: 'Redirecting to payment…',
    payCardConfirming: 'Confirming payment…',
    payCashHint: 'Or pay the driver in cash directly, then confirm here. Rezekme will verify it.',
    payOr: 'or',
    paySubmit: 'Submit payment proof',
    paySubmitting: 'Submitting...',
    paymentPending: 'Payment proof submitted, awaiting review.',
    paymentConfirmed: 'Payment confirmed.',
    paymentRejected: 'The previous payment proof could not be accepted. Please submit a valid reference.',
    cancellationFeeLabel: 'Cancellation fee',
    payFeeTitle: 'Confirm cancellation fee payment',
    payFeeCopy: 'A cancellation fee applies. Transfer the amount to the Rezekme platform account — the driver will receive their share after admin verification. Enter the transfer reference below.',
    cancellationFeeWarning: 'Cancelling now may incur an estimated cancellation fee of {amount} because your driver has already started heading your way.',
    chatTitle: 'Message your driver',
    chatEmpty: 'No messages yet.',
    chatPlaceholder: 'Type a message...',
    chatSend: 'Send',
    shareTrip: 'Share my trip',
    sharing: 'Sharing...',
    shareCopied: '✓ Share link copied',
    shareTitle: 'My Rezekme ride',
    shareText: 'Follow my ride live via this link.',
    scheduleForLater: 'Schedule for later',
    scheduleRide: 'Schedule ride',
    scheduledFor: 'Scheduled for',
    accessibilityRequired: 'I need a wheelchair-accessible vehicle',
    deliveryOnly: 'Package delivery — no passenger (driver picks up and drops off a package)',
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
    invoiceTitle: 'Rezekme invoice',
    downloadInvoice: 'View / download invoice',
    cancelled: 'This ride was cancelled.',
    cancel: 'Cancel ride',
    cancelling: 'Cancelling',
    newRide: 'Request a new ride',
    sos: 'SOS emergency',
    sosConfirm: 'Are you in an emergency? Rezekme will be alerted immediately with your location and trip details.',
    sosSending: 'Sending alert...',
    sosSent: '✓ Emergency alert sent. The Rezekme team has been notified.',
    sosFailed: 'Could not send the emergency alert. Try again or call emergency services directly.',
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'Rezekme',
    subtitle: 'Une vraie demande de course, enregistrée et diffusée en direct aux chauffeurs disponibles, qui l’acceptent eux-mêmes.',
    mode: 'Mode données réduites',
    pickup: 'Point de départ',
    dropoff: 'Destination',
    category: 'Catégorie',
    rideOptions: 'Options de course',
    selected: 'sélectionné(s)',
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
    error: 'Impossible de finaliser la demande de course',
    saving: 'Enregistrement',
    gps: 'Utiliser ma position actuelle',
    manualHint: 'La demande peut se poursuivre sans GPS grâce aux adresses saisies manuellement.',
    locationNotConfirmed: 'Veuillez confirmer le point de départ et la destination (en les saisissant ou par GPS) avant de demander une course.',
    driverNotAssigned: 'Pas encore attribué',
    verifiedDriver: 'Identité vérifiée',
    autoPayTitle: 'Paiement automatique par carte',
    autoPayHint: 'Enregistrez une carte une fois et le tarif est débité automatiquement après chaque course.',
    addCard: 'Ajouter une carte',
    addingCard: 'Ouverture…',
    removeCard: 'Retirer',
    autoPayOn: 'Paiement automatique activé',
    cardEndingIn: 'se terminant par',
    safetyTitle: 'Votre chauffeur et son véhicule',
    safetyHint: 'Conservez ces informations pour votre sécurité. En cas de problème, partagez-les avec une personne de confiance.',
    vehicleLabel: 'Véhicule',
    plateLabel: 'Plaque d’immatriculation',
    ratingLabel: 'Note',
    saveForSafety: 'Enregistrer / partager',
    savedConfirm: 'Détails enregistrés',
    copiedConfirm: 'Détails copiés',
    waitingForDriver: 'En attente qu’un chauffeur à proximité accepte la course...',
    stillLooking: 'Recherche d’un chauffeur en cours. Vous pouvez patienter ou annuler la demande.',
    etaPrefix: '~',
    etaSuffix: ' min',
    driverAssigned: 'Un chauffeur a été attribué à votre course.',
    driverArriving: 'Votre chauffeur est en route vers vous.',
    inProgress: 'Votre course est en cours.',
    completed: 'Course terminée. Merci d’avoir voyagé avec Rezekme.',
    receiptFare: 'Montant facturé',
    receiptDistance: 'Distance',
    payTitle: 'Confirmer le paiement',
    payCopy: 'Payez le tarif directement au chauffeur (en espèces ou par virement), puis saisissez ici la référence de la transaction afin que Rezekme puisse la vérifier.',
    payReferencePlaceholder: 'Référence de la transaction',
    payCashButton: 'J’ai payé le chauffeur en espèces',
    payCardButton: 'Payer par carte',
    payCardRedirecting: 'Redirection vers le paiement…',
    payCardConfirming: 'Confirmation du paiement…',
    payCashHint: 'Ou payez le chauffeur en espèces directement, puis confirmez ici. Rezekme le vérifiera.',
    payOr: 'ou',
    paySubmit: 'Envoyer la preuve de paiement',
    paySubmitting: 'Envoi...',
    paymentPending: 'Preuve de paiement envoyée, en attente de vérification.',
    paymentConfirmed: 'Paiement confirmé.',
    paymentRejected: 'La preuve de paiement précédente n’a pas pu être acceptée. Veuillez envoyer une référence valide.',
    cancellationFeeLabel: 'Frais d’annulation',
    payFeeTitle: 'Confirmer le paiement des frais d’annulation',
    payFeeCopy: 'Votre chauffeur avait déjà commencé à se diriger vers vous. Payez-lui directement les frais d’annulation (en espèces ou par virement), puis saisissez ici la référence de la transaction afin que Rezekme puisse la vérifier.',
    cancellationFeeWarning: 'Annuler maintenant peut entraîner des frais d’annulation estimés à {amount}, car votre chauffeur a déjà commencé à se diriger vers vous.',
    chatTitle: 'Écrire à votre chauffeur',
    chatEmpty: 'Aucun message pour l’instant.',
    chatPlaceholder: 'Écrivez un message...',
    chatSend: 'Envoyer',
    shareTrip: 'Partager mon trajet',
    sharing: 'Partage...',
    shareCopied: '✓ Lien de partage copié',
    shareTitle: 'Ma course Rezekme',
    shareText: 'Suivez ma course en direct grâce à ce lien.',
    scheduleForLater: 'Planifier pour plus tard',
    scheduleRide: 'Planifier la course',
    scheduledFor: 'Planifiée pour le',
    accessibilityRequired: 'J’ai besoin d’un véhicule accessible en fauteuil roulant',
    deliveryOnly: 'Livraison de colis — sans passager (le chauffeur récupère et livre un colis)',
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
    invoiceTitle: 'Facture Rezekme',
    downloadInvoice: 'Voir / télécharger la facture',
    cancelled: 'Cette course a été annulée.',
    cancel: 'Annuler la course',
    cancelling: 'Annulation',
    newRide: 'Demander une nouvelle course',
    sos: 'Urgence SOS',
    sosConfirm: 'Êtes-vous en situation d’urgence ? Rezekme sera alerté immédiatement avec votre position et les détails de la course.',
    sosSending: 'Envoi de l’alerte...',
    sosSent: '✓ Alerte d’urgence envoyée. L’équipe Rezekme a été prévenue.',
    sosFailed: 'Impossible d’envoyer l’alerte d’urgence. Réessayez ou appelez les secours directement.',
  },
}

const categories = ['SR Bike', 'SR Economy', 'SR Comfort', 'SR SUV', 'SR Van', 'SR VIP']

// Display metadata for the ride classes. The platform has NO seat-capacity data (the filter groups only
// carry names/art, the server only maps category -> vehicle class), so `seats` is a NOMINAL passenger
// count for display; the real limit the app enforces is the 1..8 rider stepper in More options.
const CATEGORY_META: Record<string, { kind: VehicleKind; seats: number }> = {
  'SR Bike': { kind: 'bike', seats: 1 },
  'SR Economy': { kind: 'economy', seats: 4 },
  'SR Comfort': { kind: 'comfort', seats: 4 },
  'SR SUV': { kind: 'suv', seats: 6 },
  'SR Van': { kind: 'van', seats: 8 },
  'SR VIP': { kind: 'vip', seats: 4 },
}

// What each car class carries (large 23 kg bags / hand bags). Used to grey out classes that are too small
// for the rider's luggage, so nobody books a car whose driver would have to refuse them at the door.
const CATEGORY_CAPACITY: Record<string, { large: number; hand: number }> = {
  'SR Bike': { large: 0, hand: 1 },
  'SR Economy': { large: 2, hand: 2 },
  'SR Comfort': { large: 3, hand: 3 },
  'SR SUV': { large: 5, hand: 4 },
  'SR Van': { large: 8, hand: 6 },
  'SR VIP': { large: 3, hand: 3 },
}

const rideCategoryByFilter: Record<string, string> = {
  bike: 'SR Bike',
  economy: 'SR Economy',
  comfort: 'SR Comfort',
  familyVan: 'SR SUV',
  van: 'SR Van',
  vip: 'SR VIP',
}

// Reverse of the above: keep the category strip and the filter-panel category selection in sync.
const filterKeyByCategory: Record<string, string> = {
  'SR Bike': 'bike',
  'SR Economy': 'economy',
  'SR Comfort': 'comfort',
  'SR SUV': 'familyVan',
  'SR Van': 'van',
  'SR VIP': 'vip',
}

export function RidePage({ lang }: Props) {
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
  // A new request always starts empty: the last trip is not pre-filled any more (riders read it as an old ride).
  // Keep the open trip across reloads: remember its id on this device and re-load it on mount.
  useEffect(() => {
    try {
      const id = window.localStorage.getItem('rezekme.activeRideId')
      if (!id) return
      fetchPrototypeSrRide(id)
        .then((r) => {
          if (r && !['COMPLETED', 'CANCELLED'].includes(r.status)) setRide(r)
          else window.localStorage.removeItem('rezekme.activeRideId')
        })
        .catch(() => {})
    } catch {
      /* storage unavailable */
    }
  }, [])
  useEffect(() => {
    try {
      if (ride && !['COMPLETED', 'CANCELLED'].includes(ride.status)) window.localStorage.setItem('rezekme.activeRideId', ride.id)
      else if (ride) window.localStorage.removeItem('rezekme.activeRideId')
    } catch {
      /* storage unavailable */
    }
  }, [ride])
  const [driverPhotoUrl, setDriverPhotoUrl] = useState<string | null>(null)
  const [quote, setQuote] = useState<PlatformSrQuote | null>(null)
  // Which category the current `quote` was fetched for (the quote is refetched ~400 ms after a change).
  const [quoteCategory, setQuoteCategory] = useState<string | null>(null)
  // Real server quotes for EVERY car category on the current trip (so the list shows true prices,
  // not the local estimate): { 'SR Economy': quote, ... }. Cleared whenever the trip inputs change.
  const [autoSwitch, setAutoSwitch] = useState(false)
  const [availability, setAvailability] = useState<Record<string, CategoryAvailability>>({})
  const [hideNoDriverUntil, setHideNoDriverUntil] = useState(0)
  const [quotesByCategory, setQuotesByCategory] = useState<Record<string, PlatformSrQuote>>({})
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
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null)
  const [cardSetupStatus, setCardSetupStatus] = useState<'idle' | 'redirecting' | 'confirming' | 'error'>('idle')
  const [invoice, setInvoice] = useState<RideInvoice | null>(null)
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
  // Yallago gap-closure #4b: package delivery (no passenger).
  const [deliveryOnly, setDeliveryOnly] = useState(false)
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
  const [handBagCount, setHandBagCount] = useState(0)
  // Yallago gap-closure #3: optional driver bonus (whole USD, 0..20) to attract a driver faster.
  const [bonusMinor, setBonusMinor] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  // Payment picker: guest vs client mode, wallet balance, selected method, Sham Cash fields
  // Read on every render: the rider picks guest/client in the sign-in panel at the Confirm step, after this page is already open.
  const entryMode: 'guest' | 'client' = (() => {
    try { return (window.localStorage.getItem('rezekme.entryMode') as 'guest' | 'client') || 'guest' } catch { return 'guest' }
  })()
  // Sign-in comes right before paying (Uber-style): browsing and prices need no session.
  const sessionToken = getStoredGuestSession()?.token ?? null
  const [signInOpen, setSignInOpen] = useState(false)
  const [walletBalanceMinor, setWalletBalanceMinor] = useState<number | null>(null)
  const [selectedPayMethod, setSelectedPayMethod] = useState<PayMethod>(null)
  const [shamCashRef, setShamCashRef] = useState('')
  const [shamCashStatus, setShamCashStatus] = useState<'idle' | 'saving' | 'submitted' | 'error'>('idle')
  const [guestCheckoutStatus, setGuestCheckoutStatus] = useState<'idle' | 'redirecting'>('idle')
  // Coordinates attached to the dropoff / stops when they came from Places, a saved place or a map pin.
  // A hand-edit of the text clears them (and flips the source to 'manual'), exactly like pickupCoords.
  const [dropoffCoords, setDropoffCoords] = useState<Coords | undefined>()
  const [stopCoordsList, setStopCoordsList] = useState<Array<Coords | undefined>>([])
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [recents, setRecents] = useState<RecentDestination[]>(() => loadRecents())
  const pinRef = useRef<{ pickup?: LatLng; dropoff?: LatLng }>({})
  // Pins the rider's request was made with: used for the live map when the server could not geocode an address (its ride GET then returns no coordinates for that point).
  const [requestedPins, setRequestedPins] = useState<{ pickup: LatLng | null; dropoff: LatLng | null; stops: LatLng[] }>({ pickup: null, dropoff: null, stops: [] })
  // Coordinates for the NON-BLANK stops, in the same order as trimmedStops (the server aligns by index).
  const trimmedStopCoords = useMemo<StopCoords>(
    () => stops.flatMap((stop, index) => (stop.trim() ? [stopCoordsList[index] ?? null] : [])),
    [stops, stopCoordsList],
  )
  const [chatOpen, setChatOpen] = useState(false)
  const [savedPlaces, setSavedPlaces] = useState<PlatformSavedPlace[]>([])
  const [newPlaceLabel, setNewPlaceLabel] = useState('')
  const [savingPlace, setSavingPlace] = useState(false)
  const rideFilterGroups = useMemo(() => srRideFilterGroupsFromConfig(), [])

  // Pre-quote estimate derived from the SAME rate model the server uses (srFareModel), so it
  // matches the server's own estimated fare instead of a stale flat rate several times too high.
  const [ratesVersion, setRatesVersion] = useState(0)
  useEffect(() => { void loadSrRates(import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051').then((ok) => { if (ok) setRatesVersion((v) => v + 1) }) }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fallbackFareMinor = useMemo(() => srFallbackFareMinor(category, lowDataMode), [category, lowDataMode, ratesVersion])

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
    fetchSavedCard()
      .then((card) => {
        if (!cancelled) setSavedCard(card)
      })
      .catch(() => {})
    const params = new URLSearchParams(window.location.search)
    // Returned from a save-card (setup) Checkout -> confirm and store the card.
    const setupSessionId = params.get('setup_session_id')
    if (setupSessionId) {
      setCardSetupStatus('confirming')
      confirmStripeSetup(setupSessionId)
        .then((card) => {
          if (cancelled) return
          setSavedCard(card)
          setCardSetupStatus('idle')
          const clean = window.location.pathname + window.location.hash
          window.history.replaceState(null, '', clean)
        })
        .catch((error) => {
          if (cancelled) return
          setCardSetupStatus('error')
          setMessage(error instanceof Error ? error.message : t.error)
        })
    }
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
    // Returned from guest pre-ride Stripe checkout -> auto-request the ride
    const guestCheckoutSessionId = params.get('guest_checkout_session_id')
    if (guestCheckoutSessionId) {
      try {
        const pendingRaw = window.localStorage.getItem('rezekme.guestPendingRide')
        if (pendingRaw) {
          const pending = JSON.parse(pendingRaw) as {
            pickup: string; dropoff: string; category: string; pickupCoords?: { lat: number; lng: number }; dropoffCoords?: { lat: number; lng: number }; bagCount?: number; handBagCount?: number
          }
          window.localStorage.removeItem('rezekme.guestPendingRide')
          const clean = window.location.pathname + window.location.hash
          window.history.replaceState(null, '', clean)
          setStatus('saving')
          createSrRideWithCoords({
            pickup: pending.pickup,
            dropoff: pending.dropoff,
            category: pending.category as never,
            currency: 'USD',
            lowDataMode: false,
            bagCount: pending.bagCount,
            handBagCount: pending.handBagCount,
            guestStripeSessionId: guestCheckoutSessionId,
          }).then((nextRide) => {
            if (cancelled) return
            setRide(nextRide)
            setStatus('idle')
          }).catch((err) => {
            if (cancelled) return
            setStatus('error')
            setMessage(err instanceof Error ? err.message : 'Payment error')
          })
        }
      } catch { /* ignore parse errors */ }
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch USD wallet balance for client riders (used by PaymentPicker)
  useEffect(() => {
    // Guests and clients both pay from a wallet; a submitted Sham Cash top-up is re-checked every 15 s until an admin credits it.
    let cancelled = false
    const load = () =>
      fetchRideWallet('USD')
        .then((wallet) => {
          if (!cancelled) setWalletBalanceMinor(wallet ? wallet.cachedBalanceMinor : 0)
        })
        .catch(() => {
          if (!cancelled) setWalletBalanceMinor((prev) => prev ?? 0)
        })
    void load()
    const timer = shamCashStatus === 'submitted' ? window.setInterval(() => void load(), 15000) : null
    return () => { cancelled = true; if (timer) window.clearInterval(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shamCashStatus, sessionToken])

  // Fetch (lazily minting) the Rezekme invoice once the ride is terminal, to show its number + link.
  useEffect(() => {
    const st = ride?.status
    if (!ride || (st !== 'COMPLETED' && st !== 'CANCELLED')) {
      setInvoice(null)
      return
    }
    let cancelled = false
    fetchRideInvoice(ride.id)
      .then((inv) => {
        if (!cancelled) setInvoice(inv)
      })
      .catch(() => {
        if (!cancelled) setInvoice(null)
      })
    return () => {
      cancelled = true
    }
  }, [ride?.id, ride?.status])

  useEffect(() => {
    if (ride) return
    const timer = window.setTimeout(() => {
      fetchSrQuoteWithCoords({ pickup, dropoff, category, lowDataMode, pickupCoords, dropoffCoords, stops: trimmedStops, stopCoords: trimmedStopCoords, riderCount, bagCount, scheduled: scheduleForLater }).then((result) => {
        setQuote(result)
        setQuoteCategory(category)
      }).catch(() => setQuote(null))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [pickup, dropoff, category, lowDataMode, pickupCoords, dropoffCoords, ride, trimmedStops, trimmedStopCoords, riderCount, bagCount, scheduleForLater])

  // Live availability near the pickup (per category driver count + ETA), refreshed every 20s.
  const availabilityPoint = quote?.pickupCoords ?? pickupCoords
  useEffect(() => {
    if (ride || !availabilityPoint) return
    let cancelled = false
    const load = () => {
      fetchSrAvailability(availabilityPoint)
        .then((rows) => {
          if (!cancelled) setAvailability(Object.fromEntries(rows.map((row) => [row.category, row])))
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 20000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [availabilityPoint?.lat, availabilityPoint?.lng, ride])

  useEffect(() => {
    if (ride) return
    setQuotesByCategory({})
    let cancelled = false
    const timer = window.setTimeout(() => {
      categories.forEach((item) => {
        fetchSrQuoteWithCoords({ pickup, dropoff, category: item, lowDataMode, pickupCoords, dropoffCoords, stops: trimmedStops, stopCoords: trimmedStopCoords, riderCount, bagCount, scheduled: scheduleForLater })
          .then((result) => {
            if (!cancelled) setQuotesByCategory((current) => ({ ...current, [item]: result }))
          })
          .catch(() => {})
      })
    }, 500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [pickup, dropoff, lowDataMode, pickupCoords, dropoffCoords, ride, trimmedStops, trimmedStopCoords, riderCount, bagCount, scheduleForLater])

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
        pinRef.current.pickup = undefined
        rememberPosition({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      () => {
        setAccuracyMeters(undefined)
        setPickupCoords(undefined)
        setMessage(t.manualHint)
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    )
  }

  // One place that changes an endpoint, so text / source / coordinates can never get out of step:
  // any change that is not a map pin first forgets the pending reverse-geocode for that endpoint.
  function setEndpoint(target: DropTarget, text: string, source: SrRideLocationSource, coords?: Coords) {
    pinRef.current[target] = undefined
    if (target === 'pickup') {
      setPickup(text)
      setPickupSource(source)
      setPickupCoords(coords)
      if (source !== 'gps') setAccuracyMeters(undefined)
    } else {
      setDropoff(text)
      setDropoffSource(source)
      setDropoffCoords(coords)
    }
  }

  // Google Places suggestion: text AND coordinates come from the selection ('place' source).
  function applyPlace(target: DropTarget, selection: { text: string; point: LatLng }) {
    setEndpoint(target, selection.text, 'place', selection.point)
  }

  // Map tap / long-press: coordinates come from the tap ('pin' source). The label is "Dropped pin"
  // right away and is upgraded to a reverse-geocoded address only if Google answers and the rider
  // has not changed that endpoint in the meantime.
  function applyMapPin(target: DropTarget, point: LatLng) {
    const label = pick(lang, 'دبوس على الخريطة', 'Dropped pin', 'Repère placé')
    setEndpoint(target, label, 'pin', point)
    pinRef.current[target] = point
    setDropTarget(null)
    void reverseGeocode(point, lang).then((address) => {
      if (!address || pinRef.current[target] !== point) return
      if (target === 'pickup') setPickup(address)
      else setDropoff(address)
    })
  }

  function applyStopPlace(index: number, selection: { text: string; point: LatLng }) {
    setStops((previous) => previous.map((value, valueIndex) => (valueIndex === index ? selection.text : value)))
    setStopCoordsList((previous) => {
      const next = [...previous]
      next[index] = selection.point
      return next
    })
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
              pickupCoords,
              dropoffCoords,
            })) {
      setStatus('error')
      setMessage(t.locationNotConfirmed)
      return
    }

    // Not signed in yet: ask now, right before paying. Everything the rider chose stays on screen.
    if (!getStoredGuestSession()) {
      setSignInOpen(true)
      return
    }

    // Guest or client card: save pending ride to localStorage, redirect to Stripe
    if (selectedPayMethod === 'card' && (entryMode === 'guest' || entryMode === 'client')) {
      setGuestCheckoutStatus('redirecting')
      try {
        try {
          window.localStorage.setItem('rezekme.guestPendingRide', JSON.stringify({
            pickup: pickup.trim(),
            dropoff: dropoff.trim(),
            category,
            pickupCoords,
            dropoffCoords,
            bagCount,
            handBagCount,
          }))
        } catch { /* storage blocked */ }
        const { url } = await createGuestPreRideCheckout(fareMinor, 'USD')
        window.location.href = url
      } catch (err) {
        setGuestCheckoutStatus('idle')
        setStatus('error')
        setMessage(err instanceof Error ? err.message : 'Checkout error')
      }
      return
    }


    setStatus('saving')
    setMessage('')

    try {
      const nextRide = await createSrRideWithCoords({
        pickup,
        dropoff,
        category,
        currency: 'USD',
        lowDataMode,
        accuracyMeters,
        pickupCoords,
        dropoffCoords,
        routeType: String(rideFilters.srRideRoute || ''),
        features: Array.isArray(rideFilters.srRideFeatures) ? rideFilters.srRideFeatures : [],
        scheduledFor: scheduleForLater && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        accessibilityRequired,
        deliveryOnly: deliveryOnly || undefined,
        stops: trimmedStops,
        stopCoords: trimmedStopCoords,
        riderCount,
        bagCount,
        handBagCount,
        bonusMinor: bonusMinor > 0 ? bonusMinor : undefined,
        promoCode: promoCode.trim() || undefined,
        billToBusinessAccount: businessAccountName ? billToBusinessAccount : undefined,
        shareable,
        autoSwitch,
      } as never)
      setRide(nextRide)
      setStatus('idle')
      setMessage(t.saved)
      setDropTarget(null)
      setRequestedPins({ pickup: bookingPickupPin, dropoff: bookingDropoffPin, stops: bookingStopPins })
      setRecents(storeRecent({ text: dropoff.trim(), lat: dropoffCoords?.lat, lng: dropoffCoords?.lng }))
      try {
        window.localStorage.setItem('rezekme.lastTrip', JSON.stringify({ pickup: pickup.trim(), dropoff: dropoff.trim(), category }))
      } catch {
        /* storage blocked */
      }
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

  // Stripe-for-SR Option B: save a card once (hosted setup Checkout) so future trips auto-charge.
  async function startAddCard() {
    setCardSetupStatus('redirecting')
    try {
      const { url } = await createStripeSetupSession()
      window.location.assign(url)
    } catch (error) {
      setCardSetupStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function removeSavedCard() {
    try {
      await deleteSavedCard()
      setSavedCard(null)
    } catch (error) {
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
      return <div style={styles.notice}>✓ {t.paymentConfirmed}</div>
    }
    if (latestProof?.status === 'PENDING_ADMIN_REVIEW') {
      return <div style={styles.notice}>{t.paymentPending}</div>
    }
    // A REJECTED proof falls through to the form below so the rider can resubmit.
    return (
      <div style={styles.subCard}>
        <strong>{title}</strong>
        <span>{copy}</span>
        {latestProof?.status === 'REJECTED' && <p style={styles.warn}>{t.paymentRejected}</p>}
        <input
          style={styles.textInput}
          value={payProviderRef}
          onChange={(event) => setPayProviderRef(event.target.value)}
          placeholder={t.payReferencePlaceholder}
        />
        <button disabled={!payProviderRef.trim() || payStatus === 'saving'} style={styles.bigButtonInline} onClick={() => void submitPayment()}>
          {payStatus === 'saving' ? t.paySubmitting : t.paySubmit}
        </button>

        {stripeConfigured && (
          <>
            <div style={styles.orDivider}>{t.payOr}</div>
            <button
              disabled={cardStatus === 'redirecting' || cardStatus === 'confirming'}
              style={styles.bigButtonInline}
              onClick={() => void payByCard()}
            >
              {cardStatus === 'redirecting' ? t.payCardRedirecting : cardStatus === 'confirming' ? t.payCardConfirming : t.payCardButton}
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

  const confirmedLocations = isSrRideLocationConfirmed({
    pickupSource,
    dropoffSource,
    pickup,
    dropoff,
    pickupDefaultText: PICKUP_DEFAULT_TEXT,
    dropoffDefaultText: DROPOFF_DEFAULT_TEXT,
    pickupCoords,
    dropoffCoords,
  })
  // ---- map pins. Booking: the rider's own coordinates win, else the quote's geocoded points (only once
  // both endpoints are really confirmed, so the seeded placeholder addresses never put pins on the map).
  const quoteStopCoords = ((quote as { stopCoords?: Array<Coords | null> } | null)?.stopCoords || []) as Array<Coords | null>
  const bookingPickupPin = pickupCoords ?? (confirmedLocations ? quote?.pickupCoords ?? null : null)
  const bookingDropoffPin = dropoffCoords ?? (confirmedLocations ? quote?.dropoffCoords ?? null : null)
  const bookingStopPins = confirmedLocations
    ? trimmedStops.flatMap((_, index) => {
        const point = trimmedStopCoords[index] ?? quoteStopCoords[index] ?? null
        return point ? [point] : []
      })
    : []
  const mapLabels = {
    show: pick(lang, 'عرض الخريطة', 'Show map', 'Afficher la carte'),
    hide: pick(lang, 'إخفاء الخريطة', 'Hide map', 'Masquer la carte'),
    recenter: pick(lang, 'إعادة التمركز / موقعي', 'Recenter / my location', 'Recentrer / ma position'),
    loading: pick(lang, 'جار تحميل الخريطة…', 'Loading map…', 'Chargement de la carte…'),
  }
  const ui = {
    whereTo: pick(lang, 'إلى أين؟', 'Where to?', 'Où allez-vous ?'),
    pickupPlaceholder: pick(lang, 'نقطة الانطلاق', 'Pickup location', 'Point de départ'),
    chooseRide: pick(lang, 'اختر رحلتك', 'Choose a ride', 'Choisissez une course'),
    enterBoth: pick(lang, 'أدخل الوجهة لعرض الأسعار.', 'Enter your destination to see prices.', 'Entrez votre destination pour voir les prix.'),
    confirm: pick(lang, 'تأكيد', 'Confirm', 'Confirmer'),
    moreOptions: pick(lang, 'خيارات إضافية', 'More options', 'Plus d’options'),
    riders: pick(lang, 'عدد الركاب', 'Riders', 'Passagers'),
    bags: pick(lang, 'عدد الحقائب', 'Bags', 'Bagages'),
    bonus: pick(lang, 'مكافأة للسائق (اختياري $)', 'Driver bonus (optional $)', 'Bonus chauffeur (optionnel $)'),
    estTime: pick(lang, 'الوقت التقريبي', 'Est. time', 'Durée estimée'),
    minShort: pick(lang, 'د', 'min', 'min'),
    fromPlace: pick(lang, 'انطلاق', 'From', 'Départ'),
    showMap: pick(lang, 'عرض الخريطة', 'Show map', 'Afficher la carte'),
    hideMap: pick(lang, 'إخفاء الخريطة', 'Hide map', 'Masquer la carte'),
    loadingMap: pick(lang, 'جار تحميل الخريطة…', 'Loading map…', 'Chargement de la carte…'),
    pinTitle: pick(lang, 'رمز الاستلام', 'Pickup code', 'Code de prise en charge'),
    chat: pick(lang, 'مراسلة', 'Chat', 'Message'),
    share: pick(lang, 'مشاركة', 'Share', 'Partager'),
    safety: pick(lang, 'طوارئ', 'SOS', 'SOS'),
    tipHeading: pick(lang, 'بقشيش', 'Tip', 'Pourboire'),
    totalLabel: pick(lang, 'المجموع', 'Total', 'Total'),
    pinOnMap: pick(lang, 'على الخريطة', 'Map', 'Carte'),
    tapToSetDropoff: pick(lang, 'المس الخريطة لتحديد الوجهة', 'Tap the map to set your destination', 'Touchez la carte pour fixer la destination'),
    tapToSetPickup: pick(lang, 'المس الخريطة لتحديد نقطة الانطلاق', 'Tap the map to set your pickup', 'Touchez la carte pour fixer le départ'),
    recent: pick(lang, 'الأخيرة', 'Recent', 'Récents'),
    driverLocationUnavailable: pick(lang, 'موقع السائق غير متاح حالياً.', 'Driver location is not available right now.', 'La position du chauffeur n’est pas disponible pour le moment.'),
    seats: pick(lang, 'مقاعد', 'seats', 'places'),
    trip: pick(lang, 'للرحلة', 'trip', 'trajet'),
    estimate: pick(lang, 'تقديري', 'estimate', 'estimation'),
    findingDriver: pick(lang, 'جار البحث عن سائق…', 'Finding your driver…', 'Recherche de votre chauffeur…'),
    payment: pick(lang, 'الدفع', 'Payment', 'Paiement'),
  }
  const tipOptions = [10, 15, 20]
  const liveDriverPin = ride?.driver?.location ? { lat: ride.driver.location.lat, lng: ride.driver.location.lng } : null
  // ---- driver proximity alerts: "arrives within 2 min" once, and "driver is here" once per ride.
  const [driverAlert, setDriverAlert] = useState<'soon' | 'here' | null>(null)
  const alertedRef = useRef<{ rideId: string; soon: boolean; here: boolean }>({ rideId: '', soon: false, here: false })
  const alertEta = ride && typeof ride.etaToPickupMinutes === 'number' ? ride.etaToPickupMinutes : null
  const alertStatus = ride?.status ?? null
  const alertArrived = Boolean(ride?.wait?.arrivedAt)
  const alertRideId = ride?.id ?? ''
  useEffect(() => {
    if (!alertRideId) return
    if (alertedRef.current.rideId !== alertRideId) alertedRef.current = { rideId: alertRideId, soon: false, here: false }
    const state = alertedRef.current
    const beep = (pattern: number[]) => {
      try { navigator.vibrate?.(pattern) } catch { /* not supported */ }
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        const ctx = new Ctx()
        pattern.forEach((ms, index) => {
          if (index % 2 !== 0) return
          const start = ctx.currentTime + pattern.slice(0, index).reduce((a, b) => a + b, 0) / 1000
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.frequency.value = 880
          gain.gain.value = 0.2
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(start)
          osc.stop(start + ms / 1000)
        })
        setTimeout(() => { void ctx.close() }, 4000)
      } catch { /* audio blocked until a user gesture; the banner still shows */ }
    }
    const notify = (title: string) => {
      try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification(title)
      } catch { /* ignore */ }
    }
    if (alertArrived && !state.here && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(alertStatus || '')) {
      state.here = true
      state.soon = true
      setDriverAlert('here')
      beep([400, 150, 400, 150, 400, 150, 800])
      notify(pick(lang, 'السائق وصل', 'Your driver is here', 'Votre chauffeur est arrivé'))
    } else if (!state.soon && alertEta !== null && alertEta <= 2 && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(alertStatus || '')) {
      state.soon = true
      setDriverAlert('soon')
      beep([300, 150, 300])
      notify(pick(lang, 'السائق يصل خلال دقيقتين', 'Your driver arrives in under 2 minutes', 'Votre chauffeur arrive dans moins de 2 minutes'))
    }
    if (alertStatus === 'IN_PROGRESS' || alertStatus === 'COMPLETED' || alertStatus === 'CANCELLED') setDriverAlert(null)
  }, [alertRideId, alertEta, alertStatus, alertArrived, lang])
  const liveStopPins = (ride?.stops || []).filter((stop) => stop.lat != null && stop.lng != null).map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number }))
  const etaText = ride && typeof ride.etaToPickupMinutes === 'number' ? `${t.etaPrefix}${ride.etaToPickupMinutes}${t.etaSuffix}` : null
  const liveHeadline = !ride
    ? ''
    : ride.status === 'DRAFT'
      ? t.scheduledFor
      : ['REQUESTED', 'MATCHING'].includes(ride.status)
        ? ui.findingDriver
        : ride.status === 'DRIVER_ASSIGNED'
          ? t.driverAssigned
          : ride.status === 'DRIVER_ARRIVING'
            ? t.driverArriving
            : ride.status === 'IN_PROGRESS'
              ? t.inProgress
              : ride.status === 'COMPLETED'
                ? t.completed
                : ride.status === 'CANCELLED'
                  ? t.cancelled
                  : statusText(ride.status, lang)

  const fitsBags = (item: string) => {
    const cap = CATEGORY_CAPACITY[item]
    return !cap || (bagCount <= cap.large && handBagCount <= cap.hand)
  }
  // If the luggage no longer fits the chosen class, move to the smallest class that does.
  useEffect(() => {
    if (fitsBags(category)) return
    const next = categories.find((item) => fitsBags(item))
    if (next) setCategory(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagCount, handBagCount, category])

  function pickCategory(item: string) {
    setCategory(item)
    // Keep the filter-panel category in sync, so toggling a feature chip (which runs
    // updateRideFilters and re-derives category from srRideCategory) can't silently
    // revert the list's choice back to Economy.
    setRideFilters((previous) => ({ ...previous, srRideCategory: filterKeyByCategory[item] || 'economy' }))
  }

  function vehicleDescription(item: string, language: Lang): string {
    switch (item) {
      case 'SR Bike':
        return pick(language, 'سريعة وخفيفة لراكب واحد', 'Fast and light, for one rider', 'Rapide et légère, pour un passager')
      case 'SR Comfort':
        return pick(language, 'سيارات أحدث وراحة أكثر', 'Newer cars with extra comfort', 'Voitures plus récentes, plus de confort')
      case 'SR SUV':
        return pick(language, 'مساحة أكبر للعائلة والحقائب', 'Extra room for families and bags', 'Plus d’espace pour la famille et les bagages')
      case 'SR Van':
        return pick(language, 'للمجموعات والأمتعة الكثيرة', 'For groups and lots of luggage', 'Pour les groupes et beaucoup de bagages')
      case 'SR VIP':
        return pick(language, 'سيارات فاخرة حديثة لرحلات العمل والمناسبات', 'Luxury late-model cars for business and occasions', 'Voitures de luxe récentes pour affaires et occasions')
      default:
        return pick(language, 'رحلات يومية بسعر مناسب', 'Affordable, everyday rides', 'Courses abordables au quotidien')
    }
  }

  function categoryLabel(item: string) {
    return item.replace(/^SR\s+/, '')
  }

  function stepper(value: number, min: number, max: number, set: (fn: (n: number) => number) => void, label: string) {
    return (
      <span style={styles.stepper}>
        <button type="button" aria-label={`${label} -`} style={styles.stepBtn} onClick={() => set((n) => Math.max(min, n - 1))}>−</button>
        <strong dir="ltr" style={{ minWidth: 20, textAlign: 'center' }}>{value}</strong>
        <button type="button" aria-label={`${label} +`} style={styles.stepBtn} onClick={() => set((n) => Math.min(max, n + 1))}>+</button>
      </span>
    )
  }

  const dynamicPricingNote =
    !ride && quote && ((quote.trafficMultiplier ?? 1) > 1 || quote.isNight || quote.scheduled || (quote.fuelSurchargePercent ?? 0) > 0 || (quote.demandMultiplier ?? 1) > 1 || quote.airportTrip || (quote.stopsFee ?? 0) > 0 || (quote.bagsFee ?? 0) > 0 || (quote.ridersFee ?? 0) > 0)
      ? (isAr ? 'تسعير متغير: ' : 'Dynamic pricing: ') +
        [
          (quote.trafficMultiplier ?? 1) > 1
            ? (quote.trafficSource === 'google'
                ? (isAr ? `زحمة +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%` : `traffic +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%`)
                : (isAr ? `ذروة +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%` : `peak +${Math.round(((quote.trafficMultiplier ?? 1) - 1) * 100)}%`))
            : null,
          quote.isNight ? (isAr ? `ليلي +${Math.round(((quote.nightMultiplier ?? 1) - 1) * 100)}%` : `night +${Math.round(((quote.nightMultiplier ?? 1) - 1) * 100)}%`) : null,
          quote.scheduled ? (isAr ? `حجز مسبق +${Math.round(((quote.scheduleMultiplier ?? 1) - 1) * 100)}%` : `scheduled +${Math.round(((quote.scheduleMultiplier ?? 1) - 1) * 100)}%`) : null,
          (quote.fuelSurchargePercent ?? 0) > 0 ? (isAr ? `وقود +${quote.fuelSurchargePercent}%` : `fuel +${quote.fuelSurchargePercent}%`) : null,
          (quote.demandMultiplier ?? 1) > 1 ? (isAr ? `طلب ×${quote.demandMultiplier}` : `demand ×${quote.demandMultiplier}`) : null,
          quote.airportTrip ? (isAr ? 'رحلة مطار' : 'airport trip') : null,
          (quote.stopsFee ?? 0) > 0 ? (isAr ? `محطات $${quote.stopsFee}` : `stops $${quote.stopsFee}`) : null,
          (quote.bagsFee ?? 0) > 0 ? (isAr ? `حقائب $${quote.bagsFee}` : `bags $${quote.bagsFee}`) : null,
          (quote.ridersFee ?? 0) > 0 ? (isAr ? `ركاب $${quote.ridersFee}` : `riders $${quote.ridersFee}`) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : ''

  const walletSufficient = walletBalanceMinor !== null && walletBalanceMinor >= fareMinor
  const payMethodReady =
    !sessionToken
      ? selectedPayMethod !== null // not signed in: Continue opens the sign-in step, payment comes after it
      : entryMode === 'guest'
      ? selectedPayMethod === 'card' || (selectedPayMethod === 'shamcash' && walletSufficient)
      : selectedPayMethod === 'wallet'
        ? walletSufficient
        : selectedPayMethod === 'card'
          ? true  // always ready: redirects to Stripe
          : selectedPayMethod === 'shamcash'
            ? walletSufficient // a submitted proof is not money: the ride unlocks only after an admin credits the wallet
            : false
  const requestDisabled = status === 'saving' || guestCheckoutStatus === 'redirecting' || (scheduleForLater && !scheduledFor) || !confirmedLocations || !payMethodReady
  // Step guidance: after the ride class is chosen the rider must pick how to pay, then continue and confirm.
  const payStepPrompt =
    selectedPayMethod === null
      ? pick(lang, 'الخطوة التالية: اختر طريقة الدفع', 'Next step: choose how you want to pay', 'Étape suivante : choisissez votre mode de paiement')
      : selectedPayMethod === 'card' && sessionToken
        ? pick(lang, 'اضغط «متابعة للدفع» لإتمام الدفع بالبطاقة ثم تأكيد الرحلة', 'Tap “Continue to pay” to pay by card, then your ride is confirmed', 'Appuyez sur « Continuer vers le paiement » puis la course est confirmée')
        : null
  const requestLabel =
    status === 'saving'
      ? t.saving
      : scheduleForLater
        ? t.scheduleRide
        : selectedPayMethod === null
          ? pick(lang, 'اختر طريقة الدفع', 'Choose a payment method', 'Choisissez un mode de paiement')
          : !sessionToken
            ? pick(lang, 'متابعة', 'Continue', 'Continuer')
            : selectedPayMethod === 'card'
            ? pick(lang, 'متابعة للدفع وتأكيد الرحلة', 'Continue to pay & confirm ride', 'Continuer vers le paiement et confirmer')
            : `${ui.confirm} ${categoryLabel(category)}`

  // ---------------------------------------------------------------- booking view (no ride yet)
  if (!ride) {
    return (
      <main dir={isAr ? 'rtl' : 'ltr'} style={styles.pageMap}>
        <MapHero
          lang={lang}
          pickup={bookingPickupPin}
          dropoff={bookingDropoffPin}
          stops={bookingStopPins}
          dropTarget={dropTarget}
          onPick={applyMapPin}
          labels={{ ...mapLabels, tapHint: dropTarget === 'pickup' ? ui.tapToSetPickup : ui.tapToSetDropoff }}
        />
        <div style={styles.bookSheet}>
        <div style={styles.grabber} aria-hidden="true" />
        <h1 style={styles.hero}>{ui.whereTo}</h1>

        <section style={styles.routeCard} aria-label={ui.whereTo}>
          <div style={styles.rail} aria-hidden="true">
            <span style={styles.railDot} />
            <span style={styles.railLine} />
            <span style={styles.railSquare} />
          </div>
          <div style={styles.routeFields}>
            <div style={styles.fieldRow}>
              <PlaceInput
                lang={lang}
                style={styles.routeInput}
                ariaLabel={t.pickup}
                placeholder={ui.pickupPlaceholder}
                value={pickupSource === 'default' ? '' : pickup}
                onPlace={(selection) => applyPlace('pickup', selection)}
                // A hand-edit invalidates any earlier GPS fix / Places / pin coordinates -- they no
                // longer necessarily correspond to this text, so they must not ride along to
                // requestRide() (UX-4A Priority A, GPS-then-destructive-edit case). setEndpoint clears them.
                onTextChange={(text) => setEndpoint('pickup', text, 'manual', undefined)}
              />
              <button type="button" style={dropTarget === 'pickup' ? { ...styles.gpsButton, ...styles.gpsButtonOn } : styles.gpsButton} onClick={() => setDropTarget((v) => (v === 'pickup' ? null : 'pickup'))}>
                {ui.pinOnMap}
              </button>
              <button type="button" style={styles.gpsButton} onClick={() => void useCurrentLocation()}>
                {t.gps}
              </button>
            </div>
            <div style={styles.divider} />
            <div style={styles.fieldRow}>
              <PlaceInput
                lang={lang}
                style={{ ...styles.routeInput, ...styles.routeInputBig }}
                ariaLabel={t.dropoff}
                placeholder={ui.whereTo}
                value={dropoffSource === 'default' ? '' : dropoff}
                onPlace={(selection) => applyPlace('dropoff', selection)}
                onTextChange={(text) => setEndpoint('dropoff', text, 'manual', undefined)}
              />
              <button type="button" style={dropTarget === 'dropoff' ? { ...styles.gpsButton, ...styles.gpsButtonOn } : styles.gpsButton} onClick={() => setDropTarget((v) => (v === 'dropoff' ? null : 'dropoff'))}>
                {ui.pinOnMap}
              </button>
            </div>
          </div>
        </section>

        {(savedPlaces.length > 0 || recents.length > 0) && (
          <div style={styles.chipRow}>
            {recents
              .filter((recent) => !savedPlaces.some((place) => place.address.trim().toLowerCase() === recent.text.trim().toLowerCase()))
              .map((recent) => (
                <span key={`recent-${recent.text}`} style={styles.chip}>
                  <button
                    type="button"
                    style={styles.chipMain}
                    title={ui.recent}
                    onClick={() =>
                      setEndpoint('dropoff', recent.text, 'saved', typeof recent.lat === 'number' && typeof recent.lng === 'number' ? { lat: recent.lat, lng: recent.lng } : undefined)
                    }
                  >
                    {recent.text}
                  </button>
                </span>
              ))}
            {savedPlaces.map((place) => (
              <span key={place.id} style={styles.chip}>
                <button
                  type="button"
                  style={styles.chipMain}
                  onClick={() => setEndpoint('dropoff', place.address, 'saved', place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : undefined)}
                >
                  {place.label}
                </button>
                <button
                  type="button"
                  style={styles.chipSub}
                  title={ui.fromPlace}
                  onClick={() => setEndpoint('pickup', place.address, 'saved', place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : undefined)}
                >
                  {ui.fromPlace}
                </button>
                <button type="button" aria-label={t.removeStop} style={styles.chipSub} onClick={() => void removeSavedPlace(place.id)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {addressUnrecognized && confirmedLocations && dropoffCoords == null && <div style={styles.warn}>{t.addressUnrecognized}</div>}
        {message && <div style={{ ...styles.notice, ...(status === 'error' ? styles.noticeError : {}) }}>{message}</div>}
        {cardStatus === 'confirming' && <div style={styles.notice}>{t.payCardConfirming}</div>}

        <section aria-label={ui.chooseRide}>
          <h2 style={styles.sectionTitle}>{ui.chooseRide}</h2>
          {!confirmedLocations && <div style={styles.hint}>{ui.enterBoth}</div>}
          {Object.keys(availability).length > 0 && (() => {
            const total = Object.values(availability).reduce((sum, row) => sum + (row.drivers || 0), 0)
            const etas = Object.values(availability).filter((row) => row.drivers > 0 && typeof row.etaMinutes === 'number').map((row) => row.etaMinutes as number)
            const best = etas.length ? Math.min(...etas) : null
            return (
              <div style={{ ...styles.hint, fontWeight: 700 }}>
                {total > 0
                  ? pick(lang, `${total} سائق بالقرب منك${best !== null ? ` · أقرب سيارة ${best} د` : ''}`, `${total} driver${total === 1 ? '' : 's'} near you${best !== null ? ` · nearest ${best} min` : ''}`, `${total} chauffeur${total === 1 ? '' : 's'} près de vous${best !== null ? ` · le plus proche ${best} min` : ''}`)
                  : pick(lang, 'لا يوجد سائقون قريبون الآن', 'No drivers nearby right now', 'Aucun chauffeur à proximité pour le moment')}
              </div>
            )
          })()}
          <div style={styles.moreBody}>
            <div style={styles.optRow}>
              <span>{pick(lang, 'حقائب كبيرة (حتى 23 كغ)', 'Large bags (up to 23 kg)', 'Grands bagages (jusqu’à 23 kg)')}</span>
              {stepper(bagCount, 0, 10, setBagCount, 'large bags')}
            </div>
            <div style={styles.optRow}>
              <span>{pick(lang, 'حقائب يد', 'Hand bags', 'Bagages à main')}</span>
              {stepper(handBagCount, 0, 20, setHandBagCount, 'hand bags')}
            </div>
          </div>
          <div role="radiogroup" aria-label={ui.chooseRide} style={styles.vehicleList}>
            {categories.map((item) => {
              const selected = item === category
              const meta = CATEGORY_META[item] || { kind: 'economy' as VehicleKind, seats: 4 }
              // Honest prices: nothing before a destination is confirmed; the REAL quote for the
              // selected class once it matches the current selection; otherwise a labelled estimate
              // from the local fare model (never presented as a quote).
              const realQuote = confirmedLocations && selected && quote !== null && quoteCategory === item
              const serverQuote = confirmedLocations ? quotesByCategory[item] : undefined
              const hasRealPrice = Boolean(realQuote || serverQuote)
              const avail = availability[item]
              const anyDriverNearby = Object.values(availability).some((row) => row.drivers > 0)
              const noDriversHere = confirmedLocations && Boolean(avail) && anyDriverNearby && avail.drivers === 0
              const tooSmall = !fitsBags(item)
              const cap = CATEGORY_CAPACITY[item]
              const availText = !confirmedLocations || !avail
                ? null
                : avail.drivers > 0
                  ? pick(lang, `أقرب سائق خلال ${avail.etaMinutes ?? '?'} د`, `Driver about ${avail.etaMinutes ?? '?'} min away`, `Chauffeur à environ ${avail.etaMinutes ?? '?'} min`)
                  : anyDriverNearby
                    ? pick(lang, 'لا يوجد سائق قريب', 'No drivers nearby', 'Aucun chauffeur à proximité')
                    : null
              const price = realQuote ? quote.fareMinor : serverQuote ? serverQuote.fareMinor : srFallbackFareMinor(item, lowDataMode) // rates follow ratesVersion
              const description = vehicleDescription(item, lang)
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={noDriversHere || tooSmall}
                  style={{ ...(selected ? { ...styles.vehicleRow, ...styles.vehicleRowActive } : styles.vehicleRow), ...(noDriversHere || tooSmall ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}
                  onClick={() => pickCategory(item)}
                >
                  <span style={styles.vehicleArt}>
                    <VehicleArt kind={meta.kind} />
                  </span>
                  <span style={styles.vehicleText}>
                    <span style={styles.vehicleTitleRow}>
                      <strong style={{ fontSize: 17 }}>{categoryLabel(item)}</strong>
                      <span style={styles.seatBadge} title={ui.seats} aria-label={`${meta.seats} ${ui.seats}`}>
                        <SeatIcon />
                        <span dir="ltr">{meta.seats}</span>
                      </span>
                    </span>
                    <span style={styles.vehicleDesc}>{description}</span>
                    {cap ? (
                      <span style={{ ...styles.vehicleMeta, fontWeight: 700, color: tooSmall ? '#b3261e' : '#1b6e3c' }}>
                        {tooSmall
                          ? pick(lang, `صغيرة جداً: تتسع ${cap.large} حقائب كبيرة و${cap.hand} حقائب يد`, `Too small: fits ${cap.large} large + ${cap.hand} hand bags`, `Trop petite : ${cap.large} grands + ${cap.hand} bagages à main`)
                          : pick(lang, `تتسع ${cap.large} كبيرة + ${cap.hand} حقائب يد`, `Fits ${cap.large} large + ${cap.hand} hand bags`, `${cap.large} grands + ${cap.hand} bagages à main`)}
                      </span>
                    ) : null}
                    {availText ? <span style={{ ...styles.vehicleMeta, fontWeight: 700, color: noDriversHere ? '#b3261e' : '#1b6e3c' }}>{availText}</span> : null}
                    {confirmedLocations && quote?.estimatedMinutes ? (
                      <span style={styles.vehicleMeta} dir="ltr">{`${quote.estimatedMinutes} ${ui.minShort} ${ui.trip}`}</span>
                    ) : null}
                  </span>
                  <span style={styles.vehiclePriceCol}>
                    <strong style={styles.vehiclePrice} dir={isAr ? 'rtl' : 'ltr'}>
                      {!confirmedLocations ? '—' : `${hasRealPrice ? '' : '~'}${moneyText(price, quote?.currency || 'USD', lang)}`}
                    </strong>
                    {confirmedLocations && !hasRealPrice && <span style={styles.estimateTag}>{ui.estimate}</span>}
                  </span>
                </button>
              )
            })}
          </div>
          {confirmedLocations && quote?.estimated && <div style={styles.hint}>{t.distanceApprox}</div>}
          {dynamicPricingNote && <div style={styles.warn}>{dynamicPricingNote}</div>}
        </section>

        <section style={styles.moreWrap}>
          <button type="button" aria-expanded={moreOpen} style={styles.moreToggle} onClick={() => setMoreOpen((v) => !v)}>
            <span>{ui.moreOptions}</span>
            <span aria-hidden="true">{moreOpen ? '−' : '+'}</span>
          </button>
          {moreOpen && (
            <div style={styles.moreBody}>
              <div style={styles.optRow}>
                <span>{ui.riders}</span>
                {stepper(riderCount, 1, 8, setRiderCount, 'riders')}
              </div>
              <div style={styles.optRow}>
                <span>{ui.bonus}</span>
                {stepper(bonusMinor, 0, 20, setBonusMinor, 'bonus')}
              </div>

              {stops.map((stop, index) => (
                <div key={index} style={styles.inlineForm}>
                  <PlaceInput
                    lang={lang}
                    style={styles.textInput}
                    ariaLabel={`${t.stop} ${index + 1}`}
                    placeholder={`${t.stop} ${index + 1}`}
                    value={stop}
                    onPlace={(selection) => applyStopPlace(index, selection)}
                    onTextChange={(text) => {
                      setStops((previous) => previous.map((value, valueIndex) => (valueIndex === index ? text : value)))
                      // Editing the text forgets that stop's coordinates (they belonged to the old text).
                      setStopCoordsList((previous) => previous.map((value, valueIndex) => (valueIndex === index ? undefined : value)))
                    }}
                  />
                  <button
                    type="button"
                    style={styles.smallButton}
                    onClick={() => {
                      setStops((previous) => previous.filter((_, valueIndex) => valueIndex !== index))
                      setStopCoordsList((previous) => previous.filter((_, valueIndex) => valueIndex !== index))
                    }}
                  >
                    {t.removeStop}
                  </button>
                </div>
              ))}
              {stops.length < 3 && (
                <button type="button" style={styles.smallButton} onClick={() => {
                  setStops((previous) => [...previous, ''])
                  setStopCoordsList((previous) => [...previous, undefined])
                }}>
                  {t.addStop}
                </button>
              )}

              <label style={styles.checkRow}>
                <input type="checkbox" checked={scheduleForLater} onChange={(event) => setScheduleForLater(event.target.checked)} />
                {t.scheduleForLater}
              </label>
              {scheduleForLater && (
                <input
                  type="datetime-local"
                  style={styles.textInput}
                  value={scheduledFor}
                  min={new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16)}
                  onChange={(event) => setScheduledFor(event.target.value)}
                />
              )}

              <input style={styles.textInput} value={promoCode} onChange={(event) => setPromoCode(event.target.value)} placeholder={t.promoCodePlaceholder} />

              {businessAccountName && (
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={billToBusinessAccount} onChange={(event) => setBillToBusinessAccount(event.target.checked)} />
                  {t.billToBusiness.replace('{company}', businessAccountName)}
                </label>
              )}

              <label style={styles.checkRow}>
                <input type="checkbox" checked={accessibilityRequired} onChange={(event) => setAccessibilityRequired(event.target.checked)} />
                {t.accessibilityRequired}
              </label>
              <label style={styles.checkRow}>
                <input type="checkbox" checked={deliveryOnly} onChange={(event) => setDeliveryOnly(event.target.checked)} />
                {t.deliveryOnly}
              </label>
              <label style={styles.checkRow}>
                <input type="checkbox" checked={shareable} onChange={(event) => setShareable(event.target.checked)} />
                {t.shareable}
              </label>
              <label style={styles.checkRow}>
                <input type="checkbox" checked={autoSwitch} onChange={(event) => setAutoSwitch(event.target.checked)} />
                {pick(lang, 'إذا لم يتوفر سائق في فئتي، انقلني تلقائياً إلى أرخص فئة متاحة', 'If no driver in my category, switch me automatically to the cheapest available one', 'Si aucun chauffeur dans ma catégorie, passer automatiquement à la moins chère disponible')}
              </label>
              <label style={styles.checkRow}>
                <input checked={lowDataMode} type="checkbox" onChange={(event) => setLowDataMode(event.target.checked)} />
                {t.mode}
              </label>

              <div style={styles.filtersBox}>
                <div style={styles.filtersHead}>
                  <strong>{t.rideOptions}</strong>
                  <span>{selectedFilterLabels(rideFilterGroups, rideFilters, lang).length} {t.selected}</span>
                </div>
                <VisualFilterPanel compact groups={rideFilterGroups} lang={lang} selection={rideFilters} onChange={updateRideFilters} />
              </div>

              <div style={styles.inlineForm}>
                <input
                  style={styles.textInput}
                  value={newPlaceLabel}
                  onChange={(event) => setNewPlaceLabel(event.target.value)}
                  placeholder={t.savePlaceLabelPlaceholder}
                />
                <button
                  type="button"
                  disabled={!newPlaceLabel.trim() || !pickup.trim() || savingPlace}
                  style={styles.smallButton}
                  onClick={() => void saveCurrentPickupAsPlace()}
                >
                  {t.savePlaceButton}
                </button>
              </div>

              {pushStatus !== 'enabled' ? (
                <button type="button" style={styles.smallButton} disabled={pushStatus === 'enabling'} onClick={() => void enableNotifications()}>
                  {pushStatus === 'enabling' ? t.enablingNotifications : t.enableNotifications}
                </button>
              ) : (
                <span style={styles.okText}>✓ {t.notificationsEnabled}</span>
              )}

              {stripeConfigured && (
                <div style={styles.subCard}>
                  <strong>{t.autoPayTitle}</strong>
                  {savedCard ? (
                    <>
                      <span style={styles.okText}>✓ {t.autoPayOn}</span>
                      <span dir="ltr">{`${savedCard.brand ? savedCard.brand.toUpperCase() : 'CARD'} · ${t.cardEndingIn} ${savedCard.last4 || '----'}`}</span>
                      <button type="button" style={styles.smallButton} onClick={() => void removeSavedCard()}>
                        {t.removeCard}
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={styles.hint}>{t.autoPayHint}</span>
                      <button
                        type="button"
                        style={styles.smallButton}
                        disabled={cardSetupStatus === 'redirecting' || cardSetupStatus === 'confirming'}
                        onClick={() => void startAddCard()}
                      >
                        {cardSetupStatus === 'redirecting' || cardSetupStatus === 'confirming' ? t.addingCard : t.addCard}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        </div>

        {signInOpen && !sessionToken && <RideSignInPanel lang={lang} onClose={() => setSignInOpen(false)} />}
        <div style={styles.stickyBar}>
          <div style={styles.stickyInner}>
            {payStepPrompt && confirmedLocations && <div style={{ ...styles.hint, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>{payStepPrompt}</div>}
            <PaymentPicker
              mode={entryMode}
              lang={lang}
              walletBalanceMinor={walletBalanceMinor}
              fareMinor={fareMinor}
              currency="USD"
              value={selectedPayMethod}
              onChange={setSelectedPayMethod}
              shamCashRef={shamCashRef}
              onShamCashRefChange={setShamCashRef}
              onShamCashSubmit={() => {
                if (!shamCashRef.trim()) return
                setShamCashStatus('saving')
                // Top up exactly the shortfall (at least 1 cent); the wallet is credited only after an admin verifies the transfer.
                const topupMinor = Math.max(1, fareMinor - (walletBalanceMinor ?? 0))
                submitWalletTopupProof({ amountMinor: topupMinor, currency: 'USD', providerRef: shamCashRef.trim() })
                  .then(() => setShamCashStatus('submitted'))
                  .catch((error) => { setMessage(error instanceof Error ? error.message : t.error); setShamCashStatus('error') })
              }}
              shamCashStatus={shamCashStatus}
            />
            <button disabled={requestDisabled} style={requestDisabled ? { ...styles.bigButton, ...styles.bigButtonDisabled } : styles.bigButton} onClick={() => void requestRide()}>
              <span>{requestLabel}</span>
              {confirmedLocations && status !== 'saving' && (
                <span dir={isAr ? 'rtl' : 'ltr'}>{moneyText(fareMinor, quote?.currency || 'USD', lang)}</span>
              )}
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ---------------------------------------------------------------- live / finished ride view
  // Camera + status chip for the live map. A number is shown ONLY when the API gave a real one.
  const mapPhase: 'approach' | 'trip' | null =
    ride.status === 'DRIVER_ASSIGNED' || ride.status === 'DRIVER_ARRIVING' ? 'approach' : ride.status === 'IN_PROGRESS' ? 'trip' : null
  const mapBanner =
    ride.status === 'DRIVER_ASSIGNED' || ride.status === 'DRIVER_ARRIVING'
      ? typeof ride.etaToPickupMinutes === 'number'
        ? pick(lang, `السائق يصل خلال ${ride.etaToPickupMinutes} د`, `Driver arrives in ${ride.etaToPickupMinutes} min`, `Le chauffeur arrive dans ${ride.etaToPickupMinutes} min`)
        : pick(lang, 'السائق في الطريق', 'Driver on the way', 'Le chauffeur est en route')
      : ride.status === 'IN_PROGRESS'
        ? pick(lang, 'في الطريق إلى وجهتك', 'On the way to your destination', 'En route vers votre destination')
        : ['REQUESTED', 'MATCHING'].includes(ride.status)
          ? ui.findingDriver
          : null
  const showPin = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status) && typeof ride.metadata.pickupCode === 'string'
  const chatAllowed = MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status)
  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.pageMap}>
      <MapHero
        lang={lang}
        pickup={ride.pickupCoords ?? requestedPins.pickup}
        dropoff={ride.dropoffCoords ?? requestedPins.dropoff}
        stops={liveStopPins.length > 0 ? liveStopPins : requestedPins.stops}
        driver={liveDriverPin}
        phase={mapPhase}
        banner={mapBanner}
        height="50vh"
        labels={mapLabels}
      />

      <section style={styles.sheet} aria-live="polite">
        <div style={styles.grabber} aria-hidden="true" />
        <div style={styles.sheetHead}>
          <h1 style={styles.sheetTitle}>
            {ride.status === 'DRAFT' && ride.scheduledFor
              ? `${t.scheduledFor} ${new Date(ride.scheduledFor).toLocaleString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'))}`
              : liveHeadline}
          </h1>
          {etaText && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status) && <span style={styles.etaPill} dir="ltr">{etaText}</span>}
        </div>
        {driverAlert && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status) && (
          <div
            role="alert"
            style={{ padding: '12px 14px', borderRadius: 12, fontWeight: 700, fontSize: 15, background: driverAlert === 'here' ? '#16a34a' : '#f59e0b', color: '#fff', margin: '8px 0' }}
          >
            {driverAlert === 'here'
              ? pick(lang, '🚗 السائق وصل إلى نقطة الاستلام!', '🚗 Your driver is here!', '🚗 Votre chauffeur est arrivé !')
              : pick(lang, '⏱ السائق يصل خلال أقل من دقيقتين', '⏱ Your driver arrives in under 2 minutes', '⏱ Votre chauffeur arrive dans moins de 2 minutes')}
          </div>
        )}
        {['REQUESTED', 'MATCHING'].includes(ride.status) && (
          <div style={styles.hint}>{ride.matchTimedOut ? t.stillLooking : t.waitingForDriver}</div>
        )}
        {['REQUESTED', 'MATCHING'].includes(ride.status) && !ride.matchTimedOut && <div style={styles.progressTrack}><div style={styles.progressBar} /></div>}
        {['REQUESTED', 'MATCHING'].includes(ride.status) && (ride as unknown as { autoSwitchedTo?: string }).autoSwitchedTo && (
          <div style={styles.hint}><strong>{pick(lang, `لم يتوفر سائق، تم نقلك تلقائياً إلى ${String((ride as unknown as { autoSwitchedTo?: string }).autoSwitchedTo).replace('SR ', '')}.`, `No driver was free, so we moved you to ${String((ride as unknown as { autoSwitchedTo?: string }).autoSwitchedTo).replace('SR ', '')}.`, `Aucun chauffeur libre : nous vous avons passé en ${String((ride as unknown as { autoSwitchedTo?: string }).autoSwitchedTo).replace('SR ', '')}.`)}</strong></div>
        )}
        {['REQUESTED', 'MATCHING'].includes(ride.status) && ride.matchTimedOut && Date.now() > hideNoDriverUntil && (() => {
          const noDriver = (ride as unknown as { noDriver?: { category: string; alternatives: Array<{ category: string; drivers: number; fareMinor: number | null }> } }).noDriver
          const own = String(ride.metadata?.category || '').replace('SR ', '')
          return (
            <div style={styles.hint}>
              <strong>{pick(lang, `لا يوجد سائق متاح الآن في فئة ${own}.`, `No ${own} driver is free right now.`, `Aucun chauffeur ${own} n'est libre pour l'instant.`)}</strong>
              {noDriver && noDriver.alternatives.length > 0 ? (
                <>
                  <div>{pick(lang, 'اختر فئة أخرى متاحة قربك:', 'Switch to a category available near you:', 'Passez à une catégorie disponible près de vous :')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {noDriver.alternatives.map((alt) => (
                      <button
                        key={alt.category}
                        type="button"
                        style={{ padding: '10px 14px', borderRadius: 999, border: '1px solid #000', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
                        onClick={() => {
                          void changeSrRideCategory(ride.id, alt.category)
                            .then(async () => setRide(await fetchPrototypeSrRide(ride.id)))
                            .catch((error: unknown) => window.alert(error instanceof Error ? error.message : String(error)))
                        }}
                      >
                        {alt.category.replace('SR ', '')}{alt.fareMinor != null ? ` · $${alt.fareMinor}` : ''}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <button type="button" style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #999', background: '#fff', cursor: 'pointer' }} onClick={() => setHideNoDriverUntil(Date.now() + 120000)}>
                  {pick(lang, 'تابع الانتظار', 'Keep waiting', 'Continuer à attendre')}
                </button>
                {!ride.metadata?.prepaid && (
                  <button
                    type="button"
                    style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #999', background: '#fff', cursor: 'pointer' }}
                    onClick={() => {
                      const current = Number((ride.metadata as { fareFactors?: { bonusMinor?: number } } | undefined)?.fareFactors?.bonusMinor) || 0
                      void addSrRideBonus(ride.id, current + 5)
                        .then(async () => setRide(await fetchPrototypeSrRide(ride.id)))
                        .catch((error: unknown) => window.alert(error instanceof Error ? error.message : String(error)))
                    }}
                  >
                    {pick(lang, 'أضف مكافأة 5$ للسائق', 'Add a $5 driver bonus', 'Ajouter 5 $ de bonus')}
                  </button>
                )}
                <button
                  type="button"
                  style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #999', background: '#fff', cursor: 'pointer' }}
                  onClick={() => {
                    void cancelPrototypeSrRide(ride.id)
                      .then(() => setRide(null))
                      .catch((error: unknown) => window.alert(error instanceof Error ? error.message : String(error)))
                  }}
                >
                  {pick(lang, 'غيّر نقطة الانطلاق أو الموعد', 'Change pickup or schedule', 'Changer le départ ou planifier')}
                </button>
              </div>
            </div>
          )
        })()}

        {['REQUESTED', 'MATCHING'].includes(ride.status) && !ride.driver && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
            <button
              type="button"
              disabled={status === 'saving'}
              style={{ flex: 1, minWidth: 140, padding: '12px 14px', borderRadius: 12, border: '1px solid #c0392b', background: '#fff', color: '#c0392b', fontWeight: 700, cursor: 'pointer' }}
              onClick={() => {
                setStatus('saving')
                cancelPrototypeSrRide(ride.id)
                  .then(() => { setStatus('idle'); setMessage(''); startNewRide() })
                  .catch((error: unknown) => { setStatus('error'); setMessage(error instanceof Error ? error.message : t.error) })
              }}
            >
              {pick(lang, 'إلغاء وتغيير رحلتي', 'Cancel and change my trip', 'Annuler et modifier ma course')}
            </button>
          </div>
        )}

        {showPin && (
          <div style={styles.pinBox}>
            <span style={styles.pinLabel}>{ui.pinTitle}</span>
            <strong dir="ltr" style={styles.pinValue}>{String(ride.metadata.pickupCode)}</strong>
            <span style={styles.hint}>
              {pick(
                lang,
                'تأكد أن السائق والمركبة مطابقان، ثم أعطِ هذا الرمز لسائقك. لن تبدأ الرحلة قبل أن يؤكد السائق هذا الرمز.',
                'Check the driver & car match, then give this code to your driver. The trip only starts once the driver confirms this code.',
                "Vérifiez que le chauffeur et le véhicule correspondent, puis donnez ce code à votre chauffeur. La course ne démarre qu'une fois ce code confirmé.",
              )}
            </span>
          </div>
        )}

        {LIVE_TRACKING_STATUSES.includes(ride.status) && !liveDriverPin && <div style={styles.hint}>{ui.driverLocationUnavailable}</div>}

        {ride.driver ? (
          <DriverSafetyCard ride={ride} driverPhotoUrl={driverPhotoUrl} t={t} lang={lang} />
        ) : (
          <div style={styles.infoRow}><span>{t.driver}</span><strong>{driverIdentityLabel(ride, t)}</strong></div>
        )}

        <div style={styles.tripCard}>
          <div style={styles.rail} aria-hidden="true">
            <span style={styles.railDot} />
            <span style={{ ...styles.railLine, minHeight: 28 + (ride.stops?.length || 0) * 24 }} />
            <span style={styles.railSquare} />
          </div>
          <div style={styles.tripText}>
            <span>{String(ride.metadata.pickup || pickup)}</span>
            {ride.stops?.map((stop, index) => (
              <span key={index} style={styles.hint}>{t.stop} {index + 1}: {stop.address}</span>
            ))}
            <strong>{String(ride.metadata.dropoff || dropoff)}</strong>
          </div>
        </div>
        <div style={styles.infoRow}><span>{t.rideId}</span><strong dir="ltr">{ride.id.slice(0, 8).toUpperCase()}</strong></div>
        {Boolean(ride.metadata?.prepaid || ride.metadata?.cardHoldIntentId) && !['CANCELLED'].includes(ride.status) && (
          <div style={{ ...styles.notice, background: '#e8f5e9', color: '#1b5e20', borderColor: '#a5d6a7' }}>
            ✓ {pick(lang, `تم الدفع ${moneyText(ride.fareMinor ?? 0, ride.currency, lang)} قبل البحث عن سائق — يحتفظ به Rezekme حتى نهاية الرحلة`, `Paid ${moneyText(ride.fareMinor ?? 0, ride.currency, lang)} before we look for a driver — held by Rezekme until the trip ends`, `${moneyText(ride.fareMinor ?? 0, ride.currency, lang)} payé avant la recherche d’un chauffeur — conservé par Rezekme jusqu’à la fin de la course`)}
          </div>
        )}
        <div style={styles.infoRow}><span>{t.fare}</span><strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.fareMinor ?? fareMinor, ride.currency, lang)}</strong></div>
        {ride.accessibilityRequired && <div style={styles.badge}>♿ {t.accessibilityRequired}</div>}
        {ride.businessAccountId && <div style={styles.badge}>{t.billedToBusiness}</div>}
        {ride.shareable && <div style={styles.badge}>{t.sharedRide}</div>}

        {(ACTIVE_RIDE_STATUSES.includes(ride.status) || ride.status === 'COMPLETED') && (
          <div style={styles.actionGrid}>
            {chatAllowed && (
              <button type="button" style={styles.actionBtn} aria-expanded={chatOpen} onClick={() => setChatOpen((v) => !v)}>
                {ui.chat}
              </button>
            )}
            {LIVE_TRACKING_STATUSES.includes(ride.status) && (
              <button type="button" disabled={shareStatus === 'sharing'} style={styles.actionBtn} onClick={() => void shareTrip()}>
                {shareStatus === 'copied' ? t.shareCopied : shareStatus === 'sharing' ? t.sharing : ui.share}
              </button>
            )}
            {ride.status !== 'DRAFT' && ACTIVE_RIDE_STATUSES.includes(ride.status) && (
              <button
                type="button"
                style={{ ...styles.actionBtn, ...styles.sosBtn }}
                disabled={sosState === 'sending' || sosState === 'sent'}
                onClick={() => void triggerSos()}
              >
                {sosState === 'sending' ? t.sosSending : sosState === 'sent' ? '✓ SOS' : t.sos}
              </button>
            )}
          </div>
        )}

        {ride.status === 'COMPLETED' && <ReportProblem lang={lang} role="rider" rideId={ride.id} />}
        {ride.status === 'DISPUTED' && <div style={styles.hint}>{pick(lang, 'قيد مراجعة الإدارة.', 'Under admin review.', 'En cours d’examen par l’administrateur.')}</div>}
        {(ACTIVE_RIDE_STATUSES.includes(ride.status) || ride.status === 'COMPLETED') && <AssistantBox lang={lang} role="rider" />}

        {chatAllowed && chatOpen && (
          <div style={styles.subCard}>
            <strong>{t.chatTitle}</strong>
            <div style={styles.chatMessages}>
              {chatMessages.length === 0 && <span style={styles.hint}>{t.chatEmpty}</span>}
              {chatMessages.map((entry) => (
                <div key={entry.id} style={entry.senderRole === 'RIDER' ? styles.bubbleMine : styles.bubbleTheirs}>
                  {entry.body}
                </div>
              ))}
            </div>
            <div style={styles.inlineForm}>
              <input
                style={styles.textInput}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={t.chatPlaceholder}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void sendChatMessage()
                }}
              />
              <button disabled={!chatInput.trim() || chatStatus === 'sending'} style={styles.smallButton} onClick={() => void sendChatMessage()}>
                {t.chatSend}
              </button>
            </div>
          </div>
        )}

        {ride.driver && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED'].includes(ride.status) && (
          <RecordingControls rideId={ride.id} lang={lang} />
        )}

        {/* ------------------------------ trip complete: receipt, payment, tip, rating, invoice */}
        {ride.status === 'COMPLETED' && (
          <>
            <div style={styles.receipt}>
              <span>{t.receiptFare}</span>
              <strong style={styles.receiptTotal} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.fareMinor ?? 0, ride.currency, lang)}</strong>
            </div>
            {!!ride.discountMinor && (
              <div style={styles.infoRow}>
                <span>{t.promoDiscountApplied}</span>
                <strong dir={isAr ? 'rtl' : 'ltr'}>-{moneyText(ride.discountMinor, ride.currency, lang)}</strong>
              </div>
            )}
            {typeof ride.metadata.distanceKm === 'number' && (
              <div style={styles.infoRow}>
                <span>{t.receiptDistance}</span>
                <strong dir="ltr">{ride.metadata.distanceKm} km</strong>
              </div>
            )}

            {ride.review ? (
              <div style={styles.notice}>
                {t.yourRating}: {'★'.repeat(ride.review.rating)}
                {'☆'.repeat(5 - ride.review.rating)}
              </div>
            ) : (
              <div style={styles.subCard}>
                <strong>{t.rateTitle}</strong>
                <div style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} aria-label={`${n}`} style={n <= reviewRating ? styles.starActive : styles.star} onClick={() => setReviewRating(n)}>
                      ★
                    </button>
                  ))}
                </div>
                <textarea style={styles.textarea} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder={t.rateCommentPlaceholder} />
                <button disabled={reviewRating < 1 || reviewStatus === 'saving'} style={reviewRating < 1 ? { ...styles.bigButtonInline, ...styles.bigButtonDisabled } : styles.bigButtonInline} onClick={() => void submitReview()}>
                  {reviewStatus === 'saving' ? t.rateSubmitting : t.rateSubmit}
                </button>
              </div>
            )}

            {(ride.fareMinor ?? 0) > 0 && !(ride.paymentProofs || []).some((p) => (p.provider || '').startsWith('tip')) ? (
              tipStatus === 'submitted' ? (
                <div style={styles.notice}>✓ {t.tipThanks}</div>
              ) : (
                <div style={styles.subCard}>
                  <strong>{t.tipTitle}</strong>
                  <span style={styles.hint}>{t.tipHint}</span>
                  <div style={styles.chipRow}>
                    {tipOptions.map((pct) => {
                      const amt = Math.round(((ride.fareMinor ?? 0) * pct) / 100)
                      const active = tipAmountMinor === amt && tipCustom === ''
                      return (
                        <button
                          key={pct}
                          type="button"
                          style={active ? { ...styles.tipChip, ...styles.tipChipActive } : styles.tipChip}
                          onClick={() => {
                            setTipCustom('')
                            setTipAmountMinor(amt)
                          }}
                        >
                          {pct}% · {moneyText(amt, ride.currency, lang)}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      style={tipAmountMinor === 0 && tipCustom === '' ? { ...styles.tipChip, ...styles.tipChipActive } : styles.tipChip}
                      onClick={() => {
                        setTipCustom('')
                        setTipAmountMinor(0)
                      }}
                    >
                      {t.tipNone}
                    </button>
                  </div>
                  <input
                    style={styles.textInput}
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
                  <input style={styles.textInput} placeholder={t.payReferencePlaceholder} value={tipRef} onChange={(event) => setTipRef(event.target.value)} />
                  <button
                    disabled={tipAmountMinor <= 0 || !tipRef.trim() || tipStatus === 'saving'}
                    style={tipAmountMinor <= 0 || !tipRef.trim() ? { ...styles.bigButtonInline, ...styles.bigButtonDisabled } : styles.bigButtonInline}
                    onClick={() => void submitTip()}
                  >
                    {tipStatus === 'saving' ? t.tipSubmitting : `${t.tipSubmit}${tipAmountMinor > 0 ? ' · ' + moneyText(tipAmountMinor, ride.currency, lang) : ''}`}
                  </button>
                </div>
              )
            ) : null}

            {renderPaymentSection(t.payTitle, t.payCopy)}
          </>
        )}

        {ride.status === 'CANCELLED' && typeof ride.cancellationFeeMinor === 'number' && ride.cancellationFeeMinor > 0 && ride.driverId && (
          <>
            <div style={styles.infoRow}>
              <span>{t.cancellationFeeLabel}</span>
              <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.cancellationFeeMinor, ride.currency, lang)}</strong>
            </div>
            {renderPaymentSection(t.payFeeTitle, t.payFeeCopy)}
          </>
        )}

        {invoice && (
          <div style={styles.subCard}>
            <strong>{t.invoiceTitle} · <span dir="ltr">{invoice.number}</span></strong>
            <button type="button" style={styles.smallButton} onClick={() => void openRideInvoice(ride.id)}>
              {t.downloadInvoice}
            </button>
          </div>
        )}

        {canCancel && estimatedCancellationFeeMinor > 0 && (
          <div style={styles.warn}>{t.cancellationFeeWarning.replace('{amount}', moneyText(estimatedCancellationFeeMinor, ride.currency || 'USD', lang))}</div>
        )}

        {message && <div style={{ ...styles.notice, ...(status === 'error' || sosState === 'error' ? styles.noticeError : {}) }}>{message}</div>}

        {isTerminal ? (
          <button disabled={status === 'saving'} style={styles.bigButtonInline} onClick={startNewRide}>
            {t.newRide}
          </button>
        ) : (
          <div style={styles.actionGrid2}>
            <button disabled={status === 'saving'} style={styles.smallButton} onClick={() => void refreshRide()}>
              {t.refresh}
            </button>
            <button disabled={!canCancel || status === 'saving'} style={styles.cancelBtn} onClick={() => void cancelRide()}>
              {status === 'saving' ? t.cancelling : t.cancel}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

// Rider safety card (2026-10-10): during an active ride the rider sees exactly who is driving them
// and in what car -- name, photo, verified badge, make/model/colour/year, and the PLATE prominently
// -- and can save or share it in one tap so a trusted contact has it if anything goes wrong. All
// fields are real API data; anything the driver hasn't provided is simply omitted (noFakeTrustSignal).
function DriverSafetyCard({
  ride,
  driverPhotoUrl,
  t,
  lang,
}: {
  ride: PlatformRideRequest
  driverPhotoUrl: string | null
  t: typeof copy.en
  lang: Lang
}) {
  const [saved, setSaved] = useState<'idle' | 'shared' | 'copied'>('idle')
  const p = ride.driver?.driverProfile
  const vehicleParts = [p?.vehicleColor, p?.vehicleMake, p?.vehicleModel, p?.vehicleYear ? String(p.vehicleYear) : null].filter(Boolean)
  const vehicle = vehicleParts.join(' ')
  const plate = p?.vehiclePlate || null
  const rating = ride.driver?.averageRating !== null && ride.driver?.averageRating !== undefined ? `★${ride.driver.averageRating} (${ride.driver.ratingCount})` : null
  const tripId = ride.id.slice(0, 8).toUpperCase()

  function buildSafetyText(): string {
    const isAr = lang === 'ar'
    const lines = [
      isAr ? 'تفاصيل رحلة Rezekme للأمان' : lang === 'fr' ? 'Détails de sécurité — course Rezekme' : 'Rezekme ride — safety details',
      `${t.driver}: ${ride.driver?.displayName || '-'}`,
      vehicle ? `${t.vehicleLabel}: ${vehicle}` : null,
      plate ? `${t.plateLabel}: ${plate}` : null,
      rating ? `${t.ratingLabel}: ${rating}` : null,
      `${t.rideId}: ${tripId}`,
      `${t.pickup}: ${String(ride.metadata.pickup || '-')}`,
      `${t.dropoff}: ${String(ride.metadata.dropoff || '-')}`,
      new Date().toLocaleString(),
    ].filter(Boolean)
    return lines.join('\n')
  }

  async function saveForSafety() {
    const text = buildSafetyText()
    // Prefer the native share sheet (lets the rider send it straight to a trusted contact); fall
    // back to the clipboard, then to a downloadable text file -- so there is always a way to keep it.
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'Rezekme SR', text })
        setSaved('shared')
        return
      }
    } catch {
      // user dismissed the share sheet, or share failed -- fall through to clipboard/download
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        setSaved('copied')
      }
    } catch {
      // clipboard blocked -- offer a file download as the last resort
    }
    try {
      const blob = new Blob([text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sybnb-sr-${tripId}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setSaved((prev) => (prev === 'shared' ? 'shared' : 'copied'))
    } catch {
      // nothing more we can do; leave whatever state was set above
    }
  }

  return (
    <div style={styles.driverCard}>
      <div style={styles.driverHead}>
        {driverPhotoUrl ? (
          <img src={driverPhotoUrl} alt="" style={styles.driverPhoto} />
        ) : (
          <span style={{ ...styles.driverPhoto, ...styles.driverPhotoEmpty }} aria-hidden="true">
            {initials(ride.driver?.displayName)}
          </span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 18 }}>{ride.driver?.displayName || t.driverNotAssigned}</strong>
          {rating && <span style={styles.hint}>{rating}</span>}
          {ride.driver?.isVerified && <span style={styles.okText}>✓ {t.verifiedDriver}</span>}
        </div>
      </div>
      {plate && <div style={styles.plateRow}><span style={styles.hint}>{t.plateLabel}</span><span style={styles.plateValue} dir="ltr">{plate}</span></div>}
      {vehicle && <div style={styles.infoRow}><span>{t.vehicleLabel}</span><strong>{vehicle}</strong></div>}
      <span style={styles.hint}>{t.safetyHint}</span>
      <button type="button" style={styles.smallButton} onClick={() => void saveForSafety()}>
        {saved === 'shared' ? t.savedConfirm : saved === 'copied' ? t.copiedConfirm : t.saveForSafety}
      </button>
    </div>
  )
}

// CAPSULE_RULES.noFakeTrustSignal: only ever renders real data returned by the API (driver's real
// displayName + real vehicle fields) -- never fabricates a name or vehicle when the API omits one.
function initials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function driverIdentityLabel(ride: PlatformRideRequest | null, t: { driverNotAssigned: string }): string {
  if (!ride?.driver) return t.driverNotAssigned
  const vehicle = [ride.driver.driverProfile?.vehicleMake, ride.driver.driverProfile?.vehicleModel].filter(Boolean).join(' ')
  const plate = ride.driver.driverProfile?.vehiclePlate
  // Never show a rating for a driver with none yet -- an invented "0.0" or a hidden zero would be
  // exactly the kind of unbacked claim CAPSULE_RULES.noFakeTrustSignal exists to prevent.
  const rating = ride.driver.averageRating !== null ? `★${ride.driver.averageRating} (${ride.driver.ratingCount})` : null
  return [ride.driver.displayName, vehicle, plate, rating].filter(Boolean).join(' · ')
}


const styles: Record<string, CSSProperties> = {
  pageMap: { minHeight: '100vh', background: '#fff', color: '#000', maxWidth: 520, margin: '0 auto', position: 'relative', paddingBottom: 0 },
  bookSheet: { position: 'relative', zIndex: 2, marginTop: -24, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16, background: '#fff', borderRadius: '24px 24px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,.12)', padding: '8px 16px 128px' },
  gpsButtonOn: { background: '#000', color: '#fff' },
  page: { minHeight: '100vh', background: '#fff', color: '#000', padding: '16px 16px 128px', display: 'grid', gap: 16, maxWidth: 520, margin: '0 auto', alignContent: 'start' },
  hero: { margin: '8px 0 0', fontSize: 32, lineHeight: 1.15, fontWeight: 800, letterSpacing: -0.5 },
  routeCard: { display: 'flex', gap: 12, alignItems: 'stretch', background: '#f3f3f3', borderRadius: 12, padding: '10px 14px' },
  rail: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBlock: 16, width: 12, flex: '0 0 12px' },
  railDot: { width: 9, height: 9, borderRadius: '50%', background: '#000', display: 'block' },
  railLine: { width: 2, flex: 1, minHeight: 28, background: '#000', display: 'block', marginBlock: 3 },
  railSquare: { width: 9, height: 9, background: '#000', display: 'block' },
  routeFields: { flex: 1, display: 'grid', minWidth: 0 },
  fieldRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  routeInput: { flex: 1, minWidth: 0, minHeight: 48, border: 0, background: 'transparent', color: '#000', fontSize: 16, fontWeight: 500, padding: 0, outline: 'none' },
  routeInputBig: { fontSize: 20, fontWeight: 700 },
  divider: { height: 1, background: '#d9d9d9' },
  gpsButton: { minHeight: 32, border: 0, borderRadius: 999, background: '#fff', color: '#000', fontSize: 12, fontWeight: 700, padding: '0 12px', whiteSpace: 'nowrap' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: { display: 'inline-flex', alignItems: 'center', background: '#f3f3f3', borderRadius: 999, overflow: 'hidden' },
  chipMain: { minHeight: 40, border: 0, background: 'transparent', color: '#000', fontWeight: 700, fontSize: 14, paddingInline: '14px 6px' },
  chipSub: { minHeight: 40, border: 0, background: 'transparent', color: '#6b6b6b', fontWeight: 600, fontSize: 12, paddingInline: 8 },
  sectionTitle: { margin: '4px 0 8px', fontSize: 18, fontWeight: 800 },
  hint: { color: '#6b6b6b', fontSize: 13, lineHeight: 1.45 },
  vehicleList: { display: 'grid', gap: 8 },
  vehicleRow: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 92, border: '2px solid #ececec', borderRadius: 12, background: '#fff', color: '#000', padding: '8px 12px', textAlign: 'start', width: '100%' },
  vehicleRowActive: { border: '2px solid #000', background: '#f6f6f6' },
  vehicleArt: { width: 76, flex: '0 0 76px', display: 'grid', placeItems: 'center' },
  vehicleTitleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  seatBadge: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700, color: '#4a4a4a' },
  vehicleDesc: { color: '#4a4a4a', fontSize: 13, lineHeight: 1.35 },
  vehiclePriceCol: { display: 'grid', justifyItems: 'end', gap: 2, textAlign: 'end' },
  estimateTag: { color: '#6b6b6b', fontSize: 11 },
  vehicleGlyph: { width: 48, height: 48, borderRadius: 12, background: '#000', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800, flex: '0 0 48px' },
  vehicleText: { display: 'grid', gap: 2, flex: 1, minWidth: 0 },
  vehicleMeta: { color: '#6b6b6b', fontSize: 13 },
  vehiclePrice: { fontSize: 17, whiteSpace: 'nowrap' },
  skeleton: { display: 'inline-block', width: 40, height: 10, borderRadius: 4, background: '#e5e5e5', verticalAlign: 'middle' },
  moreWrap: { border: '1px solid #e2e2e2', borderRadius: 12, overflow: 'hidden' },
  moreToggle: { width: '100%', minHeight: 52, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: 0, background: '#fff', color: '#000', fontWeight: 700, fontSize: 15, padding: '0 16px' },
  moreBody: { display: 'grid', gap: 12, padding: '4px 16px 16px' },
  optRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontWeight: 600 },
  stepper: { display: 'inline-flex', alignItems: 'center', gap: 10 },
  stepBtn: { width: 36, height: 36, minHeight: 36, borderRadius: '50%', border: 0, background: '#f3f3f3', color: '#000', fontSize: 20, lineHeight: 1, padding: 0 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600, lineHeight: 1.4 },
  inlineForm: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' },
  textInput: { minHeight: 48, border: 0, borderRadius: 10, background: '#f3f3f3', color: '#000', padding: '0 14px', fontSize: 15, minWidth: 0, width: '100%' },
  textarea: { minHeight: 72, border: 0, borderRadius: 10, background: '#f3f3f3', color: '#000', padding: 12, fontFamily: 'inherit', fontSize: 15, resize: 'vertical', width: '100%' },
  smallButton: { minHeight: 44, border: 0, borderRadius: 999, background: '#eee', color: '#000', fontWeight: 700, fontSize: 14, padding: '0 18px' },
  filtersBox: { display: 'grid', gap: 8 },
  filtersHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: 14 },
  subCard: { display: 'grid', gap: 10, background: '#f6f6f6', borderRadius: 12, padding: 14 },
  okText: { color: '#0a7d3b', fontWeight: 700, fontSize: 13 },
  warn: { background: '#fff4d6', color: '#5c4400', borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.45, fontWeight: 600 },
  notice: { background: '#f3f3f3', color: '#000', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 600 },
  noticeError: { background: '#fde8e6', color: '#9b1c12' },
  orDivider: { textAlign: 'center', color: '#6b6b6b', fontSize: 12, fontWeight: 700 },
  stickyBar: { position: 'fixed', insetInline: 0, bottom: 0, background: '#fff', borderTop: '1px solid #e2e2e2', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', zIndex: 20 },
  stickyInner: { maxWidth: 520, margin: '0 auto' },
  bigButton: { width: '100%', minHeight: 56, border: 0, borderRadius: 12, background: '#000', color: '#fff', fontSize: 17, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', gap: 12 },
  bigButtonInline: { width: '100%', minHeight: 52, border: 0, borderRadius: 12, background: '#000', color: '#fff', fontSize: 16, fontWeight: 700, padding: '0 20px' },
  bigButtonDisabled: { background: '#c9c9c9', color: '#fff', cursor: 'not-allowed' },
  sheet: { position: 'relative', zIndex: 2, marginTop: -24, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, background: '#fff', borderRadius: '24px 24px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,.12)', border: '1px solid #ececec', padding: '8px 16px 40px' },
  grabber: { width: 40, height: 4, borderRadius: 2, background: '#d0d0d0', justifySelf: 'center' },
  sheetHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sheetTitle: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 800 },
  etaPill: { background: '#000', color: '#fff', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' },
  progressTrack: { height: 4, borderRadius: 2, background: '#e5e5e5', overflow: 'hidden' },
  progressBar: { height: '100%', width: '40%', animation: 'sr-slide 1.4s linear infinite', background: '#000', borderRadius: 2 },
  pinBox: { display: 'grid', gap: 6, justifyItems: 'center', textAlign: 'center', background: '#000', color: '#fff', borderRadius: 14, padding: '16px 14px' },
  pinLabel: { fontSize: 13, fontWeight: 700, opacity: 0.8 },
  pinValue: { fontSize: 48, letterSpacing: 12, fontWeight: 800, lineHeight: 1.1 },
  driverCard: { display: 'grid', gap: 10, background: '#f6f6f6', borderRadius: 14, padding: 14 },
  driverHead: { display: 'flex', alignItems: 'center', gap: 12 },
  driverPhoto: { width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', background: '#ddd', flex: '0 0 60px' },
  driverPhotoEmpty: { display: 'grid', placeItems: 'center', background: '#000', color: '#fff', fontSize: 20, fontWeight: 800 },
  plateRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  plateValue: { fontSize: 24, fontWeight: 800, letterSpacing: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: '#fff', border: '2px solid #000', borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap' },
  infoRow: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', fontSize: 14, color: '#4a4a4a' },
  tripCard: { display: 'flex', gap: 12, alignItems: 'stretch' },
  tripText: { display: 'grid', gap: 8, alignContent: 'space-between', fontSize: 15, minWidth: 0 },
  badge: { background: '#f3f3f3', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, justifySelf: 'start' },
  actionGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 },
  actionGrid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  actionBtn: { minHeight: 52, border: 0, borderRadius: 12, background: '#f3f3f3', color: '#000', fontWeight: 700, fontSize: 14, padding: '0 8px' },
  sosBtn: { background: '#fde8e6', color: '#c4261b' },
  cancelBtn: { minHeight: 44, border: 0, borderRadius: 999, background: '#fde8e6', color: '#c4261b', fontWeight: 700, fontSize: 14, padding: '0 18px' },
  chatMessages: { display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' },
  bubbleMine: { justifySelf: 'end', maxWidth: '80%', borderRadius: '14px 14px 4px 14px', background: '#000', color: '#fff', padding: '8px 12px', fontSize: 14 },
  bubbleTheirs: { justifySelf: 'start', maxWidth: '80%', borderRadius: '14px 14px 14px 4px', background: '#e8e8e8', color: '#000', padding: '8px 12px', fontSize: 14 },
  receipt: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, fontWeight: 600 },
  receiptTotal: { fontSize: 32, fontWeight: 800 },
  starRow: { display: 'flex', gap: 4 },
  star: { border: 0, background: 'transparent', color: '#cfcfcf', fontSize: 38, padding: 0, minHeight: 48, minWidth: 44 },
  starActive: { border: 0, background: 'transparent', color: '#000', fontSize: 38, padding: 0, minHeight: 48, minWidth: 44 },
  tipChip: { minHeight: 44, border: '2px solid transparent', borderRadius: 999, background: '#fff', color: '#000', fontWeight: 700, fontSize: 14, padding: '0 14px' },
  tipChipActive: { border: '2px solid #000' },
}
