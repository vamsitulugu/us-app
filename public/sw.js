// Service Worker for Us With Love PWA
const CACHE = 'uwl-v2';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@300;400;500;600;700&display=swap'
];

// Install — cache shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(OFFLINE_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache for the app shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  
  // Always go to network for API calls
  if (url.pathname.startsWith('/api/')) return;
  
  // For everything else: try network, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful GET responses
        if (e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) if ('focus' in client) return client.focus();
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// Required for true push delivery even when the app is fully closed —
// only fires if your backend sends a Web Push message to this device.
self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  event.waitUntil(self.registration.showNotification(data.title || 'US 💕', {
    body: data.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    vibrate: [200,100,200], tag: 'us-app-love'
  }));
});