// Offline shell for the LIGHT SR/STR pages. Registered with scope /sr.html and /str.html only, so it
// never touches the full app or the push worker (sw.js). Same-origin GET only; API calls are never
// cached here (the pages keep their own small saved copy). Stale-while-revalidate keeps the shell
// opening instantly on a weak connection.
const CACHE = 'sybnb-lite-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
))
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req)
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res }).catch(() => hit)
    return hit || net
  }))
})
