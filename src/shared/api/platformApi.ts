const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'

type ApiUser = {
  id: string
  email: string | null
  displayName: string
  roles: string[]
  referralCode?: string
}

type AuthResponse = {
  ok: true
  user: ApiUser
  token: string
}

export type PlatformAuthSession = AuthResponse

export type PlatformListing = {
  id: string
  ownerId: string
  division: string
  titleAr: string
  titleEn: string | null
  description: string | null
  status: string
  priceMinor: number
  currency: string
  instantBookEnabled?: boolean
  expiresAt?: string | null
  metadata: Record<string, unknown>
  owner?: {
    id: string
    displayName: string
    idDocumentStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null
  }
  media?: Array<Record<string, unknown>>
  location?: Record<string, unknown> | null
  accommodation?: { id: string; titleAr: string; titleEn: string | null } | null
  hasActiveOffer?: boolean
  offerNightsCount?: number
  cheapestOfferMinor?: number | null
}

export type PlatformPaymentProof = {
  id: string
  bookingId: string | null
  userId: string
  provider: string
  status: string
  amountMinor: number
  currency: string
  proofAssetUrl: string | null
  providerRef: string | null
  adminNote: string | null
  reviewedById: string | null
  reviewedAt: string | null
  user?: {
    id: string
    displayName: string
    email: string | null
  }
  payer?: {
    id: string
    displayName: string
    email: string | null
  }
  booking?: PlatformBooking & {
    guest?: {
      id: string
      displayName: string
      email: string | null
    }
    listing?: PlatformListing
  }
}

export type PlatformRideRequest = {
  id: string
  riderId: string
  driverId: string | null
  pickupLocationId: string | null
  dropoffLocationId: string | null
  status: string
  requestedAt: string
  fareMinor: number | null
  currency: string
  metadata: Record<string, unknown>
  updatedAt: string
  rider?: {
    id: string
    displayName: string
    email: string | null
  }
}

export type PlatformBooking = {
  id: string
  listingId: string
  guestId: string
  status: string
  checkIn: string | null
  checkOut: string | null
  amountMinor: number
  currency: string
  metadata: Record<string, unknown>
  guestCheckedInAt?: string | null
  guestCheckedOutAt?: string | null
  createdAt: string
  updatedAt: string
  guest?: {
    id: string
    displayName: string
    email: string | null
    idDocumentRef?: string | null
    idDocumentSubmittedAt?: string | null
  }
}

const PROTOTYPE_OWNER = {
  id: 'prototype-owner-sybnb',
  displayName: 'SYBNB Verified Provider',
}

