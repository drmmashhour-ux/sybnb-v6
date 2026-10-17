// Offline-first GPS buffer: fixes that could not be sent (no signal) are kept on the device and
// uploaded in one batch when the connection returns. Pure helpers take a storage object so they are testable.
export type QueuedFix = { lat: number; lng: number; at: string }
export const GPS_QUEUE_KEY = 'sybnb.driver.gpsQueue.v1'
export const GPS_QUEUE_MAX = 200

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readQueue(store: Store): QueuedFix[] {
  try {
    const raw = JSON.parse(store.getItem(GPS_QUEUE_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && typeof p.at === 'string') : []
  } catch { return [] }
}

export function enqueueFix(store: Store, fix: QueuedFix): number {
  const q = [...readQueue(store), fix].slice(-GPS_QUEUE_MAX)
  try { store.setItem(GPS_QUEUE_KEY, JSON.stringify(q)) } catch { /* storage full/blocked: drop */ }
  return q.length
}

export function clearQueue(store: Store) {
  try { store.removeItem(GPS_QUEUE_KEY) } catch { /* ignore */ }
}
