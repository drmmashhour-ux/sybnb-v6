// Offline-first driver telemetry: a driver's phone buffers GPS fixes while it has no signal and
// uploads them in one batch when the connection returns. These helpers are pure so the rules
// (what is believable, what is kept) are unit-tested.
export const MAX_BATCH_POINTS = 200
export const MAX_AGE_MS = 2 * 60 * 60 * 1000 // ignore fixes older than 2 h
export const LIVE_POSITION_MAX_AGE_MS = 15 * 60 * 1000 // only a fix this fresh may move the live map pin

// Returns valid points sorted oldest -> newest. Drops invalid coordinates, bad/future/too-old times.
export function normalizePoints(raw, nowMs = Date.now()) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const p of raw.slice(0, MAX_BATCH_POINTS)) {
    const lat = Number(p?.lat)
    const lng = Number(p?.lng)
    const at = Date.parse(p?.at)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) continue
    if (!Number.isFinite(at) || at > nowMs + 60_000 || nowMs - at > MAX_AGE_MS) continue
    out.push({ lat, lng, at: Math.min(at, nowMs) })
  }
  return out.sort((a, b) => a.at - b.at)
}

// Keep at most one point per `minGapMs`, and at most `max` points overall (the newest are kept).
export function thinPoints(points, minGapMs, max) {
  const kept = []
  let last = -Infinity
  for (const p of points) {
    if (p.at - last >= minGapMs) { kept.push(p); last = p.at }
  }
  return kept.slice(-max)
}
