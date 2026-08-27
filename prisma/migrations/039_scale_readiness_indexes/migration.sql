-- Scale-readiness audit follow-up. Every index here was verified against the real local
-- database (not guessed): EXPLAIN on the exact query Prisma issues confirmed a sequential scan
-- for each pattern below before adding its index. Purely additive -- adds indexes only, changes
-- no existing behavior or data.

-- payment_proofs: hit on ~10 route call sites (guest/host/admin booking screens all load a
-- booking's payment proofs; the ride-payment duplicate-proof check filters by ride_id directly)
-- with no index backing either FK. Confirmed live: a full sequential scan of the 7,282-row table
-- on every one of those loads.
CREATE INDEX payment_proofs_booking_id_idx ON payment_proofs (booking_id);
CREATE INDEX payment_proofs_ride_id_status_idx ON payment_proofs (ride_id, status);

-- ride_requests: the primary rider-facing "my trips" query (GET /api/me/overview) filters by
-- rider_id with no index -- only the driver_id side of that OR was covered. Low volume today,
-- but this is the query path that scales directly with SR Ride adoption, not booking volume.
CREATE INDEX ride_requests_rider_id_idx ON ride_requests (rider_id);

-- message_threads: the guest inquiry inbox (GET /api/me/inquiries) filters by guest_id with no
-- leading index (the existing unique constraint on (listing_id, guest_id) can't serve a
-- guest_id-only lookup). Ordered by updated_at DESC to match the query's own ordering.
CREATE INDEX message_threads_guest_id_updated_at_idx ON message_threads (guest_id, updated_at DESC);

-- listings.metadata: every attribute-filtered search (carBrand, carBody, propertyType,
-- bedroomsMin, bathroomsMin, marketCategory, condition -- see server/routes/listings.mjs's
-- attributeKeys) runs as a post-index Filter over metadata, not an index lookup -- confirmed no
-- GIN index exists anywhere in the database. Cheap today only because each division/status
-- bucket is still small (largest confirmed: 747 rows); this is the specific query shape that
-- turns into a full-bucket scan (and eventually a production search timeout) once any single
-- bucket grows into the tens of thousands, with zero warning beforehand. jsonb_path_ops is
-- deliberately narrower than the default GIN opclass -- it only supports the containment/
-- path-equality queries this codebase's metadata filters actually use, in exchange for a smaller,
-- faster index. Not expressible in schema.prisma without enabling Prisma's `extendedIndexes`
-- preview feature, so this stays an untracked (but real, real Postgres) index for now.
CREATE INDEX listings_metadata_gin_idx ON listings USING GIN (metadata jsonb_path_ops);
