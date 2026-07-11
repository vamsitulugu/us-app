/**
 * photon-service.js
 * ─────────────────────────────────────────────────────────────
 * Photon (photon.komoot.io) — free, open-source geocoder built for
 * live-typing autocomplete. Faster and more typo-tolerant than
 * Nominatim, so this powers the instant-suggestion dropdown while
 * Nominatim/Overpass power the "commit" search.
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  const BASE = 'https://photon.komoot.io/api';

  /**
   * Live-typing suggestions. Designed to be called on every keystroke
   * (search-service.js debounces this).
   * @param {string} q
   * @param {{lat:number,lng:number}} [near] biases ranking toward this point
   * @param {number} [limit]
   * @param {AbortSignal} [signal]
   */
  async function suggest(q, { near, limit = 8, signal } = {}) {
    if (!q || q.trim().length < 2) return [];
    const params = new URLSearchParams({ q, limit: String(limit), lang: 'en' });
    if (near) { params.set('lat', String(near.lat)); params.set('lon', String(near.lng)); }
    const res = await fetch(`${BASE}?${params}`, { signal });
    if (!res.ok) throw new Error(`Photon suggest failed: ${res.status}`);
    const data = await res.json();
    return (data.features || []).map(f => normalize(f, near));
  }

  function normalize(f, origin) {
    const p = f.properties || {};
    const [lng, lat] = f.geometry.coordinates;
    const nameParts = [p.name, p.street, p.city, p.state, p.country].filter(Boolean);
    return {
      id: 'photon_' + (p.osm_type || 'x') + (p.osm_id || Math.random().toString(36).slice(2)),
      source: 'photon',
      name: p.name || nameParts[0] || 'Unknown place',
      category: p.osm_value || p.osm_key || 'place',
      icon: '📍',
      lat, lng,
      address: nameParts.slice(1).join(', '),
      distKm: origin ? global.SearchUtils.haversine(origin, { lat, lng }) : null,
      raw: p
    };
  }

  global.PhotonService = { suggest };
})(window);