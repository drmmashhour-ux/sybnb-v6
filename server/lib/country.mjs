// SYBNB — Country selection (MASTER, country-neutral). Fail-closed.
//
// The master platform is country-neutral. The active country is chosen by SYBNB_COUNTRY and its
// profile is loaded from countries/<country>/profile.mjs. Startup REFUSES to run when the country
// profile is missing, unsupported, or incomplete. No country inherits another's config.
//
// To add a country: create countries/<country>/profile.mjs and register it below. Do NOT bake any
// single country's values into this module.

import { profile as syria } from '../../countries/syria/profile.mjs'

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
