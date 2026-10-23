// Store apps (Capacitor) vs. the browser.
//
// Inside the iOS/Android store apps the page is served from capacitor://localhost (iOS) or
// https://localhost (Android), not from the public website. Anything that leaves the app and must come
// back to a real web address -- Stripe Checkout return links, ride share links, check-in QR codes --
// must therefore use the PUBLIC web address (VITE_PUBLIC_WEB_URL, e.g. https://stay.rezekme.com),
// never window.location.origin. In a normal browser nothing changes: the current origin is used.

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string }

export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
    if (cap?.isNativePlatform?.()) return true
  } catch {
    /* not in the native shell */
  }
  return window.location.protocol === 'capacitor:'
}

function configuredWebUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>
  return String(env.VITE_PUBLIC_WEB_URL || env.VITE_WEB_URL || '').replace(/\/+$/, '')
}

/** Origin to put in links that leave the app (payment return URLs, share links, QR codes). */
export function publicWebOrigin(): string {
  if (typeof window === 'undefined') return configuredWebUrl()
  if (isNativeShell()) return configuredWebUrl() || window.location.origin
  return window.location.origin
}

/**
 * Store apps only: when the phone opens one of our https links in the app (Android App Links /
 * iOS Universal Links, e.g. the Stripe "payment done" return), load the same path, query and hash
 * inside the app instead of the website. No-op in a browser.
 */
export function installNativeLinkHandler(): void {
  if (!isNativeShell()) return
  const web = configuredWebUrl()
  if (!web) return
  let webHost = ''
  try {
    webHost = new URL(web).host
  } catch {
    return
  }
  void import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('appUrlOpen', ({ url }) => {
        try {
          const target = new URL(url)
          if (target.host !== webHost) return
          window.location.assign(`${window.location.origin}/${target.search}${target.hash}`)
        } catch {
          /* ignore malformed links */
        }
      }),
    )
    .catch(() => {
      /* App plugin missing in this shell: links simply open the website */
    })
}
