const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'

// A server-relative signed storage URL (e.g. driver photoUrl) must resolve against the API's own
// origin, not the page's -- a bare `<img src="/api/...">` would otherwise ask the frontend's own
// dev/static server for it. Already-absolute URLs pass through unchanged.
export function resolveApiUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path}`
}

type ApiUser = {
  id: string
  email: string | null
  displayName: string
  roles: string[]
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
    idDocumentStatus?: string | null
  }
  media?: Array<Record<string, unknown>>
  location?: Record<string, unknown> | null
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
  proofAssetUrls?: string[]
  providerRef: string | null
  adminNote: string | null
  reviewedById: string | null
  reviewedAt: string | null
  planCode?: string | null
  campaignListingId?: string | null
  campaignListing?: {
    id: string
    titleAr: string
    titleEn: string | null
    status: string
    metadata?: Record<string, unknown>
  } | null
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
  cancellationFeeMinor: number | null
  scheduledFor: string | null
  accessibilityRequired: boolean
  stops: Array<{ address: string; lat: number | null; lng: number | null }>
  discountMinor: number | null
  businessAccountId: string | null
  shareable: boolean
  currency: string
  metadata: Record<string, unknown>
  updatedAt: string
  rider?: {
    id: string
    displayName: string
    email: string | null
  }
  driver?: {
    id: string
    displayName: string
    isVerified: boolean
    driverProfile: { vehicleMake: string | null; vehicleModel: string | null; vehiclePlate: string | null; photoUrl: string | null } | null
    averageRating: number | null
    ratingCount: number
    location: { lat: number; lng: number; updatedAt: string } | null
  } | null
  review?: PlatformRideReview | null
  paymentProofs?: Array<{ id: string; status: string; amountMinor: number; currency: string }>
  pickupCoords?: { lat: number; lng: number } | null
  dropoffCoords?: { lat: number; lng: number } | null
}

export type PlatformRideReview = {
  id: string
  rideId: string
  riderId: string
  rating: number
  comment: string | null
  createdAt: string
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

// The real backlog size per category, independent of the (currently 100-item) cap on the arrays
// below. Added server-side (e59ab6f) specifically so a genuine backlog surge would be visible
// instead of silently capped -- an admin-satisfaction audit found this never reached the UI, so
// the review page had no way to show "showing 100 of 319" and just looked like the backlog was
// however many rows happened to fit under the cap. Optional (not every fetchPrototypeReviewQueue
// caller populates it -- see that function's own comment) rather than a separate parallel type,
// so every existing PlatformReviewQueue consumer keeps working unchanged.
export type PlatformReviewQueueTotals = {
  listings: number
  payments: number
  gifts: number
  bookings: number
  idDocuments: number
}

export type PlatformReviewQueue = {
  listings: PlatformListing[]
  payments: PlatformPaymentProof[]
  gifts: PlatformWalletGift[]
  bookings: PlatformReviewBooking[]
  idDocuments: PlatformIdDocumentReview[]
  queueTotals?: PlatformReviewQueueTotals
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
}

export type PlatformDriverOverview = {
  driver: ApiUser & { accessibilityCapable: boolean }
  totals: {
    assigned: number
    active: number
    completed: number
    earningsMinor: number
  }
  rating: { averageRating: number | null; ratingCount: number }
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
  // Server-computed over the full ledger (not just the 25 returned entries):
  // availableMinor === cachedBalanceMinor; heldMinor === outstanding HOLD - RELEASE.
  availableMinor?: number
  heldMinor?: number
  refundMinor?: number
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
  media?: Array<{ url: string; kind?: string; sortOrder?: number }>
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

export type ActiveAd = {
  id: string
  titleAr: string
  titleEn: string | null
  plan: 'plus' | 'premium'
  media: { url: string; kind: string }[]
}

export async function fetchActiveAdvertising() {
  return apiRequest<{ ok: true; ads: ActiveAd[] }>('/api/advertising/active')
}

export async function createAndSubmitPrototypeListing(input: CreateListingInput) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const { media, ...listingBody } = input
  const created = await apiRequest<{ ok: true; listing: PlatformListing }>('/api/listings', {
    method: 'POST',
    token: session.token,
    body: {
      division: 'STAYS',
      ...listingBody,
    },
  })

  // Attach media (if provided) while the listing is still a draft, before it is submitted for
  // review — the media endpoint locks once the listing leaves DRAFT/REJECTED.
  if (media && media.length > 0) {
    await apiRequest<{ ok: true }>(`/api/listings/${created.listing.id}/media`, {
      method: 'POST',
      token: session.token,
      body: { media },
    })
  }

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
  } catch (error) {
    if (!isAccountExistsError(error)) throw error
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

export async function createGuestAccountSession(input: {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  password: string
}) {
  // EMAIL is the account identity (email-first). Phone is optional contact only. Fall back to a
  // phone- or time-derived local address only when no email was provided (legacy/edge).
  const normalizedPhone = (input.phone || '').replace(/\D/g, '')
  const loginEmail = input.email?.trim()
    ? input.email.trim()
    : normalizedPhone
      ? `guest-${normalizedPhone}@sybnb.local`
      : `guest-${Date.now()}@sybnb.local`
  const displayName = [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || 'SYBNB Guest'
  const account = {
    email: loginEmail,
    password: input.password,
    displayName,
    role: 'GUEST',
    phone: input.phone,
  }

  let session: PlatformAuthSession
  try {
    session = await register(account)
  } catch (error) {
    if (!isAccountExistsError(error)) throw error
    session = await login(loginEmail, input.password)
  }

  sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  sessionStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  return session
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
// Real payment-proof file upload (was previously filename-only for booking/seller-plan/advertising
// payments, so nothing an admin could actually review before releasing real money). Accepts a token
// directly since this is called from guest, seller, and host sessions alike.
export async function uploadPaymentProofFile(file: File, token: string) {
  const fileBase64 = await readFileAsBase64(file)
  const response = await apiRequest<{ ok: true; proofAssetUrl: string }>('/api/payments/proof-upload', {
    method: 'POST',
    token,
    body: { fileBase64, contentType: file.type },
  })
  return response.proofAssetUrl
}

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

export function clearGuestSession() {
  sessionStorage.removeItem(GUEST_SESSION_KEY)
  sessionStorage.removeItem(GUEST_SESSION_TOKEN_KEY)
  window.dispatchEvent(new Event('sybnb-session-changed'))
}

// SEC-002 — server-side revocation. Clearing sessionStorage is NOT a logout: the token is a
// self-contained credential that keeps working for its full seven-day life, so anyone who copied it
// (shared machine, XSS, exported browser profile) stayed signed in after the user pressed "Sign
// out". These helpers revoke the session on the server FIRST and only then drop the local copy.
//
// Returns whether the server actually revoked it. A 401/403 counts as revoked -- the token is
// already unusable, which is the outcome logout is trying to produce. Anything else (offline,
// 5xx) returns false, and the caller must not tell the user they are securely signed out.
async function revokeSessionOnServer(token: string | undefined | null): Promise<boolean> {
  if (!token) return true
  try {
    await apiRequest<{ ok: true; revoked: boolean }>('/api/auth/logout', { method: 'POST', token, body: {} })
    return true
  } catch (error) {
    return isAuthApiError(error)
  }
}

export async function signOutGuest(): Promise<{ serverRevoked: boolean }> {
  const session = getStoredGuestSession()
  const serverRevoked = await revokeSessionOnServer(session?.token)
  // The local copy is dropped either way: leaving a token the user asked to discard sitting in
  // sessionStorage would be worse than a stale server-side row. The return value is what tells the
  // UI whether it may claim the session was actually revoked.
  clearGuestSession()
  return { serverRevoked }
}

export async function signOutStaff(): Promise<{ serverRevoked: boolean }> {
  const session = getStoredStaffSession()
  const serverRevoked = await revokeSessionOnServer(session?.token)
  clearStoredStaffSession()
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return { serverRevoked }
}

// The seller flow's sign-out historically called sessionStorage.clear(), which wipes guest, staff
// AND seller sessions at once. Revoke every token it is about to discard, so the blast radius of
// the local clear matches the blast radius of the server-side revocation.
export async function signOutAllLocalSessions(): Promise<{ serverRevoked: boolean }> {
  const tokens = [getStoredGuestSession()?.token, getStoredStaffSession()?.token, getStoredSellerSession()?.token]
  const unique = Array.from(new Set(tokens.filter((token): token is string => Boolean(token))))
  const results = await Promise.all(unique.map((token) => revokeSessionOnServer(token)))
  sessionStorage.clear()
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return { serverRevoked: results.every(Boolean) }
}

// "Sign out everywhere" — revokes every session on the account, not just this browser's.
export async function signOutEverywhere(token: string): Promise<{ serverRevoked: boolean }> {
  let serverRevoked = false
  try {
    await apiRequest<{ ok: true }>('/api/auth/logout-all', { method: 'POST', token, body: {} })
    serverRevoked = true
  } catch (error) {
    serverRevoked = isAuthApiError(error)
  }
  sessionStorage.clear()
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return { serverRevoked }
}

// SEC-002, Step J. Server-side revocation is now real, which creates a state the frontend never had
// to handle before: a token sitting in sessionStorage that the server has already killed (logged out
// on another device, account suspended, ADMIN removed). Browser-verified before this existed --
// re-injecting a revoked token left the header rendering "Hi, <name>" and a "Sign out" button,
// because getStoredGuestSession() only ever read local storage and nothing reconciled it with the
// server. Not a privilege bypass (the credential is dead server-side and every protected route
// refused), but the UI claimed a session that did not exist.
//
// Any 401 on a request that carried a token means that token is no longer valid, so the local copy
// is dropped and the app re-renders signed-out. Only the key(s) holding the FAILING token are
// cleared -- a guest 401 must not sign an admin out of a different tab's staff session.
function purgeLocalSessionsForToken(token: string) {
  if (typeof window === 'undefined' || !token) return
  let changed = false
  const drop = (sessionKey: string, tokenKey?: string) => {
    try {
      const raw = sessionStorage.getItem(sessionKey)
      const stored = raw ? (JSON.parse(raw) as { token?: string })?.token : undefined
      if (stored !== token) return
      sessionStorage.removeItem(sessionKey)
      if (tokenKey) sessionStorage.removeItem(tokenKey)
      changed = true
    } catch {
      // A malformed stored session is not something to crash an API error path over.
    }
  }
  drop(GUEST_SESSION_KEY, GUEST_SESSION_TOKEN_KEY)
  drop(STAFF_SESSION_KEY, STAFF_SESSION_TOKEN_KEY)
  drop(SELLER_SESSION_KEY)
  if (changed) window.dispatchEvent(new Event('sybnb-session-changed'))
}

export async function fetchActiveSessions(token: string) {
  const response = await apiRequest<{
    ok: true
    sessions: Array<{ id: string; issuedAt: string; expiresAt: string; lastUsedAt: string | null; userAgent: string | null; current: boolean }>
  }>('/api/auth/sessions', { token })
  return response.sessions
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
  // Email is the account identity; phone is optional contact (email-only Syria config).
  if (!email || !password) {
    throw new Error('Staff credentials are required')
  }
  // Phone is optional CONTACT only. When the host omits it, register with NO phone (email-only,
  // like the seller flow) — never inject the shared prototype fallback phone, which would collide
  // on the phoneHash unique index (P2002 → 409) against the seeded host account.
  const { phone: _fallbackPhone, ...fallbackRest } = fallbackAccount
  const account = {
    ...fallbackRest,
    email,
    password,
    ...(phone ? { phone } : { phone: '' }),
  }
  const session = input?.mode === 'signUp' ? await createStaffAccount(account) : await ensurePrototypeSession(account)
  sessionStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session))
  sessionStorage.setItem(STAFF_SESSION_TOKEN_KEY, session.token)
  return session
}

export function clearStoredStaffSession() {
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

export type FetchApprovedListingsResult = {
  listings: PlatformListing[]
  nextCursor: string | null
}

// A real scale-readiness audit found this had no pagination at all — the server capped at a
// fixed 250 rows with no way to reach anything past that, so once a division+city passed ~250
// approved listings, older inventory became permanently unreachable. The server now does real
// keyset pagination (see server/routes/listings.mjs); pass the previous call's `nextCursor` back
// in to fetch the next page, and stop once it comes back null.
export async function fetchApprovedListings(
  division = 'STAYS',
  filters?: {
    attributes?: Record<string, string | string[]>
    priceMin?: number
    priceMax?: number
    bedroomsMin?: number
    bathroomsMin?: number
    city?: string
    sort?: string
    priceBand?: string
  },
  cursor?: string | null,
): Promise<FetchApprovedListingsResult> {
  const params = new URLSearchParams({ division })
  // Single-select scalar attributes only (Cars: carBrand/…; Buy/Rentals: propertyType). Skip
  // 'any', empty, and multi-select array values — only scalar constraints reach the server.
  const ATTRIBUTE_KEYS = ['carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition', 'propertyType', 'marketCategory']
  if (filters?.attributes) {
    for (const key of ATTRIBUTE_KEYS) {
      const value = filters.attributes[key]
      if (typeof value === 'string' && value && value !== 'any') params.set(key, value)
    }
    // Multi-select attribute filters (amenities/views/access): a listing must have ALL selected
    // values (server-side AND), sent as one comma-separated param per key.
    const ARRAY_ATTRIBUTE_KEYS = ['amenities', 'views', 'access']
    for (const key of ARRAY_ATTRIBUTE_KEYS) {
      const value = filters.attributes[key]
      if (Array.isArray(value) && value.length) params.set(key, value.join(','))
    }
  }
  if (filters?.priceMin && filters.priceMin > 0) params.set('priceMin', String(filters.priceMin))
  if (filters?.priceMax && filters.priceMax > 0) params.set('priceMax', String(filters.priceMax))
  if (filters?.bedroomsMin && filters.bedroomsMin > 0) params.set('bedroomsMin', String(filters.bedroomsMin))
  if (filters?.bathroomsMin && filters.bathroomsMin > 0) params.set('bathroomsMin', String(filters.bathroomsMin))
  if (filters?.city) params.set('city', filters.city)
  if (filters?.sort && filters.sort !== 'newest') params.set('sort', filters.sort)
  if (filters?.priceBand && filters.priceBand !== 'any') params.set('priceBand', filters.priceBand)
  if (cursor) params.set('cursor', cursor)
  // Real customer journeys must show real inventory only. A legitimate zero-result search returns an
  // empty list (callers render a genuine localized no-results state) — never substitute mock/demo
  // fixtures. API/network errors propagate to the caller's try/catch, which shows the error state.
  const response = await apiRequest<{ ok: true; listings: PlatformListing[]; nextCursor: string | null }>(
    `/api/listings?${params.toString()}`,
  )
  return { listings: response.listings, nextCursor: response.nextCursor }
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
    }>(`/api/listings/${listingId}/availability?${params.toString()}`)
  } catch {
    return { ok: true as const, blockedDates: [], priceOverrides: [], bookedRanges: [] }
  }
}

export async function fetchListingQuote(listingId: string, checkIn: string, checkOut: string) {
  const params = new URLSearchParams({ checkIn, checkOut })
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

export type PlatformMessage = {
  id: string
  threadId: string
  senderUserId: string
  senderRole: 'GUEST' | 'HOST' | 'ADMIN' | 'SUPPORT' | 'DRIVER' | 'RIDER'
  body: string
  createdAt: string
  sender?: { id: string; displayName: string }
}

export type PlatformMessageThread = {
  id: string
  bookingId?: string
  rideId?: string
  messages: PlatformMessage[]
  hasMore: boolean
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

export async function fetchBookingThread(bookingId: string, preferStaff = false, before?: string) {
  const session = resolveViewerSession(preferStaff)
  const query = before ? `?before=${encodeURIComponent(before)}` : ''
  const response = await apiRequest<{ ok: true; thread: PlatformMessageThread }>(`/api/bookings/${bookingId}/thread${query}`, {
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
  hasMore: boolean
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
export async function fetchListingInquiryThread(listingId: string, before?: string) {
  const session = await ensurePrototypeGuestSession()
  const query = before ? `?before=${encodeURIComponent(before)}` : ''
  const response = await apiRequest<{ ok: true; thread: PlatformListingInquiryThread }>(`/api/listings/${listingId}/thread${query}`, {
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

export type PlatformMyInquiryThread = {
  id: string
  listingId: string | null
  updatedAt: string
  listing: { id: string; titleAr: string; titleEn: string | null; division: string; priceMinor: number; currency: string } | null
  messages: PlatformMessage[]
}

// Guest-side inbox: every real inquiry thread the guest has started across any listing (Rentals/Buy/
// Cars/Marketplace/New-Construction) — mirrors fetchHostInquiries. Without this, a guest who sends a
// listing inquiry has no way to ever see the host's reply.
export async function fetchMyInquiries() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; threads: PlatformMyInquiryThread[] }>('/api/me/inquiries', {
    token: session.token,
  })
  return response.threads
}

// Owner-side inbox: every real inquiry thread across the owner's own listings.
export async function fetchHostInquiries(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; threads: PlatformHostInquiryThread[] }>('/api/host/inquiries', {
    token: session.token,
  })
  return response.threads
}

export async function fetchListingInquiryThreadAsOwner(
  listingId: string,
  guestId: string,
  mode: HostDashboardMode = 'host',
  before?: string,
) {
  const session = await getHostDashboardSession(mode)
  const params = new URLSearchParams({ guestId })
  if (before) params.set('before', before)
  const response = await apiRequest<{ ok: true; thread: PlatformListingInquiryThread }>(
    `/api/listings/${listingId}/thread?${params.toString()}`,
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

// Real customer journeys must show real inventory only — never substitute a fabricated fixture
// listing (fake title/price/photos/owner) on an API error. A guest reaching this page is normally
// about to send a real booking request; letting them do that against fake data is worse than
// showing the real error. See fetchApprovedListings for the same rule on the list view.
export async function fetchPrototypeListing(listingId: string) {
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/listings/${listingId}`)
  return response.listing
}

