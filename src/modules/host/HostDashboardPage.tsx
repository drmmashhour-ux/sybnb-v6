import { useEffect, useMemo, useState } from 'react'
import { localeForLang } from '../../shared/country/presentation'
import type { CSSProperties, ReactNode } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  decidePrototypeHostRequest,
  deletePrototypeHostListing,
  fetchPrototypeHostEarnings,
  fetchPrototypeHostOverview,
  markHostGuestCheckpoint,
  submitHostIdDocument,
  updatePrototypeHostInstantBook,
  updatePrototypeHostListingStatus,
  type HostDashboardMode,
  type PlatformHostEarnings,
  type PlatformHostOverview,
  type PlatformListing,
} from '../../shared/api/platformApi'
import { hostInventoryFilterGroups, type VisualFilterSelection } from '../../engines/filters'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { divisionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'
import { HostAvailabilityCalendar } from './HostAvailabilityCalendar'
import { HostVerificationCard } from './HostVerificationCard'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
  focus?: ProviderFocus
}

type ProviderFocus = 'stays' | 'cars' | 'newConstruction' | 'marketplace'

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'لوحة البائع والمضيف',
    staysTitle: 'لوحة استضافة الإيجار اليومي',
    staysSubtitle: 'استضافاتك اليومية، طلبات الضيوف، الصور، خيارات الضيوف، والدفع المحمي.',
    carsTitle: 'لوحة بائع المركبات',
    carsSubtitle: 'سياراتك، طلبات العملاء، ملفات المركبة، الصور، والدفع المحمي.',
    newConstructionTitle: 'لوحة المطور العقاري',
    newConstructionSubtitle: 'مشاريعك الجديدة، طلبات الزيارة، وثائق المشروع، وخطة النشر.',
    marketplaceTitle: 'لوحة بائع السوق',
    marketplaceSubtitle: 'منتجاتك، طلبات العملاء، الصور، والتسليم المحمي.',
    subtitle: 'إعلاناتك وطلبات العملاء مباشرة من قاعدة البيانات.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    error: 'تعذر تحميل لوحة البائع',
    listings: 'الإعلانات',
    hosting: 'الاستضافات',
    approved: 'منشور',
    pending: 'قيد المراجعة',
    requests: 'الطلبات',
    requested: 'بانتظار القرار',
    confirmed: 'مؤكد',
    revenue: 'إيراد مؤكد',
    inventory: 'العقارات المعروضة',
    hostingInventory: 'العقارات المعروضة',
    inbox: 'حجوزات العملاء',
    empty: 'لا توجد عناصر بعد.',
    price: 'السعر',
    status: 'الحالة',
    guest: 'الضيف',
    division: 'القسم',
    view: 'عرض الإعلان',
    details: 'تفاصيل الطلب',
    pause: 'إيقاف مؤقت',
    resume: 'إعادة نشر',
    manageCalendar: 'تقويم الحجوزات المتوفرة',
    hideCalendar: 'إخفاء التقويم',
    instantBookOn: '⚡ الحجز الفوري: مفعّل',
    instantBookOff: 'تفعيل الحجز الفوري',
    expiresOn: 'ينتهي الإعلان في',
    confirm: 'تأكيد',
    cancel: 'إلغاء',
    saving: 'جار الحفظ',
    filters: 'خيارات المضيف',
    filtersHint: 'نفس رموز البحث للبائع والمضيف.',
    staysFiltersHint: 'هذه الرموز تظهر للضيف عند البحث عن الاستضافة.',
    carsFiltersHint: 'هذه الرموز تظهر للعميل عند البحث عن المركبات فقط.',
    newConstructionFiltersHint: 'هذه الرموز تظهر للعميل عند البحث عن المشاريع الجديدة فقط.',
    marketplaceFiltersHint: 'هذه الرموز تظهر للعميل عند البحث في السوق فقط.',
    providerHealth: 'صحة المزود',
    hostDashboard: 'لوحة المضيف',
    carSellerDashboard: 'لوحة بائع المركبات',
    builderDashboard: 'لوحة المطور العقاري',
    marketplaceSellerDashboard: 'لوحة بائع السوق',
    verifiedHost: 'مضيف موثوق',
    verifiedCarSeller: 'بائع مركبات موثوق',
    verifiedBuilder: 'مطور عقاري موثوق',
    verifiedMarketplaceSeller: 'بائع موثوق',
    pendingVerification: 'التوثيق قيد المراجعة',
    notVerifiedYet: 'غير موثق بعد',
    healthDegree: 'درجة الصحة',
    viewEarningsReport: 'عرض تقرير الأرباح',
    views: 'ظهور إعلانك',
    bookingsImpact: 'زيادة الحجوزات',
    slaMaintenance: 'الحفاظ على SLA',
    activeListings: 'الإعلانات النشطة',
    createNewListing: 'إضافة إعلان جديد',
    activeCars: 'المركبات النشطة',
    activeProjects: 'المشاريع النشطة',
    activeProducts: 'المنتجات النشطة',
    inquiries: 'استفسارات',
    listingViews: 'مشاهدات',
    quality: 'الجودة',
    action: 'إجراء',
    paymentState: 'حالة المدفوعات',
    profitLog: 'سجل الأرباح',
    trustCenter: 'مركز الثقة',
    opsSupport: 'دعم العمليات',
    clientMessages: 'رسائل العملاء',
    qualityScore: 'جودة الإعلانات',
    payoutReady: 'جاهز للصرف',
    responseSla: 'سرعة الرد',
    aiImprove: 'تحسين AI',
    aiImproveCopy: 'أضف صور أقوى، شارة الثقة، وسياسة إلغاء واضحة لرفع التحويل.',
    openFinance: 'فتح المالية',
    openOperations: 'فتح العمليات',
    trustBadge: 'شارة الثقة',
    protection: 'حماية الطلبات',
    termsTitle: 'شروط حماية SYBNB',
    termsCopy: 'أتعهد بصحة الإعلان، جاهزية الاستضافة، احترام السعر والحجز، عدم طلب دفع خارجي، والالتزام بسياسة الإلغاء والنزاع.',
    termsRequired: 'يجب قبول شروط SYBNB قبل تأكيد الحجز.',
    markCheckedIn: 'تأكيد وصول الضيف',
    markCheckedOut: 'تأكيد مغادرة الضيف',
    checkedInAt: 'وصل الضيف',
    checkedOutAt: 'غادر الضيف',
    finalStamp: 'نهائي · مسار الاستضافة مؤكد · الحجز والدفع والصرف محمي',
    finalLock: 'تم إغلاق صفحة المضيف كنسخة نهائية: المضيف موثوق، الطلبات محمية، والصرف لا يتم إلا بعد تأكيد الإدارة.',
    bookingVerified: 'الحجز مؤكد',
    paymentVerified: 'الدفع مقبول',
    rulesVerified: 'شروط المضيف مقبولة',
    payoutProtected: 'الصرف محمي',
    currentListings: '٣ إعلانات حاليا',
    addPhotos: 'أضف ٤ صور إضافية لتحسين ظهور إعلانك',
    updatePolicy: 'حدث سياسة الإلغاء لزيادة الثقة',
    replyFaster: 'أجب على الاستفسارات بشكل أسرع للحفاظ على SLA',
    apply: 'تطبيق',
  },
  en: {
    back: 'Back to landing',
    title: 'Seller / Host Dashboard',
    staysTitle: 'Daily Hosting Dashboard',
    staysSubtitle: 'Your daily hosting stays, guest requests, photos, filters, and protected payments.',
    carsTitle: 'Vehicle Seller Dashboard',
    carsSubtitle: 'Your cars, customer requests, vehicle files, photos, and protected payments.',
    newConstructionTitle: 'Developer Dashboard',
    newConstructionSubtitle: 'Your new projects, visit requests, project documents, and publishing plan.',
    marketplaceTitle: 'Marketplace Seller Dashboard',
    marketplaceSubtitle: 'Your products, customer requests, photos, and protected fulfillment.',
    subtitle: 'Your listings and customer requests directly from PostgreSQL.',
    refresh: 'Refresh',
    loading: 'Loading',
    error: 'Could not load seller dashboard',
    listings: 'Listings',
    hosting: 'Hosting',
    approved: 'Approved',
    pending: 'Pending review',
    requests: 'Requests',
    requested: 'Waiting decision',
    confirmed: 'Confirmed',
    revenue: 'Confirmed revenue',
    inventory: 'Listing inventory',
    hostingInventory: 'Hosting inventory',
    inbox: 'Customer requests',
    empty: 'No items yet.',
    price: 'Price',
    status: 'Status',
    guest: 'Guest',
    division: 'Division',
    view: 'View listing',
    details: 'Request details',
    pause: 'Pause',
    resume: 'Resume',
    manageCalendar: 'Availability calendar',
    hideCalendar: 'Hide calendar',
    instantBookOn: '⚡ Instant Book: On',
    instantBookOff: 'Enable Instant Book',
    expiresOn: 'Listing expires on',
    confirm: 'Confirm',
    cancel: 'Cancel',
    saving: 'Saving',
    filters: 'Inventory filters',
    filtersHint: 'Same search symbols for seller and host.',
    staysFiltersHint: 'These symbols appear to guests when they search hosting stays.',
    carsFiltersHint: 'These symbols appear to clients when they search cars only.',
    newConstructionFiltersHint: 'These symbols appear to clients when they search new projects only.',
    marketplaceFiltersHint: 'These symbols appear to clients when they search marketplace only.',
    providerHealth: 'Provider health',
    hostDashboard: 'Host Dashboard',
    carSellerDashboard: 'Vehicle Seller Dashboard',
    builderDashboard: 'Developer Dashboard',
    marketplaceSellerDashboard: 'Marketplace Seller Dashboard',
    verifiedHost: 'Verified host',
    verifiedCarSeller: 'Verified vehicle seller',
    verifiedBuilder: 'Verified developer',
    verifiedMarketplaceSeller: 'Verified seller',
    pendingVerification: 'Verification in review',
    notVerifiedYet: 'Not verified yet',
    healthDegree: 'Health score',
    viewEarningsReport: 'View earnings report',
    views: 'Listing visibility',
    bookingsImpact: 'More bookings',
    slaMaintenance: 'SLA maintenance',
    activeListings: 'Active listings',
    createNewListing: 'Create new listing',
    activeCars: 'Active cars',
    activeProjects: 'Active projects',
    activeProducts: 'Active products',
    inquiries: 'Inquiries',
    listingViews: 'Views',
    quality: 'Quality',
    action: 'Action',
    paymentState: 'Payment status',
    profitLog: 'Profit log',
    trustCenter: 'Trust Center',
    opsSupport: 'Operations support',
    clientMessages: 'Client messages',
    qualityScore: 'Listing quality',
    payoutReady: 'Payout ready',
    responseSla: 'Response SLA',
    aiImprove: 'AI improvements',
    aiImproveCopy: 'Add stronger photos, trust badge, and clear cancellation policy to raise conversion.',
    openFinance: 'Open finance',
    openOperations: 'Open operations',
    trustBadge: 'Trust badge',
    protection: 'Request protection',
    termsTitle: 'SYBNB protection rules',
    termsCopy: 'I confirm the listing is accurate, the stay is ready, the price and booking will be honored, no outside payment will be requested, and cancellation/dispute rules apply.',
    termsRequired: 'You must accept SYBNB rules before confirming the booking.',
    markCheckedIn: 'Mark guest checked in',
    markCheckedOut: 'Mark guest checked out',
    checkedInAt: 'Guest checked in',
    checkedOutAt: 'Guest checked out',
    finalStamp: 'FINAL · HOSTING TUNNEL VERIFIED · BOOKING PAYMENT PAYOUT PROTECTED',
    finalLock: 'Host page is locked as a final edition: verified host, protected requests, and payout only after admin confirmation.',
    bookingVerified: 'Booking confirmed',
    paymentVerified: 'Payment approved',
    rulesVerified: 'Host rules accepted',
    payoutProtected: 'Payout protected',
    currentListings: '3 active listings',
    addPhotos: 'Add 4 more photos to improve listing visibility',
    updatePolicy: 'Update cancellation policy to increase trust',
    replyFaster: 'Reply faster to keep SLA healthy',
    apply: 'Apply',
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'Tableau de bord vendeur / hôte',
    staysTitle: 'Tableau de bord des séjours',
    staysSubtitle: 'Vos séjours, demandes des voyageurs, photos, filtres et paiements protégés.',
    carsTitle: 'Tableau de bord vendeur de véhicules',
    carsSubtitle: 'Vos véhicules, demandes des clients, dossiers des véhicules, photos et paiements protégés.',
    newConstructionTitle: 'Tableau de bord promoteur',
    newConstructionSubtitle: 'Vos nouveaux projets, demandes de visite, documents du projet et plan de publication.',
    marketplaceTitle: 'Tableau de bord vendeur Marketplace',
    marketplaceSubtitle: 'Vos produits, demandes des clients, photos et livraison protégée.',
    subtitle: 'Vos annonces et demandes des clients, directement depuis la base de données.',
    refresh: 'Actualiser',
    loading: 'Chargement',
    error: 'Impossible de charger le tableau de bord vendeur',
    listings: 'Annonces',
    hosting: 'Hébergement',
    approved: 'Approuvée',
    pending: 'En cours de vérification',
    requests: 'Demandes',
    requested: 'En attente de décision',
    confirmed: 'Confirmée',
    revenue: 'Revenus confirmés',
    inventory: 'Inventaire des annonces',
    hostingInventory: 'Inventaire des logements',
    inbox: 'Demandes des clients',
    empty: 'Aucun élément pour le moment.',
    price: 'Prix',
    status: 'Statut',
    guest: 'Voyageur',
    division: 'Catégorie',
    view: 'Voir l’annonce',
    details: 'Détails de la demande',
    pause: 'Suspendre',
    resume: 'Republier',
    manageCalendar: 'Calendrier des disponibilités',
    hideCalendar: 'Masquer le calendrier',
    instantBookOn: '⚡ Réservation instantanée : activée',
    instantBookOff: 'Activer la réservation instantanée',
    expiresOn: 'L’annonce expire le',
    confirm: 'Confirmer',
    cancel: 'Annuler',
    saving: 'Enregistrement',
    filters: 'Filtres de l’inventaire',
    filtersHint: 'Mêmes symboles de recherche pour le vendeur et l’hôte.',
    staysFiltersHint: 'Ces symboles s’affichent aux voyageurs lorsqu’ils recherchent un séjour.',
    carsFiltersHint: 'Ces symboles s’affichent aux clients uniquement lorsqu’ils recherchent des véhicules.',
    newConstructionFiltersHint: 'Ces symboles s’affichent aux clients uniquement lorsqu’ils recherchent de nouveaux projets.',
    marketplaceFiltersHint: 'Ces symboles s’affichent aux clients uniquement lorsqu’ils recherchent sur la Marketplace.',
    providerHealth: 'Santé du fournisseur',
    hostDashboard: 'Tableau de bord hôte',
    carSellerDashboard: 'Tableau de bord vendeur de véhicules',
    builderDashboard: 'Tableau de bord promoteur',
    marketplaceSellerDashboard: 'Tableau de bord vendeur Marketplace',
    verifiedHost: 'Hôte vérifié',
    verifiedCarSeller: 'Vendeur de véhicules vérifié',
    verifiedBuilder: 'Promoteur vérifié',
    verifiedMarketplaceSeller: 'Vendeur vérifié',
    pendingVerification: 'Vérification en cours',
    notVerifiedYet: 'Pas encore vérifié',
    healthDegree: 'Indice de santé',
    viewEarningsReport: 'Voir le rapport des revenus',
    views: 'Visibilité de l’annonce',
    bookingsImpact: 'Plus de réservations',
    slaMaintenance: 'Maintien du délai de réponse',
    activeListings: 'Annonces actives',
    createNewListing: 'Créer une annonce',
    activeCars: 'Véhicules actifs',
    activeProjects: 'Projets actifs',
    activeProducts: 'Produits actifs',
    inquiries: 'Demandes',
    listingViews: 'Vues',
    quality: 'Qualité',
    action: 'Action',
    paymentState: 'Statut du paiement',
    profitLog: 'Journal des revenus',
    trustCenter: 'Centre de confiance',
    opsSupport: 'Soutien aux opérations',
    clientMessages: 'Messages des clients',
    qualityScore: 'Qualité des annonces',
    payoutReady: 'Prêt pour le versement',
    responseSla: 'Délai de réponse',
    aiImprove: 'Améliorations IA',
    aiImproveCopy: 'Ajoutez de meilleures photos, un badge de confiance et une politique d’annulation claire pour augmenter vos conversions.',
    openFinance: 'Ouvrir les finances',
    openOperations: 'Ouvrir les opérations',
    trustBadge: 'Badge de confiance',
    protection: 'Protection des demandes',
    termsTitle: 'Règles de protection SYBNB',
    termsCopy: 'Je confirme que l’annonce est exacte, que le logement est prêt, que le prix et la réservation seront respectés, qu’aucun paiement externe ne sera demandé et que les règles d’annulation et de litige s’appliquent.',
    termsRequired: 'Vous devez accepter les règles SYBNB avant de confirmer la réservation.',
    markCheckedIn: 'Confirmer l’arrivée du voyageur',
    markCheckedOut: 'Confirmer le départ du voyageur',
    checkedInAt: 'Arrivée du voyageur',
    checkedOutAt: 'Départ du voyageur',
    finalStamp: 'FINAL · PARCOURS D’HÉBERGEMENT VÉRIFIÉ · RÉSERVATION, PAIEMENT ET VERSEMENT PROTÉGÉS',
    finalLock: 'La page hôte est verrouillée en version finale : hôte vérifié, demandes protégées et versement uniquement après confirmation de l’administration.',
    bookingVerified: 'Réservation confirmée',
    paymentVerified: 'Paiement approuvé',
    rulesVerified: 'Règles de l’hôte acceptées',
    payoutProtected: 'Versement protégé',
    currentListings: '3 annonces actives',
    addPhotos: 'Ajoutez 4 photos de plus pour améliorer la visibilité de votre annonce',
    updatePolicy: 'Mettez à jour la politique d’annulation pour renforcer la confiance',
    replyFaster: 'Répondez plus vite aux demandes pour maintenir votre délai de réponse',
    apply: 'Appliquer',
  },
}

