/* ═══════════════════════════════════════════════════════════════
   NET RESILIENCE — makes the web app behave well on weak / switching /
   missing networks (Wi-Fi <-> mobile data, 2G/3G, tunnels, airplane mode).

   What it gives the rest of the app (window.Net):
   - Net.online()        true / false, always current
   - Net.quality()       'offline' | 'slow' | 'ok'   (uses the Network Information
                         API where the browser has it; otherwise 'ok' when online)
   - Net.timeoutScale()  1 on a good network, 2.5 on slow, so one fixed timeout
                         doesn't cut off a request that is just slow
   - Net.outbox          a small persistent queue (IndexedDB, localStorage fallback).
                         Things the person did while offline wait here, survive
                         closing the app, and are sent when the network is back.
   - Net.onFlush(fn)     register a function that sends queued items; it runs when
                         the connection returns, when the app is re-opened and
                         every 15 s while something is still waiting.
   - a slim banner ("You're offline…" / "Slow connection…") — no framework needed.

   Everything is additive: if this file fails to load, the app works as before.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.Net) return;

  // ── connectivity ───────────────────────────────────────────
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  let state = navigator.onLine === false ? 'offline' : 'ok';
  const listeners = new Set();

  function computeQuality() {
    if (navigator.onLine === false) return 'offline';
    if (conn) {
      const t = conn.effectiveType;
      if (t === 'slow-2g' || t === '2g' || conn.saveData === true) return 'slow';
      if (t === '3g' && conn.downlink && conn.downlink < 0.7) return 'slow';
    }
    return 'ok';
  }

  function setState(next) {
    if (next === state) return;
    const prev = state;
    state = next;
    updateBanner();
    listeners.forEach(fn => { try { fn(state, prev); } catch (_) {} });
    try { window.dispatchEvent(new CustomEvent('net:change', { detail: { state, prev } })); } catch (_) {}
    if (prev === 'offline' && state !== 'offline') flushSoon(300);
  }

  function refresh() { setState(computeQuality()); }

  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  if (conn && conn.addEventListener) conn.addEventListener('change', refresh);

  // The 'online' event only says "a network interface is up", not "the internet
  // works" (captive Wi-Fi, no data left). A request that fails at the network
  // level reports here, so the banner and the queue stay honest.
  function reportNetworkFailure() { if (navigator.onLine !== false && state === 'ok') { /* stay ok: just retry later */ } flushSoon(8000); }
  function reportNetworkSuccess() { if (state === 'offline' && navigator.onLine !== false) refresh(); }

  // ── banner ─────────────────────────────────────────────────
  let banner = null, hideTimer = null;
  function ensureBanner() {
    if (banner || !document.body) return banner;
    banner = document.createElement('div');
    banner.id = 'netBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483000',
      'padding:calc(env(safe-area-inset-top,0px) + 6px) 12px 6px',
      'font:600 12.5px/1.3 Inter,system-ui,sans-serif', 'text-align:center',
      'color:#fff', 'transform:translateY(-110%)', 'transition:transform .25s ease',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(banner);
    return banner;
  }
  let shownBad = false; // true once we've shown an offline/slow message, so "Back online" only follows one
  function showBanner(text, bg, autoHideMs) {
    banner.textContent = text;
    banner.style.background = bg;
    banner.style.transform = 'translateY(0)';
    if (autoHideMs) hideTimer = setTimeout(() => { if (banner) banner.style.transform = 'translateY(-110%)'; }, autoHideMs);
  }
  function updateBanner() {
    if (!ensureBanner()) return;
    clearTimeout(hideTimer);
    if (state === 'offline') {
      shownBad = true;
      const n = pendingCount;
      showBanner(n ? "You're offline — " + n + (n > 1 ? ' items' : ' item') + " will send when you're back" : "You're offline — showing saved data", '#7a1f2b');
    } else if (state === 'slow') {
      shownBad = true;
      showBanner('Slow connection — things may take a bit longer', '#8a5a00', 4000);
    } else if (shownBad) {
      shownBad = false;
      showBanner('Back online', '#1f6b3a', 1800);
    } else {
      banner.style.transform = 'translateY(-110%)';
    }
  }

  // ── persistent outbox (IndexedDB, with localStorage fallback) ──
  const DB_NAME = 'th_outbox', STORE = 'items', LS_KEY = 'th_outbox_ls';
  let dbPromise = null, pendingCount = 0;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return dbPromise;
  }
  function lsRead() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (_) { return []; } }
  function lsWrite(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (_) {} }

  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const out = fn(store);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const outbox = {
    /** item: { id (unique, e.g. the clientId), kind ('chat', ...), body (JSON-safe), ts } */
    async add(item) {
      item = Object.assign({ ts: Date.now(), tries: 0 }, item);
      const db = await openDb();
      if (db) { try { await tx(db, 'readwrite', s => s.put(item)); } catch (_) { const a = lsRead().filter(x => x.id !== item.id); a.push(item); lsWrite(a); } }
      else { const a = lsRead().filter(x => x.id !== item.id); a.push(item); lsWrite(a); }
      await outbox.count();
      updateBanner();
      return item;
    },
    async all(kind) {
      const db = await openDb();
      let rows = [];
      if (db) { try { rows = await tx(db, 'readonly', s => s.getAll()); } catch (_) { rows = []; } }
      rows = rows.concat(lsRead());
      const seen = new Set();
      rows = rows.filter(r => r && !seen.has(r.id) && seen.add(r.id));
      if (kind) rows = rows.filter(r => r.kind === kind);
      return rows.sort((a, b) => a.ts - b.ts);
    },
    async remove(id) {
      const db = await openDb();
      if (db) { try { await tx(db, 'readwrite', s => s.delete(id)); } catch (_) {} }
      lsWrite(lsRead().filter(x => x.id !== id));
      await outbox.count();
      updateBanner();
    },
    async update(item) { return outbox.add(item); },
    async count() { pendingCount = (await outbox.all()).length; return pendingCount; }
  };

  // ── flushing ───────────────────────────────────────────────
  const flushers = [];
  let flushing = false, flushTimer = null;

  async function flush() {
    if (flushing || state === 'offline' || navigator.onLine === false) return;
    flushing = true;
    try { for (const fn of flushers) { try { await fn(); } catch (_) {} } }
    finally { flushing = false; }
    await outbox.count();
    updateBanner();
    if (pendingCount > 0) flushSoon(15000);
  }
  function flushSoon(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms == null ? 0 : ms); }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); flushSoon(500); } });
  window.addEventListener('pageshow', () => flushSoon(500));

  // ── helpers other scripts can use ──────────────────────────
  /** true when an error came from the network (not from the server saying "no"). */
  function isNetworkError(e) {
    if (navigator.onLine === false) return true;
    if (!e) return false;
    if (e.name === 'AbortError' || e.name === 'TypeError') return true;
    return /timed out|failed to fetch|networkerror|load failed|network request failed|offline/i.test(String(e.message || e));
  }

  window.Net = {
    online: () => state !== 'offline',
    quality: () => state,
    timeoutScale: () => (state === 'slow' ? 2.5 : 1),
    isNetworkError,
    outbox,
    onFlush(fn) { flushers.push(fn); },
    flush, flushSoon,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reportNetworkFailure, reportNetworkSuccess,
    pending: () => pendingCount
  };

  function boot() {
    state = computeQuality();
    ensureBanner();
    outbox.count().then(() => { updateBanner(); if (pendingCount > 0) flushSoon(1500); });
    if (state === 'offline') updateBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
