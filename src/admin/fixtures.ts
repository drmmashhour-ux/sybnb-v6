// Development fixtures. Reachable ONLY when the dev server is started with VITE_ADMIN_FIXTURES=1:
// `import.meta.env.DEV` is false in every production build, so the dynamic import below is removed
// from the bundle and no fixture can ever appear in production.
export const FIXTURES_ENABLED: boolean = Boolean((import.meta as any).env?.DEV) && (import.meta as any).env?.VITE_ADMIN_FIXTURES === '1'

export type OrderView = {
  id: string; number: string; restaurant: string; location: string; status: string; placedAt: string
  amountMinor: number | null; currency: string | null
  restaurantState: { label: string; tone: 'pos' | 'info' | 'warn' | 'crit' | 'neu'; note: string }
  deliveryState: { label: string; tone: 'pos' | 'info' | 'warn' | 'crit' | 'neu'; note: string }
  courier: { name: string; vehicle: string; phoneMasked: string } | null
  customer: { name: string; area: string; phoneMasked: string }
  items: Array<{ qty: number; name: string; modifiers: string[] }>
  timeline: Array<{ key: string; label: string; at: string }>
  auditRefs: string[]; supportRefs: string[]
}
export type RestaurantFixtureSummary = { restaurants: { active: number; paused: number; onboarding: number }; liveOrders: Array<{ id: string; number: string; restaurant: string; status: string; elapsedFrom: string }>; deliveries: { assigned: number; unassigned: number } }

export async function loadFixtures(): Promise<{ order: (id: string) => OrderView | null; summary: RestaurantFixtureSummary } | null> {
  // The condition is written out literally so the bundler sees `false` in production and drops the import
  // (and the fixtures chunk) entirely.
  if ((import.meta as any).env.DEV && (import.meta as any).env.VITE_ADMIN_FIXTURES === '1') return (await import('./fixtures-data')).fixtures
  return null
}
