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
  // Admin review queue only (2026-10-09): the advisory AI pre-check.
  aiReview?: ListingAiReview | null
}

export type AiReviewCheckKey =
  | 'photosRealAndClear'
  | 'photosMatchListing'
  | 'noContactInfoInPhotosOrText'
  | 'addressConsistent'
  | 'locationMatchesAddress'
  | 'priceReasonable'
  | 'textQuality'

export type ListingAiReview = {
  status: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED'
  model: string | null
  at: string | null
  reason?: string
  error?: string
  result?: {
    score: number
    recommendation: 'APPROVE' | 'NEEDS_FIXES' | 'REJECT'
    checks: Record<AiReviewCheckKey, { ok: boolean; note: string }>
    issuesForHost: string[]
    summaryForAdmin: string
  } | null
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
  // Dispatch/ETA fields (2026-10-09), present on the single-ride GET and driver pending list.
  etaToPickupMinutes?: number | null
  matchTimedOut?: boolean
  pickupDistanceKm?: number | null
  // Full auto-dispatch (2026-10-10): the live outstanding offer, surfaced on the driver pending list.
  offeredDriverId?: string | null
  offerExpiresAt?: string | null
  offeredToYou?: boolean
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
  // PAYMENT_PENDING bookings expire 48h after creation (createdAt + 48h) when unpaid.
  expiresAt?: string | null
  // e.g. 'EXPIRED_UNPAID' when the 48h unpaid sweep cancelled the booking (if exposed).
  cancellationReason?: string | null
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

// Customer / Host 360 overview — a single account's full footprint for the admin.
// Read-only aggregate assembled server-side; see GET /api/admin/users/:id/overview.
export type PlatformAdminOverviewListing = {
  id: string
  titleAr: string
  titleEn: string | null
  division: string
  status: string
  priceMinor: number
  currency: string
  createdAt: string
}
export type PlatformAdminOverviewBooking = {
  id: string
  listingId: string
  guestId?: string
  status: string
  checkIn: string | null
  checkOut: string | null
  amountMinor: number
  currency: string
  createdAt: string
  listing: { titleAr: string; titleEn: string | null } | null
}
export type PlatformAdminOverviewPayment = {
  id: string
  bookingId: string | null
  provider: string
  status: string
  amountMinor: number
  currency: string
  createdAt: string
}
export type PlatformAdminOverviewPayout = {
  id: string
  amountMinor: number
  currency: string
  status: string
  createdAt: string
  decidedAt: string | null
}
export type PlatformAdminOverviewWalletEntry = {
  id: string
  type: string
  amountMinor: number
  currency: string
  referenceType: string
  referenceId: string
  note: string | null
  createdAt: string
}
export type PlatformAdminOverviewWallet = {
  id: string
  currency: string
  cachedBalanceMinor: number
  entries: PlatformAdminOverviewWalletEntry[]
}
export type PlatformAdminOverviewGift = {
  id: string
  amountMinor: number
  currency: string
  status: string
  createdAt: string
}
export type PlatformAdminOverviewAudit = {
  id: string
  action: string
  entityType: string
  entityId: string
  createdAt: string
}
export type PlatformAdminUserOverview = {
  user: {
    id: string
    displayName: string
    email: string | null
    status: string
    locale: string
    createdAt: string
    hostVerifiedAt: string | null
    idDocumentStatus: string | null
    roles: string[]
  }
  listings: PlatformAdminOverviewListing[]
  bookingsAsGuest: PlatformAdminOverviewBooking[]
  bookingsAsHost: PlatformAdminOverviewBooking[]
  payments: PlatformAdminOverviewPayment[]
  payouts: PlatformAdminOverviewPayout[]
  wallets: PlatformAdminOverviewWallet[]
  giftsSent: PlatformAdminOverviewGift[]
  giftsReceived: PlatformAdminOverviewGift[]
  audit: PlatformAdminOverviewAudit[]
  totals: {
    lifetimeSpentMinor: number
    lifetimePayoutMinor: number
    walletBalanceMinor: number
    listingsCount: number
    guestBookingsCount: number
    hostBookingsCount: number
  }
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
  driver: ApiUser & {
    accessibilityCapable: boolean
    vehicleMake?: string | null
    vehicleModel?: string | null
    vehiclePlate?: string | null
    vehicleStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null
    vehicleCategory?: 'BIKE' | 'ECONOMY' | 'COMFORT' | 'SUV' | 'VAN' | null
    vehicleYear?: number | null
    vehicleColor?: string | null
    registrationExpiresAt?: string | null
    inspectionStatus?: 'PENDING' | 'PASSED' | 'FAILED' | 'EXPIRED' | null
    inspectionExpiresAt?: string | null
  }
  totals: {
    assigned: number
    active: number
    completed: number
    earningsMinor: number
    billedMinor?: number
    awaitingMinor?: number
    commissionRate?: number
    currency?: string
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

export { authStorage } from './authStorage'
import { authStorage } from './authStorage'
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
  authStorage.setItem(SELLER_SESSION_KEY, JSON.stringify(storedSession))
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

  authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  mirrorHostAccess(session)
  return session
}

// Sign an EXISTING account in with email + password only (no OTP — the server's /api/auth/login
// never required one). Stores the session exactly like createGuestAccountSession does.
export async function signInGuestAccount(email: string, password: string) {
  const session = await login(email.trim(), password)
  authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  mirrorHostAccess(session)
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
    const raw = authStorage.getItem(GUEST_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PlatformAuthSession
    if (!session?.token || !session?.user) return null
    return session
  } catch {
    return null
  }
}

export function clearGuestSession() {
  authStorage.removeItem(GUEST_SESSION_KEY)
  authStorage.removeItem(GUEST_SESSION_TOKEN_KEY)
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

// One account for guest and host (Airbnb-style). The host area is gated on the "staff" session slot,
// so when the signed-in customer's account carries HOST (or SELLER), the same session is mirrored
// into that slot -- no second login, no second account. Never overwrites a DIFFERENT user's staff
// session (e.g. an admin signed in on this browser).
function mirrorHostAccess(session: PlatformAuthSession) {
  const roles = session?.user?.roles || []
  if (!session?.token || !(roles.includes('HOST') || roles.includes('SELLER'))) return
  const existing = getStoredStaffSession()
  if (existing && existing.user?.id !== session.user?.id) return
  authStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(STAFF_SESSION_TOKEN_KEY, session.token)
}

export function currentAccountIsHost() {
  const roles = getStoredGuestSession()?.user?.roles || []
  return roles.includes('HOST') || roles.includes('SELLER')
}

// "Become a host": adds HOST to the signed-in account (POST /api/me/become-host), then refreshes
// the stored session's roles so the host area opens immediately with the same sign-in.
export async function becomeHost() {
  const session = getStoredGuestSession()
  if (!session?.token) throw new Error('Sign in first.')
  const result = await apiRequest<{ ok: true; roles: string[] }>('/api/me/become-host', {
    method: 'POST',
    token: session.token,
    body: {},
  })
  const updated = { ...session, user: { ...session.user, roles: result.roles } } as PlatformAuthSession
  authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(updated))
  mirrorHostAccess(updated)
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return updated
}

// ---- Stale-role refresh ------------------------------------------------------------------------
// The browser keeps a copy of the signed-in user (incl. roles) in its stored session. A role granted
// WITHOUT revoking the session (become-host on another device, seller-plan approval) left that copy
// stale until the next sign-in, so the menu kept hiding "Switch to hosting"/"Admin panel". GET
// /api/me reads the roles live; this refreshes every stored session from it. Called on app load and
// whenever the account menu opens. A revoked session answers 401 and apiRequest() already drops it.
export type MeResponse = { ok: true; user: ApiUser & { locale?: string; status?: string; hostVerifiedAt?: string | null; idDocumentStatus?: IdDocumentStatus } }

let lastRoleRefreshAt = 0
let roleRefreshInFlight: Promise<boolean> | null = null

function sameRoles(a: string[] = [], b: string[] = []) {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')
}

export async function refreshStoredSessionRoles(options: { minIntervalMs?: number } = {}): Promise<boolean> {
  const minIntervalMs = options.minIntervalMs ?? 10_000
  if (roleRefreshInFlight) return roleRefreshInFlight
  if (Date.now() - lastRoleRefreshAt < minIntervalMs) return false
  lastRoleRefreshAt = Date.now()
  roleRefreshInFlight = (async () => {
    let changed = false
    const guest = getStoredGuestSession()
    const staff = getStoredStaffSession()
    const fetchUser = async (token: string) => {
      try {
        return (await apiRequest<MeResponse>('/api/me', { token })).user
      } catch {
        return null // offline / revoked (a 401 already purged that token) -- keep what we have
      }
    }
    const guestUser = guest?.token ? await fetchUser(guest.token) : null
    if (guest && guestUser && guestUser.id === guest.user.id) {
      if (!sameRoles(guest.user.roles, guestUser.roles) || guest.user.displayName !== guestUser.displayName) {
        const updated = { ...guest, user: { ...guest.user, roles: guestUser.roles, displayName: guestUser.displayName } } as PlatformAuthSession
        authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(updated))
        changed = true
      }
    }
    // The staff slot: same token as the guest session -> same answer; otherwise ask with its own token
    // (e.g. an admin signed in on this browser through the admin portal).
    const currentStaff = getStoredStaffSession()
    if (currentStaff?.token && staff?.token === currentStaff.token) {
      const staffUser = currentStaff.token === guest?.token ? guestUser : await fetchUser(currentStaff.token)
      const stillStored = getStoredStaffSession()
      if (staffUser && stillStored?.token === currentStaff.token && staffUser.id === stillStored.user.id && !sameRoles(stillStored.user.roles, staffUser.roles)) {
        const roles = staffUser.roles
        if (stillStored.token === guest?.token && !(roles.includes('HOST') || roles.includes('SELLER'))) {
          // The mirrored host slot no longer has a host role: drop the mirror (the guest session stays).
          clearStoredStaffSession()
        } else {
          authStorage.setItem(STAFF_SESSION_KEY, JSON.stringify({ ...stillStored, user: { ...stillStored.user, roles } }))
        }
        changed = true
      }
    }
    // Same rule as sign-in: a guest account that now carries HOST/SELLER opens the host area with
    // the same session (never overwriting a different user's staff session).
    const refreshedGuest = getStoredGuestSession()
    if (refreshedGuest) {
      const before = authStorage.getItem(STAFF_SESSION_KEY)
      mirrorHostAccess(refreshedGuest)
      if (authStorage.getItem(STAFF_SESSION_KEY) !== before) changed = true
    }
    if (changed) window.dispatchEvent(new Event('sybnb-session-changed'))
    return changed
  })()
  try {
    return await roleRefreshInFlight
  } finally {
    roleRefreshInFlight = null
  }
}

// ---- Host verification (activation code, owner decision 2026-10-08) -----------------------------
export type HostOnboardingFeedback = {
  listingId: string
  titleAr: string
  titleEn: string | null
  description: string | null
  priceMinor: number
  currency: string
  note: string | null
  issues: string[]
  at: string
}

// Onboarding tracker (owner decision 2026-10-09): ① listing ② review (AI + team) ③ code by email ④ live.
export type HostOnboarding = {
  step: 1 | 2 | 3 | 4
  needsFixes: boolean
  codeExpectedSoon: boolean
  counts: { total: number; draft: number; pending: number; approved: number; rejected: number }
  feedback: HostOnboardingFeedback[]
}

export type HostVerificationStatus = {
  verified: boolean
  verifiedAt: string | null
  hasPendingCode: boolean
  codeExpiresAt: string | null
  codeLocked: boolean
  attemptsRemaining: number
  onboarding?: HostOnboarding
}

export async function fetchHostVerification(): Promise<HostVerificationStatus> {
  const result = await apiRequest<{ ok: true } & HostVerificationStatus>('/api/host/verification', { token: hostToken() })
  return {
    verified: result.verified,
    verifiedAt: result.verifiedAt,
    hasPendingCode: result.hasPendingCode,
    codeExpiresAt: result.codeExpiresAt,
    codeLocked: result.codeLocked,
    attemptsRemaining: result.attemptsRemaining,
    onboarding: result.onboarding,
  }
}

export async function activateHostAccount(code: string) {
  return apiRequest<{ ok: true; verifiedAt: string; alreadyVerified?: boolean }>('/api/host/activate', {
    method: 'POST',
    token: hostToken(),
    body: { code },
  })
}

export type AdminHostCodeState = 'ACTIVE' | 'EXPIRED' | 'LOCKED' | 'USED' | 'NONE'
export type AdminHost = {
  id: string
  displayName: string
  email: string | null
  status: string
  createdAt: string
  verifiedAt: string | null
  verifiedBy: { id: string; displayName: string } | null
  listingsCount: number
  latestCode: { issuedAt: string; expiresAt: string; used: boolean; usedAt: string | null; attempts: number; state: AdminHostCodeState } | null
}
export type AdminHostFilter = 'unverified' | 'verified' | 'all'

export async function fetchAdminHosts(status: AdminHostFilter = 'unverified', q = '') {
  const params = new URLSearchParams({ status })
  if (q.trim()) params.set('q', q.trim())
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; hosts: AdminHost[] }>(`/api/admin/hosts?${params.toString()}`, { token }),
  )
  return response.hosts || []
}

