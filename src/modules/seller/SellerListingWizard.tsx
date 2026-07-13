import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import {
  addAccommodationRoomType,
  createAccommodation,
  createAndSubmitPrototypeListing,
  submitAccommodation,
} from '../../shared/api/platformApi'
import type { CSSVars } from '../../shared/theme/cssVars'
import { sellerCarFilterGroups, sellerPropertyFilterGroups, type VisualFilterSelection } from '../../engines/filters'
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

// Reused for every room type after the first one under the same Accommodation: skips
// 'location' and 'media' since those are inherited from the accommodation shell.
const ROOM_TYPE_STEPS: WizardStep[] = STEPS.filter((step) => ['basics', 'price', 'review'].includes(step.id))

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

const AD_PLACEMENTS = [
  { ar: 'الرئيسية', en: 'Landing page' },
  { ar: 'صفحة البحث', en: 'Search page' },
  { ar: 'صفحات الأقسام', en: 'Division pages' },
  { ar: 'كل المنصة', en: 'Whole platform' },
]

const AD_DURATIONS = [
  { ar: 'أسبوع واحد', en: 'One week' },
  { ar: 'شهر واحد', en: 'One month' },
  { ar: 'ثلاثة أشهر', en: 'Three months' },
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
  const [uploadedAdFiles, setUploadedAdFiles] = useState<string[]>([])
  const [uploadedDocumentFiles, setUploadedDocumentFiles] = useState<string[]>([])
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
  const [submitError, setSubmitError] = useState('')
  // Set once the accommodation shell + first STAYS room type are created; every following room
  // type in the same session reuses it instead of re-collecting location/documents/photos.
  const [accommodationId, setAccommodationId] = useState<string | null>(null)
  const [roomTypeStage, setRoomTypeStage] = useState<'idle' | 'prompt'>('idle')
  const isMultiRoomFlow = division === 'STAYS' && !isAdvertisingFlow

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
  const steps = isAdvertisingFlow ? AD_STEPS : accommodationId ? ROOM_TYPE_STEPS : STEPS
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
      if (isAdvertisingFlow && (!adFilesSent || !uploadedDocumentFiles.length)) {
        setSubmitState('error')
        setSubmitError(isAr ? 'ارفع مستندات الإعلان وأرسل الصور والملفات للإدارة قبل المتابعة.' : 'Upload ad documents and send photos/files to admin before continuing.')
        return
      }
      if (!isAdvertisingFlow && !uploadedDocumentFiles.length) {
        setSubmitState('error')
        setSubmitError(isAr ? 'ارفع مستندات البائع أو إثبات الملكية قبل إرسال الإعلان للمراجعة.' : 'Upload seller documents or ownership proof before sending the listing for review.')
        return
      }

      setSubmitState('submitting')
      setSubmitError('')

      const roomTypeMetadata = {
        propertyType: selectedType,
        sizeSqm: toNumber(size),
        bedrooms: toNumber(bedrooms),
        bathrooms: toNumber(bathrooms),
        visualFilters,
      }

      try {
        if (isMultiRoomFlow) {
          if (!accommodationId) {
            const accommodation = await createAccommodation({
              titleAr: title || (isAr ? 'عقار SYBNB جديد' : 'New SYBNB property'),
              titleEn: title,
              description,
              governorate,
              city,
              area,
              address,
              metadata: { uploadedDocumentFiles, governorateLabel: selectedGovernorateLabel, cityLabel: selectedCityLabel, areaLabel: selectedAreaLabel },
            })
            await addAccommodationRoomType(accommodation.id, {
              titleAr: title || (isAr ? 'نوع غرفة جديد' : 'New room type'),
              titleEn: title,
              description,
              priceMinor: toMinor(price),
              currency: 'SYP',
              instantBookEnabled,
              metadata: roomTypeMetadata,
            })
            setAccommodationId(accommodation.id)
          } else {
            await addAccommodationRoomType(accommodationId, {
              titleAr: title || (isAr ? 'نوع غرفة جديد' : 'New room type'),
              titleEn: title,
              description,
              priceMinor: toMinor(price),
              currency: 'SYP',
              instantBookEnabled,
              metadata: roomTypeMetadata,
            })
          }
          setSubmitState('idle')
          setRoomTypeStage('prompt')
          return
        }

        await createAndSubmitPrototypeListing({
          division,
          titleAr: title || 'إعلان SYBNB جديد',
          titleEn: title,
          description,
          priceMinor: toMinor(price),
          currency: 'SYP',
          instantBookEnabled: division === 'STAYS' ? instantBookEnabled : false,
          metadata: {
            advertising: isAdvertisingFlow,
            adPlan,
            adPlacement,
            adDuration,
            uploadedAdFiles,
            uploadedDocumentFiles,
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

  function startAnotherRoomType() {
    setTitle(isAr ? '' : '')
    setDescription('')
    setPrice('150000')
    setSize('40')
    setBedrooms('1')
    setBathrooms('1')
    setSelectedType(PROPERTY_TYPES[0].en)
    setVisualFilters({ propertyType: 'apartment', roomType: 'doubleRoom', bedType: 'queenBed', amenities: ['wifi', 'kitchen'] })
    setRoomTypeStage('idle')
    setStepIndex(0)
  }

  async function finishAccommodation() {
    if (!accommodationId) return
    setSubmitState('submitting')
    setSubmitError('')
    try {
      await submitAccommodation(accommodationId)
      clearDraft()
      navigate('/sell/submitted')
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : 'Unable to submit accommodation.')
    }
  }

  function addListingDocumentFiles(fileList: FileList | null) {
    const names = Array.from(fileList || []).map((file) => file.name).filter(Boolean)
    if (!names.length) return

    setUploadedDocumentFiles((current) => Array.from(new Set([...current, ...names])))
    setAdFilesSent(false)
  }

  const back = () => {
    if (stepIndex === 0) {
      navigate('/sell/account')
      return
    }

    setStepIndex((current) => Math.max(current - 1, 0))
  }

  if (roomTypeStage === 'prompt') {
    return (
      <main className="seller-page seller-wizard-page" dir={isAr ? 'rtl' : 'ltr'}>
        <section className="seller-account-head">
          <BrandLogo logo="plus" size="nav" />
        </section>

        <section className="seller-wizard-shell">
          <div className="seller-wizard-header">
            <p className="eyebrow">{isAr ? 'نفس العقار' : 'Same property'}</p>
            <h1>{isAr ? 'أضف نوع غرفة آخر لنفس العقار؟' : 'Add another room type for the same property?'}</h1>
            <p>
              {isAr
                ? 'الموقع والمستندات والصور محفوظة مسبقاً — لن تحتاج لإعادة رفعها لأي غرفة إضافية.'
                : 'Location, documents, and photos are already saved — you will not need to re-upload them for another room type.'}
            </p>
          </div>
          <div className="seller-wizard-body">
            <div className="seller-wizard-section">
              {submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'تعذر الإرسال' : 'Submission failed'}</strong>
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          </div>
          <div className="seller-wizard-actions">
            <button className="seller-secondary-button" disabled={submitState === 'submitting'} onClick={finishAccommodation}>
              {isAr ? 'لا، أرسل للمراجعة' : 'No, submit for review'}
            </button>
            <button className="seller-primary-button" disabled={submitState === 'submitting'} onClick={startAnotherRoomType}>
              {isAr ? 'نعم، أضف غرفة أخرى' : 'Yes, add another room type'}
            </button>
          </div>
        </section>
      </main>
    )
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
                    if (next) setDivision(next.value)
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
              {!isAdvertisingFlow && division !== 'CARS' && (
                <VisualFilterPanel
                  compact
                  groups={sellerPropertyFilterGroups}
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
                    ? 'تخصم SYBNB عمولة خدمة 10% من قيمة الإيجار (لا تشمل رسوم التنظيف والضريبة) من مستحقاتك عند كل حجز مكتمل.'
                    : 'SYBNB deducts a 10% service commission from the rent amount (not the cleaning fee or tax) from your payout on every completed booking.'}
                </div>
              )}
              <div className="seller-wide-field">
                <VisualFilterPanel
                  compact
                  groups={sellerPropertyFilterGroups.slice(1)}
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
              <div className="seller-upload-grid">
                {(isAdvertisingFlow
                  ? adFileSlots
                  : [
                      { id: 'propertyPhotos', ar: 'صور العقار', en: 'Property photos' },
                      { id: 'paymentProof', ar: 'إثبات دفع الخطة', en: 'Plan payment proof' },
                      { id: 'ownershipProof', ar: 'إثبات الملكية', en: 'Ownership proof' },
                      { id: 'authorization', ar: 'أضف التفويض', en: 'Add authorization' },
                      { id: 'deed', ar: 'مخطط أو سند', en: 'Plan or deed' },
                    ]).map((item) => (
                  <button
                    className={uploadedAdFiles.includes(item.id) ? 'uploaded' : ''}
                    key={item.en}
                    onClick={() => {
                      setUploadedAdFiles((current) => (current.includes(item.id) ? current : [...current, item.id]))
                      setAdFilesSent(false)
                    }}
                  >
                    <strong>{item[lang]}</strong>
                    <span>
                      {uploadedAdFiles.includes(item.id)
                        ? isAr
                          ? 'تمت الإضافة'
                          : 'Added'
                        : isAr
                          ? 'إضافة / رفع'
                          : 'Add / upload'}
                    </span>
                  </button>
                ))}
              </div>
              {isAdvertisingFlow && (
                <div className={`seller-ad-send-panel ${adFilesSent ? 'sent' : ''}`}>
                  <strong>{adPlan === 'premium' ? (isAr ? 'خطة Premium' : 'Premium plan') : isAr ? 'خطة Plus' : 'Plus plan'}</strong>
                  <span>
                    {isAr
                      ? `تمت إضافة ${uploadedAdFiles.length} من ${adFileSlots.length} ملفات مطلوبة ورفع ${uploadedDocumentFiles.length} مستند.`
                      : `${uploadedAdFiles.length} of ${adFileSlots.length} required files added and ${uploadedDocumentFiles.length} document uploaded.`}
                  </span>
                  <button
                    disabled={uploadedAdFiles.length < adFileSlots.length || uploadedDocumentFiles.length < 1}
                    onClick={() => setAdFilesSent(true)}
                  >
                    {adFilesSent ? (isAr ? 'تم إرسال الملفات للإدارة' : 'Files sent to admin') : isAr ? 'إرسال الملفات للإدارة' : 'Send files to admin'}
                  </button>
                </div>
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
                      ? 'ارفع إثبات الملكية، التفويض، المخططات، صور العقار، أو ملفات السيارة/المشروع.'
                      : 'Upload ownership proof, authorization, plans, property photos, or car/project files.'
                }
                lang={lang}
                onAddFiles={addListingDocumentFiles}
                title={isAdvertisingFlow ? (isAr ? 'مستندات الإعلان والخطة' : 'Ad and plan documents') : isAr ? 'مستندات البائع' : 'Seller documents'}
              />
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
                      : uploadedDocumentFiles.length
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
                      : uploadedDocumentFiles.length
                        ? isAr
                          ? `تم رفع ${uploadedDocumentFiles.length} مستند للبائع`
                          : `${uploadedDocumentFiles.length} seller document uploaded`
                        : isAr
                          ? 'ارفع مستندات البائع قبل الإرسال النهائي'
                          : 'Upload seller documents before final submission'}
                  </li>
                  {!isAdvertisingFlow && <li>{selectedFilterLabels(sellerPropertyFilterGroups, visualFilters, lang).join(' · ')}</li>}
                </ul>
              </div>
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
                ? isMultiRoomFlow
                  ? isAr
                    ? 'حفظ هذه الغرفة'
                    : 'Save this room type'
                  : isAr
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
