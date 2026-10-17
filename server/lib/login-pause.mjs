// Owner kill-switch for sign-in. Set LOGIN_DISABLED=1 on the backend (Render env var) to pause every
// login; remove it (or set 0) to turn sign-in back on -- no code change needed. LOGIN_DISABLED_ALLOW is an
// optional comma-separated list of emails that can still sign in (so the owner is never locked out).
// Also pauses new account creation (/api/auth/register). Existing sessions keep working; only new sign-ins/sign-ups are refused.
export function loginPausedFor(email, env = process.env) {
  if (String(env.LOGIN_DISABLED || '').trim() !== '1') return false
  const allow = String(env.LOGIN_DISABLED_ALLOW || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return !(email && allow.includes(String(email).trim().toLowerCase()))
}
