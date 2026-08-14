# SYBNB — Communication Audit (Gate 1) + SMS dependency verdict

Email-only communications via **Resend** (an email API — **not** SMS). This audits every notification/
verification workflow and determines whether any genuinely depends on SMS or a telephone number.

## Workflow inventory
| Workflow | Channel today | Genuinely needs SMS / phone? |
|----------|---------------|------------------------------|
| OTP send/verify (login, account-verify, payment-proof, wallet-claim) | server OTP; identifier now **email** (primary) or phone (optional) | **No** — code delivery is channel-agnostic; email works end-to-end |
| Registration verification binding | verified OTP consumed at register (email **or** phone) | **No** — email OTP now gates email-only signup (fail-closed) |
| Password / account recovery | same server-OTP substrate (email) | **No** — email verification is the recovery substrate |
| Booking / payment / support / operational notifications | in-app + email addresses (`support@`/`info@`) | **No** — email/in-app only; no SMS sender in any route |
| SR Ride pickup/dropoff | free-text + gazetteer; phone is contact metadata only | **No** — no SMS/telephone-network dependency |

Method: `grep` for SMS senders/callers — the only SMS surface is `server/lib/sms.mjs`, imported by
exactly one caller, `server/routes/otp.mjs`. **Correction (precise):** it is not merely that "no route
sends SMS" — an SMS branch technically exists in the OTP route. Under Phase 10 that branch is now
**country-gated**: `deliverCode` refuses the phone channel (`OTP_CHANNEL_NOT_ENABLED`) unless the
**active country profile** sets `communications.sms = true`. Syria sets `sms: false`, so **no Syria
route can reach `sendSms`** — proven by governed test (phone OTP under Syria → refused before delivery)
and a static isolation check (sole importer + guarded call site). Bookings/payments/support routes
send no SMS at all. No workflow requires a telephone **network**; phone numbers are optional contact data.

## Verdict — SMS: **NOT APPLICABLE** (not PASS)
No required workflow depends on SMS or a phone number. SMS is **removed as a launch requirement** and
marked **NOT APPLICABLE**. The SMS adapter code is **retained** (not deleted): it supports the
optional phone-OTP path and is inert by default (`SMS_PROVIDER=sandbox`, sends nothing). Phone stays
**optional** unless a documented Syria-country requirement later mandates it (none today).

## Fail-closed security preserved
- OTP unchanged in rigor: server-generated code, HMAC-hashed, 10-min expiry, single-use, 5-attempt
  lock, resend throttle, per-IP limit. Identifier hashing extended to email (`hashEmail`, same keyed HMAC).
- **Registration now requires a verified OTP for email-only accounts** (previously only phone) —
  closes a gap. Verified code is consumed single-use (no cross-account replay).
- Email adapter default is `sandbox` (no send, never logs body/key); live `resend` fails closed
  without `RESEND_API_KEY` + `EMAIL_FROM`.

## No interface promises SMS
UI/API copy updated: `requestOtp` documents delivery "by email; phone optional"; the stale
"via SMS" comment removed. No user-facing text promises SMS delivery.

## Governed proof
- `tests/e2e/email-otp.e2e.mjs` (11/11): email OTP send+verify, masked email, fail-closed bad-code/
  replay, **email-only registration gated by verified email OTP**, no cross-account bypass, and the
  email path works while SMS stays sandbox/unconfigured (no hidden SMS dependency).
- `tests/e2e/otp-identity.e2e.mjs` (20/20): phone path preserved (optional).
- Full governed run: 0 failures.
