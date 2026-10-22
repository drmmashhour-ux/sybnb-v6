import type { LatLng, RideMapProps } from './mapTypes'

/**
 * Road-following route for the map line. Asks OUR API (/api/sr/route), which caches and talks to the routing
 * provider server-side (no key in the app). Returns null when no road route is available; callers then keep a
 * plain line so the map never breaks.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'
const cache = new Map<string, LatLng[] | null>()

export const pathKey = (path: LatLng[]) => path.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|')

/**
 * Which points the line should join. During a live ride it starts at the DRIVER (driver -> pickup while arriving,
 * driver -> stops -> dropoff during the trip); otherwise pickup -> stops -> dropoff. An explicit `route` wins.
 */
export function linePath(p: Pick<RideMapProps, 'pickup' | 'dropoff' | 'stops' | 'driver' | 'phase' | 'route'>): LatLng[] {
  if (p.route && p.route.length >= 2) return p.route
  const stops = p.stops || []
  if (p.phase === 'approach' && p.driver && p.pickup) return [p.driver, p.pickup]
  if (p.phase === 'trip' && p.driver && p.dropoff) return [p.driver, ...stops, p.dropoff]
  return [...(p.pickup ? [p.pickup] : []), ...stops, ...(p.dropoff ? [p.dropoff] : [])]
}

export async function fetchRoadRoute(path: LatLng[], signal?: AbortSignal): Promise<LatLng[] | null> {
  if (path.length < 2 || path.length > 8) return null
  const key = path.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
  if (cache.has(key)) return cache.get(key) ?? null
  const timeout = new AbortController()
  const timer = window.setTimeout(() => timeout.abort(), 9000)
  signal?.addEventListener('abort', () => timeout.abort())
  try {
    const pts = path.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')
    const response = await fetch(`${API_BASE_URL}/api/sr/route?pts=${encodeURIComponent(pts)}`, { signal: timeout.signal })
    if (!response.ok) return null
    const data = (await response.json()) as { points?: Array<[number, number]> | null }
    const road = Array.isArray(data.points) && data.points.length >= 2 ? data.points.map(([lat, lng]) => ({ lat, lng })) : null
    if (road) {
      if (cache.size > 200) cache.delete(cache.keys().next().value as string)
      cache.set(key, road)
    }
    return road
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export type NavStep = { lat: number; lng: number; type: string; modifier: string; exit: number | null; name: string; distanceM: number }
export type NavRoute = { points: LatLng[]; steps: NavStep[]; distanceM: number | null; durationS: number | null }

/** Road route WITH turn-by-turn steps, for the in-app driver navigation. Not cached: it is re-asked as the car moves. */
export async function fetchNavRoute(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<NavRoute | null> {
  const timeout = new AbortController()
  const timer = window.setTimeout(() => timeout.abort(), 9000)
  signal?.addEventListener('abort', () => timeout.abort())
  try {
    const pts = [from, to].map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')
    const response = await fetch(`${API_BASE_URL}/api/sr/route?pts=${encodeURIComponent(pts)}`, { signal: timeout.signal })
    if (!response.ok) return null
    const data = (await response.json()) as { points?: Array<[number, number]> | null; steps?: NavStep[]; distanceM?: number | null; durationS?: number | null }
    if (!Array.isArray(data.points) || data.points.length < 2) return null
    return {
      points: data.points.map(([lat, lng]) => ({ lat, lng })),
      steps: Array.isArray(data.steps) ? data.steps : [],
      distanceM: typeof data.distanceM === 'number' ? data.distanceM : null,
      durationS: typeof data.durationS === 'number' ? data.durationS : null,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
