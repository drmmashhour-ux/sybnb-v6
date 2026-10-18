-- 075 — Host can remove their own listing (2026-10-18). The row is kept for booking/audit history;
-- the status flips to REMOVED, the listing disappears everywhere, and its photos are deleted from
-- storage. Until a host removes it, photos are never deleted by the platform.
ALTER TYPE listing_status ADD VALUE IF NOT EXISTS 'REMOVED';
