import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps, type GoogleNs } from './googleLoader'
import { animatePoint, bearing, CAR_PATH, fitTargets, hasMoved, initialView, isFarJump, type LatLng, type RideMapProps } from './mapTypes'

/**
 * Google Maps ride map: pickup / dropoff / numbered stop pins, a route line, a live driver marker
 * that glides between the 4 s polls, the rider's own position dot, and tap / long-press to drop a pin.
 *
 * Route line: a plain polyline straight through the points (free) until a road route is available.
 * The Google Routes API (road-following) is ONLY used when VITE_GOOGLE_DIRECTIONS === '1' (billed per
 * route, cached per trip; needs the Routes API enabled on the key). If it errors, the plain line stays.
 */
const USE_DIRECTIONS = import.meta.env.VITE_GOOGLE_DIRECTIONS === '1'
const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || ''

const routeCache = new Map<string, LatLng[] | null>()

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 'lat') lat += delta
      else lng += delta
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

/** Road-following route via the Google Routes API (REST, same browser key + referrer restriction). */
async function fetchRoadRoute(path: LatLng[]): Promise<LatLng[] | null> {
  const key = path.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join('|')
  if (routeCache.has(key)) return routeCache.get(key) ?? null
  if (!MAPS_KEY) return null
  const wp = (point: LatLng) => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } })
  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': MAPS_KEY, 'X-Goog-FieldMask': 'routes.polyline.encodedPolyline' },
      body: JSON.stringify({
        origin: wp(path[0]),
        destination: wp(path[path.length - 1]),
        intermediates: path.slice(1, -1).map(wp),
        travelMode: 'DRIVE',
      }),
    })
    if (!response.ok) throw new Error(String(response.status))
    const data = (await response.json()) as { routes?: { polyline?: { encodedPolyline?: string } }[] }
    const encoded = data.routes?.[0]?.polyline?.encodedPolyline
    const road = encoded ? decodePolyline(encoded) : null
    routeCache.set(key, road)
    return road
  } catch {
    routeCache.set(key, null)
    return null
  }
}

const BLACK = '#000000'
const WHITE = '#ffffff'

type Props = RideMapProps & { lang: string }

