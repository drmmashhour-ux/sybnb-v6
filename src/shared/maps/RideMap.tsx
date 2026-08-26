import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type MapPoint = { lat: number; lng: number }

type RideMapProps = {
  pickup?: MapPoint | null
  dropoff?: MapPoint | null
  stops?: MapPoint[]
  driverLocation?: MapPoint | null
  height?: number
}

// Custom divIcons -- Leaflet's default marker PNGs resolve relative to the page URL and break
// silently under a bundler (a well-known Leaflet+Vite/webpack gotcha) unless separately configured.
// Plain colored dots/emoji sidestep that entirely and need no image assets at all.
const pickupIcon = L.divIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#20d29b;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.35)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})
const dropoffIcon = L.divIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#ff4c73;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.35)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})
const driverIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))">🚗</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})
function stopIcon(n: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:20px;height:20px;border-radius:50%;background:#e5b80b;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#0b0d14">${n}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

// Damascus -- purely an initial view center when no real coordinate exists yet, never a marker
// (no marker is ever placed for a point that wasn't actually provided).
const FALLBACK_CENTER: MapPoint = { lat: 33.5138, lng: 36.2765 }

export function RideMap({ pickup, dropoff, stops, driverLocation, height = 220 }: RideMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<{ pickup?: L.Marker; dropoff?: L.Marker; driver?: L.Marker; stops: L.Marker[] }>({ stops: [] })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center = driverLocation || pickup || dropoff || FALLBACK_CENTER
    const map = L.map(containerRef.current, { attributionControl: true }).setView([center.lat, center.lng], 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      // React StrictMode double-invokes this effect on mount (mount -> cleanup -> mount) in dev.
      // Without resetting this too, a later marker-sync run sees a "still set" marker ref from the
      // now-destroyed map and calls setLatLng() on it instead of creating a fresh one on the new
      // map -- the marker updates an object nothing renders, so it silently never appears. This was
      // caught live: only the driver marker (whose lat/lng genuinely changes between polls, forcing
      // the create branch) ever showed up; pickup/dropoff (constant lat/lng) never did.
      markersRef.current = { stops: [] }
    }
    // Intentionally mount once -- pan/zoom is driven by the marker-sync effect below, not by prop
    // churn on every 4-5s ride/location poll (which would otherwise reset the rider's own pan/zoom).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const boundsPoints: [number, number][] = []

    function upsertMarker(key: 'pickup' | 'dropoff' | 'driver', point: MapPoint | null | undefined, icon: L.DivIcon) {
      const existing = markersRef.current[key]
      if (!point) {
        if (existing) {
          map!.removeLayer(existing)
          markersRef.current[key] = undefined
        }
        return
      }
      boundsPoints.push([point.lat, point.lng])
      if (existing) {
        existing.setLatLng([point.lat, point.lng])
      } else {
        markersRef.current[key] = L.marker([point.lat, point.lng], { icon }).addTo(map!)
      }
    }

    upsertMarker('pickup', pickup, pickupIcon)
    upsertMarker('dropoff', dropoff, dropoffIcon)
    upsertMarker('driver', driverLocation, driverIcon)

    // Stops are fixed once a ride is created (never updated afterward), so a plain clear-and-
    // recreate is simpler than upsert-in-place and causes no visible churn in practice.
    markersRef.current.stops.forEach((marker) => map!.removeLayer(marker))
    markersRef.current.stops = (stops || []).map((point, index) => {
      boundsPoints.push([point.lat, point.lng])
      return L.marker([point.lat, point.lng], { icon: stopIcon(index + 1) }).addTo(map)
    })

    if (boundsPoints.length > 1) {
      map.fitBounds(boundsPoints, { padding: [30, 30], maxZoom: 15 })
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 14)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverLocation?.lat, driverLocation?.lng, JSON.stringify(stops)])

  return <div ref={containerRef} style={{ height, borderRadius: 8, overflow: 'hidden' }} />
}
