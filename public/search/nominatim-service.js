/**
 * nominatim-service.js
 * ─────────────────────────────────────────────────────────────
 * Free-text global place/address search and reverse geocoding via
 * OSM Nominatim. Used as the fallback/primary for "search anything,
 * anywhere" queries that don't map to a fixed category.
 *
 * NOTE: Nominatim's public usage policy asks for max 1 request/sec
 * and a descriptive UA — search-service.js's debounce + dedupe
 * layer keeps us well within that.
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  const BASE = 'https://nominatim.openstreetmap.org';

  /**
   * Free-text search, optionally biased near a point.
   * @param {string} q
   * @param {{lat:number,lng:number}} [near]  soft bias, not a hard filter
   * @param {number} [limit]
   * @param {AbortSignal} [signal]
   */
  async function search(q, { near, limit = 15, signal } = {}) {
    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      limit: String(limit),
      q
    });
    if (near) {
      // Nominatim viewbox soft-biases results toward this area (±~1.5°)
      params.set('viewbox', `${near.lng - 1.5},${near.lat + 1.5},${near.lng + 1.5},${near.lat - 1.5}`);
      params.set('bounded', '0');
    }
    const res = await fetch(`${BASE}/search?${params}`, {
      headers: { 'Accept-Language': 'en' },
      signal
    });
    if (!res.ok) throw new Error(`Nominatim search failed: ${res.status}`);
    const data = await res.json();
    return data.map(d => normalize(d, near));
  }

  /** Reverse geocode a lat/lng into a readable place/address. */
  async function reverse(lat, lng, { signal } = {}) {
    const params = new URLSearchParams({ format: 'json', lat: String(lat), lon: String(lng) });
    const res = await fetch(`${BASE}/reverse?${params}`, { signal });
    if (!res.ok) throw new Error(`Nominatim reverse failed: ${res.status}`);
    const d = await res.json();
    return normalize(d, null);
  }

  function normalize(d, origin) {
    return {
      id: 'nom_' + d.place_id,
      source: 'nominatim',
      name: (d.display_name || '').split(',')[0],
      category: d.type || 'place',
      icon: '📍',
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      address: d.display_name,
      distKm: origin ? global.SearchUtils.haversine(origin, { lat: parseFloat(d.lat), lng: parseFloat(d.lon) }) : null,
      raw: d
    };
  }

  global.NominatimService = { search, reverse };
})(window);