export async function submitPrototypeLocalWalletProof(input: {
  bookingId?: string
  rideId?: string
  amountMinor: number
  currency: string
  proofAssetUrl?: string
  proofAssetUrls?: string[]
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
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; queue: PlatformReviewQueue; queueTotals: PlatformReviewQueueTotals }>('/api/admin/review-queue', {
    token,
  }))
  // queueTotals is attached alongside the existing per-category arrays (not a breaking change to
  // this function's return shape) -- every existing caller (OperationsCalendarPage, GiftAdminAudit,
  // FinanceReconciliationPage) keeps working unchanged; only AdminReviewPage reads the new field.
  return { ...response.queue, queueTotals: response.queueTotals }
}

export async function fetchPrototypeAdminAuditLog(
  limit = 50,
  filters?: { entityType?: string; action?: string },
) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (filters?.entityType) params.set('entityType', filters.entityType)
  if (filters?.action) params.set('action', filters.action)
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

// Resolve a stored `payment-proof://<key>` reference to a short-lived signed URL admin can actually
// open/view. Previously admin only ever checked truthiness of proofAssetUrl — there was no way to
// see the real file even after real uploads were wired in.
export async function fetchAdminPaymentProofUrl(proofAssetUrl: string) {
  const key = proofAssetUrl.replace(/^payment-proof:\/\//, '')
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; url: string }>(`/api/admin/payment-proof/${encodeURIComponent(key)}/url`, { token }),
  )
  return response.url
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
  distanceKm: number
  estimated: boolean
  pickupCoords: { lat: number; lng: number } | null
  dropoffCoords: { lat: number; lng: number } | null
}

