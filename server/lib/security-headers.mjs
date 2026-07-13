// Security headers applied to every response. Environment-aware: Vite's dev server (a separate
// process on a different port, not this file) needs its own relaxed dev CSP for HMR — this only
// covers headers on responses from THIS API server, which never serves HTML/scripts itself (the
// frontend is served by Vite in dev and by a static host in production), so its CSP can stay
// strict in every environment without needing a dev-specific relaxation here.
const isProduction = process.env.NODE_ENV === 'production'

export function applySecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('permissions-policy', 'geolocation=(), camera=(), microphone=(), payment=()')

  // This API only ever returns JSON (or a private document image/pdf, which sets its own
  // content-type separately) — default-src 'none' is safe because nothing served from this origin
  // is ever meant to be interpreted as HTML/script/style.
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'")

  // HSTS only makes sense once this is actually served over HTTPS — setting it unconditionally in
  // local HTTP dev would be actively wrong (browsers would remember and force HTTPS for
  // 127.0.0.1). FORCE_HTTPS is the explicit opt-in a real deployment should set once it terminates
  // TLS in front of this server.
  if (isProduction && process.env.FORCE_HTTPS === '1') {
    res.setHeader('strict-transport-security', 'max-age=63072000; includeSubDomains')
  }
}
