-- Scale-readiness audit follow-up. GET /api/listings previously had no pagination at all -- a
-- fixed `take: 250` meant any division+city combination that passed ~250 approved listings made
-- older inventory permanently unreachable through search/browse. server/routes/listings.mjs now
-- walks the table with real keyset pagination, filtering on (division, status) and paging in
-- (created_at, id) DESC order. This index backs that exact query shape so each page is an index
-- scan, not a sort over the whole division/status bucket.
CREATE INDEX listings_division_status_created_at_id_idx
  ON listings (division, status, created_at DESC, id DESC);
