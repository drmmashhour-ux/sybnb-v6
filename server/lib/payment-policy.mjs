// SYBNB — the single "may this payment operation happen" authority. Every payment-adjacent route
// must call authorizePaymentOperation() before doing any work (see payment-policy-routes.mjs for
// the declarative registry this is checked against, and
// tests/e2e/payment-policy-enforcement.e2e.mjs for the audit that fails the build if a
// money-moving route is ever added without a policy declaration).
//
// Default deny: any missing, malformed, or unrecognized input denies. "Unconfigured" is never
// treated as "allowed" — this is the whole point of this module existing. Two independent, ad hoc
// kill switches (PAYMENTS_ENABLED, PAYMENT_INTENTS_ENABLED) already exist and stay checked, but as
// of this module they are subordinate layers, never load-bearing on their own.

import { loadCountryProfile } from './country.mjs'
import { log } from './logger.mjs'

export const PAYMENT_OPERATIONS = Object.freeze([
  'create',
  'capture',
  'refund',
  'replay',
  'webhook_intake',
  'webhook_apply',
  'reconciliation_read',
  // Paying the HOST out (a booking_payout RELEASE wallet entry) is a distinct operation from
  // capturing/refunding the GUEST's payment — it moves money in the opposite direction, to a
  // different party, and was previously left as a documented, unfixed gap because it didn't fit
  // any of the other 6 types. Stretching 'capture' or 'refund' to also mean "pay the host" would
  // have made those types ambiguous for every other call site; a distinct type keeps each
  // operation meaning exactly one thing.
  'payout_release',
])

// An emergency stop pauses everything EXCEPT durable, authenticated webhook intake and read-only
// reconciliation. A provider may still legitimately deliver events for transactions already in
// flight after payments are stopped — those must still be authenticated, durably stored, and
// deduplicated; only their financial EFFECTS are paused. See the webhook_intake/webhook_apply
// split in server/routes/payment-intents.mjs and server/routes/payments.mjs.
const EMERGENCY_STOP_EXEMPT_OPERATIONS = new Set(['webhook_intake', 'reconciliation_read'])

// webhook_intake is exempt from every MONEY-OPERATION gate, not just emergency stop. Disabling
// creation/capture/refund (country rollout, a rail flag, an operation flag) must never cost the
// platform the durable record of an authenticated event — those flags govern whether we act on an
// event, not whether we're allowed to know it happened.
//
// IMPORTANT layering, stated precisely (an earlier version of these comments conflated two
// different things — corrected after review): AUTHENTICATION of the webhook — verifying the
// provider's cryptographic signature — happens entirely BEFORE this policy is ever called (see
// verifyWebhook()/stripe.webhooks.constructEvent() in the two webhook routes). By the time
// authorizePaymentOperation({ operation: 'webhook_intake', ... }) runs, the event is already
// authenticated. RECOGNIZED_WEBHOOK_PROVIDERS below is a DIFFERENT, later question: does this
// POLICY LAYER have a configured routing/recognition path for this provider string at all — pure
// input validation/configuration selection, not a cryptographic check of any kind. A third,
// separate question (is this provider APPROVED to move money) stays APPROVED_PROVIDER_CONFIGS,
// evaluated only for non-intake operations.
const INTAKE_EXEMPT_OPERATIONS = new Set(['webhook_intake'])

// Provider strings this policy layer recognizes and can route intake through — a routing/
// configuration-selection check, NOT authentication (the signature was already verified upstream,
// before this policy is ever reached — see the comment above). Deliberately separate from
// APPROVED_PROVIDER_CONFIGS (which answers "is this provider approved to MOVE money"). 'stripe'
// belongs here even though it is absent from APPROVED_PROVIDER_CONFIGS: this codebase already has
// working Stripe-signature-verification code (verifyWebhook()'s scheme is Stripe-compatible; the
// real route also uses the actual `stripe` SDK's own constructEvent) even though no Stripe
// money-movement is approved yet. A durably-stored, already-authenticated event is not the same
// claim as being allowed to act on it.
const RECOGNIZED_WEBHOOK_PROVIDERS = new Set(['stripe', 'sandbox'])

const RECOGNIZED_ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production'])

// Who may perform an operation that needs a human actor, centralized here instead of each route
// re-hardcoding its own requireAuth(context, [...]) list independently. Operations not listed are
// actor-independent at THIS policy layer — routes still separately authenticate the caller for
// ownership/session purposes; this only gates the payment OPERATION itself.
const OPERATION_ACTOR_ROLES = {
  replay: ['ADMIN'],
  refund: ['ADMIN'],
  payout_release: ['ADMIN'],
}