export type IssuedHostActivationCode = { code: string; codeId: string; issuedAt: string; expiresAt: string; maxAttempts: number; emailQueued: boolean }

export async function issueHostActivationCode(userId: string, sendEmail: boolean) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true } & IssuedHostActivationCode>(`/api/admin/hosts/${encodeURIComponent(userId)}/activation-code`, {
      method: 'POST',
      token,
      body: { sendEmail },
    }),
  )
  return {
    code: response.code,
    codeId: response.codeId,
    issuedAt: response.issuedAt,
    expiresAt: response.expiresAt,
    maxAttempts: response.maxAttempts,
    emailQueued: response.emailQueued,
  } satisfies IssuedHostActivationCode
}

// Forgot password: after the 'password-reset' email code is verified, set the new password. The server
// signs the account out on every device; the caller then signs in with the new password.
export async function resetPassword(email: string, newPassword: string) {
  await apiRequest<{ ok: true }>('/api/auth/password-reset', {
    method: 'POST',
    body: { email: email.trim(), newPassword },
  })
}

// ---- Host profile (Airbnb-style): photo, about, languages, city --------------------------------
export type HostProfile = {
  displayName: string | null
  about: string | null
  city: string | null
  languages: string[]
  photoUrl: string | null
  memberSince: number | null
  complete: boolean
}

