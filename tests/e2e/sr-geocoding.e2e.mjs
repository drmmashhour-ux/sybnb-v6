// SYBNB — SR geocoding CHARACTERIZATION test (governed). Locks the EXACT current inputs, normalized
// outputs, coordinates, fallback behavior, validation, and fare math of the SR ride geocoder BEFORE
// and AFTER the Phase-5 move. NOTE: there is NO external geocoding provider — resolution is a local
// gazetteer, so "provider-response/timeout" semantics = deterministic local match with NO network
// call; this test pins that too. Imports the country module directly (post-Phase-7; shim removed).
//
// RE-PINNED 2026-10-15 to the USD smart variable pricing engine (owner decision 2026-10-10,
// countries/syria/geo/geocoding.mjs): the previous expectations predated the SYP->USD fare move and
// the quote's full breakdown shape (currency, airportSurcharge, traffic/peak/night/demand
// multipliers, stops/bags/riders fees). Every quote call now passes a FIXED `now` (12:00 Damascus,
// off-peak, not night) so the pinned fares are deterministic at any wall-clock time; peak/night
// coverage lives in the two clock checks below.
//   node tests/e2e/sr-geocoding.e2e.mjs
import * as g from '../../countries/syria/geo/geocoding.mjs'

let pass = 0, fail = 0
const NEW_ZONE_KEYS = ['ring', 'ringFee', 'dayType', 'dateMultiplier'] // smart-pricing fields added after these expectations
const stripNew = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !NEW_ZONE_KEYS.includes(k))) : v)
const eq = (label, got0, want) => { const got = stripNew(got0); const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) } }

// 2026-10-15T09:00:00Z = 12:00 Damascus (UTC+3): outside peak (07-10, 16-20) and night (22-06).
const NOON = new Date('2026-10-15T09:00:00Z')

console.log('=== resolvePlaceText (gazetteer, normalization, fallback) ===')
eq('exact neighborhood (Malki)', g.resolvePlaceText('Malki'), { lat: 33.5169, lng: 36.287 })
eq('longest-keyword precedence (Damascus, Malki -> Malki)', g.resolvePlaceText('Damascus, Malki'), { lat: 33.5169, lng: 36.287 })
eq('generic city fallback (damascus)', g.resolvePlaceText('damascus'), { lat: 33.5138, lng: 36.2765 })
eq('unknown place -> null', g.resolvePlaceText('Paris'), null)
eq('empty -> null', g.resolvePlaceText(''), null)

console.log('=== all-governorate coverage (2026-10-15, Yallago gap-closure #1) ===')
eq('aleppo (en)', g.resolvePlaceText('aleppo'), { lat: 36.2021, lng: 37.1343 })
eq('حلب (ar)', g.resolvePlaceText('حلب'), { lat: 36.2021, lng: 37.1343 })
eq('neighborhood beats city fallback (Aleppo, Aziziyeh)', g.resolvePlaceText('Aleppo, Aziziyeh'), { lat: 36.2082, lng: 37.1487 })
eq('aleppo airport beats bare airport', g.resolvePlaceText('aleppo airport'), { lat: 36.1807, lng: 37.2244 })
eq('bare airport still Damascus', g.resolvePlaceText('airport'), { lat: 33.4114, lng: 36.5156 })
eq('homs', g.resolvePlaceText('homs'), { lat: 34.7324, lng: 36.7137 })
eq('hama', g.resolvePlaceText('hama'), { lat: 35.1318, lng: 36.7578 })
eq('latakia', g.resolvePlaceText('latakia'), { lat: 35.5196, lng: 35.7915 })
eq('tartus', g.resolvePlaceText('tartus'), { lat: 34.8886, lng: 35.8866 })
eq('idlib', g.resolvePlaceText('idlib'), { lat: 35.9306, lng: 36.6339 })
eq('daraa', g.resolvePlaceText('daraa'), { lat: 32.6189, lng: 36.1021 })
eq('sweida', g.resolvePlaceText('sweida'), { lat: 32.709, lng: 36.5694 })
eq('quneitra', g.resolvePlaceText('quneitra'), { lat: 33.1263, lng: 35.8245 })
eq('deir ez-zor', g.resolvePlaceText('deir ez-zor'), { lat: 35.3359, lng: 40.1408 })
eq('raqqa', g.resolvePlaceText('raqqa'), { lat: 35.9594, lng: 39.0079 })
eq('hasakah', g.resolvePlaceText('hasakah'), { lat: 36.5024, lng: 40.7477 })
eq('qamishli (القامشلي)', g.resolvePlaceText('القامشلي'), { lat: 37.0522, lng: 41.2317 })
eq('latakia airport surcharge fires', g.quoteSrRide({ pickup: 'jableh', dropoff: 'latakia airport', category: 'SR Economy', lowDataMode: true, now: NOON }).airportTrip, true)

