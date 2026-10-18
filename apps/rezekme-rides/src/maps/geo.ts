import { hasGoogleMapsKey, loadGoogleMaps } from './googleLoader'
import type { LatLng } from './mapTypes'

/**
 * Label for a map-dropped pin. With a working Google key the pin is reverse-geocoded to an address;
 * otherwise (or on any failure) it is honestly labelled "Dropped pin" -- never an invented address.
 */
export async function reverseGeocode(point: LatLng, lang: string): Promise<string | null> {
  if (!hasGoogleMapsKey) return null
  try {
    const g = await loadGoogleMaps(lang)
    const geocoder = new g.maps.Geocoder()
    const result = await geocoder.geocode({ location: point })
    const first = result?.results?.[0]?.formatted_address
    return typeof first === 'string' && first.trim() ? first : null
  } catch {
    return null
  }
}
