// Sanctions/watchlist screening adapter. Architecture-audit follow-up (Module 2.1) — same
// provider-swap seam as sms.mjs, deliberately not wired into any live route yet.
//
// This module makes NO claim about what "sanctioned" means for any market, country, or point in
// time — that determination is a legal/counsel review (see countries/<country>/profile.mjs's
// externalGates, which already names "sanctions/export compliance review" as required and
// unconfirmed). This is infrastructure for enforcing WHATEVER that determination turns out to be,
// once a real screening vendor is contracted and this module's real provider branch is wired up.
//
// Selection via env SANCTIONS_PROVIDER:
//   'sandbox' (default) — deterministic, real (not mocked): decides CLEARED/POTENTIAL_MATCH/
//                         HARD_MATCH/a simulated provider failure purely from fixed trigger
//                         substrings in the checked name, documented below. No network call, no
//                         real watchlist data — for local/dev/staging only.
//   'http'              — POSTs to a generic screening-vendor endpoint. Requires
//                         SANCTIONS_HTTP_ENDPOINT and SANCTIONS_API_KEY; throws
//                         SANCTIONS_PROVIDER_NOT_CONFIGURED if missing (prepared but inert until a
//                         real vendor contract + credentials are supplied — a reserved owner
//                         action, same as the SMS 'http' provider).
//
// Every invocation is durably logged to SanctionsScreeningResult before this function returns or
// throws, CLEARED included — an audit trail that only records "we checked and it was clean" is as
// important as one that records a match, and default-inserting status SYSTEM_ERROR at the schema
// level means an interrupted write reads as "unresolved," never as a silent pass.

import { db } from './prisma.mjs'

const SANDBOX_TRIGGERS = Object.freeze({
  hardMatch: 'SANCTIONS_TEST_HARD_MATCH',
  potentialMatch: 'SANCTIONS_TEST_POTENTIAL_MATCH',
  providerError: 'SANCTIONS_TEST_PROVIDER_ERROR',
})

function providerName() {
  return (process.env.SANCTIONS_PROVIDER || 'sandbox').toLowerCase()
}

export function sanctionsProviderStatus() {
  const provider = providerName()
  if (provider === 'sandbox') return { provider, configured: true, live: false }
  if (provider === 'http') {
    return { provider, configured: Boolean(process.env.SANCTIONS_HTTP_ENDPOINT && process.env.SANCTIONS_API_KEY), live: true }
  }
  return { provider, configured: false, live: true }
}

// { status, matchScore, rawPayload } — never throws; provider failures become a SYSTEM_ERROR
// result for the caller to persist and fail closed on, same shape as a real HARD_MATCH result.
async function runProvider(fullName, countryCode) {
  const provider = providerName()

  if (provider === 'sandbox') {
    const upper = fullName.toUpperCase()
    if (upper.includes(SANDBOX_TRIGGERS.providerError)) {
      return { status: 'SYSTEM_ERROR', matchScore: 0, rawPayload: { provider: 'sandbox', simulated: 'provider_timeout' } }
    }
    if (upper.includes(SANDBOX_TRIGGERS.hardMatch)) {
      return { status: 'HARD_MATCH', matchScore: 100, rawPayload: { provider: 'sandbox', simulated: 'hard_match', trigger: SANDBOX_TRIGGERS.hardMatch } }
    }
    if (upper.includes(SANDBOX_TRIGGERS.potentialMatch)) {
      return { status: 'POTENTIAL_MATCH', matchScore: 62, rawPayload: { provider: 'sandbox', simulated: 'potential_match', trigger: SANDBOX_TRIGGERS.potentialMatch } }
    }
    return { status: 'CLEARED', matchScore: 0, rawPayload: { provider: 'sandbox', simulated: 'clear' } }
  }

  if (provider === 'http') {
    const endpoint = process.env.SANCTIONS_HTTP_ENDPOINT
    const apiKey = process.env.SANCTIONS_API_KEY
    if (!endpoint || !apiKey) {
      const error = new Error('Sanctions screening provider is not configured for live checks.')
      error.statusCode = 503
      error.code = 'SANCTIONS_PROVIDER_NOT_CONFIGURED'
      error.expose = true
      throw error
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ fullName, countryCode }),
      })
      if (!res.ok) return { status: 'SYSTEM_ERROR', matchScore: 0, rawPayload: { provider: 'http', httpStatus: res.status } }
      const data = await res.json()
      // Real vendors vary in response shape; this expects a normalized { status, score } contract
      // a real integration would map to on the vendor's side, not a specific vendor's raw format.
      const status = ['CLEARED', 'POTENTIAL_MATCH', 'HARD_MATCH'].includes(data.status) ? data.status : 'SYSTEM_ERROR'
      return { status, matchScore: Number(data.score) || 0, rawPayload: data }
    } catch (err) {
      return { status: 'SYSTEM_ERROR', matchScore: 0, rawPayload: { provider: 'http', error: err.message } }
    }
  }

  const error = new Error(`Unknown sanctions screening provider "${provider}".`)
  error.statusCode = 500
  error.code = 'SANCTIONS_PROVIDER_UNKNOWN'
  error.expose = true
  throw error
}

// checkSanctionsGate({ requestId, subjectType, subjectId, fullName, countryCode }) -> the durably
// persisted CLEARED result, or throws (HARD_MATCH/POTENTIAL_MATCH/SYSTEM_ERROR) -- fail-closed by
// construction, matching authorizePaymentOperation()'s own default-deny contract elsewhere in this
// codebase. requestId must be caller-supplied and unique per screening attempt (the schema's
// unique constraint is what makes a retried call idempotent rather than double-logged).
export async function checkSanctionsGate({ requestId, subjectType, subjectId, fullName, countryCode }) {
  if (!requestId || !subjectType || !subjectId || !fullName?.trim() || !countryCode) {
    const error = new Error('Sanctions screening requires requestId, subjectType, subjectId, fullName, and countryCode.')
    error.statusCode = 400
    error.code = 'SANCTIONS_SCREENING_INPUT_INVALID'
    error.expose = true
    throw error
  }

  const provider = providerName()
  let outcome
  try {
    outcome = await runProvider(fullName.trim(), countryCode)
  } catch (err) {
    // A configuration error (e.g. SANCTIONS_PROVIDER_NOT_CONFIGURED) is itself the fail-closed
    // signal -- log it as SYSTEM_ERROR too, then let the real error propagate with its own code.
    await db().sanctionsScreeningResult.create({
      data: {
        requestId, subjectType, subjectId, fullNameChecked: fullName.trim(), countryCode,
        status: 'SYSTEM_ERROR', matchScore: 0, providerUsed: provider,
        rawPayload: { error: err.message, code: err.code },
      },
    })
    throw err
  }

  const result = await db().sanctionsScreeningResult.create({
    data: {
      requestId, subjectType, subjectId, fullNameChecked: fullName.trim(), countryCode,
      status: outcome.status, matchScore: outcome.matchScore, providerUsed: provider,
      rawPayload: outcome.rawPayload,
    },
  })

  if (result.status === 'CLEARED') return result

  const error = new Error(
    result.status === 'HARD_MATCH'
      ? 'This request cannot proceed: it matched a sanctions/watchlist record.'
      : result.status === 'POTENTIAL_MATCH'
        ? 'This request is on hold pending manual sanctions-screening review.'
        : 'Sanctions screening is currently unavailable; the request cannot proceed until it can be checked.',
  )
  error.statusCode = result.status === 'SYSTEM_ERROR' ? 503 : 403
  error.code = `SANCTIONS_${result.status}`
  error.expose = true
  throw error
}