export async function fetchSrQuote(input: {
  pickup: string
  dropoff: string
  category: string
  lowDataMode: boolean
  pickupCoords?: { lat: number; lng: number }
  stops?: string[]
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
  routeType?: string
  features?: string[]
  scheduledFor?: string
  accessibilityRequired?: boolean
  stops?: string[]
  promoCode?: string
  billToBusinessAccount?: boolean
  shareable?: boolean
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
      scheduledFor: input.scheduledFor,
      accessibilityRequired: input.accessibilityRequired,
      stops: input.stops,
      promoCode: input.promoCode,
      billToBusinessAccount: input.billToBusinessAccount,
      shareable: input.shareable,
      metadata: {
        accuracyMeters: input.accuracyMeters,
        locationSource: input.accuracyMeters ? 'gps' : 'manual',
        // Recorded as the rider's stated preference, not an enforced match -- no driver-matching
        // logic reads these yet. Real, not decorative: previously selected but silently discarded.
        requestedRouteType: input.routeType,
        requestedFeatures: input.features,
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

export async function cancelPrototypeSrRide(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(`/api/sr/rides/${rideId}/cancel`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.ride
}

export async function submitPrototypeSrRideReview(input: { rideId: string; rating: number; comment?: string }) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; review: PlatformRideReview }>(`/api/sr/rides/${input.rideId}/review`, {
    method: 'POST',
    token: session.token,
    body: { rating: input.rating, comment: input.comment },
  })
  return response.review
}

export async function fetchPrototypeSrRideThread(rideId: string, asDriver = false, before?: string) {
  const session = asDriver ? await ensurePrototypeDriverSession() : await ensurePrototypeGuestSession()
  const query = before ? `?before=${encodeURIComponent(before)}` : ''
  const response = await apiRequest<{ ok: true; thread: PlatformMessageThread }>(`/api/sr/rides/${rideId}/thread${query}`, {
    token: session.token,
  })
  return response.thread
}

export async function sendPrototypeSrRideMessage(rideId: string, body: string, asDriver = false) {
  const session = asDriver ? await ensurePrototypeDriverSession() : await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; message: PlatformMessage }>(`/api/sr/rides/${rideId}/thread/messages`, {
    method: 'POST',
    token: session.token,
    body: { body },
  })
  return response.message
}

export async function sharePrototypeSrRide(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; rideId: string; exp: number; sig: string }>(`/api/sr/rides/${rideId}/share`, {
    method: 'POST',
    token: session.token,
  })
  return response
}

