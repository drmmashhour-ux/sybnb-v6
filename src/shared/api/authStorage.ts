// Sessions persist across tabs and visits (Airbnb-style "stay signed in"). They used to live in
// sessionStorage, so every new tab or return visit forced the customer to sign in again. Safety is
// unchanged: tokens are server-side sessions with an expiry, revocable by sign-out / sign-out-
// everywhere, and any 401 purges the local copy (purgeLocalSessionsForToken). Reads fall back to
// sessionStorage once so people signed in before this change are not signed out by it.
const AUTH_STORAGE_KEYS = [
  'sybnb.v6.sellerSession',
  'sybnb.v6.guestSession',
  'sybnb-v6-guest-token',
  'sybnb.v6.staffSession',
  'sybnb-v6-staff-token',
]
export const authStorage = {
  getItem(key: string): string | null {
    try {
      const persisted = window.localStorage.getItem(key)
      if (persisted !== null) return persisted
      const legacy = window.sessionStorage.getItem(key)
      if (legacy !== null) {
        try { window.localStorage.setItem(key, legacy) } catch { /* storage full/blocked */ }
      }
      return legacy
    } catch {
      return null
    }
  },
  setItem(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      try { window.sessionStorage.setItem(key, value) } catch { /* storage blocked */ }
    }
  },
  removeItem(key: string) {
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(key) } catch { /* ignore */ }
  },
  clearAll() {
    for (const key of AUTH_STORAGE_KEYS) authStorage.removeItem(key)
  },
}
