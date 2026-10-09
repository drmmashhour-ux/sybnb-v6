// SYBNB — Country selection (MASTER, country-neutral). Fail-closed.
//
// The master platform is country-neutral. The active country is chosen by SYBNB_COUNTRY and its
// profile is loaded from countries/<country>/profile.mjs. Startup REFUSES to run when the country
// profile is missing, unsupported, or incomplete. No country inherits another's config.
//
// To add a country: create countries/<country>/profile.mjs and register it below. Do NOT bake any
// single country's values into this module.

import { profile as syria } from '../../countries/syria/profile.mjs'
import { resolveBookingPolicy } from './booking-policy.mjs'

// Registry of supported country profiles (this release ships Syria only).
const REGISTRY = { syria }

// Fields a country profile must define to be considered complete.
const REQUIRED_PROFILE_FIELDS = ['key', 'country', 'currencies', 'phoneCountryCode', 'defaultLocale', 'gates']

function validateProfile(p) {
  const problems = []
  for (const f of REQUIRED_PROFILE_FIELDS) {
    if (p[f] == null) problems.push(`country profile '${p.key || '?'}' is incomplete: missing '${f}'`)
  }
  if (p.currencies && (!Array.isArray(p.currencies.allowed) || p.currencies.allowed.length === 0)) {
    problems.push(`country profile '${p.key}' has no allowed currencies`)
  }
  if (p.currencies?.allowed?.length) {
    const allowedUpper = p.currencies.allowed.map((c) => String(c).toUpperCase())
    if (!p.currencies.default) {
      problems.push(`country profile '${p.key}' has no default currency`)
    } else if (!allowedUpper.includes(String(p.currencies.default).toUpperCase())) {
      problems.push(`country profile '${p.key}' default currency '${p.currencies.default}' is not in its own allowed list`)
    }
  }
  return problems
}

// Load the active country profile. Returns { profile, problems }. profile is null if unusable.
export function loadCountryProfile(env = process.env) {
  const key = String(env.SYBNB_COUNTRY || '').trim().toLowerCase()
  if (!key) {
    return { profile: null, problems: ['SYBNB_COUNTRY is required — fail-closed country selection refuses to run with no country profile'] }
  }
  const profile = REGISTRY[key]
  if (!profile) {
    return { profile: null, problems: [`SYBNB_COUNTRY='${key}' is not a supported country profile (supported: ${Object.keys(REGISTRY).join(', ')})`] }
  }
  const problems = validateProfile(profile)
  return { profile: problems.length ? null : profile, problems }
}

// Country-neutral startup problems: fail-closed selection + currency-override consistency with the
// ACTIVE profile (no hard-coded country here — the allowed set comes from the loaded profile).
export function countryProblems(env = process.env) {
  const { profile, problems } = loadCountryProfile(env)
  if (!profile) return problems
  const upper = (v) => String(v || '').trim().toUpperCase()
  const allowed = profile.currencies.allowed.map((c) => c.toUpperCase())
  const adCur = upper(env.ADVERTISING_CURRENCY)
  if (adCur && !allowed.includes(adCur)) {
    problems.push(`ADVERTISING_CURRENCY=${adCur} is not valid for country '${profile.key}' (allowed: ${allowed.join(', ')})`)
  }
  const stripeCur = upper(env.STRIPE_CURRENCY)
  if (stripeCur && !allowed.includes(stripeCur)) {
    problems.push(`STRIPE_CURRENCY=${stripeCur} is not valid for country '${profile.key}' (allowed: ${allowed.join(', ')})`)
  }
  return problems
}

export function supportedCountries() {
  return Object.keys(REGISTRY)
}

// Whether a currency code is one the active country's profile actually allows. Route handlers use
// this to reject a client-supplied listing/booking currency before it's stored — otherwise a
// currency with no matching wallet/FX/fee configuration anywhere in the platform (e.g. a currency
// the country profile never enabled) could get attached to real money-moving records.
export function isCurrencyAllowed(currency, env = process.env) {
  const { profile } = loadCountryProfile(env)
  if (!profile) return false
  const allowed = profile.currencies.allowed.map((c) => String(c).toUpperCase())
  return allowed.includes(String(currency || '').toUpperCase())
}

// The active country's settlement currency, for routes that need to create or look up a
// currency-scoped record (a wallet, a fallback price) with no explicit currency supplied. Found by
// an architecture audit: 9 call sites across server/routes previously hardcoded the literal 'SYP'
// for exactly this, which would silently break (e.g. a wallet lookup keyed on the wrong currency
// returning nothing) the moment a second country profile with a different default currency exists.
// Returns undefined (never a guessed fallback) when no country is loaded — callers should already
// be unreachable in that case, since the whole server refuses to start without one.
export function defaultCurrency(env = process.env) {
  const { profile } = loadCountryProfile(env)
  return profile?.currencies?.default
}

// Whether the ACTIVE country enables a communication channel. Defaults to false (fail-closed): a
// channel is reachable only if the loaded profile explicitly enables it. Used to keep the SMS
// adapter unreachable under email-only countries (Syria).
export function channelEnabled(channel, env = process.env) {
  const { profile } = loadCountryProfile(env)
  if (!profile) return false
  return Boolean(profile.communications && profile.communications[channel] === true)
}

// The active country's short-stay booking money policy (check-in timezone, full-refund cutoff,
// unpaid-request expiry window), merged with the neutral defaults and env overrides by the pure
// server/lib/booking-policy.mjs. Neutral defaults apply when no profile is loaded.
export function bookingPolicySettings(env = process.env) {
  const { profile } = loadCountryProfile(env)
  return resolveBookingPolicy(profile?.bookingPolicy || {}, env)
}

// The active country's host payout methods: { TYPE: { required: [field, ...] } }. Empty (no method
// accepted, fail-closed) when the profile defines none.
export function payoutMethodConfig(env = process.env) {
  const { profile } = loadCountryProfile(env)
  return profile?.payoutMethods || {}
}
