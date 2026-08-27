import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { renterPropertyFilterGroups, type VisualFilterSelection } from '../../engines/filters'
import { getCity, getGovernorate, labelFor, SYRIA_GOVERNORATES } from '../../engines/search'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { fetchApprovedListings, getStoredGuestSession, sendListingInquiryMessage, uploadPaymentProofFile, type PlatformListing } from '../../shared/api/platformApi'
import { listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { colors, withAlpha } from '../../shared/theme/tokens'

type Props = {
  lang: Lang
  mode?: 'rentals' | 'buy'
}

// A real bug caught by an independent re-audit: this used to capture only the File object's
// `name` -- no bytes were ever uploaded, despite the UI presenting a real upload control and the
// outbound message telling the guest (only after the fact, buried in text they never saw) to send
// the actual files separately over WhatsApp/email. Now uses the same real
// uploadPaymentProofFile() path the seller side already had wired up.
type UploadedDocument = { name: string; url: string }

type RentalRequest = {
  id: string
  listingId: string
  listingTitle: string
  documents: UploadedDocument[]
  createdAt: string
  status: 'SENT_TO_IMMOCONTACT'
}

// A real bug caught by an independent re-audit: this used to include a 'date' search panel
// ('This week'/'This month'/'3 months'/'Open date') that was purely cosmetic -- the chosen value
// was shown in the search summary but never sent to fetchApprovedListings, and RENTALS/BUY have
// no backend concept of availability dates at all (they're commission/contact-based, not
// booking-based). Removed entirely rather than left as a filter that silently does nothing.
type SearchPanel = 'governorate' | 'city' | 'street' | null
type SortMode = 'newest' | 'lowest'

const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'
const GUEST_TOKEN_KEY = 'sybnb-v6-guest-token'

// Map governorate key -> the English city name stored in listing.location.city (Syria's 5 governorates).
const GOV_TO_CITY: Record<string, string> = {
  damascus: 'Damascus',
  aleppo: 'Aleppo',
  latakia: 'Latakia',
  homs: 'Homs',
  tartus: 'Tartus',
}
const mainGroupOptions = [
  { id: 'apartment', ar: 'شقة', en: 'Apartment' },
  { id: 'villa', ar: 'فيلا', en: 'Villa' },
  { id: 'room', ar: 'غرفة', en: 'Room' },
  { id: 'office', ar: 'مكتب', en: 'Office' },
  { id: 'shop', ar: 'محل', en: 'Shop' },
  { id: 'land', ar: 'أرض', en: 'Land' },
]

const copy = {
  ar: {
    previous: 'السابق',
    next: 'التالي',
    logo: 'SYBNB',
    navTitle: 'الإيجار',
    login: 'تسجيل الدخول',
    signup: 'إنشاء حساب',
    search: 'بحث',
    searchCapsule: 'كبسولة البحث',
    searchCapsuleHint: 'اختر الموقع ثم افتح خيارات الباحث.',
    rouletteHint: 'اسحب الشريط لاختيار المنطقة بسرعة.',
    applied: 'تم تطبيق كبسولة البحث.',
    beforeSearch: 'ابدأ من كبسولة البحث لاختيار نوع العقار والموقع. بعد الضغط على بحث تظهر النتائج ثم تفاصيل العقار.',
    mainGroup: 'نوع العقار',
    chooseGovernorate: 'اختر المحافظة',
    chooseCity: 'اختر المدينة',
    chooseStreet: 'اختر الحي / الشارع',
    governorate: 'المحافظة',
    city: 'المدينة',
    street: 'حي / شارع',
    newest: 'الأحدث',
    lowestPrice: 'الأقل سعراً',
    availableResults: 'النتائج المتاحة',
    loadMore: 'عرض المزيد',
    loadingMore: 'جار التحميل...',
    sendRequest: 'إرسال طلب',
    viewDetails: 'عرض التفاصيل',
    chooseAfterAccount: 'افتح الحساب أولاً',
    eyebrow: 'الإيجار الشهري',
    title: 'مسار المستأجر',
    subtitle: 'بحث منفصل للإيجار الشهري: اختر العقار، افتح حساب، ارفع مستندات المستأجر، ثم أرسل طلب التواصل عبر IMMOContact.',
    searchTitle: 'عقارات شهرية فقط',
    filterTitle: 'خيارات الباحث',
    showFilters: 'فتح خيارات الباحث',
    hideFilters: 'إغلاق خيارات الباحث',
    selectedFilters: 'الاختيارات',
    noFilters: 'اختر خيارات البحث بنفس نظام STR.',
    renterTunnel: 'نفق المستأجر',
    live: 'نتائج مباشرة',
    selected: 'العقار المختار',
    detailTitle: 'تفاصيل العقار المختار',
    protected: 'محمي عبر SYBNB',
    trustedOwner: 'مالك موثوق',
    fastContact: 'تواصل سريع',
    detailSteps: ['افتح حساب المستأجر', 'ارفع مستندات الطلب', 'أرسل الطلب إلى IMMOContact', 'انتظر موافقة المالك والإدارة'],
    noSelection: 'اختر عقاراً من النتائج قبل إرسال الطلب.',
    choose: 'اختيار العقار',
    openAccount: 'فتح حساب المستأجر',
    accountGateTitle: 'افتح حساب المستأجر للمتابعة',
    accountGateText: 'يمكنك مشاهدة التفاصيل أولاً، لكن إرسال الطلب ورفع المستندات يتم بعد تسجيل الدخول أو إنشاء حساب.',
    accountReady: 'حساب المستأجر جاهز',
    docsTitle: 'مستندات المستأجر',
    docsHint: 'ارفع الهوية، إثبات العمل أو الدخل، وأي ملف يدعم طلب الإيجار الشهري. PDF / PNG / JPG.',
    docsUpload: 'رفع المستندات',
    docsReady: 'مستندات مرفوعة',
    uploading: 'جارٍ رفع الملفات...',
    uploadFailed: 'تعذر رفع الملف',
    requestStatusTitle: 'حالة الطلب',
    stepAccountOpened: 'فتح الحساب',
    stepDocumentsUploaded: 'رفع المستندات',
    stepSentToImmoContact: 'إرسال الطلب إلى IMMOContact',
    referenceLabel: 'رقم المرجع',
    agreementTitle: 'اتفاقية طلب الإيجار الشهري',
    agreementCopy: 'أوافق أن بياناتي صحيحة، وأن التواصل والعقد والمستندات تتم عبر SYBNB و IMMOContact، وأن أي نزاع أو تغيير في الشروط يراجع عبر المنصة قبل أي اتفاق خارجي.',
    send: 'إرسال طلب التواصل',
    sending: 'جارٍ الإرسال...',
    sent: 'تم إرسال طلب المستأجر إلى IMMOContact',
    openInbox: 'فتح IMMOContact',
    required: 'افتح حساب المستأجر، اختر عقاراً، ارفع مستنداً واحداً على الأقل، واقبل الاتفاقية قبل الإرسال.',
    price: 'الإيجار الشهري',
    owner: 'المالك',
    status: 'الحالة',
    empty: 'لا توجد عقارات شهرية منشورة بعد.',
    loading: 'جار التحميل',
    error: 'تعذر تحميل عقارات الإيجار الشهري',
    steps: ['بحث الإيجار الشهري', 'اختيار العقار', 'فتح حساب المستأجر', 'رفع المستندات', 'إرسال IMMOContact'],
  },
  en: {
    previous: 'Back',
    next: 'Next',
    logo: 'SYBNB',
    navTitle: 'Rentals',
    login: 'Sign in',
    signup: 'Create account',
    search: 'Search',
    searchCapsule: 'Search capsule',
    searchCapsuleHint: 'Choose location, then open searcher choices.',
    rouletteHint: 'Swipe the strip to choose the area quickly.',
    applied: 'Search capsule applied.',
    beforeSearch: 'Start with the search capsule to choose property type and location. After Search, results and property details appear.',
    mainGroup: 'Property type',
    chooseGovernorate: 'Choose governorate',
    chooseCity: 'Choose city',
    chooseStreet: 'Choose district / street',
    governorate: 'Governorate',
    city: 'City',
    street: 'District / street',
    newest: 'Newest',
    lowestPrice: 'Lowest price',
    availableResults: 'Available results',
    loadMore: 'Load more',
    loadingMore: 'Loading...',
    sendRequest: 'Send request',
    viewDetails: 'View details',
    chooseAfterAccount: 'Open account first',
    eyebrow: 'Monthly rentals',
    title: 'Renter tunnel',
    subtitle: 'A separate monthly-rental flow: choose a property, open an account, upload renter documents, then send the contact request through IMMOContact.',
    searchTitle: 'Monthly properties only',
    filterTitle: 'Searcher choices',
    showFilters: 'Open searcher choices',
    hideFilters: 'Close searcher choices',
    selectedFilters: 'Selected choices',
    noFilters: 'Choose search options using the same STR system.',
    renterTunnel: 'Renter tunnel',
    live: 'Live results',
    selected: 'Selected property',
    detailTitle: 'Selected property details',
    protected: 'Protected through SYBNB',
    trustedOwner: 'Trusted owner',
    fastContact: 'Fast contact',
    detailSteps: ['Open renter account', 'Upload request documents', 'Send to IMMOContact', 'Wait for owner and admin approval'],
    noSelection: 'Choose a property from the results before sending the request.',
    choose: 'Choose property',
    openAccount: 'Open renter account',
    accountGateTitle: 'Open renter account to continue',
    accountGateText: 'You can inspect the details first, but request submission and document upload require sign in or account creation.',
    accountReady: 'Renter account ready',
    docsTitle: 'Renter documents',
    docsHint: 'Upload ID, work or income proof, and any file supporting the monthly rental request. PDF / PNG / JPG.',
    docsUpload: 'Upload documents',
    docsReady: 'Documents uploaded',
    uploading: 'Uploading files...',
    uploadFailed: 'Could not upload file',
    requestStatusTitle: 'Request status',
    stepAccountOpened: 'Account opened',
    stepDocumentsUploaded: 'Documents uploaded',
    stepSentToImmoContact: 'Sent to IMMOContact',
    referenceLabel: 'Reference',
    agreementTitle: 'Monthly Rental Request Agreement',
    agreementCopy: 'I agree my details are accurate, and that contact, contract, and documents remain inside SYBNB and IMMOContact. Any dispute or term change must be reviewed through the platform before any outside agreement.',
    send: 'Send contact request',
    sending: 'Sending...',
    sent: 'Renter request sent to IMMOContact',
    openInbox: 'Open IMMOContact',
    required: 'Open renter account, choose a property, upload at least one document, and accept the agreement before sending.',
    price: 'Monthly rent',
    owner: 'Owner',
    status: 'Status',
    empty: 'No published monthly rentals yet.',
    loading: 'Loading',
    error: 'Could not load monthly rentals',
    steps: ['Monthly search', 'Choose property', 'Open renter account', 'Upload documents', 'Send IMMOContact'],
  },
}

const buyerCopy = {
  ar: {
    navTitle: 'شراء عقار',
    searchCapsuleHint: 'اختر الموقع ونوع العقار ثم افتح خيارات الباحث قبل طلب الزيارة.',
    beforeSearch: 'ابدأ من كبسولة البحث لاختيار نوع العقار والموقع. بعد الضغط على بحث تظهر عقارات البيع ثم تفاصيل العقار.',
    availableResults: 'عقارات البيع المتاحة',
    sendRequest: 'طلب زيارة',
    eyebrow: 'شراء العقار',
    title: 'مسار المشتري',
    subtitle: 'بحث منفصل للمشتري: اختر العقار، افتح حساب، ارفع مستندات المشتري، ثم أرسل طلب الزيارة أو التواصل عبر IMMOContact.',
    searchTitle: 'عقارات للبيع فقط',
    renterTunnel: 'نفق المشتري',
    selected: 'العقار المختار',
    detailTitle: 'تفاصيل العقار المختار',
    detailSteps: ['افتح حساب المشتري', 'ارفع مستندات الطلب', 'أرسل طلب الزيارة عبر IMMOContact', 'انتظر موافقة المالك والإدارة'],
    choose: 'اختيار العقار',
    openAccount: 'فتح حساب المشتري',
    accountGateTitle: 'افتح حساب المشتري للمتابعة',
    accountGateText: 'يمكنك مشاهدة التفاصيل أولاً، لكن طلب الزيارة ورفع مستندات الشراء يتم بعد تسجيل الدخول أو إنشاء حساب.',
    accountReady: 'حساب المشتري جاهز',
    docsTitle: 'مستندات المشتري',
    docsHint: 'ارفع الهوية، إثبات القدرة المالية أو التمويل، وأي ملف يدعم طلب شراء العقار. PDF / PNG / JPG.',
    agreementTitle: 'اتفاقية طلب شراء العقار',
    agreementCopy: 'أوافق أن بياناتي صحيحة، وأن التواصل والزيارة والمستندات تتم عبر SYBNB و IMMOContact، وأن أي عرض أو تغيير في الشروط يراجع عبر المنصة قبل أي اتفاق خارجي.',
    send: 'إرسال طلب الزيارة',
    sending: 'جارٍ الإرسال...',
    sent: 'تم إرسال طلب المشتري إلى IMMOContact',
    required: 'افتح حساب المشتري، اختر عقاراً، ارفع مستنداً واحداً على الأقل، واقبل الاتفاقية قبل الإرسال.',
    price: 'سعر العقار',
    empty: 'لا توجد عقارات للبيع منشورة بعد.',
    error: 'تعذر تحميل عقارات الشراء',
    steps: ['بحث شراء العقار', 'اختيار العقار', 'فتح حساب المشتري', 'رفع المستندات', 'إرسال IMMOContact'],
  },
  en: {
    navTitle: 'Buy Property',
    searchCapsuleHint: 'Choose location and property type, then open searcher choices before requesting a visit.',
    beforeSearch: 'Start with the search capsule to choose property type and location. After Search, sale results and property details appear.',
    availableResults: 'Available sale properties',
    sendRequest: 'Request visit',
    eyebrow: 'Buy property',
    title: 'Buyer tunnel',
    subtitle: 'A separate buyer flow: choose a property, open an account, upload buyer documents, then send a visit or contact request through IMMOContact.',
    searchTitle: 'Sale properties only',
    renterTunnel: 'Buyer tunnel',
    selected: 'Selected property',
    detailTitle: 'Selected property details',
    detailSteps: ['Open buyer account', 'Upload request documents', 'Send visit request through IMMOContact', 'Wait for owner and admin approval'],
    choose: 'Choose property',
    openAccount: 'Open buyer account',
    accountGateTitle: 'Open buyer account to continue',
    accountGateText: 'You can inspect the details first, but visit requests and buyer document upload require sign in or account creation.',
    accountReady: 'Buyer account ready',
    docsTitle: 'Buyer documents',
    docsHint: 'Upload ID, proof of funds or financing, and any file supporting the purchase request. PDF / PNG / JPG.',
    agreementTitle: 'Property Purchase Request Agreement',
    agreementCopy: 'I agree my details are accurate, and that contact, visits, and documents remain inside SYBNB and IMMOContact. Any offer or term change must be reviewed through the platform before any outside agreement.',
    send: 'Send visit request',
    sending: 'Sending...',
    sent: 'Buyer request sent to IMMOContact',
    required: 'Open buyer account, choose a property, upload at least one document, and accept the agreement before sending.',
    price: 'Property price',
    empty: 'No published sale properties yet.',
    error: 'Could not load sale properties',
    steps: ['Buyer search', 'Choose property', 'Open buyer account', 'Upload documents', 'Send IMMOContact'],
  },
}

export function RentalsPage({ lang, mode = 'rentals' }: Props) {
  const isBuyMode = mode === 'buy'
  const t = isBuyMode ? { ...copy[lang], ...buyerCopy[lang] } : copy[lang]
  const isAr = lang === 'ar'
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lastQuery, setLastQuery] = useState<{ division: string; filters?: Parameters<typeof fetchApprovedListings>[1] } | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const [acceptedAgreement, setAcceptedAgreement] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [sentRequest, setSentRequest] = useState<RentalRequest | null>(null)
  const [sendState, setSendState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [showFilters, setShowFilters] = useState(true)
  const [hasSearched, setHasSearched] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [activeSearchPanel, setActiveSearchPanel] = useState<SearchPanel>(null)
  const [selectedGovernorate, setSelectedGovernorate] = useState('damascus')
  const [selectedCity, setSelectedCity] = useState('damascus-city')
  const [selectedStreet, setSelectedStreet] = useState('old-city')
  // A real bug caught by an independent re-audit: amenities/trust used to default to
  // pre-checked ('wifi','parking','verifiedHost') even though none of these reach the backend
  // for RENTALS/BUY (only propertyType and numeric price/bedrooms/bathrooms are ever forwarded --
  // see server/routes/listings.mjs) -- so a first-time visitor saw active-looking filter
  // checkmarks that silently did nothing. Default to unselected, same as `access`, until the
  // filtering these groups imply is actually wired up server-side.
  const [visualFilters, setVisualFilters] = useState<VisualFilterSelection>({
    sort: 'newest',
    priceBand: 'any',
    propertyType: 'any',
    roomType: 'any',
    bedType: 'any',
    amenities: [],
    access: [],
    trust: [],
  })
  const hasGuestAccount = typeof window !== 'undefined' && Boolean(sessionStorage.getItem(GUEST_TOKEN_KEY))
  const activeFilterLabels = useMemo(
    () => selectedFilterLabels(renterPropertyFilterGroups, visualFilters, lang),
    [lang, visualFilters],
  )
  const selectedGovernorateData = getGovernorate(selectedGovernorate)
  const selectedCityData = getCity(selectedGovernorate, selectedCity)
  const selectedAreaData = selectedCityData?.areas.find((area) => area.key === selectedStreet)
  const selectedGovernorateLabel = labelFor(lang, selectedGovernorateData)
  const selectedCityLabel = labelFor(lang, selectedCityData)
  const selectedStreetLabel = labelFor(lang, selectedAreaData)
  const currentPanelOptions = (
    activeSearchPanel === 'governorate'
      ? SYRIA_GOVERNORATES.map((item) => ({ key: item.key, label: labelFor(lang, item) }))
      : activeSearchPanel === 'city'
        ? (selectedGovernorateData?.cities || []).map((item) => ({ key: item.key, label: labelFor(lang, item) }))
        : (selectedCityData?.areas || []).map((item) => ({ key: item.key, label: labelFor(lang, item) }))
  )
  const visibleListings = useMemo(() => {
    if (sortMode === 'lowest') {
      return [...listings].sort((left, right) => left.priceMinor - right.priceMinor)
    }
    return listings
  }, [listings, sortMode])

  const selectedListing = useMemo(
    () => visibleListings.find((listing) => listing.id === selectedId) || visibleListings[0],
    [visibleListings, selectedId],
  )

  useEffect(() => {
    void loadRentals()
  }, [mode])

  async function loadRentals(explicit = false) {
    setStatus('loading')
    setMessage('')
    try {
      // Forward the renter's visual-filter selection so the search actually narrows results.
      // fetchApprovedListings only forwards server-backed scalar keys (propertyType); 'any' and
      // unsupported keys (roomType/bedType/amenities) are ignored, so nothing over-filters.
      // Location narrows only on an explicit capsule search, so the first broad load stays rich.
      const division = isBuyMode ? 'BUY' : 'RENTALS'
      const filters = {
        attributes: visualFilters,
        city: explicit ? GOV_TO_CITY[selectedGovernorate] : undefined,
      }
      const results = await fetchApprovedListings(division, filters)
      setListings(results.listings)
      setNextCursor(results.nextCursor)
      setLastQuery({ division, filters })
      setSelectedId(results.listings[0]?.id || '')
      setStatus('ready')
      // Show available results by default — consistent with Stays/Cars/Marketplace/New Construction,
      // which auto-populate. The search capsule still refines; this removes the empty-looking
      // "there are no listings" first impression without changing any business rule.
      setHasSearched(true)
    } catch (error) {
      setListings([])
      setNextCursor(null)
      setLastQuery(null)
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function loadMoreListings() {
    if (!nextCursor || loadingMore || !lastQuery) return
    setLoadingMore(true)
    try {
      const results = await fetchApprovedListings(lastQuery.division, lastQuery.filters, nextCursor)
      setListings((prev) => [...prev, ...results.listings])
      setNextCursor(results.nextCursor)
    } catch {
      // Keep whatever is already shown; just stop offering more rather than clearing real results.
      setNextCursor(null)
    } finally {
      setLoadingMore(false)
    }
  }

  function openAccount() {
    sessionStorage.setItem(GUEST_RETURN_PATH_KEY, isBuyMode ? '/buy' : '/rentals')
    window.location.hash = '/account/open'
  }

  function openContactCenter() {
    if (!hasGuestAccount) {
      sessionStorage.setItem(GUEST_RETURN_PATH_KEY, '/immocontact')
      window.location.hash = '/account/open'
      return
    }
    window.location.hash = '/immocontact'
  }

  function chooseListing(listingId: string) {
    setSelectedId(listingId)
    setMessage('')
  }

  function chooseGovernorate(value: string) {
    const nextGovernorate = getGovernorate(value)
    const nextCity = nextGovernorate?.cities[0]
    setSelectedGovernorate(value)
    setSelectedCity(nextCity?.key || '')
    setSelectedStreet(nextCity?.areas[0]?.key || '')
    setActiveSearchPanel('city')
  }

  function chooseCity(value: string) {
    const nextCity = getCity(selectedGovernorate, value)
    setSelectedCity(value)
    setSelectedStreet(nextCity?.areas[0]?.key || '')
    setActiveSearchPanel('street')
  }

  function applySearchCapsule() {
    setMessage(t.applied)
    setActiveSearchPanel(null)
    setHasSearched(true)
    setShowFilters(false)
    // Re-run the fetch so the selected filters (incl. location) actually apply to the results.
    void loadRentals(true)
  }

  function chooseMainGroup(value: string) {
    setVisualFilters((current) => ({ ...current, propertyType: value }))
  }

  async function uploadDocuments(files: FileList | null) {
    const fileList = Array.from(files || [])
    if (!fileList.length) return
    setUploadError('')
    setUploadingCount(fileList.length)
    try {
      const session = getStoredGuestSession()
      if (!session) throw new Error(t.required)
      const uploaded = await Promise.all(
        fileList.map(async (file) => ({ name: file.name, url: await uploadPaymentProofFile(file, session.token) })),
      )
      setDocuments((current) => [...current, ...uploaded])
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t.required)
    } finally {
      setUploadingCount(0)
    }
  }

  async function sendRequest() {
    if (!hasGuestAccount || !selectedListing || documents.length === 0 || !acceptedAgreement) {
      setMessage(t.required)
      if (!hasGuestAccount) openAccount()
      return
    }

    setSendState('saving')
    setMessage('')

    // Documents are now real, already-uploaded files (see uploadDocuments above) -- their URLs are
    // included directly, not a "send it separately" instruction the guest never saw.
    const docLines = documents.map((doc) => `${doc.name}: ${doc.url}`).join(isAr ? '، ' : ', ')
    const introBody = isAr
      ? `طلب ${isBuyMode ? 'شراء' : 'استئجار'} جديد على "${listingTitleText(selectedListing, lang)}".\nالمستندات المرفوعة: ${docLines}`
      : `New ${isBuyMode ? 'purchase' : 'rental'} request for "${listingTitleText(selectedListing, lang)}".\nUploaded documents: ${docLines}`

    try {
      // Use the real persisted message id as the reference -- not a client-fabricated
      // "RENTAL-CAPSULE-<timestamp>" code implying a tracked transaction that doesn't exist.
      const sentMessage = await sendListingInquiryMessage(selectedListing.id, introBody)

      const request: RentalRequest = {
        id: sentMessage.id,
        listingId: selectedListing.id,
        listingTitle: listingTitleText(selectedListing, lang),
        documents,
        createdAt: new Date().toISOString(),
        status: 'SENT_TO_IMMOCONTACT',
      }
      setSentRequest(request)
      setMessage(t.sent)
      setSendState('idle')
    } catch (error) {
      setSendState('error')
      setMessage(error instanceof Error ? error.message : t.required)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.searchCapsule}>
        <div style={styles.searchCapsuleText}>
          <span style={styles.eyebrow}>{t.searchCapsule}</span>
          <h1 style={{ margin: 0, fontSize: 'inherit', fontWeight: 800 }}>{t.searchTitle}</h1>
          <small>{t.searchCapsuleHint}</small>
        </div>
        <section style={styles.mainGroupCapsule}>
          <strong>{t.mainGroup}</strong>
          <div style={styles.mainGroupGrid}>
            {mainGroupOptions.map((option) => (
              <button
                key={option.id}
                style={visualFilters.propertyType === option.id ? styles.mainGroupActive : styles.mainGroupButton}
                onClick={() => chooseMainGroup(option.id)}
              >
                {isAr ? option.ar : option.en}
              </button>
            ))}
          </div>
        </section>
        <div className="rentals-search-hero" style={styles.searchHero}>
          <button style={styles.searchButton} onClick={applySearchCapsule}>{t.search}</button>
          <button style={activeSearchPanel === 'governorate' ? styles.searchPillActive : styles.searchPill} onClick={() => setActiveSearchPanel(activeSearchPanel === 'governorate' ? null : 'governorate')}>{selectedGovernorateLabel || t.governorate}</button>
          <button style={activeSearchPanel === 'city' ? styles.searchPillActive : styles.searchPill} onClick={() => setActiveSearchPanel(activeSearchPanel === 'city' ? null : 'city')}>{selectedCityLabel || t.city}</button>
          <button style={activeSearchPanel === 'street' ? styles.searchPillActive : styles.searchPill} onClick={() => setActiveSearchPanel(activeSearchPanel === 'street' ? null : 'street')}>{selectedStreetLabel || t.street}</button>
          <button style={styles.searchPillActive} onClick={() => setShowFilters((current) => !current)}>
            {showFilters ? t.hideFilters : t.showFilters}
          </button>
        </div>
        {activeSearchPanel ? (
          <section style={styles.searchTouchPanel}>
            <div style={styles.rouletteHeader}>
              <strong>
                {activeSearchPanel === 'governorate'
                  ? t.chooseGovernorate
                  : activeSearchPanel === 'city'
                    ? t.chooseCity
                    : t.chooseStreet}
              </strong>
              <span>{t.rouletteHint}</span>
            </div>
            <div style={styles.rouletteTrack}>
              {currentPanelOptions.map((option) => {
                const selected = option.key === (
                  activeSearchPanel === 'governorate'
                    ? selectedGovernorate
                    : activeSearchPanel === 'city'
                      ? selectedCity
                      : selectedStreet
                )
                return (
                  <button
                    key={option.key}
                    style={selected ? styles.rouletteOptionActive : styles.rouletteOption}
                    onClick={() => {
                      if (activeSearchPanel === 'governorate') chooseGovernorate(option.key)
                      if (activeSearchPanel === 'city') {
                        chooseCity(option.key)
                      }
                      if (activeSearchPanel === 'street') {
                        setSelectedStreet(option.key)
                        setActiveSearchPanel(null)
                      }
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div style={styles.rouletteCounter}>
              {currentPanelOptions.findIndex((option) => option.key === (
                activeSearchPanel === 'governorate'
                  ? selectedGovernorate
                  : activeSearchPanel === 'city'
                    ? selectedCity
                    : selectedStreet
              )) + 1} / {currentPanelOptions.length}
            </div>
          </section>
        ) : null}
      </section>

      {status === 'loading' ? <section style={styles.panel}>{t.loading}</section> : null}
      {message ? <section role={status === 'error' ? 'alert' : 'status'} aria-live="polite" style={message === t.required || status === 'error' ? styles.alert : styles.notice}>{message}</section> : null}

      {!hasSearched ? <section style={styles.beforeSearchPanel}>{t.beforeSearch}</section> : null}

      {hasSearched ? <section style={styles.searchSummary}>
        <strong>{selectedGovernorateLabel} · {selectedCityLabel} · {selectedStreetLabel}</strong>
        <span>{mainGroupOptions.find((option) => option.id === visualFilters.propertyType)?.[isAr ? 'ar' : 'en']}</span>
      </section> : null}

      {hasSearched ? <section className="rentals-layout" style={styles.layout}>
        <section style={styles.resultsPanel}>
          <div style={styles.panelHead}>
            <div style={styles.sortRow}>
              <button
                style={sortMode === 'newest' ? styles.sortButtonActive : styles.sortButton}
                onClick={() => setSortMode('newest')}
              >
                {t.newest}
              </button>
              <button
                style={sortMode === 'lowest' ? styles.sortButtonActive : styles.sortButton}
                onClick={() => setSortMode('lowest')}
              >
                {t.lowestPrice}
              </button>
            </div>
            <strong role="status" aria-live="polite">{t.availableResults} ({visibleListings.length})</strong>
          </div>
          <div style={styles.resultGrid}>
            {visibleListings.length ? visibleListings.map((listing) => (
              <article key={listing.id} style={selectedListing?.id === listing.id ? styles.resultCardActive : styles.resultCard}>
                <img src={listingImage(listing, isBuyMode)} alt={listingTitleText(listing, lang)} style={styles.resultImage} />
                <div style={styles.resultBody}>
                  {listing.status !== 'APPROVED' && (
                    <span style={styles.statusPill}>{statusText(listing.status, lang)}</span>
                  )}
                  <h2 style={styles.cardTitle}>{listingTitleText(listing, lang)}</h2>
                  <p style={styles.cardBody}>{listingDescriptionText(listing, lang)}</p>
                  <div style={styles.metaRow}>
                    <span>{t.price}</span>
                    <strong>{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
                  </div>
                  <button
                    style={styles.primaryButton}
                    onClick={() => {
                      // Open the rich shared listing detail (map/specs/reviews/inquiry) instead of the
                      // lightweight inline panel — parity with Stays/Cars/Marketplace/New-Construction.
                      if (typeof window !== 'undefined') {
                        window.sessionStorage.setItem('sybnb-v6-listing-return-path', isBuyMode ? '/buy' : '/rentals')
                      }
                      window.location.hash = `/listing/${listing.id}`
                    }}
                  >
                    {t.viewDetails}
                  </button>
                </div>
              </article>
            )) : status !== 'loading' ? <p style={styles.empty} role="status">{t.empty}</p> : null}
          </div>
          {nextCursor && (
            <div style={styles.loadMoreRow}>
              <button style={styles.secondaryButton} onClick={() => void loadMoreListings()} disabled={loadingMore}>
                {loadingMore ? t.loadingMore : t.loadMore}
              </button>
            </div>
          )}
        </section>

        <aside style={styles.tunnelPanel}>
          {showFilters ? (
            <section style={styles.inlineChoices}>
              <div style={styles.panelHead}>
                <strong>{t.filterTitle}</strong>
                <button style={styles.closeFilterButton} onClick={() => setShowFilters(false)}>{t.hideFilters}</button>
              </div>
              <VisualFilterPanel
                compact
                groups={renterPropertyFilterGroups}
                lang={lang}
                selection={visualFilters}
                onChange={setVisualFilters}
              />
              <div style={styles.filterSummary}>
                {activeFilterLabels.length
                  ? activeFilterLabels.map((label) => <span key={label}>{label}</span>)
                  : <span>{t.noFilters}</span>}
              </div>
            </section>
          ) : null}
          <div style={styles.panelHead}>
            <strong>{t.selectedFilters}</strong>
            <button style={styles.closeFilterButton} onClick={() => setShowFilters(true)}>{t.showFilters}</button>
            <span>{activeFilterLabels.length}</span>
          </div>
          {selectedListing ? (
            <>
              <section style={styles.selectedCard}>
                <img src={listingImage(selectedListing, isBuyMode)} alt={listingTitleText(selectedListing, lang)} style={styles.selectedImage} />
                <div style={styles.selectedContent}>
                  <h2 style={styles.selectedTitle}>{listingTitleText(selectedListing, lang)}</h2>
                  <p style={styles.cardBody}>{listingDescriptionText(selectedListing, lang)}</p>
                  <Info label={t.price} value={moneyText(selectedListing.priceMinor, selectedListing.currency, lang)} />
                  <Info label={t.owner} value={selectedListing.owner?.displayName || selectedListing.ownerId.slice(0, 8).toUpperCase()} />
                  {selectedListing.status !== 'APPROVED' && (
                    <Info label={t.status} value={statusText(selectedListing.status, lang)} />
                  )}
                </div>
              </section>

              <section style={styles.detailPanel}>
                <strong>{t.detailTitle}</strong>
                <ol style={styles.detailSteps}>
                  {t.detailSteps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </section>

              {/* A real bug caught by an independent re-audit: this used to be a <PaymentCapsule>
                  reused verbatim from the real-money STAYS wallet-payment flow -- a hardcoded
                  literal as the "payment code," the renter/buyer's ID documents relabeled
                  "payment proofs," and a status machine implying progress toward "Payment
                  confirmed" for a division that structurally has no in-app payment mechanism at
                  all (RENTALS/BUY are commission/contact-based, see server/routes/listings.mjs).
                  Replaced with an honest status list reflecting only what's actually true.
                  CAPSULE_RULES.noFakeTrustSignal. */}
              <section style={styles.detailPanel}>
                <strong>{t.requestStatusTitle}</strong>
                <ol style={styles.detailSteps}>
                  <li>{hasGuestAccount ? '✓ ' : '○ '}{t.stepAccountOpened}</li>
                  <li>{documents.length ? '✓ ' : '○ '}{t.stepDocumentsUploaded}{documents.length ? ` (${documents.length})` : ''}</li>
                  <li>{sentRequest ? '✓ ' : '○ '}{t.stepSentToImmoContact}</li>
                </ol>
                {sentRequest ? <small>{t.referenceLabel}: {sentRequest.id}</small> : null}
              </section>
            </>
          ) : <p style={styles.empty}>{t.noSelection}</p>}

          {!hasGuestAccount ? (
            <section style={styles.accountPrompt}>
              <strong>{t.accountGateTitle}</strong>
              <p>{t.accountGateText}</p>
              <button style={styles.primaryButton} onClick={openAccount}>{t.openAccount}</button>
            </section>
          ) : (
            <>
              <button style={styles.readyButton} onClick={openAccount}>{t.accountReady}</button>
              <section style={styles.docsPanel}>
                <strong>{t.docsTitle}</strong>
                <p>{t.docsHint}</p>
                <label style={styles.uploadBox}>
                  {uploadingCount ? t.uploading : t.docsUpload}
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    multiple
                    disabled={uploadingCount > 0}
                    style={styles.fileInput}
                    onChange={(event) => void uploadDocuments(event.target.files)}
                  />
                </label>
                {uploadError ? <p style={styles.empty} role="alert">{t.uploadFailed}: {uploadError}</p> : null}
                {documents.length ? (
                  <div style={styles.docList}>
                    <span>{documents.length} {t.docsReady}</span>
                    {documents.slice(0, 6).map((doc) => <small key={doc.url}>{doc.name}</small>)}
                  </div>
                ) : null}
              </section>

              <label style={styles.agreementBox}>
                <input type="checkbox" checked={acceptedAgreement} onChange={(event) => setAcceptedAgreement(event.target.checked)} />
                <span>
                  <strong>{t.agreementTitle}</strong>
                  {t.agreementCopy}
                </span>
              </label>

              <button style={styles.primaryButton} disabled={sendState === 'saving'} onClick={() => void sendRequest()}>
                {sendState === 'saving' ? t.sending : t.send}
              </button>
            </>
          )}
          <button style={styles.secondaryButton} onClick={openContactCenter}>
            {t.openInbox}
          </button>
        </aside>
      </section> : null}
    </main>
  )
}

function listingImage(listing: PlatformListing, isBuyMode = false) {
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  return typeof mediaUrl === 'string' ? mediaUrl : isBuyMode ? '/assets/divisions/buy-property.webp' : '/assets/divisions/monthly-rental.webp'
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.infoRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: colors.bg, color: colors.text, padding: '0 clamp(14px, 3vw, 36px) 90px', display: 'grid', gap: 28, maxWidth: 1240, margin: '0 auto' },
  searchCapsule: { border: `1px solid ${colors.line}`, borderRadius: 30, background: `linear-gradient(135deg, ${withAlpha(colors.blue, 0.16)}, ${withAlpha(colors.bg2, 0.96)})`, padding: 16, display: 'grid', gap: 14, boxShadow: '0 18px 55px rgba(0,0,0,.22)', position: 'relative', zIndex: 3 },
  searchCapsuleText: { display: 'grid', gap: 5, justifyItems: 'start', color: colors.text },
  mainGroupCapsule: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 22, background: withAlpha(colors.bg, 0.64), padding: 12, display: 'grid', gap: 10 },
  mainGroupGrid: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))' },
  mainGroupButton: { minHeight: 50, border: `1px solid ${colors.line}`, borderRadius: 16, background: colors.panel2, color: colors.text, fontWeight: 900 },
  mainGroupActive: { minHeight: 50, border: `1px solid ${colors.blue}`, borderRadius: 16, background: colors.blue, color: colors.text, fontWeight: 950, boxShadow: `0 12px 26px ${withAlpha(colors.blue, 0.22)}` },
  searchHero: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 999, background: colors.bg2, padding: 8, display: 'grid', gap: 8, gridTemplateColumns: '120px repeat(5, minmax(108px, 1fr))', alignItems: 'center' },
  searchButton: { minHeight: 58, border: 0, borderRadius: 18, background: colors.blue, color: colors.text, fontSize: 18, fontWeight: 950, boxShadow: `0 12px 26px ${withAlpha(colors.blue, 0.24)}` },
  searchPill: { minHeight: 50, border: 0, borderRadius: 999, background: colors.panel2, color: colors.muted, fontWeight: 850 },
  searchPillActive: { minHeight: 50, border: 0, borderRadius: 999, background: colors.blue, color: colors.text, fontWeight: 950 },
  searchTouchPanel: { border: `1px solid ${withAlpha(colors.blue, 0.42)}`, borderRadius: 22, background: colors.bg2, padding: 14, display: 'grid', gap: 12, overflow: 'hidden' },
  rouletteHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: colors.text, flexWrap: 'wrap' },
  rouletteTrack: { display: 'flex', gap: 10, overflowX: 'auto', overscrollBehaviorX: 'contain', scrollSnapType: 'x mandatory', padding: '4px 2px 12px', scrollbarWidth: 'thin' },
  rouletteOption: { minWidth: 132, minHeight: 54, border: `1px solid ${colors.line}`, borderRadius: 18, background: colors.panel2, color: colors.text, fontWeight: 900, scrollSnapAlign: 'center', boxShadow: 'inset 0 -10px 22px rgba(0,0,0,.18)' },
  rouletteOptionActive: { minWidth: 146, minHeight: 58, border: `1px solid ${colors.blue}`, borderRadius: 20, background: `linear-gradient(135deg, ${colors.blue}, ${colors.violet})`, color: colors.text, fontWeight: 950, scrollSnapAlign: 'center', boxShadow: `0 16px 34px ${withAlpha(colors.blue, 0.28)}` },
  rouletteCounter: { justifySelf: 'center', border: `1px solid ${withAlpha(colors.gold, 0.42)}`, borderRadius: 999, background: withAlpha(colors.gold, 0.1), color: colors.gold, padding: '5px 14px', fontWeight: 950, fontVariantNumeric: 'tabular-nums' },
  touchOptions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' },
  touchOption: { minHeight: 46, border: `1px solid ${colors.line}`, borderRadius: 14, background: colors.panel2, color: colors.text, fontWeight: 850 },
  touchOptionActive: { minHeight: 46, border: `1px solid ${colors.blue}`, borderRadius: 14, background: withAlpha(colors.blue, 0.92), color: colors.text, fontWeight: 950 },
  beforeSearchPanel: { border: `1px solid ${withAlpha(colors.blue, 0.3)}`, borderRadius: 24, background: withAlpha(colors.blue, 0.08), color: colors.text, padding: 22, lineHeight: 1.7, fontWeight: 850 },
  searchSummary: { border: `1px solid ${withAlpha(colors.green, 0.36)}`, borderRadius: 18, background: withAlpha(colors.green, 0.08), color: colors.green, padding: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  flowNav: { display: 'none' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: `1px solid ${colors.line}`, background: colors.bg2, color: colors.text, fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  hero: { border: `1px solid ${withAlpha(colors.cyan, 0.38)}`, borderRadius: 8, background: `linear-gradient(135deg, ${withAlpha(colors.cyan, 0.12)}, ${withAlpha(colors.panel2, 0.94)})`, padding: 18, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  eyebrow: { color: colors.cyan, letterSpacing: 2, fontWeight: 950, fontSize: 11, margin: 0 },
  title: { margin: '6px 0 0', fontSize: 42, lineHeight: 1.05 },
  body: { color: colors.muted, margin: '10px 0 0', lineHeight: 1.65 },
  stepRail: { display: 'grid', gap: 8, alignContent: 'center' },
  stepPill: { border: `1px solid ${colors.line}`, borderRadius: 8, background: withAlpha(colors.bg2, 0.78), color: colors.text, padding: '10px 12px', fontWeight: 850 },
  layout: { display: 'grid', gap: 36, gridTemplateColumns: 'minmax(0, 1fr) 390px', alignItems: 'start' },
  resultsPanel: { background: 'transparent', padding: 0, display: 'grid', gap: 28 },
  filterPanel: { border: `1px solid ${withAlpha(colors.blue, 0.42)}`, borderRadius: 8, background: withAlpha(colors.bg2, 0.72), padding: 12, display: 'grid', gap: 12 },
  inlineChoices: { border: `1px solid ${withAlpha(colors.blue, 0.25)}`, borderRadius: 20, background: withAlpha(colors.blue, 0.06), padding: 12, display: 'grid', gap: 12 },
  filterSummary: { display: 'flex', gap: 8, flexWrap: 'wrap', color: colors.text },
  tunnelPanel: { border: `1px solid ${colors.line}`, borderRadius: 28, background: colors.bg2, padding: 28, display: 'grid', gap: 18, position: 'sticky', top: 110, boxShadow: '0 24px 70px rgba(0,0,0,.32)' },
  panelHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: colors.muted },
  closeFilterButton: { minHeight: 34, border: `1px solid ${colors.line}`, borderRadius: 999, background: colors.panel2, color: colors.text, fontWeight: 900, padding: '0 12px' },
  sortRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  sortButton: { minHeight: 40, border: 0, borderRadius: 999, background: colors.panel2, color: colors.muted, fontWeight: 850, padding: '0 18px' },
  sortButtonActive: { minHeight: 40, border: 0, borderRadius: 999, background: colors.blue, color: colors.text, fontWeight: 950, padding: '0 20px' },
  resultGrid: { display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' },
  loadMoreRow: { display: 'grid', justifyContent: 'center', marginTop: 22 },
  resultCard: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 24, background: colors.panel, overflow: 'hidden', display: 'grid', boxShadow: '0 20px 45px rgba(0,0,0,.24)', minHeight: 380 },
  resultCardActive: { border: `1px solid ${colors.blue}`, borderRadius: 24, background: withAlpha(colors.blue, 0.1), overflow: 'hidden', display: 'grid', boxShadow: `0 0 0 1px ${withAlpha(colors.blue, 0.24)}, 0 20px 45px rgba(0,0,0,.24)`, minHeight: 380 },
  resultImage: { width: '100%', aspectRatio: '1 / 1.25', objectFit: 'cover', background: colors.bg2 },
  resultBody: { padding: 18, display: 'grid', gap: 10, alignContent: 'start' },
  statusPill: { justifySelf: 'start', border: `1px solid ${withAlpha(colors.cyan, 0.45)}`, borderRadius: 999, color: colors.cyan, padding: '5px 9px', fontSize: 11, fontWeight: 950 },
  cardTitle: { margin: 0, fontSize: 22, lineHeight: 1.15 },
  cardBody: { margin: 0, color: colors.muted, lineHeight: 1.55 },
  metaRow: { borderTop: `1px solid ${colors.line}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, color: colors.muted },
  selectedCard: { border: `1px solid ${withAlpha(colors.green, 0.42)}`, borderRadius: 18, background: withAlpha(colors.green, 0.08), padding: 14, display: 'grid', gap: 14 },
  selectedImage: { width: '100%', aspectRatio: '16 / 10', borderRadius: 14, objectFit: 'cover', background: colors.bg2 },
  selectedContent: { display: 'grid', gap: 10 },
  selectedTitle: { margin: 0, fontSize: 24 },
  infoRow: { display: 'flex', justifyContent: 'space-between', gap: 12, color: colors.muted, borderTop: `1px solid ${colors.line}`, paddingTop: 10 },
  detailPanel: { border: `1px solid ${withAlpha(colors.blue, 0.42)}`, borderRadius: 22, background: `linear-gradient(145deg, ${withAlpha(colors.blue, 0.12)}, ${withAlpha(colors.bg2, 0.82)})`, padding: 16, display: 'grid', gap: 14 },
  trustGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  detailSteps: { display: 'grid', gap: 10, margin: 0, paddingInlineStart: 22, color: colors.muted, lineHeight: 1.5 },
  accountPrompt: { border: `1px solid ${withAlpha(colors.blue, 0.42)}`, borderRadius: 22, background: withAlpha(colors.blue, 0.08), color: colors.text, padding: 16, display: 'grid', gap: 12, lineHeight: 1.6 },
  docsPanel: { border: `1px solid ${colors.line}`, borderRadius: 22, background: colors.bg2, padding: 16, display: 'grid', gap: 10, color: colors.muted },
  uploadBox: { minHeight: 74, border: `1px dashed ${withAlpha(colors.cyan, 0.58)}`, borderRadius: 18, color: colors.cyan, display: 'grid', placeItems: 'center', fontWeight: 950, cursor: 'pointer', background: withAlpha(colors.cyan, 0.05) },
  fileInput: { display: 'none' },
  docList: { border: `1px solid ${withAlpha(colors.green, 0.35)}`, borderRadius: 8, background: withAlpha(colors.green, 0.08), color: colors.green, padding: 10, display: 'grid', gap: 6 },
  agreementBox: { border: `1px solid ${withAlpha(colors.gold, 0.5)}`, borderRadius: 18, background: withAlpha(colors.gold, 0.08), color: colors.gold, padding: 14, display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 10, alignItems: 'start', lineHeight: 1.55 },
  primaryButton: { minHeight: 58, border: 0, borderRadius: 16, background: colors.blue, color: colors.text, fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 58, border: `1px solid ${colors.line}`, borderRadius: 16, background: colors.panel2, color: colors.text, fontWeight: 900, padding: '0 14px' },
  readyButton: { minHeight: 58, border: `1px solid ${withAlpha(colors.green, 0.5)}`, borderRadius: 16, background: withAlpha(colors.green, 0.12), color: colors.green, fontWeight: 950, padding: '0 14px' },
  panel: { border: `1px solid ${colors.line}`, borderRadius: 8, background: colors.bg2, color: colors.muted, padding: 14 },
  alert: { border: `1px solid ${withAlpha(colors.red, 0.45)}`, borderRadius: 8, background: withAlpha(colors.red, 0.1), color: colors.red, padding: 14 },
  notice: { border: `1px solid ${withAlpha(colors.green, 0.42)}`, borderRadius: 8, background: withAlpha(colors.green, 0.08), color: colors.green, padding: 14 },
  empty: { color: colors.muted },
}