const FALLBACK_APPROVED_LISTINGS: PlatformListing[] = [
  {
    id: 'fallback-stay-malki-apartment',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'STAYS',
    titleAr: 'إقامة مفروشة وسط دمشق',
    titleEn: 'Furnished stay in central Damascus',
    description: 'Ready-to-live apartment with quick service access.',
    status: 'APPROVED',
    priceMinor: 220000,
    currency: 'SYP',
    metadata: { roomType: 'entireApartment', beds: 2, bathrooms: 1, trustScore: 94 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/divisions/daily-rental.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Al-Malki', lat: 33.514, lng: 36.292 },
  },
  {
    id: 'fallback-stay-heritage-courtyard',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'STAYS',
    titleAr: 'بيت دمشقي تراثي',
    titleEn: 'Damascene heritage courtyard stay',
    description: 'Heritage home with calm courtyard and verified host.',
    status: 'APPROVED',
    priceMinor: 275000,
    currency: 'SYP',
    metadata: { roomType: 'heritageHome', beds: 3, bathrooms: 2, trustScore: 96 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/heritage-home.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Old City', lat: 33.511, lng: 36.306 },
  },
  {
    id: 'fallback-rental-villa-malki',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'RENTALS',
    titleAr: 'فيلا النخيل الملكية',
    titleEn: 'Royal Palm Villa',
    description: 'Monthly rental villa with protected contact flow and verified owner.',
    status: 'APPROVED',
    priceMinor: 900000,
    currency: 'SYP',
    metadata: { propertyType: 'villa', bedrooms: 4, bathrooms: 3, bedType: 'king', trustScore: 98 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/villa.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Yafour', lat: 33.489, lng: 36.221 },
  },
  {
    id: 'fallback-rental-modern-apartment',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'RENTALS',
    titleAr: 'شقة عصرية بلس',
    titleEn: 'Modern Plus Apartment',
    description: 'Monthly apartment near services with elevator and parking.',
    status: 'APPROVED',
    priceMinor: 550000,
    currency: 'SYP',
    metadata: { propertyType: 'apartment', bedrooms: 3, bathrooms: 2, bedType: 'queen', trustScore: 95 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/divisions/monthly-rental.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Mezzeh', lat: 33.502, lng: 36.258 },
  },
  {
    id: 'fallback-buy-villa-yafour',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'BUY',
    titleAr: 'فيلا للبيع في يعفور',
    titleEn: 'Villa for sale in Yafour',
    description: 'Verified owner sale with documents ready for platform review.',
    status: 'APPROVED',
    priceMinor: 1250000000,
    currency: 'SYP',
    metadata: { propertyType: 'villa', bedrooms: 5, bathrooms: 4, trustScore: 97 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/divisions/buy-property.webp' }],
    location: { country: 'SY', governorate: 'Rif Dimashq', city: 'Yafour', area: 'Main road', lat: 33.493, lng: 36.189 },
  },
  {
    id: 'fallback-buy-office-kafr-souseh',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'BUY',
    titleAr: 'مكتب تجاري فاخر',
    titleEn: 'Premium commercial office',
    description: 'Commercial property with clean documentation and visit request flow.',
    status: 'APPROVED',
    priceMinor: 840000000,
    currency: 'SYP',
    metadata: { propertyType: 'office', rooms: 6, bathrooms: 2, trustScore: 92 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/office.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Kafr Souseh', lat: 33.486, lng: 36.282 },
  },
  {
    id: 'fallback-car-sedan-damascus',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'CARS',
    titleAr: 'سيارة سيدان موثوقة',
    titleEn: 'Verified sedan listing',
    description: 'Clean car listing with seller contact and protected request flow.',
    status: 'APPROVED',
    priceMinor: 180000000,
    currency: 'SYP',
    metadata: { carShape: 'sedan', transmission: 'automatic', fuel: 'gas', trustScore: 93 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/cars/sedan.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Abu Rummaneh', lat: 33.516, lng: 36.284 },
  },
  {
    id: 'fallback-car-suv-showroom',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'CARS',
    titleAr: 'SUV عائلية من معرض موثق',
    titleEn: 'Verified family SUV',
    description: 'SUV listing from a verified dealer with inspection notes.',
    status: 'APPROVED',
    priceMinor: 260000000,
    currency: 'SYP',
    metadata: { carShape: 'suv', transmission: 'automatic', fuel: 'hybrid', trustScore: 95 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/cars/suv.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Mazzeh', lat: 33.501, lng: 36.258 },
  },
  {
    id: 'fallback-market-furniture',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'MARKETPLACE',
    titleAr: 'مجموعة أثاث منزلية',
    titleEn: 'Home furniture set',
    description: 'Marketplace item with seller verification and protected request.',
    status: 'APPROVED',
    priceMinor: 4500000,
    currency: 'SYP',
    metadata: { category: 'furniture', condition: 'used', trustScore: 90 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/market/furniture.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Old City', lat: 33.511, lng: 36.306 },
  },
  {
    id: 'fallback-market-appliance',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'MARKETPLACE',
    titleAr: 'أجهزة منزلية بحالة ممتازة',
    titleEn: 'Excellent home appliances',
    description: 'Verified marketplace offer ready for buyer request.',
    status: 'APPROVED',
    priceMinor: 3200000,
    currency: 'SYP',
    metadata: { category: 'appliances', condition: 'new', trustScore: 91 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/market/appliances.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Kafr Souseh', lat: 33.486, lng: 36.282 },
  },
  {
    id: 'fallback-project-residence',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'NEW_CONSTRUCTION',
    titleAr: 'مشروع سكني جديد',
    titleEn: 'New residential project',
    description: 'Builder project with visit booking and document review flow.',
    status: 'APPROVED',
    priceMinor: 650000000,
    currency: 'SYP',
    metadata: { projectType: 'residential', units: 28, trustScore: 96 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/new-project.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Mezzeh', lat: 33.502, lng: 36.258 },
  },
  {
    id: 'fallback-project-tower',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'NEW_CONSTRUCTION',
    titleAr: 'برج مكاتب قيد الإنجاز',
    titleEn: 'Office tower under construction',
    description: 'New construction opportunity with builder dashboard workflow.',
    status: 'APPROVED',
    priceMinor: 980000000,
    currency: 'SYP',
    metadata: { projectType: 'commercial', units: 16, trustScore: 94 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/office.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Kafr Souseh', lat: 33.486, lng: 36.282 },
  },
]

function fallbackApprovedListings(division = 'STAYS') {
  return FALLBACK_APPROVED_LISTINGS
    .filter((listing) => listing.division === division)
    .map(markSampleListing)
}

function markSampleListing(listing: PlatformListing): PlatformListing {
  return {
    ...listing,
    metadata: {
      ...listing.metadata,
      sybnbDataMode: 'sample',
    },
  }
}

export function isSampleListing(listing: PlatformListing) {
  return listing.metadata?.sybnbDataMode === 'sample'
}

export type PlatformReviewBooking = PlatformBooking & {
  listing?: PlatformListing
}

export type PlatformIdDocumentReview = {
  id: string
  displayName: string
  email: string | null
  idDocumentMimeType: string | null
  idDocumentSubmittedAt: string | null
  idDocumentStatus?: string | null
}

export type PlatformReviewQueue = {
  listings: PlatformListing[]
  payments: PlatformPaymentProof[]
  gifts: PlatformWalletGift[]
  bookings: PlatformReviewBooking[]
  idDocuments: PlatformIdDocumentReview[]
}

export type PlatformAdminAuditLog = {
  id: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ipHash: string | null
  createdAt: string
  actor?: {
    id: string
    displayName: string
    email: string | null
  } | null
}

export type PlatformAdminMetrics = {
  usersByRole: Record<string, number>
  listingsByDivision: Record<string, number>
  listingsByStatus: Record<string, number>
  bookingsByStatus: Record<string, number>
  ridesByStatus: Record<string, number>
  paymentsByStatus: Record<string, number>
  giftsByStatus: Record<string, number>
  walletCount: number
  walletBalanceMinor: number
  approvedPaymentCount: number
  approvedPaymentVolumeMinor: number
}

export type PlatformHealth = {
  ok: boolean
  service: string
  database: {
    ok: boolean
    code: string
    message?: string
  }
}

export type PlatformContracts = {
  ok: true
  endpoints: Array<Record<string, unknown>>
  securityRules: string[]
}

export type PlatformSellerProfile = {
  id: string
  userId: string
  legalName: string
  sellerType: string
  documentStatus: string
  planCode: string | null
}

export type PlatformOverview = {
  user: ApiUser & {
    idDocumentRef?: string | null
    idDocumentSubmittedAt?: string | null
    idDocumentStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null
  }
  bookings: Array<PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[] }>
  listings: PlatformListing[]
  payments: PlatformPaymentProof[]
  rides: PlatformRideRequest[]
  wallet: null | {
    id: string
    currency: string
    cachedBalanceMinor: number
    entries: Array<Record<string, unknown>>
  }
  sellerProfile: PlatformSellerProfile | null
  gifts: {
    sent: Array<Record<string, unknown>>
    claimed: Array<Record<string, unknown>>
  }
  referrals: {
    made: Array<{
      id: string
      status: 'PENDING' | 'REWARDED'
      createdAt: string
      rewardedAt: string | null
      referee: { id: string; displayName: string }
    }>
    rewardedCount: number
    pendingCount: number
  }
}

export type PlatformHostOverview = {
  host: ApiUser & { idDocumentStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null }
  totals: {
    listings: number
    approvedListings: number
    pendingListings: number
    requests: number
    requested: number
    confirmed: number
    revenueMinor: number
  }
  listings: Array<PlatformListing & { bookings?: PlatformBooking[] }>
  requests: Array<
    PlatformBooking & {
      listing?: Pick<PlatformListing, 'id' | 'division' | 'titleAr' | 'titleEn' | 'priceMinor' | 'currency' | 'status'>
      payments?: PlatformPaymentProof[]
    }
  >
  insightSignal?: { listingsNeedingAttention: number }
}

export type PlatformDriverOverview = {
  driver: ApiUser & { idDocumentStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null }
  totals: {
    assigned: number
    active: number
    completed: number
    earningsMinor: number
    todayCompletedCount: number
    todayEarningsMinor: number
  }
  rides: PlatformRideRequest[]
}

export type PlatformWalletGift = {
  id: string
  senderUserId: string
  recipientUserId: string | null
  amountMinor: number
  currency: string
  message: string | null
  status: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  sender?: {
    id: string
    displayName: string
  }
}

export type PlatformWallet = {
  id: string
  userId: string
  currency: string
  cachedBalanceMinor: number
  entries?: Array<Record<string, unknown>>
}

type ApiErrorBody = {
  ok: false
  error?: {
    code?: string
    message?: string
  }
}

type CreateListingInput = {
  division?: string
  titleAr: string
  titleEn?: string
  description?: string
  priceMinor: number
  currency: string
  instantBookEnabled?: boolean
  metadata: Record<string, unknown>
}

export const LAST_SUBMITTED_LISTING_KEY = 'sybnb.v6.lastSubmittedListing'
export const SELLER_SESSION_KEY = 'sybnb.v6.sellerSession'
export const GUEST_SESSION_KEY = 'sybnb.v6.guestSession'
export const GUEST_SESSION_TOKEN_KEY = 'sybnb-v6-guest-token'
export const STAFF_SESSION_KEY = 'sybnb.v6.staffSession'
export const STAFF_SESSION_TOKEN_KEY = 'sybnb-v6-staff-token'
export type HostDashboardMode = 'host' | 'seller'

export async function fetchPrototypeHealth() {
  return apiRequest<PlatformHealth>('/api/health')
}

export async function fetchPrototypeContracts() {
  return apiRequest<PlatformContracts>('/api/contracts')
}

export async function createAndSubmitPrototypeListing(input: CreateListingInput) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const created = await apiRequest<{ ok: true; listing: PlatformListing }>('/api/listings', {
    method: 'POST',
    token: session.token,
    body: {
      division: 'STAYS',
      ...input,
    },
  })

  const submitted = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/listings/${created.listing.id}/submit`,
    {
      method: 'PATCH',
      token: session.token,
    },
  )

  sessionStorage.setItem(LAST_SUBMITTED_LISTING_KEY, JSON.stringify(submitted.listing))
  return submitted.listing
}

export type PlatformAccommodation = {
  id: string
  ownerId: string
  titleAr: string
  titleEn: string | null
  description: string | null
  governorate: string
  city: string
  area: string | null
  address: string | null
  status: string
  metadata: Record<string, unknown>
  listings?: PlatformListing[]
  offerSummary?: { listingsWithOfferCount: number; totalListingsCount: number }
}

type CreateAccommodationInput = {
  titleAr: string
  titleEn?: string
  description?: string
  governorate: string
  city: string
  area?: string
  address?: string
  metadata?: Record<string, unknown>
}

type AddAccommodationRoomTypeInput = {
  titleAr: string
  titleEn?: string
  description?: string
  priceMinor: number
  currency?: string
  instantBookEnabled?: boolean
  metadata: Record<string, unknown>
}

export async function createAccommodation(input: CreateAccommodationInput) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const response = await apiRequest<{ ok: true; accommodation: PlatformAccommodation }>('/api/accommodations', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.accommodation
}

export async function addAccommodationRoomType(accommodationId: string, input: AddAccommodationRoomTypeInput) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/accommodations/${accommodationId}/room-types`,
    {
      method: 'POST',
      token: session.token,
      body: input,
    },
  )
  return response.listing
}

export async function submitAccommodation(accommodationId: string) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const response = await apiRequest<{ ok: true; accommodation: PlatformAccommodation }>(
    `/api/accommodations/${accommodationId}/submit`,
    {
      method: 'PATCH',
      token: session.token,
    },
  )
  return response.accommodation
}

export async function fetchAccommodation(accommodationId: string) {
  return apiRequest<{ ok: true; accommodation: PlatformAccommodation }>(`/api/accommodations/${accommodationId}`)
}

export async function createSellerAccountSession(input: {
  displayName: string
  email: string
  password: string
  phone?: string
  sellerRole: string
  planCode: string
}) {
  const account = {
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    role: 'SELLER',
    phone: input.phone,
  }

  let session: PlatformAuthSession
  try {
    session = await register(account)
  } catch {
    session = await login(input.email, input.password)
  }

  const storedSession = {
    ...session,
    sellerRole: input.sellerRole,
    planCode: input.planCode,
  }
  sessionStorage.setItem(SELLER_SESSION_KEY, JSON.stringify(storedSession))
  return storedSession
}

// Email is now the real account identifier (was previously a synthetic guest-<phone>@sybnb.local
// address) — the guest-signup gate verifies email ownership via a real code before this call ever
// succeeds server-side (see sendEmailVerificationCode / verifyEmailVerificationCode below).
export async function createGuestAccountSession(input: {
  firstName?: string
  lastName?: string
  email: string
  phone: string
  password: string
  referralCode?: string
}) {
  const displayName = [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || 'SYBNB Guest'
  const trimmedReferralCode = input.referralCode?.trim()
  const account = {
    email: input.email,
    password: input.password,
    displayName,
    role: 'GUEST',
    phone: input.phone,
    ...(trimmedReferralCode ? { referralCode: trimmedReferralCode } : {}),
  }

  let session: PlatformAuthSession
  try {
    session = await register(account)
  } catch {
    session = await login(input.email, input.password)
  }

  sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  sessionStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  // App.tsx's needsGuestAccountGate check re-renders on this event. Without it, gated routes
  // whose returnPath equals the current path (e.g. /ride, /ride-preview, /dashboard) never
  // re-render after signup: the caller's `window.location.hash = returnPath` is a same-value
  // no-op, so no hashchange event fires either, leaving the account gate stuck on screen despite
  // a valid session now existing.
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return session
}

// Real email OTP for the guest-signup gate. Chosen over SMS: no per-message carrier cost, no
// SMS-gateway account needed. devCode is only ever populated outside production (SMTP is rarely
// configured in local/dev environments) — never trust it as a UI-visible "success", it's a
// dev-only convenience so testing keeps working without a real mailbox.
export type EmailCodePurpose = 'guest-signup' | 'staff-login' | 'password-reset'

export async function sendEmailVerificationCode(email: string, purpose: EmailCodePurpose = 'guest-signup') {
  return apiRequest<{ ok: true; emailSent: boolean; emailError?: string; devCode?: string }>('/api/auth/email-code/send', {
    method: 'POST',
    body: { email, purpose },
  })
}

export async function verifyEmailVerificationCode(email: string, code: string, purpose: EmailCodePurpose = 'guest-signup') {
  return apiRequest<{ ok: true }>('/api/auth/email-code/verify', {
    method: 'POST',
    body: { email, code, purpose },
  })
}

// Real forgot-password flow. Caller must send + verify an email code with purpose='password-reset'
// (the two functions above) before this will succeed server-side.
export async function resetPasswordWithEmailCode(email: string, newPassword: string) {
  return apiRequest<{ ok: true }>('/api/auth/password-reset', {
    method: 'POST',
    body: { email, newPassword },
  })
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      // data:<mime>;base64,<data> — strip the prefix, the server only needs the encoded bytes.
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

// Previously this only ever sent the file's *name* to the server — the actual image was never
// uploaded, so nothing (human or automated) could ever review what was actually submitted. This
// now reads and sends the real file bytes.
export async function submitGuestIdDocument(file: File) {
  const session = await ensurePrototypeGuestSession()
  const fileBase64 = await readFileAsBase64(file)
  const response = await apiRequest<{
    ok: true
    user: { id: string; idDocumentRef: string; idDocumentSubmittedAt: string; idDocumentStatus: string }
  }>('/api/me/id-document', {
    method: 'PATCH',
    token: session.token,
    body: { fileBase64, mimeType: file.type },
  })
  return response.user
}

export function getStoredGuestSession(): PlatformAuthSession | null {
  try {
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PlatformAuthSession
    if (!session?.token || !session?.user) return null
    return session
  } catch {
    return null
  }
}

// Best-effort real server-side logout (F-02): tells the server to bump this user's sessionVersion
// so the token being discarded here can't be replayed even if someone else has a copy of it. The
// local session is cleared regardless of whether this call succeeds -- a network failure here
// must never block the user from leaving their session, it just means server-side revocation
// happens a little late (or not at all, until the token's own 7-day expiry) for that one call.
function requestServerLogout(token: string | null) {
  if (!token) return
  void apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST', token }).catch(() => {})
}

export function clearGuestSession() {
  requestServerLogout(sessionStorage.getItem(GUEST_SESSION_TOKEN_KEY))
  sessionStorage.removeItem(GUEST_SESSION_KEY)
  sessionStorage.removeItem(GUEST_SESSION_TOKEN_KEY)
  window.dispatchEvent(new Event('sybnb-session-changed'))
}

export function getStoredStaffSession(requiredRole?: 'ADMIN' | 'HOST' | 'SELLER' | 'DRIVER'): PlatformAuthSession | null {
  try {
    const raw = sessionStorage.getItem(STAFF_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PlatformAuthSession
    if (!session?.token || !session?.user) return null
    if (requiredRole && !session.user.roles.includes(requiredRole)) return null
    return session
  } catch {
    return null
  }
}

export async function createStaffAccountSession(
  role: 'ADMIN' | 'HOST' | 'DRIVER',
  input?: {
    email?: string
    password?: string
    phone?: string
    mode?: 'signIn' | 'signUp'
  },
) {
  const fallbackAccount = staffPrototypeAccount(role)
  const email = input?.email?.trim()
  const password = input?.password?.trim()
  const phone = input?.phone?.trim()
  if (!email || !password || !phone) {
    throw new Error('Staff credentials are required')
  }
  const account = {
    ...fallbackAccount,
    email,
    password,
    phone,
  }
  const session = input?.mode === 'signUp' ? await createStaffAccount(account) : await ensurePrototypeSession(account)
  sessionStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session))
  sessionStorage.setItem(STAFF_SESSION_TOKEN_KEY, session.token)
  return session
}

export function clearStoredStaffSession() {
  requestServerLogout(sessionStorage.getItem(STAFF_SESSION_TOKEN_KEY))
  sessionStorage.removeItem(STAFF_SESSION_KEY)
  sessionStorage.removeItem(STAFF_SESSION_TOKEN_KEY)
}

export function getStoredSellerSession(): PlatformAuthSession | null {
  try {
    const raw = sessionStorage.getItem(SELLER_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PlatformAuthSession
    if (!session?.token || !session?.user) return null
    return session
  } catch {
    return null
  }
}

async function getHostDashboardSession(mode: HostDashboardMode) {
  if (mode === 'seller') {
    const sellerSession = getStoredSellerSession()
    if (sellerSession) return sellerSession
  }

  return ensurePrototypeHostSession()
}

export async function createAndApprovePrototypeListing(input: CreateListingInput) {
  const session = await ensurePrototypeHostSession()
  const created = await apiRequest<{ ok: true; listing: PlatformListing }>('/api/listings', {
    method: 'POST',
    token: session.token,
    body: {
      division: input.division || 'STAYS',
      ...input,
    },
  })

  await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/listings/${created.listing.id}/submit`, {
    method: 'PATCH',
    token: session.token,
  })

  const approved = await reviewPrototypeQueueEntity('listings', created.listing.id, 'APPROVE')
  return approved as PlatformListing
}

export type ListingSearchFilters = {
  governorate?: string
  city?: string
  area?: string
  propertyType?: string
  roomType?: string
  bedType?: string
  minPrice?: number
  maxPrice?: number
  bedrooms?: number
  bathrooms?: number
  amenities?: string[]
  checkIn?: string
  checkOut?: string
  sort?: 'priceAsc' | 'priceDesc' | 'newest'
}

export async function fetchApprovedListings(division = 'STAYS', filters: ListingSearchFilters = {}) {
  const params = new URLSearchParams({ division })
  if (filters.governorate) params.set('governorate', filters.governorate)
  if (filters.city) params.set('city', filters.city)
  if (filters.area) params.set('area', filters.area)
  if (filters.propertyType) params.set('propertyType', filters.propertyType)
  if (filters.roomType) params.set('roomType', filters.roomType)
  if (filters.bedType) params.set('bedType', filters.bedType)
  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice))
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice))
  if (filters.bedrooms !== undefined) params.set('bedrooms', String(filters.bedrooms))
  if (filters.bathrooms !== undefined) params.set('bathrooms', String(filters.bathrooms))
  if (filters.amenities?.length) params.set('amenities', filters.amenities.join(','))
  if (filters.checkIn) params.set('checkIn', filters.checkIn)
  if (filters.checkOut) params.set('checkOut', filters.checkOut)
  if (filters.sort) params.set('sort', filters.sort)
  try {
    const response = await apiRequest<{ ok: true; listings: PlatformListing[] }>(`/api/listings?${params.toString()}`)
    return response.listings
  } catch {
    return fallbackApprovedListings(division)
  }
}

export type ListingAvailabilityEntry = {
  id: string
  listingId: string
  date: string
  status: 'BLOCKED' | 'AVAILABLE'
  priceOverrideMinor: number | null
  note: string | null
}

export async function fetchListingAvailability(listingId: string, from: string, to: string) {
  const params = new URLSearchParams({ from, to })
  try {
    return await apiRequest<{
      ok: true
      blockedDates: string[]
      priceOverrides: Array<{ date: string; priceMinor: number }>
      bookedRanges: Array<{ checkIn: string; checkOut: string }>
      offerNightsCount: number
      cheapestOfferMinor: number | null
    }>(`/api/listings/${listingId}/availability?${params.toString()}`)
  } catch {
    return { ok: true as const, blockedDates: [], priceOverrides: [], bookedRanges: [], offerNightsCount: 0, cheapestOfferMinor: null }
  }
}

export async function fetchListingQuote(listingId: string, checkIn: string, checkOut: string, currency?: 'USD') {
  const params = new URLSearchParams({ checkIn, checkOut, ...(currency ? { currency } : {}) })
  return apiRequest<{ ok: true; totalMinor: number; nights: number; perNight: Array<{ date: string; priceMinor: number }>; currency: string }>(
    `/api/listings/${listingId}/quote?${params.toString()}`,
  )
}

export type PlatformListingReview = {
  id: string
  listingId: string
  bookingId: string
  guestId: string
  rating: number
  comment: string | null
  hiddenAt?: string | null
  createdAt: string
  guest?: { id: string; displayName: string }
}

export async function submitPrototypeReview(input: { bookingId: string; rating: number; comment?: string }) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; review: PlatformListingReview }>('/api/reviews', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.review
}

export async function fetchListingReviews(listingId: string) {
  return apiRequest<{ ok: true; reviews: PlatformListingReview[]; average: number | null; count: number }>(
    `/api/listings/${listingId}/reviews`,
  )
}

export async function hideAdminReview(reviewId: string) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; review: PlatformListingReview }>(`/api/admin/reviews/${reviewId}/hide`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.review
}

export type PlatformAdminHostInsight = PlatformHostInsight & {
  host?: { id: string; displayName: string; email: string | null }
  listing?: { id: string; titleAr: string; titleEn: string | null }
}

export async function fetchAdminHostInsights() {
  const session = await ensurePrototypeAdminSession()
  return apiRequest<{
    ok: true
    insights: PlatformAdminHostInsight[]
    totals: { generated: number; emailed: number; read: number }
  }>('/api/admin/host-insights', { token: session.token })
}

export type PlatformMessage = {
  id: string
  threadId: string
  senderUserId: string
  senderRole: 'GUEST' | 'HOST' | 'ADMIN' | 'SUPPORT'
  body: string
  createdAt: string
  sender?: { id: string; displayName: string }
}

export type PlatformMessageThread = {
  id: string
  bookingId: string
  messages: PlatformMessage[]
}

function resolveViewerSession(preferStaff = false) {
  const guest = getStoredGuestSession()
  const host = getStoredStaffSession('HOST')
  const seller = getStoredSellerSession()
  const admin = getStoredStaffSession('ADMIN')

  if (preferStaff) {
    if (host) return host
    if (admin) return admin
    if (seller) return seller
    if (guest) return guest
  } else {
    if (guest) return guest
    if (host) return host
    if (seller) return seller
    if (admin) return admin
  }

  throw new Error('Sign in before opening this conversation.')
}

export async function fetchBookingThread(bookingId: string, preferStaff = false) {
  const session = resolveViewerSession(preferStaff)
  const response = await apiRequest<{ ok: true; thread: PlatformMessageThread }>(`/api/bookings/${bookingId}/thread`, {
    token: session.token,
  })
  return response.thread
}

export async function sendBookingMessage(bookingId: string, body: string, preferStaff = false) {
  const session = resolveViewerSession(preferStaff)
  const response = await apiRequest<{ ok: true; message: PlatformMessage }>(`/api/bookings/${bookingId}/thread/messages`, {
    method: 'POST',
    token: session.token,
    body: { body },
  })
  return response.message
}

export type PlatformListingInquiryThread = {
  id: string
  listingId: string
  guestId: string
  messages: PlatformMessage[]
}

export type PlatformHostInquiryThread = {
  id: string
  listingId: string | null
  guestId: string | null
  updatedAt: string
  listing: { id: string; titleAr: string; titleEn: string | null; division: string; priceMinor: number; currency: string } | null
  guest: { id: string; displayName: string; email: string | null } | null
  messages: PlatformMessage[]
}

// Real, persistent "contact the owner" thread for RENTALS/BUY listings, reusing the same
// messages system built for STAYS bookings instead of writing to localStorage only.
export async function fetchListingInquiryThread(listingId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; thread: PlatformListingInquiryThread }>(`/api/listings/${listingId}/thread`, {
    token: session.token,
  })
  return response.thread
}

export async function sendListingInquiryMessage(listingId: string, body: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; message: PlatformMessage }>(`/api/listings/${listingId}/thread/messages`, {
    method: 'POST',
    token: session.token,
    body: { body },
  })
  return response.message
}

// Owner-side inbox: every real inquiry thread across the owner's own listings.
export async function fetchHostInquiries(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; threads: PlatformHostInquiryThread[] }>('/api/host/inquiries', {
    token: session.token,
  })
  return response.threads
}

export async function fetchListingInquiryThreadAsOwner(listingId: string, guestId: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; thread: PlatformListingInquiryThread }>(
    `/api/listings/${listingId}/thread?guestId=${encodeURIComponent(guestId)}`,
    { token: session.token },
  )
  return response.thread
}

export async function sendListingInquiryMessageAsOwner(listingId: string, guestId: string, body: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; message: PlatformMessage }>(`/api/listings/${listingId}/thread/messages`, {
    method: 'POST',
    token: session.token,
    body: { body, guestId },
  })
  return response.message
}

export async function fetchHostListingAvailability(listingId: string, from: string, to: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const params = new URLSearchParams({ from, to })
  const response = await apiRequest<{ ok: true; availability: ListingAvailabilityEntry[] }>(
    `/api/host/listings/${listingId}/availability?${params.toString()}`,
    { token: session.token },
  )
  return response.availability
}

export async function updateHostListingAvailability(
  listingId: string,
  dates: Array<{ date: string; status: 'BLOCKED' | 'AVAILABLE'; priceOverrideMinor?: number | null }>,
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; availability: ListingAvailabilityEntry[] }>(
    `/api/host/listings/${listingId}/availability`,
    { method: 'PATCH', token: session.token, body: { dates } },
  )
  return response.availability
}

export async function fetchPrototypeListing(listingId: string) {
  try {
    const response = await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/listings/${listingId}`)
    return response.listing
  } catch (error) {
    const fallbackListing = FALLBACK_APPROVED_LISTINGS.find((listing) => listing.id === listingId)
    if (fallbackListing) return fallbackListing
    throw error
  }
}

export async function submitPrototypeLocalWalletProof(input: {
  bookingId?: string
  amountMinor: number
  currency: string
  proofAssetUrl?: string
  providerRef: string
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>('/api/payments/local-wallet-proof', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.proof
}

export async function fetchStripePaymentStatus() {
  const response = await apiRequest<{ ok: true; configured: boolean; currency: string }>('/api/payments/stripe/status')
  return response
}

export async function createStripeCheckoutSession(bookingId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; url: string; sessionId: string }>('/api/payments/stripe/create-checkout-session', {
    method: 'POST',
    token: session.token,
    body: { bookingId, origin: window.location.origin },
  })
  return response
}

export async function confirmStripePayment(sessionId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>('/api/payments/stripe/confirm', {
    method: 'POST',
    token: session.token,
    body: { sessionId },
  })
  return response.proof
}

export async function fetchPrototypePaymentProof(proofId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>(`/api/payments/${proofId}`, {
    token: session.token,
  })
  return response.proof
}

export async function reviewPrototypePaymentProof(
  proofId: string,
  decision: 'APPROVE' | 'REJECT',
  adminNote?: string,
  shamCashReconciliation?: {
    accountMinor: number | null
    expectedMinor: number
    differenceMinor: number
    source?: string
  },
) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; entity: PlatformPaymentProof }>(
    `/api/admin/review-queue/payments/${proofId}`,
    {
      method: 'PATCH',
      token,
      body: { decision, adminNote, shamCashReconciliation },
    },
  ))
  return response.entity
}

export async function fetchPrototypeReviewQueue() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; queue: PlatformReviewQueue }>('/api/admin/review-queue', {
    token,
  }))
  return response.queue
}

export async function fetchPrototypeAdminAuditLog(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) })
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; auditLog: PlatformAdminAuditLog[] }>(
    `/api/admin/audit-log?${params.toString()}`,
    {
      token,
    },
  ))
  return response.auditLog
}

