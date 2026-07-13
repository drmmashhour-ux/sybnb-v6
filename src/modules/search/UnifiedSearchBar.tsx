import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { visualFilterGroupsForDivision, type VisualFilterSelection } from '../../engines/filters'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { labelFor, getCity, getGovernorate } from '../../engines/search'
import { DateField, DateRangePicker, nightsBetween } from './DateRangePicker'
import { LocationCascade } from './LocationCascade'

export type SearchDivision = 'stays' | 'rentals' | 'buy' | 'newConstruction' | 'cars' | 'marketplace'

export type UnifiedSearchValue = {
  division: SearchDivision
  governorate: string
  city: string
  area: string
  customPlaceName: string
  checkIn: string
  checkOut: string
  guests: number
  bedroomsCount: number
  bathrooms: number
  keyword: string
  minPrice: string
  maxPrice: string
  bedrooms: string
  propertyType: string
  furnishing: string
  carBrand: string
  carYear: string
  carFuel: string
  carTransmission: string
  marketCategory: string
  condition: string
  sort: string
  priceBand: string
  roomType: string
  bedType: string
  carBody: string
  amenities: string[]
  trust: string[]
  popular: string[]
  views: string[]
  access: string[]
  meals: string[]
  payments: string[]
}

const SEARCH_DRAFT_KEY = 'sybnb-v6-search-draft'

