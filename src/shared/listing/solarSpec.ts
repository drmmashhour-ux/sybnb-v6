// Optional solar details a host can add when the power source is solar (or solar + grid/generator):
// battery storage in kWh and the inverter limit in kW. Stored as plain numbers in
// listing.metadata.visualFilters.{solarBatteryKwh,inverterKw}. Nothing is inferred or shown if empty.
export const SOLAR_MAX = 10000

export function solarApplies(powerSource: unknown): boolean {
  return powerSource === 'solar' || powerSource === 'mixed'
}

// Accepts "12", "12.5", 12 -> number with at most 1 decimal; rejects zero, negatives, NaN, absurd values.
export function parseSolarNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(typeof value === 'string' ? value.replace(',', '.').trim() : value)
  if (!Number.isFinite(n) || n <= 0 || n > SOLAR_MAX) return null
  return Math.round(n * 10) / 10
}

// Returns the clean details to display ({} when power isn't solar or nothing valid was entered).
export function solarDetails(vf: Record<string, unknown> | null | undefined): { batteryKwh?: number; inverterKw?: number } {
  if (!vf || !solarApplies(vf.powerSource)) return {}
  const batteryKwh = parseSolarNumber(vf.solarBatteryKwh)
  const inverterKw = parseSolarNumber(vf.inverterKw)
  return { ...(batteryKwh !== null ? { batteryKwh } : {}), ...(inverterKw !== null ? { inverterKw } : {}) }
}
