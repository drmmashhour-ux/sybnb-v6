// Where sign-in sessions live, controlled by the "Keep me signed in on this device" choice on the
// sign-in screen (Airbnb-style), which is OFF by default:
//   - OFF (default): sessionStorage -- the sign-in ends when the tab/browser is closed. Safe on a
//     shared or public computer.
//   - ON: localStorage -- stays signed in across tabs and visits until Sign out.
// Either way only the server-issued session token is stored, never the password; tokens expire
// server-side, Sign out revokes them, and any 401 purges the local copy
// (purgeLocalSessionsForToken in platformApi.ts).
const AUTH_STORAGE_KEYS = [
  'sybnb.v6.sellerSession',
  'sybnb.v6.guestSession',
  'sybnb-v6-guest-token',
  'sybnb.v6.staffSession',
  'sybnb-v6-staff-token',
]
const KEEP_SIGNED_IN_KEY = 'sybnb.v6.keepSignedIn'

function keepSignedIn(): boolean {
  try {
    return window.localStorage.getItem(KEEP_SIGNED_IN_KEY) === '1'
  } catch {
    return false
  }
}

export function getKeepSignedIn() {
  return keepSignedIn()
}

// Called by the sign-in screen before a session is stored. Moves any session already stored so it
// lands where the user's choice says (e.g. unticking removes it from the persistent store).
export function setKeepSignedIn(value: boolean) {
  const existing = AUTH_STORAGE_KEYS.map((key) => [key, authStorage.getItem(key)] as const)
  try {
    if (value) window.localStorage.setItem(KEEP_SIGNED_IN_KEY, '1')
    else window.localStorage.removeItem(KEEP_SIGNED_IN_KEY)
  } catch {
    /* storage blocked */
  }
  for (const [key, current] of existing) {
    authStorage.removeItem(key)
    if (current !== null) authStorage.setItem(key, current)
  }
}

// Split test view (#/split on Rezekme Stays): the guest and host panels are this same site in one
// tab, so they would share one sign-in. A panel named 'rzk-split-<role>' keeps its own sign-in by
// prefixing the auth keys with that name. Outside such a panel nothing changes.
function scoped(key: string) {
  try {
    const name = typeof window !== 'undefined' ? window.name : ''
    return name && name.startsWith('rzk-split-') ? `${name}:${key}` : key
  } catch {
    return key
  }
}

export const authStorage = {
  getItem(rawKey: string): string | null {
    const key = scoped(rawKey)
    try {
      const inTab = window.sessionStorage.getItem(key)
      if (inTab !== null) return inTab
      if (keepSignedIn()) return window.localStorage.getItem(key)
      // Not opted in: never honour (and clean up) a persisted copy left on this device.
      window.localStorage.removeItem(key)
      return null
    } catch {
      return null
    }
  },
  setItem(rawKey: string, value: string) {
    const key = scoped(rawKey)
    try {
      if (keepSignedIn()) {
        window.localStorage.setItem(key, value)
        window.sessionStorage.removeItem(key)
      } else {
        window.sessionStorage.setItem(key, value)
        window.localStorage.removeItem(key)
      }
    } catch {
      /* storage blocked */
    }
  },
  removeItem(rawKey: string) {
    const key = scoped(rawKey)
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(key) } catch { /* ignore */ }
  },
  clearAll() {
    for (const key of AUTH_STORAGE_KEYS) authStorage.removeItem(key)
  },
}
