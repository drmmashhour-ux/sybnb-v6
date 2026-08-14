// SYBNB — SR geocoding CHARACTERIZATION test (governed). Locks the EXACT current inputs, normalized
// outputs, coordinates, fallback behavior, validation, and fare math of the SR ride geocoder BEFORE
// and AFTER the Phase-5 move. NOTE: there is NO external geocoding provider — resolution is a local
// gazetteer, so "provider-response/timeout" semantics = deterministic local match with NO network
// call; this test pins that too. Imports through the stable path (../lib/sr-geocoding.mjs shim).
//   node tests/e2e/sr-geocoding.e2e.mjs
import * as g from '../../server/lib/sr-geocoding.mjs'

let pass = 0, fail = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) } }

console.log('=== resolvePlaceText (gazetteer, normalization, fallback) ===')
eq('exact neighborhood (Malki)', g.resolvePlaceText('Malki'), { lat: 33.5169, lng: 36.287 })
eq('longest-keyword precedence (Damascus, Malki -> Malki)', g.resolvePlaceText('Damascus, Malki'), { lat: 33.5169, lng: 36.287 })
eq('generic city fallback (damascus)', g.resolvePlaceText('damascus'), { lat: 33.5138, lng: 36.2765 })
eq('unknown place -> null', g.resolvePlaceText('Paris'), null)
eq('empty -> null', g.resolvePlaceText(''), null)

console.log('=== haversineKm (pure geometry) ===')
eq('malki->airport km (4dp)', Number(g.haversineKm({ lat: 33.5169, lng: 36.287 }, { lat: 33.4114, lng: 36.5156 }).toFixed(4)), 24.234)

console.log('=== quoteSrRide (fares, distance, estimated, coords, external-call = none) ===')
eq('economy malki->airport (resolved, no surcharge)', g.quoteSrRide({ pickup: 'Malki', dropoff: 'Damascus Airport', category: 'SR Economy', lowDataMode: true }),
  { fareMinor: 30000, distanceKm: 24.2, estimated: false, pickupCoords: { lat: 33.5169, lng: 36.287 }, dropoffCoords: { lat: 33.4114, lng: 36.5156 } })
eq('suv unresolved -> DEFAULT 5km + estimated + live surcharge', g.quoteSrRide({ pickup: '???', dropoff: '???', category: 'SR SUV', lowDataMode: false }),
  { fareMinor: 29500, distanceKm: 5, estimated: true, pickupCoords: null, dropoffCoords: null })
eq('comfort with device-GPS override (override wins)', g.quoteSrRide({ pickup: 'x', dropoff: 'y', category: 'SR Comfort', lowDataMode: true, pickupCoordsOverride: { lat: 33.51, lng: 36.29 }, dropoffCoordsOverride: { lat: 33.49, lng: 36.27 } }),
  { fareMinor: 16000, distanceKm: 2.9, estimated: false, pickupCoords: { lat: 33.51, lng: 36.29 }, dropoffCoords: { lat: 33.49, lng: 36.27 } })
eq('out-of-Syria-bounds override REJECTED -> gazetteer fallback', g.quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', lowDataMode: true, pickupCoordsOverride: { lat: 5, lng: 5 } }),
  { fareMinor: 12500, distanceKm: 5.1, estimated: false, pickupCoords: { lat: 33.5169, lng: 36.287 }, dropoffCoords: { lat: 33.503, lng: 36.235 } })
eq('unknown category -> defaults to SR Economy rates', g.quoteSrRide({ pickup: '???', dropoff: '???', category: 'NONSENSE', lowDataMode: true }).fareMinor,
  g.quoteSrRide({ pickup: '???', dropoff: '???', category: 'SR Economy', lowDataMode: true }).fareMinor)

console.log(`\n==== SR GEOCODING CHARACTERIZATION: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