export type PlatformSharedRide = {
  status: string
  pickupCoords: { lat: number; lng: number } | null
  dropoffCoords: { lat: number; lng: number } | null
  driver: {
    displayName: string
    isVerified: boolean
    driverProfile: { vehicleMake: string | null; vehicleModel: string | null; vehiclePlate: string | null; photoUrl: string | null } | null
    location: { lat: number; lng: number; updatedAt: string } | null
  } | null
}

// Public -- no session, verified purely by the signed exp/sig pair (server/lib/ride-share.mjs).
export async function fetchSharedSrRide(rideId: string, exp: string, sig: string) {
  const response = await apiRequest<{ ok: true; ride: PlatformSharedRide }>(
    `/api/sr/rides/${rideId}/shared?exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`,
  )
  return response.ride
}

export type PlatformSavedPlace = {
  id: string
  userId: string
  label: string
  address: string
  lat: number | null
  lng: number | null
  createdAt: string
}

export async function fetchSavedPlaces() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; places: PlatformSavedPlace[] }>('/api/me/saved-places', {
    token: session.token,
  })
  return response.places
}

export async function createSavedPlace(input: { label: string; address: string; lat?: number; lng?: number }) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; place: PlatformSavedPlace }>('/api/me/saved-places', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.place
}

export async function deleteSavedPlace(placeId: string) {
  const session = await ensurePrototypeGuestSession()
  await apiRequest<{ ok: true }>(`/api/me/saved-places/${placeId}`, {
    method: 'DELETE',
    token: session.token,
  })
}