function loadSearchDraft(): Partial<UnifiedSearchValue> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(SEARCH_DRAFT_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// Lets a listing page pre-fill the dates the guest already picked on the search page, instead
// of asking them to choose the same check-in/check-out again.
export function loadSearchDatesDraft(): { checkIn: string; checkOut: string } | null {
  const draft = loadSearchDraft()
  if (!draft.checkIn || !draft.checkOut) return null
  return { checkIn: draft.checkIn, checkOut: draft.checkOut }
}

type UnifiedSearchBarProps = {
  lang: Lang
  initialDivision?: SearchDivision
  lockedDivision?: boolean
  onSearch?: (value: UnifiedSearchValue) => void
}

type LearnedPlace = {
  id: string
  division: SearchDivision
  governorate: string
  city: string
  area: string
  customPlaceName: string
  keyword: string
  status: 'pending_ai_review'
  createdAt: string
}

const LEARNED_PLACES_KEY = 'sybnb_ai_learned_places'

const T = {
  ar: {
    title: 'محرك البحث الموحد',
    subtitle: 'نفس النظام لكل أقسام SYBNB.',
    lockedStaysTitle: 'محرك الإيجار اليومي فقط',
    lockedStaysSubtitle: 'هذه الصفحة مخصصة للحجز قصير المدة: تاريخ، ضيوف، غرفة، سرير، وخدمات.',
    stays: 'إيجار يومي',
    rentals: 'إيجار شهري',
    buy: 'شراء عقار',
    newConstruction: 'مشاريع جديدة',
    cars: 'مركبات',
    marketplace: 'السوق',
    checkIn: 'الدخول',
    checkOut: 'الخروج',
    guests: 'الضيوف',
    guestCounter: 'عدد الضيوف',
    bedroomCounter: 'عدد غرف النوم',
    bathroomCounter: 'عدد الحمامات',
    counterHint: 'حدد العدد المناسب لطلبك',
    bedroomsStepper: 'غرف نوم',
    bathrooms: 'حمامات',
    keyword: 'كلمة البحث',
    keywordPlaceholder: 'اكتب اسم، موديل، حي، أو خدمة...',
    filters: 'خيارات العملاء',
    showFilters: 'عرض الفلاتر',
    hideFilters: 'إخفاء الفلاتر',
    dailyCalendar: 'تقويم الإيجار اليومي',
    dailyCalendarHint: 'اختر تاريخ الدخول والخروج قبل عرض النتائج اليومية.',
    minPrice: 'أقل سعر',
    maxPrice: 'أعلى سعر',
    bedrooms: 'الغرف',
    any: 'الكل',
    studio: 'استديو',
    oneBedroom: 'غرفة',
    twoBedrooms: 'غرفتان',
    threeBedrooms: '3 غرف',
    fourPlusBedrooms: '4+ غرف',
    propertyType: 'نوع العقار',
    apartment: 'شقة',
    villa: 'فيلا',
    office: 'مكتب',
    shop: 'محل',
    land: 'أرض',
    furnishing: 'التأثيث',
    furnished: 'مفروش',
    unfurnished: 'غير مفروش',
    semiFurnished: 'نصف مفروش',
    carBrand: 'ماركة السيارة',
    carYear: 'سنة الصنع',
    marketCategory: 'تصنيف السوق',
    furniture: 'أثاث',
    electronics: 'إلكترونيات',
    appliances: 'أجهزة منزلية',
    services: 'خدمات',
    condition: 'الحالة',
    new: 'جديد',
    used: 'مستعمل',
    sort: 'ترتيب النتائج',
    newest: 'الأحدث',
    priceLow: 'السعر من الأقل',
    priceHigh: 'السعر من الأعلى',
    customPlace: 'اسم منطقة أو شارع غير موجود',
    customPlacePlaceholder: 'اكتب الاسم إذا لم تجده في القائمة...',
    aiLearnHint: 'سيُحفظ على هذا الجهاز فقط، ويمكنك استخدامه في عمليات البحث القادمة.',
    learnedSaved: 'تم حفظ الاسم على هذا الجهاز.',
    learnedPending: 'محفوظ على هذا الجهاز',
    search: 'بحث',
    resultPreview: 'معاينة الطلب',
    locationDepth: 'المحافظة ← المدينة ← المنطقة',
  },
  en: {
    title: 'Unified Search Engine',
    subtitle: 'One clean search system across SYBNB.',
    lockedStaysTitle: 'Daily stay search only',
    lockedStaysSubtitle: 'This page is dedicated to short-term stays: dates, guests, room, bed, and services.',
    stays: 'Daily stays',
    rentals: 'Monthly rentals',
    buy: 'Buy property',
    newConstruction: 'New projects',
    cars: 'Cars',
    marketplace: 'Marketplace',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    guests: 'Guests',
    guestCounter: 'Guests count',
    bedroomCounter: 'Bedrooms count',
    bathroomCounter: 'Bathrooms count',
    counterHint: 'Choose the right count for your request',
    bedroomsStepper: 'Bedrooms',
    bathrooms: 'Bathrooms',
    keyword: 'Keyword',
    keywordPlaceholder: 'Search name, model, area, or service...',
    filters: 'Filters',
    showFilters: 'Show filters',
    hideFilters: 'Hide filters',
    dailyCalendar: 'Daily rent calendar',
    dailyCalendarHint: 'Choose check-in and check-out before viewing daily stay results.',
    minPrice: 'Min price',
    maxPrice: 'Max price',
    bedrooms: 'Bedrooms',
    any: 'Any',
    studio: 'Studio',
    oneBedroom: '1 bedroom',
    twoBedrooms: '2 bedrooms',
    threeBedrooms: '3 bedrooms',
    fourPlusBedrooms: '4+ bedrooms',
    propertyType: 'Property type',
    apartment: 'Apartment',
    villa: 'Villa',
    office: 'Office',
    shop: 'Shop',
    land: 'Land',
    furnishing: 'Furnishing',
    furnished: 'Furnished',
    unfurnished: 'Unfurnished',
    semiFurnished: 'Semi-furnished',
    carBrand: 'Car brand',
    carYear: 'Model year',
    marketCategory: 'Marketplace category',
    furniture: 'Furniture',
    electronics: 'Electronics',
    appliances: 'Home appliances',
    services: 'Services',
    condition: 'Condition',
    new: 'New',
    used: 'Used',
    sort: 'Sort results',
    newest: 'Newest',
    priceLow: 'Lowest price',
    priceHigh: 'Highest price',
    customPlace: 'New area or street name',
    customPlacePlaceholder: 'Type it here if it is not in the list...',
    aiLearnHint: 'This will be saved on this device only, so you can reuse it in future searches.',
    learnedSaved: 'Saved on this device.',
    learnedPending: 'Saved on this device',
    search: 'Search',
    resultPreview: 'Request preview',
    locationDepth: 'Governorate → City → Area',
  },
}

const DIVISIONS: SearchDivision[] = ['stays', 'rentals', 'buy', 'newConstruction', 'cars', 'marketplace']

type FilterOption = {
  icon: string
  key: string
  labelKey: keyof typeof T.ar
}

const bedroomOptions: FilterOption[] = [
  { key: 'any', labelKey: 'any', icon: '*' },
  { key: 'studio', labelKey: 'studio', icon: '0' },
  { key: 'oneBedroom', labelKey: 'oneBedroom', icon: '1' },
  { key: 'twoBedrooms', labelKey: 'twoBedrooms', icon: '2' },
  { key: 'threeBedrooms', labelKey: 'threeBedrooms', icon: '3' },
  { key: 'fourPlusBedrooms', labelKey: 'fourPlusBedrooms', icon: '4+' },
]
const propertyTypeOptions: FilterOption[] = [
  { key: 'any', labelKey: 'any', icon: '*' },
  { key: 'apartment', labelKey: 'apartment', icon: 'A' },
  { key: 'villa', labelKey: 'villa', icon: 'V' },
  { key: 'office', labelKey: 'office', icon: 'O' },
  { key: 'shop', labelKey: 'shop', icon: 'S' },
  { key: 'land', labelKey: 'land', icon: 'L' },
]
const furnishingOptions: FilterOption[] = [
  { key: 'any', labelKey: 'any', icon: '*' },
  { key: 'furnished', labelKey: 'furnished', icon: 'F' },
  { key: 'semiFurnished', labelKey: 'semiFurnished', icon: '1/2' },
  { key: 'unfurnished', labelKey: 'unfurnished', icon: 'U' },
]
const marketCategoryOptions: FilterOption[] = [
  { key: 'any', labelKey: 'any', icon: '*' },
  { key: 'furniture', labelKey: 'furniture', icon: 'F' },
  { key: 'electronics', labelKey: 'electronics', icon: 'E' },
  { key: 'appliances', labelKey: 'appliances', icon: 'H' },
  { key: 'services', labelKey: 'services', icon: 'S' },
]
const conditionOptions: FilterOption[] = [
  { key: 'any', labelKey: 'any', icon: '*' },
  { key: 'new', labelKey: 'new', icon: 'N' },
  { key: 'used', labelKey: 'used', icon: 'U' },
]
const sortOptions: FilterOption[] = [
  { key: 'newest', labelKey: 'newest', icon: '↓' },
  { key: 'priceLow', labelKey: 'priceLow', icon: '$-' },
  { key: 'priceHigh', labelKey: 'priceHigh', icon: '$+' },
]

export function UnifiedSearchBar({ lang, initialDivision = 'stays', lockedDivision = false, onSearch }: UnifiedSearchBarProps) {
  const t = T[lang]
  const isAr = lang === 'ar'
  const [openCalendar, setOpenCalendar] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [value, setValue] = useState<UnifiedSearchValue>(() => ({
    governorate: 'damascus',
    city: 'damascus-city',
    area: '',
    customPlaceName: '',
    checkIn: '',
    checkOut: '',
    guests: 2,
    bedroomsCount: 1,
    bathrooms: 1,
    keyword: '',
    minPrice: '',
    maxPrice: '',
    bedrooms: 'any',
    propertyType: 'any',
    furnishing: 'any',
    carBrand: '',
    carYear: '',
    carFuel: 'any',
    carTransmission: 'any',
    marketCategory: 'any',
    condition: 'any',
    sort: 'newest',
    priceBand: 'any',
    roomType: 'any',
    bedType: 'any',
    carBody: 'any',
    amenities: [],
    trust: [],
    popular: [],
    views: [],
    access: [],
    meals: [],
    payments: [],
    ...loadSearchDraft(),
    division: initialDivision,
  }))
  const [learnedMessage, setLearnedMessage] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(SEARCH_DRAFT_KEY, JSON.stringify(value))
  }, [value])

  const governorate = getGovernorate(value.governorate)
  const city = getCity(value.governorate, value.city)
  const area = city?.areas.find((item) => item.key === value.area)
  const isStay = value.division === 'stays'
  const filterGroups = useMemo(() => visualFilterGroupsForDivision(value.division), [value.division])
  const filterSelection: VisualFilterSelection = {
    sort: value.sort,
    priceBand: value.priceBand,
    propertyType: value.propertyType,
    roomType: value.roomType,
    bedType: value.bedType,
    amenities: value.amenities,
    trust: value.trust,
    popular: value.popular,
    views: value.views,
    access: value.access,
    meals: value.meals,
    payments: value.payments,
    carBody: value.carBody,
    carBrand: value.carBrand || 'any',
    carFuel: value.carFuel,
    carTransmission: value.carTransmission,
    condition: value.condition,
    marketCategory: value.marketCategory,
  }

  const preview = useMemo(() => {
    const parts = [
      t[value.division],
      governorate ? labelFor(lang, governorate) : '',
      city ? labelFor(lang, city) : '',
      area ? labelFor(lang, area) : '',
      value.customPlaceName.trim() ? value.customPlaceName.trim() : '',
      isStay && value.checkIn ? value.checkIn : '',
      isStay && value.checkOut ? value.checkOut : '',
      isStay ? `${value.guests} ${t.guests}` : value.keyword,
      isStay ? `${value.bedroomsCount} ${t.bedroomsStepper}` : '',
      isStay ? `${value.bathrooms} ${t.bathrooms}` : '',
      value.carBrand.trim() && value.carBrand !== 'any' ? value.carBrand.trim() : '',
      value.carYear.trim(),
      ...selectedFilterLabels(filterGroups, filterSelection, lang),
    ].filter(Boolean)
    return parts.join(' · ')
  }, [area, city, filterGroups, filterSelection, governorate, isStay, lang, t, value])

  useEffect(() => {
    setOpenCalendar(value.division === 'stays')
  }, [value.division])

  useEffect(() => {
    if (lockedDivision && value.division !== initialDivision) update({ division: initialDivision })
  }, [initialDivision, lockedDivision, value.division])

  const update = (patch: Partial<UnifiedSearchValue>) => setValue((current) => ({ ...current, ...patch }))
  const updateFilters = (selection: VisualFilterSelection) => {
    setValue((current) => ({
      ...current,
      sort: stringValue(selection.sort, current.sort),
      priceBand: stringValue(selection.priceBand, current.priceBand),
      propertyType: stringValue(selection.propertyType, current.propertyType),
      roomType: stringValue(selection.roomType, current.roomType),
      bedType: stringValue(selection.bedType, current.bedType),
      carBody: stringValue(selection.carBody, current.carBody),
      carBrand: stringValue(selection.carBrand, current.carBrand || 'any'),
      carFuel: stringValue(selection.carFuel, current.carFuel),
      carTransmission: stringValue(selection.carTransmission, current.carTransmission),
      condition: stringValue(selection.condition, current.condition),
      marketCategory: stringValue(selection.marketCategory, current.marketCategory),
      amenities: arrayValue(selection.amenities),
      trust: arrayValue(selection.trust),
      popular: arrayValue(selection.popular),
      views: arrayValue(selection.views),
      access: arrayValue(selection.access),
      meals: arrayValue(selection.meals),
      payments: arrayValue(selection.payments),
    }))
  }

  const saveLearnedPlace = (current: UnifiedSearchValue) => {
    const customPlaceName = current.customPlaceName.trim()
    if (!customPlaceName || typeof window === 'undefined') return false

    const storedRaw = window.localStorage.getItem(LEARNED_PLACES_KEY)
    let stored: LearnedPlace[] = []
    try {
      stored = storedRaw ? (JSON.parse(storedRaw) as LearnedPlace[]) : []
    } catch {
      stored = []
    }
    const normalized = customPlaceName.toLocaleLowerCase()
    const exists = stored.some(
      (item) =>
        item.customPlaceName.toLocaleLowerCase() === normalized &&
        item.governorate === current.governorate &&
        item.city === current.city,
    )

    if (exists) return true

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `learned-place-${Date.now()}`

    const next: LearnedPlace = {
      id,
      division: current.division,
      governorate: current.governorate,
      city: current.city,
      area: current.area,
      customPlaceName,
      keyword: current.keyword,
      status: 'pending_ai_review',
      createdAt: new Date().toISOString(),
    }

    window.localStorage.setItem(LEARNED_PLACES_KEY, JSON.stringify([next, ...stored].slice(0, 200)))
    return true
  }

  const handleSearch = () => {
    const didSave = saveLearnedPlace(value)
    setLearnedMessage(didSave ? t.learnedSaved : '')
    onSearch?.(value)
  }

  return (
    <section dir={lang === 'ar' ? 'rtl' : 'ltr'} style={styles.shell}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>{isAr ? 'محرك البحث' : 'SEARCH ENGINE'}</p>
          <h2 style={styles.title}>{lockedDivision && initialDivision === 'stays' ? t.lockedStaysTitle : t.title}</h2>
          <p style={styles.subtitle}>{lockedDivision && initialDivision === 'stays' ? t.lockedStaysSubtitle : t.subtitle}</p>
        </div>
      </div>

      {lockedDivision ? (
        <div style={styles.lockedDivision}>
          <span>{t[initialDivision]}</span>
        </div>
      ) : (
        <div style={styles.tabs}>
          {DIVISIONS.map((division) => (
            <button
              key={division}
              type="button"
              onClick={() => update({ division })}
              style={{ ...styles.tab, ...(value.division === division ? styles.tabActive : {}) }}
            >
              {t[division]}
            </button>
          ))}
        </div>
      )}

      <div style={styles.form}>
        <LocationCascade
          lang={lang}
          value={{ governorate: value.governorate, city: value.city, area: value.area }}
          onChange={(next) => update(next)}
        />
        <div style={styles.depthNote}>{t.locationDepth}</div>

        {isStay ? (
          <section style={styles.calendarEngine}>
            <div style={styles.calendarEngineHead}>
              <div>
                <strong>{t.dailyCalendar}</strong>
                <p>{t.dailyCalendarHint}</p>
              </div>
              <span>{nightsBetween(value.checkIn, value.checkOut)} {lang === 'ar' ? 'ليالي' : 'nights'}</span>
            </div>
            <div style={styles.dateGrid}>
              <DateField lang={lang} label={t.checkIn} value={value.checkIn} active={openCalendar} onClick={() => setOpenCalendar(true)} />
              <DateField lang={lang} label={t.checkOut} value={value.checkOut} active={openCalendar} onClick={() => setOpenCalendar(true)} />
            </div>
            {openCalendar ? (
              <DateRangePicker
                lang={lang}
                value={{ checkIn: value.checkIn, checkOut: value.checkOut }}
                onChange={(range) => update(range)}
                onClose={() => setOpenCalendar(false)}
              />
            ) : (
              <button type="button" style={styles.openCalendarButton} onClick={() => setOpenCalendar(true)}>
                {t.dailyCalendar}
              </button>
            )}
          </section>
        ) : null}

        <section style={styles.filtersPanel}>
          <button type="button" style={styles.filtersHead} onClick={() => setShowFilters((current) => !current)} aria-expanded={showFilters}>
            <strong>{t.filters}</strong>
            <span style={styles.filtersHeadRight}>
              <span style={styles.filtersCount}>{selectedFilterLabels(filterGroups, filterSelection, lang).length}</span>
              <span aria-hidden="true">{showFilters ? '▴' : '▾'}</span>
              {showFilters ? t.hideFilters : t.showFilters}
            </span>
          </button>
          {showFilters ? (
            <VisualFilterPanel groups={filterGroups} lang={lang} selection={filterSelection} onChange={updateFilters} compact />
          ) : null}
        </section>

        {isStay ? (
          <section style={styles.counterPhotoGrid} aria-label={lang === 'ar' ? 'عدادات الطلب' : 'Request counters'}>
            <CounterPhotoCard
              lang={lang}
              label={t.guestCounter}
              hint={t.counterHint}
              value={value.guests}
              photoSrc="/assets/filter-photos/counters/guests.webp"
              fallbackSrc="/assets/filter-photos/trust/family-friendly.webp"
              onDecrease={() => update({ guests: Math.max(1, value.guests - 1) })}
              onIncrease={() => update({ guests: value.guests + 1 })}
            />
            <CounterPhotoCard
              lang={lang}
              label={t.bedroomCounter}
              hint={t.counterHint}
              value={value.bedroomsCount}
              photoSrc="/assets/filter-photos/counters/bedrooms.webp"
              fallbackSrc="/assets/filter-photos/rooms/any-room.webp"
              onDecrease={() => update({ bedroomsCount: Math.max(1, value.bedroomsCount - 1) })}
              onIncrease={() => update({ bedroomsCount: value.bedroomsCount + 1 })}
            />
            <CounterPhotoCard
              lang={lang}
              label={t.bathroomCounter}
              hint={t.counterHint}
              value={value.bathrooms}
              photoSrc="/assets/filter-photos/amenities/bathroom.png"
              fallbackKind="bathroom"
              onDecrease={() => update({ bathrooms: Math.max(1, value.bathrooms - 1) })}
              onIncrease={() => update({ bathrooms: value.bathrooms + 1 })}
            />
          </section>
        ) : null}

        <label style={styles.label}>
          {t.customPlace}
          <input
            value={value.customPlaceName}
            onChange={(event) => {
              update({ customPlaceName: event.target.value })
              setLearnedMessage('')
            }}
            placeholder={t.customPlacePlaceholder}
            style={styles.input}
          />
        </label>
        <div style={{ ...styles.aiLearnBox, ...(value.customPlaceName.trim() ? styles.aiLearnBoxActive : {}) }}>
          <span>🧠</span>
          <div>
            <b>{value.customPlaceName.trim() ? t.learnedPending : (isAr ? 'مكان مخصص' : 'Custom place')}</b>
            <p style={styles.aiLearnText}>{learnedMessage || t.aiLearnHint}</p>
          </div>
        </div>

        {!isStay ? (
          <label style={styles.label}>
            {t.keyword}
            <input
              value={value.keyword}
              onChange={(event) => update({ keyword: event.target.value })}
              placeholder={t.keywordPlaceholder}
              style={styles.input}
            />
          </label>
        ) : null}

        <div style={styles.preview}>
          <span>{t.resultPreview}</span>
          <b>{preview}</b>
        </div>

        <button type="button" style={styles.searchButton} onClick={handleSearch}>{t.search}</button>
      </div>
    </section>
  )
}

