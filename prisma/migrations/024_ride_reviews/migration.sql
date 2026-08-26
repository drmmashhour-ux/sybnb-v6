-- 024_ride_reviews
--
-- Trust remediation capsule 13 (client-satisfaction audit P2 #10): SR Ride has a real, mechanically
-- solid request->track->complete lifecycle but no rating/review model of any kind -- a ride simply
-- ends with a static "Ride completed" message, unlike STAYS bookings which get a real ListingReview.
--
-- This adds ride_reviews as a direct structural mirror of listing_reviews (same shape: one review
-- per completed unit of service, a 1-5 rating, an optional comment, admin-hide capability, no
-- separate "reviewed party" column since it's derivable via ride_requests.driver_id the same way
-- listing_reviews derives the host via listings.owner_id).
--
-- No money, no payment-policy interaction, no other table touched. Purely additive.

-- No separate index on ride_id: the UNIQUE constraint below already provides one, and (unlike
-- listing_id on listing_reviews) nothing yet queries "all reviews for a driver" at scale -- add
-- that index if/when a real feature needs it, rather than indexing a hypothetical query now.
CREATE TABLE ride_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL UNIQUE REFERENCES ride_requests(id) ON DELETE CASCADE,
  rider_id    uuid NOT NULL REFERENCES users(id),
  rating      integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     text,
  hidden_at   timestamptz,
  hidden_by_admin_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