export async function fetchPrototypeAdminMetrics() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; metrics: PlatformAdminMetrics }>('/api/admin/platform-metrics', {
    token,
  }))
  return response.metrics
}

export type PlatformRevenueByCurrency = {
  currency: string
  totalRevenueMinor: number
  sampleSize: number
  history: Array<{ day: string; amountMinor: number }>
  projection: {
    elapsedDays: number
    dailyAverageMinor: number
    next30DaysMinor: number
    next90DaysMinor: number
  }
}

export type PlatformRevenueSummary = {
  // Seller-plan fees and booking commission are collected in different currencies (USD vs SYP by
  // default) — kept as separate per-currency totals rather than summed together, since adding
  // different currencies' minor units as one number would silently misreport the total.
  byCurrency: PlatformRevenueByCurrency[]
  srRidesCompletedCount: number
  srRidesFareVolumeMinor: number
}

export async function fetchAdminRevenueSummary() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; revenue: PlatformRevenueSummary }>('/api/admin/revenue-summary', {
    token,
  }))
  return response.revenue
}

export type AdminPayout = {
  bookingId: string
  listingTitle: string | null
  hostId: string | null
  hostName: string | null
  checkOut: string | null
  eligibleAt: string | null
  eligibleNow: boolean
  hostPayoutMinor: number
  currency: string
}

