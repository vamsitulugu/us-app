/**
 * overpass-service.js
 * ─────────────────────────────────────────────────────────────
 * Executes category-based "nearby" queries against Overpass API.
 * Free & open, no key required. Falls through across public
 * mirrors with a per-mirror timeout + one retry with backoff on
 * each, so one slow/dead mirror can't stall the whole search, and
 * finally falls back to the last known IndexedDB result if every
 * mirror (and the backend proxy) is down.
 *
 * Depends on: category-map.js (window.SearchCategoryMap)
 * Optional:   idb-cache.js (window.IDBCache) for offline fallback
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  const API_BASE = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();
  const PROXY_ENDPOINT = API_BASE + '/api/search/overpass';

  // Ordered by real-world reliability against the industry-wide Overpass
  // overload (overpass-api.de has been shedding load since Apr 2026, which
  // pushed traffic onto the smaller mirrors too — spreading requests across
  // more independent instances is the actual fix here, not any one "best" URL).
  const MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
    'https://overpass.nchc.org.tw/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];

  const OVERPASS_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': 'USCouplesApp/1.0 (personal project; contact via app)'
  };

  const PER_MIRROR_TIMEOUT_MS = 7000;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** Races a fetch against a timeout, honoring the caller's own AbortSignal too. */
  function fetchWithTimeout(url, opts, timeoutMs, outerSignal) {
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    if (outerSignal) {
      if (outerSignal.aborted) ctrl.abort();
      else outerSignal.addEventListener('abort', onOuterAbort);
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: ctrl.signal })
      .finally(() => {
        clearTimeout(timer);
        if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
      });
  }

  function buildQuery(catIds, lat, lng, radiusM = 5000, limit = 40) {
    const filters = [];
    catIds.forEach(id => {
      (global.SearchCategoryMap.overpassFiltersFor(id) || []).forEach(f => filters.push(f));
    });
    if (!filters.length) return null;
    const clauses = filters.map(f => `node${f}(around:${radiusM},${lat},${lng});way${f}(around:${radiusM},${lat},${lng});`).join('');
    return `[out:json][timeout:20];(${clauses});out center ${limit};`;
  }

  /** Tries one mirror once, with a hard timeout. Throws on any failure (incl. abort). */
  async function tryMirror(mirror, query, signal) {
    const res = await fetchWithTimeout(mirror, {
      method: 'POST',
      headers: OVERPASS_HEADERS,
      body: 'data=' + encodeURIComponent(query)
    }, PER_MIRROR_TIMEOUT_MS, signal);
    if (!res.ok) throw new Error(`Overpass ${mirror} returned ${res.status}`);
    return await res.json();
  }

  /**
   * Runs the query, walking mirrors in order. Each mirror gets one
   * immediate attempt and — for transient network errors only, not
   * 4xx — one retry after a short backoff, before moving on.
   */
  async function runQuery(query, signal) {
    let lastErr = null;
    for (const mirror of MIRRORS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await tryMirror(mirror, query, signal);
        } catch (e) {
          if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          lastErr = e;
          const status = /returned (\d+)/.exec(e.message || '')?.[1];
          const isClientError = status && Number(status) >= 400 && Number(status) < 500;
          if (isClientError || attempt === 1) break; // no point retrying a 4xx, or out of retries
          await sleep(400 * (attempt + 1)); // small backoff before the retry
        }
      }
    }

    // Backend proxy as a last resort before giving up on "live" data.
    if (PROXY_ENDPOINT) {
      try {
        const res = await fetchWithTimeout(PROXY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        }, PER_MIRROR_TIMEOUT_MS, signal);
        if (res.ok) return await res.json();
      } catch (e) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        lastErr = e;
      }
    }

    throw lastErr || new Error('All Overpass mirrors failed');
  }

  function normalize(data, catId, origin) {
    return (data.elements || [])
      .map(el => {
        const p = el.center || el;
        const tags = el.tags || {};
        if (!p.lat || !p.lon) return null;
        const meta = global.SearchCategoryMap.getCategory(catId);
        return {
          id: 'osm_' + el.type + el.id,
          source: 'overpass',
          name: tags.name || meta.label,
          category: catId,
          icon: meta.icon,
          lat: p.lat,
          lng: p.lon,
          address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', '),
          phone: tags.phone || tags['contact:phone'] || null,
          website: tags.website || tags['contact:website'] || null,
          openingHours: tags.opening_hours || null,
          distKm: origin ? global.SearchUtils.haversine(origin, { lat: p.lat, lng: p.lon }) : null,
          raw: tags
        };
      })
      .filter(Boolean);
  }

  /**
   * High-level: search one-or-more categories near a point.
   * Returns { results, live } — `live` is false when every category
   * fell all the way back to offline cache (so callers can show a
   * "showing saved results" hint instead of pretending it's fresh).
   */
  async function searchNearby({ catIds, lat, lng, radiusM = 5000, limit = 40, signal }) {
    const catList = Array.isArray(catIds) ? catIds : [catIds];
    const results = [];
    let anySucceeded = false;

    for (const catId of catList) {
      const query = buildQuery([catId], lat, lng, radiusM, limit);
      if (!query) continue;
      const cacheKey = `overpass:${catId}:${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusM}`;
      try {
        const data = await runQuery(query, signal);
        const normalized = normalize(data, catId, { lat, lng });
        results.push(...normalized);
        anySucceeded = true;
        if (normalized.length && global.IDBCache) global.IDBCache.set(cacheKey, normalized);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn(`[overpass-service] category "${catId}" failed live, trying offline cache:`, e.message);
        if (global.IDBCache) {
          const cached = await global.IDBCache.get(cacheKey);
          if (cached?.length) results.push(...cached.map(r => ({ ...r, fromOfflineCache: true })));
        }
      }
    }

    return { results: results.sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0)).slice(0, limit), live: anySucceeded };
  }

  global.OverpassService = { buildQuery, runQuery, normalize, searchNearby, MIRRORS };
})(window);
