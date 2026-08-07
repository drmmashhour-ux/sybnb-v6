# Email OTP (login + verification)

Backend email one-time-password flow. Codes are 6 digits, HMAC-hashed with
`AUTH_SECRET` (a DB leak alone can't brute-force them), single-use, and expire
after 10 minutes. The plaintext code is **never** returned by the API — only the
email adapter sees it.

## Endpoints

- `POST /api/otp/email/request` — body `{ email, purpose }`. Generates + emails a code.
- `POST /api/otp/email/resend`  — same as request (rate-limited: 30s cooldown, max 5 / 10 min).
- `POST /api/otp/email/verify`  — body `{ email, purpose, code }`. Verifies the code.

`purpose` is `EMAIL_VERIFICATION` (default) or `LOGIN`. For `LOGIN`, a successful
verify returns `{ ok, verified, user, token }` (a session token, same shape as
`/api/auth/login`); if no active account exists for the email it returns 404.

## Abuse controls

- Per-email verify lockout after 5 failed attempts (15 min) via `OtpAttemptLock`.
- Resend cooldown (30s) + per-window cap (5 per 10 min).
- Codes are single-use; requesting a new code invalidates prior unconsumed ones.

## Email delivery

Delivery is pluggable via `server/lib/email.mjs`.

- `EMAIL_PROVIDER=log` (default) — writes the code to the server log only; **sends no
  real email**. Use for staging/local.
- Any other value currently throws (fail-loud). Add a real adapter (SMTP/SendGrid/SES)
  behind the same `sendEmail({ to, subject, text })` contract before production.

Add to `.env`:

```bash
EMAIL_PROVIDER=log
EMAIL_FROM=info@sybnb.app
```

## Frontend

`src/shared/api/platformApi.ts` exports `requestEmailOtp`, `resendEmailOtp`, and
`verifyEmailOtp` — the real server-side replacement for the browser-side
`src/engines/security/verificationCodeEngine.ts`. The existing sign-in/up resend
capsule should call these instead of generating the code in the browser
(`purpose: 'LOGIN'` returns a session token on verify; the "resend" button maps to
`resendEmailOtp`).