export async function fetchAdminPayouts() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; payouts: AdminPayout[]; holdDays: number }>('/api/admin/payouts', {
    token,
  }))
  return response
}

export async function releaseAdminPayout(bookingId: string) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; walletEntry: Record<string, unknown> }>(
    `/api/admin/payouts/${bookingId}/release`,
    { method: 'PATCH', token },
  ))
  return response.walletEntry
}

export async function reviewPrototypeQueueEntity(
  entityType: 'listings' | 'payments' | 'gifts' | 'bookings' | 'iddocuments',
  entityId: string,
  decision: 'APPROVE' | 'REJECT',
  adminNote?: string,
) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; entity: unknown }>(
    `/api/admin/review-queue/${entityType}/${entityId}`,
    {
      method: 'PATCH',
      token,
      body: { decision, adminNote },
    },
  ))
  return response.entity
}

// <img src> can't send an Authorization header, and this file is admin/support-only, so the
// review UI fetches it as an authenticated blob instead of linking to the endpoint directly.
export async function fetchIdDocumentBlobUrl(userId: string) {
  const session = await ensurePrototypeAdminSession()
  const response = await fetch(`${API_BASE_URL}/api/admin/id-document/${userId}/file`, {
    headers: { authorization: `Bearer ${session.token}` },
  })
  if (!response.ok) throw new Error(`Could not load ID document: ${response.status}`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

async function runAdminRequest<T>(request: (token: string) => Promise<T>) {
  const session = await ensurePrototypeAdminSession()

  try {
    return await request(session.token)
  } catch (error) {
    if (!isAuthApiError(error)) throw error

    clearStoredStaffSession()
    throw error
  }
}

// Supports the WhatsApp/email ID-submission channel: an admin who received a document outside
// the platform looks the customer up by their account email, then attaches the file for them.
export async function lookupAdminUserByEmail(email: string) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; user: PlatformIdDocumentReview }>(
    `/api/admin/users/lookup?email=${encodeURIComponent(email)}`,
    { token },
  ))
  return response.user
}

