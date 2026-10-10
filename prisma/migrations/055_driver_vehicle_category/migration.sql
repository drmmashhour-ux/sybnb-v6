-- Tier-to-vehicle enforcement (2026-10-10): a driver may only be offered / claim a ride whose
-- category matches their vehicle's declared category, so SUV/Van pricing is guaranteed. The ride's
-- category lives in ride_requests.metadata->>'category' (one of 'SR Bike','SR Economy','SR Comfort',
-- 'SR SUV','SR Van'); this adds the matching self-declared category to the driver's profile. No data
-- migration: every existing row gets a null vehicle_category and must set it before accepting rides.
CREATE TYPE "VehicleCategory" AS ENUM ('BIKE', 'ECONOMY', 'COMFORT', 'SUV', 'VAN');
ALTER TABLE "driver_profiles" ADD COLUMN "vehicle_category" "VehicleCategory";

-- Safety-grade vehicle profile (2026-10-10): build year, color, registration expiry and a mechanical
-- inspection lifecycle. An expired registration or a non-PASSED/expired inspection blocks a driver
-- from being offered / claiming rides (enforced in sr-rides.mjs and ride-dispatch.mjs). Vehicle year
-- also constrains which tier a car may serve (see server/lib/vehicle-category.mjs). All columns are
-- nullable except inspection_status, which defaults to PENDING so existing drivers start un-inspected.
CREATE TYPE "VehicleInspectionStatus" AS ENUM ('PENDING','PASSED','FAILED','EXPIRED');
ALTER TABLE "driver_profiles" ADD COLUMN "vehicle_year" INTEGER, ADD COLUMN "vehicle_color" TEXT, ADD COLUMN "registration_expires_at" TIMESTAMP(3), ADD COLUMN "inspection_status" "VehicleInspectionStatus" NOT NULL DEFAULT 'PENDING', ADD COLUMN "inspection_expires_at" TIMESTAMP(3);
