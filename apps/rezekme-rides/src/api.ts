import {
  clearGuestSession,
  getStoredGuestSession,
  type PlatformRideRequest,
  type PlatformSrQuote,
} from '@platform/shared/api/platformApi'

/**
 * apps/sr API wrappers for the two SR endpoints whose platform client functions
 * (fetchSrQuote / createPrototypeSrRide in src/shared/api/platformApi.ts) do not forward
 * dropoffCoords / stopCoords -- although the server (server/routes/sr-rides.mjs) already accepts
 * them as coordinate overrides for the geocoder.
 *
 * Same endpoints (POST /api/sr/quote, POST /api/sr/rides), same bearer token (the stored guest
 * session), same API base (VITE_API_BASE_URL, same default as the platform client) and the same
 * response handling (error body -> Error with status/code; a 401 drops the dead local session).
 * Nothing about fares, payments or commission is touched here: only extra coordinate hints go along.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'

export type Coords = { lat: number; lng: number }
/** Aligned 1:1 with the NON-BLANK stops sent in `stops` (null = no known coordinates for that stop). */
export type StopCoords = Array<Coords | null>

async function post<T>(path: string, body: unknown, options: { anonymousOk?: boolean } = {}): Promise<T> {
  const token = getStoredGuestSession()?.token
  if (!token && !options.anonymousOk) throw new Error('Sign in to continue.')
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as { ok?: boolean; error?: { message?: string; code?: string } } & T
  if (!response.ok || payload?.ok === false) {
    if (response.status === 401) clearGuestSession()
    const error = new Error(payload?.error?.message || `Rezekme API request failed: ${response.status}`) as Error & { status?: number; code?: string }
    error.status = response.status
    if (payload?.error?.code) error.code = payload.error.code
    throw error
  }
  return payload as T
}

export async function fetchSrQuoteWithCoords(input: {
  pickup: string
  dropoff: string
  category: string
  lowDataMode: boolean
  pickupCoords?: Coords
  dropoffCoords?: Coords
  stops?: string[]
  stopCoords?: StopCoords
  riderCount?: number
  bagCount?: number
  scheduled?: boolean
}): Promise<PlatformSrQuote> {
  const response = await post<{ ok: true; quote: PlatformSrQuote }>('/api/sr/quote', input, { anonymousOk: true })
  return response.quote
}

export async function createSrRideWithCoords(input: {
  pickup: string
  dropoff: string
  category: string
  currency: string
  lowDataMode: boolean
  accuracyMeters?: number
  pickupCoords?: Coords
  dropoffCoords?: Coords
  routeType?: string
  features?: string[]
  scheduledFor?: string
  accessibilityRequired?: boolean
  deliveryOnly?: boolean
  stops?: string[]
  stopCoords?: StopCoords
  promoCode?: string
  billToBusinessAccount?: boolean
  shareable?: boolean
  riderCount?: number
  bagCount?: number
  handBagCount?: number
  bonusMinor?: number
  autoSwitch?: boolean
  guestStripeSessionId?: string
}): Promise<PlatformRideRequest> {
  const response = await post<{ ok: true; ride: PlatformRideRequest }>('/api/sr/rides', {
    // Paid Stripe Checkout session (guest/client card): the server verifies it and marks the ride prepaid.
    ...(input.guestStripeSessionId ? { guestStripeSessionId: input.guestStripeSessionId } : {}),
    pickup: input.pickup,
    dropoff: input.dropoff,
    category: input.category,
    currency: input.currency,
    lowDataMode: input.lowDataMode,
    pickupCoords: input.pickupCoords,
    dropoffCoords: input.dropoffCoords,
    scheduledFor: input.scheduledFor,
    accessibilityRequired: input.accessibilityRequired,
    deliveryOnly: input.deliveryOnly,
    stops: input.stops,
    stopCoords: input.stopCoords,
    promoCode: input.promoCode,
    billToBusinessAccount: input.billToBusinessAccount,
    shareable: input.shareable,
    riderCount: input.riderCount,
    bagCount: input.bagCount,
    handBagCount: input.handBagCount,
    bonusMinor: input.bonusMinor,
    metadata: {
      accuracyMeters: input.accuracyMeters,
      locationSource: input.accuracyMeters ? 'gps' : 'manual',
      // Recorded as the rider's stated preference, not an enforced match (same as the platform client).
      requestedRouteType: input.routeType,
      requestedFeatures: input.features,
      // Opt-in: if no driver in the chosen category after the timeout, move to the cheapest category that has one.
      ...(input.autoSwitch ? { autoSwitch: true } : {}),
    },
  })
  return response.ride
}

// Switch an unclaimed ride to another car category (after "no driver in your category").
export async function changeSrRideCategory(rideId: string, category: string): Promise<{ category: string; fareMinor: number; currency: string }> {
  return post<{ ok: true; category: string; fareMinor: number; currency: string }>(`/api/sr/rides/${rideId}/change-category`, { category })
}

// Raise the driver bonus on a still-unclaimed ride (total bonus, whole USD) to get picked up faster.
export async function addSrRideBonus(rideId: string, bonusMinor: number): Promise<{ bonusMinor: number; fareMinor: number }> {
  return post<{ ok: true; bonusMinor: number; fareMinor: number }>(`/api/sr/rides/${rideId}/bonus`, { bonusMinor })
}

export type CategoryAvailability = { category: string; drivers: number; etaMinutes: number | null }

// Live availability near the pickup: per category driver count + rough ETA.
export async function fetchSrAvailability(point: Coords): Promise<CategoryAvailability[]> {
  const token = getStoredGuestSession()?.token
  const response = await fetch(`${API_BASE_URL}/api/sr/availability?lat=${point.lat}&lng=${point.lng}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!response.ok) return []
  const payload = (await response.json()) as { availability?: CategoryAvailability[] }
  return payload.availability ?? []
}

/** Sham Cash wallet top-up: the rider transfers to the platform account and submits the amount + transaction reference.
 *  An admin verifies the transfer and approves it, which credits the wallet. Nothing is credited before that. */
export async function submitWalletTopupProof(input: { amountMinor: number; currency: string; providerRef: string }): Promise<void> {
  await post<{ ok: true }>('/api/wallet/topup-proof', input)
}