export async function uploadIdDocumentForUser(userId: string, file: File) {
  const fileBase64 = await readFileAsBase64(file)
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; user: PlatformIdDocumentReview }>(
    `/api/admin/id-document/${userId}/upload`,
    { method: 'PATCH', token, body: { fileBase64, mimeType: file.type } },
  ))
  return response.user
}

export type PlatformSrQuote = {
  fareMinor: number
  currency: string
  distanceKm: number
  estimated: boolean
  pickupCoords: { lat: number; lng: number } | null
  dropoffCoords: { lat: number; lng: number } | null
}

export async function fetchSrQuote(input: {
  pickup: string
  dropoff: string
  category: string
  currency: string
  lowDataMode: boolean
  pickupCoords?: { lat: number; lng: number }
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; quote: PlatformSrQuote }>('/api/sr/quote', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.quote
}

export async function createPrototypeSrRide(input: {
  pickup: string
  dropoff: string
  category: string
  currency: string
  lowDataMode: boolean
  accuracyMeters?: number
  pickupCoords?: { lat: number; lng: number }
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>('/api/sr/rides', {
    method: 'POST',
    token: session.token,
    body: {
      pickup: input.pickup,
      dropoff: input.dropoff,
      category: input.category,
      currency: input.currency,
      lowDataMode: input.lowDataMode,
      pickupCoords: input.pickupCoords,
      metadata: {
        accuracyMeters: input.accuracyMeters,
        locationSource: input.accuracyMeters ? 'gps' : 'manual',
      },
    },
  })
  return response.ride
}

export async function fetchPrototypeSrRide(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(`/api/sr/rides/${rideId}`, {
    token: session.token,
  })
  return response.ride
}

export async function fetchPrototypeDriverOverview() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; overview: PlatformDriverOverview }>('/api/driver/rides', {
    token: session.token,
  })
  return response.overview
}

