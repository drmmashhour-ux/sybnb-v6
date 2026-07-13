-- Stores AI-generated pricing/availability insights per listing so hosts see them in an in-app
-- notification inbox, with read/unread state and an audit trail of what facts + AI provider
-- produced each message. Generation is triggered by a manual host action (not a cron job, since
-- this server has none — see completeExpiredBookings' comment in booking-lifecycle.mjs) because
-- each generation costs a real per-call AI fee.
CREATE TABLE host_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES users(id),
  listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'PRICING_GAP',
  facts jsonb NOT NULL DEFAULT '{}',
  message_ar text NOT NULL,
  message_en text,
  ai_provider text,
  ai_model text,
  read_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX host_insights_host_id_created_at_idx ON host_insights (host_id, created_at);
CREATE INDEX host_insights_listing_id_idx ON host_insights (listing_id);