function hostToken() {
  const token = getStoredStaffSession('HOST')?.token || getStoredStaffSession('SELLER')?.token || getStoredGuestSession()?.token
  if (!token) throw new Error('Sign in first.')
  return token
}

export async function fetchMyHostProfile() {
  const result = await apiRequest<{ ok: true; profile: HostProfile }>('/api/host/profile', { token: hostToken() })
  return result.profile
}

export async function saveHostProfile(input: { about: string; city: string; languages: string[] }) {
  const result = await apiRequest<{ ok: true; profile: HostProfile }>('/api/host/profile', {
    method: 'PUT',
    token: hostToken(),
    body: input,
  })
  return result.profile
}

export async function uploadHostPhoto(file: File) {
  const fileBase64 = await readFileAsBase64(file)
  const result = await apiRequest<{ ok: true; profile: HostProfile }>('/api/host/profile/photo', {
    method: 'PATCH',
    token: hostToken(),
    body: { fileBase64, mimeType: file.type },
  })
  return result.profile
}

export async function fetchPublicHostProfile(userId: string) {
  const result = await apiRequest<{ ok: true; profile: HostProfile }>(`/api/host-profiles/${encodeURIComponent(userId)}`)
  return result.profile
}

export async function signOutGuest(): Promise<{ serverRevoked: boolean }> {
  const session = getStoredGuestSession()
  const serverRevoked = await revokeSessionOnServer(session?.token)
  // The local copy is dropped either way: leaving a token the user asked to discard sitting in
  // sessionStorage would be worse than a stale server-side row. The return value is what tells the
  // UI whether it may claim the session was actually revoked.
  clearGuestSession()
  if (session?.token && getStoredStaffSession()?.token === session.token) clearStoredStaffSession()
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
  authStorage.clearAll()
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
  authStorage.clearAll()
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
      const raw = authStorage.getItem(sessionKey)
      const stored = raw ? (JSON.parse(raw) as { token?: string })?.token : undefined
      if (stored !== token) return
      authStorage.removeItem(sessionKey)
      if (tokenKey) authStorage.removeItem(tokenKey)
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
    const raw = authStorage.getItem(STAFF_SESSION_KEY)
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
  // ADMIN is never self-registered and (owner decision 2026-10-08) needs a fresh 'admin-login'
  // email code verified just before this call -- so a failed admin login must surface its real
  // error (e.g. ADMIN_LOGIN_CODE_REQUIRED), never fall through to a register() that cannot succeed.
  const session =
    role === 'ADMIN'
      ? await login(account.email, account.password)
      : input?.mode === 'signUp'
        ? await createStaffAccount(account)
        : await ensurePrototypeSession(account)
  authStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(STAFF_SESSION_TOKEN_KEY, session.token)
  return session
}