export type PlatformPromoCode = {
  id: string
  code: string
  discountType: 'PERCENT' | 'FLAT'
  discountValue: number
  maxDiscountMinor: number | null
  active: boolean
  expiresAt: string | null
  createdAt: string
}

export async function fetchPromoCodes() {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; promoCodes: PlatformPromoCode[] }>('/api/admin/sr/promo-codes', {
    token: session.token,
  })
  return response.promoCodes
}

export async function createPromoCode(input: {
  code: string
  discountType: 'PERCENT' | 'FLAT'
  discountValue: number
  maxDiscountMinor?: number
  expiresAt?: string
}) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; promoCode: PlatformPromoCode }>('/api/admin/sr/promo-codes', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.promoCode
}

export async function setPromoCodeActive(promoCodeId: string, active: boolean) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; promoCode: PlatformPromoCode }>(`/api/admin/sr/promo-codes/${promoCodeId}`, {
    method: 'PATCH',
    token: session.token,
    body: { active },
  })
  return response.promoCode
}

// SR Ride vs. Uber gap-closure: business/corporate accounts.
export type PlatformBusinessAccount = {
  id: string
  name: string
  billingContactEmail: string
  adminUserId: string
  active: boolean
  createdAt: string
  admin?: { id: string; displayName: string; email: string | null }
}

