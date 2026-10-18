import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { animatePoint, bearing, carHtml, fitTargets, hasMoved, initialView, isFarJump, type LatLng, type RideMapProps } from './mapTypes'

/**
 * Keyless fallback map (Leaflet + OpenStreetMap tiles -- the same stack as the platform's RideMap).
 * The platform RideMap has no tap-to-drop-pin, no route line, no smooth driver movement and a fixed
 * pixel height, so this app keeps its own small Leaflet view with the same custom divIcon approach
 * (no marker PNGs, which break under bundlers). Used when no Google key is configured or Google fails.
 *
 * Pins are (re)drawn whenever their coordinates change -- including coordinates that arrive from the
 * server after the map has mounted -- and the camera is re-fitted. A ResizeObserver re-measures the
 * map when its box changes (Leaflet computes a wrong view if it was sized while hidden/zero-height).
 */
const dot = (bg: string, size: number, round = true, text = '') =>
  L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:${round ? '50%' : '2px'};background:${bg};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);color:#fff;font:700 11px/${size - 6}px system-ui;text-align:center">${text}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

const carIcon = (heading: number) => L.divIcon({ className: '', html: carHtml(heading), iconSize: [30, 30], iconAnchor: [15, 15] })

export function LeafletRideMap(props: RideMapProps) {
  const { pickup, dropoff, stops, driver, userLocation, dropTarget, onPick, command, phase } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<{ pickup?: L.Marker; dropoff?: L.Marker; driver?: L.Marker; user?: L.Marker; line?: L.Polyline; stops: L.Marker[] }>({ stops: [] })
  const driverPosRef = useRef<LatLng | null>(null)
  const lastFixRef = useRef<LatLng | null>(null)
  const headingRef = useRef(0)
  const cancelAnimRef = useRef<(() => void) | null>(null)
  const interactedRef = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const dropTargetRef = useRef(dropTarget)
  const onPickRef = useRef(onPick)
  dropTargetRef.current = dropTarget
  onPickRef.current = onPick

  function fit() {
    const map = mapRef.current
    if (!map) return
    const size = map.getSize()
    if (size.x === 0 || size.y === 0) return
    const points = fitTargets(latest.current).map((p) => [p.lat, p.lng] as [number, number])
    if (points.length >= 2) map.fitBounds(points, { paddingTopLeft: [40, 56], paddingBottomRight: [40, 90], maxZoom: 17 })
    else if (points.length === 1) map.setView(points[0], 15)
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const container = containerRef.current
    const view = initialView()
    const map = L.map(container, { attributionControl: true, zoomControl: false }).setView([view.center.lat, view.center.lng], view.zoom)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) => {
      const target = dropTargetRef.current
      if (target) onPickRef.current?.(target, { lat: event.latlng.lat, lng: event.latlng.lng })
    })
    // Long-press on touch devices and right-click both raise 'contextmenu' in Leaflet.
    map.on('contextmenu', (event: L.LeafletMouseEvent) => {
      onPickRef.current?.(dropTargetRef.current || 'dropoff', { lat: event.latlng.lat, lng: event.latlng.lng })
    })
    // A hand pan / zoom switches off auto-follow until the rider presses recenter.
    const markInteracted = () => {
      interactedRef.current = true
    }
    container.addEventListener('pointerdown', markInteracted)
    container.addEventListener('wheel', markInteracted, { passive: true })
    mapRef.current = map
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        map.invalidateSize({ animate: false })
        if (!interactedRef.current) fit()
      })
      observer.observe(container)
    }
    return () => {
      observer?.disconnect()
      container.removeEventListener('pointerdown', markInteracted)
      container.removeEventListener('wheel', markInteracted)
      cancelAnimRef.current?.()
      map.remove()
      mapRef.current = null
      // StrictMode mount -> cleanup -> mount: stale marker refs would point at the destroyed map.
      layersRef.current = { stops: [] }
      driverPosRef.current = null
      lastFixRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopsKey = JSON.stringify(stops || [])
  const hasDriver = Boolean(driver)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layers = layersRef.current
    const upsert = (key: 'pickup' | 'dropoff', point: LatLng | null | undefined, icon: L.DivIcon) => {
      const existing = layers[key]
      if (!point) {
        if (existing) map.removeLayer(existing)
        layers[key] = undefined
        return
      }
      if (existing) existing.setLatLng([point.lat, point.lng])
      else layers[key] = L.marker([point.lat, point.lng], { icon, keyboard: false }).addTo(map)
    }
    upsert('pickup', pickup, dot('#000', 20))
    upsert('dropoff', dropoff, dot('#000', 20, false))
    layers.stops.forEach((marker) => map.removeLayer(marker))
    layers.stops = (stops || []).map((point, index) => L.marker([point.lat, point.lng], { icon: dot('#6b6b6b', 22, true, String(index + 1)), keyboard: false }).addTo(map))

    const path: LatLng[] = [...(pickup ? [pickup] : []), ...(stops || []), ...(dropoff ? [dropoff] : [])]
    if (layers.line) {
      map.removeLayer(layers.line)
      layers.line = undefined
    }
    if (path.length >= 2) layers.line = L.polyline(path.map((p) => [p.lat, p.lng] as [number, number]), { color: '#000', weight: 4, opacity: 0.9 }).addTo(map)

    map.invalidateSize({ animate: false })
    if (!interactedRef.current) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, stopsKey, hasDriver])

  // Driver car: rotated to its heading (from the last two fixes) and gliding between polls.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layers = layersRef.current
    cancelAnimRef.current?.()
    if (!driver) {
      if (layers.driver) map.removeLayer(layers.driver)
      layers.driver = undefined
      driverPosRef.current = null
      lastFixRef.current = null
      return
    }
    const previousFix = lastFixRef.current
    lastFixRef.current = driver
    let rotated = false
    if (previousFix && hasMoved(previousFix, driver)) {
      const next = bearing(previousFix, driver)
      rotated = Math.abs(next - headingRef.current) > 3
      headingRef.current = next
    }
    const from = driverPosRef.current
    if (!layers.driver) {
      layers.driver = L.marker([driver.lat, driver.lng], { icon: carIcon(headingRef.current), zIndexOffset: 500, keyboard: false }).addTo(map)
      driverPosRef.current = driver
    } else {
      if (rotated) layers.driver.setIcon(carIcon(headingRef.current))
      if (!from || isFarJump(from, driver)) {
        layers.driver.setLatLng([driver.lat, driver.lng])
        driverPosRef.current = driver
      } else {
        cancelAnimRef.current = animatePoint(from, driver, 3500, (point) => {
          layers.driver?.setLatLng([point.lat, point.lng])
          driverPosRef.current = point
        })
      }
    }
    if (phase && !interactedRef.current) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.lat, driver?.lng])

  // Phase change (approach -> trip): resume following.
  useEffect(() => {
    interactedRef.current = false
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layers = layersRef.current
    if (!userLocation) {
      if (layers.user) map.removeLayer(layers.user)
      layers.user = undefined
      return
    }
    if (layers.user) layers.user.setLatLng([userLocation.lat, userLocation.lng])
    else layers.user = L.marker([userLocation.lat, userLocation.lng], { icon: dot('#276ef1', 16), interactive: false, keyboard: false }).addTo(map)
  }, [userLocation?.lat, userLocation?.lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !command) return
    if (command.type === 'center') {
      map.setView([command.point.lat, command.point.lng], Math.max(map.getZoom(), 15))
      return
    }
    interactedRef.current = false
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.n])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}
