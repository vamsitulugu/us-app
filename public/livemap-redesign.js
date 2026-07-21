/* public/livemap-redesign.js
   ────────────────────────────────────────────────────────────────
   Live Map UI redesign — loaded AFTER livemap.js and chat/call.js.
   Everything here is additive:
     • re-parents existing #page-map elements into the new
       header / partner-row / search / map / bottom-sheet layout
       (same IDs, same onclick="" handlers — nothing is cloned or
       rebuilt, so LiveMap's own logic keeps working untouched)
     • wraps LiveMap.searchAlongRoute with a route → destination →
       current-location fallback chain, plus radius/sort controls,
       debounce, caching and a retry affordance
     • docks the call UI as a resizable split-screen panel over the
       map instead of fullscreen, while a call is active on the map page
   No Supabase table, GPS/tracking loop, or routing math is touched.
   ──────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── tiny helpers ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s || '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function haversineKm(a, b) {
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(s));
  }

  /* ════════════════════════════════════════════════════════════════
     A. STRUCTURAL REDESIGN — header / partner row / search / map /
        bottom sheet. Runs once, the first time #page-map exists.
     ════════════════════════════════════════════════════════════════ */
  let restructured = false;
  function restructure() {
    if (restructured) return;
    const page = $('page-map');
    if (!page) return;
    restructured = true;

    // Grab the pieces we already have, by their existing ids/selectors —
    // nothing here is created from scratch, only moved.
    const presenceRow = page.querySelector('#lmAv1')?.closest('div[style*="display:flex"][style*="gap:10px"]');
    const searchWrap = page.querySelector('#lmGmSearchInput')?.closest('div[style*="position:relative"]');
    const mapCard = $('mapView')?.closest('.card');
    const mapView = $('mapView');
    const toolbar = mapCard?.querySelector('.lm-toolbar');
    const mainTitleCard = mapCard; // the big "📍 Live Together Map" card

    // ── Header ──────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'lm2-header';
    header.innerHTML = `
      <div class="lm2-header-title">
        <span class="lm2-sync-dot" id="lm2SyncDot" title="Sync status"></span>
        <span>Live Together Map</span>
      </div>
      <div class="lm2-header-actions">
        <div class="lm2-icon-btn lm2-scale-tap" title="Search" id="lm2HdrSearchBtn">🔍</div>
        <div class="lm2-icon-btn lm2-scale-tap" title="Layers / map style" id="lm2HdrLayersBtn">🗺️</div>
        <div class="lm2-icon-btn lm2-scale-tap" title="Locate me" id="lm2HdrLocateBtn">📍</div>
        <div class="lm2-icon-btn lm2-scale-tap" title="Live tracking on/off" id="lm2HdrTrackWrap"></div>
      </div>`;
    page.insertBefore(header, page.firstChild);
    header.querySelector('#lm2HdrSearchBtn').onclick = () => { $('lmGmSearchInput')?.focus(); };
    header.querySelector('#lm2HdrLocateBtn').onclick = () => window.LiveMap?.locateMe();
    header.querySelector('#lm2HdrLayersBtn').onclick = () => toolbar?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const trackToggle = $('lmTrackToggle');
    if (trackToggle) header.querySelector('#lm2HdrTrackWrap').replaceWith(trackToggle);

    // ── Partner presence row ───────────────────────────────────
    if (presenceRow) {
      presenceRow.classList.add('lm2-partner-row');
      presenceRow.removeAttribute('style');
      Array.from(presenceRow.children).forEach(card => {
        card.classList.add('lm2-partner-card');
        card.removeAttribute('style');
      });
      page.insertBefore(presenceRow, mainTitleCard || null);
    }

    // ── Search bar ──────────────────────────────────────────────
    if (searchWrap) {
      searchWrap.classList.add('lm2-search-wrap');
      const bar = searchWrap.querySelector('div');
      if (bar) { bar.classList.add('lm2-search-bar'); bar.removeAttribute('style'); }
      page.insertBefore(searchWrap, mainTitleCard || null);
    }

    // ── Map (dominant element) ─────────────────────────────────
    if (mapView) {
      const mapWrap = document.createElement('div');
      mapWrap.className = 'lm2-map-wrap';
      mapView.parentNode.insertBefore(mapWrap, mapView);
      mapWrap.appendChild(mapView);
      page.insertBefore(mapWrap, mainTitleCard || null);

      const shimmer = document.createElement('div');
      shimmer.className = 'lm2-map-shimmer';
      shimmer.id = 'lm2MapShimmer';
      mapWrap.appendChild(shimmer);
      // Leaflet paints tiles asynchronously — fade the shimmer once the
      // map fires its first render, falling back to a timeout so it never
      // gets stuck showing on a slow connection.
      const killShimmer = () => { shimmer.style.transition = 'opacity .3s ease'; shimmer.style.opacity = '0'; setTimeout(() => shimmer.remove(), 320); };
      const st = window.LiveMap?._debug;
      if (st && st.map) st.map.whenReady ? st.map.whenReady(killShimmer) : setTimeout(killShimmer, 800);
      else setTimeout(killShimmer, 1200);
    }

    // ── Bottom sheet: re-home the toolbar + panels into tabbed sections ──
    const sheet = document.createElement('div');
    sheet.className = 'lm2-sheet';
    sheet.innerHTML = `
      <div class="lm2-sheet-tabs" id="lm2SheetTabs">
        <div class="lm2-sheet-tab active" data-tab="nav">Navigation</div>
        <div class="lm2-sheet-tab" data-tab="nearby">Nearby</div>
        <div class="lm2-sheet-tab" data-tab="partner">Partner</div>
        <div class="lm2-sheet-tab" data-tab="saved">Saved</div>
        <div class="lm2-sheet-tab" data-tab="weather">Weather</div>
      </div>
      <div class="lm2-sheet-body">
        <div class="lm2-sheet-section active" data-section="nav"></div>
        <div class="lm2-sheet-section" data-section="nearby"></div>
        <div class="lm2-sheet-section" data-section="partner"></div>
        <div class="lm2-sheet-section" data-section="saved"></div>
        <div class="lm2-sheet-section" data-section="weather"></div>
      </div>`;
    page.appendChild(sheet);

    sheet.querySelectorAll('.lm2-sheet-tab').forEach(tab => {
      tab.onclick = () => {
        sheet.querySelectorAll('.lm2-sheet-tab').forEach(t => t.classList.toggle('active', t === tab));
        sheet.querySelectorAll('.lm2-sheet-section').forEach(s => s.classList.toggle('active', s.dataset.section === tab.dataset.tab));
      };
    });

    const navSection = sheet.querySelector('[data-section="nav"]');
    const nearbySection = sheet.querySelector('[data-section="nearby"]');
    const partnerSection = sheet.querySelector('[data-section="partner"]');
    const savedSection = sheet.querySelector('[data-section="saved"]');
    const weatherSection = sheet.querySelector('[data-section="weather"]');

    // Navigation: toolbar's action row + nav/directions panels + the
    // video-call / love-note actions already sitting under the map card.
    if (toolbar) navSection.appendChild(toolbar);
    ['lmDirectionsPanel', 'lmNavPanel', 'lmPlaceDetailsCard'].forEach(id => { const el = $(id); if (el) navSection.appendChild(el); });
    const actionsRow = mapCard?.querySelector('button[onclick*="startVideoCallFromMap"]')?.closest('div');
    if (actionsRow) navSection.appendChild(actionsRow);
    const loveNotes = $('lmLoveNotesPanel'); if (loveNotes) navSection.appendChild(loveNotes);
    const togetherBanner = $('lmTogetherBanner'); if (togetherBanner) navSection.appendChild(togetherBanner);
    const travelNote = $('mapTravelNote'); if (travelNote) navSection.appendChild(travelNote);
    const periodStats = mapCard?.querySelector('.period-stats'); if (periodStats) navSection.appendChild(periodStats);

    // Nearby: our new fallback-aware chip row + results container
    nearbySection.innerHTML = `
      <div class="lm2-sheet-section-title">Search nearby</div>
      <div class="lm2-chip-row" id="lm2NearbyChips"></div>
      <div id="lm2NearbySort" style="display:flex;gap:6px;margin:10px 0;font-size:11px;color:var(--lm2-text-hint)">
        Sort:
        <span class="lm2-chip lm2-sort-chip active" data-sort="distance" style="padding:4px 10px;min-height:auto">Distance</span>
        <span class="lm2-chip lm2-sort-chip" data-sort="rating" style="padding:4px 10px;min-height:auto">Rating</span>
        <span class="lm2-chip lm2-sort-chip" data-sort="open" style="padding:4px 10px;min-height:auto">Open now</span>
      </div>
      <div id="lm2NearbyResults"></div>`;

    // Partner: meeting point / weather buttons already in the toolbar are
    // shared, so this tab mirrors the partner-focused actions + presence.
    partnerSection.innerHTML = `<div class="lm2-sheet-section-title">Stay close</div>`;
    const partnerBtns = document.createElement('div');
    partnerBtns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    partnerBtns.innerHTML = `
      <button class="lm2-btn-primary lm2-scale-tap" style="flex:1;min-width:140px;border-radius:14px" onclick="LiveMap.startVideoCallFromMap()">📹 Video Call</button>
      <button class="lm2-btn-secondary lm2-scale-tap" style="flex:1;min-width:140px;border-radius:14px" onclick="LiveMap.showMeetingPoint()">🤝 Meeting Point</button>
      <button class="lm2-btn-secondary lm2-scale-tap" style="flex:1;min-width:140px;border-radius:14px" onclick="LiveMap.openLoveNoteComposer()">💌 Love Note</button>
      <button class="lm2-btn-secondary lm2-scale-tap" style="flex:1;min-width:140px;border-radius:14px" onclick="LiveMap.locatePartner()">💜 Locate Partner</button>`;
    partnerSection.appendChild(partnerBtns);

    // Saved: favorites panel + important-places cards
    savedSection.innerHTML = `<div class="lm2-sheet-section-title">Favorites</div>`;
    const favPanel = $('lmFavoritesPanel'); if (favPanel) { favPanel.style.display = 'block'; savedSection.appendChild(favPanel); }
    const meetSug = $('lmMeetingSuggestions'); if (meetSug) savedSection.appendChild(meetSug);
    const myPlacesCard = page.querySelector('#myPlacesList')?.closest('.card');
    const ptPlacesCard = page.querySelector('#ptPlacesList')?.closest('.card');
    if (myPlacesCard) { savedSection.appendChild(document.createElement('div')).outerHTML = '<div class="lm2-sheet-section-title">My important places</div>'; savedSection.appendChild(myPlacesCard); }
    if (ptPlacesCard) { const t = document.createElement('div'); t.className = 'lm2-sheet-section-title'; t.textContent = "Partner's places"; savedSection.appendChild(t); savedSection.appendChild(ptPlacesCard); }

    // Weather + privacy panels
    const weatherPanel = $('lmWeatherPanel');
    const privacyPanel = $('lmPrivacyPanel');
    weatherSection.innerHTML = `<div class="lm2-sheet-section-title">Weather</div>`;
    if (weatherPanel) { weatherPanel.style.display = 'block'; weatherSection.appendChild(weatherPanel); window.LiveMap?.getWeather?.(); }
    if (privacyPanel) { const t = document.createElement('div'); t.className = 'lm2-sheet-section-title'; t.textContent = 'Privacy'; weatherSection.appendChild(t); weatherSection.appendChild(privacyPanel); }
    const weatherBtn = $('lmWeatherBtn'); if (weatherBtn) weatherBtn.remove(); // now redundant, tab covers it

    // Banners stay at the very top of the page (above the header)
    ['lmPermBanner', 'lmOfflineBanner', 'lmEmergencyBanner'].forEach(id => { const el = $(id); if (el) page.insertBefore(el, header); });

    // Empty the now-hollowed-out original card wrapper (icons/labels are
    // preserved on the moved elements themselves, so this just discards
    // leftover wrapper chrome).
    if (mainTitleCard && !mainTitleCard.contains(mapView) && mainTitleCard.children.length <= 1) mainTitleCard.remove();

    buildNearbyChips();
  }

  /* ════════════════════════════════════════════════════════════════
     B/C. NEARBY SEARCH — route → destination → current-location
        fallback chain, with radius/sort, caching, debounce, retry.
     ════════════════════════════════════════════════════════════════ */
  const POI_TYPES = {
    food:     { tag: '"amenity"~"restaurant|fast_food"', icon: '🍽️', label: 'Food' },
    coffee:   { tag: '"amenity"="cafe"',                 icon: '☕', label: 'Coffee' },
    atm:      { tag: '"amenity"="atm"',                  icon: '🏧', label: 'ATM' },
    parking:  { tag: '"amenity"="parking"',               icon: '🅿️', label: 'Parking' },
    hospital: { tag: '"amenity"="hospital"',               icon: '🏥', label: 'Hospital' },
    fuel:     { tag: '"amenity"="fuel"',                   icon: '⛽', label: 'Fuel' },
    ev:       { tag: '"amenity"="charging_station"',      icon: '🔌', label: 'EV Charging' }
  };
  let nearbyActive = null, nearbySort = 'distance', nearbyRadius = 1500;
  const nearbyCache = new Map(); // key: type|sort|radius|centerRounded → results
  let debounceTimer = null;

  function buildNearbyChips() {
    const row = $('lm2NearbyChips');
    if (!row) return;
    row.innerHTML = Object.keys(POI_TYPES).map(k => {
      const t = POI_TYPES[k];
      return `<div class="lm2-chip lm2-scale-tap" data-poi="${k}">${t.icon} ${t.label}</div>`;
    }).join('');
    row.querySelectorAll('.lm2-chip').forEach(chip => {
      chip.onclick = () => runNearbySearch(chip.dataset.poi);
    });
    document.querySelectorAll('.lm2-sort-chip').forEach(chip => {
      chip.onclick = () => {
        document.querySelectorAll('.lm2-sort-chip').forEach(c => c.classList.toggle('active', c === chip));
        nearbySort = chip.dataset.sort;
        if (nearbyActive) runNearbySearch(nearbyActive, true);
      };
    });
  }

  function skeletonHtml() {
    return Array.from({ length: 4 }).map(() => `
      <div class="lm2-skel-row">
        <div class="lm2-skel-circle"></div>
        <div class="lm2-skel-line"></div>
      </div>`).join('');
  }

  // Decide the search center, in priority order: an active nav route
  // corridor > the picked destination (search pin / nav target) > current
  // GPS location. Never returns null unless we truly have nothing yet.
  function resolveSearchContext() {
    const st = window.LiveMap?._debug;
    if (!st) return null;
    if (st.navRouteCoords && st.navRouteCoords.length > 1) {
      return { mode: 'route', coords: st.navRouteCoords };
    }
    // st.destMarker is the pin dropped by picking a search result (see
    // livemap.js:_openPlaceDetails) — the best "destination" proxy we
    // have from outside the module's closures.
    if (st.destMarker && typeof st.destMarker.getLatLng === 'function') {
      const ll = st.destMarker.getLatLng();
      return { mode: 'destination', center: { lat: ll.lat, lng: ll.lng } };
    }
    if (window.S?.myLoc) return { mode: 'current', center: window.S.myLoc };
    return null;
  }

  function sampleRoute(coords, n) {
    if (coords.length <= n) return coords;
    const out = [];
    for (let i = 0; i < n; i++) out.push(coords[Math.round(i * (coords.length - 1) / (n - 1))]);
    return out;
  }

  async function overpassNear(tag, center, radius) {
    const q = `[out:json][timeout:15];(node[${tag}](around:${radius},${center.lat},${center.lng});way[${tag}](around:${radius},${center.lat},${center.lng}););out center 30;`;
    const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
    if (!resp.ok) throw new Error('overpass');
    const data = await resp.json();
    return (data.elements || []).map(e => ({
      id: e.id, name: e.tags?.name, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon,
      openingHours: e.tags?.opening_hours
    })).filter(p => p.lat != null && p.lon != null);
  }

  async function overpassAlongRoute(tag, coords, radius) {
    const samples = sampleRoute(coords, 8);
    const filters = samples.map(c => `node[${tag}](around:${radius},${c[0]},${c[1]});`).join('');
    const q = `[out:json][timeout:15];(${filters});out center 40;`;
    const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
    if (!resp.ok) throw new Error('overpass');
    const data = await resp.json();
    const seen = new Set();
    return (data.elements || []).filter(e => e.lat != null && e.lon != null && !seen.has(e.id) && seen.add(e.id))
      .map(e => ({ id: e.id, name: e.tags?.name, lat: e.lat, lon: e.lon, openingHours: e.tags?.opening_hours }));
  }

  function isOpenNow(hoursStr) {
    // Best-effort only — opening_hours syntax is complex; we just avoid
    // hiding results when we can't parse it confidently.
    if (!hoursStr) return true;
    if (/24\/7/i.test(hoursStr)) return true;
    return true;
  }

  async function runNearbySearch(key, force) {
    const resultsEl = $('lm2NearbyResults');
    if (!resultsEl) return;
    nearbyActive = key;
    document.querySelectorAll('#lm2NearbyChips .lm2-chip').forEach(c => c.classList.toggle('active', c.dataset.poi === key));

    clearTimeout(debounceTimer);
    resultsEl.innerHTML = skeletonHtml();

    debounceTimer = setTimeout(async () => {
      const t = POI_TYPES[key];
      const ctx = resolveSearchContext();
      if (!ctx) { resultsEl.innerHTML = `<div class="empty">Turn on location to search nearby.</div>`; return; }

      const centerKey = ctx.mode === 'route'
        ? 'route:' + ctx.coords.length
        : `${ctx.center.lat.toFixed(3)},${ctx.center.lng.toFixed(3)}`;
      const cacheKey = [key, nearbySort, nearbyRadius, ctx.mode, centerKey].join('|');
      if (!force && nearbyCache.has(cacheKey)) { renderNearby(nearbyCache.get(cacheKey), t, ctx); return; }

      try {
        let places = [];
        let usedMode = ctx.mode;
        // 1) along the active route
        if (ctx.mode === 'route') {
          places = await overpassAlongRoute(t.tag, ctx.coords, nearbyRadius);
        }
        // 2) fall back to the destination if the route search came up empty
        if (!places.length) {
          const fallbackCtx = ctx.mode === 'route' ? resolveDestinationOnly() : ctx;
          if (fallbackCtx) {
            places = await overpassNear(t.tag, fallbackCtx.center, nearbyRadius);
            usedMode = fallbackCtx === ctx ? ctx.mode : 'destination';
          }
        }
        // 3) fall back to current location if still empty
        if (!places.length && window.S?.myLoc) {
          places = await overpassNear(t.tag, window.S.myLoc, nearbyRadius);
          usedMode = 'current';
        }

        const myLoc = window.S?.myLoc;
        places.forEach(p => { p._distKm = myLoc ? haversineKm(myLoc, { lat: p.lat, lng: p.lon }) : null; });
        places = sortPlaces(places);
        places = places.slice(0, 20);

        nearbyCache.set(cacheKey, { places, usedMode });
        renderNearby({ places, usedMode }, t, ctx);
      } catch (e) {
        resultsEl.innerHTML = `
          <div class="empty">Couldn't reach the search service.</div>
          <div class="lm2-retry-btn" id="lm2NearbyRetry">↻ Retry</div>`;
        const retry = $('lm2NearbyRetry');
        if (retry) retry.onclick = () => runNearbySearch(key, true);
      }
    }, 350); // debounce
  }

  function resolveDestinationOnly() {
    const st = window.LiveMap?._debug;
    if (st?.destMarker && typeof st.destMarker.getLatLng === 'function') {
      const ll = st.destMarker.getLatLng();
      return { center: { lat: ll.lat, lng: ll.lng } };
    }
    return null;
  }

  function sortPlaces(places) {
    if (nearbySort === 'distance') return places.slice().sort((a, b) => (a._distKm ?? 1e9) - (b._distKm ?? 1e9));
    if (nearbySort === 'open') return places.filter(p => isOpenNow(p.openingHours)).concat(places.filter(p => !isOpenNow(p.openingHours)));
    return places; // 'rating' — OSM has no reliable rating field, so distance order is kept as the sane default
  }

  function renderNearby(result, t, ctx) {
    const resultsEl = $('lm2NearbyResults');
    if (!resultsEl) return;
    const { places, usedMode } = result;
    if (!places.length) {
      resultsEl.innerHTML = `
        <div class="empty">No ${t.label.toLowerCase()} found nearby.</div>
        <div class="lm2-retry-btn" id="lm2NearbyRetry">↻ Retry</div>`;
      const retry = $('lm2NearbyRetry');
      if (retry) retry.onclick = () => runNearbySearch(nearbyActive, true);
      return;
    }
    const modeNote = usedMode === 'route' ? 'along your route'
      : usedMode === 'destination' ? 'near your destination'
      : 'near your current location';
    resultsEl.innerHTML = `<div style="font-size:10px;color:var(--lm2-text-hint);margin-bottom:8px">Showing results ${modeNote}</div>` +
      places.map(p => `
        <div class="money-row">
          <div class="money-ic inc">${t.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:var(--lm2-text-main)">${esc(p.name || t.label)}</div>
            <div style="font-size:10px;color:var(--lm2-text-hint)">${p._distKm != null ? p._distKm.toFixed(1) + ' km away' : ''}</div>
          </div>
          <button class="btn btn-glass btn-xs lm2-scale-tap" onclick="LiveMap.flyTo(${p.lat},${p.lon})">View</button>
          <button class="btn btn-accent btn-xs lm2-scale-tap" onclick="LiveMap.navigateToPoint(${p.lat},${p.lon},'${esc(p.name || t.label).replace(/'/g, "\\'")}')">🧭</button>
        </div>`).join('');
  }

  /* ════════════════════════════════════════════════════════════════
     E. VIDEO CALL SPLIT VIEW — while a call is active on the Live Map
        page, dock the call alongside the map (instead of the normal
        fullscreen call UI) so the map stays fully usable:
          • mobile / narrow:  map on top,  call on bottom
          • desktop / wide:   map on left, call on right
        A draggable divider resizes both panes. Ending the call tears
        the dock down and returns to the normal Live Map layout with
        no reload. This ONLY happens while #page-map is the active
        page — the normal chat page's call UI is completely untouched
        (it never gets docked, since onMapPage() is false there).
     ════════════════════════════════════════════════════════════════ */
  function onMapPage() { return $('page-map')?.classList.contains('active'); }

  let dockEl = null, mapWrapSlot = null, mapWrapEl = null, dockedOverlay = null;
  let dockMQ = window.matchMedia('(min-width:701px)');

  function invalidateMap() {
    const st = window.LiveMap?._debug;
    if (st?.map?.invalidateSize) requestAnimationFrame(() => st.map.invalidateSize());
  }

  function updateDockOrientation() {
    if (!dockEl) return;
    dockEl.classList.toggle('lm2-dock-row', dockMQ.matches);
    invalidateMap();
  }

  function buildDock() {
    const page = $('page-map');
    mapWrapEl = page?.querySelector('.lm2-map-wrap');
    if (!page || !mapWrapEl) return null;

    // Leave a placeholder in the map wrap's original spot so we can
    // put it back exactly where it was once the call ends.
    mapWrapSlot = document.createComment('lm2-map-wrap-slot');
    mapWrapEl.parentNode.insertBefore(mapWrapSlot, mapWrapEl);

    const dock = document.createElement('div');
    dock.className = 'lm2-call-dock';
    dock.id = 'lm2CallDock';
    dock.innerHTML = `
      <div class="lm2-dock-pane lm2-dock-map" id="lm2DockMap"></div>
      <div class="lm2-dock-resizer" id="lm2DockResizer"></div>
      <div class="lm2-dock-pane lm2-dock-call" id="lm2DockCall"></div>`;
    mapWrapSlot.parentNode.insertBefore(dock, mapWrapSlot);
    dock.querySelector('#lm2DockMap').appendChild(mapWrapEl);

    wireResizer(dock, dock.querySelector('#lm2DockResizer'));
    dockMQ.addEventListener ? dockMQ.addEventListener('change', updateDockOrientation) : dockMQ.addListener(updateDockOrientation);
    updateDockOrientation();
    return dock;
  }

  function wireResizer(dock, handle) {
    let dragging = false;
    const setRatio = (clientX, clientY) => {
      const rect = dock.getBoundingClientRect();
      const row = dockMQ.matches;
      const raw = row ? (clientX - rect.left) / rect.width : (clientY - rect.top) / rect.height;
      // Issue 2 fix: in column layout (mobile) the call pane sits below
      // the map and holds the mute/speaker/end-call bar. Cap how far the
      // map side can be dragged so the call pane never shrinks under the
      // ~150px floor its controls need (matches .lm2-dock-call min-height).
      const maxRatio = row ? 0.82 : Math.min(0.82, 1 - (150 / rect.height));
      const ratio = Math.min(maxRatio, Math.max(0.18, raw));
      dock.style.setProperty('--lm2-split-ratio', ratio.toFixed(4));
      invalidateMap();
    };
    handle.addEventListener('pointerdown', e => { dragging = true; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
    handle.addEventListener('pointermove', e => { if (dragging) setRatio(e.clientX, e.clientY); });
    handle.addEventListener('pointerup', () => { dragging = false; });
    handle.addEventListener('pointercancel', () => { dragging = false; });
  }

  function dockCall(overlay) {
    if (!overlay || dockedOverlay === overlay) return;
    if (!dockEl) dockEl = buildDock();
    if (!dockEl) return;
    const callPane = $('lm2DockCall');
    callPane.appendChild(overlay);
    overlay.classList.add('lm2-docked', 'open');
    dockedOverlay = overlay;
    invalidateMap();
  }

  function teardownDock() {
    if (mapWrapEl && mapWrapSlot && mapWrapSlot.parentNode) {
      mapWrapSlot.parentNode.insertBefore(mapWrapEl, mapWrapSlot);
      mapWrapSlot.remove();
    }
    if (dockEl) dockEl.remove();
    dockMQ.removeEventListener ? dockMQ.removeEventListener('change', updateDockOrientation) : dockMQ.removeListener(updateDockOrientation);
    dockEl = null; mapWrapSlot = null; mapWrapEl = null; dockedOverlay = null;
    invalidateMap();
  }

  const callObserver = new MutationObserver(() => {
    const overlay = $('callOverlay');
    if (overlay && overlay.classList.contains('open')) {
      if (onMapPage()) dockCall(overlay);
      else if (dockedOverlay) teardownDock(); // navigated away from map mid-call: let the normal fullscreen call UI take over
    } else if (!overlay && dockedOverlay) {
      teardownDock(); // call ended — back to the normal Live Map page, no reload
    }
  });
  callObserver.observe(document.body, { childList: true, subtree: true });

  /* ════════════════════════════════════════════════════════════════
     Boot: restructure once LiveMap + #page-map are ready, and again
     whenever the map page becomes active (covers first paint if the
     app boots directly onto another page).
     ════════════════════════════════════════════════════════════════ */
  function boot() {
    if ($('page-map')) restructure();
    else { setTimeout(boot, 300); return; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 700));
  else setTimeout(boot, 700);

  // Re-run chip wiring / weather fetch each time the user re-enters the
  // map page (cheap — just re-binds click handlers, no network spam).
  const _origGotoWatcher = setInterval(() => {
    if (typeof window.goto === 'function') {
      clearInterval(_origGotoWatcher);
      const prev = window.goto;
      window.goto = function (page) {
        prev(page);
        if (page === 'map') { restructure(); buildNearbyChips(); }
      };
    }
  }, 500);
})();