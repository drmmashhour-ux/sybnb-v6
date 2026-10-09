// SYBNB — admin sign-in policy (owner decision of 2026-10-08). PURE: no I/O, unit-tested in
// tests/unit/admin-login.test.mjs.
//
// Every password sign-in of an account that holds ADMIN must ALSO be backed by a fresh email code
// for that account's email, under its own OTP purpose ('admin-login'), verified within the last
// ADMIN_LOGIN_OTP_WINDOW_MS and consumed single-use by the login (server/routes/auth.mjs). Roles are
// read live per request, so "a session that will carry ADMIN" is exactly "a session for an account
// that holds ADMIN now". Guest/host/seller logins are unchanged.
//
// Admin sessions are also shorter-lived: ADMIN_SESSION_TTL_HOURS (default 12, allowed 1..168)
// instead of the normal 7 days. Applied by issueUserSession() (server/lib/session-store.mjs) to
// every session minted for an account holding ADMIN -- the row's expires_at and the token's exp.

import { SESSION_TTL_SECONDS } from './security.mjs'

export const ADMIN_LOGIN_OTP_PURPOSE = 'admin-login'
// A verified admin code must be used for the login within this window (the OTP itself already
// expires 10 minutes after it was sent).
export const ADMIN_LOGIN_OTP_WINDOW_MS = 10 * 60_000
export const ADMIN_SESSION_DEFAULT_TTL_HOURS = 12

export function requiresAdminLoginCode(roles) {
  return Array.isArray(roles) && roles.some((r) => (typeof r === 'string' ? r : r?.role) === 'ADMIN')
}

export function adminSessionTtlSeconds(env = process.env) {
  const raw = Number(env?.ADMIN_SESSION_TTL_HOURS)
  const hours = Number.isInteger(raw) && raw >= 1 && raw <= 168 ? raw : ADMIN_SESSION_DEFAULT_TTL_HOURS
  return hours * 60 * 60
}

// Session lifetime for an account with these roles (strings or { role } rows).
export function sessionTtlSecondsForRoles(roles, env = process.env) {
  return requiresAdminLoginCode(roles) ? Math.min(adminSessionTtlSeconds(env), SESSION_TTL_SECONDS) : SESSION_TTL_SECONDS
}

// Is this verification_codes row an acceptable proof for an admin login at `now`?
export function isUsableAdminLoginCode(row, now = Date.now()) {
  if (!row || row.purpose !== ADMIN_LOGIN_OTP_PURPOSE || row.status !== 'VERIFIED' || !row.verifiedAt) return false
  return new Date(row.verifiedAt).getTime() > Number(now) - ADMIN_LOGIN_OTP_WINDOW_MS
}
