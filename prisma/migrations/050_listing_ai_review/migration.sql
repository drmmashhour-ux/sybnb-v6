-- Owner decision of 2026-10-09: new-host onboarding order (listing -> automatic AI check -> admin
-- review -> activation code by email at the END). The AI check is an ASSISTANT to the human
-- reviewer only: it never approves or rejects a listing by itself.
--
-- Why a table and not listings.metadata (the first idea): listings.metadata is client-written and
-- is serialized whole into many guest-facing responses (bookings, messages, payments include
-- `listing: true`), so an admin-only AI verdict ("photos look like stock images") stored there would
-- leak to guests and could be forged by the host through PATCH /api/host/listings/:id (metadata
-- merge). A separate one-row-per-listing table is never included unless asked for.
--
--   status        PENDING | DONE | FAILED | SKIPPED
--   run_id        id of the run that owns the row; a finishing run only writes if it still owns it,
--                 so a slow older run can never overwrite a newer one (re-submit / manual re-run)
--   result        validated model output (score, recommendation, checks, issuesForHost, summary)
--   error         FAILED: short machine reason (never the API key, never the raw prompt)
--   host_feedback snapshot shown to the host when an admin sends the listing back for fixes:
--                 { note, issues[], at, byId } -- written by the admin decision, not by the AI

CREATE TABLE listing_ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  model text,
  run_id text,
  trigger text,
  result jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  host_feedback jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_ai_reviews_status_check CHECK (status IN ('PENDING', 'DONE', 'FAILED', 'SKIPPED'))
);
