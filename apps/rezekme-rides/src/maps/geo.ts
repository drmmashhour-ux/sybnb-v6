import type { LatLng } from './mapTypes'

/**
 * Label for a map-dropped pin. There is no paid geocoder: the pin is honestly labelled "Dropped pin" by the
 * caller -- never an invented address. (Returns null so the caller keeps that label.)
 */
export async function reverseGeocode(_point: LatLng, _lang: string): Promise<string | null> {
  return null
}