export function clearStoredStaffSession() {
  authStorage.removeItem(STAFF_SESSION_KEY)
  authStorage.removeItem(STAFF_SESSION_TOKEN_KEY)
}

export function getStoredSellerSession(): PlatformAuthSession | null {
  try {
    const raw = authStorage.getItem(SELLER_SESSION_KEY)
    if (raw) {
      const session = JSON.parse(raw) as PlatformAuthSession
      if (session?.token && session?.user) return session
    }
  } catch {
    /* fall through */
  }
  // One account for everything: a signed-in guest account that has HOST or SELLER is also the
  // seller/host identity (the listing wizard, uploads and seller pages use it directly). Without this
  // fallback a host who signed in normally was told "sign in first" inside the listing form.
  const hostRoles = (session: PlatformAuthSession | null) => {
    const roles = session?.user?.roles || []
    return Boolean(session?.token && (roles.includes('HOST') || roles.includes('SELLER')))
  }
  const guest = getStoredGuestSession()
  if (hostRoles(guest)) return guest
  const staff = getStoredStaffSession()
  if (hostRoles(staff)) return staff
  return null
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
  adminCommissionMinor: number
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
  // Listings sent back for fixes (2026-10-09): include the AI's issues for the host (default true).
  extra?: { includeAiIssues?: boolean; hostIssues?: string[] },
) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; entity: unknown }>(
    `/api/admin/review-queue/${entityType}/${entityId}`,
    {
      method: 'PATCH',
      token,
      body: { decision, adminNote, ...(extra || {}) },
    },
  ))
  return response.entity
}

// Re-run the advisory AI pre-check of a listing (ADMIN). Runs in the background (202 PENDING).
export async function rerunListingAiReview(listingId: string) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; aiReview: ListingAiReview }>(`/api/admin/listings/${listingId}/ai-review`, { method: 'POST', token }),
  )
  return response.aiReview
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

// --- Profile + loyalty -------------------------------------------------------------------------
export type LoyaltyTierName = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'
export type LoyaltySummaryData = {
  pointsBalance: number
  lifetimePoints: number
  tier: LoyaltyTierName
  multiplier: number
  nextTier: { tier: LoyaltyTierName; pointsToGo: number } | null
  redeemableMinor: number
  config: {
    tiers: { tier: LoyaltyTierName; min: number; multiplier: number }[]
    redeem: { pointsPerUnit: number; minorPerUnit: number; currency: string; minPoints: number; stepPoints: number }
    earn: { divisor: Record<string, number> }
  }
  recent: { id: string; type: string; points: number; reason: string | null; createdAt: string }[]
}
export type MyProfileData = {
  id: string
  email: string | null
  displayName: string
  hasAvatar: boolean
  locale: string
  memberSince: string
  isVerifiedHost: boolean
}

// Profile/loyalty endpoints accept any signed-in account; use whichever session token is present.
function anyUserToken(): string | null {
  return (
    getStoredGuestSession()?.token ||
    getStoredStaffSession('HOST')?.token ||
    getStoredStaffSession('SELLER')?.token ||
    getStoredStaffSession('ADMIN')?.token ||
    null
  )
}

