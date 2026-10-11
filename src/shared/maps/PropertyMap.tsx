import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { type Lang } from '../../engines/language/languageEngine'
import { listingCoords, type PlatformListing } from '../api/platformApi'
import { moneyText } from '../i18n/display'
import { listingDisplayTitle } from '../listing/displayTitle'

// Property results map (Centris-depth, 2026-10-11). Renders a pin per listing that has coordinates;
// the popup links to the listing. Listings without coordinates are simply not plotted.
const FALLBACK_CENTER: [number, number] = [33.5138, 36.2765] // Damascus

function priceIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="background:#0d5c63;color:#fff;border:2px solid #fff;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4)">${label}</div>`,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  })
}

export function PropertyMap({ listings, lang, height = 420 }: { listings: PlatformListing[]; lang: Lang; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { attributionControl: true }).setView(FALLBACK_CENTER, 7)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; layerRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const bounds: [number, number][] = []
    for (const l of listings) {
      const c = listingCoords(l)
      if (!c) continue
      const label = moneyText(l.priceMinor, l.currency, lang)
      const title = listingDisplayTitle(l, lang) || l.id.slice(0, 8).toUpperCase()
      const safeTitle = title.replace(/</g, '&lt;')
      const marker = L.marker([c.lat, c.lng], { icon: priceIcon(label) }).addTo(layer)
      marker.bindPopup(`<div style="display:grid;gap:4px;min-width:150px"><strong>${label}</strong><span style="font-size:13px">${safeTitle}</span><a href="#/listing/${l.id}" style="color:#0d5c63;font-weight:700;font-size:13px">${lang === 'ar' ? 'عرض الإعلان' : lang === 'fr' ? 'Voir l’annonce' : 'View listing'} →</a></div>`)
      bounds.push([c.lat, c.lng])
    }
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    else if (bounds.length === 1) map.setView(bounds[0], 13)
  }, [listings, lang])

  const plotted = listings.filter((l) => listingCoords(l)).length
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div ref={containerRef} style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid #e6e9ee' }} />
      {plotted === 0 && (
        <small style={{ color: '#5c6673', textAlign: 'center' }}>
          {lang === 'ar' ? 'لا توجد إعلانات بإحداثيات على الخريطة بعد — تظهر عند تحديد البائع لموقعه.' : lang === 'fr' ? 'Aucune annonce géolocalisée pour le moment — elles apparaissent quand le vendeur place sa position.' : 'No listings with map coordinates yet — they appear once sellers pin their location.'}
        </small>
      )}
    </div>
  )
}
