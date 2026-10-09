-- Owner decision of 2026-10-08: host activation code (like Booking.com's partner PIN). A host is
-- verified by the SYBNB team before their stays are publicly visible or bookable. An admin issues a
-- random 6-digit code (only an HMAC of it is stored, same scheme as OTP codes); the host enters it in
-- the host dashboard; a match stamps users.host_verified_at.
--
-- The verification lives on `users`, not on `host_profiles`: a host_profiles row is created lazily
-- (only once the host saves their profile) and is optional, while every public listing query
-- already joins listings.owner_id -> users. One nullable column on users gives a single to-one
-- relation filter (owner.host_verified_at IS NOT NULL) on the users primary key, with no extra
-- join and no "verified but no profile row" state.

ALTER TABLE users
  ADD COLUMN host_verified_at timestamptz,
  ADD COLUMN host_verified_by_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE host_activation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  issued_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  CONSTRAINT host_activation_codes_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE INDEX host_activation_codes_host_id_idx ON host_activation_codes (host_id);

-- Nothing that is visible today may disappear: the demo owner and every account that already owns
-- an APPROVED listing are marked verified (verified_by stays NULL = verified by this migration).
UPDATE users
SET host_verified_at = now()
WHERE host_verified_at IS NULL
  AND (
    email = 'demo-host@sybnb.invalid'
    OR id IN (SELECT DISTINCT owner_id FROM listings WHERE status = 'APPROVED')
  );
