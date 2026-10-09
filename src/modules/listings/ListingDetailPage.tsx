import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeBooking,
  fetchBookingQuote,
  fetchListingAvailability,
  fetchListingQuote,
  fetchListingReviews,
  fetchPrototypeListing,
  fetchPublicHostProfile,
  getStoredGuestSession,
  sendListingInquiryMessage,
  type BookingQuote,
  type HostProfile,
  type PlatformBooking,
  type PlatformListing,
  type PlatformListingReview,
} from '../../shared/api/platformApi'
import { authStorage } from '../../shared/api/authStorage'
import { divisionText, listingDescriptionText, moneyText, statusText } from '../../shared/i18n/display'
import { listingDisplayTitle } from '../../shared/listing/displayTitle'
import { ListingSpecs } from './ListingSpecs'
import { googleMapsEmbedUrl, googleMapsSearchUrl, listingMapTarget, offlineMapSnapshot, offlineMapStorageKey, type GoogleMapTarget } from '../../shared/maps/googleMapCapsule'
import { cancellationRuleText, freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { localeForLang } from '../../shared/country/presentation'
import { guestFeeSummary } from '../bookings/guestFeeSummary'
import { DateField, DateRangePicker, isValidDate, nightsBetween, type DateRange } from '../search/DateRangePicker'
import { loadSearchDatesDraft } from '../search/UnifiedSearchBar'

type Props = {
  listingId: string
  lang: Lang
}


const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'
const GUEST_SESSION_TOKEN_KEY = 'sybnb-v6-guest-token'

const copy = {
  ar: {
    back: 'العودة',
    loading: 'جار التحميل',
    error: 'تعذر تحميل الإعلان',
    notFoundHelp: 'قد يكون هذا الإعلان محذوفاً أو انتهت صلاحيته. تصفّح إعلانات أخرى أو عد إلى الرئيسية.',
    browseAll: 'تصفح الإعلانات',
    goHome: 'الصفحة الرئيسية',
    price: 'السعر',
    owner: 'المالك',
    division: 'القسم',
    status: 'الحالة',
    request: 'إرسال الطلب',
    saving: 'جار الإرسال',
    requestStatus: 'حالة الطلب',
    dashboard: 'فتح الحساب / تسجيل الدخول',
    payment: 'متابعة الحجز',
    reference: 'رقم الإعلان',
    syrianPound: 'ل.س',
    protected: 'محمي عبر SYBNB',
    trustScore: 'درجة الثقة',
    verifiedOwner: 'مالك موثق',
    fastResponse: 'رد سريع',
    paymentProtected: 'الدفع محمي',
    aiFit: 'مطابقة البحث',
    nextSteps: 'خطوات العميل',
    accountGate: 'سجّل الدخول أو أنشئ حساباً للمتابعة',
    accountGateCopy: 'مثل Airbnb و Booking، يستطيع العميل التصفح أولاً ثم يحتاج حساباً عند إرسال الحجز والدفع.',
    signIn: 'تسجيل الدخول والمتابعة',
    signUp: 'إنشاء حساب والمتابعة',
    phone: 'رقم الهاتف',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    sendCode: 'إرسال الرمز',
    resendCode: 'إعادة إرسال الرمز',
    code: 'رمز التحقق',
    securityError: 'أدخل رقم الهاتف وكلمة المرور وتأكيدها ورمز التحقق قبل المتابعة.',
    accountReady: 'تم تجهيز حساب العميل',
    stepRows: ['راجع تفاصيل الغرفة', 'سجّل الدخول أو أنشئ حساباً', 'أرسل الحجز', 'ادفع داخل SYBNB', 'استلم رقم التأكيد'],
    contact: 'فتح التواصل',
    protectionChoice: 'اختيار الحماية',
    standardRate: 'السعر العادي',
    standardCopy: 'سعر أقل، وتطبق رسوم الإلغاء حسب السياسة.',
    protectedRate: 'السعر المحمي',
    protectedCopy: 'أضف حماية الإلغاء المفاجئ لتسترد أكثر إذا ألغيت قبل الدخول.',
    protectionFee: 'رسوم الحماية',
    totalDue: 'الإجمالي المستحق',
    stayAmount: 'قيمة الحجز',
    cleaningFee: 'رسوم الإزالة والتنظيف',
    taxes: 'الضرائب والرسوم المحلية',
    serviceFee: 'رسوم الخدمة',
    parkingFee: 'رسوم مواقف السيارات',
    feesIncluded: 'شامل رسوم التنظيف والضرائب',
    agreementTitle: 'اتفاقية الإيجار اليومي',
    agreementCopy: 'أوافق على صحة بياناتي، احترام سياسة الحجز والإلغاء، الدفع داخل SYBNB فقط، عدم الاتفاق خارج المنصة، الالتزام بقواعد الاستضافة، وتحويل أي نزاع إلى فريق SYBNB قبل أي تصرف خارجي. أعلم أن SYBNB تخصم عمولة خدمة (12% من إجمالي قيمة الحجز، عدا رسوم الحماية) من مستحقات المضيف مقابل إدارة الحجز والدفع والحماية.',
    agreementRequired: 'يجب قبول اتفاقية الإيجار اليومي قبل إرسال طلب الحجز.',
    datesTitle: 'اختر تاريخ الإقامة',
    datesRequired: 'اختر تاريخ الدخول والخروج قبل إرسال طلب الحجز.',
    editDates: 'تعديل التواريخ',
    quoteLoading: 'جار حساب السعر...',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: 'الإصدار 1',
    mapTitle: 'موقع الاستضافة',
    mapCopy: 'موقع الاستضافة المختارة يظهر هنا. افتح خرائط Google لمراجعة المكان قبل إرسال طلب الحجز.',
    mapPin: 'موقع الاستضافة',
    mapApproximate: 'موقع تقريبي حسب بيانات الإعلان',
    openGoogleMaps: 'فتح في خرائط Google',
    saveOfflineMap: 'حفظ الموقع دون إنترنت',
    offlineMapReady: 'تم حفظ الموقع للاستخدام دون إنترنت',
    offlineMapCopy: 'في حال انقطاع الإنترنت سيبقى العنوان والإحداثيات محفوظة داخل جهاز العميل.',
    mapRequiresInternet: 'الخريطة المباشرة تحتاج إنترنت. الموقع النصي محفوظ داخل الحجز.',
    location: 'الموقع',
    host: 'المضيف',
    terms: 'الشروط',
    reviews: 'التقييمات',
    noReviewsYet: 'لا توجد تقييمات بعد',
    reviewsCount: (count: number) => `${count} ${count === 1 ? 'تقييم' : 'تقييمات'}`,
    protectedTitle: 'محمي بواسطة SYBNB',
    rating: 'تقييم الثقة',
    howToBook: 'كيفية الحجز',
    instantBookBadge: '⚡ حجز فوري',
    instantBookExplain: 'هذه الاستضافة تفعّل الحجز الفوري: يتأكد حجزك تلقائياً فور نجاح الدفع، دون انتظار موافقة المضيف.',
    share: 'مشاركة',
    requestOnlyAfterAccount: 'افتح حسابك أو سجّل الدخول أولاً، ثم أرسل طلب الحجز.',
    bottomContact: 'تواصل',
    inquirySentTitle: 'تم إرسال طلبك',
    inquirySentCopy: 'وصل طلبك إلى البائع/المضيف عبر صندوق الرسائل داخل SYBNB. لا حاجة للدفع الآن — سيتواصل معك الطرف الآخر من خلال المنصة.',
    openInbox: 'فتح صندوق الرسائل',
    protectionFeeNote: '3% من قيمة الإقامة كاملة',
    otherFees: 'رسوم أخرى',
    demoNotice: 'هذا إعلان تجريبي للعرض فقط',
    demoNoticeCopy: 'لا يمكن حجز هذا الإعلان أو التواصل بخصوصه. تصفّح الإعلانات الحقيقية المتاحة للحجز.',
    notBookableNotice: 'هذا الإعلان غير متاح للحجز حالياً',
    ownListing: 'لا يمكنك حجز إعلانك الخاص.',
    sentTitle: 'طلبك أُرسل — ادفع خلال 48 ساعة',
    sentDeadline: 'آخر موعد للدفع',
    sentCopy: 'إذا لم يصل الدفع خلال 48 ساعة يُلغى الطلب تلقائياً وتعود التواريخ متاحة لغيرك.',
    howToPay: 'طريقة الدفع',
    howToPaySteps: ['حوّل المبلغ عبر شام كاش أو تحويل بنكي سوري.', 'ارفع صورة إيصال التحويل داخل SYBNB.', 'يراجع فريق SYBNB الإيصال ثم يرسل الطلب للمضيف للموافقة.'],
    payAndUpload: 'الدفع ورفع الإيصال',
    openBooking: 'فتح صفحة الحجز',
    amountToPay: 'المبلغ المطلوب',
  },
  en: {
    back: 'Back',
    loading: 'Loading',
    error: 'Could not load listing',
    notFoundHelp: 'This listing may have been removed or expired. Browse other listings or return home.',
    browseAll: 'Browse listings',
    goHome: 'Home',
    price: 'Price',
    owner: 'Owner',
    division: 'Division',
    status: 'Status',
    request: 'Send request',
    saving: 'Sending',
    requestStatus: 'Request status',
    dashboard: 'Open account / sign in',
    payment: 'Continue booking',
    reference: 'Listing ref',
    syrianPound: 'SYP',
    protected: 'Protected by SYBNB',
    trustScore: 'Trust score',
    verifiedOwner: 'Verified owner',
    fastResponse: 'Fast response',
    paymentProtected: 'Payment protected',
    aiFit: 'Search fit',
    nextSteps: 'Customer steps',
    accountGate: 'Sign in or create an account to continue',
    accountGateCopy: 'Like Airbnb and Booking, guests can browse first and need an account when they reserve and pay.',
    signIn: 'Sign in and continue',
    signUp: 'Create account and continue',
    phone: 'Phone number',
    password: 'Password',
    repeatPassword: 'Repeat password',
    sendCode: 'Send code',
    resendCode: 'Resend code',
    code: 'Verification code',
    securityError: 'Enter phone, password, repeated password, and verification code before continuing.',
    accountReady: 'Guest account ready',
    stepRows: ['Review room details', 'Sign in or create account', 'Send booking', 'Pay inside SYBNB', 'Receive confirmation number'],
    contact: 'Open contact',
    protectionChoice: 'Protection choice',
    standardRate: 'Standard rate',
    standardCopy: 'Lower price; cancellation fees apply by policy.',
    protectedRate: 'Protected rate',
    protectedCopy: 'Add sudden-cancellation protection to get more back if you cancel before check-in.',
    protectionFee: 'Protection fee',
    totalDue: 'Total due',
    stayAmount: 'Booking amount',
    cleaningFee: 'Cleaning fee',
    taxes: 'Taxes and local fees',
    serviceFee: 'Service fee',
    parkingFee: 'Parking fee',
    feesIncluded: 'Includes cleaning fee and taxes',
    agreementTitle: 'Short-Term Rental Agreement',
    agreementCopy: 'I agree that my information is accurate, booking and cancellation rules apply, payment happens only inside SYBNB, no outside-platform agreement is allowed, stay rules must be respected, and disputes go to the SYBNB team before any outside action. I understand SYBNB deducts a service commission (12% of the total booking amount, excluding the protection fee) from the host payout for managing the booking, payment, and protection.',
    agreementRequired: 'You must accept the short-term rental agreement before sending the booking request.',
    datesTitle: 'Choose your stay dates',
    datesRequired: 'Choose check-in and check-out dates before sending the booking request.',
    editDates: 'Edit dates',
    quoteLoading: 'Calculating price...',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: 'Version 1',
    mapTitle: 'Stay location',
    mapCopy: 'The selected stay location appears here. Open Google Maps to review the place before sending the booking request.',
    mapPin: 'Stay location',
    mapApproximate: 'Approximate location from listing data',
    openGoogleMaps: 'Open in Google Maps',
    saveOfflineMap: 'Save offline location',
    offlineMapReady: 'Location saved for offline use',
    offlineMapCopy: 'If internet is unavailable, the address and coordinates stay saved on the guest device.',
    mapRequiresInternet: 'Live map requires internet. The text location is saved inside the booking.',
    location: 'Location',
    host: 'Host',
    terms: 'Terms',
    reviews: 'Reviews',
    noReviewsYet: 'No reviews yet',
    reviewsCount: (count: number) => `${count} ${count === 1 ? 'review' : 'reviews'}`,
    protectedTitle: 'SYBNB Protected',
    rating: 'Trust rating',
    howToBook: 'How booking works',
    instantBookBadge: '⚡ Instant Book',
    instantBookExplain: 'This stay has Instant Book enabled: your booking confirms automatically once payment succeeds, no host approval wait.',
    share: 'Share',
    requestOnlyAfterAccount: 'Open an account or sign in first, then send the booking request.',
    bottomContact: 'Contact',
    inquirySentTitle: 'Your request was sent',
    inquirySentCopy: "Your request reached the seller/host through SYBNB's inbox. No payment needed now — they'll follow up with you through the platform.",
    openInbox: 'Open inbox',
    protectionFeeNote: '3% of the full stay amount',
    otherFees: 'Other fees',
    demoNotice: 'Demo listing — not bookable',
    demoNoticeCopy: 'This listing is for display only and cannot be booked or contacted. Browse real listings that are open for booking.',
    notBookableNotice: 'This listing is not bookable right now',
    ownListing: 'You cannot book your own listing.',
    sentTitle: 'Your request was sent — pay within 48 hours',
    sentDeadline: 'Payment deadline',
    sentCopy: 'If payment does not arrive within 48 hours, the request is cancelled automatically and the dates open up again.',
    howToPay: 'How to pay',
    howToPaySteps: ['Transfer the amount via Sham Cash or a Syrian bank transfer.', 'Upload a photo of the transfer receipt inside SYBNB.', 'The SYBNB team checks the receipt, then sends the request to the host to accept.'],
    payAndUpload: 'Pay and upload receipt',
    openBooking: 'Open booking page',
    amountToPay: 'Amount to pay',
  },
  fr: {
    back: 'Retour',
    loading: 'Chargement',
    error: 'Impossible de charger l’annonce',
    notFoundHelp: 'Cette annonce a peut-être été supprimée ou a expiré. Parcourez d’autres annonces ou revenez à l’accueil.',
    browseAll: 'Parcourir les annonces',
    goHome: 'Accueil',
    price: 'Prix',
    owner: 'Propriétaire',
    division: 'Catégorie',
    status: 'Statut',
    request: 'Envoyer la demande',
    saving: 'Envoi',
    requestStatus: 'Statut de la demande',
    dashboard: 'Ouvrir un compte / se connecter',
    payment: 'Poursuivre la réservation',
    reference: 'Réf. de l’annonce',
    syrianPound: 'SYP',
    protected: 'Protégé par SYBNB',
    trustScore: 'Indice de confiance',
    verifiedOwner: 'Propriétaire vérifié',
    fastResponse: 'Réponse rapide',
    paymentProtected: 'Paiement protégé',
    aiFit: 'Correspondance avec la recherche',
    nextSteps: 'Étapes pour le client',
    accountGate: 'Connectez-vous ou créez un compte pour continuer',
    accountGateCopy: 'Comme sur Airbnb et Booking, vous pouvez d’abord parcourir les annonces ; un compte est nécessaire pour réserver et payer.',
    signIn: 'Se connecter et continuer',
    signUp: 'Créer un compte et continuer',
    phone: 'Numéro de téléphone',
    password: 'Mot de passe',
    repeatPassword: 'Confirmer le mot de passe',
    sendCode: 'Envoyer le code',
    resendCode: 'Renvoyer le code',
    code: 'Code de vérification',
    securityError: 'Saisissez le téléphone, le mot de passe, sa confirmation et le code de vérification avant de continuer.',
    accountReady: 'Compte voyageur prêt',
    stepRows: ['Consultez le détail de la chambre', 'Connectez-vous ou créez un compte', 'Envoyez la réservation', 'Payez dans SYBNB', 'Recevez le numéro de confirmation'],
    contact: 'Ouvrir la messagerie',
    protectionChoice: 'Choix de la protection',
    standardRate: 'Tarif standard',
    standardCopy: 'Prix plus bas ; des frais d’annulation s’appliquent selon la politique.',
    protectedRate: 'Tarif protégé',
    protectedCopy: 'Ajoutez une protection contre l’annulation imprévue pour récupérer davantage si vous annulez avant l’arrivée.',
    protectionFee: 'Frais de protection',
    totalDue: 'Total à payer',
    stayAmount: 'Montant de la réservation',
    cleaningFee: 'Frais de ménage',
    taxes: 'Taxes et frais locaux',
    serviceFee: 'Frais de service',
    parkingFee: 'Frais de stationnement',
    feesIncluded: 'Frais de ménage et taxes inclus',
    agreementTitle: 'Contrat de location de courte durée',
    agreementCopy: 'Je confirme que mes informations sont exactes, que les règles de réservation et d’annulation s’appliquent, que le paiement s’effectue uniquement dans SYBNB, qu’aucun accord hors plateforme n’est autorisé, que les règles du logement doivent être respectées et que tout litige est soumis à l’équipe SYBNB avant toute démarche externe. Je comprends que SYBNB prélève une commission de service (12 % du montant total de la réservation, hors frais de protection) sur le versement à l’hôte pour la gestion de la réservation, du paiement et de la protection.',
    agreementRequired: 'Vous devez accepter le contrat de location de courte durée avant d’envoyer la demande de réservation.',
    datesTitle: 'Choisissez les dates de votre séjour',
    datesRequired: 'Choisissez les dates d’arrivée et de départ avant d’envoyer la demande de réservation.',
    editDates: 'Modifier les dates',
    quoteLoading: 'Calcul du prix...',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: 'Version 1',
    mapTitle: 'Emplacement du logement',
    mapCopy: 'L’emplacement du logement sélectionné s’affiche ici. Ouvrez Google Maps pour repérer les lieux avant d’envoyer la demande de réservation.',
    mapPin: 'Emplacement du logement',
    mapApproximate: 'Emplacement approximatif d’après l’annonce',
    openGoogleMaps: 'Ouvrir dans Google Maps',
    saveOfflineMap: 'Enregistrer l’emplacement hors ligne',
    offlineMapReady: 'Emplacement enregistré pour une utilisation hors ligne',
    offlineMapCopy: 'Sans connexion Internet, l’adresse et les coordonnées restent enregistrées sur l’appareil du voyageur.',
    mapRequiresInternet: 'La carte en direct nécessite Internet. L’adresse reste enregistrée dans la réservation.',
    location: 'Emplacement',
    host: 'Hôte',
    terms: 'Conditions',
    reviews: 'Commentaires',
    noReviewsYet: 'Aucun commentaire pour le moment',
    reviewsCount: (count: number) => `${count} ${count === 1 ? 'commentaire' : 'commentaires'}`,
    protectedTitle: 'Protégé par SYBNB',
    rating: 'Note de confiance',
    howToBook: 'Comment réserver',
    instantBookBadge: '⚡ Réservation instantanée',
    instantBookExplain: 'Ce logement propose la réservation instantanée : votre réservation est confirmée automatiquement dès que le paiement aboutit, sans attendre l’accord de l’hôte.',
    share: 'Partager',
    requestOnlyAfterAccount: 'Ouvrez un compte ou connectez-vous d’abord, puis envoyez la demande de réservation.',
    bottomContact: 'Contacter',
    inquirySentTitle: 'Votre demande a été envoyée',
    inquirySentCopy: 'Votre demande a été transmise au vendeur ou à l’hôte via la messagerie SYBNB. Aucun paiement n’est requis pour le moment : il vous répondra via la plateforme.',
    openInbox: 'Ouvrir la messagerie',
    protectionFeeNote: '3 % du montant total du séjour',
    otherFees: 'Autres frais',
    demoNotice: 'Annonce de démonstration — non réservable',
    demoNoticeCopy: 'Cette annonce est affichée à titre d’exemple : elle ne peut être ni réservée ni contactée. Parcourez les annonces réelles ouvertes à la réservation.',
    notBookableNotice: 'Cette annonce n’est pas réservable pour le moment',
    ownListing: 'Vous ne pouvez pas réserver votre propre annonce.',
    sentTitle: 'Demande envoyée — payez dans les 48 heures',
    sentDeadline: 'Date limite de paiement',
    sentCopy: 'Si le paiement n’arrive pas dans les 48 heures, la demande est annulée automatiquement et les dates redeviennent disponibles.',
    howToPay: 'Comment payer',
    howToPaySteps: ['Virez le montant par Sham Cash ou par virement bancaire syrien.', 'Téléversez une photo du reçu de virement dans SYBNB.', 'L’équipe SYBNB vérifie le reçu, puis transmet la demande à l’hôte pour acceptation.'],
    payAndUpload: 'Payer et téléverser le reçu',
    openBooking: 'Ouvrir la page de réservation',
    amountToPay: 'Montant à payer',
  },
}

const CUSTOMER_GATE_KEY = 'sybnb-v6-customer-account-ready'

const DIVISION_IMAGES: Record<string, string> = {
  STAYS: '/assets/divisions/daily-rental.webp',
  RENTALS: '/assets/divisions/monthly-rental.webp',
  BUY: '/assets/divisions/buy-property.webp',
  NEW_CONSTRUCTION: '/assets/divisions/new-construction.webp',
  CARS: '/assets/divisions/cars.webp',
  MARKETPLACE: '/assets/divisions/marketplace.webp',
}

export function ListingDetailPage({ listingId, lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [listing, setListing] = useState<PlatformListing | null>(null)
  const [booking, setBooking] = useState<PlatformBooking | null>(null)
  const [inquirySent, setInquirySent] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const messageRef = useRef<HTMLElement | null>(null)
  const bookingDraft = useMemo(() => loadBookingDraft(listingId), [listingId])
  const [cancellationProtection, setCancellationProtection] = useState(bookingDraft.cancellationProtection ?? false)
  const [acceptedGuestAgreement, setAcceptedGuestAgreement] = useState(bookingDraft.acceptedGuestAgreement ?? false)
  const [customerReady, setCustomerReady] = useState(false)
  const [offlineMapReady, setOfflineMapReady] = useState(false)
  const [activeMedia, setActiveMedia] = useState(0)
  const [activeTab, setActiveTab] = useState<'terms' | 'host' | 'location' | 'reviews'>('terms')
  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>(
    bookingDraft.dateRange || loadSearchDatesDraft() || { checkIn: '', checkOut: '' },
  )
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [disabledDates, setDisabledDates] = useState<Set<string>>(new Set())
  // Local fallback only (legacy per-night quote) -- used when GET /api/bookings/quote fails.
  const [stayQuote, setStayQuote] = useState<{ totalMinor: number; nights: number } | null>(null)
  // Single source of truth for price / fees / protection / total: GET /api/bookings/quote. Both
  // variants (standard and protected) are fetched together so the two option cards show server
  // numbers and switching protection never shows a stale total.
  const [quotes, setQuotes] = useState<{ standard: BookingQuote; protected: BookingQuote } | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [reviewSummary, setReviewSummary] = useState<{ reviews: PlatformListingReview[]; average: number | null; count: number }>({
    reviews: [],
    average: null,
    count: 0,
  })

  const title = listing ? listingDisplayTitle(listing, lang) || `${divisionText(listing.division, lang)} ${listing.id.slice(0, 8).toUpperCase()}` : ''
  const actionLabel = useMemo(() => actionForDivision(listing?.division || 'STAYS', lang), [lang, listing?.division])
  const detailCopy = useMemo(() => detailCopyForDivision(listing?.division || 'STAYS', lang, t), [lang, listing?.division, t])
  const returnPath = useMemo(() => readListingReturnPath(), [])
  const displayedTotalMinor = stayQuote?.totalMinor ?? listing?.priceMinor ?? 0
  // Same guestFeeSummary() the real receipt (BookingDetailPage) uses, so the price a guest evaluates
  // here already includes the cleaning fee + tax the receipt would otherwise reveal only after
  // booking -- CAPSULE_RULES.noFakeTrustSignal extends to prices, not just verification claims.
  const feeInput = useMemo(
    () => (listing ? { division: listing.division, metadata: listing.metadata } : undefined),
    [listing],
  )
  const feesStandard = useMemo(() => guestFeeSummary({ amountMinor: displayedTotalMinor, listing: feeInput }), [displayedTotalMinor, feeInput])
  // Owner decision (Oct 8, 2026): the protection fee is 3% of the FULL stay amount (all nights,
  // before cleaning/taxes). The server quote is authoritative; the local numbers below are only a
  // fallback when the quote endpoint is unreachable and use that same 3%-of-the-full-stay rule.
  const pricing = useMemo(() => {
    if (quotes) {
      const standard = quotes.standard
      return {
        source: 'quote' as const,
        nights: standard.nights,
        stayMinor: standard.stayMinor,
        cleaningMinor: standard.cleaningMinor,
        taxesMinor: standard.taxesMinor,
        otherFeesMinor: standard.otherFeesMinor,
        protectionMinor: quotes.protected.protectionMinor,
        standardTotalMinor: standard.totalMinor,
        protectedTotalMinor: quotes.protected.totalMinor,
        currency: standard.currency || listing?.currency || 'SYP',
      }
    }
    const protectionMinor = Math.round(feesStandard.stayAmountMinor * 0.03)
    return {
      source: 'local' as const,
      nights: stayQuote?.nights ?? 1,
      stayMinor: feesStandard.stayAmountMinor,
      cleaningMinor: feesStandard.cleaningFeeMinor,
      taxesMinor: feesStandard.taxesMinor,
      otherFeesMinor: feesStandard.serviceFeeMinor + feesStandard.parkingFeeMinor + feesStandard.extraFeesMinor,
      protectionMinor,
      standardTotalMinor: feesStandard.totalMinor,
      protectedTotalMinor: feesStandard.totalMinor + protectionMinor,
      currency: listing?.currency || 'SYP',
    }
  }, [quotes, feesStandard, stayQuote, listing?.currency])
  const protectionFeeMinor = pricing.protectionMinor
  const protectedTotalMinor = pricing.protectedTotalMinor
  const selectedTotalMinor = cancellationProtection ? pricing.protectedTotalMinor : pricing.standardTotalMinor
  const isDemoListing = listing?.metadata?.demo === true
  const notBookable = isDemoListing || quotes?.standard.bookable === false
  const mapTarget = listing ? listingMapTarget(listing, title, lang) : null

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const accountKey = customerGateKey(listingId)
      const search = new URLSearchParams(window.location.search)
      const hasResetFlag = search.has('resetAccount')
      const hasLegacyAccountReadyFlag = search.has('accountReady')

      if (hasResetFlag) {
        sessionStorage.removeItem(CUSTOMER_GATE_KEY)
        sessionStorage.removeItem(accountKey)
        authStorage.removeItem('sybnb-v6-guest-token')
        authStorage.removeItem('sybnb.v6.guestSession')
        setCustomerReady(false)
      } else {
        // A signed-in customer is ready to book -- never ask them to sign up again just because the
        // one-time per-tab flag is missing (new tab, return visit, signed in from the header).
        // Only a real stored guest session counts: booking and inquiry calls both need one, so the
        // old per-tab "account ready" flags would just lead to a GUEST_SESSION_REQUIRED failure.
        setCustomerReady(Boolean(getStoredGuestSession()))
      }

      if (hasResetFlag || hasLegacyAccountReadyFlag) {
        search.delete('resetAccount')
        search.delete('accountReady')
        const nextSearch = search.toString()
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', nextUrl)
      }

      try {
        setOfflineMapReady(localStorage.getItem(offlineMapStorageKey(listingId)) !== null)
      } catch {
        setOfflineMapReady(false)
      }
    }
    void loadListing()
    void loadAvailability()
    void loadReviews()
  }, [listingId])

  async function loadAvailability() {
    const from = toISODate(new Date())
    const to = toISODate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 180))
    const response = await fetchListingAvailability(listingId, from, to)
    const blocked = new Set(response.blockedDates)
    response.bookedRanges.forEach((range) => {
      let day = new Date(`${range.checkIn}T00:00:00`)
      const end = new Date(`${range.checkOut}T00:00:00`)
      while (day < end) {
        blocked.add(toISODate(day))
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      }
    })
    setDisabledDates(blocked)
  }

  async function loadReviews() {
    try {
      const response = await fetchListingReviews(listingId)
      setReviewSummary({ reviews: response.reviews, average: response.average, count: response.count })
    } catch {
      setReviewSummary({ reviews: [], average: null, count: 0 })
    }
  }

  useEffect(() => {
    if (listing?.division !== 'STAYS' || !isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut)) {
      setStayQuote(null)
      return
    }
    let cancelled = false
    setQuoteLoading(true)
    const quoteInput = { listingId, checkIn: dateRange.checkIn, checkOut: dateRange.checkOut }
    // Debounced so quick date edits don't fire a request per click.
    const timer = window.setTimeout(() => {
      Promise.all([fetchBookingQuote({ ...quoteInput, protection: false }), fetchBookingQuote({ ...quoteInput, protection: true })])
        .then(([standard, protectedQuote]) => {
          if (cancelled) return
          setQuotes({ standard, protected: protectedQuote })
          setStayQuote({ totalMinor: standard.stayMinor, nights: standard.nights })
        })
        .catch(async () => {
          if (cancelled) return
          setQuotes(null)
          // Fallback: legacy per-night quote + local fee calculation.
          try {
            const response = await fetchListingQuote(listingId, dateRange.checkIn, dateRange.checkOut)
            if (!cancelled) setStayQuote({ totalMinor: response.totalMinor, nights: response.nights })
          } catch {
            if (!cancelled) setStayQuote(null)
          }
        })
        .finally(() => {
          if (!cancelled) setQuoteLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [listingId, listing?.division, dateRange.checkIn, dateRange.checkOut])

  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView({ behavior: 'instant', block: 'center' })
  }, [message])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const draft: BookingDraft = { dateRange, cancellationProtection, acceptedGuestAgreement }
    sessionStorage.setItem(bookingDraftKey(listingId), JSON.stringify(draft))
  }, [listingId, dateRange, cancellationProtection, acceptedGuestAgreement])

  async function loadListing() {
    setStatus('loading')
    setMessage('')

    try {
      const loaded = await fetchPrototypeListing(listingId)
      setListing(loaded)
      syncListingReturnPath(loaded.division)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function requestListing() {
    if (!listing || notBookable) return
    // Signed-out: go to sign-in FIRST (before asking for dates). Any dates already picked stay in
    // the per-listing booking draft (sessionStorage) and are restored when we come back here.
    if (!getStoredGuestSession()) {
      goToAccountAndBack(listing.id)
      return
    }
    if (
      listing.division === 'STAYS' &&
      (!isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut) || nightsBetween(dateRange.checkIn, dateRange.checkOut) < 1)
    ) {
      setShowDatePicker(true)
      setMessage(t.datesRequired)
      return
    }
    if (listing.division === 'STAYS' && !acceptedGuestAgreement) {
      setMessage(t.agreementRequired)
      return
    }
    setStatus('saving')
    setMessage('')

    // Only STAYS is a real paid booking. Every other division ("Contact seller" / "Request
    // item" / "Book visit") is a lightweight inquiry — it must never create a PAYMENT_PENDING
    // booking for the full listing price. Route it through the same message-thread inquiry
    // used by Rentals/Buy instead (see sendListingInquiryMessage / RentalsPage.tsx).
    if (listing.division !== 'STAYS') {
      try {
        const introBody = pick(lang, `طلب تواصل جديد بخصوص "${title}".`, `New inquiry about "${title}".`, `Nouvelle demande au sujet de « ${title} ».`)
        await sendListingInquiryMessage(listing.id, introBody)
        setInquirySent(true)
        setStatus('ready')
      } catch (error) {
        setStatus('error')
        setMessage(error instanceof Error ? error.message : t.error)
      }
      return
    }

    try {
      const nextBooking = await createPrototypeBooking({
        listingId: listing.id,
        amountMinor: pricing.stayMinor,
        currency: listing.currency,
        checkIn: dateRange.checkIn,
        checkOut: dateRange.checkOut,
        cancellationProtectionPurchased: cancellationProtection,
        cancellationProtectionFeeMinor: cancellationProtection ? protectionFeeMinor : undefined,
        acceptedTerms: true,
        termsVersion: t.agreementVersion,
      })
      setBooking(nextBooking)
      setStatus('ready')
      clearBookingDraft(listing.id)
    } catch (error) {
      setStatus('error')
      const code = (error as { code?: string } | null)?.code
      if (code === 'LISTING_NOT_BOOKABLE') setMessage(isDemoListing ? t.demoNotice : t.notBookableNotice)
      else if (code === 'OWN_LISTING') setMessage(t.ownListing)
      else setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function openContactTunnel() {
    if (!listing || typeof window === 'undefined') return
    if (!authStorage.getItem(GUEST_SESSION_TOKEN_KEY)) {
      // Sign in first, then come back to THIS listing (not a generic inbox/stays page).
      goToAccountAndBack(listing.id)
      return
    }
    window.location.hash = '/immocontact'
  }

  function saveOfflineMap() {
    if (!listing) return
    try {
      localStorage.setItem(offlineMapStorageKey(listing.id), JSON.stringify(offlineMapSnapshot(listing, title, lang)))
      setOfflineMapReady(true)
    } catch {
      setMessage(t.mapRequiresInternet)
    }
  }

  function shareListing() {
    if (typeof window === 'undefined') return
    const url = window.location.href
    if (navigator.share) {
      void navigator.share({ title, url }).catch(() => undefined)
      return
    }
    void navigator.clipboard?.writeText(url)
    setMessage(pick(lang, 'تم نسخ رابط الإعلان.', 'Listing link copied.', 'Lien de l’annonce copié.'))
  }

  const colon = lang === 'fr' ? ' : ' : ': '
  const isStays = listing?.division === 'STAYS'
  const unit = listing ? priceUnitText(listing.division, lang) : ''
  const mediaUrls = listing
    ? (listing.media || []).map((item) => item.url || item.src || item.assetUrl).filter((value): value is string => typeof value === 'string')
    : []
  const mediaCount = mediaUrls.length
  const placeLabel = listing ? localizedPlaceLabel(mapTarget, lang) : ''
  const primaryLabel = status === 'saving' ? t.saving : actionLabel

  function showMedia(step: 1 | -1) {
    if (mediaCount < 2) return
    setActiveMedia((current) => (current + step + mediaCount) % mediaCount)
  }

  const messageBox = message ? (
    <section ref={messageRef} style={styles.alert} role="alert">{message}</section>
  ) : null

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      {/* The global breadcrumb bar (AppShell .flow-step-nav) is translucent and lets the listing show
          through while scrolling. Give it a solid surface while this page is mounted. */}
      <style>{LISTING_PAGE_CSS}</style>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {!listing && messageBox}

      {status === 'error' && !listing && (
        <section style={styles.panel}>
          <p style={{ margin: '0 0 14px', lineHeight: 1.7 }}>{t.notFoundHelp}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={styles.recoverPrimary} onClick={() => (window.location.hash = returnPath || '/stays')}>
              {t.browseAll}
            </button>
            <button style={styles.recoverSecondary} onClick={() => (window.location.hash = '/')}>
              {t.goHome}
            </button>
          </div>
        </section>
      )}

      {listing && (
        <>
          <section style={styles.detailHero}>
            <button type="button" style={styles.heroIconButton} onClick={shareListing} aria-label={t.share}>
              ↗
            </button>
            <div style={styles.media}>
              <img
                src={mediaUrls[activeMedia] || listingImage(listing)}
                alt={title}
                style={styles.mediaImage}
                onError={(event) => {
                  const fallback = DIVISION_IMAGES[listing.division] || '/assets/divisions/daily-rental.webp'
                  if (event.currentTarget.src.endsWith(fallback)) return
                  event.currentTarget.src = fallback
                }}
              />
              {mediaCount > 1 && (
                <>
                  {/* Gallery arrows only move between photos -- they never start the booking/sign-in flow. */}
                  <button
                    type="button"
                    style={{ ...styles.galleryArrow, insetInlineStart: 12 }}
                    onClick={() => showMedia(-1)}
                    aria-label={pick(lang, 'الصورة السابقة', 'Previous photo', 'Photo précédente')}
                  >
                    {isAr ? '›' : '‹'}
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.galleryArrow, insetInlineEnd: 12 }}
                    onClick={() => showMedia(1)}
                    aria-label={pick(lang, 'الصورة التالية', 'Next photo', 'Photo suivante')}
                  >
                    {isAr ? '‹' : '›'}
                  </button>
                  <span style={styles.galleryCounter} dir="ltr">{activeMedia + 1} / {mediaCount}</span>
                  <div style={styles.thumbStrip} role="group" aria-label={pick(lang, 'صور الإعلان', 'Listing photos', 'Photos de l’annonce')}>
                    {mediaUrls.map((url, index) => (
                      <button
                        key={`${url}-${index}`}
                        type="button"
                        onClick={() => setActiveMedia(index)}
                        aria-label={`${title} ${index + 1}`}
                        aria-current={index === activeMedia}
                        style={index === activeMedia ? styles.thumbActive : styles.thumb}
                      >
                        <img src={url} alt="" style={styles.thumbImg} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              <span style={styles.mediaBadge}>{divisionText(listing.division, lang)}</span>
              {listing.instantBookEnabled && <span style={styles.instantBookBadge}>{t.instantBookBadge}</span>}
            </div>
          </section>

          <section style={styles.detailBody}>
            <div style={styles.titleBlock}>
              <h1 style={styles.title}>{title}</h1>
              <span style={styles.locationLine}>⌖ {placeLabel || divisionText(listing.division, lang)}</span>
            </div>

            {/* Price block: always visible, independent of the active tab. */}
            <section style={styles.priceBlock} aria-label={t.price}>
              <div style={styles.priceHeadline}>
                <strong style={styles.priceAmount} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
                {unit && <span style={styles.priceUnit}>/ {unit}</span>}
              </div>
              {(isStays || feesStandard.totalMinor !== listing.priceMinor) && !(isDemoListing && !isStays) && (
                <small style={styles.priceSub}>
                  {quoteLoading
                    ? t.quoteLoading
                    : `${t.totalDue}${colon}${moneyText(isStays ? selectedTotalMinor : feesStandard.totalMinor, listing.currency, lang)}${
                        isStays ? ` · ${pricing.nights} ${nightsWord(pricing.nights, lang)}` : ''
                      }`}
                  {isStays && !quoteLoading ? ` · ${t.feesIncluded}` : ''}
                </small>
              )}
              <small style={styles.ratingLine}>
                {reviewSummary.count > 0 ? `★ ${reviewSummary.average} · ${t.reviewsCount(reviewSummary.count)}` : t.noReviewsYet}
                {isStays ? ` · ${t.protectedTitle}` : ''}
              </small>
            </section>

            {notBookable && (
              <div style={styles.demoBadge} role="note">{isDemoListing ? t.demoNotice : t.notBookableNotice}</div>
            )}

            <p style={styles.body}>{listingDescriptionText(listing, lang)}</p>
            <ListingSpecs division={listing.division} metadata={listing.metadata} lang={lang} />

            <div style={styles.tabRow} role="tablist" aria-label={pick(lang, 'تفاصيل الإعلان', 'Listing details', 'Détails de l’annonce')}>
              {(['terms', 'host', 'location', 'reviews'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  style={activeTab === tab ? styles.tabActive : styles.tab}
                  onClick={() => setActiveTab(tab)}
                >
                  {t[tab]}
                </button>
              ))}
            </div>

            <section style={styles.tabPanel} role="tabpanel">
              {activeTab === 'terms' && (
                <TermsPanel listing={listing} lang={lang} checkIn={dateRange.checkIn} agreementTitle={detailCopy.agreementTitle} agreementVersionLabel={t.agreementVersionLabel} />
              )}

              {activeTab === 'host' && (
                <div style={styles.trustGrid}>
                  <article style={styles.trustCard}>
                    <strong>{isStays ? t.host : pick(lang, 'المعلن', 'Seller', 'Vendeur')}</strong>
                    <HostCard
                      lang={lang}
                      ownerId={listing.ownerId}
                      fallbackName={listing.owner?.displayName || listing.ownerId.slice(0, 8).toUpperCase()}
                      profile={hostProfile}
                      onLoad={setHostProfile}
                    />
                  </article>
                  {/* Payment protection only applies to the division that actually transacts (Stays);
                      showing it on contact-only divisions (Rentals/Buy/Cars/Marketplace) would overclaim. */}
                  {isStays && (
                    <article style={styles.trustCard}>
                      <strong>{t.paymentProtected}</strong>
                      <span>{t.protected}</span>
                    </article>
                  )}
                </div>
              )}

              {activeTab === 'location' && (
                <section style={styles.mapPanel}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <strong>{detailCopy.mapTitle}</strong>
                    <span style={styles.placeText}>⌖ {placeLabel}</span>
                    <span style={styles.body}>{detailCopy.mapCopy}</span>
                  </div>
                  <div style={styles.mapCanvas} aria-label={detailCopy.mapTitle}>
                    <iframe
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      src={googleMapsEmbedUrl(listing, title, lang)}
                      style={styles.mapFrame}
                      title={detailCopy.mapTitle}
                    />
                    <div style={styles.mapLocationCard}>
                      <span style={styles.mapPin}>{detailCopy.mapPin}</span>
                      <strong>{placeLabel}</strong>
                      {mapTarget?.hasCoordinates ? (
                        <small dir="ltr">{mapTarget.query}</small>
                      ) : mapTarget?.hasRealLocation ? (
                        <small>{t.mapApproximate}</small>
                      ) : null}
                    </div>
                  </div>
                  <a href={googleMapsSearchUrl(listing, title, lang)} rel="noreferrer" target="_blank" style={styles.secondaryLinkButton}>
                    {t.openGoogleMaps}
                  </a>
                  <div style={offlineMapReady ? styles.offlineMapReady : styles.offlineMapCard}>
                    <div>
                      <strong>{offlineMapReady ? t.offlineMapReady : t.mapRequiresInternet}</strong>
                      <span>{t.offlineMapCopy}</span>
                      <small dir="ltr">{mapTarget?.hasCoordinates ? mapTarget.query : placeLabel}</small>
                    </div>
                    <button type="button" style={offlineMapReady ? styles.offlineMapSavedButton : styles.offlineMapButton} onClick={saveOfflineMap}>
                      {offlineMapReady ? '✓' : t.saveOfflineMap}
                    </button>
                  </div>
                </section>
              )}

              {activeTab === 'reviews' && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <Info
                    label={t.rating}
                    value={reviewSummary.count > 0 ? `${reviewSummary.average} ★ (${t.reviewsCount(reviewSummary.count)})` : t.noReviewsYet}
                  />
                  {reviewSummary.reviews.length > 0 ? (
                    <div style={styles.grid}>
                      {reviewSummary.reviews.map((review) => (
                        <article key={review.id} style={styles.info}>
                          <span dir={isAr ? 'rtl' : 'ltr'}>{review.guest?.displayName || pick(lang, 'ضيف', 'Guest', 'Voyageur')} · {'★'.repeat(review.rating)}</span>
                          <strong dir={isAr ? 'rtl' : 'ltr'}>{review.comment || ''}</strong>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p style={styles.body}>
                      {pick(
                        lang,
                        'لم يكتب أحد تقييماً لهذا الإعلان بعد. تظهر التقييمات هنا بعد إتمام تعاملات حقيقية عبر SYBNB.',
                        'Nobody has reviewed this listing yet. Reviews appear here after real transactions through SYBNB.',
                        'Personne n’a encore évalué cette annonce. Les commentaires s’affichent ici après de vraies transactions via SYBNB.',
                      )}
                    </p>
                  )}
                </div>
              )}
            </section>
          </section>

          {/* Booking / contact block: always visible below the tabs, whatever tab is active. */}
          <section id="listing-booking" style={styles.bookingBlock}>
            {notBookable && (
              <section style={styles.demoNotice} role="note">
                <strong>{isDemoListing ? t.demoNotice : t.notBookableNotice}</strong>
                {isDemoListing && <span>{t.demoNoticeCopy}</span>}
                <button type="button" style={styles.secondaryButton} onClick={() => (window.location.hash = returnPath || '/stays')}>
                  {t.browseAll}
                </button>
              </section>
            )}
            {!notBookable && (<>
            {!customerReady && <div style={styles.accountHint}>{accountHintText(listing.division, lang)}</div>}

            {isStays && (
              <>
                <section style={styles.protectionChoice}>
                  <strong>{t.datesTitle}</strong>
                  {showDatePicker ? (
                    <DateRangePicker
                      lang={lang}
                      value={dateRange}
                      onChange={setDateRange}
                      onClose={() => setShowDatePicker(false)}
                      disabledDates={disabledDates}
                      disabledHint={t.datesRequired}
                    />
                  ) : (
                    <div style={styles.dateFieldsRow}>
                      <DateField
                        lang={lang}
                        label={pick(lang, 'تاريخ الدخول', 'Check-in', 'Arrivée')}
                        value={dateRange.checkIn}
                        onClick={() => setShowDatePicker(true)}
                      />
                      <DateField
                        lang={lang}
                        label={pick(lang, 'تاريخ الخروج', 'Check-out', 'Départ')}
                        value={dateRange.checkOut}
                        onClick={() => setShowDatePicker(true)}
                      />
                    </div>
                  )}
                </section>

                <section style={styles.protectionChoice}>
                  <strong>{t.protectionChoice}</strong>
                  <div style={styles.protectionOptions}>
                    <button
                      type="button"
                      style={!cancellationProtection ? styles.protectionOptionActive : styles.protectionOption}
                      onClick={() => setCancellationProtection(false)}
                    >
                      <b>{t.standardRate}</b>
                      <span>{t.standardCopy}</span>
                      <em style={styles.cancellationCutoff}>{cancellationRuleText(false, lang)}</em>
                      {dateRange.checkIn && <small style={styles.feesIncludedNote}>{freeCancellationLabel(dateRange.checkIn, false, lang)}</small>}
                      <small>
                        {quoteLoading
                          ? t.quoteLoading
                          : stayQuote || quotes
                            ? `${moneyText(pricing.standardTotalMinor, pricing.currency, lang)} · ${pricing.nights} ${nightsWord(pricing.nights, lang)}`
                            : moneyText(pricing.standardTotalMinor, pricing.currency, lang)}
                      </small>
                      {!quoteLoading && <small style={styles.feesIncludedNote}>{t.feesIncluded}</small>}
                    </button>
                    <button
                      type="button"
                      style={cancellationProtection ? styles.protectionOptionActive : styles.protectionOption}
                      onClick={() => setCancellationProtection(true)}
                    >
                      <b>{t.protectedRate}</b>
                      <span>{t.protectedCopy}</span>
                      <em style={styles.cancellationCutoff}>{cancellationRuleText(true, lang)}</em>
                      <small>
                        {quoteLoading
                          ? t.quoteLoading
                          : `${t.protectionFee}${colon}${moneyText(protectionFeeMinor, pricing.currency, lang)} (${t.protectionFeeNote})`}
                      </small>
                      {!quoteLoading && <small>{t.totalDue}{colon}{moneyText(protectedTotalMinor, pricing.currency, lang)}</small>}
                      {!quoteLoading && <small style={styles.feesIncludedNote}>{t.feesIncluded}</small>}
                    </button>
                  </div>
                  {!quoteLoading && (pricing.cleaningMinor > 0 || pricing.taxesMinor > 0 || pricing.otherFeesMinor > 0 || cancellationProtection) && (
                    <div style={styles.feeBreakdownRow}>
                      <span>{t.stayAmount}{colon}{moneyText(pricing.stayMinor, pricing.currency, lang)}</span>
                      {pricing.cleaningMinor > 0 && (
                        <span>{t.cleaningFee}{colon}{moneyText(pricing.cleaningMinor, pricing.currency, lang)}</span>
                      )}
                      {pricing.taxesMinor > 0 && <span>{t.taxes}{colon}{moneyText(pricing.taxesMinor, pricing.currency, lang)}</span>}
                      {pricing.otherFeesMinor > 0 && (
                        <span>{t.otherFees}{colon}{moneyText(pricing.otherFeesMinor, pricing.currency, lang)}</span>
                      )}
                      {cancellationProtection && (
                        <span>{t.protectionFee}{colon}{moneyText(pricing.protectionMinor, pricing.currency, lang)}</span>
                      )}
                      {cancellationProtection && (
                        <strong>{t.totalDue}{colon}{moneyText(pricing.protectedTotalMinor, pricing.currency, lang)}</strong>
                      )}
                    </div>
                  )}
                </section>

                {!booking && (
                  // Inline (not sticky) so it never covers the listing while scrolling.
                  <label style={styles.agreementBox}>
                    <input
                      checked={acceptedGuestAgreement}
                      onChange={(event) => {
                        setAcceptedGuestAgreement(event.target.checked)
                        if (event.target.checked && message === t.agreementRequired) setMessage('')
                      }}
                      style={styles.agreementInput}
                      type="checkbox"
                    />
                    <span style={{ display: 'grid', gap: 6 }}>
                      <strong>{detailCopy.agreementTitle}</strong>
                      <small>{detailCopy.agreementCopy}</small>
                      <em>{t.agreementVersionLabel}</em>
                    </span>
                  </label>
                )}
              </>
            )}

            {messageBox}

            {booking && <BookingSentPanel booking={booking} listing={listing} lang={lang} />}

            {inquirySent && (
              <section style={styles.panel}>
                <strong>{t.inquirySentTitle}</strong>
                <p style={styles.body}>{t.inquirySentCopy}</p>
                <button type="button" style={styles.primaryButton} onClick={() => (window.location.hash = '/immocontact')}>
                  {t.openInbox}
                </button>
              </section>
            )}

            <div style={styles.actions}>
              {isStays && (
                <button type="button" style={styles.secondaryButton} onClick={openContactTunnel}>
                  {pick(lang, 'تواصل مع المضيف', 'Contact host', 'Contacter l’hôte')}
                </button>
              )}
              {!inquirySent && !booking && (
                <button type="button" disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void requestListing()}>
                  {primaryLabel}
                </button>
              )}
            </div>
            </>)}
          </section>

          <section style={styles.bookingSteps}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{detailCopy.howToBook}</h2>
            {detailCopy.stepRows.slice(0, 4).map((step, index) => (
              <div key={step} style={styles.bookingStep}>
                <b>{index + 1}</b>
                <span>{step}</span>
              </div>
            ))}
            {listing.instantBookEnabled && <p style={styles.instantBookNote}>⚡ {t.instantBookExplain}</p>}
          </section>

          <section style={styles.grid}>
            <Info label={isStays ? t.host : t.owner} value={listing.owner?.displayName || listing.ownerId.slice(0, 8).toUpperCase()} />
            <Info label={t.division} value={divisionText(listing.division, lang)} dir={isAr ? 'rtl' : 'ltr'} />
            <Info label={t.reference} value={listing.id.slice(0, 8).toUpperCase()} />
            {listing.status !== 'APPROVED' && <Info label={t.status} value={statusText(listing.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />}
            {customerReady ? <Info label={t.accountReady} value="✓" dir={isAr ? 'rtl' : 'ltr'} /> : null}
            {booking ? <Info label={t.requestStatus} value={statusText(booking.status, lang)} dir={isAr ? 'rtl' : 'ltr'} /> : null}
          </section>

          {/* Compact sticky bar: price + the one primary action only (no agreement text), so it never
              covers a large part of the listing. */}
          {!inquirySent && !booking && !notBookable && (
            <section style={styles.bottomActionBar}>
              <div style={styles.bottomPrice}>
                <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
                {unit && <span>/ {unit}</span>}
              </div>
              <button type="button" disabled={status === 'saving'} style={styles.primaryButtonCompact} onClick={() => void requestListing()}>
                {primaryLabel}
              </button>
            </section>
          )}
        </>
      )}
    </main>
  )
}

// Shown right after a stay booking is created: the guest has 48h to pay (manual proof rail:
// Sham Cash / Syrian bank transfer + receipt upload), after which the unpaid request expires.
function BookingSentPanel({ booking, listing, lang }: { booking: PlatformBooking; listing: PlatformListing; lang: Lang }) {
  const t = copy[lang]
  const colon = lang === 'fr' ? ' : ' : ': '
  const expiresAt = booking.expiresAt
    ? new Date(booking.expiresAt)
    : new Date(new Date(booking.createdAt || Date.now()).getTime() + 48 * 60 * 60 * 1000)
  const expiryText = Number.isNaN(expiresAt.getTime())
    ? ''
    : expiresAt.toLocaleString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
  const fees = guestFeeSummary({ amountMinor: booking.amountMinor, listing: { division: listing.division, metadata: listing.metadata }, metadata: booking.metadata })
  const paymentRoute = `/payment/local-wallet/${booking.id}/${fees.totalMinor}/${encodeURIComponent(booking.currency)}`
  // The booking page holds the one-time ID-photo step that precedes payment; when we know the
  // guest has not sent it yet, send them there instead of straight to the receipt upload.
  const needsIdFirst = Boolean(booking.guest) && !booking.guest?.idDocumentRef
  return (
    <section style={styles.sentPanel} role="status">
      <strong style={styles.sentTitle}>✓ {t.sentTitle}</strong>
      {expiryText && (
        <span>
          {t.sentDeadline}
          {colon}
          <b>{expiryText}</b>
        </span>
      )}
      <span>
        {t.amountToPay}
        {colon}
        <b dir={lang === 'ar' ? 'rtl' : 'ltr'}>{moneyText(fees.totalMinor, booking.currency, lang)}</b>
      </span>
      <small style={{ color: '#9aa6ba', lineHeight: 1.6 }}>{t.sentCopy}</small>
      <div style={{ display: 'grid', gap: 6 }}>
        <strong>{t.howToPay}</strong>
        <ol style={styles.sentSteps}>
          {t.howToPaySteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <div style={styles.sentActions}>
        <button type="button" style={styles.primaryButton} onClick={() => (window.location.hash = needsIdFirst ? `/booking/${booking.id}` : paymentRoute)}>
          {t.payAndUpload}
        </button>
        <button type="button" style={styles.secondaryButton} onClick={() => (window.location.hash = `/booking/${booking.id}`)}>
          {t.openBooking}
        </button>
      </div>
    </section>
  )
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function listingImage(listing: PlatformListing) {
  // Prefer the listing's real uploaded photo for every division; generic image is only a fallback.
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  if (typeof mediaUrl === 'string') return mediaUrl
  return DIVISION_IMAGES[listing.division] || '/assets/divisions/daily-rental.webp'
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <article style={styles.info}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </article>
  )
}

function actionForDivision(division: string, lang: Lang) {
  const actions: Record<string, Record<Lang, string>> = {
    STAYS: { ar: 'إرسال طلب الحجز', en: 'Send booking request', fr: 'Envoyer la demande de réservation' },
    RENTALS: { ar: 'طلب تواصل', en: 'Request contact', fr: 'Demander un contact' },
    // Non-bookable divisions only open a conversation with the seller -- never "booking" wording.
    BUY: { ar: 'تواصل مع البائع', en: 'Contact seller', fr: 'Contacter le vendeur' },
    CARS: { ar: 'تواصل مع البائع', en: 'Contact seller', fr: 'Contacter le vendeur' },
    MARKETPLACE: { ar: 'تواصل مع البائع', en: 'Contact seller', fr: 'Contacter le vendeur' },
    NEW_CONSTRUCTION: { ar: 'تواصل مع البائع', en: 'Contact seller', fr: 'Contacter le vendeur' },
  }
  return actions[division]?.[lang] || actions.STAYS[lang]
}

function detailCopyForDivision(division: string, lang: Lang, fallback: typeof copy.ar) {
  const detailCopy: Record<string, Partial<typeof copy.ar>> = {
    STAYS: {},
    RENTALS: {
      mapTitle: pick(lang, 'موقع العقار', 'Property location', 'Emplacement du bien'),
      mapCopy: pick(lang, 'موقع العقار المختار يظهر هنا. افتح خرائط Google لمراجعة المنطقة قبل إرسال الطلب.', 'The selected property location appears here. Open Google Maps to review the area before sending the request.', 'L’emplacement du bien sélectionné s’affiche ici. Ouvrez Google Maps pour repérer le quartier avant d’envoyer la demande.'),
      mapPin: pick(lang, 'موقع العقار', 'Property location', 'Emplacement du bien'),
      howToBook: pick(lang, 'كيف تسير العملية', 'How it works', 'Comment ça marche'),
      stepRows: pick(
        lang,
        ['راجع تفاصيل العقار', 'سجّل الدخول أو أنشئ حساباً', 'أرسل طلب التواصل', 'تواصل مع المالك داخل SYBNB'],
        ['Review property details', 'Sign in or create account', 'Send contact request', 'Coordinate with the owner inside SYBNB'],
        ['Consultez le détail du bien', 'Connectez-vous ou créez un compte', 'Envoyez la demande de contact', 'Échangez avec le propriétaire dans SYBNB'],
      ),
    },
    BUY: {
      mapTitle: pick(lang, 'موقع العقار', 'Property location', 'Emplacement du bien'),
      mapCopy: pick(lang, 'موقع العقار المختار يظهر هنا. راجع المنطقة قبل التواصل مع البائع.', 'The selected property location appears here. Review the area before contacting the seller.', 'L’emplacement du bien sélectionné s’affiche ici. Repérez le quartier avant de contacter le vendeur.'),
      mapPin: pick(lang, 'موقع العقار', 'Property location', 'Emplacement du bien'),
      howToBook: pick(lang, 'كيف تسير العملية', 'How it works', 'Comment ça marche'),
      stepRows: pick(
        lang,
        ['راجع تفاصيل العقار', 'سجّل الدخول أو أنشئ حساباً', 'تواصل مع البائع', 'نسّق موعد الزيارة داخل SYBNB'],
        ['Review property details', 'Sign in or create account', 'Contact the seller', 'Coordinate the visit inside SYBNB'],
        ['Consultez le détail du bien', 'Connectez-vous ou créez un compte', 'Contactez le vendeur', 'Organisez la visite dans SYBNB'],
      ),
    },
    CARS: {
      mapTitle: pick(lang, 'موقع المركبة', 'Vehicle location', 'Emplacement du véhicule'),
      mapCopy: pick(lang, 'موقع المركبة أو المعرض يظهر هنا. افتح خرائط Google قبل التواصل مع البائع.', 'The vehicle or showroom location appears here. Open Google Maps before contacting the seller.', 'L’emplacement du véhicule ou du concessionnaire s’affiche ici. Ouvrez Google Maps avant de contacter le vendeur.'),
      mapPin: pick(lang, 'موقع المركبة', 'Vehicle location', 'Emplacement du véhicule'),
      howToBook: pick(lang, 'كيف تسير العملية', 'How it works', 'Comment ça marche'),
      stepRows: pick(
        lang,
        ['راجع تفاصيل المركبة', 'سجّل الدخول أو أنشئ حساباً', 'تواصل مع البائع', 'نسّق الفحص والمعاينة داخل SYBNB'],
        ['Review vehicle details', 'Sign in or create account', 'Contact the seller', 'Coordinate inspection inside SYBNB'],
        ['Consultez le détail du véhicule', 'Connectez-vous ou créez un compte', 'Contactez le vendeur', 'Organisez l’inspection dans SYBNB'],
      ),
    },
    MARKETPLACE: {
      mapTitle: pick(lang, 'موقع العرض', 'Offer location', 'Emplacement de l’offre'),
      mapCopy: pick(lang, 'موقع العرض يظهر هنا. راجع المنطقة قبل التواصل مع البائع.', 'The offer location appears here. Review the area before contacting the seller.', 'L’emplacement de l’offre s’affiche ici. Repérez le quartier avant de contacter le vendeur.'),
      mapPin: pick(lang, 'موقع العرض', 'Offer location', 'Emplacement de l’offre'),
      howToBook: pick(lang, 'كيف تسير العملية', 'How it works', 'Comment ça marche'),
      stepRows: pick(
        lang,
        ['راجع تفاصيل المنتج', 'سجّل الدخول أو أنشئ حساباً', 'تواصل مع البائع', 'نسّق الاستلام مع البائع داخل SYBNB'],
        ['Review item details', 'Sign in or create account', 'Contact the seller', 'Coordinate pickup with the seller inside SYBNB'],
        ['Consultez le détail de l’article', 'Connectez-vous ou créez un compte', 'Contactez le vendeur', 'Organisez le retrait avec le vendeur dans SYBNB'],
      ),
    },
    NEW_CONSTRUCTION: {
      mapTitle: pick(lang, 'موقع المشروع', 'Project location', 'Emplacement du projet'),
      mapCopy: pick(lang, 'موقع المشروع يظهر هنا. افتح خرائط Google قبل التواصل مع البائع.', 'The project location appears here. Open Google Maps before contacting the seller.', 'L’emplacement du projet s’affiche ici. Ouvrez Google Maps avant de contacter le vendeur.'),
      mapPin: pick(lang, 'موقع المشروع', 'Project location', 'Emplacement du projet'),
      howToBook: pick(lang, 'كيف تسير العملية', 'How it works', 'Comment ça marche'),
      stepRows: pick(
        lang,
        ['راجع تفاصيل المشروع', 'سجّل الدخول أو أنشئ حساباً', 'تواصل مع البائع', 'نسّق الزيارة داخل SYBNB'],
        ['Review project details', 'Sign in or create account', 'Contact the seller', 'Coordinate the visit inside SYBNB'],
        ['Consultez le détail du projet', 'Connectez-vous ou créez un compte', 'Contactez le vendeur', 'Organisez la visite dans SYBNB'],
      ),
    },
  }
  return { ...fallback, ...(detailCopy[division] || {}) }
}

function customerGateKey(listingId: string) {
  return `${CUSTOMER_GATE_KEY}:${listingId}`
}

function bookingDraftKey(listingId: string) {
  return `sybnb-v6-booking-draft:${listingId}`
}

type BookingDraft = {
  dateRange: DateRange
  cancellationProtection: boolean
  acceptedGuestAgreement: boolean
}

function loadBookingDraft(listingId: string): Partial<BookingDraft> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(bookingDraftKey(listingId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function clearBookingDraft(listingId: string) {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(bookingDraftKey(listingId))
}

function readListingReturnPath() {
  if (typeof window === 'undefined') return '/stays'
  try {
    return sessionStorage.getItem('sybnb-v6-listing-return-path') || '/stays'
  } catch {
    return '/stays'
  }
}

// Scoped to this page while it is mounted: the global breadcrumb bar is translucent and the listing
// (photos, tabs) showed through it while scrolling. A permanent fix belongs in global.css.
const LISTING_PAGE_CSS = `
.flow-step-nav { background: #0d1222 !important; -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: 0 8px 24px rgba(0, 0, 0, .45); z-index: 30; }
#listing-booking { scroll-margin-top: 150px; }
`

function goToAccountAndBack(listingId: string) {
  if (typeof window === 'undefined') return
  // /account/open/:id makes GuestAccountPage return to /listing/:id after sign-in; the stored
  // return path is a fallback for any account screen that reads it instead.
  try {
    sessionStorage.setItem(GUEST_RETURN_PATH_KEY, `/listing/${listingId}`)
  } catch {
    // storage unavailable: the /account/open/:id route still carries the listing id
  }
  window.location.hash = `/account/open/${listingId}`
}

const DIVISION_PATHS: Record<string, string> = {
  STAYS: '/stays',
  RENTALS: '/rentals',
  BUY: '/buy',
  CARS: '/cars',
  MARKETPLACE: '/marketplace',
  NEW_CONSTRUCTION: '/new-construction',
}

// The breadcrumb (AppShell) and the account page derive their section from the stored listing
// return path. When the listing was opened directly (shared link) or from another division's page,
// that path is missing or names the wrong section (e.g. "Short-term rental" on a car). Align it with
// this listing's division; a non-division return path such as a search-results page is kept.
function syncListingReturnPath(division: string) {
  if (typeof window === 'undefined') return
  const target = DIVISION_PATHS[division]
  if (!target) return
  try {
    const stored = sessionStorage.getItem('sybnb-v6-listing-return-path') || ''
    const storedDivisionPath = Object.values(DIVISION_PATHS).find((path) => stored === path || stored.startsWith(`${path}?`) || stored.startsWith(`${path}/`))
    if (!stored || (storedDivisionPath && storedDivisionPath !== target)) {
      sessionStorage.setItem('sybnb-v6-listing-return-path', target)
    }
  } catch {
    // storage unavailable: breadcrumb falls back to its default
  }
}

function priceUnitText(division: string, lang: Lang) {
  if (division === 'STAYS') return pick(lang, 'ليلة', 'night', 'nuit')
  if (division === 'RENTALS') return pick(lang, 'شهر', 'month', 'mois')
  return ''
}

function nightsWord(count: number, lang: Lang) {
  if (lang === 'ar') return count === 1 ? 'ليلة' : count === 2 ? 'ليلتان' : 'ليالٍ'
  if (lang === 'fr') return count > 1 ? 'nuits' : 'nuit'
  return count === 1 ? 'night' : 'nights'
}

function accountHintText(division: string, lang: Lang) {
  if (division === 'STAYS') return copy[lang].requestOnlyAfterAccount
  if (division === 'RENTALS') {
    return pick(lang, 'افتح حسابك أو سجّل الدخول أولاً، ثم تواصل مع المالك.', 'Open an account or sign in first, then contact the owner.', 'Ouvrez un compte ou connectez-vous d’abord, puis contactez le propriétaire.')
  }
  return pick(lang, 'افتح حسابك أو سجّل الدخول أولاً، ثم تواصل مع البائع.', 'Open an account or sign in first, then contact the seller.', 'Ouvrez un compte ou connectez-vous d’abord, puis contactez le vendeur.')
}

const ARABIC_RE = /[؀-ۿ]/

// The map capsule label mixes Arabic and Latin address parts and has no French text; keep only the
// parts written in the reader's script (falling back to whatever exists). Nothing is invented.
function localizedPlaceLabel(target: GoogleMapTarget | null, lang: Lang) {
  if (!target) return ''
  if (!target.hasRealLocation) {
    return target.hasCoordinates
      ? pick(lang, 'موقع محدد على الخريطة', 'Pinned location', 'Emplacement épinglé sur la carte')
      : pick(lang, 'لم يتم تحديد الموقع', 'Location not provided', 'Emplacement non précisé')
  }
  const parts = target.label.split(/\s*[،,]\s*/).filter(Boolean)
  const arabic = parts.filter((part) => ARABIC_RE.test(part))
  const latin = parts.filter((part) => !ARABIC_RE.test(part))
  const chosen = lang === 'ar' ? (arabic.length ? arabic : latin) : latin.length ? latin : arabic
  return Array.from(new Set(chosen)).join(lang === 'ar' ? '، ' : ', ')
}

// Terms tab: the cancellation policy for bookable stays, or a clear per-division note for
// contact-only divisions. Only restates rules that already exist in the product (cancellation
// windows from cancellationPolicy.ts, contact-only divisions never transact through SYBNB).
function TermsPanel({
  listing,
  lang,
  checkIn,
  agreementTitle,
  agreementVersionLabel,
}: {
  listing: PlatformListing
  lang: Lang
  checkIn: string
  agreementTitle: string
  agreementVersionLabel: string
}) {
  const md = listing.metadata || {}
  const houseRules = typeof md.houseRules === 'string' && md.houseRules.trim()
    ? md.houseRules.trim()
    : Array.isArray(md.houseRules)
      ? md.houseRules.filter((rule): rule is string => typeof rule === 'string' && rule.trim().length > 0).join(' · ')
      : ''
  const division = listing.division
  const note =
    division === 'RENTALS'
      ? pick(
          lang,
          'شروط الإيجار (المدة، التأمين، مواعيد الدفع) يتم الاتفاق عليها مباشرة مع المالك عبر رسائل SYBNB. لا يتم أي دفع عبر SYBNB لهذا الإعلان.',
          'Rental terms (duration, deposit, payment schedule) are agreed directly with the owner through SYBNB messages. No payment is made through SYBNB for this listing.',
          'Les conditions de location (durée, dépôt, échéancier de paiement) se conviennent directement avec le propriétaire via la messagerie SYBNB. Aucun paiement ne passe par SYBNB pour cette annonce.',
        )
      : division === 'STAYS'
        ? ''
        : pick(
            lang,
            'السعر وشروط البيع يتم الاتفاق عليها مباشرة مع البائع عبر رسائل SYBNB. لا يتم أي دفع عبر SYBNB لهذا الإعلان.',
            'Price and sale terms are agreed directly with the seller through SYBNB messages. No payment is made through SYBNB for this listing.',
            'Le prix et les conditions de vente se conviennent directement avec le vendeur via la messagerie SYBNB. Aucun paiement ne passe par SYBNB pour cette annonce.',
          )

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {division === 'STAYS' ? (
        <>
          <article style={styles.info}>
            <span>{pick(lang, 'سياسة الإلغاء', 'Cancellation policy', 'Politique d’annulation')}</span>
            <strong>{pick(lang, 'السعر العادي', 'Standard rate', 'Tarif standard')}{lang === 'fr' ? ' : ' : ': '}{cancellationRuleText(false, lang)}</strong>
            <strong>{pick(lang, 'السعر المحمي', 'Protected rate', 'Tarif protégé')}{lang === 'fr' ? ' : ' : ': '}{cancellationRuleText(true, lang)}</strong>
          </article>
          <article style={styles.info}>
            <span>{pick(lang, 'الدفع', 'Payment', 'Paiement')}</span>
            <strong>
              {pick(
                lang,
                `الدفع داخل SYBNB فقط. يتم قبول «${agreementTitle}» (${agreementVersionLabel}) عند إرسال طلب الحجز.`,
                `Payment happens only inside SYBNB. The “${agreementTitle}” (${agreementVersionLabel}) is accepted when you send the booking request.`,
                `Le paiement s’effectue uniquement dans SYBNB. Le « ${agreementTitle} » (${agreementVersionLabel}) est accepté à l’envoi de la demande de réservation.`,
              )}
            </strong>
          </article>
        </>
      ) : (
        <article style={styles.info}>
          <span>{pick(lang, 'الشروط', 'Terms', 'Conditions')}</span>
          <strong>{note}</strong>
        </article>
      )}
      <article style={styles.info}>
        <span>{division === 'STAYS' ? pick(lang, 'قواعد الإقامة', 'House rules', 'Règlement intérieur') : pick(lang, 'ملاحظات البائع', 'Seller notes', 'Notes du vendeur')}</span>
        <strong>{houseRules || pick(lang, 'لم يضف المعلن قواعد إضافية.', 'The lister has not added extra rules.', 'L’annonceur n’a pas ajouté de règles particulières.')}</strong>
      </article>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  galleryArrow: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 2, width: 46, height: 46, border: 0, borderRadius: 999, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 30, fontWeight: 900, display: 'grid', placeItems: 'center', cursor: 'pointer' },
  galleryCounter: { position: 'absolute', top: 18, insetInlineEnd: 18, zIndex: 2, borderRadius: 999, background: 'rgba(0,0,0,.55)', color: '#fff', padding: '6px 10px', fontSize: 13, fontWeight: 800 },
  priceBlock: { border: '1px solid #30384d', borderRadius: 12, background: '#151620', padding: 16, display: 'grid', gap: 6, justifyItems: 'center', textAlign: 'center' },
  priceHeadline: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  priceAmount: { fontSize: 28, fontWeight: 950, color: '#fff' },
  priceUnit: { color: '#9aa6ba', fontWeight: 800, fontSize: 16 },
  priceSub: { color: '#c8cede', fontWeight: 700 },
  ratingLine: { color: '#9aa6ba', fontWeight: 700 },
  placeText: { color: '#fff', fontWeight: 800 },
  bookingBlock: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 16, display: 'grid', gap: 14 },
  bottomPrice: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', minWidth: 0, color: '#9aa6ba', fontWeight: 800 },
  primaryButtonCompact: { minHeight: 44, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 16px', whiteSpace: 'nowrap' },
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '24px 16px 112px', display: 'grid', gap: 16, maxWidth: 1080, margin: '0 auto' },
  detailHero: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', minHeight: 330, overflow: 'hidden', position: 'relative' },
  heroIconButton: { position: 'absolute', top: 18, insetInlineStart: 18, zIndex: 2, width: 52, height: 52, border: 0, borderRadius: 999, background: 'rgba(0,0,0,.42)', color: '#fff', fontSize: 28, fontWeight: 900, display: 'grid', placeItems: 'center', backdropFilter: 'blur(10px)' },
  media: { minHeight: 330, background: '#0b1120', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 950, textTransform: 'uppercase', position: 'relative', overflow: 'hidden' },
  mediaImage: { width: '100%', height: '100%', minHeight: 330, objectFit: 'cover', display: 'block' },
  thumbStrip: { position: 'absolute', left: 0, right: 0, bottom: 8, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', padding: '0 8px' },
  thumb: { width: 56, height: 42, borderRadius: 8, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.5)', padding: 0, cursor: 'pointer', background: 'transparent' },
  thumbActive: { width: 56, height: 42, borderRadius: 8, overflow: 'hidden', border: '2px solid #6f86ff', padding: 0, cursor: 'pointer', background: 'transparent' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  mediaBadge: { position: 'absolute', insetInlineStart: 14, bottom: 14, borderRadius: 999, background: 'rgba(8,9,15,.78)', border: '1px solid rgba(255,255,255,.18)', padding: '8px 12px', backdropFilter: 'blur(12px)' },
  instantBookBadge: { position: 'absolute', insetInlineStart: 14, top: 14, borderRadius: 999, background: 'rgba(213,169,21,.9)', color: '#1a1400', fontWeight: 950, border: '1px solid rgba(255,255,255,.25)', padding: '8px 12px', backdropFilter: 'blur(12px)' },
  detailBody: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 20, display: 'grid', gap: 18 },
  titleBlock: { display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' },
  locationLine: { color: '#9aa6ba', fontWeight: 800 },
  tabRow: { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  tab: { minHeight: 42, border: 0, borderRadius: 999, background: '#20212b', color: '#c8cede', padding: '0 18px', fontWeight: 900 },
  tabActive: { minHeight: 42, border: '1px solid #5268ff', borderRadius: 999, background: '#5268ff', color: '#fff', padding: '0 18px', fontWeight: 950 },
  tabPanel: { display: 'grid', gap: 14 },
  bookingSteps: { display: 'grid', gap: 10 },
  bookingStep: { display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr)', alignItems: 'center', gap: 10, color: '#9aa6ba' },
  instantBookNote: { border: '1px solid rgba(213,169,21,.35)', borderRadius: 8, background: 'rgba(213,169,21,.08)', color: '#d5a915', padding: 12, fontWeight: 700 },
  demoBadge: { justifySelf: 'center', border: '1px solid rgba(229,184,11,.55)', borderRadius: 999, background: 'rgba(229,184,11,.12)', color: '#ffe9a6', padding: '6px 14px', fontWeight: 900, textAlign: 'center' },
  demoNotice: { border: '1px solid rgba(229,184,11,.55)', borderRadius: 10, background: 'rgba(229,184,11,.1)', color: '#ffe9a6', padding: 16, display: 'grid', gap: 10, lineHeight: 1.6 },
  sentPanel: { border: '1px solid rgba(32,210,155,.5)', borderRadius: 12, background: 'rgba(32,210,155,.08)', color: '#fff', padding: 16, display: 'grid', gap: 10, lineHeight: 1.6 },
  sentTitle: { fontSize: 18, color: '#b7ffe8' },
  sentSteps: { margin: 0, paddingInlineStart: 20, display: 'grid', gap: 4, color: '#dfe5ff' },
  sentActions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  accountHint: { border: '1px solid rgba(82,104,255,.45)', borderRadius: 8, background: 'rgba(82,104,255,.1)', color: '#dfe5ff', padding: 12, fontWeight: 900 },
  heroContent: { padding: 18, display: 'grid', gap: 12, alignContent: 'center' },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 'clamp(26px, 6vw, 42px)', lineHeight: 1.1 },
  body: { color: '#9aa6ba', lineHeight: 1.65, margin: 0 },
  actions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  secondaryLinkButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px', display: 'grid', placeItems: 'center', textDecoration: 'none' },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' },
  trustGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  trustCard: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.08)', padding: 14, display: 'grid', gap: 8 },
  stepsPanel: { border: '1px solid rgba(213,169,21,.4)', borderRadius: 8, background: 'rgba(213,169,21,.08)', padding: 14, display: 'grid', gap: 12 },
  accountGate: { border: '1px solid rgba(80,105,255,.55)', borderRadius: 8, background: 'rgba(80,105,255,.1)', padding: 16, display: 'grid', gap: 14 },
  secureGateGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  secureInput: { minHeight: 48, border: '1px solid #30384d', borderRadius: 8, background: '#0d1320', color: '#fff', padding: '0 12px', fontWeight: 800 },
  secureError: { color: '#ffabab', fontSize: 13 },
  protectionChoice: { border: '1px solid rgba(213,169,21,.5)', borderRadius: 8, background: 'rgba(213,169,21,.08)', padding: 14, display: 'grid', gap: 12 },
  dateFieldsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  mapPanel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 12 },
  mapCanvas: { minHeight: 260, border: '1px solid rgba(82,104,255,.4)', borderRadius: 8, background: '#0c1220', display: 'grid', placeItems: 'center', color: '#fff', overflow: 'hidden', position: 'relative' },
  mapFrame: { border: 0, filter: 'saturate(.86) contrast(.9)', height: '100%', inset: 0, minHeight: 260, opacity: .74, position: 'absolute', width: '100%' },
  mapPin: { borderRadius: 999, background: '#5268ff', color: '#fff', padding: '10px 14px', fontWeight: 950, boxShadow: '0 0 0 10px rgba(82,104,255,.16)' },
  mapLocationCard: { borderRadius: 8, background: 'rgba(6,10,18,.88)', border: '1px solid rgba(255,255,255,.16)', padding: 18, display: 'grid', gap: 12, placeItems: 'center', textAlign: 'center', minWidth: 260, maxWidth: '88%', position: 'relative', zIndex: 1 },
  offlineMapCard: { alignItems: 'center', border: '1px solid rgba(229,184,11,.45)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', padding: 14 },
  offlineMapReady: { alignItems: 'center', border: '1px solid rgba(32,210,155,.5)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#9fffe1', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', padding: 14 },
  offlineMapButton: { minHeight: 44, border: '1px solid rgba(229,184,11,.7)', borderRadius: 8, background: '#171b29', color: '#f7d45f', fontWeight: 950, padding: '0 14px' },
  offlineMapSavedButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 18px' },
  protectionOptions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  protectionOption: { minHeight: 118, border: '1px solid #30384d', borderRadius: 8, background: '#0d1320', color: '#fff', padding: 14, textAlign: 'start', display: 'grid', gap: 8 },
  protectionOptionActive: { minHeight: 118, border: '1px solid #20d29b', borderRadius: 8, background: 'rgba(32,210,155,.12)', color: '#fff', padding: 14, textAlign: 'start', display: 'grid', gap: 8 },
  cancellationCutoff: { color: '#20d29b', fontStyle: 'normal', fontWeight: 800, fontSize: 13 },
  feesIncludedNote: { color: '#82899b', fontWeight: 700, fontSize: 12 },
  feeBreakdownRow: { display: 'flex', flexWrap: 'wrap', gap: '4px 16px', color: '#a5adc2', fontSize: 12, fontWeight: 700, padding: '2px 2px 0' },
  agreementBox: { border: '1px solid rgba(229,184,11,.58)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', padding: 14, display: 'grid', gap: 12, gridTemplateColumns: '34px minmax(0, 1fr)', alignItems: 'start', lineHeight: 1.5 },
  agreementInput: { width: 28, height: 28, accentColor: '#20d29b', margin: 0 },
  info: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 6, color: '#9aa6ba' },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#fff', padding: 14, display: 'grid', gap: 12 },
  recoverPrimary: { minHeight: 46, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 900, padding: '0 18px', cursor: 'pointer' },
  recoverSecondary: { minHeight: 46, border: '1px solid #30384d', borderRadius: 8, background: 'transparent', color: '#fff', fontWeight: 800, padding: '0 18px', cursor: 'pointer' },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  // Compact: one row (price + primary action), ~70px tall, so it never hides much of the listing.
  bottomActionBar: { position: 'sticky', bottom: 12, zIndex: 20, border: '1px solid #242a3b', borderRadius: 8, background: '#0d0f18', boxShadow: '0 -10px 30px rgba(0,0,0,.35)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
}

// Airbnb-style "Hosted by" card: photo, name, city, member-since, languages, about. Loads the
// host's public profile once (GET /api/host-profiles/:id); falls back to the plain name.
function HostCard({
  lang,
  ownerId,
  fallbackName,
  profile,
  onLoad,
}: {
  lang: Lang
  ownerId: string
  fallbackName: string
  profile: HostProfile | null
  onLoad: (profile: HostProfile | null) => void
}) {
  const isAr = lang === 'ar'
  useEffect(() => {
    if (profile) return
    let alive = true
    fetchPublicHostProfile(ownerId)
      .then((p) => alive && onLoad(p))
      .catch(() => alive && onLoad(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId])
  const name = profile?.displayName || fallbackName
  const meta = [
    profile?.city || '',
    profile?.memberSince ? pick(lang, `على SYBNB منذ ${profile.memberSince}`, `On SYBNB since ${profile.memberSince}`, `Sur SYBNB depuis ${profile.memberSince}`) : '',
  ].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: '#1d2332', display: 'grid', placeItems: 'center', overflow: 'hidden', fontWeight: 900, flexShrink: 0 }}>
          {profile?.photoUrl ? <img src={profile.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <strong>{name}</strong>
          {meta ? <div style={{ color: '#9aa6ba', fontSize: 13 }}>{meta}</div> : null}
        </div>
      </div>
      {profile?.languages?.length ? (
        <span style={{ color: '#cfd6ea', fontSize: 14 }}>
          {pick(lang, 'يتحدث: ', 'Speaks: ', 'Langues parlées : ')}
          {profile.languages.map((code) => languageName(code, lang)).join(isAr ? '، ' : ', ')}
        </span>
      ) : null}
      {profile?.about ? <p style={{ margin: 0, color: '#cfd6ea', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{profile.about}</p> : null}
    </div>
  )
}

function languageName(code: string, lang: Lang) {
  const names: Record<string, [string, string, string]> = {
    ar: ['العربية', 'Arabic', 'Arabe'], en: ['الإنجليزية', 'English', 'Anglais'], fr: ['الفرنسية', 'French', 'Français'], ku: ['الكردية', 'Kurdish', 'Kurde'],
    tr: ['التركية', 'Turkish', 'Turc'], de: ['الألمانية', 'German', 'Allemand'], es: ['الإسبانية', 'Spanish', 'Espagnol'], ru: ['الروسية', 'Russian', 'Russe'],
    fa: ['الفارسية', 'Persian', 'Persan'], hy: ['الأرمنية', 'Armenian', 'Arménien'], it: ['الإيطالية', 'Italian', 'Italien'], sv: ['السويدية', 'Swedish', 'Suédois'],
  }
  const pair = names[code]
  return pair ? pick(lang, pair[0], pair[1], pair[2]) : code
}
