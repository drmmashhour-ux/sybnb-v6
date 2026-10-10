import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  acceptSrOffer,
  claimPrototypeSrRide,
  declineSrOffer,
  enablePushNotifications,
  fetchDriverIdentityStatus,
  fetchPendingSrRides,
  fetchPrototypeDriverOverview,
  fetchPrototypeSrRideThread,
  reportPrototypeDriverLocation,
  saveDriverVehicle,
  sendPrototypeSrRideMessage,
  submitDriverPhoto,
  updatePrototypeDriverAccessibility,
  updatePrototypeDriverRideStatus,
  verifySrPickup,
  triggerSrSos,
  type PlatformDriverOverview,
  type PlatformMessage,
  type PlatformRideRequest,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

// Matches MESSAGING_ELIGIBLE_RIDE_STATUSES in server/routes/messages.mjs.
const MESSAGING_ELIGIBLE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']
// Matches LIVE_TRACKING_STATUSES in server/routes/sr-rides.mjs.
const LIVE_TRACKING_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
// Throttles how often an actual network post goes out -- watchPosition can fire far more often
// than this, and the server only needs roughly this cadence to stay within getDriverLocation()'s
// 2-minute freshness window (server/lib/live-map.mjs) with comfortable margin.
const LOCATION_REPORT_INTERVAL_MS = 8000

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'لوحة سائق SR',
    subtitle: 'الرحلات المسندة للسائق وحالات التنفيذ مباشرة من قاعدة البيانات.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    saving: 'جار الحفظ',
    error: 'تعذر تحميل رحلات السائق',
    assigned: 'مسندة',
    active: 'نشطة',
    completed: 'مكتملة',
    earnings: 'المحصّل (صافي)',
    awaiting: 'بانتظار الدفع',
    keepPrefix: 'تحتفظ بـ',
    paidTag: 'مدفوع',
    awaitingTag: 'بانتظار الدفع',
    netEarn: 'صافي ربحك',
    verifyToAccept: 'أكمل التحقق (هوية معتمدة + مركبة مسجّلة) لقبول الرحلات.',
    rating: 'تقييمك',
    rider: 'الراكب',
    pickup: 'الانطلاق',
    dropoff: 'الوجهة',
    status: 'الحالة',
    fare: 'الأجرة',
    arriving: 'في الطريق',
    start: 'بدء الرحلة',
    complete: 'إنهاء',
    cancel: 'إلغاء',
    messageRider: 'راسل الراكب',
    hideChat: 'إخفاء المحادثة',
    chatEmpty: 'لا توجد رسائل بعد.',
    chatPlaceholder: 'اكتب رسالة...',
    chatSend: 'إرسال',
    shareLocation: 'مشاركة موقعي',
    stopSharing: 'إيقاف المشاركة',
    locationDenied: 'تعذر الوصول إلى الموقع. تحقق من إذن الموقع.',
    locationUnsupported: 'الموقع الجغرافي غير مدعوم على هذا الجهاز.',
    accessibilityCapable: 'مركبتي تسمح بالوصول لذوي الاحتياجات الخاصة',
    accessibilityRequired: 'يحتاج مركبة لذوي الاحتياجات الخاصة',
    stopsCount: 'محطات',
    stopLabel: 'محطة',
    shareable: 'رحلة مشتركة',
    enableNotifications: 'تفعيل الإشعارات',
    enablingNotifications: 'جار التفعيل...',
    empty: 'لا توجد رحلات مسندة بعد.',
    dispatch: 'مركز التوجيه',
    safety: 'أمان الرحلة',
    routeConfidence: 'ثقة المسار',
    payout: 'صرف السائق',
    nextBest: 'أفضل إجراء',
    nextBestText: 'ابدأ بالرحلات النشطة، ثم حدّث الحالة فور الوصول لتفعيل ثقة العميل.',
    openOperations: 'فتح العمليات',
    openFinance: 'فتح المالية',
    available: 'متاح',
    accept: 'قبول',
    decline: 'رفض',
    declining: 'جار الرفض...',
    offeredToYou: 'عرضت عليك',
    pendingEmpty: 'لا توجد طلبات رحلات بانتظار سائق الآن.',
    pendingLoading: 'جار البحث عن الطلبات المتاحة...',
    claiming: 'جار القبول...',
    claimError: 'تعذر قبول الرحلة، ربما قبلها سائق آخر للتو.',
    distance: 'المسافة',
    docsStatus: 'حالة الأمان والوثائق',
    verifiedIdentity: 'الهوية الموثقة',
    identityVerified: 'موثق',
    identityPending: 'قيد المراجعة',
    identityNotVerified: 'غير موثق',
    photoTitle: 'صورتك الشخصية',
    photoCopy: 'ارفع صورة واضحة لوجهك ليتعرف عليك الراكب قبل الرحلة.',
    uploadPhoto: 'رفع صورة',
    uploading: 'جار الرفع...',
    photoSubmitted: 'تم حفظ صورتك.',
    photoError: 'تعذر رفع الصورة.',
    vehicleTitle: 'مركبتك',
    vehicleCopy: 'سجّل مركبتك ليتعرف عليها الراكب. مطلوب قبل قبول الرحلات.',
    vehicleMakeL: 'الماركة',
    vehicleModelL: 'الموديل',
    vehiclePlateL: 'رقم اللوحة',
    vehicleSave: 'حفظ المركبة',
    vehicleSaved: 'تم حفظ المركبة.',
    vehicleErr: 'تعذر حفظ بيانات المركبة.',
    vehicleCategoryL: 'فئة المركبة',
    vehicleCategoryHint: 'اختر الفئة التي تطابق مركبتك. لا يمكنك قبول رحلة إلا إذا طابقت فئتها.',
    vehicleCategoryChoose: 'اختر الفئة',
    catBIKE: 'دراجة نارية (SR Bike)',
    catECONOMY: 'اقتصادي (SR Economy)',
    catCOMFORT: 'مريح (SR Comfort)',
    catSUV: 'دفع رباعي (SR SUV)',
    catVAN: 'فان (SR Van)',
    vehicleYearL: 'سنة الصنع',
    vehicleColorL: 'اللون',
    registrationExpiryL: 'انتهاء رخصة السير',
    inspectionL: 'الفحص الميكانيكي',
    inspPENDING: 'قيد الانتظار',
    inspPASSED: 'ناجح',
    inspFAILED: 'راسب',
    inspEXPIRED: 'منتهٍ',
    reportIssue: 'إبلاغ عن مشكلة',
    sos: 'طوارئ SOS',
    sosConfirm: 'هل أنت في حالة طوارئ؟ سيتم تنبيه فريق SYBNB فوراً مع موقعك وتفاصيل الرحلة.',
    sosSending: 'جار إرسال التنبيه...',
    sosSent: '✓ تم إرسال تنبيه الطوارئ.',
    sosFailed: 'تعذر إرسال تنبيه الطوارئ. حاول مجدداً أو اتصل بالطوارئ مباشرة.',
    sosInactive: 'زر الطوارئ متاح أثناء رحلة نشطة فقط.',
  },
  en: {
    back: 'Back to landing',
    title: 'SR Driver Dashboard',
    subtitle: 'Assigned driver rides and live execution states directly from PostgreSQL.',
    refresh: 'Refresh',
    loading: 'Loading',
    saving: 'Saving',
    error: 'Could not load driver rides',
    assigned: 'Assigned',
    active: 'Active',
    completed: 'Completed',
    earnings: 'Collected (net)',
    awaiting: 'Awaiting payment',
    keepPrefix: 'You keep',
    paidTag: 'Paid',
    awaitingTag: 'Awaiting payment',
    netEarn: 'You earn',
    verifyToAccept: 'Finish verification (approved ID + registered vehicle) to accept rides.',
    rating: 'Your rating',
    rider: 'Rider',
    pickup: 'Pickup',
    dropoff: 'Dropoff',
    status: 'Status',
    fare: 'Fare',
    arriving: 'Arriving',
    start: 'Start ride',
    complete: 'Complete',
    cancel: 'Cancel',
    messageRider: 'Message rider',
    hideChat: 'Hide chat',
    chatEmpty: 'No messages yet.',
    chatPlaceholder: 'Type a message...',
    chatSend: 'Send',
    shareLocation: 'Share my location',
    stopSharing: 'Stop sharing',
    locationDenied: 'Could not access location. Check your location permission.',
    locationUnsupported: 'Geolocation is not supported on this device.',
    accessibilityCapable: 'My vehicle is wheelchair accessible',
    accessibilityRequired: 'Needs accessible vehicle',
    stopsCount: 'stops',
    stopLabel: 'Stop',
    shareable: 'Shared ride',
    enableNotifications: 'Enable notifications',
    enablingNotifications: 'Enabling...',
    empty: 'No assigned rides yet.',
    dispatch: 'Dispatch center',
    safety: 'Ride safety',
    routeConfidence: 'Route confidence',
    payout: 'Driver payout',
    nextBest: 'Best next action',
    nextBestText: 'Start with active rides, then update arrival state immediately to increase rider confidence.',
    openOperations: 'Open operations',
    openFinance: 'Open finance',
    available: 'Available',
    accept: 'Accept',
    decline: 'Decline',
    declining: 'Declining...',
    offeredToYou: 'Offered to you',
    pendingEmpty: 'No ride requests waiting for a driver right now.',
    pendingLoading: 'Looking for open requests...',
    claiming: 'Claiming...',
    claimError: 'Could not claim this ride, another driver may have just accepted it.',
    distance: 'Distance',
    docsStatus: 'Safety and document status',
    verifiedIdentity: 'Verified identity',
    identityVerified: 'Verified',
    identityPending: 'Pending review',
    identityNotVerified: 'Not verified',
    photoTitle: 'Your photo',
    photoCopy: 'Upload a clear photo of your face so riders can recognize you before the ride.',
    uploadPhoto: 'Upload photo',
    uploading: 'Uploading...',
    photoSubmitted: 'Your photo was saved.',
    photoError: 'Could not upload the photo.',
    vehicleTitle: 'Your vehicle',
    vehicleCopy: 'Register your car so riders can recognize it. Required before you can accept rides.',
    vehicleMakeL: 'Make',
    vehicleModelL: 'Model',
    vehiclePlateL: 'Plate number',
    vehicleSave: 'Save vehicle',
    vehicleSaved: 'Vehicle saved.',
    vehicleErr: 'Could not save the vehicle.',
    vehicleCategoryL: 'Vehicle category',
    vehicleCategoryHint: 'Pick the category your vehicle matches. You can only accept a ride whose category matches.',
    vehicleCategoryChoose: 'Choose a category',
    catBIKE: 'Bike (SR Bike)',
    catECONOMY: 'Economy (SR Economy)',
    catCOMFORT: 'Comfort (SR Comfort)',
    catSUV: 'SUV (SR SUV)',
    catVAN: 'Van (SR Van)',
    vehicleYearL: 'Build year',
    vehicleColorL: 'Color',
    registrationExpiryL: 'Registration expiry',
    inspectionL: 'Mechanical inspection',
    inspPENDING: 'Pending',
    inspPASSED: 'Passed',
    inspFAILED: 'Failed',
    inspEXPIRED: 'Expired',
    reportIssue: 'Report issue',
    sos: 'SOS emergency',
    sosConfirm: 'Are you in an emergency? SYBNB will be alerted immediately with your location and trip details.',
    sosSending: 'Sending alert...',
    sosSent: '✓ Emergency alert sent.',
    sosFailed: 'Could not send the emergency alert. Try again or call emergency services directly.',
    sosInactive: 'SOS is available only during an active ride.',
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'Tableau de bord chauffeur SR',
    subtitle: 'Courses assignées au chauffeur et états d’exécution en direct depuis PostgreSQL.',
    refresh: 'Actualiser',
    loading: 'Chargement',
    saving: 'Enregistrement',
    error: 'Impossible de charger les courses du chauffeur',
    assigned: 'Assignées',
    active: 'Actives',
    completed: 'Terminées',
    earnings: 'Encaissé (net)',
    awaiting: 'En attente de paiement',
    keepPrefix: 'Vous gardez',
    paidTag: 'Payé',
    awaitingTag: 'En attente',
    netEarn: 'Vous gagnez',
    verifyToAccept: 'Terminez la vérification (pièce d’identité approuvée + véhicule enregistré) pour accepter des courses.',
    rating: 'Votre note',
    rider: 'Passager',
    pickup: 'Prise en charge',
    dropoff: 'Destination',
    status: 'Statut',
    fare: 'Tarif',
    arriving: 'En route',
    start: 'Démarrer la course',
    complete: 'Terminer',
    cancel: 'Annuler',
    messageRider: 'Écrire au passager',
    hideChat: 'Masquer la conversation',
    chatEmpty: 'Aucun message pour le moment.',
    chatPlaceholder: 'Saisissez un message...',
    chatSend: 'Envoyer',
    shareLocation: 'Partager ma position',
    stopSharing: 'Arrêter le partage',
    locationDenied: 'Impossible d’accéder à la position. Vérifiez l’autorisation de localisation.',
    locationUnsupported: 'La géolocalisation n’est pas prise en charge sur cet appareil.',
    accessibilityCapable: 'Mon véhicule est accessible en fauteuil roulant',
    accessibilityRequired: 'Nécessite un véhicule accessible',
    stopsCount: 'arrêts',
    stopLabel: 'Arrêt',
    shareable: 'Course partagée',
    enableNotifications: 'Activer les notifications',
    enablingNotifications: 'Activation...',
    empty: 'Aucune course assignée pour le moment.',
    dispatch: 'Centre de répartition',
    safety: 'Sécurité de la course',
    routeConfidence: 'Fiabilité de l’itinéraire',
    payout: 'Versement au chauffeur',
    nextBest: 'Prochaine action recommandée',
    nextBestText: 'Commencez par les courses actives, puis mettez à jour l’état d’arrivée immédiatement pour renforcer la confiance du passager.',
    openOperations: 'Ouvrir les opérations',
    openFinance: 'Ouvrir les finances',
    available: 'Disponibles',
    accept: 'Accepter',
    decline: 'Refuser',
    declining: 'Refus...',
    offeredToYou: 'Proposée pour vous',
    pendingEmpty: 'Aucune demande de course en attente de chauffeur pour le moment.',
    pendingLoading: 'Recherche de demandes disponibles...',
    claiming: 'Acceptation...',
    claimError: 'Impossible d’accepter cette course; un autre chauffeur l’a peut-être déjà acceptée.',
    distance: 'Distance',
    docsStatus: 'Sécurité et statut des documents',
    verifiedIdentity: 'Identité vérifiée',
    identityVerified: 'Vérifiée',
    identityPending: 'En cours de vérification',
    identityNotVerified: 'Non vérifiée',
    photoTitle: 'Votre photo',
    photoCopy: 'Téléversez une photo nette de votre visage pour que les passagers vous reconnaissent avant la course.',
    uploadPhoto: 'Téléverser une photo',
    uploading: 'Téléversement...',
    photoSubmitted: 'Votre photo a été enregistrée.',
    photoError: 'Impossible de téléverser la photo.',
    vehicleTitle: 'Votre véhicule',
    vehicleCopy: 'Enregistrez votre voiture pour que les passagers la reconnaissent. Requis avant d’accepter des courses.',
    vehicleMakeL: 'Marque',
    vehicleModelL: 'Modèle',
    vehiclePlateL: 'Plaque',
    vehicleSave: 'Enregistrer',
    vehicleSaved: 'Véhicule enregistré.',
    vehicleErr: 'Impossible d’enregistrer le véhicule.',
    vehicleCategoryL: 'Catégorie du véhicule',
    vehicleCategoryHint: 'Choisissez la catégorie correspondant à votre véhicule. Vous ne pouvez accepter qu’une course de catégorie identique.',
    vehicleCategoryChoose: 'Choisir une catégorie',
    catBIKE: 'Moto (SR Bike)',
    catECONOMY: 'Économique (SR Economy)',
    catCOMFORT: 'Confort (SR Comfort)',
    catSUV: 'SUV (SR SUV)',
    catVAN: 'Van (SR Van)',
    vehicleYearL: 'Année',
    vehicleColorL: 'Couleur',
    registrationExpiryL: 'Expiration de la carte grise',
    inspectionL: 'Contrôle technique',
    inspPENDING: 'En attente',
    inspPASSED: 'Validé',
    inspFAILED: 'Refusé',
    inspEXPIRED: 'Expiré',
    reportIssue: 'Signaler un problème',
    sos: 'Urgence SOS',
    sosConfirm: 'Êtes-vous en situation d’urgence ? SYBNB sera alerté immédiatement avec votre position et les détails de la course.',
    sosSending: 'Envoi de l’alerte...',
    sosSent: '✓ Alerte d’urgence envoyée.',
    sosFailed: 'Impossible d’envoyer l’alerte d’urgence. Réessayez ou appelez les secours directement.',
    sosInactive: 'Le SOS n’est disponible que pendant une course active.',
  },
}

