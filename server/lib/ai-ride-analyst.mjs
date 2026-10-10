// Safety Phase 3 (2026-10-10): the AI trip-analysis layer. Reads a single ride's immutable black box
// (ordered RideEvent trail + metadata snapshot + Incident records + derived timings) and asks Claude
// for a plain-language SAFETY read: what happened, concrete safety concerns, a severity, and a short
// recommendation for the admin.
//
// ADVISORY ONLY. It never moves a ride, never touches pricing/fare/settlement, and is fully gated on
// ANTHROPIC_API_KEY: with no key set it makes ZERO API calls and returns a { configured:false }
// shape. Like ai-admin-assist.mjs it deliberately reuses the one Anthropic plumbing in
// ai-listing-review.mjs (key gating, model selection, callAnthropic retry/timeout, extractJsonObject,
// replyText) and mirrors the runAdminAiAssist caller pattern exactly.
//
// analyzeRide NEVER throws: every path is wrapped so it can be called from a request handler, an
// SOS fire-and-forget, or the anomaly sweep without any chance of breaking the surrounding flow.
import {
  aiReviewConfigured,
  aiReviewModel,
  callAnthropic,
  extractJsonObject,
  replyText,
} from './ai-listing-review.mjs'

export const AI_RIDE_ANALYST_MAX_TOKENS = 700
export const AI_RIDE_ANALYST_SEVERITIES = Object.freeze(['none', 'low', 'medium', 'high'])
// Keep the trail compact: only the most recent N events are described to the model.
export const AI_RIDE_ANALYST_MAX_EVENTS = 40

const clip = (value, max) => {
  if (value === undefined || value === null) return null
  const s = String(value).replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function eventTime(ev) {
  const raw = ev?.createdAt
  if (!raw) return null
  const d = raw instanceof Date ? raw : new Date(raw)
  const ms = d.getTime()
  return Number.isFinite(ms) ? ms : null
}

// Derives the actual trip duration (minutes) from the IN_PROGRESS -> COMPLETED/CANCELLED event
// timestamps. Returns null when the span cannot be determined. Never throws.
export function deriveActualMinutes(events) {
  try {
    const list = Array.isArray(events) ? events : []
    let startMs = null
    let endMs = null
    for (const ev of list) {
      const t = eventTime(ev)
      if (t === null) continue
      if (ev.type === 'IN_PROGRESS' && (startMs === null || t < startMs)) startMs = t
    }
    for (const ev of list) {
      const t = eventTime(ev)
      if (t === null) continue
      if ((ev.type === 'COMPLETED' || ev.type === 'CANCELLED') && (endMs === null || t > endMs)) endMs = t
    }
    if (startMs === null || endMs === null || endMs < startMs) return null
    return Math.round(((endMs - startMs) / 60000) * 10) / 10
  } catch {
    return null
  }
}

// Builds a COMPACT, secrets-free factual object for the model. No pickup code, no tokens, no raw
// identity data beyond the vehicle description and presence flags. Never throws.
export function buildRideFacts({ ride, events, incidents } = {}) {
  const meta = ride && typeof ride.metadata === 'object' && ride.metadata && !Array.isArray(ride.metadata) ? ride.metadata : {}
  const snapshot = meta.snapshot && typeof meta.snapshot === 'object' && !Array.isArray(meta.snapshot) ? meta.snapshot : {}
  const vehicle = snapshot.vehicle && typeof snapshot.vehicle === 'object' ? snapshot.vehicle : {}
  const driver = snapshot.driver && typeof snapshot.driver === 'object' ? snapshot.driver : {}
  const rider = snapshot.rider && typeof snapshot.rider === 'object' ? snapshot.rider : {}

  const eventList = Array.isArray(events) ? events.slice() : []
  // Order ascending by time, then keep only the most recent AI_RIDE_ANALYST_MAX_EVENTS.
  eventList.sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0))
  const trimmed = eventList.slice(-AI_RIDE_ANALYST_MAX_EVENTS)
  const baseMs = trimmed.length ? eventTime(trimmed[0]) : null
  const eventFacts = trimmed.map((ev) => {
    const t = eventTime(ev)
    const relSeconds = t !== null && baseMs !== null ? Math.round((t - baseMs) / 1000) : null
    return {
      type: String(ev?.type || 'UNKNOWN'),
      relativeSeconds: relSeconds,
      hasGps: ev?.lat != null && ev?.lng != null,
      actorRole: ev?.actorRole ? String(ev.actorRole) : null,
    }
  })

  const estimatedMinutes = num(meta.estimatedMinutes)
  const actualMinutes = deriveActualMinutes(events)

  const incidentFacts = (Array.isArray(incidents) ? incidents : []).map((inc) => {
    const m = inc && typeof inc.meta === 'object' && inc.meta && !Array.isArray(inc.meta) ? inc.meta : {}
    return {
      type: String(inc?.type || ''),
      status: String(inc?.status || ''),
      note: clip(inc?.note, 400),
      anomaly: m.anomaly ? String(m.anomaly) : null,
    }
  })

  return {
    rideStatus: clip(ride?.status, 40),
    category: clip(meta.category, 80),
    estimatedMinutes,
    actualMinutes,
    distanceKm: num(meta.distanceKm),
    vehicle: {
      make: clip(vehicle.make, 60),
      model: clip(vehicle.model, 60),
      year: clip(vehicle.year, 10),
      color: clip(vehicle.color, 40),
      plate: clip(vehicle.plate, 40),
    },
    driverPresent: Boolean(driver && (driver.displayName || driver.id)),
    riderPresent: Boolean(rider && (rider.displayName || rider.id)),
    eventCount: Array.isArray(events) ? events.length : 0,
    events: eventFacts,
    incidents: incidentFacts,
  }
}