// A payment rail's configuration must be an explicitly approved record, not merely "an env var is
// set" — credentials being present and structurally valid does not establish legal or provider
// eligibility. (Stripe's own published availability does not list Syria as a supported business
// location, and Syria-linked payments require ongoing Canadian sanctions/legal review — see the
// design doc's provider-prerequisites section.) A provider entry is populated ONLY once a written
// provider + legal approval genuinely exists for it — never speculatively "to unblock testing".
//
// 'manual' represents the platform's real, currently-operating model (Sham Cash / local wallet /
// bank transfer, verified by human admin review) — no third-party processor is involved, so it
// isn't subject to the same international-processor eligibility concern as a card network; it's
// approved across every recognized environment (it's the same real process everywhere).
// 'sandbox' is a non-production entry so the (not-real-Stripe) electronic PaymentIntent sandbox
// rail can exercise every gate below this one wherever it's exercised except production — no
// special-casing needed elsewhere in this file. 'stripe' (or any other real processor) is
// intentionally absent.
// 'PLATFORM' is a division-neutral sentinel for operations that are structurally division-blind —
// most importantly webhook_intake, which by design runs BEFORE the matching intent (and therefore
// its booking/listing/division) is even looked up, since intake must durably store an
// already-authenticated event (the signature was verified upstream, before this call) before any
// content-dependent decision is made.
const DIVISIONS = ['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION', 'PLATFORM']

const APPROVED_PROVIDER_CONFIGS = {
  manual: {
    providerAccount: 'sybnb-manual-review',
    environments: ['development', 'test', 'staging', 'production'],
    businessCountry: 'CA',
    permittedCustomerCountries: ['SY'],
    permittedPayoutCountries: ['CA'],
    supportedDivisions: DIVISIONS,
    approvalReference: 'owner-confirmed-manual-review-model',
    effectiveDate: '2026-01-01',
  },
  sandbox: {
    providerAccount: 'sandbox-test-account',
    environments: ['development', 'test', 'staging'],
    businessCountry: 'CA',
    permittedCustomerCountries: ['SY'],
    permittedPayoutCountries: ['CA'],
    supportedDivisions: DIVISIONS,
    approvalReference: 'internal-sandbox-testing-only',
    effectiveDate: '2026-01-01',
  },
}

