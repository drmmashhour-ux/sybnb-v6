export type LatLng = { lat: number; lng: number }

export type DropTarget = 'pickup' | 'dropoff'

/** One-shot instruction to the map: fit every pin, or centre on a point (e.g. the rider's position). */
export type MapCommand = { n: number; type: 'fit' } | { n: number; type: 'center'; point: LatLng }

export interface RideMapProps {
  pickup?: LatLng | null
  dropoff?: LatLng | null
  stops?: LatLng[]
  /** Live driver position (only present while the ride is live; the server drops stale fixes). */
  driver?: LatLng | null
  /** The rider's own position, when known (blue dot). */
  userLocation?: LatLng | null
  /** When set, a plain tap on the map drops that pin. Long-press / right-click always drops `dropTarget ?? 'dropoff'`. */
  dropTarget?: DropTarget | null
  onPick?: (target: DropTarget, point: LatLng) => void
  command?: MapCommand | null
  /** Called when this provider cannot work (script error, bad key, ...) so the wrapper can fall back. */
  onProviderFail?: () => void
  /**
   * Live-ride camera mode. 'approach': keep pickup + driver in view while the driver is coming.
   * 'trip': follow driver -> dropoff while the ride is in progress. Auto-follow stops once the rider
   * pans/zooms by hand, until they press recenter. Omit for the booking screen.
   */
  phase?: 'approach' | 'trip' | null
  /** Explicit route to draw (e.g. driver -> pickup). Pins stay pickup/dropoff. Omit for pickup -> stops -> dropoff. */
  route?: LatLng[] | null
  /** Navigation mode: camera follows the driver, heading-up and tilted (in-app turn-by-turn). */
  follow?: boolean
}

/** Neutral initial view when nothing is known yet: no country is baked in. */
// Rezekme opens on Syria (Damascus-centred); a rider's GPS fix is used only when it is inside Syria.
const WORLD_VIEW: LatLng = { lat: 34.8, lng: 38.5 }
const inSyria = (p: LatLng) => p.lat > 32 && p.lat < 37.5 && p.lng > 35.5 && p.lng < 42.5

const LAST_POS_KEY = 'sr.lastKnownPosition'

export function rememberPosition(point: LatLng) {
  try {
    window.localStorage.setItem(LAST_POS_KEY, JSON.stringify(point))
  } catch {
    /* storage blocked: harmless */
  }
}

