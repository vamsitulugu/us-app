/**
 * search-utils.js
 * ─────────────────────────────────────────────────────────────
 * Small dependency-free helpers shared by every search module.
 * Load this FIRST, before overpass/nominatim/photon services.
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  /** Great-circle distance in km between two {lat,lng} points. */
  function haversine(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s1), Math.sqrt(1 - s1));
  }
  function toRad(deg) { return deg * Math.PI / 180; }

  /** Standard debounce — used to throttle keystroke-triggered searches. */
  function debounce(fn, wait = 300) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      return new Promise(resolve => {
        t = setTimeout(() => resolve(fn.apply(this, args)), wait);
      });
    };
  }

  /** Simple stable hash for cache keys (query + params). */
  function hashKey(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
  }

  /** Levenshtein edit distance — powers fuzzy/typo-tolerant matching. */
  function editDistance(a, b) {
    a = (a || '').toLowerCase(); b = (b || '').toLowerCase();
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  /** 0..1 fuzzy similarity score (1 = identical), tolerant of typos like "Hotal"/"Hospitl". */
  function fuzzyScore(query, target) {
    if (!query || !target) return 0;
    query = query.toLowerCase().trim(); target = target.toLowerCase().trim();
    if (target.includes(query)) return 1; // substring match is always a strong hit
    const dist = editDistance(query, target.slice(0, query.length + 3));
    const maxLen = Math.max(query.length, 3);
    return Math.max(0, 1 - dist / maxLen);
  }

  /** Removes duplicate places across providers using proximity + name similarity. */
  function dedupe(places, distThresholdKm = 0.05) {
    const out = [];
    for (const p of places) {
      const dupe = out.find(o =>
        o.lat != null && p.lat != null &&
        haversine(o, p) < distThresholdKm &&
        fuzzyScore(o.name || '', p.name || '') > 0.6
      );
      if (!dupe) out.push(p);
      else if ((p.raw && Object.keys(p.raw).length) > (dupe.raw && Object.keys(dupe.raw).length || 0)) {
        Object.assign(dupe, p, { id: dupe.id });
      }
    }
    return out;
  }

  global.SearchUtils = { haversine, toRad, debounce, hashKey, editDistance, fuzzyScore, dedupe };
})(window);