export async function fetchMyProfile() {
  const token = anyUserToken()
  if (!token) throw new Error('Not signed in')
  const r = await apiRequest<{ ok: true; profile: MyProfileData; loyalty: LoyaltySummaryData }>('/api/me/profile', { token })
  return { profile: r.profile, loyalty: r.loyalty }
}

export async function updateMyDisplayName(displayName: string) {
  const token = anyUserToken()
  if (!token) throw new Error('Not signed in')
  await apiRequest<{ ok: true }>('/api/me/profile', { method: 'PATCH', token, body: { displayName } })
}

export async function uploadMyAvatar(file: File) {
  const token = anyUserToken()
  if (!token) throw new Error('Not signed in')
  const fileBase64 = await readFileAsBase64(file)
  await apiRequest<{ ok: true }>('/api/me/avatar', { method: 'PATCH', token, body: { fileBase64, mimeType: file.type } })
}

export async function fetchMyAvatarBlobUrl() {
  const token = anyUserToken()
  if (!token) throw new Error('Not signed in')
  const response = await fetch(`${API_BASE_URL}/api/me/avatar/file`, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error('no avatar')
  return URL.createObjectURL(await response.blob())
}

export async function fetchMyLoyalty() {
  const token = anyUserToken()
  if (!token) throw new Error('Not signed in')
  const r = await apiRequest<{ ok: true; loyalty: LoyaltySummaryData }>('/api/me/loyalty', { token })
  return r.loyalty
}

export async function redeemLoyaltyPoints(points: number) {
  const token = anyUserToken()
  if (!token) throw new Error('Not signed in')
  return apiRequest<{ ok: true; redeemed: { points: number; creditMinor: number; currency: string }; loyalty: LoyaltySummaryData }>(
    '/api/me/loyalty/redeem',
    { method: 'POST', token, body: { points } },
  )
}

export type AdminLoyaltyAiResult = {
  ok: true
  configured: boolean
  aiFailed?: boolean
  error?: string
  model?: string
  decision?: { action: string; bonusPoints: number; suggestTier: string | null; confidence: string; flags: string[]; summary: string }
  applied?: { awarded: number; action: string; flags: string[]; summary: string; capPerReview: number; capPerDay: number }
  loyalty?: LoyaltySummaryData
}
export async function adminAiLoyaltyReview(userId: string) {
  return runAdminRequest((token) =>
    apiRequest<AdminLoyaltyAiResult>('/api/admin/loyalty/ai-review', { method: 'POST', token, body: { userId } }),
  )
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
// Look up a customer by email, phone, or display name (the server tries each in that order).
export async function lookupAdminUser(query: string) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; user: PlatformIdDocumentReview }>(
    `/api/admin/users/lookup?q=${encodeURIComponent(query)}`,
    { token },
  ))
  return response.user
}
/** @deprecated use lookupAdminUser — kept as an alias so existing callers keep working. */
export const lookupAdminUserByEmail = lookupAdminUser

export async function fetchAdminUserOverview(userId: string) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true } & PlatformAdminUserOverview>(
    `/api/admin/users/${encodeURIComponent(userId)}/overview`,
    { token },
  ))
  const { ok: _ok, ...overview } = response
  return overview as PlatformAdminUserOverview
}

export type PlatformLedgerEntry = {
  id: string
  type: string
  amountMinor: number
  currency: string
  referenceType: string
  referenceId: string
  note: string | null
  createdAt: string
  user: { id: string; displayName: string; email: string | null } | null
}
export type PlatformLedgerCurrencySummary = {
  currency: string
  creditMinor: number
  debitMinor: number
  holdMinor: number
  releaseMinor: number
  refundMinor: number
  netMinor: number
}
export type PlatformLedgerResult = {
  entries: PlatformLedgerEntry[]
  summary: PlatformLedgerCurrencySummary & { count: number }
  summariesByCurrency?: PlatformLedgerCurrencySummary[]
  page: { limit: number; offset: number; hasMore: boolean }
}

export async function fetchAdminLedger(params: { limit?: number; offset?: number; type?: string; referenceType?: string; q?: string } = {}) {
  const search = new URLSearchParams()
  if (params.limit != null) search.set('limit', String(params.limit))
  if (params.offset != null) search.set('offset', String(params.offset))
  if (params.type) search.set('type', params.type)
  if (params.referenceType) search.set('referenceType', params.referenceType)
  if (params.q) search.set('q', params.q)
  const qs = search.toString()
  const response = await runAdminRequest((token) => apiRequest<{ ok: true } & PlatformLedgerResult>(
    `/api/admin/ledger${qs ? `?${qs}` : ''}`,
    { token },
  ))
  const { ok: _ok, ...result } = response
  return result as PlatformLedgerResult
}

export type PlatformAiAssistRecommendation = {
  recommendation: 'APPROVE' | 'REJECT' | 'HOLD' | 'NEEDS_INFO'
  confidence: 'low' | 'medium' | 'high'
  summary: string
  reasons: string[]
  nextSteps: string[]
}
export type PlatformAiAssistResult = {
  configured: boolean
  model: string
  ok?: boolean
  error?: string
  recommendation?: PlatformAiAssistRecommendation
}

