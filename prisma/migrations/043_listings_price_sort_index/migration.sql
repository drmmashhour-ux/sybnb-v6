-- Wiring up the previously-dead 'sort' filter (server/routes/listings.mjs's sort=priceLow/
-- priceHigh) added a price-ordered keyset scan alongside the existing createdAt-ordered one.
-- Confirmed via EXPLAIN before adding this: with no priceMinor index, an ORDER BY price_minor
-- query falls back to an in-memory Sort over the full division/status bucket (cheap only because
-- today's buckets are small) instead of an index scan -- the same "grows into a full-bucket scan
-- once any bucket grows" risk already fixed for created_at in migration 042. A single DESC index
-- serves both directions: Postgres can scan a DESC btree index backward to satisfy an ASC query.
CREATE INDEX listings_division_status_price_minor_id_idx
  ON listings (division, status, price_minor DESC, id DESC);
