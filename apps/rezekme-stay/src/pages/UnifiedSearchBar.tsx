import { useEffect, useMemo, useRef, useState } from 'react'
import { pick, text, type Lang } from '@platform/engines/language/languageEngine'
import { visualFilterGroupsForDivision, type VisualFilterGroup, type VisualFilterSelection } from '@platform/engines/filters'
import { selectedFilterLabels } from '@platform/shared/filters/VisualFilterPanel'
import { labelFor, getCity, getGovernorate } from '@platform/engines/search'
import { LocationCascade } from '@platform/modules/search/LocationCascade'
import { DateRangePicker, formatDateForLang } from './DateRangePicker'

// Stays-only search bar, restyled as an Airbnb-pattern "search pill" (Where / When / Who) that opens
// into the existing fields (location cascade, date range, guest steppers, filters). The value shape
// and the draft key match the platform bar so the search request built from it is identical.

export type SearchDivision = 'stays'

export type UnifiedSearchValue = {
  division: SearchDivision
  governorate: string
  city: string
  area: string
  // True only once the guest actually picks a governorate/city/area -- lets callers tell "user
  // chose Damascus" apart from an untouched default so it never becomes a silent city filter.
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

// Lets a listing page pre-fill the dates the guest already picked on the search page.
export function loadSearchDatesDraft(): { checkIn: string; checkOut: string } | null {
  const draft = loadSearchDraft()
  if (!draft.checkIn || !draft.checkOut) return null
  return { checkIn: draft.checkIn, checkOut: draft.checkOut }
}

export type LocationRequest = { governorate: string; nonce: number }

type UnifiedSearchBarProps = {
  lang: Lang
  onSearch?: (value: UnifiedSearchValue) => void
  // Set by the chip row on the results page: pick this governorate ('' = all of Syria) and search.
  locationRequest?: LocationRequest | null
}

const T = {
  ar: {
    where: 'أين',
    when: 'متى',
    who: 'مع من',
    whereTo: 'إلى أين؟',
    allSyria: 'كل سوريا',
    anyDates: 'أي تاريخ',
    guests: 'الضيوف',
    bedroomsStepper: 'غرف نوم',
    bathrooms: 'حمامات',
    dates: 'التواريخ',
    search: 'بحث',
    filtersButton: 'الفلاتر',
    applyFilters: 'عرض النتائج',
    done: 'تم',
    close: 'إغلاق',
    panelTitle: 'ابحث عن إقامة',
  },
  en: {
    where: 'Where',
    when: 'When',
    who: 'Who',
    whereTo: 'Where to?',
    allSyria: 'All of Syria',
    anyDates: 'Any dates',
    guests: 'Guests',
    bedroomsStepper: 'Bedrooms',
    bathrooms: 'Bathrooms',
    dates: 'Dates',
    search: 'Search',
    filtersButton: 'Filters',
    applyFilters: 'Show results',
    done: 'Done',
    close: 'Close',
    panelTitle: 'Find a stay',
  },
  fr: {
    where: 'Où',
    when: 'Quand',
    who: 'Qui',
    whereTo: 'Où allez-vous ?',
    allSyria: 'Toute la Syrie',
    anyDates: 'Dates flexibles',
    guests: 'Voyageurs',
    bedroomsStepper: 'Chambres',
    bathrooms: 'Salles de bain',
    dates: 'Dates',
    search: 'Rechercher',
    filtersButton: 'Filtres',
    applyFilters: 'Afficher les résultats',
    done: 'OK',
    close: 'Fermer',
    panelTitle: 'Trouver un séjour',
  },
}

// Same defaults as the platform bar; the guest's location, dates and guests come from the draft.
export function restoredSearchValue(_initialDivision: SearchDivision = 'stays'): UnifiedSearchValue {
  const restored: UnifiedSearchValue = {
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
    ...loadSearchDraft(),
    division: 'stays',
  }
  return restored.locationTouched ? restored : { ...restored, governorate: '', city: '', area: '' }
}

type Popover = 'where' | 'dates' | 'guests'

export function UnifiedSearchBar({ lang, onSearch, locationRequest }: UnifiedSearchBarProps) {
  const t = T[lang]
  const [expanded, setExpanded] = useState(false)
  const [openPop, setOpenPop] = useState<Popover | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [value, setValue] = useState<UnifiedSearchValue>(() => restoredSearchValue('stays'))
  const panelRef = useRef<HTMLDivElement | null>(null)
  const handledRequest = useRef(0)

  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_DRAFT_KEY, JSON.stringify(value))
    } catch {
      // storage blocked: the draft just isn't remembered
    }
  }, [value])

  // Governorate chip from the results page.
  useEffect(() => {
    if (!locationRequest || locationRequest.nonce === handledRequest.current) return
    handledRequest.current = locationRequest.nonce
    const gov = getGovernorate(locationRequest.governorate)
    const next: UnifiedSearchValue = locationRequest.governorate && gov
      ? { ...value, governorate: gov.key, city: gov.cities[0]?.key || '', area: '', locationTouched: true }
      : { ...value, governorate: '', city: '', area: '', locationTouched: false }
    setValue(next)
    onSearch?.(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationRequest])

  // Escape closes the popover first, then the panel.
  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (openPop) setOpenPop(null)
      else setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded, openPop])

  const governorate = getGovernorate(value.governorate)
  const city = getCity(value.governorate, value.city)
  const area = city?.areas.find((item) => item.key === value.area)
  const filterGroups = useMemo(() => visualFilterGroupsForDivision('stays'), [])
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
  // The badge counts only what the guest changed: the default "newest" sort is not a filter.
  const changedFilters = selectedFilterLabels(filterGroups, { ...filterSelection, sort: value.sort === 'newest' ? 'any' : value.sort }, lang)
  const filterCount = changedFilters.length

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

  const handleSearch = () => {
    setOpenPop(null)
    setShowFilters(false)
    setExpanded(false)
    onSearch?.(value)
  }

  const togglePop = (pop: Popover) => setOpenPop((current) => (current === pop ? null : pop))
  const placeSummary = [
    governorate ? labelFor(lang, governorate) : '',
    city && governorate && labelFor(lang, city) !== labelFor(lang, governorate) ? labelFor(lang, city) : '',
    area ? labelFor(lang, area) : '',
  ].filter(Boolean).join(' · ')
  const datesSummary = value.checkIn
    ? `${shortDate(value.checkIn, lang)} – ${value.checkOut ? shortDate(value.checkOut, lang) : '…'}`
    : t.anyDates
  const guestsSummary = [
    guestsText(value.guests, lang),
    value.bedroomsCount > 1 ? `${value.bedroomsCount} ${t.bedroomsStepper}` : '',
    value.bathrooms > 1 ? `${value.bathrooms} ${t.bathrooms}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <>
      <button type="button" className="str-pill" onClick={() => setExpanded(true)} aria-haspopup="dialog" aria-expanded={expanded}>
        <span className="str-pill-mobile">
          <strong>{placeSummary || t.whereTo}</strong>
          <small>{[placeSummary ? '' : t.allSyria, datesSummary, guestsText(value.guests, lang)].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="str-pill-seg">
          <small>{t.where}</small>
          <strong>{placeSummary || t.allSyria}</strong>
        </span>
        <span className="str-pill-seg">
          <small>{t.when}</small>
          <strong>{datesSummary}</strong>
        </span>
        <span className="str-pill-seg">
          <small>{t.who}</small>
          <strong>{guestsText(value.guests, lang)}</strong>
        </span>
        <span className="str-pill-go" aria-hidden="true">
          <SearchIcon />
        </span>
        <span className="str-sr-only">{t.search}</span>
        {filterCount > 0 ? <b className="str-pill-badge">{filterCount}</b> : null}
      </button>

      {expanded ? (
        <div className="str-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}>
          <div ref={panelRef} className="str-sheet usb" role="dialog" aria-modal="true" aria-label={t.panelTitle} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <div className="str-sheet-head">
              <strong>{t.panelTitle}</strong>
              <button type="button" className="str-icon-btn" onClick={() => setExpanded(false)} aria-label={t.close}>✕</button>
            </div>

            <div className="str-sheet-body">
              <LocationCascade
                lang={lang}
                open={openPop === 'where'}
                onOpenChange={(open) => setOpenPop(open ? 'where' : null)}
                value={{ governorate: value.governorate, city: value.city, area: value.area }}
                onChange={(next) => {
                  // Choosing a governorate narrows the results right away.
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

              {showFilters ? (
                <div className="str-filters">
                  {filterGroups.map((group) => (
                    <FilterGroup key={group.id} group={group} lang={lang} selection={filterSelection} onChange={updateFilters} />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="str-sheet-foot">
              <button type="button" className="str-btn str-btn-primary" onClick={handleSearch}>
                <SearchIcon />
                <span>{showFilters ? t.applyFilters : t.search}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function FilterGroup({
  group,
  lang,
  selection,
  onChange,
}: {
  group: VisualFilterGroup
  lang: Lang
  selection: VisualFilterSelection
  onChange: (selection: VisualFilterSelection) => void
}) {
  const current = selection[group.id]
  const isSelected = (optionId: string) => (Array.isArray(current) ? current.includes(optionId) : (current || 'any') === optionId)
  const choose = (optionId: string) => {
    if (group.mode === 'single') {
      onChange({ ...selection, [group.id]: optionId })
      return
    }
    const list = Array.isArray(current) ? current : []
    onChange({ ...selection, [group.id]: list.includes(optionId) ? list.filter((item) => item !== optionId) : [...list, optionId] })
  }
  return (
    <fieldset className="str-filter-group">
      <legend>{text(group.title, lang)}</legend>
      <div className="str-chips-wrap">
        {group.options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={isSelected(option.id)}
            className={`str-chip str-chip-sm${isSelected(option.id) ? ' is-active' : ''}`}
            onClick={() => choose(option.id)}
          >
            {text(option.label, lang)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
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