export async function requestAdminAiAssist(kind: 'payment' | 'dispute', entityId: string) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true } & PlatformAiAssistResult>(
    `/api/admin/ai-assist`,
    { method: 'POST', token, body: { kind, entityId } },
  ))
  const { ok: _ok, ...result } = response
  return result as PlatformAiAssistResult
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
  currency?: string
  distanceKm: number
  estimated: boolean
  estimatedMinutes?: number
  distanceSource?: string
  baseFareMinor?: number
  airportSurcharge?: number
  airportTrip?: boolean
  stopsCount?: number
  stopsFee?: number
  riderCount?: number
  ridersFee?: number
  bagCount?: number
  bagsFee?: number
  fuelSurchargePercent?: number
  trafficMultiplier?: number
  trafficSource?: string
  isPeak?: boolean
  isNight?: boolean
  nightMultiplier?: number
  scheduled?: boolean
  scheduleMultiplier?: number
  peakMultiplier?: number
  demandMultiplier?: number
  surgeMultiplier?: number
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
  riderCount?: number
  bagCount?: number
  scheduled?: boolean
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
  riderCount?: number
  bagCount?: number
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
      riderCount: input.riderCount,
      bagCount: input.bagCount,
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

export async function saveDriverVehicle(vehicle: { vehicleMake: string; vehicleModel: string; vehiclePlate: string; vehicleCategory?: 'BIKE' | 'ECONOMY' | 'COMFORT' | 'SUV' | 'VAN' | null; vehicleYear?: number | null; vehicleColor?: string | null; registrationExpiresAt?: string | null }) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; driverProfile: { vehicleMake: string; vehicleModel: string; vehiclePlate: string; vehicleCategory?: 'BIKE' | 'ECONOMY' | 'COMFORT' | 'SUV' | 'VAN' | null; vehicleYear?: number | null; vehicleColor?: string | null; registrationExpiresAt?: string | null; inspectionStatus?: 'PENDING' | 'PASSED' | 'FAILED' | 'EXPIRED' | null; inspectionExpiresAt?: string | null } }>('/api/driver/vehicle', {
    method: 'PUT',
    token: session.token,
    body: vehicle,
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

// Full auto-dispatch (2026-10-10): accept a ride offered directly to this driver. Same driver
// session/auth pattern as claimPrototypeSrRide; the server gates it to the current offer holder.
export async function acceptSrOffer(rideId: string) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(`/api/sr/rides/${rideId}/accept-offer`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.ride
}

// Decline an offer so it escalates to the next-nearest driver.
export async function declineSrOffer(rideId: string) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true }>(`/api/sr/rides/${rideId}/decline-offer`, {
    method: 'PATCH',
    token: session.token,
  })
  return response
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

// Safety Phase 2 (2026-10-10): the assigned driver submits the rider's 4-digit pickup PIN. On a
// match the server stamps metadata.pickupVerifiedAt, which unlocks the IN_PROGRESS (start trip)
// transition. A mismatch is a 403 PICKUP_CODE_MISMATCH surfaced to the driver.
export async function verifySrPickup(rideId: string, code: string) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true }>(`/api/sr/rides/${rideId}/verify-pickup`, {
    method: 'POST',
    token: session.token,
    body: { code },
  })
  return response.ok
}

// Safety Phase 1 (2026-10-10): SOS / panic. Either party to an active ride can pull it. The rider
// uses their guest session; the driver passes asDriver=true to use the driver session. Device
// geolocation (lat/lng) is optional -- the server records the incident either way.
export async function triggerSrSos(
  rideId: string,
  options: { lat?: number; lng?: number; note?: string } = {},
  asDriver = false,
) {
  const session = asDriver ? await ensurePrototypeDriverSession() : await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; incidentId: string }>(`/api/sr/rides/${rideId}/sos`, {
    method: 'POST',
    token: session.token,
    body: { lat: options.lat, lng: options.lng, note: options.note },
  })
  return response.incidentId
}

// Safety Phase 1 (2026-10-10): the admin incident + trail console (ADMIN/SUPPORT read; ADMIN
// resolve). Loose-ref incident records plus a per-ride immutable trail.
export type PlatformIncident = {
  id: string
  rideId: string | null
  reporterId: string
  reporterRole: string
  type: 'SOS' | 'REPORT'
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  lat: number | null
  lng: number | null
  note: string | null
  meta: Record<string, unknown>
  createdAt: string
  resolvedAt: string | null
  resolvedById: string | null
  ride?: {
    id: string
    status: string
    fareMinor: number | null
    currency: string
    riderId: string
    driverId: string | null
    requestedAt: string
  } | null
}

export type PlatformRideEvent = {
  id: string
  rideId: string
  type: string
  actorId: string | null
  actorRole: string | null
  lat: number | null
  lng: number | null
  meta: Record<string, unknown>
  createdAt: string
}

export type PlatformRideTrail = {
  ride: PlatformRideRequest
  snapshot: Record<string, unknown> | null
  events: PlatformRideEvent[]
  incidents: PlatformIncident[]
}

export async function fetchAdminIncidents(status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED') {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; incidents: PlatformIncident[]; count: number }>(`/api/admin/sr/incidents${query}`, { token }),
  )
  return response.incidents
}

