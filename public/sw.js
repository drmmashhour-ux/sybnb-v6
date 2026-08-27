// SR Ride vs. Uber gap-closure (P1 #7): minimal Web Push service worker. Only handles push
// display + notification-click focus/navigate -- no offline caching, no asset interception, so it
// can't interfere with the app's normal network requests.

self.addEventListener('push', (event) => {
  let payload = { title: 'SYBNB', body: '' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    payload = { title: 'SYBNB', body: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'SYBNB', {
      body: payload.body || '',
      icon: '/assets/logos/sybnb-platform.png',
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
