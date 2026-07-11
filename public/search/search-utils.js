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

  global.SearchUtils = { haversine, toRad, debounce, hashKey };
})(window);