import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { visualFilterGroupsForDivision, type VisualFilterSelection } from '../../engines/filters'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { labelFor, getCity, getGovernorate } from '../../engines/search'
import { DateRangePicker, formatDateForLang } from './DateRangePicker'
import { LocationCascade } from './LocationCascade'

export type SearchDivision = 'stays' | 'rentals' | 'buy' | 'newConstruction' | 'cars' | 'marketplace'

export type UnifiedSearchValue = {
  division: SearchDivision
  governorate: string
  city: string
  area: string
  // True only once the guest actually picks a governorate/city/area via LocationCascade --
  // lets callers tell "user chose Damascus" apart from "field defaults to Damascus" so an
  // untouched location never turns into a silent city filter on search.
  locationTouched: boolean
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
    customPlaceHint: 'سيُستخدم هذا الاسم في طلب البحث الحالي فقط.',
    search: 'بحث',
    resultPreview: 'معاينة الطلب',
    dates: 'التواريخ',
    anyDates: 'أي تاريخ',
    filtersButton: 'الفلاتر',
    applyFilters: 'تطبيق الفلاتر',
    done: 'تم',
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
    customPlaceHint: 'This name is used for the current search request only.',
    search: 'Search',
    resultPreview: 'Request preview',
    dates: 'Dates',
    anyDates: 'Any dates',
    filtersButton: 'Filters',
    applyFilters: 'Apply filters',
    done: 'Done',
    locationDepth: 'Governorate → City → Area',
  },
  fr: {
    title: 'Moteur de recherche unifié',
    subtitle: 'Un seul système de recherche pour tout SYBNB.',
    lockedStaysTitle: 'Recherche de séjours uniquement',
    lockedStaysSubtitle: 'Cette page est dédiée aux séjours de courte durée : dates, voyageurs, chambre, lit et services.',
    stays: 'Séjours',
    rentals: 'Locations au mois',
    buy: 'Acheter un bien',
    newConstruction: 'Projets neufs',
    cars: 'Voitures',
    marketplace: 'Marché',
    checkIn: 'Arrivée',
    checkOut: 'Départ',
    guests: 'Voyageurs',
    guestCounter: 'Nombre de voyageurs',
    bedroomCounter: 'Nombre de chambres',
    bathroomCounter: 'Nombre de salles de bain',
    counterHint: 'Indiquez le nombre adapté à votre demande',
    bedroomsStepper: 'Chambres',
    bathrooms: 'Salles de bain',
    keyword: 'Mot-clé',
    keywordPlaceholder: 'Nom, modèle, quartier ou service...',
    filters: 'Filtres',
    showFilters: 'Afficher les filtres',
    hideFilters: 'Masquer les filtres',
    dailyCalendar: 'Calendrier des séjours',
    dailyCalendarHint: 'Choisissez l’arrivée et le départ avant d’afficher les séjours.',
    minPrice: 'Prix min.',
    maxPrice: 'Prix max.',
    bedrooms: 'Chambres',
    any: 'Tous',
    studio: 'Studio',
    oneBedroom: '1 chambre',
    twoBedrooms: '2 chambres',
    threeBedrooms: '3 chambres',
    fourPlusBedrooms: '4 chambres et +',
    propertyType: 'Type de logement',
    apartment: 'Appartement',
    villa: 'Villa',
    office: 'Bureau',
    shop: 'Commerce',
    land: 'Terrain',
    furnishing: 'Ameublement',
    furnished: 'Meublé',
    unfurnished: 'Non meublé',
    semiFurnished: 'Semi-meublé',
    carBrand: 'Marque',
    carYear: 'Année du modèle',
    marketCategory: 'Catégorie',
    furniture: 'Meubles',
    electronics: 'Électronique',
    appliances: 'Électroménager',
    services: 'Services',
    condition: 'État',
    new: 'Neuf',
    used: 'Occasion',
    sort: 'Trier les résultats',
    newest: 'Plus récents',
    priceLow: 'Prix le plus bas',
    priceHigh: 'Prix le plus élevé',
    customPlace: 'Nouveau quartier ou nouvelle rue',
    customPlacePlaceholder: 'Saisissez-le ici s’il ne figure pas dans la liste...',
    customPlaceHint: 'Ce nom n’est utilisé que pour la recherche en cours.',
    search: 'Rechercher',
    resultPreview: 'Aperçu de la demande',
    dates: 'Dates',
    anyDates: 'Dates flexibles',
    filtersButton: 'Filtres',
    applyFilters: 'Appliquer les filtres',
    done: 'OK',
    locationDepth: 'Gouvernorat → Ville → Quartier',
  },
}