function stringValue(value: string | string[] | undefined, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function arrayValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : []
}

function CounterPhotoCard({
  hint,
  label,
  lang,
  onDecrease,
  onIncrease,
  fallbackKind,
  fallbackSrc,
  photoSrc,
  value,
}: {
  fallbackKind?: 'bathroom'
  fallbackSrc?: string
  hint: string
  label: string
  lang: Lang
  onDecrease: () => void
  onIncrease: () => void
  photoSrc: string
  value: number
}) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const currentSrc = photoFailed ? fallbackSrc : photoSrc
  return (
    <article style={styles.counterPhotoCard}>
      <span style={styles.counterPhoto}>
        {photoFailed && (!fallbackSrc || fallbackFailed) ? (
          fallbackKind === 'bathroom' ? <BathroomCounterPicture /> : <span style={styles.counterPhotoFallback}>{label.slice(0, 1)}</span>
        ) : (
          <img
            src={currentSrc || photoSrc}
            alt={label}
            loading="lazy"
            onError={() => (photoFailed && fallbackSrc ? setFallbackFailed(true) : setPhotoFailed(true))}
            style={styles.counterPhotoImage}
          />
        )}
      </span>
      <span style={styles.counterPhotoText}>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <span style={styles.counterStepper} dir="ltr">
        <button type="button" style={styles.counterButton} onClick={onDecrease} aria-label={lang === 'ar' ? `إنقاص ${label}` : `Decrease ${label}`}>
          −
        </button>
        <strong style={styles.counterValue}>{value}</strong>
        <button type="button" style={styles.counterButton} onClick={onIncrease} aria-label={lang === 'ar' ? `زيادة ${label}` : `Increase ${label}`}>
          +
        </button>
      </span>
    </article>
  )
}

