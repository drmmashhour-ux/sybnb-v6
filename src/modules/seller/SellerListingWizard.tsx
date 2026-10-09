import { useEffect, useMemo, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import { acceptListingAgreement, createAndSubmitPrototypeListing, getStoredSellerSession, uploadPaymentProofFile } from '../../shared/api/platformApi'
import type { CSSVars } from '../../shared/theme/cssVars'
import { sellerCarFilterGroups, sellerMarketFilterGroups, sellerPropertyFilterGroups, sellerRealEstateFilterGroups, type VisualFilterSelection } from '../../engines/filters'
import { getCity, getGovernorate, labelFor, SYRIA_GOVERNORATES } from '../../engines/search'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'

type Props = {
  lang: Lang
}

const FLOW_STORAGE_KEY = 'sybnb_v6_sell_flow'
const DRAFT_STORAGE_KEY = 'sybnb_v6_sell_wizard_draft'

type ListingDivision = 'STAYS' | 'RENTALS' | 'BUY' | 'CARS' | 'MARKETPLACE' | 'NEW_CONSTRUCTION'

const DIVISION_OPTIONS: Array<{ value: ListingDivision; ar: string; en: string; fr: string }> = [
  { value: 'STAYS', ar: 'إيجار يومي', en: 'Daily stay', fr: 'Séjour à la journée' },
  { value: 'RENTALS', ar: 'إيجار شهري', en: 'Monthly rental', fr: 'Location au mois' },
  { value: 'BUY', ar: 'عقار للبيع', en: 'Property for sale', fr: 'Bien à vendre' },
  { value: 'CARS', ar: 'سيارة', en: 'Car', fr: 'Voiture' },
  { value: 'MARKETPLACE', ar: 'منتج أو خدمة', en: 'Product or service', fr: 'Produit ou service' },
  { value: 'NEW_CONSTRUCTION', ar: 'مشروع جديد', en: 'New project', fr: 'Nouveau projet' },
]

type WizardDraft = {
  division: ListingDivision
  selectedType: string
  title: string
  description: string
  governorate: string
  city: string
  area: string
  address: string
  price: string
  size: string
  bedrooms: string
  bathrooms: string
  instantBookEnabled: boolean
  visualFilters: VisualFilterSelection
}

function loadDraft(): Partial<WizardDraft> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function clearDraft() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
}

type WizardStep = {
  id: string
  title: Record<Lang, string>
  helper: Record<Lang, string>
}

const STEPS: WizardStep[] = [
  {
    id: 'basics',
    title: { ar: 'أساسيات الإعلان', en: 'Listing basics', fr: 'Informations de base' },
    helper: { ar: 'نوع العقار والعنوان المختصر.', en: 'Property type and short title.', fr: 'Type de bien et titre court.' },
  },
  {
    id: 'location',
    title: { ar: 'الموقع', en: 'Location', fr: 'Emplacement' },
    helper: { ar: 'المحافظة والمدينة والمنطقة.', en: 'Governorate, city, and area.', fr: 'Gouvernorat, ville et quartier.' },
  },
  {
    id: 'price',
    title: { ar: 'السعر والتفاصيل', en: 'Price and details', fr: 'Prix et détails' },
    helper: { ar: 'السعر والمساحة والغرف.', en: 'Price, size, and rooms.', fr: 'Prix, superficie et pièces.' },
  },
  {
    id: 'media',
    title: { ar: 'الصور والملفات', en: 'Photos and files', fr: 'Photos et fichiers' },
    helper: { ar: 'صور العقار وإثبات الدفع والملكية أو التفويض.', en: 'Property photos, payment proof, and ownership or authorization files.', fr: 'Photos du bien, preuve de paiement et documents de propriété ou de mandat.' },
  },
  {
    id: 'review',
    title: { ar: 'المراجعة والإرسال', en: 'Review and submit', fr: 'Vérification et envoi' },
    helper: { ar: 'تأكد من البيانات قبل إرسالها لفريق SYBNB.', en: 'Confirm details before sending to the SYBNB team.', fr: 'Confirmez les informations avant de les envoyer à l’équipe SYBNB.' },
  },
]

const AD_STEPS: WizardStep[] = [
  {
    id: 'basics',
    title: { ar: 'تفاصيل الإعلان', en: 'Ad details', fr: 'Détails de l’annonce' },
    helper: { ar: 'اسم الإعلان ومكان ظهوره داخل المنصة.', en: 'Ad name and placement inside the platform.', fr: 'Nom de l’annonce et emplacement sur la plateforme.' },
  },
  {
    id: 'media',
    title: { ar: 'صور وملفات الإعلان', en: 'Ad photos and files', fr: 'Photos et fichiers de l’annonce' },
    helper: { ar: 'أضف البانر والملفات حسب الخطة المدفوعة.', en: 'Add banners and files based on the paid plan.', fr: 'Ajoutez les bannières et les fichiers selon le forfait payé.' },
  },
  {
    id: 'review',
    title: { ar: 'الإرسال والموافقة', en: 'Submit and approval', fr: 'Envoi et approbation' },
    helper: { ar: 'أرسل الإعلان للإدارة؛ بعد القبول يصبح منشوراً.', en: 'Send the ad to admin; after approval it becomes published.', fr: 'Envoyez l’annonce à l’administration ; elle sera publiée après approbation.' },
  },
]