export type PlatformBusinessAccountMember = {
  id: string
  businessAccountId: string
  userId: string
  addedAt: string
  user: { id: string; displayName: string; email: string | null }
}

export async function fetchBusinessAccounts() {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; businessAccounts: PlatformBusinessAccount[] }>('/api/admin/sr/business-accounts', {
    token: session.token,
  })
  return response.businessAccounts
}

export async function createBusinessAccount(input: { name: string; billingContactEmail: string; adminEmail: string }) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; businessAccount: PlatformBusinessAccount }>('/api/admin/sr/business-accounts', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.businessAccount
}

export async function fetchBusinessMembership() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; isMember: boolean; businessAccountName: string | null }>(
    '/api/business/membership',
    { token: session.token },
  )
  return response
}

export async function fetchMyBusinessAccount() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; account: PlatformBusinessAccount; members: PlatformBusinessAccountMember[] }>(
    '/api/business/account',
    { token: session.token },
  )
  return response
}

export async function addBusinessMember(email: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; member: PlatformBusinessAccountMember }>('/api/business/members', {
    method: 'POST',
    token: session.token,
    body: { email },
  })
  return response.member
}

export async function removeBusinessMember(userId: string) {
  const session = await ensurePrototypeGuestSession()
  await apiRequest<{ ok: true }>(`/api/business/members/${userId}`, {
    method: 'DELETE',
    token: session.token,
  })
}