function BathroomCounterPicture() {
  return (
    <span style={styles.bathroomPicture}>
      <span style={styles.bathroomMirror} />
      <span style={styles.bathroomSink} />
      <span style={styles.bathroomVanity} />
      <span style={styles.bathroomShower} />
      <span style={styles.bathroomShowerLine} />
    </span>
  )
}

function OptionGroup({
  label,
  lang,
  onChange,
  options,
  value,
}: {
  label: string
  lang: Lang
  onChange: (value: string) => void
  options: FilterOption[]
  value: string
}) {
  const t = T[lang]

  return (
    <fieldset style={styles.optionGroup}>
      <legend style={styles.optionLegend}>{label}</legend>
      <div style={styles.optionRow}>
        {options.map((option) => {
          const active = option.key === value
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              title={t[option.labelKey]}
              onClick={() => onChange(option.key)}
              style={active ? styles.optionButtonActive : styles.optionButton}
            >
              <span style={styles.optionIcon}>{option.icon}</span>
              <small>{t[option.labelKey]}</small>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: { border: '1px solid #1e1e2a', borderRadius: 24, background: '#111118', padding: 16, color: '#fff' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  eyebrow: { color: '#d5a915', fontSize: 11, letterSpacing: 2, fontWeight: 900, margin: 0 },
  title: { margin: '5px 0 4px', fontSize: 26 },
  subtitle: { margin: 0, color: '#9aa6ba' },
  tabs: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 },
  tab: { minHeight: 44, border: '1px solid #30384d', borderRadius: 999, background: '#171b29', color: '#9aa6ba', padding: '0 14px', fontWeight: 900, whiteSpace: 'nowrap' },
  tabActive: { background: '#4f6cff', borderColor: '#7f94ff', color: '#fff' },
  lockedDivision: { border: '1px solid rgba(82,108,255,.55)', borderRadius: 16, background: 'rgba(82,108,255,.12)', color: '#fff', display: 'inline-flex', fontWeight: 950, marginBottom: 12, minHeight: 48, padding: '0 16px', alignItems: 'center', justifyContent: 'center', justifySelf: 'start' },
  form: { display: 'grid', gap: 12 },
  depthNote: { color: '#d5a915', fontSize: 12, fontWeight: 900 },
  dateGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 },
  calendarEngine: { border: '1px solid rgba(82,108,255,.55)', borderRadius: 18, background: 'linear-gradient(135deg, rgba(82,108,255,.16), rgba(32,210,155,.08)), #0c1220', display: 'grid', gap: 12, padding: 14 },
  calendarEngineHead: { alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' },
  openCalendarButton: { minHeight: 52, border: '1px solid #4f6cff', borderRadius: 14, background: '#171b29', color: '#fff', fontWeight: 950 },
  filtersPanel: { border: '1px solid #30384d', borderRadius: 16, background: '#0c1220', display: 'grid', gap: 12, padding: 12 },
  filtersHead: { alignItems: 'center', background: 'transparent', border: 0, color: '#d5a915', display: 'flex', fontSize: 13, fontWeight: 950, justifyContent: 'space-between', gap: 12, minHeight: 44, padding: 0, textAlign: 'start', width: '100%' },
  filtersHeadRight: { alignItems: 'center', display: 'flex', gap: 8 },
  filtersCount: { alignItems: 'center', background: 'rgba(213,169,21,.16)', borderRadius: 999, color: '#d5a915', display: 'inline-flex', fontSize: 12, fontWeight: 950, height: 22, justifyContent: 'center', minWidth: 22, padding: '0 6px' },
  filterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  counterPhotoGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' },
  counterPhotoCard: { alignItems: 'center', border: '1px solid #30384d', borderRadius: 16, background: '#111827', display: 'grid', gap: 12, gridTemplateColumns: '76px minmax(0, 1fr)', minHeight: 142, padding: 12 },
  counterPhoto: { alignSelf: 'stretch', borderRadius: 14, background: '#0c1220', display: 'grid', minHeight: 86, overflow: 'hidden', placeItems: 'center' },
  counterPhotoImage: { height: '100%', objectFit: 'cover', width: '100%' },
  counterPhotoFallback: { color: '#d5a915', fontSize: 28, fontWeight: 950 },
  bathroomPicture: { background: 'linear-gradient(135deg, #1e293b, #0f172a)', display: 'block', height: '100%', minHeight: 86, position: 'relative', width: '100%' },
  bathroomMirror: { background: '#64748b', border: '2px solid #dbeafe', borderRadius: '50%', height: 26, left: 12, opacity: .9, position: 'absolute', top: 11, width: 26 },
  bathroomSink: { background: '#e5edf7', borderRadius: '0 0 18px 18px', height: 13, left: 9, position: 'absolute', top: 45, width: 34 },
  bathroomVanity: { background: '#475569', borderRadius: '0 0 5px 5px', height: 16, left: 13, position: 'absolute', top: 57, width: 26 },
  bathroomShower: { border: '2px solid #dbeafe', borderBottom: 0, borderRadius: '16px 16px 0 0', height: 39, position: 'absolute', right: 12, top: 13, width: 24 },
  bathroomShowerLine: { background: '#60a5fa', borderRadius: 999, bottom: 17, height: 3, position: 'absolute', right: 10, width: 30 },
  counterPhotoText: { display: 'grid', gap: 5, minWidth: 0 },
  counterStepper: { alignItems: 'center', display: 'grid', gap: 8, gridColumn: '1 / -1', gridTemplateColumns: '52px minmax(48px, 1fr) 52px' },
  counterValue: { alignItems: 'center', background: '#0c1220', border: '1px solid #30384d', borderRadius: 13, color: '#fff', display: 'grid', fontSize: 24, minHeight: 52, placeItems: 'center' },
  counterButton: { minWidth: 44, minHeight: 44, border: 0, borderRadius: 13, background: '#171b29', color: '#fff', fontSize: 22, fontWeight: 900 },
  label: { display: 'grid', gap: 7, color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  input: { minHeight: 54, border: '1px solid #30384d', borderRadius: 14, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  optionGroup: { border: '1px solid #30384d', borderRadius: 14, background: '#111827', margin: 0, minWidth: 0, padding: '10px 10px 12px' },
  optionLegend: { color: '#9aa6ba', fontSize: 12, fontWeight: 900, padding: '0 6px' },
  optionRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  optionButton: { alignItems: 'center', border: '1px solid #30384d', borderRadius: 12, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 4, justifyItems: 'center', minHeight: 58, minWidth: 58, padding: '7px 8px' },
  optionButtonActive: { alignItems: 'center', border: '1px solid #7f94ff', borderRadius: 12, background: '#263575', color: '#fff', display: 'grid', gap: 4, justifyItems: 'center', minHeight: 58, minWidth: 58, padding: '7px 8px' },
  optionIcon: { fontSize: 16, fontWeight: 950, lineHeight: 1 },
  aiLearnBox: { display: 'flex', gap: 10, border: '1px solid #2d3650', borderRadius: 14, background: '#0c1220', padding: 12, color: '#9aa6ba' },
  aiLearnBoxActive: { borderColor: 'rgba(213,169,21,.45)', background: 'rgba(213,169,21,.08)' },
  aiLearnText: { margin: '4px 0 0', fontSize: 12, lineHeight: 1.6 },
  preview: { display: 'grid', gap: 5, border: '1px solid #2d3650', borderRadius: 14, background: '#0c1220', padding: 12, color: '#9aa6ba' },
  searchButton: { minHeight: 54, border: 0, borderRadius: 16, background: 'linear-gradient(135deg,#4f6cff,#19d7ff)', color: '#fff', fontWeight: 950, fontSize: 16 },
}
