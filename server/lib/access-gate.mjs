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
// narrow, explicitly-named override lets a non-production run exercise the closed path on purpose.
export function isPublicAccessOpen(env = process.env) {
  if (policyEnvironment() !== 'production') {
    return env.ACCESS_GATE_TEST_OVERRIDE_CLOSED !== 'true'
  }
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