console.log('=== international trips (2026-10-15, Yallago gap-closure #4a) ===')
eq('beirut resolves as international', g.resolvePlaceDetailed('Beirut'), { lat: 33.8938, lng: 35.5018, international: true })
eq('بيروت (ar) resolves as international', g.resolvePlaceDetailed('بيروت'), { lat: 33.8938, lng: 35.5018, international: true })
eq('amman resolves as international', g.resolvePlaceDetailed('amman'), { lat: 31.9539, lng: 35.9106, international: true })
eq('domestic place is NOT international', g.resolvePlaceDetailed('Malki'), { lat: 33.5169, lng: 36.287, international: false })
{
  const q = g.quoteSrRide({ pickup: 'Damascus, Malki', dropoff: 'Beirut', category: 'SR Comfort', lowDataMode: true, now: NOON })
  eq('damascus->beirut carries the international surcharge', [q.internationalTrip, q.internationalSurcharge], [true, 25])
  const domestic = g.quoteSrRide({ pickup: 'Damascus, Malki', dropoff: 'Mezzeh', category: 'SR Comfort', lowDataMode: true, now: NOON })
  eq('domestic trip carries none', [domestic.internationalTrip, domestic.internationalSurcharge], [false, 0])
}

console.log('=== SR VIP tier (2026-10-15, Yallago gap-closure #2) ===')
eq('VIP rates above Van on the same trip', g.quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR VIP', lowDataMode: true, now: NOON }).fareMinor, 15)
eq('VIP min fare floors a short hop at 12 -> rounds to 15', g.quoteSrRide({ pickup: 'Malki', dropoff: 'Shaalan', category: 'SR VIP', lowDataMode: true, now: NOON }).fareMinor, 15)

console.log('=== haversineKm (pure geometry) ===')
eq('malki->airport km (4dp)', Number(g.haversineKm({ lat: 33.5169, lng: 36.287 }, { lat: 33.4114, lng: 36.5156 }).toFixed(4)), 24.234)

console.log('=== clock windows (peak 07-10 & 16-20, night 22-06, Damascus UTC+3) ===')
eq('12:00 local is neither peak nor night', [g.isPeakHour(NOON), g.isNightHour(NOON)], [false, false])
eq('08:00 local is peak; 23:00 local is night', [g.isPeakHour(new Date('2026-10-15T05:00:00Z')), g.isNightHour(new Date('2026-10-15T20:00:00Z'))], [true, true])

console.log('=== quoteSrRide (USD fares, distance, estimated, coords, external-call = none) ===')
eq('economy malki->airport (resolved, $20 airport anchor + ring fee)', g.quoteSrRide({ pickup: 'Malki', dropoff: 'Damascus Airport', category: 'SR Economy', lowDataMode: true, now: NOON }),
  { fareMinor: 20, currency: 'USD', distanceKm: 24.2, estimatedMinutes: 52, estimated: false, distanceSource: 'gazetteer', baseFareMinor: 20, airportSurcharge: 5, airportTrip: true, internationalSurcharge: 0, internationalTrip: false, stopsCount: 0, stopsFee: 0, bagCount: 0, bagsFee: 0, riderCount: 1, ridersFee: 0, fuelSurchargePercent: 0, trafficMultiplier: 1, trafficSource: 'none', isPeak: false, isNight: false, nightMultiplier: 1, scheduled: false, scheduleMultiplier: 1, demandMultiplier: 1, surgeMultiplier: 1, pickupCoords: { lat: 33.5169, lng: 36.287 }, dropoffCoords: { lat: 33.4114, lng: 36.5156 }, stopCoords: [] })
eq('suv unresolved -> DEFAULT 5km + estimated + live surcharge', g.quoteSrRide({ pickup: '???', dropoff: '???', category: 'SR SUV', lowDataMode: false, now: NOON }),
  { fareMinor: 10, currency: 'USD', distanceKm: 5, estimatedMinutes: 11, estimated: true, distanceSource: 'estimate', baseFareMinor: 7, airportSurcharge: 0, airportTrip: false, internationalSurcharge: 0, internationalTrip: false, stopsCount: 0, stopsFee: 0, bagCount: 0, bagsFee: 0, riderCount: 1, ridersFee: 0, fuelSurchargePercent: 0, trafficMultiplier: 1, trafficSource: 'none', isPeak: false, isNight: false, nightMultiplier: 1, scheduled: false, scheduleMultiplier: 1, demandMultiplier: 1, surgeMultiplier: 1, pickupCoords: null, dropoffCoords: null, stopCoords: [] })
eq('comfort with device-GPS override (override wins)', g.quoteSrRide({ pickup: 'x', dropoff: 'y', category: 'SR Comfort', lowDataMode: true, pickupCoordsOverride: { lat: 33.51, lng: 36.29 }, dropoffCoordsOverride: { lat: 33.49, lng: 36.27 }, now: NOON }),
  { fareMinor: 5, currency: 'USD', distanceKm: 2.9, estimatedMinutes: 6, estimated: false, distanceSource: 'gazetteer', baseFareMinor: 5, airportSurcharge: 0, airportTrip: false, internationalSurcharge: 0, internationalTrip: false, stopsCount: 0, stopsFee: 0, bagCount: 0, bagsFee: 0, riderCount: 1, ridersFee: 0, fuelSurchargePercent: 0, trafficMultiplier: 1, trafficSource: 'none', isPeak: false, isNight: false, nightMultiplier: 1, scheduled: false, scheduleMultiplier: 1, demandMultiplier: 1, surgeMultiplier: 1, pickupCoords: { lat: 33.51, lng: 36.29 }, dropoffCoords: { lat: 33.49, lng: 36.27 }, stopCoords: [] })
eq('out-of-Syria-bounds override REJECTED -> gazetteer fallback', g.quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', lowDataMode: true, pickupCoordsOverride: { lat: 5, lng: 5 }, now: NOON }),
  { fareMinor: 5, currency: 'USD', distanceKm: 5.1, estimatedMinutes: 11, estimated: false, distanceSource: 'gazetteer', baseFareMinor: 4, airportSurcharge: 0, airportTrip: false, internationalSurcharge: 0, internationalTrip: false, stopsCount: 0, stopsFee: 0, bagCount: 0, bagsFee: 0, riderCount: 1, ridersFee: 0, fuelSurchargePercent: 0, trafficMultiplier: 1, trafficSource: 'none', isPeak: false, isNight: false, nightMultiplier: 1, scheduled: false, scheduleMultiplier: 1, demandMultiplier: 1, surgeMultiplier: 1, pickupCoords: { lat: 33.5169, lng: 36.287 }, dropoffCoords: { lat: 33.503, lng: 36.235 }, stopCoords: [] })
eq('unknown category -> defaults to SR Economy rates', g.quoteSrRide({ pickup: '???', dropoff: '???', category: 'NONSENSE', lowDataMode: true, now: NOON }).fareMinor,
  g.quoteSrRide({ pickup: '???', dropoff: '???', category: 'SR Economy', lowDataMode: true, now: NOON }).fareMinor)

console.log('=== quoteSrRide multi-stop (SR Ride vs. Uber gap-closure, capsule 27) ===')
eq('one resolved stop -> distance sums pickup->stop->dropoff legs (5.4km via Shaalan, vs 5.1km direct), base fare charged once not per-leg',
  g.quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', lowDataMode: true, stops: ['Shaalan'], now: NOON }),
  { fareMinor: 5, currency: 'USD', distanceKm: 5.4, estimatedMinutes: 12, estimated: false, distanceSource: 'gazetteer', baseFareMinor: 4, airportSurcharge: 0, airportTrip: false, internationalSurcharge: 0, internationalTrip: false, stopsCount: 1, stopsFee: 1, bagCount: 0, bagsFee: 0, riderCount: 1, ridersFee: 0, fuelSurchargePercent: 0, trafficMultiplier: 1, trafficSource: 'none', isPeak: false, isNight: false, nightMultiplier: 1, scheduled: false, scheduleMultiplier: 1, demandMultiplier: 1, surgeMultiplier: 1, pickupCoords: { lat: 33.5169, lng: 36.287 }, dropoffCoords: { lat: 33.503, lng: 36.235 }, stopCoords: [{ lat: 33.5155, lng: 36.289 }] })
eq('one UNRESOLVED stop -> whole quote falls back to default distance + estimated, same as an unresolved pickup/dropoff would',
  g.quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', lowDataMode: true, stops: ['???'], now: NOON }),
  { fareMinor: 5, currency: 'USD', distanceKm: 5, estimatedMinutes: 11, estimated: true, distanceSource: 'estimate', baseFareMinor: 4, airportSurcharge: 0, airportTrip: false, internationalSurcharge: 0, internationalTrip: false, stopsCount: 1, stopsFee: 1, bagCount: 0, bagsFee: 0, riderCount: 1, ridersFee: 0, fuelSurchargePercent: 0, trafficMultiplier: 1, trafficSource: 'none', isPeak: false, isNight: false, nightMultiplier: 1, scheduled: false, scheduleMultiplier: 1, demandMultiplier: 1, surgeMultiplier: 1, pickupCoords: { lat: 33.5169, lng: 36.287 }, dropoffCoords: { lat: 33.503, lng: 36.235 }, stopCoords: [null] })

// --- Smart pricing: Damascus rings + day/date factor ---
import * as zones from '../../countries/syria/geo/sr-zones.mjs'
eq('ring 1 at the centre', zones.ringOf(zones.DAMASCUS_CENTER), 1)
eq('Damascus airport is ring 9', zones.ringOf({ lat: 33.4114, lng: 36.5156 }), 9)
eq('far away is capped at ring 10', zones.ringOf({ lat: 36.2, lng: 37.1 }), 10)
eq('ring fee: ring 9 = 8 x 0.40', Math.round(zones.ringFeeUsd(null, { lat: 33.4114, lng: 36.5156 }).feeUsd * 100) / 100, 3.2)
eq('Monday is a weekday', zones.dayFactor(new Date('2026-10-19T09:00:00Z')).type, 'weekday')
eq('Friday is a weekend day', zones.dayFactor(new Date('2026-10-23T09:00:00Z')).type, 'weekend')
eq('Christmas is a holiday', zones.dayFactor(new Date('2026-12-25T09:00:00Z')).type, 'holiday')
eq('mazeh spelling now resolves', Boolean(g.resolvePlaceText('mazeh jabel')), true)


console.log(`\n==== SR GEOCODING CHARACTERIZATION: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
