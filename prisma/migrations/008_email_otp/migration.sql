CREATE TABLE IF NOT EXISTS email_otp_codes (
  id text PRIMARY KEY,
  email_normalized text NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_otp_codes_email_purpose_idx ON email_otp_codes (email_normalized, purpose);
CREATE INDEX IF NOT EXISTS email_otp_codes_expires_at_idx ON email_otp_codes (expires_at);