export async function fetchPendingSrRides() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; rides: PlatformRideRequest[] }>('/api/driver/rides/pending', {
    token: session.token,
  })
  return response.rides
}

export async function claimPrototypeSrRide(rideId: string) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(`/api/sr/rides/${rideId}/claim`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.ride
}

export async function updatePrototypeDriverRideStatus(
  rideId: string,
  status: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(
    `/api/driver/rides/${rideId}/status`,
    {
      method: 'PATCH',
      token: session.token,
      body: { status },
    },
  )
  return response.ride
}

export async function createPrototypeBooking(input: {
  listingId: string
  amountMinor: number
  currency: string
  checkIn?: string
  checkOut?: string
  cancellationProtectionPurchased?: boolean
  cancellationProtection?: boolean
  cancellationProtectionFeeMinor?: number
  acceptedTerms?: boolean
  termsVersion?: string
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; booking: PlatformBooking }>('/api/bookings', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.booking
}

export async function fetchPrototypeBooking(bookingId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{
    ok: true
    booking: PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[]; review?: PlatformListingReview | null }
  }>(`/api/bookings/${bookingId}`, {
    token: session.token,
  })
  return response.booking
}

export async function disputePrototypeBooking(bookingId: string, note?: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{
    ok: true
    booking: PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[] }
  }>(`/api/bookings/${bookingId}/dispute`, {
    method: 'PATCH',
    token: session.token,
    body: { note },
  })
  return response.booking
}

