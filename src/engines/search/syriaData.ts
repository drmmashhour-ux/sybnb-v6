// COMPATIBILITY SHIM (Phase 3). The Syria geo dataset moved to countries/syria/data/geo.ts as part
// of the country-neutral separation. This re-export preserves the original import path and every
// public export (types + values) with no behavior change. Importers will be repointed in a later
// phase, after which this shim is removed. Do NOT add logic here.
export * from '../../../countries/syria/data/geo'
