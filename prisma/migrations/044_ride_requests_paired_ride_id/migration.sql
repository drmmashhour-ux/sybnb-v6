-- Independent revenue audit found the ride-pooling discount (SHARE_DISCOUNT_PERCENT, 15%) was
-- applied at ride-REQUEST time from the rider's own client-supplied `shareable` flag alone, with
-- no verification a ride was ever actually pooled with anyone -- a rider could always set
-- shareable=true for a guaranteed discount, confirmed live end to end (a ride requested shareable,
-- claimed by a driver as their ONLY active ride, never paired, still billed at the discounted
-- fare). This column lets the discount be applied only once genuine pooling happens (both rides
-- claimed by the same driver, pickups close enough) instead of unconditionally at request time.
ALTER TABLE ride_requests ADD COLUMN paired_ride_id uuid;
