import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
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

const DIVISION_OPTIONS: Array<{ value: ListingDivision; ar: string; en: string }> = [
  { value: 'STAYS', ar: 'إيجار يومي', en: 'Daily stay' },
  { value: 'RENTALS', ar: 'إيجار شهري', en: 'Monthly rental' },
  { value: 'BUY', ar: 'عقار للبيع', en: 'Property for sale' },
  { value: 'CARS', ar: 'سيارة', en: 'Car' },
  { value: 'MARKETPLACE', ar: 'منتج أو خدمة', en: 'Product or service' },
  { value: 'NEW_CONSTRUCTION', ar: 'مشروع جديد', en: 'New project' },
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
    title: { ar: 'أساسيات الإعلان', en: 'Listing basics' },
    helper: { ar: 'نوع العقار والعنوان المختصر.', en: 'Property type and short title.' },
  },
  {
    id: 'location',
    title: { ar: 'الموقع', en: 'Location' },
    helper: { ar: 'المحافظة والمدينة والمنطقة.', en: 'Governorate, city, and area.' },
  },
  {
    id: 'price',
    title: { ar: 'السعر والتفاصيل', en: 'Price and details' },
    helper: { ar: 'السعر والمساحة والغرف.', en: 'Price, size, and rooms.' },
  },
  {
    id: 'media',
    title: { ar: 'الصور والملفات', en: 'Photos and files' },
    helper: { ar: 'صور العقار وإثبات الدفع والملكية أو التفويض.', en: 'Property photos, payment proof, and ownership or authorization files.' },
  },
  {
    id: 'review',
    title: { ar: 'المراجعة والإرسال', en: 'Review and submit' },
    helper: { ar: 'تأكد من البيانات قبل إرسالها لفريق SYBNB.', en: 'Confirm details before sending to the SYBNB team.' },
  },
]

const AD_STEPS: WizardStep[] = [
  {
    id: 'basics',
    title: { ar: 'تفاصيل الإعلان', en: 'Ad details' },
    helper: { ar: 'اسم الإعلان ومكان ظهوره داخل المنصة.', en: 'Ad name and placement inside the platform.' },
  },
  {
    id: 'media',
    title: { ar: 'صور وملفات الإعلان', en: 'Ad photos and files' },
    helper: { ar: 'أضف البانر والملفات حسب الخطة المدفوعة.', en: 'Add banners and files based on the paid plan.' },
  },
  {
    id: 'review',
    title: { ar: 'الإرسال والموافقة', en: 'Submit and approval' },
    helper: { ar: 'أرسل الإعلان للإدارة؛ بعد القبول يصبح منشوراً.', en: 'Send the ad to admin; after approval it becomes published.' },
  },
]

const PROPERTY_TYPES = [
  { ar: 'شقة', en: 'Apartment' },
  { ar: 'منزل عائلي', en: 'Family house' },
  { ar: 'فيلا', en: 'Villa' },
  { ar: 'محل تجاري', en: 'Commercial' },
  { ar: 'أرض', en: 'Land' },
  { ar: 'مشروع جديد', en: 'New project' },
]

// Only 'Landing page' is a real, built display surface (the landing page's "Sponsored" section --
// see /api/advertising/active). Offering Search page/Division pages/Whole platform here would be a
// choice with no effect: an advertiser picking one of those would get nothing shown anywhere,
// silently. Reduced to the one option that's actually true, matching this codebase's own
// no-fake-choice standard (see the removed "Featured ads" marquee note on the landing page).
const AD_PLACEMENTS = [{ ar: 'الرئيسية', en: 'Landing page' }]