export function DriverDashboardPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [overview, setOverview] = useState<PlatformDriverOverview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [activeRideId, setActiveRideId] = useState('')
  const [sosState, setSosState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [pendingRides, setPendingRides] = useState<PlatformRideRequest[]>([])
  const [pendingStatus, setPendingStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [claimingRideId, setClaimingRideId] = useState('')
  const [claimError, setClaimError] = useState('')
  const [idDocumentStatus, setIdDocumentStatus] = useState<'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoStatus, setPhotoStatus] = useState<'idle' | 'uploading' | 'submitted' | 'error'>('idle')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleCategory, setVehicleCategory] = useState<'' | 'BIKE' | 'ECONOMY' | 'COMFORT' | 'SUV' | 'VAN'>('')
  const [vehicleStatus, setVehicleStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [vehicleYear, setVehicleYear] = useState('')
  const [vehicleColor, setVehicleColor] = useState('')
  const [registrationExpiresAt, setRegistrationExpiresAt] = useState('')
  const [vehicleErrMsg, setVehicleErrMsg] = useState('')
  const [pushStatus, setPushStatus] = useState<'idle' | 'enabling' | 'enabled' | 'error'>('idle')

  useEffect(() => {
    void loadOverview()
    void loadPendingRides()
    void loadIdentityStatus()
    const interval = window.setInterval(() => void loadPendingRides(), 6000)
    return () => window.clearInterval(interval)
  }, [])

  async function loadIdentityStatus() {
    try {
      setIdDocumentStatus(await fetchDriverIdentityStatus())
    } catch {
      setIdDocumentStatus(null)
    }
  }

  async function submitPhoto() {
    if (!photoFile) return
    setPhotoStatus('uploading')
    try {
      await submitDriverPhoto(photoFile)
      setPhotoStatus('submitted')
    } catch {
      setPhotoStatus('error')
    }
  }

  async function enableNotifications() {
    setPushStatus('enabling')
    try {
      await enablePushNotifications(true)
      setPushStatus('enabled')
    } catch {
      setPushStatus('error')
    }
  }

  async function toggleAccessibility(next: boolean) {
    try {
      const driverProfile = await updatePrototypeDriverAccessibility(next)
      setOverview((previous) =>
        previous ? { ...previous, driver: { ...previous.driver, accessibilityCapable: driverProfile.accessibilityCapable } } : previous,
      )
    } catch {
      // Non-critical toggle -- the checkbox simply won't reflect the change; no dedicated error slot.
    }
  }

  async function loadPendingRides() {
    try {
      setPendingRides(await fetchPendingSrRides())
      setPendingStatus('ready')
    } catch {
      setPendingStatus('error')
    }
  }

  async function claimRide(rideId: string) {
    setClaimingRideId(rideId)
    setClaimError('')

    try {
      await claimPrototypeSrRide(rideId)
      await Promise.all([loadOverview(), loadPendingRides()])
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : t.claimError)
      await loadPendingRides()
    } finally {
      setClaimingRideId('')
    }
  }

  async function acceptOffer(rideId: string) {
    setClaimingRideId(rideId)
    setClaimError('')

    try {
      await acceptSrOffer(rideId)
      await Promise.all([loadOverview(), loadPendingRides()])
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : t.claimError)
      await loadPendingRides()
    } finally {
      setClaimingRideId('')
    }
  }

  async function declineOffer(rideId: string) {
    setClaimingRideId(rideId)
    setClaimError('')

    try {
      await declineSrOffer(rideId)
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : t.claimError)
    } finally {
      await loadPendingRides()
      setClaimingRideId('')
    }
  }

  const stats = useMemo(() => {
    const pct = Math.round((1 - (overview?.totals.commissionRate ?? 0.15)) * 100)
    const base = [
      { label: t.assigned, value: String(overview?.totals.assigned || 0) },
      { label: t.active, value: String(overview?.totals.active || 0) },
      { label: t.completed, value: String(overview?.totals.completed || 0) },
      { label: `${t.earnings} · ${t.keepPrefix} ${pct}%`, value: moneyText(overview?.totals.earningsMinor || 0, overview?.totals.currency || 'USD', lang) },
      { label: t.awaiting, value: moneyText(overview?.totals.awaitingMinor || 0, overview?.totals.currency || 'USD', lang) },
    ]
    // Only ever a real, rider-submitted average -- never a placeholder for a driver with zero
    // ratings yet (CAPSULE_RULES.noFakeTrustSignal).
    if (overview?.rating.ratingCount) {
      base.push({ label: t.rating, value: `★${overview.rating.averageRating} (${overview.rating.ratingCount})` })
    }
    return base
  }, [lang, overview, t])

  // Verification gate for accepting rides (matches the server claim gate): approved ID + a
  // registered vehicle. Surfaced in the UI so the driver sees a clear "finish verification" state
  // instead of tapping Accept and eating a 403.
  const canAccept = idDocumentStatus === 'APPROVED'
    && Boolean(overview?.driver.vehiclePlate)
    && overview?.driver.vehicleStatus === 'APPROVED'

  async function loadOverview() {
    setStatus('loading')
    setMessage('')

    try {
      const ov = await fetchPrototypeDriverOverview()
      setOverview(ov)
      // Seed the vehicle form from the saved profile (once), so the driver sees their registered car.
      setVehicleMake((v) => v || ov.driver.vehicleMake || '')
      setVehicleModel((v) => v || ov.driver.vehicleModel || '')
      setVehiclePlate((v) => v || ov.driver.vehiclePlate || '')
      setVehicleCategory((v) => v || ov.driver.vehicleCategory || '')
      setVehicleYear((v) => v || (ov.driver.vehicleYear != null ? String(ov.driver.vehicleYear) : ''))
      setVehicleColor((v) => v || ov.driver.vehicleColor || '')
      setRegistrationExpiresAt((v) => v || (ov.driver.registrationExpiresAt ? ov.driver.registrationExpiresAt.slice(0, 10) : ''))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function saveVehicle() {
    if (!vehicleMake.trim() || !vehicleModel.trim() || !vehiclePlate.trim()) return
    setVehicleStatus('saving')
    setVehicleErrMsg('')
    try {
      await saveDriverVehicle({
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vehiclePlate: vehiclePlate.trim(),
        vehicleCategory: vehicleCategory || null,
        vehicleYear: vehicleYear.trim() ? Number(vehicleYear.trim()) : null,
        vehicleColor: vehicleColor.trim() || null,
        registrationExpiresAt: registrationExpiresAt ? new Date(registrationExpiresAt).toISOString() : null,
      })
      setVehicleStatus('saved')
    } catch (error) {
      setVehicleStatus('error')
      // Surface the backend message (year/category mismatch, invalid registration date, etc.).
      setVehicleErrMsg(error instanceof Error ? error.message : '')
    }
  }

  // Safety Phase 1 (2026-10-10): the driver's own SOS, shown only while they have an active ride.
  // Confirm first, attach device geolocation when allowed, fall back to a location-less SOS so the
  // alert always goes out. asDriver=true routes it through the driver session.
  async function triggerSos(rideId: string) {
    if (!window.confirm(t.sosConfirm)) return
    setSosState('sending')
    setMessage('')
    const send = async (coords: { lat?: number; lng?: number }) => {
      try {
        await triggerSrSos(rideId, coords, true)
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

  async function refreshOverview() {
    try {
      setOverview(await fetchPrototypeDriverOverview())
    } catch {
      // best-effort refresh; the next poll/action will reconcile
    }
  }

  async function updateRide(rideId: string, nextStatus: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') {
    setStatus('saving')
    setActiveRideId(rideId)
    setMessage('')

    try {
      await updatePrototypeDriverRideStatus(rideId, nextStatus)
      setOverview(await fetchPrototypeDriverOverview())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveRideId('')
    }
  }

  const sosActiveRide = overview?.rides.find((ride) => LIVE_TRACKING_STATUSES.includes(ride.status)) ?? null

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
        <div style={styles.stats}>
          {stats.map((item) => (
            <div key={item.label} style={styles.statBox}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        <button style={styles.primaryButton} onClick={() => void loadOverview()}>
          {status === 'loading' ? t.loading : t.refresh}
        </button>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.dispatchPanel}>
        <article style={styles.dispatchHero}>
          <span>{t.available}</span>
          <strong>{t.dispatch}</strong>
          {claimError && <p style={styles.insuranceWarning}>{claimError}</p>}
          <div style={styles.offerGrid}>
            {!canAccept && <p style={styles.insuranceWarning}>{t.verifyToAccept}</p>}
            {pendingRides.length === 0 ? (
              <p style={{ color: '#9aa6ba' }}>{pendingStatus === 'loading' ? t.pendingLoading : t.pendingEmpty}</p>
            ) : (
              pendingRides.map((pendingRide) => (
                <article key={pendingRide.id} style={styles.offerCard}>
                  <span>{String(pendingRide.metadata.dropoff || '-')}</span>
                  <b dir="ltr">{moneyText(pendingRide.fareMinor || 0, pendingRide.currency, lang)}</b>
                  <small dir="ltr" style={{ color: '#7dd3b0' }}>
                    {t.netEarn}: {moneyText(Math.round((pendingRide.fareMinor || 0) * (1 - (overview?.totals.commissionRate ?? 0.15))), pendingRide.currency, lang)}
                  </small>
                  <i dir="ltr">
                    {pendingRide.metadata.distanceKm ? `${pendingRide.metadata.distanceKm} km` : ''}
                  </i>
                  {pendingRide.accessibilityRequired && <span style={styles.accessibilityBadge}>♿ {t.accessibilityRequired}</span>}
                  {pendingRide.shareable && <span style={styles.accessibilityBadge}>🤝 {t.shareable}</span>}
                  {(pendingRide.stops || []).length > 0 && (
                    <span style={styles.accessibilityBadge}>
                      {pendingRide.stops.length} {t.stopsCount}
                    </span>
                  )}
                  {pendingRide.offeredToYou ? (
                    <>
                      <span style={styles.accessibilityBadge}>⚡ {t.offeredToYou}</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          style={{ flex: 1 }}
                          disabled={!canAccept || claimingRideId === pendingRide.id}
                          onClick={() => void acceptOffer(pendingRide.id)}
                        >
                          {claimingRideId === pendingRide.id ? t.claiming : t.accept}
                        </button>
                        <button
                          style={{ flex: 1 }}
                          disabled={claimingRideId === pendingRide.id}
                          onClick={() => void declineOffer(pendingRide.id)}
                        >
                          {claimingRideId === pendingRide.id ? t.declining : t.decline}
                        </button>
                      </div>
                    </>
                  ) : (
                    <button disabled={!canAccept || claimingRideId === pendingRide.id} onClick={() => void claimRide(pendingRide.id)}>
                      {claimingRideId === pendingRide.id ? t.claiming : t.accept}
                    </button>
                  )}
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section style={{ ...styles.driverIntelligence, gridTemplateColumns: '1fr' }}>
        <article style={styles.docsPanel}>
          <h2>{t.docsStatus}</h2>
          <Info
            label={t.verifiedIdentity}
            value={
              idDocumentStatus === 'APPROVED'
                ? t.identityVerified
                : idDocumentStatus === 'PENDING_REVIEW'
                  ? t.identityPending
                  : t.identityNotVerified
            }
            dir={isAr ? 'rtl' : 'ltr'}
          />
          <label style={styles.locationRow}>
            <input
              type="checkbox"
              checked={overview?.driver.accessibilityCapable || false}
              onChange={(event) => void toggleAccessibility(event.target.checked)}
            />
            {t.accessibilityCapable}
          </label>
          <div style={styles.photoUpload}>
            <strong>{t.photoTitle}</strong>
            <span>{t.photoCopy}</span>
            <label style={styles.photoInputLabel}>
              <input
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                type="file"
                onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              />
              {photoFile ? photoFile.name : t.uploadPhoto}
            </label>
            {photoStatus === 'submitted' && <p style={styles.photoNote}>✓ {t.photoSubmitted}</p>}
            {photoStatus === 'error' && <p style={styles.photoNote}>{t.photoError}</p>}
            <button
              style={styles.photoSubmitButton}
              disabled={!photoFile || photoStatus === 'uploading'}
              onClick={() => void submitPhoto()}
            >
              {photoStatus === 'uploading' ? t.uploading : t.uploadPhoto}
            </button>
          </div>
          <div style={styles.photoUpload}>
            <strong>{t.vehicleTitle}</strong>
            <span>{t.vehicleCopy}</span>
            <input
              style={styles.vehicleInput}
              placeholder={t.vehicleMakeL}
              value={vehicleMake}
              onChange={(event) => { setVehicleMake(event.target.value); setVehicleStatus('idle') }}
            />
            <input
              style={styles.vehicleInput}
              placeholder={t.vehicleModelL}
              value={vehicleModel}
              onChange={(event) => { setVehicleModel(event.target.value); setVehicleStatus('idle') }}
            />
            <input
              style={styles.vehicleInput}
              dir="ltr"
              placeholder={t.vehiclePlateL}
              value={vehiclePlate}
              onChange={(event) => { setVehiclePlate(event.target.value); setVehicleStatus('idle') }}
            />
            <label style={{ fontSize: 13, opacity: 0.85 }}>{t.vehicleYearL}</label>
            <input
              style={styles.vehicleInput}
              dir="ltr"
              type="number"
              inputMode="numeric"
              placeholder={t.vehicleYearL}
              value={vehicleYear}
              onChange={(event) => { setVehicleYear(event.target.value); setVehicleStatus('idle') }}
            />
            <label style={{ fontSize: 13, opacity: 0.85 }}>{t.vehicleColorL}</label>
            <input
              style={styles.vehicleInput}
              placeholder={t.vehicleColorL}
              value={vehicleColor}
              onChange={(event) => { setVehicleColor(event.target.value); setVehicleStatus('idle') }}
            />
            <label style={{ fontSize: 13, opacity: 0.85 }}>{t.registrationExpiryL}</label>
            <input
              style={styles.vehicleInput}
              dir="ltr"
              type="date"
              value={registrationExpiresAt}
              onChange={(event) => { setRegistrationExpiresAt(event.target.value); setVehicleStatus('idle') }}
            />
            <label style={{ fontSize: 13, opacity: 0.85 }}>{t.vehicleCategoryL}</label>
            <select
              style={styles.vehicleInput}
              value={vehicleCategory}
              onChange={(event) => { setVehicleCategory(event.target.value as typeof vehicleCategory); setVehicleStatus('idle') }}
            >
              <option value="">{t.vehicleCategoryChoose}</option>
              <option value="BIKE">{t.catBIKE}</option>
              <option value="ECONOMY">{t.catECONOMY}</option>
              <option value="COMFORT">{t.catCOMFORT}</option>
              <option value="SUV">{t.catSUV}</option>
              <option value="VAN">{t.catVAN}</option>
            </select>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{t.vehicleCategoryHint}</span>
            {overview?.driver.inspectionStatus && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>{t.inspectionL}:</span>
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    background: overview.driver.inspectionStatus === 'PASSED'
                      ? '#1a7f37'
                      : overview.driver.inspectionStatus === 'PENDING'
                        ? '#9a6700'
                        : '#b42318',
                  }}
                >
                  {overview.driver.inspectionStatus === 'PASSED'
                    ? t.inspPASSED
                    : overview.driver.inspectionStatus === 'FAILED'
                      ? t.inspFAILED
                      : overview.driver.inspectionStatus === 'EXPIRED'
                        ? t.inspEXPIRED
                        : t.inspPENDING}
                </span>
              </div>
            )}
            {vehicleStatus === 'saved' && <p style={styles.photoNote}>✓ {t.vehicleSaved}</p>}
            {vehicleStatus === 'error' && <p style={styles.photoNote}>{vehicleErrMsg || t.vehicleErr}</p>}
            <button
              style={styles.photoSubmitButton}
              disabled={vehicleStatus === 'saving' || !vehicleMake.trim() || !vehicleModel.trim() || !vehiclePlate.trim()}
              onClick={() => void saveVehicle()}
            >
              {vehicleStatus === 'saving' ? t.uploading : t.vehicleSave}
            </button>
          </div>
        </article>
      </section>

      <section style={{ ...styles.earningsPanel, gridTemplateColumns: '1fr' }}>
        <div>
          <span>{t.earnings}</span>
          <strong dir="ltr">{moneyText(overview?.totals.earningsMinor || 0, overview?.totals.currency || 'USD', lang)}</strong>
          <small>{isAr ? `${overview?.totals.completed || 0} رحلة مكتملة` : `${overview?.totals.completed || 0} completed rides`}</small>
        </div>
      </section>

      <section style={styles.driverCtas}>
        {sosActiveRide ? (
          <button
            style={styles.sosButton}
            disabled={sosState === 'sending' || sosState === 'sent'}
            onClick={() => void triggerSos(sosActiveRide.id)}
          >
            {sosState === 'sending' ? t.sosSending : sosState === 'sent' ? t.sosSent : t.sos}
          </button>
        ) : (
          <button style={styles.sosButtonIdle} disabled title={t.sosInactive}>{t.sos}</button>
        )}
        <button style={styles.reportButton} onClick={() => (window.location.hash = '/immocontact')}>{t.reportIssue}</button>
        <button style={styles.startButton} onClick={() => (window.location.hash = '/ride')}>{t.start}</button>
      </section>

      <section style={styles.dispatchPanel}>
        <article style={styles.dispatchActions}>
          <strong>{t.nextBest}</strong>
          <p>{t.nextBestText}</p>
          <div style={styles.actions}>
            <button style={styles.secondaryButton} onClick={() => (window.location.hash = '/operations')}>{t.openOperations}</button>
            <button style={styles.primaryButton} onClick={() => (window.location.hash = '/finance')}>{t.openFinance}</button>
          </div>
        </article>
      </section>

      <section style={styles.grid}>
        {overview?.rides.length ? (
          overview.rides.map((ride) => (
            <RideCard
              key={ride.id}
              ride={ride}
              lang={lang}
              labels={t}
              disabled={activeRideId === ride.id || status === 'saving'}
              onUpdate={(nextStatus) => void updateRide(ride.id, nextStatus)}
              onRefresh={() => void refreshOverview()}
            />
          ))
        ) : (
          <section style={styles.panel}>{status === 'loading' ? t.loading : t.empty}</section>
        )}
      </section>
    </main>
  )
}

function RideCard({
  ride,
  lang,
  labels,
  disabled,
  onUpdate,
  onRefresh,
}: {
  ride: PlatformRideRequest
  lang: Lang
  labels: typeof copy.en
  disabled: boolean
  onUpdate: (status: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') => void
  onRefresh: () => void
}) {
  return (
    <article style={styles.card}>
      <strong>{String(ride.metadata.category || ride.id.slice(0, 8).toUpperCase())}</strong>
      <Info label={labels.rider} value={ride.rider?.displayName || ride.riderId.slice(0, 8).toUpperCase()} />
      <Info label={labels.pickup} value={String(ride.metadata.pickup || '-')} />
      <Info label={labels.dropoff} value={String(ride.metadata.dropoff || '-')} />
      <Info label={labels.status} value={statusText(ride.status, lang)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
      <Info label={labels.fare} value={moneyText(ride.fareMinor || 0, ride.currency, lang)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
      {ride.accessibilityRequired && <span style={styles.accessibilityBadge}>♿ {labels.accessibilityRequired}</span>}
      {ride.shareable && <span style={styles.accessibilityBadge}>🤝 {labels.shareable}</span>}
      {(ride.stops || []).map((stop, index) => (
        <Info key={index} label={`${labels.stopLabel} ${index + 1}`} value={stop.address} />
      ))}
      {['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status) && (
        <PickupVerifyPanel ride={ride} lang={lang} onRefresh={onRefresh} />
      )}
      {ride.status !== 'COMPLETED' && ride.status !== 'CANCELLED' && (
        <div style={styles.actions}>
          <button disabled={disabled} style={styles.secondaryButton} onClick={() => onUpdate('DRIVER_ARRIVING')}>
            {labels.arriving}
          </button>
          <button disabled={disabled} style={styles.secondaryButton} onClick={() => onUpdate('IN_PROGRESS')}>
            {labels.start}
          </button>
          <button disabled={disabled} style={styles.primaryButton} onClick={() => onUpdate('COMPLETED')}>
            {labels.complete}
          </button>
          <button disabled={disabled} style={styles.dangerButton} onClick={() => onUpdate('CANCELLED')}>
            {labels.cancel}
          </button>
        </div>
      )}
      {LIVE_TRACKING_STATUSES.includes(ride.status) && <LocationSharingToggle rideId={ride.id} labels={labels} />}
      {MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status) && <RideChatPanel rideId={ride.id} labels={labels} />}
    </article>
  )
}

// Safety Phase 2 (2026-10-10): the driver verifies the rider's 4-digit pickup PIN before starting
// the trip. metadata.pickupVerifiedAt (set server-side on a match) shows a confirmed state; the
// server also hard-gates the IN_PROGRESS transition on it, so this is both the UX and the proof.
function PickupVerifyPanel({
  ride,
  lang,
  onRefresh,
}: {
  ride: PlatformRideRequest
  lang: Lang
  onRefresh: () => void
}) {
  const [code, setCode] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState('')
  const verified = typeof ride.metadata.pickupVerifiedAt === 'string'
  const tr = (ar: string, en: string, fr: string) => (lang === 'ar' ? ar : lang === 'fr' ? fr : en)

  if (verified) {
    return (
      <div style={{ ...styles.verifyBox, borderColor: 'rgba(32,210,155,.5)', background: 'rgba(32,210,155,.08)' }}>
        <span style={{ color: '#20d29b', fontWeight: 900 }}>
          ✓ {tr('تم تأكيد رمز الاستلام', 'Pickup code verified', 'Code de prise en charge vérifié')}
        </span>
      </div>
    )
  }

  async function submit() {
    const trimmed = code.trim()
    if (trimmed.length < 4) return
    setState('saving')
    setError('')
    try {
      await verifySrPickup(ride.id, trimmed)
      setCode('')
      setState('idle')
      onRefresh()
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : tr('تعذّر التحقق', 'Could not verify', 'Échec de la vérification'))
    }
  }

  return (
    <div style={styles.verifyBox}>
      <span style={{ fontSize: 13, fontWeight: 800 }}>
        {tr('أدخل رمز الاستلام من الراكب', 'Enter the rider pickup code', 'Saisissez le code du passager')}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ ...styles.input, flex: 1, letterSpacing: 6, textAlign: 'center' as const, fontWeight: 900 }}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          placeholder="----"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
        <button disabled={code.trim().length < 4 || state === 'saving'} style={styles.primaryButton} onClick={() => void submit()}>
          {state === 'saving' ? tr('جارٍ…', 'Verifying…', 'Vérification…') : tr('تحقّق', 'Verify pickup', 'Vérifier')}
        </button>
      </div>
      {error && <span style={styles.chatEmpty}>{error}</span>}
    </div>
  )
}

// SR Ride vs. Uber gap-closure (P0 #1): mounted only while the ride is in a live-tracking status
// (RideCard's own gate), so leaving that window (completed/cancelled) unmounts this component and
// its cleanup effect stops the watch automatically -- no separate "is this ride still active"
// bookkeeping needed here.
function LocationSharingToggle({ rideId, labels }: { rideId: string; labels: typeof copy.en }) {
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState('')
  const watchIdRef = useRef<number | null>(null)
  const lastSentAtRef = useRef(0)

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [])

  function toggle() {
    if (sharing) {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
      setSharing(false)
      return
    }
    if (!navigator.geolocation) {
      setError(labels.locationUnsupported)
      return
    }
    setError('')
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now()
        if (now - lastSentAtRef.current < LOCATION_REPORT_INTERVAL_MS) return
        lastSentAtRef.current = now
        void reportPrototypeDriverLocation(position.coords.latitude, position.coords.longitude)
      },
      () => setError(labels.locationDenied),
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    setSharing(true)
  }

  return (
    <div style={styles.locationRow}>
      <button style={sharing ? styles.dangerButton : styles.secondaryButton} onClick={toggle}>
        {sharing ? labels.stopSharing : labels.shareLocation}
      </button>
      {error && <span style={styles.chatEmpty}>{error}</span>}
    </div>
  )
}

// SR Ride vs. Uber gap-closure (P0 #4): each ride card manages its own chat state independently
// (collapsed by default -- a list of several active rides would otherwise show every thread open
// at once), reusing the same rideId + thread endpoints the rider's SrRidePage.tsx uses, just with
// the driver-session variant of the API calls.
function RideChatPanel({ rideId, labels }: { rideId: string; labels: typeof copy.en }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<PlatformMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    function poll() {
      fetchPrototypeSrRideThread(rideId, true)
        .then((thread) => {
          if (!cancelled) setMessages(thread.messages)
        })
        .catch(() => {})
    }
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [open, rideId])

  async function send() {
    if (!input.trim()) return
    setSending(true)
    try {
      const sent = await sendPrototypeSrRideMessage(rideId, input.trim(), true)
      setMessages((previous) => [...previous, sent])
      setInput('')
    } catch {
      // Surfacing a dedicated error here would need its own status slot per card; the send button
      // simply re-enables so the driver can retry, consistent with this card's compact footprint.
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={styles.chatPanel}>
      <button style={styles.secondaryButton} onClick={() => setOpen((value) => !value)}>
        {open ? labels.hideChat : labels.messageRider}
      </button>
      {open && (
        <>
          <div style={styles.chatMessages}>
            {messages.length === 0 && <span style={styles.chatEmpty}>{labels.chatEmpty}</span>}
            {messages.map((entry) => (
              <div key={entry.id} style={entry.senderRole === 'DRIVER' ? styles.chatBubbleMine : styles.chatBubbleTheirs}>
                {entry.body}
              </div>
            ))}
          </div>
          <div style={styles.chatInputRow}>
            <input
              style={styles.chatInput}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={labels.chatPlaceholder}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void send()
              }}
            />
            <button disabled={!input.trim() || sending} style={styles.secondaryButton} onClick={() => void send()}>
              {labels.chatSend}
            </button>
          </div>
        </>
      )}
    </div>
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

function DispatchItem({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article style={{ ...styles.dispatchItem, borderColor: `${tone}66` }}>
      <span>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 22, maxWidth: 1120, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e2a3c', borderRadius: 8, padding: 18, background: '#101722', display: 'grid', gap: 14 },
  eyebrow: { color: '#19d7ff', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  statBox: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#9aa6ba', display: 'grid', gap: 4, padding: 12 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  dispatchPanel: { display: 'grid', gap: 12 },
  dispatchHero: { border: '1px solid rgba(82,108,255,.9)', borderRadius: 14, background: '#101119', padding: 28, display: 'grid', gap: 24 },
  offerGrid: { display: 'grid', gap: 18, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  offerCard: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#0b0d14', padding: 16, display: 'grid', gap: 10 },
  driverIntelligence: { display: 'grid', gap: 34, gridTemplateColumns: '1fr 1fr' },
  docsPanel: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#101119', padding: 24, display: 'grid', gap: 12 },
  photoUpload: { display: 'grid', gap: 8, borderTop: '1px solid #1e2a3c', paddingTop: 14, marginTop: 4 },
  photoInputLabel: { border: '1px dashed #2f3b52', borderRadius: 10, padding: 12, textAlign: 'center', color: '#9aa6ba', cursor: 'pointer', fontWeight: 800 },
  photoNote: { margin: 0, color: '#9aa6ba', fontSize: 13 },
  photoSubmitButton: { minHeight: 44, border: 0, borderRadius: 10, background: '#19d7ff', color: '#051014', fontWeight: 950 },
  vehicleInput: { minHeight: 44, border: '1px solid #2f3b52', borderRadius: 10, background: '#0c1220', color: '#fff', padding: '0 12px', fontSize: 15, fontFamily: 'inherit' },
  insuranceWarning: { borderRadius: 10, background: 'rgba(255,82,116,.18)', color: '#ff8aa0', padding: 14, margin: 0, fontWeight: 900 },
  earningsPanel: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#101119', padding: 24, display: 'grid', gap: 22, gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center' },
  driverCtas: { display: 'grid', gap: 28, gridTemplateColumns: '1fr 1fr 1fr' },
  sosButton: { border: 0, borderRadius: 12, background: '#ff5274', color: '#06070c', fontWeight: 950, minHeight: 72, fontSize: 22 },
  sosButtonIdle: { border: '1px solid #4a2230', borderRadius: 12, background: '#1a0f14', color: '#7a5560', fontWeight: 950, minHeight: 72, fontSize: 22 },
  reportButton: { border: '1px solid #30384d', borderRadius: 12, background: '#0b0d14', color: '#fff', fontWeight: 950, minHeight: 72, fontSize: 22 },
  startButton: { border: 0, borderRadius: 12, background: '#526cff', color: '#06110e', fontWeight: 950, minHeight: 72, fontSize: 22 },
  dispatchItem: { border: '1px solid #263651', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 6 },
  dispatchActions: { border: '1px solid #263651', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 8 },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 10 },
  info: { borderTop: '1px solid #263651', display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', paddingTop: 9 },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 12px' },
  secondaryButton: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  dangerButton: { minHeight: 44, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 12px' },
  panel: { border: '1px solid #263651', borderRadius: 8, background: '#101722', color: '#9aa6ba', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  locationRow: { display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid #263651', paddingTop: 10 },
  accessibilityBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(25,215,255,.14)', border: '1px solid rgba(25,215,255,.4)', color: '#19d7ff', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  chatPanel: { display: 'grid', gap: 8, borderTop: '1px solid #263651', paddingTop: 10 },
  chatMessages: { display: 'grid', gap: 6, maxHeight: 180, overflowY: 'auto' },
  chatEmpty: { color: '#5c6b85', fontSize: 13 },
  chatBubbleMine: { justifySelf: 'end', maxWidth: '80%', borderRadius: '10px 10px 2px 10px', background: 'rgba(25,215,255,.14)', border: '1px solid rgba(25,215,255,.35)', color: '#e7fbff', padding: '8px 10px', fontSize: 13 },
  chatBubbleTheirs: { justifySelf: 'start', maxWidth: '80%', borderRadius: '10px 10px 10px 2px', background: '#0d1420', border: '1px solid #263651', color: '#e7ecf5', padding: '8px 10px', fontSize: 13 },
  chatInputRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  chatInput: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  input: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  verifyBox: { border: '2px solid #263651', borderRadius: 10, background: '#0b1119', padding: 12, display: 'grid', gap: 8 },
}
