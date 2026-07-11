/**
 * overpass-service.js
 * ─────────────────────────────────────────────────────────────
 * Executes category-based "nearby" queries against Overpass API.
 * Free & open, no key required. Falls back across public mirrors
 * if the primary instance is rate-limited or down.
 *
 * Depends on: category-map.js (window.SearchCategoryMap)
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  // Public Overpass mirrors frequently reject cross-origin POSTs from
  // browser apps on arbitrary deployed domains (CORS block / 406).
  // We route through our own backend instead — see routes/search.js —
  // which proxies to the mirrors server-side (no CORS there) and also
  // caches results in Supabase. Set to null to bypass the proxy and
  // hit mirrors directly (only reliable on localhost).
  const PROXY_ENDPOINT = '/api/search/overpass';

  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];

  /**
   * Builds an Overpass QL query for one or more categories around a point.
   * @param {string[]} catIds    category ids from category-map.js
   * @param {number} lat
   * @param {number} lng
   * @param {number} radiusM     search radius in meters
   * @param {number} limit       max results (applied via `out ... N`)
   */
  function buildQuery(catIds, lat, lng, radiusM = 5000, limit = 40) {
    const filters = [];
    catIds.forEach(id => {
      (global.SearchCategoryMap.overpassFiltersFor(id) || []).forEach(f => filters.push(f));
    });
    if (!filters.length) return null; // custom/free-text categories have no tag filter

    const clauses = filters.map(f => `node${f}(around:${radiusM},${lat},${lng});way${f}(around:${radiusM},${lat},${lng});`).join('');
    return `[out:json][timeout:20];(${clauses});out center ${limit};`;
  }

  /**
   * Runs the query, trying mirrors in order until one succeeds.
   * @param {string} query        Overpass QL string
   * @param {AbortSignal} signal  for request cancellation (stale-request handling)
   */
  async function runQuery(query, signal) {
    // 1. Preferred path: our own backend proxy (no CORS issues, cached in Supabase)
    if (PROXY_ENDPOINT) {
      try {
        const res = await fetch(PROXY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal
        });
        if (res.ok) return await res.json();
        console.warn(`[overpass-service] proxy returned ${res.status}, falling back to direct mirrors`);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('[overpass-service] proxy unreachable, falling back to direct mirrors:', e.message);
      }
    }

    // 2. Fallback: call public mirrors directly from the browser
    //    (works on localhost; may be CORS-blocked on some deployed domains)
    let lastErr = null;
    for (const mirror of MIRRORS) {
      try {
        const res = await fetch(mirror, { method: 'POST', body: query, signal });
        if (!res.ok) throw new Error(`Overpass ${mirror} returned ${res.status}`);
        return await res.json();
      } catch (e) {
        if (e.name === 'AbortError') throw e; // don't retry a cancelled request
        lastErr = e;
        // try next mirror
      }
    }
    throw lastErr || new Error('All Overpass mirrors failed');
  }

  /** Normalizes raw Overpass elements into the app's common place shape. */
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
   * High-level: search one category near a point.
   * Returns normalized, distance-sorted results.
   */
  async function searchNearby({ catIds, lat, lng, radiusM = 5000, limit = 40, signal }) {
    const catList = Array.isArray(catIds) ? catIds : [catIds];
    const results = [];
    // Run each category as its own query so we can tag results correctly
    // and so one bad category doesn't fail the whole batch.
    for (const catId of catList) {
      const query = buildQuery([catId], lat, lng, radiusM, limit);
      if (!query) continue;
      try {
        const data = await runQuery(query, signal);
        results.push(...normalize(data, catId, { lat, lng }));
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn(`[overpass-service] category "${catId}" failed:`, e.message);
      }
    }
    return results.sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0)).slice(0, limit);
  }

  global.OverpassService = { buildQuery, runQuery, normalize, searchNearby, MIRRORS };
})(window);