// `days` is the real, server-enforced expiry (server/routes/listings.mjs reads
// metadata.adDurationDays at creation time) -- not just display text. Keep this in sync with
// whatever labels are offered here; the label alone is never sent to the server.
const AD_DURATIONS = [
  { ar: 'أسبوع واحد', en: 'One week', days: 7 },
  { ar: 'شهر واحد', en: 'One month', days: 30 },
  { ar: 'ثلاثة أشهر', en: 'Three months', days: 90 },
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
          { id: 'desktopBanner', ar: 'بانر سطح المكتب', en: 'Desktop banner' },
          { id: 'tabletBanner', ar: 'بانر التابلت', en: 'Tablet banner' },
          { id: 'phoneBanner', ar: 'بانر الهاتف', en: 'Phone banner' },
          { id: 'brandLogo', ar: 'شعار الشركة', en: 'Brand logo' },
          { id: 'documents', ar: 'ملفات الشركة أو الحملة', en: 'Company or campaign documents' },
        ]
      : [
          { id: 'mainBanner', ar: 'بانر الإعلان الرئيسي', en: 'Main ad banner' },
          { id: 'brandLogo', ar: 'شعار الشركة', en: 'Brand logo' },
          { id: 'documents', ar: 'ملفات الشركة أو الحملة', en: 'Company or campaign documents' },
        ]
  // 'documents' has its own real upload widget below (uploadedDocumentUrls) -- these are the
  // image slots (banners/logo) that need their own real per-slot upload.
  const bannerSlots = adFileSlots.filter((item) => item.id !== 'documents')
  const draft = useMemo(() => loadDraft(), [])
  const [stepIndex, setStepIndex] = useState(0)
  const [division, setDivision] = useState<ListingDivision>(draft.division || 'STAYS')
  const [selectedType, setSelectedType] = useState(draft.selectedType || PROPERTY_TYPES[0].en)
  const [title, setTitle] = useState(draft.title ?? (isAr ? 'شقة مفروشة قرب المالكي' : 'Furnished apartment near Malki'))
  const [description, setDescription] = useState(
    draft.description ?? (isAr ? 'شقة جاهزة للسكن مع وصول سريع للخدمات.' : 'Ready-to-live apartment with quick service access.'),
  )
  const [governorate, setGovernorate] = useState(draft.governorate || 'damascus')
  const [city, setCity] = useState(draft.city || 'damascus-city')
  const [area, setArea] = useState(draft.area || 'old-city')
  const [address, setAddress] = useState(draft.address ?? (isAr ? 'قرب شارع رئيسي' : 'Near a main street'))
  const [price, setPrice] = useState(draft.price || '250000')
  const [size, setSize] = useState(draft.size || '110')
  const [bedrooms, setBedrooms] = useState(draft.bedrooms || '3')
  const [bathrooms, setBathrooms] = useState(draft.bathrooms || '2')
  const [instantBookEnabled, setInstantBookEnabled] = useState(draft.instantBookEnabled ?? false)
  const [adPlacement, setAdPlacement] = useState(isAr ? 'الرئيسية' : 'Landing page')
  const [adDuration, setAdDuration] = useState(isAr ? 'أسبوع واحد' : 'One week')
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
        setSubmitError(isAr ? 'ارفع مستندات الإعلان وأرسل الصور والملفات للإدارة قبل المتابعة.' : 'Upload ad documents and send photos/files to admin before continuing.')
        return
      }
      if (!isAdvertisingFlow && !uploadedDocumentUrls.length) {
        setSubmitState('error')
        setSubmitError(isAr ? 'ارفع مستندات البائع أو إثبات الملكية قبل إرسال الإعلان للمراجعة.' : 'Upload seller documents or ownership proof before sending the listing for review.')
        return
      }
      if (!agreementAccepted) {
        setSubmitState('error')
        setSubmitError(isAr ? 'وافق على اتفاقية النشر قبل الإرسال.' : 'Accept the listing agreement before submitting.')
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
      setPhotoUploadError(isAr ? 'سجّل الدخول أولاً لرفع الصور.' : 'Sign in first to upload photos.')
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setUploadedPhotoUrls((current) => [...current, ...urls])
    } catch (error) {
      setPhotoUploadError(error instanceof Error ? error.message : (isAr ? 'تعذر رفع الصورة.' : 'Could not upload the photo.'))
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
      setDocumentUploadError(isAr ? 'سجّل الدخول أولاً لرفع المستندات.' : 'Sign in first to upload documents.')
      return
    }
    try {
      const urls = await Promise.all(files.map((file) => uploadPaymentProofFile(file, session.token)))
      setUploadedDocumentUrls((current) => [...current, ...urls])
    } catch (error) {
      setDocumentUploadError(error instanceof Error ? error.message : (isAr ? 'تعذر رفع الملف.' : 'Could not upload the file.'))
    }
  }

  async function addAdSlotFile(slotId: string, fileList: FileList | null) {
    const file = Array.from(fileList || [])[0]
    if (!file) return

    setAdSlotUploadError('')
    const session = getStoredSellerSession()
    if (!session) {
      setAdSlotUploadError(isAr ? 'سجّل الدخول أولاً لرفع الملفات.' : 'Sign in first to upload files.')
      return
    }
    try {
      const url = await uploadPaymentProofFile(file, session.token)
      setAdSlotUploads((current) => ({ ...current, [slotId]: { fileName: file.name, url } }))
      setAdFilesSent(false)
    } catch (error) {
      setAdSlotUploadError(error instanceof Error ? error.message : (isAr ? 'تعذر رفع الملف.' : 'Could not upload the file.'))
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
              ? isAr ? 'معالج الإعلان' : 'Advertising wizard'
              : isAr
                ? `معالج نشر ${DIVISION_OPTIONS.find((item) => item.value === division)?.ar || 'الإعلان'}`
                : `Listing wizard · ${DIVISION_OPTIONS.find((item) => item.value === division)?.en || ''}`}
          </p>
          <h1>{activeStep.title[lang]}</h1>
          <p>{activeStep.helper[lang]}</p>
          <div className="seller-progress-track" aria-label={isAr ? 'تقدم الخطوات' : 'Step progress'}>
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
                  title={isAr ? 'القسم' : 'Division'}
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
                <span>{isAdvertisingFlow ? (isAr ? 'اسم الحملة الإعلانية' : 'Campaign name') : isAr ? 'عنوان الإعلان' : 'Listing title'}</span>
                <input
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={isAdvertisingFlow ? (isAr ? 'مثال: إعلان مشروع جديد' : 'Example: New project campaign') : isAr ? 'مثال: شقة مفروشة قرب المالكي' : 'Example: Furnished apartment near Malki'}
                  value={title}
                />
              </label>
              <label className="seller-wide-field">
                <span>{isAdvertisingFlow ? (isAr ? 'وصف الإعلان' : 'Ad description') : isAr ? 'وصف مختصر' : 'Short description'}</span>
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={isAdvertisingFlow ? (isAr ? 'اكتب هدف الإعلان والجمهور المطلوب.' : 'Write the ad goal and target audience.') : isAr ? 'اكتب أهم تفاصيل العقار بوضوح.' : 'Write the key property details clearly.'}
                  value={description}
                />
              </label>
              {isAdvertisingFlow && (
                <div className="seller-form-grid">
                  <TouchChoiceGroup
                    active={adPlacement}
                    items={AD_PLACEMENTS.map((item) => item[lang])}
                    onChange={setAdPlacement}
                    title={isAr ? 'مكان الظهور' : 'Placement'}
                  />
                  <TouchChoiceGroup
                    active={adDuration}
                    items={AD_DURATIONS.map((item) => item[lang])}
                    onChange={setAdDuration}
                    title={isAr ? 'مدة الإعلان' : 'Ad duration'}
                  />
                </div>
              )}
            </div>
          )}

          {activeStep.id === 'location' && (
            <div className="seller-wizard-section">
              <div className="seller-location-capsule">
                <div className="seller-location-summary">
                  <span>{isAr ? 'الموقع المختار' : 'Selected location'}</span>
                  <strong>{[selectedGovernorateLabel, selectedCityLabel, selectedAreaLabel].filter(Boolean).join(' ← ')}</strong>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? 'المحافظة' : 'Governorate'}</span>
                  <div className="seller-location-options">
                    {SYRIA_GOVERNORATES.map((item) => (
                      <button className={item.key === governorate ? 'active' : ''} key={item.key} onClick={() => chooseGovernorate(item.key)}>
                        {labelFor(lang, item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? 'المدينة / القضاء' : 'City / district'}</span>
                  <div className="seller-location-options">
                    {(selectedGovernorateData?.cities || []).map((item) => (
                      <button className={item.key === city ? 'active' : ''} key={item.key} onClick={() => chooseCity(item.key)}>
                        {labelFor(lang, item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? 'المنطقة / الشارع' : 'Area / street'}</span>
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
                <span>{isAr ? 'العنوان التفصيلي' : 'Detailed address'}</span>
                <input
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={isAr ? 'اسم الشارع أو أقرب معلم' : 'Street name or nearest landmark'}
                  value={address}
                />
              </label>
              <div className="seller-map-placeholder">
                <strong>{isAr ? 'تصحيح الموقع لاحقاً' : 'Location correction later'}</strong>
                <span>{isAr ? 'سيتم ربط الخريطة بعد تثبيت محرك البحث والمواقع.' : 'Map will connect after the search and location engine is stabilized.'}</span>
              </div>
            </div>
          )}

          {activeStep.id === 'price' && !isAdvertisingFlow && (
            <div className="seller-wizard-section seller-form-grid">
              <label>
                <span>{isAr ? 'السعر المطلوب' : 'Asking price'}</span>
                <input dir="ltr" onChange={(event) => setPrice(event.target.value)} placeholder="250000" value={price} />
              </label>
              <label>
                <span>{isAr ? 'المساحة' : 'Area'}</span>
                <input dir="ltr" onChange={(event) => setSize(event.target.value)} placeholder="110 m2" value={size} />
              </label>
              <label>
                <span>{isAr ? 'غرف النوم' : 'Bedrooms'}</span>
                <input dir="ltr" onChange={(event) => setBedrooms(event.target.value)} placeholder="3" value={bedrooms} />
              </label>
              <label>
                <span>{isAr ? 'الحمامات' : 'Bathrooms'}</span>
                <input dir="ltr" onChange={(event) => setBathrooms(event.target.value)} placeholder="2" value={bathrooms} />
              </label>
              {division === 'STAYS' && (
                <label className="seller-wide-field seller-instant-book-toggle">
                  <input type="checkbox" checked={instantBookEnabled} onChange={(event) => setInstantBookEnabled(event.target.checked)} />
                  <span>
                    <strong>{isAr ? '⚡ تفعيل الحجز الفوري' : '⚡ Enable Instant Book'}</strong>
                    <small>
                      {isAr
                        ? 'يتأكد حجز الضيف تلقائياً فور نجاح الدفع، دون انتظار موافقتك اليدوية.'
                        : 'Guest bookings confirm automatically once payment succeeds, without waiting for your manual approval.'}
                    </small>
                  </span>
                </label>
              )}
              {division === 'STAYS' && (
                <div className="seller-wide-field seller-money-note">
                  {isAr
                    ? 'تخصم SYBNB عمولة خدمة 12% من قيمة الإيجار (لا تشمل رسوم التنظيف والضريبة) من مستحقاتك عند كل حجز مكتمل.'
                    : 'SYBNB deducts a 12% service commission from the rent amount (not the cleaning fee or tax) from your payout on every completed booking.'}
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
                {isAr
                  ? 'السعر يظهر للزوار كما يكتبه البائع، مع إمكانية التفاوض عبر IMMOContact.'
                  : 'The price appears to visitors as entered, with negotiation through IMMOContact.'}
              </div>
            </div>
          )}

          {activeStep.id === 'media' && (
            <div className="seller-wizard-section">
              {isAdvertisingFlow && (
              <div className="seller-upload-grid">
                {bannerSlots.map((item) => (
                  <PaymentProofUpload
                    cta={isAr ? `رفع ${item.ar}` : `Upload ${item.en}`}
                    emptyText={isAr ? 'لم يتم رفع الملف بعد.' : 'No file uploaded yet.'}
                    files={adSlotUploads[item.id] ? [adSlotUploads[item.id].fileName] : []}
                    help={isAr ? 'PNG أو JPG.' : 'PNG or JPG.'}
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
                  <strong>{adPlan === 'premium' ? (isAr ? 'خطة Premium' : 'Premium plan') : isAr ? 'خطة Plus' : 'Plus plan'}</strong>
                  <span>
                    {isAr
                      ? `تم رفع ${Object.keys(adSlotUploads).length} من ${bannerSlots.length} ملفات مطلوبة ورفع ${uploadedDocumentUrls.length} مستند.`
                      : `${Object.keys(adSlotUploads).length} of ${bannerSlots.length} required files uploaded and ${uploadedDocumentUrls.length} document uploaded.`}
                  </span>
                  <button
                    disabled={bannerSlots.some((item) => !adSlotUploads[item.id]) || uploadedDocumentUrls.length < 1}
                    onClick={() => setAdFilesSent(true)}
                  >
                    {adFilesSent ? (isAr ? 'تم إرسال الملفات للإدارة' : 'Files sent to admin') : isAr ? 'إرسال الملفات للإدارة' : 'Send files to admin'}
                  </button>
                </div>
              )}
              {!isAdvertisingFlow && (
                <>
                  <PaymentProofUpload
                    cta={isAr ? 'رفع صور العقار/المركبة/المنتج' : 'Upload property/car/item photos'}
                    emptyText={isAr ? 'لم يتم رفع صور بعد. تظهر "لا توجد صور بعد" للزوار حتى ترفع صورة حقيقية.' : 'No photos uploaded yet. Visitors see "No photos yet" until a real photo is uploaded.'}
                    files={uploadedPhotoFiles}
                    help={isAr ? 'هذه الصور هي ما سيراه الزوار فعلياً في نتائج البحث وصفحة التفاصيل. PNG أو JPG.' : 'These are the actual photos visitors will see in search results and the detail page. PNG or JPG.'}
                    lang={lang}
                    onAddFiles={(files) => void addListingPhotoFiles(files)}
                    title={isAr ? 'صور الإعلان' : 'Listing photos'}
                  />
                  {photoUploadError && <p className="seller-note-line" style={{ color: '#ff5f7d' }}>{photoUploadError}</p>}
                </>
              )}
              <PaymentProofUpload
                cta={isAdvertisingFlow ? (isAr ? 'رفع مستندات الإعلان' : 'Upload ad documents') : isAr ? 'رفع مستندات البائع' : 'Upload seller documents'}
                emptyText={isAr ? 'لم يتم رفع مستندات بعد. ارفع PDF أو PNG أو JPG.' : 'No documents uploaded yet. Upload PDF, PNG, or JPG.'}
                files={uploadedDocumentFiles}
                help={
                  isAdvertisingFlow
                    ? isAr
                      ? 'ارفع إثبات الدفع، ملفات الحملة، التفويض، أو صور النشاط حسب الخطة.'
                      : 'Upload payment proof, campaign files, authorization, or business photos based on the plan.'
                    : isAr
                      ? 'ارفع إثبات الملكية، التفويض، والمخططات أو ملفات السيارة/المشروع (ليست صور الإعلان — ارفعها أعلاه).'
                      : 'Upload ownership proof, authorization, and plans or car/project files (not listing photos — upload those above).'
                }
                lang={lang}
                onAddFiles={(files) => void addListingDocumentFiles(files)}
                title={isAdvertisingFlow ? (isAr ? 'مستندات الإعلان والخطة' : 'Ad and plan documents') : isAr ? 'مستندات البائع' : 'Seller documents'}
              />
              {documentUploadError && <p className="seller-note-line" style={{ color: '#ff5f7d' }}>{documentUploadError}</p>}
              <p className="seller-note-line">
                {isAdvertisingFlow
                  ? isAr
                    ? 'لن يظهر الإعلان للزوار قبل موافقة الإدارة. بعد القبول تتحول الحالة إلى منشور.'
                    : 'The ad will not appear to visitors before admin approval. After acceptance, status becomes published.'
                  : isAr
                    ? 'الملفات الثقيلة تُراجع من الإدارة ولا تظهر للزوار إلا إذا كانت ضمن خطة تسمح بذلك.'
                    : 'Heavy files are reviewed by admin and only shown to visitors when the plan allows it.'}
              </p>
            </div>
          )}

          {activeStep.id === 'review' && (
            <div className="seller-wizard-section">
              <div className="seller-review-card" style={{ '--accent': '#d5a915' } as CSSVars}>
                <p>{isAr ? 'جاهز للإرسال' : 'Ready to submit'}</p>
                <h2>{isAdvertisingFlow ? (isAr ? 'سيتم إرسال الإعلان للإدارة' : 'Ad will be sent to admin') : isAr ? 'سيتم إرسال الإعلان للمراجعة' : 'Listing will be sent for review'}</h2>
                <ul>
                  <li>{isAr ? 'قرار الإدارة: قبول / طلب معلومات / رفض' : 'Admin decision: approve / need info / reject'}</li>
                  <li>{isAr ? 'المقبول يصبح منشوراً' : 'Approved becomes published'}</li>
                  <li>
                    {isAdvertisingFlow
                      ? isAr
                        ? 'تم تجهيز طلب الإعلان من مسار الدفع والإرسال.'
                        : 'The advertising request was prepared through the payment and submission flow.'
                      : uploadedDocumentUrls.length
                        ? isAr
                          ? 'تم رفع مستندات البائع المطلوبة قبل الإرسال.'
                          : 'Required seller documents were uploaded before submission.'
                        : isAr
                          ? 'لا يمكن الإرسال قبل رفع مستندات البائع.'
                          : 'Submission is blocked until seller documents are uploaded.'}
                  </li>
                  <li>
                    {isAdvertisingFlow
                      ? adFilesSent
                        ? isAr
                          ? 'تم إرسال الصور والمستندات للإدارة'
                          : 'Photos and documents were sent to admin'
                        : isAr
                          ? 'أرسل الصور والمستندات قبل الإرسال النهائي'
                          : 'Send photos and documents before final submission'
                      : uploadedDocumentUrls.length
                        ? isAr
                          ? `تم رفع ${uploadedDocumentUrls.length} مستند للبائع`
                          : `${uploadedDocumentUrls.length} seller document uploaded`
                        : isAr
                          ? 'ارفع مستندات البائع قبل الإرسال النهائي'
                          : 'Upload seller documents before final submission'}
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
                  {isAr
                    ? 'أقر بأنني قرأت اتفاقية النشر الخاصة بمنصة SYBNB ووافقت عليها، وأن هويتي مقدمة للتحقق.'
                    : 'I have read and accept the SYBNB platform listing agreement, and my identity has been submitted for verification.'}
                </span>
              </label>
              {submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'تعذر الإرسال' : 'Submission failed'}</strong>
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="seller-wizard-actions">
          <button className="seller-secondary-button" onClick={back}>
            {isAr ? 'رجوع' : 'Back'}
          </button>
          <button className="seller-primary-button" disabled={submitState === 'submitting'} onClick={next}>
            {submitState === 'submitting'
              ? isAr
                ? 'جار الإرسال'
                : 'Submitting'
              : isLast
                ? isAr
                  ? 'إرسال للمراجعة'
                  : 'Submit for review'
                : isAr
                  ? 'متابعة'
                  : 'Continue'}
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