export function buildRideAnalystSystemPrompt() {
  return [
    'You are a careful ride-SAFETY analyst for SYBNB, a ride-hailing platform operating in Syria.',
    'A human administrator is reviewing a single trip. You read the trip\'s black-box data (an ordered',
    'event trail, a snapshot of the driver/vehicle/rider, any incidents, and derived timings) and give',
    'a clear, cautious SAFETY read. You are ADVISORY ONLY: you never take any action.',
    '',
    'Rules:',
    '- Base everything strictly on the facts given. NEVER invent events, locations or history not in the data.',
    '- Summarize what happened on the trip in 2-4 plain, factual sentences.',
    '- List CONCRETE safety concerns tied to the facts (e.g. SOS pulled, ran far over the estimate, GPS',
    '  pings missing mid-trip, cancelled right after pickup). Use an empty array when nothing stands out.',
    '- If the data is thin (few events, no incidents, nothing unusual), say so plainly and use severity',
    '  "none" or "low". Reserve "high" for a clear, present safety risk such as an active SOS.',
    '- Keep the recommendation short and practical for the admin.',
    '',
    'Respond with ONLY a single JSON object and nothing else, in this exact shape:',
    '{"summary":"...","concerns":["..."],"severity":"none|low|medium|high","recommendation":"..."}',
  ].join('\n')
}

export function buildRideAnalystMessages({ facts, model }) {
  return {
    model,
    max_tokens: AI_RIDE_ANALYST_MAX_TOKENS,
    system: buildRideAnalystSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this trip for safety.\n\nTrip facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nReturn only the JSON object described in your instructions.`,
          },
        ],
      },
    ],
  }
}

const asString = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : null)

// Normalizes the model's object into the stored shape. Bad severity is coerced to 'low'; concerns is
// always an array of short strings; summary/recommendation are strings or null. Never throws.
export function validateRideAnalysis(obj) {
  const safe = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  const severityRaw = String(safe.severity || '').toLowerCase()
  const severity = AI_RIDE_ANALYST_SEVERITIES.includes(severityRaw) ? severityRaw : 'low'
  const concerns = Array.isArray(safe.concerns)
    ? safe.concerns.map((c) => asString(c, 300)).filter(Boolean).slice(0, 12)
    : []
  return {
    summary: asString(safe.summary, 2000),
    concerns,
    severity,
    recommendation: asString(safe.recommendation, 1000),
  }
}

// Returns, WITHOUT EVER THROWING:
//   { configured:false, summary:null, concerns:[], severity:'none', recommendation:null }  — no API key; zero calls
//   { configured:true, error:true, summary:null, concerns:[], severity:'none', recommendation:null } — any failure
//   { configured:true, summary, concerns, severity, recommendation, generatedAt }           — advisory analysis
export async function analyzeRide({ ride, events, incidents, env = process.env, fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  try {
    if (!aiReviewConfigured(env)) {
      return { configured: false, summary: null, concerns: [], severity: 'none', recommendation: null }
    }
    const model = aiReviewModel(env)
    const facts = buildRideFacts({ ride, events, incidents })
    const body = buildRideAnalystMessages({ facts, model })
    const response = await callAnthropic({ apiKey: String(env.ANTHROPIC_API_KEY).trim(), body, fetchImpl, timeoutMs })
    if (!response.ok) {
      return { configured: true, error: true, summary: null, concerns: [], severity: 'none', recommendation: null }
    }
    const raw = extractJsonObject(replyText(response.data))
    let parsed = null
    if (raw) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
    }
    const validated = validateRideAnalysis(parsed)
    return { configured: true, ...validated, generatedAt: new Date().toISOString() }
  } catch {
    return { configured: true, error: true, summary: null, concerns: [], severity: 'none', recommendation: null }
  }
}
