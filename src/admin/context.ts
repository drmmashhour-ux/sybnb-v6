// Step 5G -- what the top-bar context really controls. The switcher may only offer choices the server actually
// applies; everything else is shown as information and clearly marked as not selectable.
import type { ContextInfo } from './api'

export type PageScope =
  | { kind: 'platform-filter'; label: string }                       // requests carry the chosen platform: the choice is real
  | { kind: 'fixed-platform'; label: string; platformCode: string }   // the page is about one platform; no choice applies
  | { kind: 'organization'; label: string }                           // the page covers the whole organization; no choice applies

export function pageScope(pathname: string): PageScope {
  if (pathname === '/admin' || pathname === '/admin/work') return { kind: 'platform-filter', label: 'Platform filter' }
  if (pathname === '/admin/sr/restaurants' || pathname.startsWith('/admin/sr/restaurants/')) return { kind: 'fixed-platform', label: 'SR Restaurants', platformCode: 'sr_restaurants' }
  return { kind: 'organization', label: 'Organization-wide' }
}

/** The legal-entity line. Selection is not implemented on the server, so it is never offered as a choice. */
export function legalEntityView(ctx: Pick<ContextInfo, 'organizations' | 'legalEntities'> | null): { label: string; names: string[]; note: string } {
  const org = ctx?.organizations[0]?.name ?? 'Organization'
  const names = (ctx?.legalEntities ?? []).map((e) => e.name)
  if (names.length === 1) return { label: names[0], names, note: 'This organization has one legal entity.' }
  if (names.length > 1) return { label: `${org} · all legal entities`, names, note: 'Everything you are authorized for is shown together. Switching to a single legal entity is not available yet.' }
  return { label: org, names, note: '' }
}
