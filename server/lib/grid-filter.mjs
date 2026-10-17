// Stay-search "grid spec" filters. A guest usually cares that a thing EXISTS ("has internet",
// "has a water tank"), not which exact variant the host picked, so besides the exact option ids we
// accept group ids that match several stored values.
export const GRID_FILTER_GROUPS = {
  connectivity: { has: ['fiber', 'router4g'] },
  waterSystem: { hasTank: ['tank', 'both'] },
  powerSource: { backup: ['solar', 'generator', 'mixed'] },
}

// Returns the Prisma JSON filter for one key/value, or null when the value is empty/'any'.
export function gridFilterCondition(key, value) {
  if (!value || value === 'any') return null
  const values = GRID_FILTER_GROUPS[key]?.[value]
  if (!values) return { metadata: { path: ['visualFilters', key], equals: value } }
  return { OR: values.map((v) => ({ metadata: { path: ['visualFilters', key], equals: v } })) }
}