export async function fetchAdminRideTrail(rideId: string) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true } & PlatformRideTrail>(`/api/admin/sr/rides/${rideId}/trail`, { token }),
  )
  const { ok: _ok, ...trail } = response
  return trail as PlatformRideTrail
}

// Safety Phase 3 (2026-10-10): the AI trip-analysis layer. Advisory, fully key-gated server-side
// (configured:false when ANTHROPIC_API_KEY is unset) and never-throws. ADMIN/SUPPORT only.
export type PlatformRideAiAnalysis = {
  configured: boolean
  error?: boolean
  summary: string | null
  concerns: string[]
  severity: 'none' | 'low' | 'medium' | 'high'
  recommendation: string | null
  generatedAt?: string
}

export async function fetchAdminRideAiSummary(rideId: string, options: { refresh?: boolean } = {}) {
  const query = options.refresh ? '?refresh=1' : ''
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; analysis: PlatformRideAiAnalysis; cached?: boolean }>(
      `/api/admin/sr/rides/${encodeURIComponent(rideId)}/ai-summary${query}`,
      { token },
    ),
  )
  return response.analysis
}

// Safety Phase 2 (2026-10-10): a driver's security-history profile, aggregated server-side from
// existing tables. ADMIN/SUPPORT only.
export type PlatformDriverSafety = {
  driverId: string
  displayName: string
  accountCreatedAt: string
  idDocumentStatus: string | null
  currentVehicleStatus: string | null
  inspectionStatus: string | null
  inspectionExpiresAt: string | null
  registrationExpiresAt: string | null
  totalRides: number
  completed: number
  cancelledByDriver: number
  completionRate: number | null
  disputesInvolved: number
  sosInvolved: number
  avgRating: number | null
  ratingCount: number
}

export async function fetchAdminDriverSafety(driverId: string) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; safety: PlatformDriverSafety }>(`/api/admin/driver/${encodeURIComponent(driverId)}/safety`, { token }),
  )
  return response.safety
}

export async function resolveAdminIncident(incidentId: string, input: { status: 'ACKNOWLEDGED' | 'RESOLVED'; note?: string }) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; incident: PlatformIncident }>(`/api/admin/sr/incidents/${incidentId}`, {
      method: 'PATCH',
      token,
      body: { status: input.status, note: input.note },
    }),
  )
  return response.incident
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

export type PlatformHostEarningsTotals = { forecastedMinor: number; grossEarnedMinor: number; releasedMinor: number; pendingMinor: number; currency: string }
export type PlatformHostEarnings = {
  rows: PlatformHostEarningsRow[]
  totals: PlatformHostEarningsTotals
  totalsByCurrency?: PlatformHostEarningsTotals[]
}

export async function fetchPrototypeHostEarnings(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; earnings: PlatformHostEarnings }>('/api/host/earnings', {
    token: session.token,
  })
  return response.earnings
}

export type IdDocumentStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null

// The listing wizard loads the signed-in host's ID status on open (GET /api/me returns only the
// status, never the storage ref). 'seller' mode resolves the one-account session first.
export async function fetchMyIdDocumentStatus(mode: HostDashboardMode = 'seller'): Promise<IdDocumentStatus> {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<MeResponse>('/api/me', { token: session.token })
  return (response.user.idDocumentStatus as IdDocumentStatus) ?? null
}

// The KYC gate on /api/listings/:id/submit requires the ID to be UPLOADED (PENDING_REVIEW or
// APPROVED) for every division; the admin approves the ID before approving the listing (owner
// decision 2026-10-09). This is the host/seller-side counterpart to submitGuestIdDocument() — same
// endpoint, same one-document-per-user model, resolved through the host/seller session (pass
// 'seller' to use the one-account session: getStoredSellerSession falls back to a signed-in
// guest/staff session that has HOST or SELLER).
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

// Fix a listing that was sent back and put it back in the review queue (2026-10-09). A content edit
// moves a REJECTED listing to PENDING_REVIEW server-side (and re-runs the AI pre-check); with no
// content change, the plain submit endpoint resubmits it as is.
export async function resubmitHostListing(
  listingId: string,
  changes: { titleAr?: string; description?: string; priceMinor?: number },
) {
  const token = hostToken()
  if (Object.keys(changes).length) {
    const response = await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/host/listings/${listingId}`, {
      method: 'PATCH',
      token,
      body: changes,
    })
    return response.listing
  }
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/listings/${listingId}/submit`, { method: 'PATCH', token })
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
export type OtpPurpose = 'guest-login' | 'staff-login' | 'seller-login' | 'host-login' | 'account-verify' | 'payment-proof' | 'wallet-claim' | 'password-reset' | 'admin-login'

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

// ---------------------------------------------------------------------------------------------
// Short-stay money flow (owner decisions Oct 8, 2026): quote, guest cancel, host payouts, admin
// payout requests + refunds. Shapes follow the agreed API contract exactly.
// ---------------------------------------------------------------------------------------------

export type BookingQuote = {
  nights: number
  stayMinor: number
  cleaningMinor: number
  taxesMinor: number
  otherFeesMinor: number
  protectionMinor: number
  totalMinor: number
  commissionMinor: number
  hostShareMinor: number
  currency: string
  bookable: boolean
  reason?: string
}

// Public. `protection` adds the 3%-of-the-full-stay protection fee into totalMinor.
export async function fetchBookingQuote(input: { listingId: string; checkIn: string; checkOut: string; protection: boolean }) {
  const params = new URLSearchParams({
    listingId: input.listingId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    protection: input.protection ? '1' : '0',
  })
  const response = await apiRequest<{ ok: true; quote: BookingQuote }>(`/api/bookings/quote?${params.toString()}`)
  return response.quote
}

export type CancelQuoteRule = 'FULL' | 'HALF' | 'FULL_MINUS_PROTECTION' | 'HALF_MINUS_PROTECTION' | 'UNPAID'

export type BookingCancelQuote = {
  refundMinor: number
  retainedMinor: number
  rule: CancelQuoteRule
  deadline: string
  currency: string
}

export async function fetchBookingCancelQuote(bookingId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; cancelQuote: BookingCancelQuote }>(`/api/bookings/${bookingId}/cancel-quote`, {
    token: session.token,
  })
  return response.cancelQuote
}