const PROPERTY_TYPES = [
  { ar: 'شقة', en: 'Apartment', fr: 'Appartement' },
  { ar: 'منزل عائلي', en: 'Family house', fr: 'Maison familiale' },
  { ar: 'فيلا', en: 'Villa', fr: 'Villa' },
  { ar: 'محل تجاري', en: 'Commercial', fr: 'Local commercial' },
  { ar: 'أرض', en: 'Land', fr: 'Terrain' },
  { ar: 'مشروع جديد', en: 'New project', fr: 'Nouveau projet' },
]

// Only 'Landing page' is a real, built display surface (the landing page's "Sponsored" section --
// see /api/advertising/active). Offering Search page/Division pages/Whole platform here would be a
// choice with no effect: an advertiser picking one of those would get nothing shown anywhere,
// silently. Reduced to the one option that's actually true, matching this codebase's own
// no-fake-choice standard (see the removed "Featured ads" marquee note on the landing page).
const AD_PLACEMENTS = [{ ar: 'الرئيسية', en: 'Landing page', fr: 'Page d’accueil' }]

// `days` is the real, server-enforced expiry (server/routes/listings.mjs reads
// metadata.adDurationDays at creation time) -- not just display text. Keep this in sync with
// whatever labels are offered here; the label alone is never sent to the server.
const AD_DURATIONS = [
  { ar: 'أسبوع واحد', en: 'One week', fr: 'Une semaine', days: 7 },
  { ar: 'شهر واحد', en: 'One month', fr: 'Un mois', days: 30 },
  { ar: 'ثلاثة أشهر', en: 'Three months', fr: 'Trois mois', days: 90 },
]

