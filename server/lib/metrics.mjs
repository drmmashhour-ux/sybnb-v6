// Production metrics in Prometheus text format (scale, 2026-10-22). Process-local counters and
// histograms (each replica exposes its own; the scraper sums them), plus a few gauges read from the
// database on scrape and cached for 10 s so scraping can never load the DB.
//
// Exposed at GET /api/metrics only when METRICS_TOKEN is set, and only to a caller presenting it as
// "Authorization: Bearer <token>". Nothing here carries personal or payment data: routes are
// normalised (ids replaced with :id), and only counts, durations and machine codes are recorded.
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { db } from './prisma.mjs'

const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]
const MATCH_BUCKETS_S = [5, 10, 20, 30, 60, 120, 300, 600, 1800]

const histograms = new Map() // key -> { labels, buckets[], sum, count }
const counters = new Map() // key -> { name, labels, value }
let inFlight = 0
const loopDelay = monitorEventLoopDelay({ resolution: 20 })
loopDelay.enable()

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
export function routeOf(pathname) {
  return String(pathname || '/')
    .replace(UUID, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 80)
}

const labelStr = (labels) =>
  Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_')}"`)
    .join(',')

function observe(name, labels, value, buckets) {
  const key = `${name}{${labelStr(labels)}}`
  let h = histograms.get(key)
  if (!h) histograms.set(key, (h = { name, labels, buckets: buckets.map(() => 0), bounds: buckets, sum: 0, count: 0 }))
  for (let i = 0; i < buckets.length; i++) if (value <= buckets[i]) h.buckets[i] += 1
  h.sum += value
  h.count += 1
}

export function inc(name, labels = {}, by = 1) {
  const key = `${name}{${labelStr(labels)}}`
  const c = counters.get(key)
  if (c) c.value += by
  else counters.set(key, { name, labels, value: by })
}

export function requestStarted() {
  inFlight += 1
}

export function requestFinished({ method, pathname, status, durationMs }) {
  inFlight = Math.max(0, inFlight - 1)
  const route = routeOf(pathname)
  observe('http_request_duration_ms', { method, route }, durationMs, BUCKETS_MS)
  inc('http_requests_total', { method, route, class: `${Math.floor(Number(status) / 100)}xx` })
}

export function observeMatchSeconds(seconds) {
  if (Number.isFinite(seconds) && seconds >= 0) observe('ride_match_seconds', {}, seconds, MATCH_BUCKETS_S)
}

let gaugeCache = { at: 0, text: '' }
async function dbGauges() {
  if (Date.now() - gaugeCache.at < 10_000) return gaugeCache.text
  const lines = []
  try {
    const [g] = await db().$queryRaw`
      SELECT
        (SELECT count(*)::int FROM driver_profiles WHERE last_location_updated_at >= now() - interval '120 seconds') AS "onlineDrivers",
        (SELECT count(*)::int FROM ride_requests WHERE driver_id IS NULL AND status IN ('REQUESTED','MATCHING')) AS "openRides",
        (SELECT count(*)::int FROM ride_requests WHERE driver_id IS NULL AND status IN ('REQUESTED','MATCHING') AND requested_at < now() - interval '2 minutes') AS "openRidesOver2m",
        (SELECT count(*)::int FROM ride_requests WHERE status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS')) AS "liveRides",
        (SELECT count(*)::int FROM ride_requests WHERE requested_at >= now() - interval '5 minutes') AS "ridesLast5m",
        (SELECT count(*)::int FROM payment_events WHERE processing_status::text IN ('FAILED','DEAD_LETTERED','QUARANTINED')) AS "paymentEventsFailed",
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS "dbConnections",
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS "dbActive",
        (SELECT coalesce(max(extract(epoch FROM now() - query_start)), 0)::float FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS "dbLongestQueryS"
    `
    lines.push(`# TYPE sr_online_drivers gauge\nsr_online_drivers ${g.onlineDrivers}`)
    lines.push(`# TYPE sr_open_rides gauge\nsr_open_rides ${g.openRides}`)
    lines.push(`# TYPE sr_open_rides_waiting_over_2m gauge\nsr_open_rides_waiting_over_2m ${g.openRidesOver2m}`)
    lines.push(`# TYPE sr_live_rides gauge\nsr_live_rides ${g.liveRides}`)
    lines.push(`# TYPE sr_ride_requests_last_5m gauge\nsr_ride_requests_last_5m ${g.ridesLast5m}`)
    lines.push(`# TYPE payment_events_failed gauge\npayment_events_failed ${g.paymentEventsFailed}`)
    lines.push(`# TYPE db_connections gauge\ndb_connections ${g.dbConnections}`)
    lines.push(`# TYPE db_active_queries gauge\ndb_active_queries ${g.dbActive}`)
    lines.push(`# TYPE db_longest_active_query_seconds gauge\ndb_longest_active_query_seconds ${Number(g.dbLongestQueryS).toFixed(3)}`)
    lines.push(`# TYPE db_up gauge\ndb_up 1`)
  } catch {
    lines.push(`# TYPE db_up gauge\ndb_up 0`)
  }
  gaugeCache = { at: Date.now(), text: lines.join('\n') }
  return gaugeCache.text
}

export async function renderMetrics(extra = {}) {
  const out = []
  const byName = new Map()
  for (const h of histograms.values()) {
    if (!byName.has(h.name)) byName.set(h.name, [])
    byName.get(h.name).push(h)
  }
  for (const [name, hs] of byName) {
    out.push(`# TYPE ${name} histogram`)
    for (const h of hs) {
      const base = labelStr(h.labels)
      h.bounds.forEach((b, i) => out.push(`${name}_bucket{${base}${base ? ',' : ''}le="${b}"} ${h.buckets[i]}`))
      out.push(`${name}_bucket{${base}${base ? ',' : ''}le="+Inf"} ${h.count}`)
      out.push(`${name}_sum{${base}} ${h.sum.toFixed(1)}`)
      out.push(`${name}_count{${base}} ${h.count}`)
    }
  }
  const seen = new Set()
  for (const c of counters.values()) {
    if (!seen.has(c.name)) { out.push(`# TYPE ${c.name} counter`); seen.add(c.name) }
    out.push(`${c.name}{${labelStr(c.labels)}} ${c.value}`)
  }
  out.push(`# TYPE http_in_flight_requests gauge\nhttp_in_flight_requests ${inFlight}`)
  out.push(`# TYPE event_loop_delay_p99_ms gauge\nevent_loop_delay_p99_ms ${(loopDelay.percentile(99) / 1e6).toFixed(1)}`)
  out.push(`# TYPE process_resident_memory_bytes gauge\nprocess_resident_memory_bytes ${process.memoryUsage().rss}`)
  for (const [k, v] of Object.entries(extra)) {
    if (Number.isFinite(Number(v))) out.push(`# TYPE ${k} gauge\n${k} ${Number(v)}`)
  }
  out.push(await dbGauges())
  return out.join('\n') + '\n'
}

export function metricsAuthorized(req, env = process.env) {
  const token = String(env.METRICS_TOKEN || '')
  if (token.length < 16) return false
  return String(req.headers.authorization || '') === `Bearer ${token}`
}
