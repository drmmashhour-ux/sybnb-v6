// Favourites for visitors who are not signed in: kept on this device only (no account needed).
// When the visitor later signs in, platformApi merges these into their account once.
const KEY = 'sybnb.v6.localFavourites'

export function readLocalFavourites(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, 200) : []
  } catch {
    return []
  }
}

function write(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 200)))
  } catch {
    // storage blocked (private window): the heart still toggles for this page view only
  }
}

export function addLocalFavourite(listingId: string) {
  const ids = readLocalFavourites()
  if (!ids.includes(listingId)) write([listingId, ...ids])
}

export function removeLocalFavourite(listingId: string) {
  write(readLocalFavourites().filter((id) => id !== listingId))
}

export function clearLocalFavourites() {
  try { window.localStorage.removeItem(KEY) } catch { /* noop */ }
}
