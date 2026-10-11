import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { pick, type Lang } from '../../engines/language/languageEngine'

export type LatLng = { lat: number; lng: number }

// Seller location pin (Centris-depth, 2026-10-11). Click or drag the marker to set a listing's map
// coordinate; the wizard sends it as body.lat/lng. Damascus is only the initial view when no value.
const FALLBACK_CENTER: LatLng = { lat: 33.5138, lng: 36.2765 }

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:30px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));transform:translateY(-6px)">📍</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 28],
})

export function LocationPicker({
  value,
  onChange,
  lang,
  height = 260,
}: {
  value: LatLng | null
  onChange: (v: LatLng) => void
  lang: Lang
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center = value || FALLBACK_CENTER
    const map = L.map(containerRef.current, { attributionControl: true }).setView([center.lat, center.lng], value ? 15 : 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
    mapRef.current = map

    const place = (lat: number, lng: number) => {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
      } else {
        const m = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map)
        m.on('dragend', () => { const p = m.getLatLng(); onChangeRef.current({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) }) })
        markerRef.current = m
      }
      onChangeRef.current({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) })
    }

    if (value) place(value.lat, value.lng)
    map.on('click', (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng))

    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords
      const map = mapRef.current
      if (map) {
        map.setView([latitude, longitude], 15)
        if (markerRef.current) markerRef.current.setLatLng([latitude, longitude])
        else {
          const m = L.marker([latitude, longitude], { icon: pinIcon, draggable: true }).addTo(map)
          m.on('dragend', () => { const p = m.getLatLng(); onChangeRef.current({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) }) })
          markerRef.current = m
        }
      }
      onChangeRef.current({ lat: Number(latitude.toFixed(6)), lng: Number(longitude.toFixed(6)) })
    })
  }

  const isAr = lang === 'ar'
  return (
    <div style={{ display: 'grid', gap: 6 }} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <small style={{ color: '#5c6673' }}>
          {pick(lang, 'انقر على الخريطة لتحديد موقع العقار.', 'Tap the map to pin the property location.', 'Touchez la carte pour situer le bien.')}
        </small>
        <button type="button" onClick={useMyLocation} style={{ border: '1px solid #0d5c63', background: 'transparent', color: '#0d5c63', borderRadius: 999, padding: '4px 12px', fontSize: 13, cursor: 'pointer' }}>
          {pick(lang, '📍 موقعي الحالي', '📍 Use my location', '📍 Ma position')}
        </button>
      </div>
      <div ref={containerRef} style={{ height, borderRadius: 10, overflow: 'hidden', border: '1px solid #cfd6de' }} />
      {value && (
        <small dir="ltr" style={{ color: '#5c6673' }}>{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</small>
      )}
    </div>
  )
}
