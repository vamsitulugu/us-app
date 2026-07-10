// Service Worker for Twin Hearts 💕 PWA — v3
const CACHE = 'uwl-v4';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin requests. Let cross-origin CDN/API calls
  // (unpkg, github, maplibre tiles, textures, etc.) go straight to the
  // network exactly as the page requested — don't touch mode/credentials.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) return; // never intercept API

  // Chrome occasionally re-issues the page's own navigation request internally
  // with cache: 'only-if-cached' (used for prerender / back-forward-cache
  // probing). Forwarding that request as-is via fetch() throws, because
  // 'only-if-cached' is only valid when mode is 'same-origin'. Let those
  // pass through untouched instead of trying to handle them.
  if (e.request.cache === 'only-if-cached' && e.request.mode !== 'same-origin') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});

// ── PUSH: fires even when app is fully closed ──────────
self.addEventListener('push', e => {
  let data = { title: 'Twin Hearts 💕', body: '', icon: '/icons/icon-192.png' };
  try { if (e.data) Object.assign(data, e.data.json()); } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:     data.body,
      icon:     data.icon  || '/icons/icon-192.png',   // large icon (right side, OS-controlled)
      badge:    '/icons/badge-96.png',                  // small monochrome status-bar icon
      image:    data.image || undefined,                // optional big banner like WhatsApp media previews
      vibrate:  [200, 100, 200, 100, 400],
      tag:      data.tag   || 'us-app',
      renotify: true,
      requireInteraction: false,
      silent:   false,
      data:     { url: data.url || '/' },
      actions:  [
        { action: 'open', title: '💕 Open' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

// ── NOTIFICATION CLICK: open or focus app ─────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.postMessage({ type: 'notification_click', url: target });
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});