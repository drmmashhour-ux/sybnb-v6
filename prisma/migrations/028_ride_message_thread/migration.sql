-- SR Ride vs Uber gap-closure, capsule 21 (P0 #4): in-app rider-driver contact channel.
-- Purely additive: a new nullable ride_id FK + unique constraint on message_threads (mirrors the
-- existing booking_id column exactly, one thread per ride), plus two new MessageSenderRole enum
-- values so ride participants are labelled RIDER/DRIVER in message history, not misleadingly
-- reusing GUEST/HOST (which mean something specific in the STAYS/RENTALS context).

ALTER TABLE message_threads ADD COLUMN ride_id uuid REFERENCES ride_requests(id) ON DELETE CASCADE;
ALTER TABLE message_threads ADD CONSTRAINT message_threads_ride_id_key UNIQUE (ride_id);

ALTER TYPE message_sender_role ADD VALUE 'DRIVER';
ALTER TYPE message_sender_role ADD VALUE 'RIDER';

-- The pre-existing message_threads_booking_or_listing_chk only recognized two valid shapes
-- (booking-only, or listing+guest) -- a ride-only thread violated it (caught live, before this
-- capsule was committed, by an actual failed insert; fixed here rather than worked around).
ALTER TABLE message_threads DROP CONSTRAINT message_threads_booking_or_listing_chk;
ALTER TABLE message_threads ADD CONSTRAINT message_threads_booking_or_listing_or_ride_chk CHECK (
  (booking_id IS NOT NULL AND listing_id IS NULL AND guest_id IS NULL AND ride_id IS NULL)
  OR (booking_id IS NULL AND listing_id IS NOT NULL AND guest_id IS NOT NULL AND ride_id IS NULL)
  OR (booking_id IS NULL AND listing_id IS NULL AND guest_id IS NULL AND ride_id IS NOT NULL)
);
