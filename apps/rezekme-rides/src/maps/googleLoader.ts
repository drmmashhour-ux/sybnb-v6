/**
 * Google Maps JavaScript API loader (on demand, never at startup).
 *
 * The key comes ONLY from the build-time env var VITE_GOOGLE_MAPS_API_KEY -- it is never hard-coded
 * or committed. A browser Maps key is public by nature: restrict it in Google Cloud to this app's web
 * origins / Android package and to the Maps JavaScript API + Places API (see apps/sr/ENV.md).
 *
 * If the key is missing, the script fails to load, or Google reports an auth failure, the returned
 * promise rejects and `googleMapsFailed()` becomes true; callers then fall back to the keyless
 * Leaflet/OSM map and plain text inputs, so the app always works.
 */

// The Google Maps namespace is intentionally untyped (no @types/google.maps dependency available).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GoogleNs = any

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || ''
const COUNTRY = (import.meta.env.VITE_MAPS_COUNTRY as string | undefined)?.trim().toLowerCase() || ''
const CALLBACK = '__srGoogleMapsReady'

let promise: Promise<GoogleNs> | null = null
let failed = false
const failListeners = new Set<() => void>()

export const hasGoogleMapsKey = KEY.length > 0

/** Optional ISO 3166-1 alpha-2 country restriction for Places Autocomplete; empty = worldwide. */
export const mapsCountry = COUNTRY

export function googleMapsFailed(): boolean {
  return failed
}

export function onGoogleMapsFail(listener: () => void): () => void {
  failListeners.add(listener)
  return () => failListeners.delete(listener)
}

function markFailed() {
  if (failed) return
  failed = true
  failListeners.forEach((listener) => listener())
}

export function loadGoogleMaps(lang: string): Promise<GoogleNs> {
  if (!KEY) return Promise.reject(new Error('NO_GOOGLE_MAPS_KEY'))
  if (failed) return Promise.reject(new Error('GOOGLE_MAPS_FAILED'))
  if (promise) return promise
  promise = new Promise<GoogleNs>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>
    const fail = (reason: string) => {
      markFailed()
      reject(new Error(reason))
    }
    // Invalid / unrestricted-for-this-origin / API-not-enabled keys call this global after load.
    w.gm_authFailure = () => fail('GOOGLE_MAPS_AUTH_FAILURE')
    w[CALLBACK] = () => {
      const g = (w as { google?: GoogleNs }).google
      if (g?.maps?.places) resolve(g)
      else fail('GOOGLE_MAPS_INCOMPLETE')
    }
    const params = new URLSearchParams({ key: KEY, v: 'weekly', libraries: 'places', callback: CALLBACK, language: lang })
    if (COUNTRY) params.set('region', COUNTRY.toUpperCase())
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`
    script.async = true
    script.defer = true
    script.onerror = () => fail('GOOGLE_MAPS_SCRIPT_ERROR')
    document.head.appendChild(script)
    window.setTimeout(() => fail('GOOGLE_MAPS_TIMEOUT'), 20000)
  })
  // Avoid an unhandled-rejection warning when nobody awaits it yet.
  promise.catch(() => {})
  return promise
}