export function HostDashboardPage({ lang, mode = 'host', focus }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const isStaysHost = focus === 'stays'
  const providerCopy = getProviderCopy(t, lang, focus, mode)
  const [overview, setOverview] = useState<PlatformHostOverview | null>(null)
  const [earnings, setEarnings] = useState<PlatformHostEarnings | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'saving'>('loading')
  const [message, setMessage] = useState('')
  const [activeRequestId, setActiveRequestId] = useState('')
  const [activeListingId, setActiveListingId] = useState('')
  const [calendarListingId, setCalendarListingId] = useState('')
  const [acceptedRequestTerms, setAcceptedRequestTerms] = useState<Record<string, boolean>>({})
  const [hostDocumentFiles, setHostDocumentFiles] = useState<string[]>([])
  const [hostDocumentPendingFile, setHostDocumentPendingFile] = useState<File | null>(null)
  const [hostDocumentUploadStatus, setHostDocumentUploadStatus] = useState<'idle' | 'uploading' | 'error'>('idle')
  const [hostDocumentUploadError, setHostDocumentUploadError] = useState('')
  const [inventoryFilters, setInventoryFilters] = useState<VisualFilterSelection>({
    propertyType: 'any',
    roomType: 'any',
    bedType: 'any',
    amenities: [],
    trust: [],
  })

  useEffect(() => {
    void loadOverview()
  }, [mode])

  const visibleListings = useMemo(
    () => (overview?.listings.filter((listing) => matchesProviderFocus(listing, focus)) || []),
    [focus, overview?.listings],
  )
  const visibleRequests = useMemo(
    () => (overview?.requests.filter((request) => request.listing && matchesProviderFocus(request.listing, focus)) || []),
    [focus, overview?.requests],
  )
  const listingQualityScores = visibleListings.map((listing) => listingQualityScore(listing))
  const averageQualityScore = listingQualityScores.length
    ? Math.round(listingQualityScores.reduce((sum, score) => sum + score, 0) / listingQualityScores.length)
    : 0
  const approvedListingCount = visibleListings.filter((listing) => listing.status.toUpperCase() === 'APPROVED').length
  const confirmedRequestCount = visibleRequests.filter((request) => request.status.toUpperCase() === 'CONFIRMED').length
  const requestedRequestCount = visibleRequests.filter((request) => request.status.toUpperCase() === 'REQUESTED').length
  const listingApprovalScore = visibleListings.length ? Math.round((approvedListingCount / visibleListings.length) * 100) : 0
  const requestConfirmationScore = visibleRequests.length ? Math.round((confirmedRequestCount / visibleRequests.length) * 100) : 100
  const responseScore = visibleRequests.length ? clamp(100 - requestedRequestCount * 12 + confirmedRequestCount * 4, 45, 100) : 100
  const isDocumentVerified = overview?.host.idDocumentStatus === 'APPROVED'
  const isDocumentPendingReview = overview?.host.idDocumentStatus === 'PENDING_REVIEW'
  const trustScore = clamp(
    Math.round(listingApprovalScore * 0.45 + requestConfirmationScore * 0.35 + (isDocumentVerified ? 20 : isDocumentPendingReview ? 10 : 0)),
    0,
    100,
  )
  const healthScore = clamp(Math.round((trustScore + averageQualityScore + responseScore) / 3), 0, 100)
  const verificationStatusText = isDocumentVerified
    ? providerCopy.verifiedLabel
    : isDocumentPendingReview
      ? t.pendingVerification
      : t.notVerifiedYet
  const dashboardCurrency = visibleListings[0]?.currency || overview?.requests[0]?.currency || 'SYP'
  const activeListingsLabel = isAr
    ? `${visibleListings.length} ${providerCopy.activeUnit}`
    : `${visibleListings.length} ${providerCopy.activeUnit}`

  const hostDocumentsCopy = getHostDocumentsCopy(lang, focus)
    || pick(lang,
      {
        title: 'مستندات المضيف والاستضافة',
        help: 'ارفع الهوية، إثبات الملكية أو التفويض، صور العقار، وأي ترخيص مطلوب. الإدارة تراجعها قبل تفعيل الثقة والصرف.',
        cta: 'رفع مستندات المضيف',
        empty: 'لم يتم رفع مستندات بعد. أضف PDF أو PNG أو JPG.',
        send: 'إرسال المستندات للإدارة',
        sent: 'تم إرسال مستندات المضيف للإدارة',
      },
      {
        title: 'Host and hosting documents',
        help: 'Upload ID, ownership proof or authorization, property photos, and any required license. Admin reviews them before trust and payout are enabled.',
        cta: 'Upload host documents',
        empty: 'No host documents uploaded yet. Add PDF, PNG, or JPG.',
        send: 'Send documents to admin',
        sent: 'Host documents sent to admin',
      },
      {
        title: 'Documents de l’hôte et du logement',
        help: 'Téléversez votre pièce d’identité, une preuve de propriété ou une autorisation, des photos du logement et tout permis requis. L’administration les vérifie avant d’activer la confiance et les versements.',
        cta: 'Téléverser les documents de l’hôte',
        empty: 'Aucun document téléversé pour le moment. Ajoutez un PDF, PNG ou JPG.',
        send: 'Envoyer les documents à l’administration',
        sent: 'Documents de l’hôte envoyés à l’administration',
      })

  function addHostDocumentFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    // The backend stores exactly one ID document per user (server/routes/me.mjs), so only the most
    // recently selected file is ever actually uploaded — replace, not accumulate, so the displayed
    // file list never shows files as "added" that will silently never be sent.
    const file = files[files.length - 1]
    setHostDocumentFiles([file.name])
    setHostDocumentPendingFile(file)
    setHostDocumentUploadStatus('idle')
    setHostDocumentUploadError('')
  }

  async function sendHostDocuments() {
    if (!hostDocumentPendingFile) return
    setHostDocumentUploadStatus('uploading')
    setHostDocumentUploadError('')
    try {
      await submitHostIdDocument(hostDocumentPendingFile, mode)
      setHostDocumentFiles([])
      setHostDocumentPendingFile(null)
      setHostDocumentUploadStatus('idle')
      await loadOverview()
    } catch (error) {
      setHostDocumentUploadStatus('error')
      setHostDocumentUploadError(error instanceof Error ? error.message : t.error)
    }
  }

  async function loadOverview() {
    setStatus('loading')
    setMessage('')

    try {
      const [nextOverview, nextEarnings] = await Promise.all([
        fetchPrototypeHostOverview(mode),
        fetchPrototypeHostEarnings(mode),
      ])
      setOverview(nextOverview)
      setEarnings(nextEarnings)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function decideRequest(bookingId: string, decision: 'CONFIRM' | 'CANCEL') {
    if (decision === 'CONFIRM' && !acceptedRequestTerms[bookingId]) {
      setStatus('error')
      setMessage(t.termsRequired)
      return
    }

    setStatus('saving')
    setActiveRequestId(bookingId)
    setMessage('')

    try {
      const booking = await decidePrototypeHostRequest(bookingId, decision, mode, {
        acceptedTerms: decision === 'CONFIRM' ? true : undefined,
        termsVersion: 'SYBNB_HOST_BOOKING_RULES_V1',
      })
      const nextStatus = booking.status || (decision === 'CONFIRM' ? 'CONFIRMED' : 'CANCELLED')
      setOverview((current) => current ? {
        ...current,
        requests: current.requests.map((request) => request.id === bookingId ? { ...request, ...booking, status: nextStatus } : request),
      } : current)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveRequestId('')
    }
  }

  async function markCheckpoint(bookingId: string, action: 'CHECK_IN' | 'CHECK_OUT') {
    setStatus('saving')
    setActiveRequestId(bookingId)
    setMessage('')

    try {
      const booking = await markHostGuestCheckpoint(bookingId, action, mode)
      setOverview((current) => current ? {
        ...current,
        requests: current.requests.map((request) => request.id === bookingId ? { ...request, ...booking } : request),
      } : current)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveRequestId('')
    }
  }

  async function updateListing(listingId: string, nextStatus: 'PAUSED' | 'APPROVED') {
    setStatus('saving')
    setActiveListingId(listingId)
    setMessage('')

    try {
      await updatePrototypeHostListingStatus(listingId, nextStatus, mode)
      setOverview(await fetchPrototypeHostOverview(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  async function deleteListing(listingId: string) {
    if (!window.confirm(pick(lang, 'حذف هذا الإعلان نهائياً؟ لا يمكن التراجع.', 'Permanently delete this listing? This cannot be undone.', 'Supprimer définitivement cette annonce ? Cette action est irréversible.'))) return
    setStatus('saving')
    setActiveListingId(listingId)
    setMessage('')

    try {
      await deletePrototypeHostListing(listingId, mode)
      setOverview(await fetchPrototypeHostOverview(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  async function toggleInstantBook(listingId: string, enabled: boolean) {
    setStatus('saving')
    setActiveListingId(listingId)
    setMessage('')

    try {
      await updatePrototypeHostInstantBook(listingId, enabled, mode)
      setOverview(await fetchPrototypeHostOverview(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.topBar}>
        <div style={styles.topIcons}>
          <button aria-label={pick(lang, 'التنبيهات', 'Notifications', 'Notifications')} style={styles.iconCircle} onClick={() => (window.location.hash = '/immocontact')}>⌁</button>
          <button aria-label={pick(lang, 'الإعدادات', 'Settings', 'Paramètres')} style={styles.iconCircle} onClick={() => (window.location.hash = '/status')}>⚙</button>
        </div>
        <div style={styles.hostIdentity}>
          <strong>{providerCopy.dashboardTitle}</strong>
          <span>{providerCopy.verifiedLine(overview?.host.displayName, verificationStatusText)}</span>
        </div>
        <button
          type="button"
          style={{ ...styles.avatar, border: '1px solid #5268ff', color: '#fff', cursor: 'pointer' }}
          onClick={() => (window.location.hash = '/host/profile')}
          aria-label={pick(lang, 'ملفك كمضيف', 'Your host profile', 'Votre profil d’hôte')}
          title={pick(lang, 'ملفك كمضيف', 'Your host profile', 'Votre profil d’hôte')}
        >
          {(overview?.host.displayName || 'A').slice(0, 1)}
        </button>
      </section>

      {/* Host verification (2026-10-08): until the SYBNB activation code is entered, this host's
          stays are hidden from guests and cannot be booked. Renders nothing once verified. */}
      {mode === 'host' && <HostVerificationCard lang={lang} />}

      <section style={styles.providerHealth}>
        <article style={styles.healthHero}>
          <span>SYBNB · {verificationStatusText}</span>
          <strong>{trustScore}%</strong>
          <small>{responseScore}% {pick(lang, 'معدل الاستجابة', 'response score', 'taux de réponse')}</small>
        </article>
        <div style={styles.hostMetric}>
          <span>{t.payoutReady}</span>
          <strong>{moneyText(earnings?.totals.pendingMinor || 0, earnings?.totals.currency || dashboardCurrency, lang)}</strong>
          <button style={styles.earningsLink} onClick={() => (window.location.hash = '/host/earnings')}>
            {t.viewEarningsReport}
          </button>
          <button style={styles.earningsLink} onClick={() => (window.location.hash = '/host/payouts')}>
            {pick(lang, 'السحب وطريقة الاستلام ←', 'Payouts & withdrawals →', 'Versements et retraits →')}
          </button>
        </div>
        <div style={styles.hostMetric}>
          <span>{t.qualityScore}</span>
          <strong style={{ color: '#e5b80b' }}>{averageQualityScore}%</strong>
          <span style={styles.qualityTrack}><b style={{ ...styles.trackFill, width: `${averageQualityScore}%` }} /></span>
        </div>
        <div style={styles.healthScore}>
          <span>{t.healthDegree}</span>
          <strong>{healthScore}</strong>
          <small>/100</small>
          <em>
            {healthScore >= 80
              ? pick(lang, 'أداء ممتاز', 'Excellent performance', 'Excellente performance')
              : healthScore >= 50
                ? pick(lang, 'أداء جيد', 'Good performance', 'Bonne performance')
                : pick(lang, 'يحتاج تحسين', 'Needs improvement', 'À améliorer')}
          </em>
        </div>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.aiPanel}>
        <div style={styles.aiTitle}>
          <strong>AI Brain / {pick(lang, 'يقترح', 'Suggests', 'Suggère')}</strong>
          <span>✣</span>
        </div>
        <small style={{ color: '#9aa6ba' }}>
          {pick(lang, 'نصائح عامة، وليست تحليلاً مخصصاً لبيانات إعلانك.', 'Generic tips, not a personalized analysis of your listing data.', 'Conseils généraux, et non une analyse personnalisée des données de votre annonce.')}
        </small>
        {[
          [t.addPhotos, pick(lang, 'مثال', 'EXAMPLE', 'EXEMPLE')],
          [t.updatePolicy, pick(lang, 'مثال', 'EXAMPLE', 'EXEMPLE')],
          [t.replyFaster, t.slaMaintenance],
        ].map(([title, impact]) => (
          <article key={title} style={styles.aiSuggestion}>
            <button style={styles.goldButton} onClick={() => (window.location.hash = '/ai-brain')}>{t.apply}</button>
            <div>
              <span>{title}</span>
              <small>{impact}</small>
            </div>
          </article>
        ))}
      </section>

      <section style={styles.activeListings}>
        <div style={styles.sectionHead}>
          <h2>{t.activeListings}</h2>
          <small>{providerCopy.subtitle}</small>
          <span>{activeListingsLabel}</span>
          {mode === 'host' && (
            <button style={styles.primaryButton} onClick={() => (window.location.hash = '/sell/listing-wizard')}>
              + {t.createNewListing}
            </button>
          )}
        </div>
        <div style={styles.hostTable}>
          <div style={styles.hostTableHead}>
            <span>{pick(lang, 'العنوان', 'Title', 'Titre')}</span>
            <span>{t.quality}</span>
            <span>{t.status}</span>
            <span>{t.listingViews}</span>
            <span>{t.inquiries}</span>
            <span>{t.action}</span>
            <span />
          </div>
          {visibleListings.slice(0, 3).map((listing) => {
            const quality = listingQualityScore(listing)
            const statusLabel = quality >= 75
              ? pick(lang, 'نشط', 'Active', 'Active')
              : quality >= 50
                ? pick(lang, 'تحسين مطلوب', 'Needs improvement', 'À améliorer')
                : pick(lang, 'غير مكتمل', 'Incomplete', 'Incomplète')
            const statusTone = quality >= 75 ? styles.statusGreen : quality >= 50 ? styles.statusGold : styles.statusRed
            return (
              <article key={listing.id} style={styles.hostTableRow}>
                <strong>{listingTitle(listing, lang)}</strong>
                <span style={styles.tableQuality}><b style={{ ...styles.trackFill, width: `${quality}%` }} /></span>
                <span style={{ ...styles.statusPill, ...statusTone }}>{statusLabel}</span>
                <span>{listingViewCount(listing) ?? '—'}</span>
                <span>{listingInquiryCount(listing, visibleRequests)}</span>
                <button style={styles.editButton} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>✎</button>
                <button
                  style={styles.editButton}
                  disabled={status === 'saving' && activeListingId === listing.id}
                  onClick={() => void deleteListing(listing.id)}
                >
                  🗑
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section style={styles.documentsPanel}>
        <PaymentProofUpload
          cta={hostDocumentsCopy.cta}
          emptyText={hostDocumentsCopy.empty}
          files={hostDocumentFiles}
          help={hostDocumentsCopy.help}
          lang={lang}
          onAddFiles={addHostDocumentFiles}
          title={hostDocumentsCopy.title}
        />
        {hostDocumentUploadError && <p style={styles.errorText}>{hostDocumentUploadError}</p>}
        <button
          disabled={!hostDocumentPendingFile || hostDocumentUploadStatus === 'uploading' || isDocumentVerified || isDocumentPendingReview}
          style={isDocumentVerified || isDocumentPendingReview ? styles.primaryButton : styles.secondaryButton}
          onClick={() => void sendHostDocuments()}
        >
          {isDocumentVerified
            ? providerCopy.verifiedLabel
            : isDocumentPendingReview
              ? t.pendingVerification
              : hostDocumentUploadStatus === 'uploading'
                ? pick(lang, 'جارٍ الإرسال...', 'Sending...', 'Envoi...')
                : hostDocumentsCopy.send}
        </button>
      </section>

      <section style={styles.filtersPanel}>
        <div style={styles.filtersHead}>
          <div>
            <strong>{t.filters}</strong>
            <span>{providerCopy.filtersHint}</span>
          </div>
          <b>{selectedFilterLabels(hostInventoryFilterGroups, inventoryFilters, lang).length}</b>
        </div>
        <VisualFilterPanel
          compact
          groups={hostInventoryFilterGroups}
          lang={lang}
          selection={inventoryFilters}
          onChange={setInventoryFilters}
        />
      </section>

      <section style={styles.grid}>
        <Panel title={providerCopy.inventoryTitle} empty={t.empty}>
          {visibleListings.map((listing) => (
            <article key={listing.id} style={styles.card}>
              <strong>{listingTitle(listing, lang)}</strong>
              <Info label={t.division} value={divisionText(listing.division, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              <Info label={t.status} value={statusText(listing.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              <Info label={t.price} value={moneyText(listing.priceMinor, listing.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              {listing.expiresAt && (
                <Info
                  label={t.expiresOn}
                  value={new Date(listing.expiresAt).toLocaleDateString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'), { timeZone: 'UTC' })}
                  dir={isAr ? 'rtl' : 'ltr'}
                />
              )}
              <div style={styles.actions}>
                <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>
                  {t.view}
                </button>
                {listing.status === 'PAUSED' ? (
                  <button
                    disabled={activeListingId === listing.id}
                    style={styles.primaryButton}
                    onClick={() => void updateListing(listing.id, 'APPROVED')}
                  >
                    {activeListingId === listing.id ? t.saving : t.resume}
                  </button>
                ) : (
                  <button
                    disabled={activeListingId === listing.id}
                    style={styles.dangerButton}
                    onClick={() => void updateListing(listing.id, 'PAUSED')}
                  >
                    {activeListingId === listing.id ? t.saving : t.pause}
                  </button>
                )}
                <button
                  style={styles.secondaryButton}
                  onClick={() => setCalendarListingId((current) => (current === listing.id ? '' : listing.id))}
                >
                  {calendarListingId === listing.id ? t.hideCalendar : t.manageCalendar}
                </button>
                {listing.division === 'STAYS' && (
                  <button
                    disabled={activeListingId === listing.id}
                    style={listing.instantBookEnabled ? styles.primaryButton : styles.secondaryButton}
                    onClick={() => void toggleInstantBook(listing.id, !listing.instantBookEnabled)}
                  >
                    {activeListingId === listing.id ? t.saving : listing.instantBookEnabled ? t.instantBookOn : t.instantBookOff}
                  </button>
                )}
              </div>
              {calendarListingId === listing.id && (
                <HostAvailabilityCalendar
                  lang={lang}
                  listingId={listing.id}
                  basePriceMinor={listing.priceMinor}
                  currency={listing.currency}
                  mode={mode}
                />
              )}
            </article>
          ))}
        </Panel>

        <Panel title={t.inbox} empty={t.empty}>
          {visibleRequests.map((request) => (
            <article key={request.id} style={styles.card}>
              <strong>{request.listing ? listingTitle(request.listing, lang) : request.id.slice(0, 8).toUpperCase()}</strong>
              <Info label={t.guest} value={request.guest?.displayName || request.guestId.slice(0, 8).toUpperCase()} />
              <Info label={t.status} value={statusText(request.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              {request.payments?.some((payment) => payment.status === 'REFUNDED') ? (
                <Info label={t.paymentState} value={statusText('REFUNDED', lang)} dir={isAr ? 'rtl' : 'ltr'} />
              ) : null}
              <Info label={t.price} value={moneyText(request.amountMinor, request.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              {request.status === 'CONFIRMED' ? (
                <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/booking/${request.id}`)}>
                  {t.details}
                </button>
              ) : null}
              {['CONFIRMED', 'COMPLETED'].includes(request.status) && (
                <div style={styles.actions}>
                  {request.guestCheckedInAt ? (
                    <Info label={t.checkedInAt} value={new Date(request.guestCheckedInAt).toLocaleString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'))} dir={isAr ? 'rtl' : 'ltr'} />
                  ) : (
                    <button
                      disabled={activeRequestId === request.id}
                      style={styles.secondaryButton}
                      onClick={() => void markCheckpoint(request.id, 'CHECK_IN')}
                    >
                      {activeRequestId === request.id ? t.saving : t.markCheckedIn}
                    </button>
                  )}
                  {request.guestCheckedOutAt ? (
                    <Info label={t.checkedOutAt} value={new Date(request.guestCheckedOutAt).toLocaleString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'))} dir={isAr ? 'rtl' : 'ltr'} />
                  ) : (
                    <button
                      disabled={activeRequestId === request.id || !request.guestCheckedInAt}
                      style={styles.secondaryButton}
                      onClick={() => void markCheckpoint(request.id, 'CHECK_OUT')}
                    >
                      {activeRequestId === request.id ? t.saving : t.markCheckedOut}
                    </button>
                  )}
                </div>
              )}
              {['REQUESTED', 'CONFIRMED'].includes(request.status) && (
                <div style={styles.actions}>
                  {request.status === 'REQUESTED' ? (
                    <>
                      <label style={styles.termsBox}>
                        <input
                          type="checkbox"
                          checked={Boolean(acceptedRequestTerms[request.id])}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked
                            setAcceptedRequestTerms((current) => ({
                              ...current,
                              [request.id]: checked,
                            }))
                          }}
                        />
                        <span>
                          <strong>{t.termsTitle}</strong>
                          <small>{t.termsCopy}</small>
                        </span>
                      </label>
                      <button
                        disabled={activeRequestId === request.id || !acceptedRequestTerms[request.id]}
                        style={styles.primaryButton}
                        onClick={() => void decideRequest(request.id, 'CONFIRM')}
                      >
                        {activeRequestId === request.id ? t.saving : t.confirm}
                      </button>
                    </>
                  ) : <span />}
                  <button
                    disabled={activeRequestId === request.id}
                    style={styles.dangerButton}
                    onClick={() => void decideRequest(request.id, 'CANCEL')}
                  >
                    {t.cancel}
                  </button>
                </div>
              )}
            </article>
          ))}
        </Panel>
      </section>

      <section style={styles.hostQuickLinks}>
        {[
          [t.paymentState, '/finance', '▰'],
          [t.profitLog, '/finance', '↗'],
          [t.trustCenter, '/trust-center', '♢'],
          [t.opsSupport, '/operations', '?'],
          [t.clientMessages, '/host/inquiries', '✉'],
          [pick(lang, 'السحب والدفعات', 'Payouts', 'Versements'), '/host/payouts', '⇄'],
        ].map(([label, route, icon]) => (
          <button key={label} style={styles.quickLink} onClick={() => (window.location.hash = String(route))}>
            <strong>{label}</strong>
            <span>{icon}</span>
          </button>
        ))}
      </section>

      <div style={styles.hostFinalStamp}>{t.finalStamp} · 3055</div>
    </main>
  )
}

function Panel({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []

  return (
    <section style={styles.panel}>
      <h2 style={styles.panelTitle}>{title}</h2>
      {items.length ? <div style={styles.stack}>{children}</div> : <p style={styles.empty}>{empty}</p>}
    </section>
  )
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.info}>
      <span>{label}</span>
      <b dir={dir}>{value}</b>
    </div>
  )
}

function listingTitle(listing: Pick<PlatformListing, 'id' | 'division' | 'titleAr' | 'titleEn'>, lang: Lang) {
  return listingTitleText(listing, lang)
}

function matchesProviderFocus(listing: Pick<PlatformListing, 'division'>, focus?: ProviderFocus) {
  if (!focus) return true
  const division = listing.division.toUpperCase()
  if (focus === 'stays') return division === 'STAYS'
  if (focus === 'cars') return division === 'CARS'
  if (focus === 'newConstruction') return division === 'NEW_CONSTRUCTION'
  if (focus === 'marketplace') return division === 'MARKETPLACE'
  return true
}

function getProviderCopy(t: typeof copy.ar | typeof copy.en | typeof copy.fr, lang: Lang, focus?: ProviderFocus, mode?: HostDashboardMode) {
  if (focus === 'cars') {
    return {
      dashboardTitle: t.carSellerDashboard,
      subtitle: t.carsSubtitle,
      verifiedLabel: t.verifiedCarSeller,
      filtersHint: t.carsFiltersHint,
      inventoryTitle: t.activeCars,
      activeUnit: pick(lang, 'مركبات حاليا', 'active cars', 'véhicules actifs'),
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  if (focus === 'newConstruction') {
    return {
      dashboardTitle: t.builderDashboard,
      subtitle: t.newConstructionSubtitle,
      verifiedLabel: t.verifiedBuilder,
      filtersHint: t.newConstructionFiltersHint,
      inventoryTitle: t.activeProjects,
      activeUnit: pick(lang, 'مشاريع حاليا', 'active projects', 'projets actifs'),
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  if (focus === 'marketplace') {
    return {
      dashboardTitle: t.marketplaceSellerDashboard,
      subtitle: t.marketplaceSubtitle,
      verifiedLabel: t.verifiedMarketplaceSeller,
      filtersHint: t.marketplaceFiltersHint,
      inventoryTitle: t.activeProducts,
      activeUnit: pick(lang, 'منتجات حاليا', 'active products', 'produits actifs'),
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  if (focus === 'stays') {
    return {
      dashboardTitle: t.hostDashboard,
      subtitle: t.staysSubtitle,
      verifiedLabel: t.verifiedHost,
      filtersHint: t.staysFiltersHint,
      inventoryTitle: t.hostingInventory,
      activeUnit: pick(lang, 'استضافات حاليا', 'active stays', 'séjours actifs'),
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  // A stay host lands here via /host (focus undefined, mode 'host'): use host wording, not the
  // combined "Seller / Host" label. Marketplace/broker seller modes keep the seller-facing default.
  if (mode === 'host') {
    return {
      dashboardTitle: t.hostDashboard,
      subtitle: t.staysSubtitle,
      verifiedLabel: t.verifiedHost,
      filtersHint: t.staysFiltersHint,
      inventoryTitle: t.hostingInventory,
      activeUnit: pick(lang, 'استضافات حاليا', 'active stays', 'séjours actifs'),
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  return {
    dashboardTitle: t.title,
    subtitle: t.subtitle,
    verifiedLabel: t.verifiedHost,
    filtersHint: t.filtersHint,
    inventoryTitle: t.inventory,
    activeUnit: pick(lang, 'إعلانات حاليا', 'active listings', 'annonces actives'),
    verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
  }
}

function getHostDocumentsCopy(lang: Lang, focus?: ProviderFocus) {
  if (focus === 'cars') {
    return pick(lang,
      {
          title: 'مستندات بائع المركبات',
          help: 'ارفع رخصة المعرض أو الوكيل، ملكية المركبة، صور السيارة، الفحص الفني، وأي تفويض مطلوب قبل نشر المركبة.',
          cta: 'رفع مستندات المركبة',
          empty: 'لم يتم رفع مستندات المركبة بعد. أضف PDF أو PNG أو JPG.',
          send: 'إرسال مستندات المركبة للإدارة',
          sent: 'تم إرسال مستندات المركبة للإدارة',
        },
      {
          title: 'Vehicle seller documents',
          help: 'Upload dealer/agent license, vehicle ownership, car photos, inspection files, and any required authorization before publishing.',
          cta: 'Upload vehicle documents',
          empty: 'No vehicle documents uploaded yet. Add PDF, PNG, or JPG.',
          send: 'Send vehicle documents to admin',
          sent: 'Vehicle documents sent to admin',
        },
      {
          title: 'Documents du vendeur de véhicules',
          help: 'Téléversez le permis de concessionnaire ou d’agent, la preuve de propriété du véhicule, les photos, les rapports d’inspection et toute autorisation requise avant la publication.',
          cta: 'Téléverser les documents du véhicule',
          empty: 'Aucun document de véhicule téléversé pour le moment. Ajoutez un PDF, PNG ou JPG.',
          send: 'Envoyer les documents du véhicule à l’administration',
          sent: 'Documents du véhicule envoyés à l’administration',
        })
  }
  if (focus === 'newConstruction') {
    return pick(lang,
      {
          title: 'مستندات المطور والمشروع',
          help: 'ارفع رخصة المطور، سند الأرض أو الملكية، رخص البناء، المخططات، صور المشروع، وجدول الوحدات قبل نشر المشروع.',
          cta: 'رفع مستندات المشروع',
          empty: 'لم يتم رفع مستندات المشروع بعد. أضف PDF أو PNG أو JPG.',
          send: 'إرسال مستندات المشروع للإدارة',
          sent: 'تم إرسال مستندات المشروع للإدارة',
        },
      {
          title: 'Developer and project documents',
          help: 'Upload developer license, land/ownership deed, building permits, plans, project photos, and unit schedule before publishing.',
          cta: 'Upload project documents',
          empty: 'No project documents uploaded yet. Add PDF, PNG, or JPG.',
          send: 'Send project documents to admin',
          sent: 'Project documents sent to admin',
        },
      {
          title: 'Documents du promoteur et du projet',
          help: 'Téléversez le permis de promoteur, le titre foncier ou de propriété, les permis de construire, les plans, les photos du projet et le tableau des unités avant la publication.',
          cta: 'Téléverser les documents du projet',
          empty: 'Aucun document de projet téléversé pour le moment. Ajoutez un PDF, PNG ou JPG.',
          send: 'Envoyer les documents du projet à l’administration',
          sent: 'Documents du projet envoyés à l’administration',
        })
  }
  if (focus === 'marketplace') {
    return pick(lang,
      {
          title: 'مستندات بائع السوق',
          help: 'ارفع هوية البائع، صور المنتج، فاتورة أو إثبات الملكية، وأي تفويض مطلوب قبل نشر المنتج.',
          cta: 'رفع مستندات المنتج',
          empty: 'لم يتم رفع مستندات المنتج بعد. أضف PDF أو PNG أو JPG.',
          send: 'إرسال مستندات المنتج للإدارة',
          sent: 'تم إرسال مستندات المنتج للإدارة',
        },
      {
          title: 'Marketplace seller documents',
          help: 'Upload seller ID, product photos, invoice/ownership proof, and any required authorization before publishing.',
          cta: 'Upload product documents',
          empty: 'No product documents uploaded yet. Add PDF, PNG, or JPG.',
          send: 'Send product documents to admin',
          sent: 'Product documents sent to admin',
        },
      {
          title: 'Documents du vendeur Marketplace',
          help: 'Téléversez la pièce d’identité du vendeur, les photos du produit, une facture ou preuve de propriété et toute autorisation requise avant la publication.',
          cta: 'Téléverser les documents du produit',
          empty: 'Aucun document de produit téléversé pour le moment. Ajoutez un PDF, PNG ou JPG.',
          send: 'Envoyer les documents du produit à l’administration',
          sent: 'Documents du produit envoyés à l’administration',
        })
  }
  return null
}

function listingQualityScore(listing: PlatformListing) {
  const status = listing.status.toUpperCase()
  const mediaCount = Array.isArray(listing.media) ? listing.media.length : 0
  let score = status === 'APPROVED' ? 60 : status.includes('PENDING') || status.includes('REQUEST') ? 45 : 35
  if (listing.description?.trim()) score += 10
  if (listing.priceMinor > 0) score += 10
  if (listing.location) score += 5
  score += Math.min(15, mediaCount * 5)
  return clamp(score, 20, 98)
}

// No page-view tracking exists anywhere in the backend — nothing ever writes metadata.views. Return
// null rather than a formula-derived number that would look like real traffic analytics.
function listingViewCount(listing: PlatformListing): number | null {
  const stored = metadataNumber(listing.metadata, ['views', 'viewCount', 'listingViews'])
  return stored || null
}

function listingInquiryCount(listing: PlatformListing, requests: PlatformHostOverview['requests']) {
  const stored = metadataNumber(listing.metadata, ['inquiries', 'inquiryCount'])
  if (stored) return stored
  return requests.filter((request) => request.listingId === listing.id).length
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 24, maxWidth: 1240, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  topBar: { display: 'grid', gap: 14, gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center' },
  topIcons: { display: 'flex', gap: 14 },
  iconCircle: { width: 54, height: 54, borderRadius: 999, border: '1px solid #242735', background: '#101119', color: '#fff', fontWeight: 950, fontSize: 20 },
  hostIdentity: { display: 'grid', gap: 6, justifyItems: 'end', alignContent: 'center' },
  avatar: { width: 62, height: 62, borderRadius: 999, background: '#1d2332', display: 'grid', placeItems: 'center', fontWeight: 950 },
  finalLockPanel: { border: '1px solid rgba(32,210,155,.55)', borderRadius: 8, background: 'linear-gradient(135deg, rgba(32,210,155,.12), rgba(82,108,255,.08))', padding: 16, display: 'grid', gap: 10 },
  finalChecks: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', color: '#20d29b' },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 14 },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 4, padding: 12 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  errorText: { color: '#ff5f7d', margin: 0, fontSize: 13 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  filtersPanel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', display: 'grid', gap: 12, padding: 14 },
  filtersHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', color: '#d5a915' },
  providerHealth: { border: '1px solid #242735', borderRadius: 8, background: '#121219', padding: 28, display: 'grid', gap: 22, gridTemplateColumns: '1fr 1fr 1fr 1fr', alignItems: 'center' },
  healthHero: { border: '1px solid rgba(32,210,155,.85)', borderRadius: 999, background: 'rgba(32,210,155,.08)', padding: 18, display: 'grid', gap: 8, textAlign: 'center', color: '#20d29b' },
  hostMetric: { minHeight: 104, borderInlineStart: '1px solid #242735', paddingInlineStart: 26, display: 'grid', gap: 8, alignContent: 'center', color: '#8d92a2' },
  earningsLink: { justifySelf: 'start', border: 0, background: 'transparent', color: '#8ea0ff', fontWeight: 900, fontSize: 12, padding: 0, cursor: 'pointer' },
  qualityTrack: { height: 7, borderRadius: 999, background: '#23222b', overflow: 'hidden', display: 'block' },
  trackFill: { display: 'block', height: '100%', borderRadius: 999, background: '#e5b80b' },
  healthScore: { justifySelf: 'end', width: 128, height: 128, borderRadius: 999, border: '12px solid #20d29b', display: 'grid', placeItems: 'center', alignContent: 'center', textAlign: 'center', color: '#fff' },
  documentsPanel: { border: '1px solid rgba(32,210,155,.45)', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12 },
  aiPanel: { border: '1px solid rgba(229,184,11,.9)', borderRadius: 8, background: '#101016', padding: 32, display: 'grid', gap: 20 },
  aiTitle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#e5b80b', fontSize: 22 },
  aiSuggestion: { border: '1px solid #151722', borderRadius: 8, background: '#090a0f', minHeight: 116, padding: 22, display: 'grid', gap: 18, gridTemplateColumns: '110px minmax(0, 1fr)', alignItems: 'center' },
  goldButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#d5a915', color: '#08090f', fontWeight: 950 },
  activeListings: { display: 'grid', gap: 16 },
  sectionHead: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'end' },
  hostTable: { border: '1px solid #242735', borderRadius: 8, background: '#101016', overflowX: 'auto', overflowY: 'hidden' },
  hostTableHead: { display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 90px 90px 70px 70px', gap: 12, padding: '14px 18px', borderBottom: '1px solid #242735', color: '#8d92a2', fontSize: 13, minWidth: 780 },
  hostTableRow: { display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 90px 90px 70px 70px', gap: 12, alignItems: 'center', padding: '18px', borderBottom: '1px solid #242735', minWidth: 780 },
  tableQuality: { height: 7, borderRadius: 999, background: '#23222b', overflow: 'hidden', display: 'block' },
  statusPill: { borderRadius: 8, padding: '8px 10px', textAlign: 'center', fontWeight: 900, fontSize: 12 },
  statusGreen: { background: 'rgba(32,210,155,.14)', color: '#20d29b', border: '1px solid rgba(32,210,155,.42)' },
  statusGold: { background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.42)' },
  statusRed: { background: 'rgba(255,78,119,.13)', color: '#ff4e77', border: '1px solid rgba(255,78,119,.42)' },
  editButton: { width: 38, height: 38, borderRadius: 8, border: '1px solid rgba(82,108,255,.5)', background: 'rgba(82,108,255,.12)', color: '#526cff', fontWeight: 950 },
  hostQuickLinks: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
  quickLink: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', color: '#fff', minHeight: 86, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 950 },
  hostFinalStamp: { justifySelf: 'start', border: '1px solid rgba(229,184,11,.65)', borderRadius: 999, background: 'rgba(229,184,11,.12)', color: '#e5b80b', padding: '8px 12px', fontSize: 11, fontWeight: 950 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' },
  panel: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 14 },
  panelTitle: { margin: '0 0 12px', fontSize: 20 },
  stack: { display: 'grid', gap: 10 },
  card: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 8 },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', alignItems: 'stretch' },
  termsBox: { gridColumn: '1 / -1', border: '1px solid rgba(229,184,11,.55)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', padding: 12, display: 'grid', gap: 10, gridTemplateColumns: '28px minmax(0, 1fr)', alignItems: 'start', lineHeight: 1.45 },
  dangerButton: { minHeight: 42, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 14px' },
  info: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
  empty: { color: '#9aa6ba', margin: 0 },
}
