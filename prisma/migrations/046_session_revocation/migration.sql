-- SEC-002 — session invalidation / auth revocation.
--
-- Before this migration SYBNB sessions were purely stateless: an HMAC-signed token carrying
-- {sub, roles, iat, exp} with a 7-day TTL and NO server-side record of any kind. There was no
-- logout endpoint anywhere in server/routes/, and nothing in the system could make an
-- already-issued token stop working. AccountStatus.SUSPENDED / DELETED existed in the enum but
-- were unreachable and, when set directly in the DB, were only observed by getAuthContext through
-- a 30s per-process cache -- so a suspended (or deleted, or de-admined) user kept full access,
-- including ADMIN access, for up to 30 seconds after the change and forever if the cache was
-- warm-refreshed by their own traffic. Verified live against HEAD before this change.
--
-- Two complementary server-side controls are added:
--
-- 1. user_sessions -- one row per issued session (server-backed sessions). The token now carries
--    that row's id as `sid`; every authenticated request re-reads the row, so a single session can
--    be revoked individually (real logout) without touching the account's other sessions.
--
-- 2. users.session_epoch -- a per-user security version. The token carries the epoch it was issued
--    under; a mismatch rejects the token regardless of its session row. This is the "kill
--    everything for this user at once" control, used for logout-all, suspension, deletion, and
--    role changes. It exists in addition to user_sessions because it invalidates atomically with a
--    single column write on the users row, so a concurrently-inserted session (a login racing a
--    suspension) cannot slip through the gap that a pure "UPDATE user_sessions SET revoked_at"
--    sweep would leave open.
--
-- revoked_reason is deliberately stored: an operator investigating "why was I logged out" needs to
-- tell an ordinary logout apart from a suspension or a privilege revocation.
--
-- Existing users are moved to epoch 1 so that every token issued before this deploy -- all of
-- which carry no `epoch` claim at all -- fails the epoch check on its first request. This is a
-- one-time forced re-login for anyone signed in at deploy time, and it is the intended behaviour:
-- those tokens are exactly the credentials this finding says cannot currently be revoked.

ALTER TABLE users ADD COLUMN session_epoch integer NOT NULL DEFAULT 0;
UPDATE users SET session_epoch = 1;

CREATE TABLE user_sessions (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  last_used_at   timestamptz,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Every authenticated request looks a session up by primary key, so no extra index is needed for
-- the hot path. These two support the revocation sweeps instead: "revoke every session for this
-- user" (logout-all / suspend / delete / role change) and the expired-session cleanup.
CREATE INDEX user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_at_idx ON user_sessions (expires_at);
