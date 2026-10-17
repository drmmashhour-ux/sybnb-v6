export type VendorMode = 'property' | 'fleet' | 'ondemand'
export const VENDOR_MODE_KEY = 'sybnb.vendorMode.v1'

// Which business a supplier is "in", derived from the route so deep links always show the right mode.
export function vendorModeFromPath(path: string): VendorMode | null {
  if (path === '/host' || path === '/host/stays' || path === '/host/seller' || path === '/host/new-construction' || path === '/host/marketplace') return 'property'
  if (path === '/host/cars') return 'fleet'
  if (path === '/driver' || path === '/merchant') return 'ondemand'
  return null
}

export const VENDOR_MODE_HOME: Record<VendorMode, string> = {
  property: '/host/stays',
  fleet: '/host/cars',
  ondemand: '/merchant',
}
