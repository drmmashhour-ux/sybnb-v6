// Brand shown in user-facing text. Rezekme builds set VITE_BRAND_NAME via Vite `define`; the platform
// default is SYBNB. VITE_STAYS_ONLY=1 (Rezekme Stay) limits host listing creation to daily stays.
export const BRAND_NAME = ((import.meta.env.VITE_BRAND_NAME as string | undefined) || 'SYBNB').trim() || 'SYBNB'
export const IS_PLATFORM_BRAND = BRAND_NAME === 'SYBNB'
export const STAYS_ONLY = (import.meta.env.VITE_STAYS_ONLY as string | undefined) === '1'