const DIVISIONS: SearchDivision[] = ['stays', 'rentals', 'buy', 'newConstruction', 'cars', 'marketplace']

// Division-specific attribute fields (e.g. Cars' carBrand, Marketplace's marketCategory) reset to
// their defaults whenever the division changes, mirroring SellerListingWizard's setVisualFilters({})
// on division switch -- otherwise a filter picked under one division (Brand=Toyota on CARS) silently
// follows the guest into a division where it makes no sense and over-filters results unseen.
const DIVISION_ATTRIBUTE_DEFAULTS: Pick<
  UnifiedSearchValue,
  | 'propertyType'
  | 'furnishing'
  | 'carBrand'
  | 'carYear'
  | 'carFuel'
  | 'carTransmission'
  | 'marketCategory'
  | 'condition'
  | 'roomType'
  | 'bedType'
  | 'carBody'
  | 'bedrooms'
  | 'amenities'
  | 'trust'
  | 'popular'
  | 'views'
  | 'access'
  | 'meals'
  | 'payments'
  | 'sort'
  | 'priceBand'
  | 'keyword'
  | 'minPrice'
  | 'maxPrice'
> = {
  propertyType: 'any',
  furnishing: 'any',
  carBrand: '',
  carYear: '',
  carFuel: 'any',
  carTransmission: 'any',
  marketCategory: 'any',
  condition: 'any',
  roomType: 'any',
  bedType: 'any',
  carBody: 'any',
  bedrooms: 'any',
  amenities: [],
  trust: [],
  popular: [],
  views: [],
  access: [],
  meals: [],
  payments: [],
  // Sort, price and keyword are division-specific too: a car price band or a "Toyota" keyword
  // makes no sense under Marketplace, and carrying them over silently narrowed the next category.
  sort: 'newest',
  priceBand: 'any',
  keyword: '',
  minPrice: '',
  maxPrice: '',
}

// UX-4B finding 1.1. Takes a stored draft and returns it with the division-specific attributes
// stripped back to defaults whenever the draft was written under a DIFFERENT division than the one
// now being opened. Geography (governorate/city/area/locationTouched/customPlaceName), dates and
// guests are deliberately left untouched -- they are legitimate cross-division search context and
// must keep persisting. Keyword, sort and price are reset with the other division filters.
export function restoreDraftForDivision(
  draft: Partial<UnifiedSearchValue>,
  division: SearchDivision,
): Partial<UnifiedSearchValue> {
  if (!draft.division || draft.division === division) return draft
  return { ...draft, ...DIVISION_ATTRIBUTE_DEFAULTS }
}

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
// The search state a freshly mounted search bar starts from (defaults + the session draft, with
// division-specific filters reset when the draft belongs to another division). Exported so the
// results page can run its first search with exactly what the bar shows -- otherwise a restored
// city is displayed in the bar while the list underneath ignores it.
export function restoredSearchValue(initialDivision: SearchDivision): UnifiedSearchValue {
  const restored: UnifiedSearchValue = {
    // No location until the guest picks one ("All of Syria"). Defaulting the picker to Damascus
    // showed a city that the results never applied.
    governorate: '',
    city: '',
    area: '',
    locationTouched: false,
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
    // UX-4B finding 1.1: the draft is what carries geography across division journeys -- that is
    // intended and must survive. What must NOT survive is a division-specific attribute
    // (Brand=Toyota under CARS, Category under MARKETPLACE, condition, etc.). switchDivision()
    // already strips those, but the in-page tab is not the only way a guest changes division:
    // each division route mounts its own SearchPreviewPage, keyed per division in App.tsx
    // (src/app/App.tsx:201-211), so a /cars -> /marketplace navigation rebuilds this state from
    // the draft here and never reaches switchDivision. The reset existed, the remount path simply
    // walked around it. Apply the same defaults on this path too.
    ...restoreDraftForDivision(loadSearchDraft(), initialDivision),
    division: initialDivision,
  }
  // Older drafts carried the untouched Damascus default; never show a location that is not applied.
  return restored.locationTouched ? restored : { ...restored, governorate: '', city: '', area: '' }
}

