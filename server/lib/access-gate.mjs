import { loadCountryProfile } from './country.mjs'
import { policyEnvironment } from './payment-policy.mjs'

// Defense-in-depth backstop for gates.publicAccess. Before this module, that field was pure
// documentation -- an audit found NO code anywhere reads it, so the only thing standing between
// the public internet and a live backend was Vercel's own SSO-gating / deployment-pause. Verified
// that infra layer is in fact correctly locked down today (production paused, preview SSO-gated),
// but a single-layer defense is still a real gap: this makes the country profile's own gate a real,
// enforced second layer, mirroring how gates.payments is enforced in payment-policy.mjs rather than
// left as a comment.
//
// Production always reads the real profile value. Every non-production environment defaults to
// open (dev and every e2e suite in this repo need an unauthenticated server to hit directly); a
// narrow, explicitly-named override forces the closed path in EITHER mode, so the mechanism itself
// stays regression-tested (public-access-gate.e2e.mjs's own production-mode server uses it)
// independent of whatever the real profile's current gates.publicAccess value happens to be --
// coupling that test to today's specific launch-gate setting would make it fail the moment the
// gate is legitimately opened, which tests "did the owner flip a switch," not "does the code work."
export function isPublicAccessOpen(env = process.env) {
  if (env.ACCESS_GATE_TEST_OVERRIDE_CLOSED === 'true') return false
  if (policyEnvironment() !== 'production') return true
  const { profile } = loadCountryProfile(env)
  return profile?.gates?.publicAccess === 'open'
}

// "Closed" means closed to the PUBLIC, not to the platform's own admins -- they still need to sign
// in, review pending listings/documents, and finish pre-launch setup. Deliberately narrow: only
// ADMIN bypasses a closed gate, not HOST/DRIVER/GUEST -- those roles are exactly what "not yet open
// to the public" is meant to keep out, even for an already-registered account.
export function isAccessGateBypassed(context) {
  return Array.isArray(context?.roles) && context.roles.includes('ADMIN')
}