function parsePoint(raw: string | null | undefined): LatLng | null {
  if (!raw) return null
  const [lat, lng] = raw.split(',').map((part) => Number(part.trim()))
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

/** Initial centre + zoom when there are no pins: last known GPS fix, else VITE_MAPS_DEFAULT_CENTER ("lat,lng"), else a world view. */
export function initialView(): { center: LatLng; zoom: number } {
  try {
    const stored = window.localStorage.getItem(LAST_POS_KEY)
    if (stored) {
      const point = JSON.parse(stored) as LatLng
      if (Number.isFinite(point.lat) && Number.isFinite(point.lng) && inSyria(point)) return { center: point, zoom: 13 }
    }
  } catch {
    /* ignore */
  }
  const configured = parsePoint(import.meta.env.VITE_MAPS_DEFAULT_CENTER as string | undefined)
  if (configured && inSyria(configured)) return { center: configured, zoom: 11 }
  return { center: WORLD_VIEW, zoom: 7 }
}

/**
 * Smoothly move between two polls: interpolates from -> to over `ms` and calls `onFrame` each frame.
 * Returns a cancel function. The driver position only arrives every ~4 s; without this the car jumps.
 */
export function animatePoint(from: LatLng, to: LatLng, ms: number, onFrame: (point: LatLng) => void): () => void {
  let raf = 0
  let cancelled = false
  const start = performance.now()
  const step = (now: number) => {
    if (cancelled) return
    const k = Math.min(1, (now - start) / ms)
    onFrame({ lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k })
    if (k < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => {
    cancelled = true
    cancelAnimationFrame(raf)
  }
}

/** Great-circle-free quick check used to skip animating huge teleports (> ~2 km): snap instead. */
export function isFarJump(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) > 0.02 || Math.abs(a.lng - b.lng) > 0.02
}

/** Initial compass bearing in degrees (0 = north, clockwise) from a to b. */
export function bearing(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180
  const dLng = (b.lng - a.lng) * rad
  const y = Math.sin(dLng) * Math.cos(b.lat * rad)
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/** True when two fixes differ enough (~1 m) for a heading to mean something. */
export function hasMoved(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) > 0.00001 || Math.abs(a.lng - b.lng) > 0.00001
}

/** Top-down car outline (nose pointing up, centred on 0,0), drawn for this app. Used by both maps. */
export const CAR_PATH = 'M -3.7 -10.2 C -3.7 -11.8 3.7 -11.8 3.7 -10.2 L 4.5 -6 L 4.5 7.2 C 4.5 10.4 -4.5 10.4 -4.5 7.2 L -4.5 -6 Z'

/** Same car as an HTML snippet for Leaflet divIcons, rotated to `heading` degrees. */
export function carHtml(heading: number): string {
  // Top-down car (not a navigation arrow): body, four wheels, side mirrors, windscreen, rear glass, headlights.
  return `<div style="width:44px;height:44px;transform:rotate(${Math.round(heading)}deg);transition:transform .4s linear;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))"><svg viewBox="-10 -13 20 26" width="44" height="44">
<rect x="-5.9" y="-7.4" width="2" height="4.2" rx=".8" fill="#000"/><rect x="3.9" y="-7.4" width="2" height="4.2" rx=".8" fill="#000"/>
<rect x="-5.9" y="3.2" width="2" height="4.2" rx=".8" fill="#000"/><rect x="3.9" y="3.2" width="2" height="4.2" rx=".8" fill="#000"/>
<rect x="-5.6" y="-4.4" width="1.8" height="1.6" rx=".6" fill="#111"/><rect x="3.8" y="-4.4" width="1.8" height="1.6" rx=".6" fill="#111"/>
<path d="M -3.7 -10.2 C -3.7 -11.8 3.7 -11.8 3.7 -10.2 L 4.5 -6 L 4.5 7.2 C 4.5 10.4 -4.5 10.4 -4.5 7.2 L -4.5 -6 Z" fill="#1c1c1e" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>
<path d="M -3.2 -5.6 L 3.2 -5.6 L 3.8 -2 L -3.8 -2 Z" fill="#a9c7e4"/><path d="M -3.3 3.6 L 3.3 3.6 L 3.1 6.2 L -3.1 6.2 Z" fill="#a9c7e4"/>
<rect x="-3.2" y="-1.6" width="6.4" height="4.8" rx="1" fill="#2c2c2e"/>
<circle cx="-2.7" cy="-10.1" r=".8" fill="#ffe27a"/><circle cx="2.7" cy="-10.1" r=".8" fill="#ffe27a"/>
</svg></div>`
}

/** Coerce server-provided coordinates (numbers or numeric strings) to a clean point, or null. */
export function toPoint(value: { lat?: unknown; lng?: unknown } | null | undefined): LatLng | null {
  if (!value) return null
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/** Which points the camera should frame, given the live-ride phase (see RideMapProps.phase). */
export function fitTargets(p: Pick<RideMapProps, 'pickup' | 'dropoff' | 'stops' | 'driver' | 'phase'>): LatLng[] {
  const all = [...(p.pickup ? [p.pickup] : []), ...(p.stops || []), ...(p.dropoff ? [p.dropoff] : []), ...(p.driver ? [p.driver] : [])]
  if (p.phase === 'approach') {
    if (p.driver && p.pickup) return [p.pickup, p.driver]
    return all
  }
  if (p.phase === 'trip') {
    if (p.driver && p.dropoff) return [p.driver, p.dropoff]
    return all
  }
  return all
}
