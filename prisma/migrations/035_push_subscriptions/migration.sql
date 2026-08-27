-- SR Ride vs Uber gap-closure, capsule 29 (P1 #7): push notifications.
-- Standard Web Push (VAPID) -- a self-generated ECDSA keypair, no third-party account/signup
-- required (this was previously and incorrectly flagged as blocked on external credentials;
-- corrected). Purely additive.

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions(user_id);
