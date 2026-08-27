-- Horizontal-scaling audit follow-up. The Resend webhook handler already recorded hard-bounce and
-- complaint events into a bounce/complaint suppression list, but sendEmail() never actually checked
-- it before sending -- so the protection this list exists for (not re-mailing an address that just
-- hard-bounced or complained, which damages sender reputation) was not active. Now that the check is
-- wired up and load-bearing, the list must survive restarts and be shared across instances rather
-- than live in a per-process Map (same reasoning as otp_attempt_locks / rate_limit_buckets).
CREATE TABLE suppressed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
