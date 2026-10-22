import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE_URL, ensureRtlText, pinEl } from './mapStyle'
import { fetchRoadRoute, linePath, pathKey } from './roadRoute'
import { animatePoint, bearing, carHtml, fitTargets, hasMoved, initialView, isFarJump, type LatLng, type RideMapProps } from './mapTypes'

/**
 * Ride map on MapLibre GL + OpenFreeMap (no key, no account). Same behaviour as before: pickup / dropoff /
 * numbered stop pins, a road-following route line (via our API), a live driver car that glides between polls,
 * the rider's own dot, tap / long-press to drop a pin, auto-follow until the rider moves the map by hand.
 */
export function MapLibreRideMap(props: RideMapProps) {
  const { pickup, dropoff, stops, driver, userLocation, dropTarget, onPick, command, onProviderFail, phase, route } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef<{ pickup?: maplibregl.Marker; dropoff?: maplibregl.Marker; driver?: maplibregl.Marker; user?: maplibregl.Marker; stops: maplibregl.Marker[] }>({ stops: [] })
  const driverPosRef = useRef<LatLng | null>(null)
  const lastFixRef = useRef<LatLng | null>(null)
  const headingRef = useRef(0)
  const carElRef = useRef<HTMLDivElement | null>(null)
  const interactedRef = useRef(false)
  const cancelAnimRef = useRef<(() => void) | null>(null)
  const latest = useRef(props)
  latest.current = props
  const dropTargetRef = useRef(dropTarget)
  const onPickRef = useRef(onPick)
  const onFailRef = useRef(onProviderFail)
  dropTargetRef.current = dropTarget
  onPickRef.current = onPick
  onFailRef.current = onProviderFail
  const [ready, setReady] = useState(false)

  function fit() {
    const map = mapRef.current
    if (!map) return
    const cur = latest.current
    if (cur.follow && cur.driver) {
      const d = driverPosRef.current || cur.driver
      map.easeTo({ center: [d.lng, d.lat], zoom: 16.5, bearing: headingRef.current, pitch: 50, duration: 900 })
      return
    }
    if (map.getPitch() !== 0 || map.getBearing() !== 0) map.easeTo({ pitch: 0, bearing: 0, duration: 300 })
    const points = fitTargets(cur)
    if (points.length >= 2) {
      const b = new maplibregl.LngLatBounds()
      points.forEach((p) => b.extend([p.lng, p.lat]))
      map.fitBounds(b, { padding: { top: 56, left: 40, right: 40, bottom: 90 }, maxZoom: 16, duration: 400 })
    } else if (points.length === 1) {
      map.easeTo({ center: [points[0].lng, points[0].lat], zoom: 15.5, duration: 400 })
    }
  }

  useEffect(() => {
    if (!containerRef.current) return
    const view = initialView()
    ensureRtlText()
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: [view.center.lng, view.center.lat],
        zoom: view.zoom,
        attributionControl: { compact: true },
        keyboard: false,
      })
    } catch {
      onFailRef.current?.()
      return
    }
    map.on('error', (e) => {
      // A broken style (blocked network) means no map at all: tell the wrapper. Single missing tiles are ignored.
      const status = (e as { error?: { status?: number } }).error?.status
      if (!map.isStyleLoaded() && (status === undefined || status >= 400)) onFailRef.current?.()
    })
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9, 'line-opacity': 0.9 } })
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.88 } })
      // Dotted connectors: the road route starts/ends on the nearest road, so join it to the actual pins.
      map.addSource('route-ends', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'route-ends', type: 'line', source: 'route-ends', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#000', 'line-width': 3, 'line-opacity': 0.7, 'line-dasharray': [0.5, 2] } })
      mapRef.current = map
      setReady(true)
    })
    map.on('click', (e) => {
      const target = dropTargetRef.current
      if (target) onPickRef.current?.(target, { lat: e.lngLat.lat, lng: e.lngLat.lng })
    })
    map.on('contextmenu', (e) => onPickRef.current?.(dropTargetRef.current || 'dropoff', { lat: e.lngLat.lat, lng: e.lngLat.lng }))
    // Long-press on touch screens
    let pressTimer = 0
    const clear = () => window.clearTimeout(pressTimer)
    map.on('touchstart', (e) => {
      if (e.originalEvent.touches.length !== 1) return
      clear()
      pressTimer = window.setTimeout(() => onPickRef.current?.(dropTargetRef.current || 'dropoff', { lat: e.lngLat.lat, lng: e.lngLat.lng }), 650)
    })
    ;['touchend', 'touchmove', 'touchcancel', 'dragstart', 'zoomstart'].forEach((ev) => map.on(ev as 'touchend', clear))
    map.on('dragstart', () => {
      interactedRef.current = true
    })
    map.on('wheel', () => {
      interactedRef.current = true
    })
    return () => {
      clear()
      cancelAnimRef.current?.()
      markers.current = { stops: [] }
      mapRef.current = null
      map.remove()
    }
  }, [])

  const stopsKey = JSON.stringify(stops || [])
  const hasDriver = Boolean(driver)
  const livePath = linePath({ pickup, dropoff, stops, driver, phase, route })
  const routeKey = pathKey(livePath)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const put = (key: 'pickup' | 'dropoff', point: LatLng | null | undefined) => {
      const existing = markers.current[key]
      if (!point) {
        existing?.remove()
        markers.current[key] = undefined
        return
      }
      if (existing) existing.setLngLat([point.lng, point.lat])
      else markers.current[key] = new maplibregl.Marker({ element: pinEl(key) }).setLngLat([point.lng, point.lat]).addTo(map)
    }
    put('pickup', pickup)
    put('dropoff', dropoff)
    markers.current.stops.forEach((m) => m.remove())
    markers.current.stops = (stops || []).map((p, i) => new maplibregl.Marker({ element: pinEl('stop', String(i + 1)) }).setLngLat([p.lng, p.lat]).addTo(map))

    const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined
    const setLine = (pts: LatLng[]) => src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) } })
    const endsSrc = map.getSource('route-ends') as maplibregl.GeoJSONSource | undefined
    const setEnds = (pairs: Array<[LatLng, LatLng]>) =>
      endsSrc?.setData({
        type: 'FeatureCollection',
        features: pairs.map(([a, b]) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } })),
      })
    const path = livePath
    let cancelled = false
    const controller = new AbortController()
    // Plain line is only the instant fallback; during a live ride the previous road line stays until the new one arrives.
    if (path.length < 2) {
      setLine([])
      setEnds([])
    } else if (!phase) {
      setLine(path)
      setEnds([])
    }
    if (path.length >= 2) {
      void fetchRoadRoute(path, controller.signal).then((road) => {
        if (!road || cancelled || !mapRef.current) return
        setLine(road)
        setEnds([
          [path[0], road[0]],
          [road[road.length - 1], path[path.length - 1]],
        ])
      })
    }
    if (!interactedRef.current) fit()
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, stopsKey, hasDriver, routeKey])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    cancelAnimRef.current?.()
    if (!driver) {
      markers.current.driver?.remove()
      markers.current.driver = undefined
      carElRef.current = null
      driverPosRef.current = null
      lastFixRef.current = null
      return
    }
    const previous = lastFixRef.current
    lastFixRef.current = driver
    if (previous && hasMoved(previous, driver)) headingRef.current = bearing(previous, driver)
    const from = driverPosRef.current
    if (!markers.current.driver) {
      const el = document.createElement('div')
      el.innerHTML = carHtml(latest.current.follow ? 0 : headingRef.current)
      carElRef.current = el
      markers.current.driver = new maplibregl.Marker({ element: el }).setLngLat([driver.lng, driver.lat]).addTo(map)
      driverPosRef.current = driver
    } else {
      const inner = carElRef.current?.firstElementChild as HTMLElement | null
      if (inner) inner.style.transform = `rotate(${Math.round(latest.current.follow ? 0 : headingRef.current)}deg)`
      if (!from || isFarJump(from, driver)) {
        markers.current.driver.setLngLat([driver.lng, driver.lat])
        driverPosRef.current = driver
      } else {
        cancelAnimRef.current = animatePoint(from, driver, 3500, (p) => {
          markers.current.driver?.setLngLat([p.lng, p.lat])
          driverPosRef.current = p
        })
      }
    }
    if ((phase || latest.current.follow) && !interactedRef.current) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, driver?.lat, driver?.lng])

  useEffect(() => {
    if (!ready) return
    interactedRef.current = false
    const inner = carElRef.current?.firstElementChild as HTMLElement | null
    if (inner) inner.style.transform = `rotate(${Math.round(props.follow ? 0 : headingRef.current)}deg)`
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase, props.follow])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (!userLocation) {
      markers.current.user?.remove()
      markers.current.user = undefined
      return
    }
    if (markers.current.user) markers.current.user.setLngLat([userLocation.lng, userLocation.lat])
    else markers.current.user = new maplibregl.Marker({ element: pinEl('user') }).setLngLat([userLocation.lng, userLocation.lat]).addTo(map)
  }, [ready, userLocation?.lat, userLocation?.lng])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !command) return
    if (command.type === 'center') {
      map.easeTo({ center: [command.point.lng, command.point.lat], zoom: Math.max(map.getZoom(), 15), duration: 400 })
      return
    }
    interactedRef.current = false
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.n])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}