export async function fetchPrototypeOverview() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; overview: PlatformOverview }>('/api/me/overview', {
    token: session.token,
  })
  return response.overview
}

export async function fetchSellerOverview() {
  const session = getStoredSellerSession()
  if (!session) throw new Error('Sign in as a seller first.')
  const response = await apiRequest<{ ok: true; overview: PlatformOverview }>('/api/me/overview', {
    token: session.token,
  })
  return response.overview
}

export async function submitSellerPlanProof(input: {
  amountMinor: number
  currency?: string
  providerRef: string
  proofAssetUrl?: string
  planCode?: string
  legalName?: string
  sellerType?: string
}) {
  const session = getStoredSellerSession()
  if (!session) throw new Error('Sign in as a seller first.')
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>('/api/payments/seller-plan-proof', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.proof
}

export async function fetchPrototypeHostOverview(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; overview: PlatformHostOverview }>('/api/host/overview', {
    token: session.token,
  })
  return response.overview
}

export type PlatformHostEarningsRow = {
  bookingId: string
  listingTitle: string
  checkIn: string | null
  checkOut: string | null
  status: string
  hostGrossMinor: number
  adminCommissionMinor: number
  cleaningFeeMinor: number
  taxesMinor: number
  currency: string
  payoutStatus: 'PENDING_HOLD' | 'ELIGIBLE' | 'RELEASED'
  eligibleAt: string | null
}

export type PlatformHostEarnings = {
  rows: PlatformHostEarningsRow[]
  totals: { forecastedMinor: number; grossEarnedMinor: number; releasedMinor: number; pendingMinor: number; currency: string }
}

