/**
 * idb-cache.js
 * ─────────────────────────────────────────────────────────────
 * Persistent, cross-session search cache backed by IndexedDB.
 * This is the layer that makes "previously searched places still
 * work offline" true, and it's what stops every reload from
 * re-hitting Overpass/Nominatim for the same query.
 *
 * Two stores:
 *   - "results"  keyed by query hash, TTL-based, holds place arrays
 *   - "meta"     small bookkeeping (last write time etc.)
 *
 * Fails soft everywhere: if IndexedDB is unavailable (old Safari,
 * private mode, etc.) every method just resolves to null/[] instead
 * of throwing, so callers never need a try/catch of their own.
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  const DB_NAME = 'us_search_cache';
  const DB_VERSION = 1;
  const STORE = 'results';
  const LONG_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — this is the offline safety net

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    if (!('indexedDB' in global)) { dbPromise = Promise.resolve(null); return dbPromise; }
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null); // fail soft
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }

  async function get(key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const row = req.result;
          if (!row) return resolve(null);
          if (Date.now() - row.ts > LONG_TTL_MS) return resolve(null); // expired
          resolve(row.data);
        };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  async function set(key, data) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, data, ts: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  /** Housekeeping: drop entries older than the long TTL. Safe to call occasionally. */
  async function prune() {
    const db = await openDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        if (Date.now() - cursor.value.ts > LONG_TTL_MS) cursor.delete();
        cursor.continue();
      };
    } catch (e) { /* fail soft */ }
  }

  global.IDBCache = { get, set, prune };
})(window);
