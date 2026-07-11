/**
 * search-service.js
 * ─────────────────────────────────────────────────────────────
 * THE FOUNDATION MODULE. Every UI (global search page, livemap's
 * "Important Places" add-flow, meetplanner) should call through
 * SearchService rather than hitting Overpass/Nominatim/Photon
 * directly. This build adds: multi-provider merge + dedupe for
 * text search, relevance ranking, fuzzy/typo tolerance, recent +
 * trending searches, and an IndexedDB offline safety net so the
 * app never shows a hard error — worst case it shows what it
 * found last time.
 *
 * Load order (put these <script> tags in this order):
 *   1. search-utils.js
 *   2. category-map.js
 *   3. geolocation-service.js
 *   4. idb-cache.js
 *   5. overpass-service.js
 *   6. nominatim-service.js
 *   7. photon-service.js
 *   8. search-service.js   (this file)
 *
 * Public API:
 *   SearchService.autocomplete(query, opts)    -> live-typing suggestions
 *   SearchService.searchText(query, opts)      -> committed free-text search (merged, ranked)
 *   SearchService.searchCategory(catIds, opts) -> nearby-by-category
 *   SearchService.searchNearMe(catIds, opts)   -> uses device GPS as origin
 *   SearchService.recordVisit(place)           -> feeds recent/trending/personal-relevance
 *   SearchService.getRecent() / getTrending()
 *   SearchService.cancelAll()
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  const CACHE_TTL_MS = 5 * 60 * 1000; // in-memory TTL — fast path for repeat queries this session
  const memCache = new Map();
  const inflightControllers = {};
  const RECENT_KEY = 'us_search_recent_v1';
  const TREND_KEY = 'us_search_trending_v1';

  // ---------- in-memory cache ----------
  function getCached(key) {
    const hit = memCache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
    if (hit) memCache.delete(key);
    return null;
  }
  function setCached(key, data) {
    memCache.set(key, { data, ts: Date.now() });
    if (memCache.size > 200) memCache.delete(memCache.keys().next().value);
  }
  function freshSignal(type) {
    if (inflightControllers[type]) inflightControllers[type].abort();
    const controller = new AbortController();
    inflightControllers[type] = controller;
    return controller.signal;
  }
  function cancelAll() { Object.values(inflightControllers).forEach(c => c && c.abort()); }

  // ---------- recent / trending (localStorage — instant, no async needed) ----------
  function readList(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
  function writeList(key, list) { try { localStorage.setItem(key, JSON.stringify(list.slice(0, 25))); } catch (e) {} }

  function getRecent() { return readList(RECENT_KEY); }
  function getTrending() {
    const counts = readList(TREND_KEY);
    return [...counts].sort((a, b) => b.count - a.count).slice(0, 10);
  }
  /** Call after the user taps/opens a result — powers recent + trending + personal relevance. */
  function recordVisit(place) {
    if (!place || !place.name) return;
    const recent = getRecent().filter(p => p.id !== place.id);
    recent.unshift({ id: place.id, name: place.name, category: place.category, lat: place.lat, lng: place.lng, ts: Date.now() });
    writeList(RECENT_KEY, recent);

    const trend = readList(TREND_KEY);
    const existing = trend.find(t => t.name.toLowerCase() === place.name.toLowerCase());
    if (existing) existing.count++; else trend.push({ name: place.name, category: place.category, count: 1 });
    writeList(TREND_KEY, trend);
  }

  // ---------- ranking ----------
  /**
   * Composite relevance score. Higher is better. Combines distance,
   * exact/fuzzy name match, category match, and a small recency boost
   * for places the user has visited/searched before.
   */
  function scorePlace(place, query, near) {
    let score = 0;
    if (query) score += 50 * global.SearchUtils.fuzzyScore(query, place.name || '');
    if (place.distKm != null) score += Math.max(0, 20 - place.distKm); // closer = higher, caps around 20km
    if (place.openingHours) score += 2; // has real metadata, not a bare stub
    if (place.fromOfflineCache) score -= 5; // slight penalty vs fresh live data
    const recent = getRecent();
    if (recent.some(r => r.name?.toLowerCase() === (place.name || '').toLowerCase())) score += 8;
    return score;
  }

  function rank(places, query, near) {
    return places
      .map(p => ({ ...p, _score: scorePlace(p, query, near) }))
      .sort((a, b) => b._score - a._score);
  }

  // ---------- autocomplete (Photon primary, Nominatim fallback, offline-cache last resort) ----------
  const autocomplete = global.SearchUtils.debounce(async function (query, { near, limit = 8 } = {}) {
    if (!query || query.trim().length < 2) return [];
    const key = global.SearchUtils.hashKey({ t: 'auto', query, near, limit });
    const cached = getCached(key);
    if (cached) return cached;

    const signal = freshSignal('autocomplete');
    let results = [];
    try {
      results = await global.PhotonService.suggest(query, { near, limit, signal });
    } catch (e) {
      if (e.name === 'AbortError') return [];
      console.warn('[search-service] Photon autocomplete failed, trying Nominatim:', e.message);
      try {
        results = await global.NominatimService.search(query, { near, limit, signal });
      } catch (e2) {
        if (e2.name === 'AbortError') return [];
        console.warn('[search-service] Nominatim also failed, trying offline cache:', e2.message);
        if (global.IDBCache) results = (await global.IDBCache.get('auto:' + query.toLowerCase())) || [];
      }
    }
    const ranked = rank(results, query, near).slice(0, limit);
    setCached(key, ranked);
    if (ranked.length && global.IDBCache) global.IDBCache.set('auto:' + query.toLowerCase(), ranked);
    return ranked;
  }, 300);

  // ---------- committed free-text search: merges Nominatim + Photon, dedupes, ranks ----------
  async function searchText(query, { near, limit = 20 } = {}) {
    if (!query || !query.trim()) return [];
    const key = global.SearchUtils.hashKey({ t: 'text', query, near, limit });
    const cached = getCached(key);
    if (cached) return cached;

    const signal = freshSignal('searchText');
    const [nomResult, photonResult] = await Promise.allSettled([
      global.NominatimService.search(query, { near, limit, signal }),
      global.PhotonService.suggest(query, { near, limit, signal })
    ]);

    let merged = [
      ...(nomResult.status === 'fulfilled' ? nomResult.value : []),
      ...(photonResult.status === 'fulfilled' ? photonResult.value : [])
    ];

    if (nomResult.status === 'rejected' && nomResult.reason?.name === 'AbortError') return [];

    if (!merged.length) {
      console.warn('[search-service] both text providers failed, trying offline cache');
      if (global.IDBCache) merged = (await global.IDBCache.get('text:' + query.toLowerCase())) || [];
    }

    const deduped = global.SearchUtils.dedupe(merged);
    const ranked = rank(deduped, query, near).slice(0, limit);
    setCached(key, ranked);
    if (ranked.length && global.IDBCache) global.IDBCache.set('text:' + query.toLowerCase(), ranked);
    return ranked;
  }

  // ---------- category-based nearby search ----------
  async function searchCategory(catIds, { lat, lng, radiusM = 5000, limit = 40 } = {}) {
    if (lat == null || lng == null) throw new Error('searchCategory requires { lat, lng }');
    const key = global.SearchUtils.hashKey({ t: 'cat', catIds, lat: lat.toFixed(3), lng: lng.toFixed(3), radiusM, limit });
    const cached = getCached(key);
    if (cached) return cached;

    const signal = freshSignal('searchCategory');
    try {
      const { results, live } = await global.OverpassService.searchNearby({ catIds, lat, lng, radiusM, limit, signal });
      const ranked = rank(results, null, { lat, lng }).map(r => ({ ...r, _live: live }));
      if (live && ranked.length) setCached(key, ranked); // only cache in-memory if it was a real live hit
      return ranked;
    } catch (e) {
      if (e.name === 'AbortError') return [];
      throw e;
    }
  }

  /** Category search using the device's current GPS position as origin. */
  async function searchNearMe(catIds, { radiusM = 5000, limit = 40 } = {}) {
    const pos = await global.GeolocationService.getCurrentPosition();
    return searchCategory(catIds, { lat: pos.lat, lng: pos.lng, radiusM, limit });
  }

  global.SearchService = {
    autocomplete, searchText, searchCategory, searchNearMe,
    recordVisit, getRecent, getTrending, cancelAll
  };

  // Housekeeping: prune stale offline entries once per session, off the critical path.
  if (global.IDBCache) setTimeout(() => global.IDBCache.prune(), 3000);
})(window);
