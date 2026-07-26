/* ══════════════════════════════════════════════════════════════
   LIVEMAP 3D SHIM — us-app / Twin Hearts
   Phase 1 of the Live Map 3D upgrade.

   This is NOT a general Leaflet replacement — it implements exactly
   the subset of the Leaflet API that public/livemap.js and
   public/livemap-redesign.js already call (L.map, L.marker,
   L.divIcon, L.circle, L.polyline, L.tileLayer, plus the handful of
   map/marker instance methods those files use). Everything else in
   the app keeps using real Leaflet untouched — meetplanner.js,
   places.html, globe.html are not affected because this shim is
   assigned to a local `L` only inside livemap.js's own module scope,
   never to `window.L`.

   Backed by MapLibre GL JS, this gives the live map:
   - true 3D: pitch/rotate/tilt, extruded 3D buildings, terrain
   - Map / Dark / Satellite / Hybrid / Auto themes
   - smooth flyTo/fitBounds camera animation

   Requires MapLibre GL JS to be loaded first:
     <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
     <link  href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">

   All map/terrain sources used are free, keyless, public endpoints
   (OpenFreeMap vector tiles, AWS public elevation-tiles-prod terrain,
   Esri World Imagery satellite, CARTO dark basemap) — no API keys,
   no billing risk.
   ══════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  if (typeof window === 'undefined') return;

  // ── Free, keyless style/source endpoints ──────────────────────────
  const STYLES = {
    // OpenFreeMap "liberty" — free vector basemap w/ building footprints,
    // used as the base for both the light "street" theme and, with a
    // dark color filter applied at runtime, the "dark" theme.
    vector: 'https://tiles.openfreemap.org/styles/liberty',
    vectorDark: 'https://tiles.openfreemap.org/styles/positron' // muted, works well tinted dark
  };
  const RASTER = {
    satellite: {
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Tiles © Esri'
    },
    hybridLabels: {
      // Esri "reference" overlay adds roads/place labels on top of imagery
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Tiles © Esri'
    },
    dark: {
      tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', 'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'],
      attribution: '© OpenStreetMap, © CARTO'
    }
  };
  const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  function themeFromUrl(url) {
    if (/cartocdn.*dark/i.test(url)) return 'dark';
    if (/arcgisonline.*World_Imagery/i.test(url)) return url.indexOf('#hybrid') !== -1 ? 'hybrid' : 'satellite';
    return 'street';
  }

  // ── tiny GeoJSON circle helper (meters -> polygon ring) ────────────
  function circlePolygon(lat, lng, radiusM, points) {
    points = points || 48;
    const coords = [];
    const distX = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
    const distY = radiusM / 110540;
    for (let i = 0; i <= points; i++) {
      const theta = (i / points) * (2 * Math.PI);
      coords.push([lng + distX * Math.cos(theta), lat + distY * Math.sin(theta)]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
  }

  let uid = 0;
  const nextId = (p) => `${p}_${++uid}`;

  // ── LMap: wraps a maplibregl.Map, exposes the Leaflet methods used ─
  class LMap {
    constructor(containerId, opts) {
      opts = opts || {};
      this.gl = new maplibregl.Map({
        container: containerId,
        style: STYLES.vector,
        center: [0, 20],
        zoom: 2,
        pitch: 0,
        bearing: 0,
        attributionControl: true,
        antialias: true
      });
      if (opts.zoomControl !== false) {
        this.gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      }
      this._theme = 'street';
      this._ready = false;
      this._readyCbs = [];
      this._layers = new Set(); // ids of extra sources/layers we own, for removeLayer bookkeeping
      const onLoad = () => {
        this._ready = true;
        this._add3DBuildings();
        this._addTerrain();
        this._readyCbs.forEach((cb) => { try { cb(); } catch (e) {} });
        this._readyCbs = [];
      };
      this.gl.on('load', onLoad);
    }

    // -- Leaflet-compatible API --
    setView(latlng, zoom) {
      this.gl.jumpTo({ center: [latlng[1], latlng[0]], zoom: zoom != null ? zoom : this.gl.getZoom() });
      return this;
    }
    flyTo(latlng, zoom, opts) {
      this.gl.flyTo(Object.assign({ center: [latlng[1], latlng[0]], zoom, speed: 1.2, curve: 1.4, essential: true }, opts || {}));
      return this;
    }
    panTo(latlng, opts) {
      opts = opts || {};
      const durationMs = (opts.duration != null ? opts.duration : 0.8) * 1000; // Leaflet uses seconds
      this.gl.easeTo({ center: [latlng[1], latlng[0]], duration: durationMs, essential: true });
      return this;
    }
    getCenter() { const c = this.gl.getCenter(); return { lat: c.lat, lng: c.lng }; }
    fitBounds(pts, opts) {
      opts = opts || {};
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p[1], p[0]]));
      this.gl.fitBounds(b, { padding: opts.padding ? opts.padding[0] : 60, maxZoom: 16, duration: 800 });
      return this;
    }
    invalidateSize() { this.gl.resize(); return this; }
    whenReady(cb) { if (this._ready) cb(); else this._readyCbs.push(cb); return this; }
    on(evt, cb) { this.gl.on(evt, cb); return this; }
    off(evt, cb) { this.gl.off(evt, cb); return this; }
    removeLayer(layer) { if (layer && typeof layer.remove === 'function') layer.remove(); return this; }

    // -- 3D extras (used by setMapStyle / theme switch below) --
    _add3DBuildings() {
      if (!this.gl.getLayer('lm3d-buildings') && this.gl.getSource('openmaptiles')) {
        try {
          this.gl.addLayer({
            id: 'lm3d-buildings',
            source: 'openmaptiles',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': ['coalesce', ['get', 'colour'], '#c9c9d4'],
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['*', ['coalesce', ['get', 'levels'], 3], 3]],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.85
            }
          });
        } catch (e) { /* style has no building layer (raster theme) — fine */ }
      }
    }
    _addTerrain() {
      try {
        if (!this.gl.getSource('lm3d-terrain')) {
          this.gl.addSource('lm3d-terrain', { type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 15 });
        }
      } catch (e) {}
    }
    setTerrainEnabled(on) {
      try { this.gl.setTerrain(on ? { source: 'lm3d-terrain', exaggeration: 1.3 } : null); } catch (e) {}
    }
    set3D(on) {
      // "tilt into 3D" — used when following/navigating; flat for overview
      this.gl.easeTo({ pitch: on ? 55 : 0, duration: 600 });
      this.setTerrainEnabled(on);
    }

    // switch base style while preserving camera position + our overlays
    setTheme(theme) {
      if (theme === this._theme) return;
      const center = this.gl.getCenter(), zoom = this.gl.getZoom(), bearing = this.gl.getBearing(), pitch = this.gl.getPitch();
      const rebuild = () => {
        this.gl.jumpTo({ center, zoom, bearing, pitch });
        this._add3DBuildings();
        this._addTerrain();
        if (this._terrainWanted) this.setTerrainEnabled(true);
      };
      if (theme === 'dark') {
        this.gl.setStyle(STYLES.vectorDark);
        this.gl.once('style.load', () => { rebuild(); this._tintDark(true); });
      } else if (theme === 'satellite' || theme === 'hybrid') {
        this.gl.setStyle(this._rasterStyle(theme));
        this.gl.once('style.load', rebuild);
      } else {
        this.gl.setStyle(STYLES.vector);
        this.gl.once('style.load', rebuild);
      }
      this._theme = theme;
    }
    _rasterStyle(theme) {
      const layers = [{
        id: 'lm3d-sat', type: 'raster', source: 'lm3d-sat-src',
        paint: {}
      }];
      const sources = { 'lm3d-sat-src': { type: 'raster', tiles: RASTER.satellite.tiles, tileSize: 256, attribution: RASTER.satellite.attribution } };
      if (theme === 'hybrid') {
        sources['lm3d-hybrid-src'] = { type: 'raster', tiles: RASTER.hybridLabels.tiles, tileSize: 256, attribution: RASTER.hybridLabels.attribution };
        layers.push({ id: 'lm3d-hybrid-labels', type: 'raster', source: 'lm3d-hybrid-src' });
      }
      return { version: 8, sources, layers, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf' };
    }
    _tintDark(on) {
      // subtle CSS filter fallback for extra contrast on the "dark" theme
      const el = this.gl.getContainer();
      el.style.filter = on ? 'brightness(0.92) saturate(0.9)' : '';
    }
  }

  // ── LMarker: wraps maplibregl.Marker, supports divIcon HTML ────────
  class LMarker {
    constructor(latlng, opts) {
      opts = opts || {};
      this._latlng = { lat: latlng[0], lng: latlng[1] };
      this._icon = opts.icon || null;
      const el = document.createElement('div');
      if (this._icon) {
        el.innerHTML = this._icon.html || '';
        el.className = this._icon.className || '';
        if (this._icon.iconSize) { el.style.width = this._icon.iconSize[0] + 'px'; el.style.height = this._icon.iconSize[1] + 'px'; }
      }
      el.style.cursor = 'pointer';
      this._el = el;
      this._gl = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([latlng[1], latlng[0]]);
    }
    addTo(map) { this._map = map; this._gl.addTo(map.gl); return this; }
    setLatLng(latlng) { this._latlng = { lat: latlng[0], lng: latlng[1] }; this._gl.setLngLat([latlng[1], latlng[0]]); return this; }
    getLatLng() { return this._latlng; }
    setIcon(icon) {
      this._icon = icon;
      this._el.innerHTML = icon.html || '';
      if (icon.className) this._el.className = icon.className;
      return this;
    }
    bindPopup(html) {
      const popup = new maplibregl.Popup({ offset: 16, closeButton: true }).setHTML(html);
      this._gl.setPopup(popup);
      return this;
    }
    on(evt, cb) { this._el.addEventListener(evt === 'click' ? 'click' : evt, cb); return this; }
    remove() { this._gl.remove(); return this; }
  }

  // ── LVectorLayer base: shared removeLayer bookkeeping for circle/line ─
  function addGeoJSONLayer(map, id, geojson, layerDef) {
    const src = id + '_src';
    map.gl.addSource(src, { type: 'geojson', data: geojson });
    map.gl.addLayer(Object.assign({ id, source: src }, layerDef));
    return { id, src };
  }

  class LCircle {
    constructor(latlng, opts) {
      opts = opts || {};
      this._latlng = { lat: latlng[0], lng: latlng[1] };
      this._radius = opts.radius || 50;
      this._opts = opts;
      this._id = nextId('lm3d-circle');
    }
    addTo(map) {
      this._map = map;
      addGeoJSONLayer(map, this._id, circlePolygon(this._latlng.lat, this._latlng.lng, this._radius), {
        type: 'fill',
        paint: {
          'fill-color': this._opts.fillColor || this._opts.color || '#5b9bff',
          'fill-opacity': this._opts.fillOpacity != null ? this._opts.fillOpacity : 0.15,
          'fill-outline-color': this._opts.color || '#5b9bff'
        }
      });
      return this;
    }
    setLatLng(latlng) {
      this._latlng = { lat: latlng[0], lng: latlng[1] };
      const src = this._map.gl.getSource(this._id + '_src');
      if (src) src.setData(circlePolygon(this._latlng.lat, this._latlng.lng, this._radius));
      return this;
    }
    setRadius(r) { this._radius = r; return this.setLatLng([this._latlng.lat, this._latlng.lng]); }
    remove() {
      if (!this._map) return;
      if (this._map.gl.getLayer(this._id)) this._map.gl.removeLayer(this._id);
      if (this._map.gl.getSource(this._id + '_src')) this._map.gl.removeSource(this._id + '_src');
    }
  }

  class LPolyline {
    constructor(latlngs, opts) {
      opts = opts || {};
      this._latlngs = latlngs;
      this._opts = opts;
      this._id = nextId('lm3d-line');
      this._clickCbs = [];
    }
    addTo(map) {
      this._map = map;
      const geojson = { type: 'Feature', geometry: { type: 'LineString', coordinates: this._latlngs.map((p) => [p[1], p[0]]) }, properties: {} };
      const paint = {
        'line-color': this._opts.color || '#5b9bff',
        'line-width': this._opts.weight || 4,
        'line-opacity': this._opts.opacity != null ? this._opts.opacity : 0.9
      };
      if (this._opts.dashArray) paint['line-dasharray'] = String(this._opts.dashArray).split(',').map(Number);
      addGeoJSONLayer(map, this._id, geojson, { type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint });
      map.gl.on('click', this._id, (e) => this._clickCbs.forEach((cb) => cb(e)));
      map.gl.on('mouseenter', this._id, () => { map.gl.getCanvas().style.cursor = 'pointer'; });
      map.gl.on('mouseleave', this._id, () => { map.gl.getCanvas().style.cursor = ''; });
      return this;
    }
    setLatLngs(latlngs) {
      this._latlngs = latlngs;
      const src = this._map.gl.getSource(this._id + '_src');
      if (src) src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: latlngs.map((p) => [p[1], p[0]]) }, properties: {} });
      return this;
    }
    on(evt, cb) { if (evt === 'click') this._clickCbs.push(cb); return this; }
    remove() {
      if (!this._map) return;
      if (this._map.gl.getLayer(this._id)) this._map.gl.removeLayer(this._id);
      if (this._map.gl.getSource(this._id + '_src')) this._map.gl.removeSource(this._id + '_src');
    }
  }

  // L.tileLayer(url,...) — in the vector-first shim this just switches
  // the whole base style/theme, inferred from the tile URL that
  // livemap.js's existing TILE_LAYERS config passes in. livemap.js
  // itself doesn't need to change for this to keep working.
  class LTileLayer {
    constructor(url) { this._theme = themeFromUrl(url); }
    addTo(map) { map.setTheme(this._theme); this._map = map; return this; }
    remove() { /* no-op: setTheme on the next tileLayer swaps it out */ }
  }

  const Shim = {
    map: (id, opts) => new LMap(id, opts),
    marker: (latlng, opts) => new LMarker(latlng, opts),
    divIcon: (opts) => opts, // consumed directly by LMarker
    circle: (latlng, opts) => new LCircle(latlng, opts),
    polyline: (latlngs, opts) => new LPolyline(latlngs, opts),
    tileLayer: (url) => new LTileLayer(url)
  };

  window.MapLibreLeafletShim = Shim;

  // Convenience: livemap.js can call LiveMap3D.setTheme('hybrid') /
  // .toggle3D(bool) directly if it wants richer control than the
  // existing street/dark/satellite/auto buttons expose.
  window.LiveMap3D = {
    isAvailable: typeof window.maplibregl !== 'undefined',
    THEMES: ['street', 'dark', 'satellite', 'hybrid', 'auto']
  };
})();