export function GoogleRideMap(props: Props) {
  const { pickup, dropoff, stops, driver, userLocation, dropTarget, onPick, command, onProviderFail, lang, phase, route } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const gRef = useRef<GoogleNs>(null)
  const mapRef = useRef<GoogleNs>(null)
  const markersRef = useRef<{ pickup?: GoogleNs; dropoff?: GoogleNs; driver?: GoogleNs; user?: GoogleNs; stops: GoogleNs[] }>({ stops: [] })
  const lineRef = useRef<GoogleNs>(null)
  const rendererRef = useRef<GoogleNs>(null)
  const driverPosRef = useRef<LatLng | null>(null)
  const lastFixRef = useRef<LatLng | null>(null)
  const headingRef = useRef(0)
  const interactedRef = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const cancelAnimRef = useRef<(() => void) | null>(null)
  const dropTargetRef = useRef(dropTarget)
  const onPickRef = useRef(onPick)
  const onFailRef = useRef(onProviderFail)
  dropTargetRef.current = dropTarget
  onPickRef.current = onPick
  onFailRef.current = onProviderFail
  const [ready, setReady] = useState(false)

  function fit() {
    const g = gRef.current
    const map = mapRef.current
    if (!g || !map) return
    const points = fitTargets(latest.current)
    if (points.length >= 2) {
      const bounds = new g.maps.LatLngBounds()
      points.forEach((point) => bounds.extend(point))
      map.fitBounds(bounds, { top: 56, left: 40, right: 40, bottom: 90 })
    } else if (points.length === 1) {
      map.setCenter(points[0])
      map.setZoom(15)
    }
  }

  // --- create the map once (script loaded lazily, after first paint, by the caller's lazy import)
  useEffect(() => {
    let disposed = false
    loadGoogleMaps(lang)
      .then((g) => {
        if (disposed || !containerRef.current) return
        const view = initialView()
        const map = new g.maps.Map(containerRef.current, {
          center: view.center,
          zoom: view.zoom,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: false,
        })
        map.addListener('click', (event: GoogleNs) => {
          const target = dropTargetRef.current
          if (target && event?.latLng) onPickRef.current?.(target, { lat: event.latLng.lat(), lng: event.latLng.lng() })
        })
        // Long-press (touch) / right-click (mouse): always drops a pin, defaulting to the dropoff.
        map.addListener('rightclick', (event: GoogleNs) => {
          if (event?.latLng) onPickRef.current?.(dropTargetRef.current || 'dropoff', { lat: event.latLng.lat(), lng: event.latLng.lng() })
        })
        // A hand pan / zoom switches off auto-follow until the rider presses recenter.
        map.addListener('dragstart', () => {
          interactedRef.current = true
        })
        gRef.current = g
        mapRef.current = map
        setReady(true)
      })
      .catch(() => {
        if (!disposed) onFailRef.current?.()
      })
    return () => {
      disposed = true
      cancelAnimRef.current?.()
      Object.values(markersRef.current).flat().forEach((marker) => marker && (marker as GoogleNs).setMap?.(null))
      markersRef.current = { stops: [] }
      lineRef.current?.setMap(null)
      rendererRef.current?.setMap(null)
      lineRef.current = null
      rendererRef.current = null
      mapRef.current = null
      gRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- static pins + route line, refit when they change
  const stopsKey = JSON.stringify(stops || [])
  const hasDriver = Boolean(driver)
  const routeKey = route ? route.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|') : ''
  useEffect(() => {
    const g = gRef.current
    const map = mapRef.current
    if (!ready || !g || !map) return

    const circle = (fill: string, scale: number) => ({ path: g.maps.SymbolPath.CIRCLE, scale, fillColor: fill, fillOpacity: 1, strokeColor: WHITE, strokeWeight: 3 })
    const square = { path: 'M -6,-6 6,-6 6,6 -6,6 z', scale: 1, fillColor: BLACK, fillOpacity: 1, strokeColor: WHITE, strokeWeight: 3 }

    function upsert(key: 'pickup' | 'dropoff', point: LatLng | null | undefined, icon: GoogleNs) {
      const existing = markersRef.current[key]
      if (!point) {
        existing?.setMap(null)
        markersRef.current[key] = undefined
        return
      }
      if (existing) existing.setPosition(point)
      else markersRef.current[key] = new g.maps.Marker({ map, position: point, icon, zIndex: 2 })
    }
    upsert('pickup', pickup, circle(BLACK, 8))
    upsert('dropoff', dropoff, square)

    markersRef.current.stops.forEach((marker) => marker.setMap(null))
    markersRef.current.stops = (stops || []).map(
      (point, index) =>
        new g.maps.Marker({
          map,
          position: point,
          icon: circle('#6b6b6b', 10),
          label: { text: String(index + 1), color: WHITE, fontSize: '11px', fontWeight: '700' },
          zIndex: 2,
        }),
    )

    const path: LatLng[] = route && route.length >= 2 ? route : [...(pickup ? [pickup] : []), ...(stops || []), ...(dropoff ? [dropoff] : [])]

    // Plain polyline (default, free).
    const drawPolyline = () => {
      rendererRef.current?.setMap(null)
      if (path.length < 2) {
        lineRef.current?.setMap(null)
        lineRef.current = null
        return
      }
      if (lineRef.current) lineRef.current.setPath(path)
      else lineRef.current = new g.maps.Polyline({ map, path, strokeColor: BLACK, strokeOpacity: 0.9, strokeWeight: 4, geodesic: true })
    }
    drawPolyline() // instant straight line; replaced by the road route below when it arrives
    if (USE_DIRECTIONS && path.length >= 2) {
      // Billed per route (Google Routes API); cached per pickup/dropoff/stops so re-renders never re-bill.
      fetchRoadRoute(path)
        .then((road) => {
          if (!road || !mapRef.current) return
          if (lineRef.current) lineRef.current.setPath(road)
          else lineRef.current = new g.maps.Polyline({ map, path: road, strokeColor: BLACK, strokeOpacity: 0.9, strokeWeight: 4 })
        })
        .catch(() => {})
    }

    if (!interactedRef.current) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, stopsKey, hasDriver, routeKey])

  // --- driver car: rotated to its heading (from the last two fixes) and gliding between polls
  useEffect(() => {
    const g = gRef.current
    const map = mapRef.current
    if (!ready || !g || !map) return
    cancelAnimRef.current?.()
    if (!driver) {
      markersRef.current.driver?.setMap(null)
      markersRef.current.driver = undefined
      driverPosRef.current = null
      lastFixRef.current = null
      return
    }
    const carIcon = (rotation: number) => ({ path: CAR_PATH, scale: 1.7, rotation, fillColor: BLACK, fillOpacity: 1, strokeColor: WHITE, strokeWeight: 1.5 })
    const previousFix = lastFixRef.current
    lastFixRef.current = driver
    if (previousFix && hasMoved(previousFix, driver)) headingRef.current = bearing(previousFix, driver)
    const from = driverPosRef.current
    if (!markersRef.current.driver) {
      markersRef.current.driver = new g.maps.Marker({ map, position: driver, zIndex: 5, icon: carIcon(headingRef.current) })
      driverPosRef.current = driver
    } else {
      markersRef.current.driver.setIcon(carIcon(headingRef.current))
      if (!from || isFarJump(from, driver)) {
        markersRef.current.driver.setPosition(driver)
        driverPosRef.current = driver
      } else {
        cancelAnimRef.current = animatePoint(from, driver, 3500, (point) => {
          markersRef.current.driver?.setPosition(point)
          driverPosRef.current = point
        })
      }
    }
    if (phase && !interactedRef.current) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, driver?.lat, driver?.lng])

  // Phase change (approach -> trip): resume following.
  useEffect(() => {
    if (!ready) return
    interactedRef.current = false
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase])

  // --- rider's own position
  useEffect(() => {
    const g = gRef.current
    const map = mapRef.current
    if (!ready || !g || !map) return
    if (!userLocation) {
      markersRef.current.user?.setMap(null)
      markersRef.current.user = undefined
      return
    }
    const icon = { path: g.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#276ef1', fillOpacity: 1, strokeColor: WHITE, strokeWeight: 3 }
    if (markersRef.current.user) markersRef.current.user.setPosition(userLocation)
    else markersRef.current.user = new g.maps.Marker({ map, position: userLocation, icon, zIndex: 1, clickable: false })
  }, [ready, userLocation?.lat, userLocation?.lng])

  // --- recenter / my location commands
  useEffect(() => {
    const g = gRef.current
    const map = mapRef.current
    if (!ready || !g || !map || !command) return
    if (command.type === 'center') {
      map.panTo(command.point)
      if ((map.getZoom() ?? 0) < 15) map.setZoom(15)
      return
    }
    interactedRef.current = false
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.n])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}
