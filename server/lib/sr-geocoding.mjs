// COMPATIBILITY SHIM (Phase 5). The Syria SR geocoder moved to countries/syria/geo/geocoding.mjs as
// part of the country-neutral separation. This re-export preserves the original import path and every
// public export with NO behavior change — coordinates, gazetteer matching, Syria bounds validation,
// fare math, and fallback are unchanged. Master routes should reach the geocoder through the
// country-neutral seam (geo-adapter.mjs); this shim is temporary. Do NOT add logic here.
export * from '../../countries/syria/geo/geocoding.mjs'
