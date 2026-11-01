/* ═══════════════════════════════════════════════════════════════
   app-telemetry.js — talks to the admin dashboard (web + Android WebView app)
   1. Adds X-App-Platform / X-App-Version to every call to OUR API
   2. Pings /api/telemetry/ping (daily-active counts)
   3. Reports crashes to /api/telemetry/error (server scrubs personal text)
   4. Checks /api/releases/check  → update banner / forced-update screen
   5. Loads /api/flags            → window.AppFlags.isOn('key')
   Everything is best-effort: if any of it fails the app keeps working.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__appTelemetryLoaded) return;
  window.__appTelemetryLoaded = true;

  var API_HOST = 'us-app-av6d.onrender.com';
  var WEB_VERSION = '1.0.0';   // bump when you deploy a web release you want to track
  var isTop = (function () { try { return window.top === window; } catch (e) { return false; } })();
  var cap = window.Capacitor;
  var isNative = !!(cap && ((cap.isNativePlatform && cap.isNativePlatform()) || (cap.getPlatform && cap.getPlatform() !== 'web')));
  var KIND = isNative ? 'android_capacitor' : 'web';
  var version = (isNative ? (window.__APP_VERSION__ || null) : WEB_VERSION);

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function userId() {
    try { return (window.S && window.S.userId) || lsGet('uwl_active_user') || ''; } catch (e) { return ''; }
  }
  function isOurApi(u) {
    return typeof u === 'string' && (u.indexOf('/api/') === 0 || u.indexOf(API_HOST + '/api/') !== -1 ||
      (location.origin && u.indexOf(location.origin + '/api/') === 0));
  }
  function apiBase() { return (window.API || ('https://' + API_HOST)).replace(/\/$/, ''); }

  // Native app: ask the Capacitor App plugin for the real versionName.
  function loadNativeVersion() {
    try {
      var App = cap && cap.Plugins && cap.Plugins.App;
      if (isNative && App && App.getInfo) {
        return App.getInfo().then(function (i) { if (i && i.version) version = i.version; }).catch(function () {});
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  // 1 ── header injection (only for our own API; never touches Supabase/OSM/etc.)
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url);
        if (isOurApi(url) && (typeof input === 'string' || !init)) {
          init = Object.assign({}, init || {});
          var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
          if (!h.has('X-App-Platform')) h.set('X-App-Platform', KIND);
          if (version && !h.has('X-App-Version')) h.set('X-App-Version', String(version));
          init.headers = h;
        }
      } catch (e) { /* fall through with original args */ }
      return origFetch.call(this, input, init);
    };
  }

  function post(path, body) {
    try {
      var h = { 'Content-Type': 'application/json' };
      var u = userId(); if (u) h['x-user-id'] = u;
      return origFetch.call(window, apiBase() + path, { method: 'POST', headers: Object.assign(h, { 'X-App-Platform': KIND, 'X-App-Version': String(version || '') }), body: JSON.stringify(body || {}), keepalive: true }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  // 3 ── crash reporting (max 5 per page load, same message once)
  var sent = 0, seen = {};
  function report(source, message, stack, fatal) {
    message = String(message || '').slice(0, 500);
    if (!message || sent >= 5 || seen[message]) return;
    seen[message] = 1; sent++;
    post('/api/telemetry/error', { source: source, message: message, stack: stack ? String(stack).slice(0, 1500) : undefined, fatal: !!fatal });
  }
  window.addEventListener('error', function (e) {
    if (e && e.message && !/ResizeObserver|Script error/i.test(e.message)) report('window.onerror', e.message + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : ''), e.error && e.error.stack, false);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; report('unhandledrejection', (r && r.message) || r, r && r.stack, false);
  });
  window.AppTelemetry = { report: report, kind: KIND, version: function () { return version; } };

  if (!isTop) return; // pages inside iframes only need the headers + crash hook above

  // 2 ── activity ping (at most every 10 min)
  function ping() {
    var last = Number(lsGet('th_last_ping') || 0);
    if (!userId() || Date.now() - last < 10 * 60 * 1000) return;
    lsSet('th_last_ping', String(Date.now()));
    post('/api/telemetry/ping', {});
  }

  // 5 ── feature flags
  var flagCache = {};
  try { flagCache = JSON.parse(lsGet('th_flags') || '{}') || {}; } catch (e) { flagCache = {}; }
  window.AppFlags = {
    isOn: function (key, fallback) { return Object.prototype.hasOwnProperty.call(flagCache, key) ? !!flagCache[key] : !!fallback; },
    all: function () { return Object.assign({}, flagCache); }
  };
  function loadFlags() {
    var u = userId();
    origFetch.call(window, apiBase() + '/api/flags' + (u ? '?userId=' + encodeURIComponent(u) : ''), { headers: { 'X-App-Platform': KIND } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.degraded || !d.flags) return;           // server hiccup: keep last known flags
        flagCache = d.flags; lsSet('th_flags', JSON.stringify(flagCache));
        try { window.dispatchEvent(new CustomEvent('appflags', { detail: flagCache })); } catch (e) { /* old webview */ }
      }).catch(function () {});
  }

  // 4 ── update check
  function cmp(a, b) {
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  function showUpdate(type, rel) {
    if (document.getElementById('thUpdate')) return;
    var forced = type === 'required';
    if (!forced && lsGet('th_update_dismissed') === rel.version) return;
    var el = document.createElement('div'); el.id = 'thUpdate';
    el.style.cssText = forced
      ? 'position:fixed;inset:0;z-index:2147483647;background:rgba(10,2,8,.96);color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;text-align:center'
      : 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000;background:#260519;color:#fff;border:1px solid #7C0A57;border-radius:14px;padding:14px 16px;font-family:system-ui,sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 8px 30px rgba(0,0,0,.4)';
    var title = document.createElement('div'), msg = document.createElement('div'), btn = document.createElement('button');
    title.style.cssText = 'font-weight:700;font-size:' + (forced ? '20px' : '14px');
    title.textContent = rel.title || (forced ? 'Update required' : 'Update available');
    msg.style.cssText = 'opacity:.8;font-size:13px;margin-top:4px';
    msg.textContent = rel.message || ('Version ' + rel.version + ' is ready.');
    btn.textContent = isNative ? 'Update' : 'Reload';
    btn.style.cssText = 'background:#B0127A;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:600;margin-top:' + (forced ? '18px' : '0') + ';flex-shrink:0';
    btn.onclick = function () {
      if (isNative && rel.updateUrl) { window.open(rel.updateUrl, '_system'); return; }
      try { if (window.caches) caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).finally(function () { location.reload(); }); else location.reload(); }
      catch (e) { location.reload(); }
    };
    var box = document.createElement('div'); box.appendChild(title); box.appendChild(msg);
    if (forced) { box.style.maxWidth = '340px'; box.appendChild(btn); el.appendChild(box); }
    else {
      box.style.flex = '1'; el.appendChild(box); el.appendChild(btn);
      var x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'Dismiss');
      x.style.cssText = 'background:none;border:0;color:#fff;opacity:.6;font-size:16px';
      x.onclick = function () { lsSet('th_update_dismissed', rel.version); el.remove(); };
      el.appendChild(x);
    }
    document.body.appendChild(el);
  }
  function checkRelease() {
    if (!version) return;
    origFetch.call(window, apiBase() + '/api/releases/check?version=' + encodeURIComponent(version) + '&platform=' + (isNative ? 'android' : 'web'), { headers: { 'X-App-Platform': KIND } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.updateAvailable && d.release && cmp(version, d.release.version) < 0) showUpdate(d.updateType, d.release);
      }).catch(function () {}); // offline / server down: never block the app
  }

  function start() {
    loadNativeVersion().then(function () { ping(); loadFlags(); checkRelease(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