export async function fetchBusinessUsage() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; rides: PlatformRideRequest[]; totalMinor: number }>('/api/business/usage', {
    token: session.token,
  })
  return response
}

// SR Ride vs. Uber gap-closure (P1 #7): standard Web Push -- no third-party push-provider account.
export async function fetchPushConfig() {
  const response = await apiRequest<{ ok: true; enabled: boolean; publicKey: string | null }>('/api/push/vapid-public-key')
  return response
}

async function registerPushSubscription(subscription: PushSubscriptionJSON, asDriver: boolean) {
  const session = asDriver ? await ensurePrototypeDriverSession() : await ensurePrototypeGuestSession()
  await apiRequest<{ ok: true; subscriptionId: string }>('/api/push/subscribe', {
    method: 'POST',
    token: session.token,
    body: subscription,
  })
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

// Browser-side flow: register the service worker, request permission, subscribe, then hand the
// subscription to the server. Throws a clear message at whichever step isn't available/granted
// rather than silently no-op'ing, so the UI can show the rider/driver why it didn't work.
export async function enablePushNotifications(asDriver = false) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported on this device.')
  }
  const config = await fetchPushConfig()
  if (!config.enabled || !config.publicKey) {
    throw new Error('Push notifications are not configured on the server yet.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }
  const registration = await navigator.serviceWorker.register('/sw.js')
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }))
  await registerPushSubscription(subscription.toJSON(), asDriver)
}

export async function fetchPrototypeDriverOverview() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; overview: PlatformDriverOverview }>('/api/driver/rides', {
    token: session.token,
  })
  return response.overview
}

export async function submitDriverPhoto(file: File) {
  const session = await ensurePrototypeDriverSession()
  const fileBase64 = await readFileAsBase64(file)
  const response = await apiRequest<{ ok: true; driverProfile: { photoRef: string; photoMimeType: string } }>('/api/driver/photo', {
    method: 'PATCH',
    token: session.token,
    body: { fileBase64, mimeType: file.type },
  })
  return response.driverProfile
}

export async function updatePrototypeDriverAccessibility(accessibilityCapable: boolean) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; driverProfile: { accessibilityCapable: boolean } }>('/api/driver/accessibility', {
    method: 'PATCH',
    token: session.token,
    body: { accessibilityCapable },
  })
  return response.driverProfile
}

export async function reportPrototypeDriverLocation(lat: number, lng: number) {
  const session = await ensurePrototypeDriverSession()
  await apiRequest<{ ok: true }>('/api/driver/location', {
    method: 'PATCH',
    token: session.token,
    body: { lat, lng },
  })
}

// CAPSULE_RULES.noFakeTrustSignal: the driver dashboard's own docs-status panel must reflect the
// same real idDocumentStatus field the host/guest verification badges already use, not a static claim.
export async function fetchDriverIdentityStatus() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; overview: PlatformOverview }>('/api/me/overview', {
    token: session.token,
  })
  return response.overview.user.idDocumentStatus ?? null
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
  proofAssetUrls?: string[]
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

