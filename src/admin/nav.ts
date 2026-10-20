// Sidebar structure + visibility. Visibility is a CONVENIENCE: hiding an entry never grants or removes access;
// every API call is still authorized by the server. An entry shows only if /me says the user holds the
// permission (or is authorized for the platform). Entries whose screen is not built yet are listed as
// "Soon" and are not links.
export type NavItem = { key: string; label: string; href?: string; perm?: string; anyPerm?: string[]; platform?: string; children?: NavItem[] }
export type NavGroup = { key: string; label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { key: 'command', label: 'Command Center', items: [
    { key: 'home', label: 'Overview', href: '/admin', perm: 'console.access' },
    { key: 'work', label: 'My Work', href: '/admin/work', perm: 'work.view' },
    { key: 'approvals', label: 'Approvals', perm: 'approval.view' },
  ] },
  { key: 'operations', label: 'Operations', items: [
    { key: 'str', label: 'SYBNB STR', platform: 'str' },
    { key: 'sr', label: 'SR', anyPerm: ['platform.view'], children: [
      { key: 'sr_ride', label: 'Ride', platform: 'sr_ride' },
      { key: 'sr_restaurants', label: 'Restaurants', href: '/admin/sr/restaurants', platform: 'sr_restaurants' },
      { key: 'sr_drivers', label: 'Drivers & Couriers', platform: 'sr_ride' },
      { key: 'sr_vehicles', label: 'Vehicles', platform: 'sr_ride' },
    ] },
    { key: 'syntrise', label: 'Syntrise', platform: 'syntrise' },
    { key: 'marketplace', label: 'Marketplace', platform: 'marketplace' },
    { key: 'cars', label: 'Cars', platform: 'cars' },
    { key: 'jobloop', label: 'Jobloop', platform: 'jobloop' },
    { key: 'radio', label: 'Radio Mailo', platform: 'radio_mailo' },
  ] },
  { key: 'company', label: 'Company', items: [
    { key: 'parties', label: 'Parties', href: '/admin/parties', perm: 'party.view' },
    { key: 'documents', label: 'Documents', perm: 'document.view' },
    { key: 'support', label: 'Support', perm: 'support.view' },
    { key: 'ai', label: 'AI Controller', perm: 'ai.view' },
    { key: 'reports', label: 'Reports', perm: 'report.view' },
  ] },
  { key: 'finance', label: 'Finance', items: [
    { key: 'finance', label: 'Finance', perm: 'finance.view' },
    { key: 'tax', label: 'Tax', perm: 'tax.view' },
    { key: 'accountant', label: 'Accountant Center', perm: 'accountant.view' },
  ] },
  { key: 'administration', label: 'Administration', items: [
    { key: 'access', label: 'Users & Access', anyPerm: ['access.view', 'user.view', 'role.view'] },
    { key: 'security', label: 'Security', anyPerm: ['security_event.view', 'security.view'] },
    { key: 'audit', label: 'Audit', perm: 'audit.view' },
    { key: 'health', label: 'Platform Health', perm: 'platform_health.view' },
    { key: 'config', label: 'Configuration', perm: 'config.view' },
  ] },
]

export type Visibility = { permissions: ReadonlySet<string>; authorizedPlatforms: ReadonlySet<string> }

export function itemVisible(item: NavItem, v: Visibility): boolean {
  if (item.children) return item.children.some((c) => itemVisible(c, v))
  if (item.platform) return v.authorizedPlatforms.has(item.platform)
  if (item.perm) return v.permissions.has(item.perm)
  if (item.anyPerm) return item.anyPerm.some((p) => v.permissions.has(p))
  return true
}

export function visibleNav(v: Visibility): NavGroup[] {
  const prune = (items: NavItem[]): NavItem[] =>
    items.filter((i) => itemVisible(i, v)).map((i) => (i.children ? { ...i, children: prune(i.children) } : i))
  return NAV.map((g) => ({ ...g, items: prune(g.items) })).filter((g) => g.items.length > 0)
}

/** Paths the new console renders itself. Everything else under /admin keeps its existing (legacy) page. */
export function isConsolePath(pathname: string): boolean {
  return pathname === '/admin' || pathname === '/admin/work' || pathname === '/admin/parties' || /^\/admin\/parties\/[^/]+$/.test(pathname)
    || pathname === '/admin/sr/restaurants' || /^\/admin\/sr\/restaurants\/orders\/[^/]+$/.test(pathname)
}