export async function fetchPrototypeHostEarnings(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; earnings: PlatformHostEarnings }>('/api/host/earnings', {
    token: session.token,
  })
  return response.earnings
}

export type PlatformHostInsight = {
  id: string
  hostId: string
  listingId: string | null
  kind: string
  facts: Record<string, unknown>
  messageAr: string
  messageEn: string | null
  aiProvider: string | null
  aiModel: string | null
  readAt: string | null
  emailSentAt: string | null
  emailError: string | null
  createdAt: string
}

export async function fetchHostInsights(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  return apiRequest<{ ok: true; insights: PlatformHostInsight[]; unreadCount: number }>('/api/host/insights', {
    token: session.token,
  })
}

export async function generateHostInsight(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  return apiRequest<{ ok: true; generated: number }>('/api/host/insights/generate', {
    method: 'POST',
    token: session.token,
  })
}

export async function markHostInsightRead(insightId: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; insight: PlatformHostInsight }>(`/api/host/insights/${insightId}/read`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.insight
}

export async function decidePrototypeHostRequest(
  bookingId: string,
  decision: 'CONFIRM' | 'CANCEL',
  mode: HostDashboardMode = 'host',
  options: { acceptedTerms?: boolean; termsVersion?: string } = {},
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; booking: PlatformBooking & { listing?: PlatformListing } }>(
    `/api/host/requests/${bookingId}`,
    {
      method: 'PATCH',
      token: session.token,
      body: { decision, ...options },
    },
  )
  return response.booking
}

export async function markHostGuestCheckpoint(
  bookingId: string,
  action: 'CHECK_IN' | 'CHECK_OUT',
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; booking: PlatformBooking & { listing?: PlatformListing } }>(
    `/api/host/requests/${bookingId}/checkin`,
    {
      method: 'PATCH',
      token: session.token,
      body: { action },
    },
  )
  return response.booking
}

export async function updatePrototypeHostListingStatus(
  listingId: string,
  status: 'PAUSED' | 'APPROVED',
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/host/listings/${listingId}/status`,
    {
      method: 'PATCH',
      token: session.token,
      body: { status },
    },
  )
  return response.listing
}

export async function updatePrototypeHostInstantBook(
  listingId: string,
  enabled: boolean,
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/host/listings/${listingId}/instant-book`,
    {
      method: 'PATCH',
      token: session.token,
      body: { enabled },
    },
  )
  return response.listing
}

export async function createPrototypeWalletGift(input: {
  recipientPhone: string
  amountMinor: number
  currency: string
  message?: string
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; gift: PlatformWalletGift }>('/api/wallet/gifts', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.gift
}

export async function claimPrototypeWalletGift(giftId: string, phone: string, code: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{
    ok: true
    entry: Record<string, unknown>
    wallet: PlatformWallet
    gift: PlatformWalletGift
  }>(`/api/wallet/gifts/${giftId}/claim`, {
    method: 'POST',
    token: session.token,
    body: { phone, code },
  })
  return response
}

export async function fetchPrototypeWalletGift(giftId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; gift: PlatformWalletGift }>(`/api/wallet/gifts/${giftId}`, {
    token: session.token,
  })
  return response.gift
}

export async function fetchPrototypeWallet() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; wallets: PlatformWallet[] }>('/api/wallet', {
    token: session.token,
  })
  return response.wallets
}

async function ensurePrototypeHostSession() {
  const stored = getStoredStaffSession('HOST') || getStoredStaffSession('SELLER')
  if (stored) return stored

  throw new Error('Host staff session required')
}

async function ensurePrototypeGuestSession() {
  const guestSession = getStoredGuestSession()
  if (guestSession) return guestSession

  return ensurePrototypeSession({
    email: 'guest@sybnb.local',
    password: 'StrongPass123',
    displayName: 'SYBNB Guest',
    role: 'GUEST',
    phone: '+963900000001',
  })
}

async function ensurePrototypeAdminSession() {
  const stored = getStoredStaffSession('ADMIN')
  if (stored) return stored

  throw new Error('Admin staff session required')
}

async function ensurePrototypeDriverSession() {
  const stored = getStoredStaffSession('DRIVER')
  if (stored) return stored

  throw new Error('Driver staff session required')
}

function staffPrototypeAccount(role: 'ADMIN' | 'HOST' | 'DRIVER') {
  if (role === 'ADMIN') {
    return {
      email: 'admin@sybnb.local',
      displayName: 'SYBNB Admin',
      role: 'ADMIN',
      phone: '+963900000099',
    }
  }

  if (role === 'DRIVER') {
    return {
      email: 'driver@sybnb.local',
      displayName: 'SYBNB Driver',
      role: 'DRIVER',
      phone: '+963900000077',
    }
  }

  return {
    email: 'host@sybnb.local',
    displayName: 'SYBNB Host',
    role: 'HOST',
    phone: '+963900000050',
  }
}

async function ensurePrototypeSession(account: {
  email: string
  password: string
  displayName: string
  role: string
  phone: string
}) {
  try {
    return await login(account.email, account.password)
  } catch {
    return register(account)
  }
}

async function createStaffAccount(account: {
  email: string
  password: string
  displayName: string
  role: string
  phone: string
}) {
  try {
    return await register(account)
  } catch {
    return login(account.email, account.password)
  }
}

async function login(email: string, password: string) {
  return apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

async function register(body: {
  email: string
  password: string
  displayName: string
  role: string
  phone?: string
  referralCode?: string
}) {
  return apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body,
  })
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: string
    token?: string
    body?: unknown
  } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const payload = (await response.json()) as unknown
  if (!response.ok || isApiErrorBody(payload)) {
    const message = isApiErrorBody(payload) ? payload.error?.message : undefined
    const error = new Error(message || `SYBNB API request failed: ${response.status}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }

  return payload as T
}

function isApiErrorBody(payload: unknown): payload is ApiErrorBody {
  return Boolean(payload && typeof payload === 'object' && 'ok' in payload && payload.ok === false)
}

function isAuthApiError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'status' in error &&
    ((error as { status?: number }).status === 401 || (error as { status?: number }).status === 403),
  )
}