// The KYC gate on /api/listings/:id/submit requires idDocumentStatus === 'APPROVED' for every
// division. This is the host/seller-side counterpart to submitGuestIdDocument() — same endpoint,
// same one-document-per-user model, just resolved through the host/seller session instead of the
// guest one so a host actually has a way to satisfy the gate.
export async function submitHostIdDocument(file: File, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
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

export async function deletePrototypeHostListing(listingId: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; deleted: string }>(
    `/api/host/listings/${listingId}`,
    {
      method: 'DELETE',
      token: session.token,
    },
  )
  return response.deleted
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
  // The 6-digit claim code is never delivered by SMS/email (Syria is email-only and this model has
  // no recipient email) — the server now returns it here so the sender can share it with the
  // recipient directly, same as any gift-card PIN.
  const response = await apiRequest<{ ok: true; gift: PlatformWalletGift; claimCode: string }>('/api/wallet/gifts', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return { gift: response.gift, claimCode: response.claimCode }
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
  const response = await apiRequest<{ ok: true; wallet: PlatformWallet | null }>('/api/wallet', {
    token: session.token,
  })
  return response.wallet
}

// Record the seller/host's acceptance of the platform listing agreement (required, alongside a
// verified ID, before /api/listings/:id/submit will publish a listing — see server/lib/legal.mjs).
export async function acceptListingAgreement() {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const manifest = await apiRequest<{ ok: true; documents: Array<{ key: string; version: string }> }>('/api/legal')
  const doc = manifest.documents.find((d) => d.key === 'listing-agreement')
  if (!doc) throw new Error('Listing agreement is not available.')
  return apiRequest<{ ok: true; consent: unknown }>('/api/legal/consent', {
    method: 'POST',
    token: session.token,
    body: { documentKey: 'listing-agreement', version: doc.version },
  })
}

async function ensurePrototypeHostSession() {
  const stored = getStoredStaffSession('HOST') || getStoredStaffSession('SELLER')
  if (stored) return stored

  throw new Error('Host staff session required')
}

async function ensurePrototypeGuestSession() {
  const guestSession = getStoredGuestSession()
  if (guestSession) return guestSession

  // No shared fallback account. Customer actions are gated behind real account creation (email OTP),
  // so reaching here means the caller is not signed in — surface a clear 'sign in required' error
  // instead of silently transacting under a shared demo identity (and no credentials in the bundle).
  const error = new Error('Please create an account or sign in to continue.') as Error & { code?: string }
  error.code = 'GUEST_SESSION_REQUIRED'
  throw error
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

// Non-sensitive display defaults only. The real email/password always come from the staff sign-in
// form (see the account assembly), so no credentials are embedded in the shipped bundle.
function staffPrototypeAccount(role: 'ADMIN' | 'HOST' | 'DRIVER') {
  if (role === 'ADMIN') return { displayName: 'SYBNB Admin', role: 'ADMIN' as const, phone: '' }
  if (role === 'DRIVER') return { displayName: 'SYBNB Driver', role: 'DRIVER' as const, phone: '' }
  return { displayName: 'SYBNB Host', role: 'HOST' as const, phone: '' }
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
  } catch (error) {
    if (!isAccountExistsError(error)) throw error
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
}) {
  return apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body,
  })
}

// Server-authoritative OTP. The browser never generates or trusts the code — it asks the backend to
// send it (by email; phone optional) and to verify it. The plaintext code is not returned in production.
export type OtpPurpose = 'guest-login' | 'staff-login' | 'seller-login' | 'host-login' | 'account-verify' | 'payment-proof' | 'wallet-claim'

export async function requestOtp(input: { email?: string; phone?: string; purpose: OtpPurpose; channel?: 'email' | 'sms' | 'whatsapp' }) {
  return apiRequest<{ ok: true; sent: boolean; channel: string; masked: string; maskedEmail?: string; maskedPhone?: string; expiresAt: string; provider: string; devCode?: string }>(
    '/api/otp/send',
    { method: 'POST', body: input },
  )
}

export async function confirmOtp(input: { email?: string; phone?: string; purpose: OtpPurpose; code: string }): Promise<boolean> {
  const response = await apiRequest<{ ok: true; verified: boolean }>('/api/otp/verify', { method: 'POST', body: input })
  return response.verified === true
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
    // SEC-002: a 401 on a token-bearing request means the server has revoked or expired that
    // credential. Drop the dead local copy so the UI stops presenting a session that is gone.
    if (response.status === 401 && options.token) purgeLocalSessionsForToken(options.token)
    const message = isApiErrorBody(payload) ? payload.error?.message : undefined
    const code = isApiErrorBody(payload) ? payload.error?.code : undefined
    const error = new Error(message || `SYBNB API request failed: ${response.status}`) as Error & { status?: number; code?: string }
    error.status = response.status
    if (code) error.code = code
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

// A register() call should only fall back to login() when the account already exists (409 /
// ACCOUNT_ALREADY_EXISTS). For any other failure -- most importantly REGISTRATION_OTP_REQUIRED
// (403, an expired/consumed verification code) -- falling back to login hides the real, actionable
// error behind a misleading "Invalid login credentials." So: rethrow everything else.
function isAccountExistsError(error: unknown) {
  const e = error as { status?: number; code?: string } | null
  return Boolean(e && typeof e === 'object' && (e.code === 'ACCOUNT_ALREADY_EXISTS' || e.status === 409))
}
