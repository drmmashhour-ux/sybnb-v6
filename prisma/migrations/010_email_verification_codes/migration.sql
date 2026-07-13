-- Real, server-verified email one-time codes for guest account creation, replacing the previous
-- client-only fake phone-code simulation in GuestAccountPage. Codes are hashed (HMAC, not scrypt --
-- these are short-TTL, attempt-limited 6-digit OTPs, not passwords), single-use (consumed_at), and
-- rate/attempt-limited so a leaked row can't be brute-forced.
CREATE TABLE email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'guest-signup',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_codes_email_purpose_idx ON email_verification_codes (email, purpose);