export function SellerListingWizard({ lang }: Props) {
  const isAr = lang === 'ar'
  const isAdvertisingFlow = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(FLOW_STORAGE_KEY) === 'advertising'
  }, [])
  const adPlan = useMemo(() => {
    if (typeof window === 'undefined') return 'plus'
    const stored = window.localStorage.getItem('sybnb_v6_advertising_plan')
    return stored === 'premium' ? 'premium' : 'plus'
  }, [])
  const adFileSlots =
    adPlan === 'premium'
      ? [
          { id: 'desktopBanner', ar: 'بانر سطح المكتب', en: 'Desktop banner', fr: 'Bannière ordinateur' },
          { id: 'tabletBanner', ar: 'بانر التابلت', en: 'Tablet banner', fr: 'Bannière tablette' },
          { id: 'phoneBanner', ar: 'بانر الهاتف', en: 'Phone banner', fr: 'Bannière téléphone' },
          { id: 'brandLogo', ar: 'شعار الشركة', en: 'Brand logo', fr: 'Logo de l’entreprise' },
          { id: 'documents', ar: 'ملفات الشركة أو الحملة', en: 'Company or campaign documents', fr: 'Documents de l’entreprise ou de la campagne' },
        ]
      : [
          { id: 'mainBanner', ar: 'بانر الإعلان الرئيسي', en: 'Main ad banner', fr: 'Bannière publicitaire principale' },
          { id: 'brandLogo', ar: 'شعار الشركة', en: 'Brand logo', fr: 'Logo de l’entreprise' },
          { id: 'documents', ar: 'ملفات الشركة أو الحملة', en: 'Company or campaign documents', fr: 'Documents de l’entreprise ou de la campagne' },
        ]
  // 'documents' has its own real upload widget below (uploadedDocumentUrls) -- these are the
  // image slots (banners/logo) that need their own real per-slot upload.
  const bannerSlots = adFileSlots.filter((item) => item.id !== 'documents')
  const draft = useMemo(() => loadDraft(), [])
  const [stepIndex, setStepIndex] = useState(0)
  const [division, setDivision] = useState<ListingDivision>(draft.division || 'STAYS')
  const [selectedType, setSelectedType] = useState(draft.selectedType || PROPERTY_TYPES[0].en)
  const [title, setTitle] = useState(draft.title ?? (pick(lang, 'شقة مفروشة قرب المالكي', 'Furnished apartment near Malki', 'Appartement meublé près de Malki')))
  const [description, setDescription] = useState(
    draft.description ?? (pick(lang, 'شقة جاهزة للسكن مع وصول سريع للخدمات.', 'Ready-to-live apartment with quick service access.', 'Appartement prêt à habiter avec un accès rapide aux services.')),
  )
  const [governorate, setGovernorate] = useState(draft.governorate || 'damascus')
  const [city, setCity] = useState(draft.city || 'damascus-city')
  const [area, setArea] = useState(draft.area || 'old-city')
  const [address, setAddress] = useState(draft.address ?? (pick(lang, 'قرب شارع رئيسي', 'Near a main street', 'Près d’une rue principale')))
  const [price, setPrice] = useState(draft.price || '250000')
  const [size, setSize] = useState(draft.size || '110')
  const [bedrooms, setBedrooms] = useState(draft.bedrooms || '3')
  const [bathrooms, setBathrooms] = useState(draft.bathrooms || '2')
  const [instantBookEnabled, setInstantBookEnabled] = useState(draft.instantBookEnabled ?? false)
  const [adPlacement, setAdPlacement] = useState(pick(lang, 'الرئيسية', 'Landing page', 'Page d’accueil'))
  const [adDuration, setAdDuration] = useState(pick(lang, 'أسبوع واحد', 'One week', 'Une semaine'))
  // Real per-slot banner/logo uploads (slot id -> uploaded file). Replaces a prior version of this
  // grid that was a plain button toggling local state with zero network request -- an advertiser
  // could believe they'd sent a real banner when nothing was ever uploaded.
  const [adSlotUploads, setAdSlotUploads] = useState<Record<string, { fileName: string; url: string }>>({})
  const [adSlotUploadError, setAdSlotUploadError] = useState('')
  const [uploadedDocumentFiles, setUploadedDocumentFiles] = useState<string[]>([])
  const [uploadedDocumentUrls, setUploadedDocumentUrls] = useState<string[]>([])
  const [documentUploadError, setDocumentUploadError] = useState('')
  // A real bug caught by an independent re-audit: the "Photos and files" step told sellers to
  // upload property photos, and the uploads genuinely reached real storage -- but they landed in
  // this same flat uploadedDocumentUrls array as ownership proof/authorization/payment proof, and
  // the actual public listing.media sent to the server was unconditionally the hardcoded
  // hardcoded per-division stock image (see `next()` below), so every real photo was silently discarded.
  // Separate photo state + its own upload widget fixes this at the root.
  const [uploadedPhotoFiles, setUploadedPhotoFiles] = useState<string[]>([])
  const [uploadedPhotoUrls, setUploadedPhotoUrls] = useState<string[]>([])
  const [photoUploadError, setPhotoUploadError] = useState('')
  const [adFilesSent, setAdFilesSent] = useState(false)
  const [visualFilters, setVisualFilters] = useState<VisualFilterSelection>(
    draft.visualFilters || {
      propertyType: 'apartment',
      roomType: 'doubleRoom',
      bedType: 'queenBed',
      amenities: ['wifi', 'kitchen'],
    },
  )
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'error'>('idle')
  // Required alongside ID verification before a listing can be published (server-enforced too —
  // see /api/listings/:id/submit). ID verification itself happens on the seller's account page.
  const [agreementAccepted, setAgreementAccepted] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nextDraft: WizardDraft = {
      division,
      selectedType,
      title,
      description,
      governorate,
      city,
      area,
      address,
      price,
      size,
      bedrooms,
      bathrooms,
      instantBookEnabled,
      visualFilters,
    }
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDraft))
  }, [division, selectedType, title, description, governorate, city, area, address, price, size, bedrooms, bathrooms, instantBookEnabled, visualFilters])
  const steps = isAdvertisingFlow ? AD_STEPS : STEPS
  const activeStep = steps[stepIndex]
  const progress = useMemo(() => `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`, [stepIndex, steps.length])
  const isLast = stepIndex === steps.length - 1
  const selectedGovernorateData = getGovernorate(governorate)
  const selectedCityData = getCity(governorate, city)
  const selectedAreaData = selectedCityData?.areas.find((item) => item.key === area)
  const selectedGovernorateLabel = labelFor(lang, selectedGovernorateData)
  const selectedCityLabel = labelFor(lang, selectedCityData)
  const selectedAreaLabel = labelFor(lang, selectedAreaData)

  function chooseGovernorate(value: string) {
    const nextGovernorate = getGovernorate(value)
    const nextCity = nextGovernorate?.cities[0]
    setGovernorate(value)
    setCity(nextCity?.key || '')
    setArea(nextCity?.areas[0]?.key || '')
  }

  function chooseCity(value: string) {
    const nextCity = getCity(governorate, value)
    setCity(value)
    setArea(nextCity?.areas[0]?.key || '')
  }

  const next = async () => {
    if (isLast) {
      if (isAdvertisingFlow && (!adFilesSent || !uploadedDocumentUrls.length)) {
        setSubmitState('error')
        setSubmitError(pick(lang, 'ارفع مستندات الإعلان وأرسل الصور والملفات للإدارة قبل المتابعة.', 'Upload ad documents and send photos/files to admin before continuing.', 'Téléversez les documents de l’annonce et envoyez les photos et fichiers à l’administration avant de continuer.'))
        return
      }
      if (!isAdvertisingFlow && !uploadedDocumentUrls.length) {
        setSubmitState('error')
        setSubmitError(pick(lang, 'ارفع مستندات البائع أو إثبات الملكية قبل إرسال الإعلان للمراجعة.', 'Upload seller documents or ownership proof before sending the listing for review.', 'Téléversez les documents du vendeur ou la preuve de propriété avant d’envoyer l’annonce pour vérification.'))
        return
      }
      if (!agreementAccepted) {
        setSubmitState('error')
        setSubmitError(pick(lang, 'وافق على اتفاقية النشر قبل الإرسال.', 'Accept the listing agreement before submitting.', 'Acceptez l’entente de publication avant l’envoi.'))
        return
      }

      setSubmitState('submitting')
      setSubmitError('')

      try {
        // Record the agreement acceptance server-side. This — plus an admin-approved ID — is
        // required by /api/listings/:id/submit before the listing can go to review.
        await acceptListingAgreement()
        // Real seller-uploaded photos only -- no hardcoded per-division stock image forced in.
        // A listing with zero real photos correctly stays empty; listingImage()/hasRealPhoto() on
        // the browse and detail pages already handle that honestly (generic tile + a real
        // "No photos yet" badge), the same pattern already proven for STAYS.
        // Ad banners/logo attach as real ListingMedia too (kind = slot id, e.g. 'desktopBanner')
        // instead of only living in metadata, so the real display surface can query them the same
        // way every other listing's images are served.
        const listingMedia = isAdvertisingFlow
          ? Object.entries(adSlotUploads).map(([slotId, upload], index) => ({ url: upload.url, kind: slotId, sortOrder: index }))
          : uploadedPhotoUrls.map((url, index) => ({ url, kind: 'image', sortOrder: index }))
        await createAndSubmitPrototypeListing({
          // Ads must be division='MARKETPLACE' -- that's what gates listing creation behind an
          // admin-approved paid seller plan (PAID_PLAN_DIVISIONS in server/routes/listings.mjs).
          // Leaving this as the property-flow's default 'STAYS' meant an ad could reach
          // PENDING_REVIEW/APPROVED without the required plan payment ever being verified.
          division: isAdvertisingFlow ? 'MARKETPLACE' : division,
          titleAr: title || 'إعلان SYBNB جديد',
          titleEn: title,
          description,
          priceMinor: toMinor(price),
          currency: 'SYP',
          instantBookEnabled: division === 'STAYS' ? instantBookEnabled : false,
          media: listingMedia,
          metadata: {
            advertising: isAdvertisingFlow,
            adPlan,
            adPlacement,
            adDuration,
            adDurationDays: AD_DURATIONS.find((item) => item[lang] === adDuration)?.days,
            uploadedDocumentFiles,
            uploadedDocumentUrls,
            propertyType: selectedType,
            governorate,
            city,
            area,
            address,
            governorateLabel: selectedGovernorateLabel,
            cityLabel: selectedCityLabel,
            areaLabel: selectedAreaLabel,
            sizeSqm: toNumber(size),
            bedrooms: toNumber(bedrooms),
            bathrooms: toNumber(bathrooms),
            visualFilters,
          },
        })
        clearDraft()
        navigate('/sell/submitted')
      } catch (error) {
        setSubmitState('error')
        setSubmitError(error instanceof Error ? error.message : 'Unable to submit listing.')
      }
      return
    }

    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  async function addListingPhotoFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    setUploadedPhotoFiles((current) => Array.from(new Set([...current, ...files.map((file) => file.name)])))
    setPhotoUploadError('')

    const session = getStoredSellerSession()
    if (!session) {
      setPhotoUploadError(pick(lang, 'سجّل الدخول أولاً لرفع الصور.', 'Sign in first to upload photos.', 'Connectez-vous d’abord pour téléverser des photos.'))
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setUploadedPhotoUrls((current) => [...current, ...urls])
    } catch (error) {
      setPhotoUploadError(error instanceof Error ? error.message : (pick(lang, 'تعذر رفع الصورة.', 'Could not upload the photo.', 'Impossible de téléverser la photo.')))
    }
  }

  async function addListingDocumentFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    setUploadedDocumentFiles((current) => Array.from(new Set([...current, ...files.map((file) => file.name)])))
    setAdFilesSent(false)
    setDocumentUploadError('')

    const session = getStoredSellerSession()
    if (!session) {
      setDocumentUploadError(pick(lang, 'سجّل الدخول أولاً لرفع المستندات.', 'Sign in first to upload documents.', 'Connectez-vous d’abord pour téléverser des documents.'))
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setUploadedDocumentUrls((current) => [...current, ...urls])
    } catch (error) {
      setDocumentUploadError(error instanceof Error ? error.message : (pick(lang, 'تعذر رفع الملف.', 'Could not upload the file.', 'Impossible de téléverser le fichier.')))
    }
  }

  async function addAdSlotFile(slotId: string, fileList: FileList | null) {
    const file = Array.from(fileList || [])[0]
    if (!file) return

    setAdSlotUploadError('')
    const session = getStoredSellerSession()
    if (!session) {
      setAdSlotUploadError(pick(lang, 'سجّل الدخول أولاً لرفع الملفات.', 'Sign in first to upload files.', 'Connectez-vous d’abord pour téléverser des fichiers.'))
      return
    }
    try {
      const url = await uploadPaymentProofFile(file, session.token)
      setAdSlotUploads((current) => ({ ...current, [slotId]: { fileName: file.name, url } }))
      setAdFilesSent(false)
    } catch (error) {
      setAdSlotUploadError(error instanceof Error ? error.message : (pick(lang, 'تعذر رفع الملف.', 'Could not upload the file.', 'Impossible de téléverser le fichier.')))
    }
  }

  const back = () => {
    if (stepIndex === 0) {
      navigate('/sell/account')
      return
    }

    setStepIndex((current) => Math.max(current - 1, 0))
  }

  return (
    <main className="seller-page seller-wizard-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-account-head">
        <BrandLogo logo="plus" size="nav" />
      </section>

      <section className="seller-wizard-shell">
        <div className="seller-wizard-header">
          <p className="eyebrow">
            {isAdvertisingFlow
              ? pick(lang, 'معالج الإعلان', 'Advertising wizard', 'Assistant publicitaire')
              : pick(lang, `معالج نشر ${DIVISION_OPTIONS.find((item) => item.value === division)?.ar || 'الإعلان'}`, `Listing wizard · ${DIVISION_OPTIONS.find((item) => item.value === division)?.en || ''}`, `Assistant de publication · ${DIVISION_OPTIONS.find((item) => item.value === division)?.fr || ''}`)}
          </p>
          <h1>{activeStep.title[lang]}</h1>
          <p>{activeStep.helper[lang]}</p>
          <div className="seller-progress-track" aria-label={pick(lang, 'تقدم الخطوات', 'Step progress', 'Progression des étapes')}>
            <span style={{ width: progress }} />
          </div>
          <div className="seller-step-chips">
            {steps.map((step, index) => (
              <button
                className={index === stepIndex ? 'active' : ''}
                key={step.id}
                onClick={() => setStepIndex(index)}
              >
                {index + 1}. {step.title[lang]}
              </button>
            ))}
          </div>
        </div>

        <div className="seller-wizard-body">
          {activeStep.id === 'basics' && (
            <div className="seller-wizard-section">
              {!isAdvertisingFlow && (
                <TouchChoiceGroup
                  active={DIVISION_OPTIONS.find((item) => item.value === division)?.[lang] || ''}
                  items={DIVISION_OPTIONS.map((item) => item[lang])}
                  onChange={(label) => {
                    const next = DIVISION_OPTIONS.find((item) => item[lang] === label)
                    if (next && next.value !== division) {
                      // Cars and property divisions use different visual-filter groups. Clear the
                      // division-specific selection when switching so a previous division's keys
                      // (e.g. Cars' carBrand) can't leak into the next division's submission.
                      setVisualFilters({})
                      setSelectedType(PROPERTY_TYPES[0].en)
                      setDivision(next.value)
                    }
                  }}
                  title={pick(lang, 'القسم', 'Division', 'Section')}
                />
              )}
              {!isAdvertisingFlow && division === 'CARS' && (
                <VisualFilterPanel
                  compact
                  groups={sellerCarFilterGroups}
                  lang={lang}
                  selection={visualFilters}
                  onChange={setVisualFilters}
                />
              )}
              {!isAdvertisingFlow && division === 'MARKETPLACE' && (
                <VisualFilterPanel
                  compact
                  groups={sellerMarketFilterGroups}
                  lang={lang}
                  selection={visualFilters}
                  onChange={setVisualFilters}
                />
              )}
              {!isAdvertisingFlow && division !== 'CARS' && division !== 'MARKETPLACE' && (
                <VisualFilterPanel
                  compact
                  groups={division === 'STAYS' ? sellerPropertyFilterGroups : sellerRealEstateFilterGroups}
                  lang={lang}
                  selection={visualFilters}
                  onChange={(nextFilters) => {
                    setVisualFilters(nextFilters)
                    setSelectedType(String(nextFilters.propertyType || selectedType))
                  }}
                />
              )}
              <label className="seller-wide-field">
                <span>{isAdvertisingFlow ? (pick(lang, 'اسم الحملة الإعلانية', 'Campaign name', 'Nom de la campagne')) : pick(lang, 'عنوان الإعلان', 'Listing title', 'Titre de l’annonce')}</span>
                <input
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={isAdvertisingFlow ? (pick(lang, 'مثال: إعلان مشروع جديد', 'Example: New project campaign', 'Exemple : campagne pour un nouveau projet')) : pick(lang, 'مثال: شقة مفروشة قرب المالكي', 'Example: Furnished apartment near Malki', 'Exemple : appartement meublé près de Malki')}
                  value={title}
                />
              </label>
              <label className="seller-wide-field">
                <span>{isAdvertisingFlow ? (pick(lang, 'وصف الإعلان', 'Ad description', 'Description de l’annonce publicitaire')) : pick(lang, 'وصف مختصر', 'Short description', 'Description courte')}</span>
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={isAdvertisingFlow ? (pick(lang, 'اكتب هدف الإعلان والجمهور المطلوب.', 'Write the ad goal and target audience.', 'Indiquez l’objectif de l’annonce et le public visé.')) : pick(lang, 'اكتب أهم تفاصيل العقار بوضوح.', 'Write the key property details clearly.', 'Décrivez clairement les principales caractéristiques du bien.')}
                  value={description}
                />
              </label>
              {isAdvertisingFlow && (
                <div className="seller-form-grid">
                  <TouchChoiceGroup
                    active={adPlacement}
                    items={AD_PLACEMENTS.map((item) => item[lang])}
                    onChange={setAdPlacement}
                    title={pick(lang, 'مكان الظهور', 'Placement', 'Emplacement')}
                  />
                  <TouchChoiceGroup
                    active={adDuration}
                    items={AD_DURATIONS.map((item) => item[lang])}
                    onChange={setAdDuration}
                    title={pick(lang, 'مدة الإعلان', 'Ad duration', 'Durée de l’annonce')}
                  />
                </div>
              )}
            </div>
          )}

          {activeStep.id === 'location' && (
            <div className="seller-wizard-section">
              <div className="seller-location-capsule">
                <div className="seller-location-summary">
                  <span>{pick(lang, 'الموقع المختار', 'Selected location', 'Emplacement choisi')}</span>
                  <strong>{[selectedGovernorateLabel, selectedCityLabel, selectedAreaLabel].filter(Boolean).join(' ← ')}</strong>
                </div>
                <div className="seller-location-group">
                  <span>{pick(lang, 'المحافظة', 'Governorate', 'Gouvernorat')}</span>
                  <div className="seller-location-options">
                    {SYRIA_GOVERNORATES.map((item) => (
                      <button className={item.key === governorate ? 'active' : ''} key={item.key} onClick={() => chooseGovernorate(item.key)}>
                        {labelFor(lang, item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{pick(lang, 'المدينة / القضاء', 'City / district', 'Ville / district')}</span>
                  <div className="seller-location-options">
                    {(selectedGovernorateData?.cities || []).map((item) => (
                      <button className={item.key === city ? 'active' : ''} key={item.key} onClick={() => chooseCity(item.key)}>
                        {labelFor(lang, item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{pick(lang, 'المنطقة / الشارع', 'Area / street', 'Quartier / rue')}</span>
                  <div className="seller-location-options">
                    {(selectedCityData?.areas || []).map((item) => (
                      <button className={item.key === area ? 'active' : ''} key={item.key} onClick={() => setArea(item.key)}>
                        {labelFor(lang, item)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="seller-wide-field">
                <span>{pick(lang, 'العنوان التفصيلي', 'Detailed address', 'Adresse détaillée')}</span>
                <input
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={pick(lang, 'اسم الشارع أو أقرب معلم', 'Street name or nearest landmark', 'Nom de la rue ou point de repère le plus proche')}
                  value={address}
                />
              </label>
              <div className="seller-map-placeholder">
                <strong>{pick(lang, 'تصحيح الموقع لاحقاً', 'Location correction later', 'Correction de l’emplacement plus tard')}</strong>
                <span>{pick(lang, 'سيتم ربط الخريطة بعد تثبيت محرك البحث والمواقع.', 'Map will connect after the search and location engine is stabilized.', 'La carte sera connectée une fois le moteur de recherche et de localisation stabilisé.')}</span>
              </div>
            </div>
          )}

          {activeStep.id === 'price' && !isAdvertisingFlow && (
            <div className="seller-wizard-section seller-form-grid">
              <label>
                <span>{pick(lang, 'السعر المطلوب', 'Asking price', 'Prix demandé')}</span>
                <input dir="ltr" onChange={(event) => setPrice(event.target.value)} placeholder="250000" value={price} />
              </label>
              <label>
                <span>{pick(lang, 'المساحة', 'Area', 'Superficie')}</span>
                <input dir="ltr" onChange={(event) => setSize(event.target.value)} placeholder="110 m2" value={size} />
              </label>
              <label>
                <span>{pick(lang, 'غرف النوم', 'Bedrooms', 'Chambres')}</span>
                <input dir="ltr" onChange={(event) => setBedrooms(event.target.value)} placeholder="3" value={bedrooms} />
              </label>
              <label>
                <span>{pick(lang, 'الحمامات', 'Bathrooms', 'Salles de bain')}</span>
                <input dir="ltr" onChange={(event) => setBathrooms(event.target.value)} placeholder="2" value={bathrooms} />
              </label>
              {division === 'STAYS' && (
                <label className="seller-wide-field seller-instant-book-toggle">
                  <input type="checkbox" checked={instantBookEnabled} onChange={(event) => setInstantBookEnabled(event.target.checked)} />
                  <span>
                    <strong>{pick(lang, '⚡ تفعيل الحجز الفوري', '⚡ Enable Instant Book', '⚡ Activer la réservation instantanée')}</strong>
                    <small>
                      {pick(lang, 'يتأكد حجز الضيف تلقائياً فور نجاح الدفع، دون انتظار موافقتك اليدوية.', 'Guest bookings confirm automatically once payment succeeds, without waiting for your manual approval.', 'Les réservations des voyageurs sont confirmées automatiquement dès que le paiement réussit, sans attendre votre approbation manuelle.')}
                    </small>
                  </span>
                </label>
              )}
              {division === 'STAYS' && (
                <div className="seller-wide-field seller-money-note">
                  {pick(lang, 'تخصم SYBNB عمولة خدمة 12% من إجمالي قيمة الحجز (عدا رسوم الحماية) من مستحقاتك عند كل حجز مكتمل.', 'SYBNB deducts a 12% service commission of the total booking amount (excluding the protection fee) from your payout on every completed booking.', 'SYBNB déduit de votre versement une commission de service de 12 % du montant total de la réservation (hors frais de protection) pour chaque réservation terminée.')}
                </div>
              )}
              <div className="seller-wide-field">
                <VisualFilterPanel
                  compact
                  groups={(division === 'STAYS' ? sellerPropertyFilterGroups : sellerRealEstateFilterGroups).slice(1)}
                  lang={lang}
                  selection={visualFilters}
                  onChange={setVisualFilters}
                />
              </div>
              <div className="seller-money-note">
                {pick(lang, 'السعر يظهر للزوار كما يكتبه البائع، مع إمكانية التفاوض عبر IMMOContact.', 'The price appears to visitors as entered, with negotiation through IMMOContact.', 'Le prix s’affiche aux visiteurs tel que saisi, avec possibilité de négociation via IMMOContact.')}
              </div>
            </div>
          )}

          {activeStep.id === 'media' && (
            <div className="seller-wizard-section">
              {isAdvertisingFlow && (
              <div className="seller-upload-grid">
                {bannerSlots.map((item) => (
                  <PaymentProofUpload
                    cta={pick(lang, `رفع ${item.ar}`, `Upload ${item.en}`, `Téléverser : ${item.fr}`)}
                    emptyText={pick(lang, 'لم يتم رفع الملف بعد.', 'No file uploaded yet.', 'Aucun fichier téléversé pour l’instant.')}
                    files={adSlotUploads[item.id] ? [adSlotUploads[item.id].fileName] : []}
                    help={pick(lang, 'PNG أو JPG.', 'PNG or JPG.', 'PNG ou JPG.')}
                    key={item.id}
                    lang={lang}
                    onAddFiles={(files) => void addAdSlotFile(item.id, files)}
                    title={item[lang]}
                  />
                ))}
              </div>
              )}
              {isAdvertisingFlow && adSlotUploadError && (
                <p className="seller-note-line" style={{ color: '#ff5f7d' }}>{adSlotUploadError}</p>
              )}
              {isAdvertisingFlow && (
                <div className={`seller-ad-send-panel ${adFilesSent ? 'sent' : ''}`}>
                  <strong>{adPlan === 'premium' ? (pick(lang, 'خطة Premium', 'Premium plan', 'Forfait Premium')) : pick(lang, 'خطة Plus', 'Plus plan', 'Forfait Plus')}</strong>
                  <span>
                    {pick(lang, `تم رفع ${Object.keys(adSlotUploads).length} من ${bannerSlots.length} ملفات مطلوبة ورفع ${uploadedDocumentUrls.length} مستند.`, `${Object.keys(adSlotUploads).length} of ${bannerSlots.length} required files uploaded and ${uploadedDocumentUrls.length} document uploaded.`, `${Object.keys(adSlotUploads).length} fichier(s) requis sur ${bannerSlots.length} téléversé(s) et ${uploadedDocumentUrls.length} document(s) téléversé(s).`)}
                  </span>
                  <button
                    disabled={bannerSlots.some((item) => !adSlotUploads[item.id]) || uploadedDocumentUrls.length < 1}
                    onClick={() => setAdFilesSent(true)}
                  >
                    {adFilesSent ? (pick(lang, 'تم إرسال الملفات للإدارة', 'Files sent to admin', 'Fichiers envoyés à l’administration')) : pick(lang, 'إرسال الملفات للإدارة', 'Send files to admin', 'Envoyer les fichiers à l’administration')}
                  </button>
                </div>
              )}
              {!isAdvertisingFlow && (
                <>
                  <PaymentProofUpload
                    cta={pick(lang, 'رفع صور العقار/المركبة/المنتج', 'Upload property/car/item photos', 'Téléverser les photos du bien, du véhicule ou de l’article')}
                    emptyText={pick(lang, 'لم يتم رفع صور بعد. تظهر "لا توجد صور بعد" للزوار حتى ترفع صورة حقيقية.', 'No photos uploaded yet. Visitors see "No photos yet" until a real photo is uploaded.', 'Aucune photo téléversée pour l’instant. Les visiteurs voient « Aucune photo pour l’instant » jusqu’à ce qu’une vraie photo soit téléversée.')}
                    files={uploadedPhotoFiles}
                    help={pick(lang, 'هذه الصور هي ما سيراه الزوار فعلياً في نتائج البحث وصفحة التفاصيل. PNG أو JPG.', 'These are the actual photos visitors will see in search results and the detail page. PNG or JPG.', 'Ce sont les photos que les visiteurs verront réellement dans les résultats de recherche et sur la page de détails. PNG ou JPG.')}
                    lang={lang}
                    onAddFiles={(files) => void addListingPhotoFiles(files)}
                    title={pick(lang, 'صور الإعلان', 'Listing photos', 'Photos de l’annonce')}
                  />
                  {photoUploadError && <p className="seller-note-line" style={{ color: '#ff5f7d' }}>{photoUploadError}</p>}
                </>
              )}
              <PaymentProofUpload
                cta={isAdvertisingFlow ? (pick(lang, 'رفع مستندات الإعلان', 'Upload ad documents', 'Téléverser les documents de l’annonce')) : pick(lang, 'رفع مستندات البائع', 'Upload seller documents', 'Téléverser les documents du vendeur')}
                emptyText={pick(lang, 'لم يتم رفع مستندات بعد. ارفع PDF أو PNG أو JPG.', 'No documents uploaded yet. Upload PDF, PNG, or JPG.', 'Aucun document téléversé pour l’instant. Téléversez un PDF, PNG ou JPG.')}
                files={uploadedDocumentFiles}
                help={
                  isAdvertisingFlow
                    ? pick(lang, 'ارفع إثبات الدفع، ملفات الحملة، التفويض، أو صور النشاط حسب الخطة.', 'Upload payment proof, campaign files, authorization, or business photos based on the plan.', 'Téléversez la preuve de paiement, les fichiers de la campagne, le mandat ou les photos de l’entreprise selon le forfait.')
                    : pick(lang, 'ارفع إثبات الملكية، التفويض، والمخططات أو ملفات السيارة/المشروع (ليست صور الإعلان — ارفعها أعلاه).', 'Upload ownership proof, authorization, and plans or car/project files (not listing photos — upload those above).', 'Téléversez la preuve de propriété, le mandat et les plans ou les fichiers du véhicule ou du projet (pas les photos de l’annonce — téléversez-les ci-dessus).')
                }
                lang={lang}
                onAddFiles={(files) => void addListingDocumentFiles(files)}
                title={isAdvertisingFlow ? (pick(lang, 'مستندات الإعلان والخطة', 'Ad and plan documents', 'Documents de l’annonce et du forfait')) : pick(lang, 'مستندات البائع', 'Seller documents', 'Documents du vendeur')}
              />
              {documentUploadError && <p className="seller-note-line" style={{ color: '#ff5f7d' }}>{documentUploadError}</p>}
              <p className="seller-note-line">
                {isAdvertisingFlow
                  ? pick(lang, 'لن يظهر الإعلان للزوار قبل موافقة الإدارة. بعد القبول تتحول الحالة إلى منشور.', 'The ad will not appear to visitors before admin approval. After acceptance, status becomes published.', 'L’annonce ne sera pas visible par les visiteurs avant l’approbation de l’administration. Une fois acceptée, son statut devient « publiée ».')
                  : pick(lang, 'الملفات الثقيلة تُراجع من الإدارة ولا تظهر للزوار إلا إذا كانت ضمن خطة تسمح بذلك.', 'Heavy files are reviewed by admin and only shown to visitors when the plan allows it.', 'Les fichiers volumineux sont vérifiés par l’administration et ne sont visibles par les visiteurs que si le forfait le permet.')}
              </p>
            </div>
          )}

          {activeStep.id === 'review' && (
            <div className="seller-wizard-section">
              <div className="seller-review-card" style={{ '--accent': '#d5a915' } as CSSVars}>
                <p>{pick(lang, 'جاهز للإرسال', 'Ready to submit', 'Prêt à envoyer')}</p>
                <h2>{isAdvertisingFlow ? (pick(lang, 'سيتم إرسال الإعلان للإدارة', 'Ad will be sent to admin', 'L’annonce sera envoyée à l’administration')) : pick(lang, 'سيتم إرسال الإعلان للمراجعة', 'Listing will be sent for review', 'L’annonce sera envoyée pour vérification')}</h2>
                <ul>
                  <li>{pick(lang, 'قرار الإدارة: قبول / طلب معلومات / رفض', 'Admin decision: approve / need info / reject', 'Décision de l’administration : approuver / demander des informations / refuser')}</li>
                  <li>{pick(lang, 'المقبول يصبح منشوراً', 'Approved becomes published', 'Une annonce approuvée est publiée')}</li>
                  <li>
                    {isAdvertisingFlow
                      ? pick(lang, 'تم تجهيز طلب الإعلان من مسار الدفع والإرسال.', 'The advertising request was prepared through the payment and submission flow.', 'La demande publicitaire a été préparée via le parcours de paiement et d’envoi.')
                      : uploadedDocumentUrls.length
                        ? pick(lang, 'تم رفع مستندات البائع المطلوبة قبل الإرسال.', 'Required seller documents were uploaded before submission.', 'Les documents requis du vendeur ont été téléversés avant l’envoi.')
                        : pick(lang, 'لا يمكن الإرسال قبل رفع مستندات البائع.', 'Submission is blocked until seller documents are uploaded.', 'L’envoi est bloqué tant que les documents du vendeur ne sont pas téléversés.')}
                  </li>
                  <li>
                    {isAdvertisingFlow
                      ? adFilesSent
                        ? pick(lang, 'تم إرسال الصور والمستندات للإدارة', 'Photos and documents were sent to admin', 'Les photos et les documents ont été envoyés à l’administration')
                        : pick(lang, 'أرسل الصور والمستندات قبل الإرسال النهائي', 'Send photos and documents before final submission', 'Envoyez les photos et les documents avant l’envoi final')
                      : uploadedDocumentUrls.length
                        ? pick(lang, `تم رفع ${uploadedDocumentUrls.length} مستند للبائع`, `${uploadedDocumentUrls.length} seller document uploaded`, `${uploadedDocumentUrls.length} document(s) du vendeur téléversé(s)`)
                        : pick(lang, 'ارفع مستندات البائع قبل الإرسال النهائي', 'Upload seller documents before final submission', 'Téléversez les documents du vendeur avant l’envoi final')}
                  </li>
                  {!isAdvertisingFlow && <li>{selectedFilterLabels(sellerPropertyFilterGroups, visualFilters, lang).join(' · ')}</li>}
                </ul>
              </div>
              <label className="seller-agreement-check">
                <input
                  type="checkbox"
                  checked={agreementAccepted}
                  onChange={(event) => setAgreementAccepted(event.target.checked)}
                />
                <span>
                  {pick(lang, 'أقر بأنني قرأت اتفاقية النشر الخاصة بمنصة SYBNB ووافقت عليها، وأن هويتي مقدمة للتحقق.', 'I have read and accept the SYBNB platform listing agreement, and my identity has been submitted for verification.', 'J’ai lu et j’accepte l’entente de publication de la plateforme SYBNB, et mon identité a été soumise pour vérification.')}
                </span>
              </label>
              {submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{pick(lang, 'تعذر الإرسال', 'Submission failed', 'Échec de l’envoi')}</strong>
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="seller-wizard-actions">
          <button className="seller-secondary-button" onClick={back}>
            {pick(lang, 'رجوع', 'Back', 'Retour')}
          </button>
          <button className="seller-primary-button" disabled={submitState === 'submitting'} onClick={next}>
            {submitState === 'submitting'
              ? pick(lang, 'جار الإرسال', 'Submitting', 'Envoi en cours')
              : isLast
                ? pick(lang, 'إرسال للمراجعة', 'Submit for review', 'Envoyer pour vérification')
                : pick(lang, 'متابعة', 'Continue', 'Continuer')}
          </button>
        </div>
      </section>
    </main>
  )
}

function TouchChoiceGroup({
  active,
  items,
  onChange,
  title,
}: {
  active: string
  items: string[]
  onChange: (value: string) => void
  title: string
}) {
  return (
    <section className="seller-touch-choice-group">
      <span>{title}</span>
      <div className="seller-touch-choice-row">
        {items.map((item) => (
          <button
            className={item === active ? 'active' : ''}
            key={item}
            onClick={() => onChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
    </section>
  )
}

function toNumber(value: string) {
  return Number(String(value).replace(/[^\d.]/g, '')) || 0
}

function toMinor(value: string) {
  return Math.max(0, Math.round(toNumber(value)))
}
