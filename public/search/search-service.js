/**
 * search-service.js
 * ─────────────────────────────────────────────────────────────
 * THE FOUNDATION MODULE. Every UI (global search page, livemap's
 * "Important Places" add-flow, meetplanner) should call through
 * SearchService rather than hitting Overpass/Nominatim/Photon
 * directly — this is what gives you dedupe, cancellation, caching,
 * and a single place to swap providers later.
 *
 * Load order (put these <script> tags in this order):
 *   1. search-utils.js
 *   2. category-map.js
 *   3. geolocation-service.js
 *   4. overpass-service.js
 *   5. nominatim-service.js
 *   6. photon-service.js
 *   7. search-service.js   (this file)
 *
 * Public API:
 *   SearchService.autocomplete(query, opts)   -> live-typing suggestions (Photon)
 *   SearchService.searchText(query, opts)     -> committed free-text search (Nominatim)
 *   SearchService.searchCategory(catIds, opts)-> nearby-by-category (Overpass)
 *   SearchService.searchNearMe(catIds, opts)  -> uses device GPS as origin
 *   SearchService.cancelAll()                 -> aborts every in-flight request
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min in-memory result cache
  const memCache = new Map(); // key -> { data, ts }
  const inflightControllers = {}; // requestType -> AbortController (for cancel-stale)

  function getCached(key) {
    const hit = memCache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
    if (hit) memCache.delete(key);
    return null;
  }
  function setCached(key, data) {
    memCache.set(key, { data, ts: Date.now() });
    // simple size cap so this never grows unbounded on a long session
    if (memCache.size > 200) {
      const oldestKey = memCache.keys().next().value;
      memCache.delete(oldestKey);
    }
  }

  /** Cancels any in-flight request of this type and starts a fresh AbortController. */
  function freshSignal(type) {
    if (inflightControllers[type]) inflightControllers[type].abort();
    const controller = new AbortController();
    inflightControllers[type] = controller;
    return controller.signal;
  }

  function cancelAll() {
    Object.values(inflightControllers).forEach(c => c && c.abort());
  }

  /**
   * Live-typing autocomplete. Debounced by design — call this on every
   * keystroke; only the trailing call after `wait`ms actually fires,
   * and any still-pending network call for a stale keystroke is aborted.
   */
  const autocomplete = global.SearchUtils.debounce(async function (query, { near, limit = 8 } = {}) {
    if (!query || query.trim().length < 2) return [];
    const key = global.SearchUtils.hashKey({ t: 'auto', query, near, limit });
    const cached = getCached(key);
    if (cached) return cached;

    const signal = freshSignal('autocomplete');
    try {
      const results = await global.PhotonService.suggest(query, { near, limit, signal });
      setCached(key, results);
      return results;
    } catch (e) {
      if (e.name === 'AbortError') return []; // superseded by a newer keystroke — not an error
      console.warn('[search-service] autocomplete failed, falling back to Nominatim:', e.message);
      try {
        const fallback = await global.NominatimService.search(query, { near, limit, signal });
        setCached(key, fallback);
        return fallback;
      } catch (e2) {
        return []; // both providers down — fail soft, UI shows empty state
      }
    }
  }, 300);

  /** Committed free-text search (e.g. user pressed Enter or tapped a suggestion's "search all"). */
  async function searchText(query, { near, limit = 20 } = {}) {
    if (!query || !query.trim()) return [];
    const key = global.SearchUtils.hashKey({ t: 'text', query, near, limit });
    const cached = getCached(key);
    if (cached) return cached;

    const signal = freshSignal('searchText');
    try {
      const results = await global.NominatimService.search(query, { near, limit, signal });
      setCached(key, results);
      return results;
    } catch (e) {
      if (e.name === 'AbortError') return []; // superseded by a newer call — not a real error
      throw e;
    }
  }

  /** Category-based nearby search, e.g. "hospitals near this point". */
  async function searchCategory(catIds, { lat, lng, radiusM = 5000, limit = 40 } = {}) {
    if (lat == null || lng == null) throw new Error('searchCategory requires { lat, lng }');
    const key = global.SearchUtils.hashKey({ t: 'cat', catIds, lat: lat.toFixed(3), lng: lng.toFixed(3), radiusM, limit });
    const cached = getCached(key);
    if (cached) return cached;

    const signal = freshSignal('searchCategory');
    try {
      const results = await global.OverpassService.searchNearby({ catIds, lat, lng, radiusM, limit, signal });
      setCached(key, results);
      return results;
    } catch (e) {
      if (e.name === 'AbortError') return []; // superseded by a newer call — not a real error
      throw e;
    }
  }

  /** Category search using the device's current GPS position as origin. */
  async function searchNearMe(catIds, { radiusM = 5000, limit = 40 } = {}) {
    const pos = await global.GeolocationService.getCurrentPosition();
    return searchCategory(catIds, { lat: pos.lat, lng: pos.lng, radiusM, limit });
  }

  global.SearchService = { autocomplete, searchText, searchCategory, searchNearMe, cancelAll };
})(window);