type Popover = 'where' | 'dates' | 'guests'

export function UnifiedSearchBar({ lang, initialDivision = 'stays', lockedDivision = false, onSearch }: UnifiedSearchBarProps) {
  const t = T[lang]
  // Airbnb-style: every secondary control (calendar, guests, location steps) is a popover that
  // starts closed; only one is open at a time. The filters drawer is closed by default too.
  const [openPop, setOpenPop] = useState<Popover | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [value, setValue] = useState<UnifiedSearchValue>(() => restoredSearchValue(initialDivision))
  const shellRef = useRef<HTMLElement | null>(null)

  // Same reset for the route-change path where this component stays mounted and only the
  // initialDivision prop changes. Guarded on an actual prop change, so a guest's own in-page tab
  // switch is never undone.
  const lastInitialDivision = useRef(initialDivision)
  useEffect(() => {
    if (lastInitialDivision.current === initialDivision) return
    lastInitialDivision.current = initialDivision
    setValue((current) => ({ ...current, division: initialDivision, ...DIVISION_ATTRIBUTE_DEFAULTS }))
  }, [initialDivision])

  useEffect(() => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(SEARCH_DRAFT_KEY, JSON.stringify(value))
  }, [value])

  // Close the open popover on an outside click or Escape.
  useEffect(() => {
    if (!openPop || typeof document === 'undefined') return
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (shellRef.current && target && !shellRef.current.contains(target)) setOpenPop(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPop(null)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [openPop])

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
  const selectedLabels = selectedFilterLabels(filterGroups, filterSelection, lang)
  // The badge counts only what the guest changed: the default "newest" sort is not a filter.
  const changedFilters = selectedFilterLabels(filterGroups, { ...filterSelection, sort: value.sort === 'newest' ? 'any' : value.sort }, lang)
  const filterCount = changedFilters.length + (value.customPlaceName.trim() ? 1 : 0)

  const preview = useMemo(() => {
    const parts = [
      t[value.division],
      governorate ? labelFor(lang, governorate) : '',
      city && labelFor(lang, city) !== labelFor(lang, governorate) ? labelFor(lang, city) : '',
      area ? labelFor(lang, area) : '',
      value.customPlaceName.trim() ? value.customPlaceName.trim() : '',
      isStay && value.checkIn ? value.checkIn : '',
      isStay && value.checkOut ? value.checkOut : '',
      isStay ? `${value.guests} ${t.guests}` : value.keyword,
      isStay ? `${value.bedroomsCount} ${t.bedroomsStepper}` : '',
      isStay ? `${value.bathrooms} ${t.bathrooms}` : '',
      value.carBrand.trim() && value.carBrand !== 'any' ? value.carBrand.trim() : '',
      value.carYear.trim(),
      ...selectedLabels,
    ].filter(Boolean)
    return parts.join(' · ')
  }, [area, city, governorate, isStay, lang, selectedLabels, t, value])

  useEffect(() => {
    if (lockedDivision && value.division !== initialDivision) switchDivision(initialDivision)
  }, [initialDivision, lockedDivision, value.division])

  const update = (patch: Partial<UnifiedSearchValue>) => setValue((current) => ({ ...current, ...patch }))
  const switchDivision = (division: SearchDivision) => update({ division, ...DIVISION_ATTRIBUTE_DEFAULTS })
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

  const handleSearch = () => {
    setOpenPop(null)
    onSearch?.(value)
  }

  const togglePop = (pop: Popover) => setOpenPop((current) => (current === pop ? null : pop))
  const datesSummary = value.checkIn
    ? `${shortDate(value.checkIn, lang)} – ${value.checkOut ? shortDate(value.checkOut, lang) : '…'}`
    : t.anyDates
  const guestsSummary = [
    guestsText(value.guests, lang),
    value.bedroomsCount > 1 ? `${value.bedroomsCount} ${t.bedroomsStepper}` : '',
    value.bathrooms > 1 ? `${value.bathrooms} ${t.bathrooms}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <section ref={shellRef} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="usb" aria-label={t.search}>
      {!lockedDivision ? (
        <div className="usb-tabs">
          {DIVISIONS.map((division) => (
            <button
              key={division}
              type="button"
              onClick={() => switchDivision(division)}
              className={`usb-tab${value.division === division ? ' is-active' : ''}`}
            >
              {t[division]}
            </button>
          ))}
        </div>
      ) : null}

      <div className="usb-row">
        <LocationCascade
          lang={lang}
          open={openPop === 'where'}
          onOpenChange={(open) => setOpenPop(open ? 'where' : null)}
          value={{ governorate: value.governorate, city: value.city, area: value.area }}
          onChange={(next) => {
            // Choosing a governorate narrows the results right away (the server filters by the
            // governorate's city), instead of only once the guest also presses Search.
            const nextValue = { ...value, ...next, locationTouched: true }
            setValue(nextValue)
            if (next.governorate !== value.governorate || !value.locationTouched) onSearch?.(nextValue)
          }}
          onClear={() => {
            const nextValue = { ...value, governorate: '', city: '', area: '', locationTouched: false }
            setValue(nextValue)
            onSearch?.(nextValue)
          }}
        />

        {isStay ? (
          <div className="usb-slot usb-slot-dates">
            <button type="button" className={`usb-pill${openPop === 'dates' ? ' is-open' : ''}`} onClick={() => togglePop('dates')} aria-expanded={openPop === 'dates'}>
              <span className="usb-pill-label">{t.dates}</span>
              <strong className="usb-pill-value">{datesSummary}</strong>
            </button>
            {openPop === 'dates' ? (
              <div className="usb-pop usb-pop-dates" role="dialog" aria-label={t.dates}>
                <DateRangePicker
                  lang={lang}
                  value={{ checkIn: value.checkIn, checkOut: value.checkOut }}
                  onChange={(range) => update(range)}
                  onClose={() => setOpenPop(null)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {isStay ? (
          <div className="usb-slot usb-slot-guests">
            <button type="button" className={`usb-pill${openPop === 'guests' ? ' is-open' : ''}`} onClick={() => togglePop('guests')} aria-expanded={openPop === 'guests'}>
              <span className="usb-pill-label">{t.guests}</span>
              <strong className="usb-pill-value">{guestsSummary}</strong>
            </button>
            {openPop === 'guests' ? (
              <div className="usb-pop usb-pop-guests" role="dialog" aria-label={t.guests}>
                <Stepper
                  lang={lang}
                  label={t.guests}
                  value={value.guests}
                  onDecrease={() => update({ guests: Math.max(1, value.guests - 1) })}
                  onIncrease={() => update({ guests: value.guests + 1 })}
                />
                <Stepper
                  lang={lang}
                  label={t.bedroomsStepper}
                  value={value.bedroomsCount}
                  onDecrease={() => update({ bedroomsCount: Math.max(1, value.bedroomsCount - 1) })}
                  onIncrease={() => update({ bedroomsCount: value.bedroomsCount + 1 })}
                />
                <Stepper
                  lang={lang}
                  label={t.bathrooms}
                  value={value.bathrooms}
                  onDecrease={() => update({ bathrooms: Math.max(1, value.bathrooms - 1) })}
                  onIncrease={() => update({ bathrooms: value.bathrooms + 1 })}
                />
                <div className="usb-pop-actions">
                  <button type="button" className="usb-pop-done" onClick={() => setOpenPop(null)}>{t.done}</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <label className="usb-slot usb-pill usb-pill-input">
            <span className="usb-pill-label">{t.keyword}</span>
            <input
              value={value.keyword}
              onChange={(event) => update({ keyword: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSearch()
              }}
              placeholder={t.keywordPlaceholder}
            />
          </label>
        )}

        <button
          type="button"
          className={`usb-filters-toggle${showFilters ? ' is-open' : ''}`}
          onClick={() => {
            setOpenPop(null)
            setShowFilters((current) => !current)
          }}
          aria-expanded={showFilters}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
          <span>{t.filtersButton}</span>
          {filterCount > 0 ? <b className="usb-filters-count">{filterCount}</b> : null}
        </button>

        <button type="button" className="usb-search" onClick={handleSearch}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span>{t.search}</span>
        </button>
      </div>

      {showFilters ? (
        <div className="usb-filters-panel">
          <VisualFilterPanel groups={filterGroups} lang={lang} selection={filterSelection} onChange={updateFilters} compact />

          <label className="usb-field">
            <span>{t.customPlace}</span>
            <input
              value={value.customPlaceName}
              onChange={(event) => update({ customPlaceName: event.target.value })}
              placeholder={t.customPlacePlaceholder}
            />
          </label>
          {value.customPlaceName.trim() ? <p className="usb-hint">{t.customPlaceHint}</p> : null}

          <div className="usb-preview">
            <span>{t.resultPreview}</span>
            <b>{preview}</b>
          </div>

          <div className="usb-pop-actions">
            <button type="button" className="usb-search" onClick={() => { setShowFilters(false); handleSearch() }}>
              <span>{t.applyFilters}</span>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Stepper({ label, lang, value, onDecrease, onIncrease }: { label: string; lang: Lang; value: number; onDecrease: () => void; onIncrease: () => void }) {
  return (
    <div className="usb-stepper">
      <span>{label}</span>
      <span className="usb-stepper-controls" dir="ltr">
        <button type="button" onClick={onDecrease} disabled={value <= 1} aria-label={pick(lang, `إنقاص ${label}`, `Decrease ${label}`, `Diminuer : ${label}`)}>−</button>
        <strong>{value}</strong>
        <button type="button" onClick={onIncrease} aria-label={pick(lang, `زيادة ${label}`, `Increase ${label}`, `Augmenter : ${label}`)}>+</button>
      </span>
    </div>
  )
}

function shortDate(iso: string, lang: Lang) {
  // "12 octobre 2026" -> "12 octobre": the year only adds width to the pill.
  return formatDateForLang(iso, lang).replace(/\s\d{4}$/, '')
}

function guestsText(count: number, lang: Lang) {
  if (lang === 'ar') {
    if (count === 1) return 'ضيف واحد'
    if (count === 2) return 'ضيفان'
    if (count <= 10) return `${count} ضيوف`
    return `${count} ضيفاً`
  }
  if (lang === 'fr') return `${count} voyageur${count > 1 ? 's' : ''}`
  return `${count} guest${count > 1 ? 's' : ''}`
}

function stringValue(value: string | string[] | undefined, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function arrayValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : []
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
  optionGroup: { border: '1px solid #30384d', borderRadius: 14, background: '#111827', margin: 0, minWidth: 0, padding: '10px 10px 12px' },
  optionLegend: { color: '#9aa6ba', fontSize: 12, fontWeight: 900, padding: '0 6px' },
  optionRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  optionButton: { alignItems: 'center', border: '1px solid #30384d', borderRadius: 12, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 4, justifyItems: 'center', minHeight: 58, minWidth: 58, padding: '7px 8px' },
  optionButtonActive: { alignItems: 'center', border: '1px solid #7f94ff', borderRadius: 12, background: '#263575', color: '#fff', display: 'grid', gap: 4, justifyItems: 'center', minHeight: 58, minWidth: 58, padding: '7px 8px' },
  optionIcon: { fontSize: 16, fontWeight: 950, lineHeight: 1 },
}
