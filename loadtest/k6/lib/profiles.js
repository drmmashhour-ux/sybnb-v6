// Load profiles. Each tier = { drivers, browsers, ridesPerMin, rampS, holdS }.
//   drivers      online driver phones (location every 8 s, pending poll every 4 s)
//   browsers     riders on the home screen (availability + fare estimate every 20 s)
//   ridesPerMin  ride requests per minute (each one runs a full lifecycle, see rides.js)
// Load moves gradually: ramp to each tier over rampS, hold it for holdS, then step up.
// Rough request rate of a tier ≈ drivers*0.375 + browsers*0.1 + ridesPerMin*~0.5 req/s
// (measured locally: ~0.21 req/s per concurrent app user).
export const PROFILES = {
  // Laptop/CI sanity check against a LOCAL API. ~5.5 minutes including the drain.
  smoke: [
    { drivers: 5, browsers: 5, ridesPerMin: 2, rampS: 30, holdS: 150 },
  ],
  // First staging run: launch-sized load, gradual. ~19 minutes including the drain.
  'staging-launch': [
    { drivers: 10, browsers: 15, ridesPerMin: 2, rampS: 60, holdS: 240 },
    { drivers: 25, browsers: 40, ridesPerMin: 5, rampS: 60, holdS: 240 },
    { drivers: 50, browsers: 75, ridesPerMin: 10, rampS: 60, holdS: 300 },
  ],
  // Step test to find the staging ceiling. Run only after staging-launch passes. ~44 minutes including the drain.
  // Stop early (Ctrl-C) as soon as thresholds fail; the highest tier held cleanly is the result.
  'staging-step': [
    { drivers: 50, browsers: 75, ridesPerMin: 10, rampS: 60, holdS: 300 },
    { drivers: 100, browsers: 150, ridesPerMin: 20, rampS: 120, holdS: 300 },
    { drivers: 200, browsers: 300, ridesPerMin: 40, rampS: 120, holdS: 300 },
    { drivers: 400, browsers: 600, ridesPerMin: 80, rampS: 120, holdS: 300 },
    { drivers: 600, browsers: 900, ridesPerMin: 120, rampS: 120, holdS: 300 },
    { drivers: 800, browsers: 1200, ridesPerMin: 160, rampS: 120, holdS: 300 },
  ],
  // Steady soak at a comfortable tier, to catch leaks / slow growth. ~35 minutes including the drain.
  'staging-soak': [
    { drivers: 100, browsers: 150, ridesPerMin: 20, rampS: 120, holdS: 1800 },
  ],
}

export function profileDurationS(tiers) {
  return tiers.reduce((s, t) => s + t.rampS + t.holdS, 0)
}

export function peak(tiers) {
  return tiers.reduce((m, t) => ({
    drivers: Math.max(m.drivers, t.drivers),
    browsers: Math.max(m.browsers, t.browsers),
    ridesPerMin: Math.max(m.ridesPerMin, t.ridesPerMin),
  }), { drivers: 0, browsers: 0, ridesPerMin: 0 })
}

// k6 stages for each scenario family.
export function driverStages(tiers) {
  return tiers.flatMap((t) => [{ duration: `${t.rampS}s`, target: t.drivers }, { duration: `${t.holdS}s`, target: t.drivers }])
}
// Browsing iterations per minute (each iteration = availability + fare estimate; a browser does one per 20 s).
export function browseStages(tiers) {
  return tiers.flatMap((t) => [{ duration: `${t.rampS}s`, target: t.browsers * 3 }, { duration: `${t.holdS}s`, target: t.browsers * 3 }])
}
export function rideStages(tiers) {
  return tiers.flatMap((t) => [{ duration: `${t.rampS}s`, target: t.ridesPerMin }, { duration: `${t.holdS}s`, target: t.ridesPerMin }])
}