function denial(reason, message) {
  const error = new Error(message)
  error.statusCode = reason === 'ACTOR_UNAUTHORIZED' ? 403 : 503
  error.code = 'PAYMENT_POLICY_DENIED'
  error.reason = reason
  error.expose = true
  return error
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

// The active country's own gates.payments stays the real, production-authoritative signal (today
// 'disabled' for Syria — unchanged, untouched by this module). A narrow, explicitly-named,
// non-production-only override lets tests exercise this gate honestly without ever weakening the
// production guardrail: production always reads the real profile value, full stop.
function countryDivisionEligible({ country, division, environment }) {
  const { profile } = loadCountryProfile()
  // 'country' means the ISO country code throughout this policy (profile.country, e.g. 'SY'),
  // consistent with APPROVED_PROVIDER_CONFIGS' permittedCustomerCountries — never the internal
  // platform profile key (profile.key, e.g. 'syria'), which is a different, unrelated identifier.
  if (!profile || profile.country !== country) return false
  const productionEligible = profile.gates?.payments === 'enabled'
  const testOverrideEligible = environment !== 'production' && process.env.PAYMENT_POLICY_TEST_COUNTRY_ELIGIBLE === 'true'
  if (!productionEligible && !testOverrideEligible) return false
  const eligibleDivisions = String(process.env.PAYMENT_POLICY_ELIGIBLE_DIVISIONS || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
  return eligibleDivisions.includes(division)
}

function isRailEnabled(rail) {
  if (rail === 'stripe_checkout') return process.env.PAYMENTS_ENABLED === 'true'
  if (rail === 'payment_intent') return process.env.PAYMENT_INTENTS_ENABLED === 'true'
  // The manual/local proof rail (Sham Cash, local wallet transfer, seller-plan document review)
  // previously had NO rail-level kill switch at all — server/routes/payments.mjs's
  // local-wallet-proof and seller-plan-proof routes were reachable unconditionally. This flag
  // closes that real, pre-existing gap: default unset means deny, same as the other two rails.
  if (rail === 'manual_proof') return process.env.PAYMENT_RAIL_MANUAL_PROOF_ENABLED === 'true'
  return false
}

// Per-rail, per-operation toggle, finer-grained than the rail flag alone (e.g. intent creation
// could stay enabled while refund is independently switched off during a phased rollout). Unset
// means "not yet explicitly enabled" — default deny, never default allow.
function isOperationEnabled(rail, operation) {
  const envKey = `PAYMENT_OPERATION_${rail.toUpperCase()}_${operation.toUpperCase()}_ENABLED`
  return process.env[envKey] === 'true'
}

function evaluate({ operation, rail, provider, division, country, environment, actor }) {
  // Input shape: default deny on anything malformed before evaluating a single real gate.
  if (!PAYMENT_OPERATIONS.includes(operation)) {
    return { allowed: false, reason: 'UNKNOWN_INPUT', message: 'Unrecognized payment operation.' }
  }
  if (![rail, provider, division, country, environment].every(isNonEmptyString)) {
    return { allowed: false, reason: 'UNKNOWN_INPUT', message: 'Payment policy inputs are incomplete.' }
  }

  // Gate 1: emergency stop. Checked unconditionally first, before anything else is even evaluated.
  if (process.env.PAYMENTS_EMERGENCY_STOP === 'true' && !EMERGENCY_STOP_EXEMPT_OPERATIONS.has(operation)) {
    return { allowed: false, reason: 'EMERGENCY_STOP', message: 'Payments are under an emergency stop.' }
  }

  // Gate 2: environment.
  if (!RECOGNIZED_ENVIRONMENTS.has(environment)) {
    return { allowed: false, reason: 'ENVIRONMENT_NOT_PERMITTED', message: 'Unrecognized environment.' }
  }

  // webhook_intake takes a narrower path from here: it must never depend on whether ordinary money
  // operations are enabled (country rollout, rail flag, operation flag) — only on whether this
  // policy layer recognizes the provider string at all (routing/configuration validation, NOT
  // authentication — the signature was already verified upstream, before this function was ever
  // called). Gates 3/5/6/7 below never run for this operation.
  if (INTAKE_EXEMPT_OPERATIONS.has(operation)) {
    if (!RECOGNIZED_WEBHOOK_PROVIDERS.has(provider)) {
      return { allowed: false, reason: 'PROVIDER_NOT_RECOGNIZED', message: 'Unrecognized webhook provider.' }
    }
    return { allowed: true }
  }

  // Gate 3: country/division eligibility — this is where gates.payments is finally enforced,
  // not merely documented.
  if (!countryDivisionEligible({ country, division, environment })) {
    return { allowed: false, reason: 'COUNTRY_DIVISION_NOT_ELIGIBLE', message: 'This country/division is not eligible for payment operations.' }
  }

  // Gate 4: provider configuration approval — separate from, and stricter than, credential
  // presence. See APPROVED_PROVIDER_CONFIGS' own comment for why this stays empty for real
  // processors today.
  const approvedConfig = APPROVED_PROVIDER_CONFIGS[provider]
  if (
    !approvedConfig ||
    !approvedConfig.environments.includes(environment) ||
    !approvedConfig.permittedCustomerCountries.includes(country) ||
    !approvedConfig.supportedDivisions.includes(division)
  ) {
    return { allowed: false, reason: 'PROVIDER_NOT_APPROVED', message: 'No approved provider configuration for this request.' }
  }

  // Gate 5: rail-level flag (the pre-existing PAYMENTS_ENABLED / PAYMENT_INTENTS_ENABLED toggles),
  // now subordinate to everything above rather than a sole gate.
  if (!isRailEnabled(rail)) {
    return { allowed: false, reason: 'RAIL_DISABLED', message: 'This payment rail is not enabled.' }
  }

  // Gate 6: operation-type gate.
  if (!isOperationEnabled(rail, operation)) {
    return { allowed: false, reason: 'OPERATION_DISABLED', message: 'This payment operation is not enabled.' }
  }

  // Gate 7: actor authorization, for operations that need one.
  const requiredRoles = OPERATION_ACTOR_ROLES[operation]
  if (requiredRoles) {
    const actorRoles = Array.isArray(actor?.roles) ? actor.roles : []
    if (!requiredRoles.some((role) => actorRoles.includes(role))) {
      return { allowed: false, reason: 'ACTOR_UNAUTHORIZED', message: 'This actor is not authorized for this payment operation.' }
    }
  }

  return { allowed: true }
}

// Small shared helpers so every call site doesn't re-derive the same two ambient values.
export function policyEnvironment() {
  return process.env.NODE_ENV || 'development'
}

// Despite the name (kept for call-site stability), this returns the active profile's ISO country
// code (profile.country, e.g. 'SY') — what every policy gate and APPROVED_PROVIDER_CONFIGS entry
// means by "country" — not the internal platform profile key (profile.key, e.g. 'syria').
export function activePolicyCountryKey() {
  return loadCountryProfile().profile?.country || 'unknown'
}

export function authorizePaymentOperation(input = {}) {
  const { operation, rail, provider, division, country, environment } = input
  const result = evaluate(input)
  if (!result.allowed) {
    // Structured, redaction-safe: only the reason code + the non-secret classification inputs are
    // logged — never credentials, never a raw webhook payload, never sensitive financial data.
    log.warn('payment_policy_denied', { operation, rail, provider, division, country, environment, reason: result.reason })
    throw denial(result.reason, result.message)
  }
  return { allowed: true }
}
