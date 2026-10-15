-- 065 — SR VIP luxury tier (2026-10-15, Yallago gap-closure #2).
-- Adds VIP to the VehicleCategory enum so drivers can register a premium sedan and riders can
-- request 'SR VIP'. Rates live in countries/syria/geo/geocoding.mjs (CATEGORY_RATES); the
-- ride-category <-> vehicle mapping in server/lib/vehicle-category.mjs and the dispatch SQL in
-- server/lib/ride-dispatch.mjs gain the matching 'SR VIP' -> 'VIP' entry in the same change.
ALTER TYPE "VehicleCategory" ADD VALUE 'VIP';