export async function cancelGuestBooking(bookingId: string, reason?: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{
    ok: true
    booking: PlatformBooking
    refund?: { rule?: CancelQuoteRule; refundMinor?: number; retainedMinor?: number; amountMinor?: number; currency?: string } | null
  }>(`/api/bookings/${bookingId}/cancel`, {
    method: 'PATCH',
    token: session.token,
    body: reason ? { reason } : {},
  })
  return response
}

export type PayoutMethodType = 'SHAM_CASH' | 'BANK' | 'CASH_OFFICE'

export type HostPayoutMethod = {
  type: PayoutMethodType
  shamCashNumber?: string
  accountName?: string
  bankName?: string
  accountNumber?: string
  officeCity?: string
}

export type PayoutRequestStatus = 'REQUESTED' | 'PAID' | 'REJECTED'

export type HostPayoutRequest = {
  id: string
  amountMinor: number
  currency: string
  status: PayoutRequestStatus
  method: HostPayoutMethod | null
  reference?: string | null
  note?: string | null
  createdAt: string
  decidedAt?: string | null
}

export type HostPayoutsSummary = {
  availableMinor: number
  pendingMinor: number
  currency: string
  requests: HostPayoutRequest[]
}

export async function fetchHostPayoutMethod(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; method: HostPayoutMethod | null }>('/api/host/payout-method', { token: session.token })
  return response.method
}

export async function saveHostPayoutMethod(method: HostPayoutMethod, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; method: HostPayoutMethod }>('/api/host/payout-method', {
    method: 'PUT',
    token: session.token,
    body: method,
  })
  return response.method
}

export async function fetchHostPayouts(mode: HostDashboardMode = 'host', currency = 'SYP') {
  const session = await getHostDashboardSession(mode)
  const query = `?currency=${encodeURIComponent(String(currency || 'SYP').toUpperCase())}`
  const response = await apiRequest<{ ok: true } & HostPayoutsSummary>(`/api/host/payouts${query}`, { token: session.token })
  return {
    availableMinor: response.availableMinor,
    pendingMinor: response.pendingMinor,
    currency: response.currency,
    requests: response.requests || [],
  } satisfies HostPayoutsSummary
}

export async function requestHostPayout(amountMinor: number, mode: HostDashboardMode = 'host', currency = 'SYP') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; request: HostPayoutRequest }>('/api/host/payouts', {
    method: 'POST',
    token: session.token,
    body: { amountMinor, currency: String(currency || 'SYP').toUpperCase() },
  })
  return response.request
}

export type AdminPayoutRequest = HostPayoutRequest & {
  host?: { id: string; displayName: string; email: string | null } | null
}

export async function fetchAdminPayoutRequests(status?: PayoutRequestStatus | '') {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; requests: AdminPayoutRequest[] }>(`/api/admin/payout-requests${query}`, { token }),
  )
  return response.requests || []
}

export async function decideAdminPayoutRequest(
  requestId: string,
  input: { action: 'paid'; reference: string; note?: string } | { action: 'reject'; note: string },
) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; request: AdminPayoutRequest }>(`/api/admin/payout-requests/${requestId}`, {
      method: 'PATCH',
      token,
      body: input,
    }),
  )
  return response.request
}

export type AdminRefund = {
  id: string
  bookingId: string | null
  amountMinor: number
  currency: string
  status: string
  createdAt: string
  guest?: { id?: string; displayName?: string; email?: string | null } | null
  bookingStatus?: string | null
  executedAt?: string | null
}

export async function fetchAdminRefunds(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; refunds: AdminRefund[] }>(`/api/admin/refunds${query}`, { token }),
  )
  return response.refunds || []
}

export async function executeAdminRefund(refundId: string) {
  return runAdminRequest((token) =>
    apiRequest<{ ok: true } & Record<string, unknown>>(`/api/admin/refunds/${refundId}/execute`, { method: 'PATCH', token }),
  )
}

export async function finalizeAdminBookingCancellation(bookingId: string) {
  return runAdminRequest((token) =>
    apiRequest<{ ok: true; cancelledBy?: 'GUEST' | 'HOST' } & Record<string, unknown>>(
      `/api/admin/bookings/${bookingId}/finalize-cancellation`,
      { method: 'PATCH', token },
    ),
  )
}
