// Service Worker for US 💕 PWA — v5
const CACHE = 'uwl-v6';
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

  // Static, fingerprint-free assets (styles/fonts/images/icons) are safe
  // to serve cache-first with a background revalidation: they're purely
  // cosmetic, so a stale copy for one extra load is harmless, and the
  // next fetch is already updated. Scripts are different — stale JS means
  // an actual bug fix silently isn't running yet (this bit us: call.js
  // fixes weren't taking effect until a *second* reload after deploy) —
  // so scripts go network-first, falling back to cache only when
  // offline. Navigation requests (HTML) keep the exact original
  // network-first behavior below, so the app shell itself is never
  // served stale either.
  const isNavigation = e.request.mode === 'navigate' || e.request.destination === 'document';
  const isCosmeticAsset = !isNavigation && ['style', 'font', 'image'].includes(e.request.destination);
  const isScript = e.request.destination === 'script';

  if (isCosmeticAsset && e.request.method === 'GET') {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(e.request);
        const networkFetch = fetch(e.request).then(res => {
          if (res && res.status === 200) c.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        // Serve the cached copy instantly if we have one; otherwise wait
        // on the network. Either way, the cache is refreshed in the
        // background for next time.
        return cached || (await networkFetch) || caches.match('/index.html');
      })
    );
    return;
  }

  if (isScript && e.request.method === 'GET') {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

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
  let data = { title: 'US 💕', body: '', icon: '/icons/icon-192.png' };
  try { if (e.data) Object.assign(data, e.data.json()); } catch (_) {}
  // Touch needs a long, unmistakable buzz even with the app fully
  // closed; every other notification type keeps its original short
  // pattern exactly as before.
  const vibratePattern = data.tag === 'touch' ? [10000] : [200, 100, 200, 100, 400];
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:     data.body,
      icon:     data.icon  || '/icons/icon-192.png',   // large icon (right side, OS-controlled)
      badge:    '/icons/badge-96.png',                  // small monochrome status-bar icon
      image:    data.image || undefined,                // optional big banner like WhatsApp media previews
      vibrate:  vibratePattern,
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