// Shared mapping between an SR Ride's category string (stored in ride_requests.metadata->>'category')
// and the driver's self-declared VehicleCategory enum. Used by the manual-claim gate (sr-rides.mjs),
// the auto-dispatch eligibility SQL (ride-dispatch.mjs) and the driver vehicle route (driver.mjs) so
// SUV/Van pricing is guaranteed: a driver can only be offered / claim a ride whose category exactly
// matches their vehicle. Keep this the single source of truth for the mapping.
export const RIDE_CATEGORY_TO_VEHICLE = {
  'SR Bike': 'BIKE',
  'SR Economy': 'ECONOMY',
  'SR Comfort': 'COMFORT',
  'SR SUV': 'SUV',
  'SR Van': 'VAN',
}

export const VEHICLE_CATEGORY_VALUES = ['BIKE', 'ECONOMY', 'COMFORT', 'SUV', 'VAN']

// Map a ride category string to its VehicleCategory enum value, or null if unknown/missing.
export function rideCategoryToVehicle(cat) {
  if (!cat || typeof cat !== 'string') return null
  return RIDE_CATEGORY_TO_VEHICLE[cat] || null
}

// Year-based tier policy (2026-10-10). A fuller safety profile constrains which tier a car may serve
// by its build year: older cars are allowed only in the lower tiers. Model-based division isn't
// feasible without a licensed vehicle dataset, so tiering is by age alone (vehicleMake/vehicleModel
// stay free-text, captured and shown, but not used for tier gating). BIKE has no age limit. Each
// limit is env-overridable (srEnvNum-style read of process.env, falling back to the policy default).
function envNum(name, def) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : def
}

// Maximum vehicle age (in years) allowed per category. null = no limit (BIKE).
export const VEHICLE_MAX_AGE_YEARS = {
  BIKE: null,
  ECONOMY: envNum('SR_VEHICLE_MAX_AGE_ECONOMY', 20),
  COMFORT: envNum('SR_VEHICLE_MAX_AGE_COMFORT', 12),
  SUV: envNum('SR_VEHICLE_MAX_AGE_SUV', 12),
  VAN: envNum('SR_VEHICLE_MAX_AGE_VAN', 15),
}

// True when a vehicle of the given build year may serve the given category. Permissive on missing
// data (unknown category or unknown year => allowed): the year gate only blocks a KNOWN car that is
// too old for a KNOWN tier. BIKE is always allowed (no age limit).
export function isCategoryAllowedForYear(category, year, now = new Date()) {
  if (!category || !VEHICLE_CATEGORY_VALUES.includes(category)) return true
  const maxAge = VEHICLE_MAX_AGE_YEARS[category]
  if (maxAge == null) return true // BIKE / no limit
  if (year == null || !Number.isFinite(Number(year))) return true // unknown year => allowed
  return Number(year) >= now.getFullYear() - maxAge
}

// The subset of categories a vehicle of the given build year may serve (used by the UI / validation
// to explain the allowed tiers). With an unknown year, every category is allowed.
export function allowedCategoriesForYear(year, now = new Date()) {
  return VEHICLE_CATEGORY_VALUES.filter((cat) => isCategoryAllowedForYear(cat, year, now))
}
