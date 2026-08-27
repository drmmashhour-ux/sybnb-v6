-- Scale-readiness audit follow-up. Every rate limiter in this codebase (OTP send/verify,
-- auth register/login, resend webhook) was an in-process Map -- correct only while a single
-- server instance handles all traffic. Behind a load balancer with 2+ instances, each instance
-- gets its own independent Map, so an attacker's requests spread across instances and the
-- EFFECTIVE limit silently becomes (configured limit * instance count), with no error or log
-- signal that this happened. This table gives every instance the same view of the current
-- window, following the same "Postgres as the shared source of truth" pattern already used by
-- otp_attempt_locks.
CREATE TABLE rate_limit_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_key)
);
