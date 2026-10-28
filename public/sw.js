// Avisos de la oficina en el móvil.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Oficina', body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(data.title || 'Oficina', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag,
    data: { url: data.url || '/revisar' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/revisar'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes(url) && 'focus' in c) return c.focus()
    return self.clients.openWindow(url)
  }))
})
