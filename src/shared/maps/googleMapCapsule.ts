import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../api/platformApi'

export type GoogleMapTarget = {
  hasCoordinates: boolean
  hasRealLocation: boolean
  label: string
  query: string
}

export type OfflineMapSnapshot = {
  address: string
  createdAt: string
  hasCoordinates: boolean
  label: string
  query: string
  title: string
}

export function googleMapsSearchUrl(listing: PlatformListing, title: string, lang: Lang) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listingMapTarget(listing, title, lang).query)}`
}

export function googleMapsEmbedUrl(listing: PlatformListing, title: string, lang: Lang) {
  return `https://www.google.com/maps?q=${encodeURIComponent(listingMapTarget(listing, title, lang).query)}&output=embed`
}

export function offlineMapSnapshot(listing: PlatformListing, title: string, lang: Lang): OfflineMapSnapshot {
  const target = listingMapTarget(listing, title, lang)
  return {
    address: target.label,
    createdAt: new Date().toISOString(),
    hasCoordinates: target.hasCoordinates,
    label: target.label,
    query: target.query,
    title,
  }
}

export function offlineMapStorageKey(listingId: string) {
  return `sybnb-v6-offline-map:${listingId}`
}

export function listingMapTarget(listing: PlatformListing, title: string, lang: Lang): GoogleMapTarget {
  const metadata = listing.metadata || {}
  const location = listing.location || {}
  const lat = numberFrom(location.lat ?? location.latitude ?? location.geoLat ?? metadata.lat ?? metadata.latitude ?? metadata.geoLat)
  const lng = numberFrom(location.lng ?? location.lon ?? location.longitude ?? location.geoLng ?? metadata.lng ?? metadata.lon ?? metadata.longitude ?? metadata.geoLng)
  const addressParts = [
    stringFrom(location.addressAr ?? metadata.addressAr),
    stringFrom(location.address ?? metadata.address),
    stringFrom(location.neighborhoodAr ?? location.districtAr ?? location.areaAr ?? metadata.neighborhoodAr ?? metadata.districtAr ?? metadata.areaAr),
    stringFrom(location.neighborhood ?? location.district ?? location.area ?? metadata.neighborhood ?? metadata.district ?? metadata.area),
    stringFrom(location.cityAr ?? metadata.cityAr),
    stringFrom(location.city ?? metadata.city),
    stringFrom(location.governorateAr ?? metadata.governorateAr),
    stringFrom(location.governorate ?? metadata.governorate),
  ].filter(Boolean)
  const uniqueParts = Array.from(new Set(addressParts))
  const hasRealLocation = uniqueParts.length > 0
  const hasCoordinates = typeof lat === 'number' && typeof lng === 'number'
  const country = lang === 'ar' ? 'سوريا' : 'Syria'
  // A listing with no real address text used to silently fabricate `${title}, Damascus, Syria` --
  // a specific, disprovable city claim that could (and did) contradict the listing's own title.
  // "Syria" alone stays true (SYBNB is Syria-only today, no other country profile is active), but a
  // specific city was never confirmed and must never be invented. CAPSULE_RULES.noFakeTrustSignal.
  const pinnedLocation = lang === 'ar' ? 'موقع محدد على الخريطة' : 'Pinned location'
  const locationNotProvided = lang === 'ar' ? 'لم يتم تحديد الموقع' : 'Location not provided'
  const label = hasRealLocation
    ? uniqueParts.join(lang === 'ar' ? '، ' : ', ')
    : hasCoordinates
      ? pinnedLocation
      : locationNotProvided

  if (hasCoordinates) {
    return {
      hasCoordinates: true,
      hasRealLocation,
      label,
      query: `${lat},${lng}`,
    }
  }

  return {
    hasCoordinates: false,
    hasRealLocation,
    label,
    query: hasRealLocation ? [title, ...uniqueParts, country].filter(Boolean).join(', ') : `${title}, ${country}`,
  }
}

function stringFrom(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

function numberFrom(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}
