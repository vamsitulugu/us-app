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
        <div class="lm2-icon-btn lm2-scale-tap" title="Follow me — camera stays centered on your live position" id="lm2HdrFollowBtn">🧭</div>
        <div class="lm2-icon-btn lm2-scale-tap" title="Locate me" id="lm2HdrLocateBtn">📍</div>
        <div class="lm2-icon-btn lm2-scale-tap" title="Live tracking on/off" id="lm2HdrTrackWrap"></div>
      </div>`;
    page.insertBefore(header, page.firstChild);
    header.querySelector('#lm2HdrSearchBtn').onclick = () => { $('lmGmSearchInput')?.focus(); };
    header.querySelector('#lm2HdrLocateBtn').onclick = () => window.LiveMap?.locateMe();
    header.querySelector('#lm2HdrLayersBtn').onclick = () => toolbar?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    wireFollowButton(header.querySelector('#lm2HdrFollowBtn'));
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

    // ── Bottom sheet: only Partner / Saved / Weather need a dedicated tab
    // now — the toolbar, Start button, Directions/Nav panels and place
    // details card all stay exactly where they already are in the markup:
    // directly after the map, inside mainTitleCard. Nothing here relocates
    // them anymore, which is what keeps them "right after the map" instead
    // of scrolled far down the page.
    const sheet = document.createElement('div');
    sheet.className = 'lm2-sheet';
    sheet.innerHTML = `
      <div class="lm2-sheet-tabs" id="lm2SheetTabs">
        <div class="lm2-sheet-tab active" data-tab="partner">Partner</div>
        <div class="lm2-sheet-tab" data-tab="saved">Saved</div>
        <div class="lm2-sheet-tab" data-tab="weather">Weather</div>
      </div>
      <div class="lm2-sheet-body">
        <div class="lm2-sheet-section active" data-section="partner"></div>
        <div class="lm2-sheet-section" data-section="saved"></div>
        <div class="lm2-sheet-section" data-section="weather"></div>
      </div>`;
    page.appendChild(sheet);

    // Tabs no longer hide/show sections — every section stays visible and
    // part of the single page scroll. Tapping a tab just jumps to (and
    // highlights) that section, like an in-page anchor link.
    sheet.querySelectorAll('.lm2-sheet-tab').forEach(tab => {
      tab.onclick = () => {
        sheet.querySelectorAll('.lm2-sheet-tab').forEach(t => t.classList.toggle('active', t === tab));
        const target = sheet.querySelector(`.lm2-sheet-section[data-section="${tab.dataset.tab}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });

    const partnerSection = sheet.querySelector('[data-section="partner"]');
    const savedSection = sheet.querySelector('[data-section="saved"]');
    const weatherSection = sheet.querySelector('[data-section="weather"]');

    // Partner: presence/status only — the actual actions (Video Call,
    // Meeting Point, Love Note, Locate Partner) already live right above,
    // directly under the map — repeating them here was pure visual
    // duplication, not a second feature.
    partnerSection.innerHTML = `<div class="lm2-sheet-section-title">Stay close</div>
      <div style="font-size:11px;color:var(--lm2-text-hint);margin-bottom:8px">Quick actions are right above, under the map ⬆️</div>`;

    // Saved: favorites panel + important-places cards
    savedSection.innerHTML = `<div class="lm2-sheet-section-title">Favorites</div>`;
    const favPanel = $('lmFavoritesPanel'); if (favPanel) { favPanel.style.display = 'block'; savedSection.appendChild(favPanel); }
    const meetSug = $('lmMeetingSuggestions'); if (meetSug) savedSection.appendChild(meetSug);
    const myPlacesCard = page.querySelector('#myPlacesList')?.closest('.card');
    const ptPlacesCard = page.querySelector('#ptPlacesList')?.closest('.card');
    if (myPlacesCard) { savedSection.appendChild(document.createElement('div')).outerHTML = '<div class="lm2-sheet-section-title">My important places</div>'; savedSection.appendChild(myPlacesCard); }
    if (ptPlacesCard) { const t = document.createElement('div'); t.className = 'lm2-sheet-section-title'; t.textContent = "Partner's places"; savedSection.appendChild(t); savedSection.appendChild(ptPlacesCard); }

    // Weather panel
    const weatherPanel = $('lmWeatherPanel');
    weatherSection.innerHTML = `<div class="lm2-sheet-section-title">Weather</div>`;
    if (weatherPanel) { weatherPanel.style.display = 'block'; weatherSection.appendChild(weatherPanel); window.LiveMap?.getWeather?.(); }

    // Banners stay at the very top of the page (above the header)
    ['lmPermBanner', 'lmOfflineBanner', 'lmEmergencyBanner'].forEach(id => { const el = $(id); if (el) page.insertBefore(el, header); });

    // mainTitleCard keeps the Start button / toolbar / privacy / directions
    // & nav panels / place details card / video-call+love-note row / period
    // stats exactly as they already are in the markup, right after the map —
    // nothing here empties it out, so don't remove it.
  }

  /* Close the floating search-results dropdown when the user taps
     anywhere outside it or the search input. Selecting a result or
     clearing the search already close it (handled in livemap.js); this
     only adds the "tap outside" case, without touching any search/GPS
     logic. */
  document.addEventListener('click', (e) => {
    const results = $('lmGmSearchResults');
    const input = $('lmGmSearchInput');
    if (!results || !results.classList.contains('show')) return;
    if (results.contains(e.target) || input?.contains(e.target)) return;
    results.classList.remove('show');
  }, true);

  /* ════════════════════════════════════════════════════════════════
     F. AUTO-FOLLOW CAMERA — keeps the map centered on the user's live
        position as it updates, with smooth panning (not a hard jump).
        Purely additive: reads S.myLoc / st.map that livemap.js already
        maintains, never writes tracking state. Disengages the moment
        the user manually drags/zooms the map, like every real nav app.
     ════════════════════════════════════════════════════════════════ */
  let followOn = false, followTimer = null, followUserInteracted = false;

  function wireFollowButton(btn) {
    if (!btn) return;
    btn.onclick = () => {
      followOn = !followOn;
      btn.classList.toggle('active', followOn);
      btn.style.background = followOn ? 'linear-gradient(135deg,#ff2020,#b60000)' : '';
      if (followOn) { followUserInteracted = false; startFollowLoop(); }
      else stopFollowLoop();
    };
  }

  function startFollowLoop() {
    stopFollowLoop();
    const st = window.LiveMap?._debug;
    if (st?.map) {
      // Any manual pan/zoom while following is on disengages it — same
      // behavior as Google Maps / Uber's "recenter" arrow.
      st.map.on('dragstart', onFollowInterrupt);
      st.map.on('zoomstart', onFollowInterrupt);
      // 3D upgrade: tilt into a chase-cam angle while following, like
      // Google Maps/Uber navigation mode. No-op on plain Leaflet.
      if (typeof st.map.set3D === 'function') st.map.set3D(true);
    }
    followTimer = setInterval(() => {
      if (!followOn || followUserInteracted) return;
      const st2 = window.LiveMap?._debug;
      const loc = window.S?.myLoc;
      if (!st2?.map || !loc || loc.lat == null) return;
      st2.map.panTo([loc.lat, loc.lng], { animate: true, duration: 0.8, easeLinearity: 0.4 });
    }, 1500);
  }

  function onFollowInterrupt() {
    if (!followOn) return;
    followUserInteracted = true;
    const btn = $('lm2HdrFollowBtn');
    if (btn) { followOn = false; btn.classList.remove('active'); btn.style.background = ''; }
    stopFollowLoop();
  }

  function stopFollowLoop() {
    if (followTimer) { clearInterval(followTimer); followTimer = null; }
    const st = window.LiveMap?._debug;
    if (st?.map) {
      st.map.off('dragstart', onFollowInterrupt);
      st.map.off('zoomstart', onFollowInterrupt);
      if (typeof st.map.set3D === 'function') st.map.set3D(false);
    }
  }


  const POI_TYPES = {
    food:     { tag: '"amenity"~"restaurant|fast_food"', icon: '🍽️', label: 'Food' },
    coffee:   { tag: '"amenity"="cafe"',                 icon: '☕', label: 'Coffee' },
    atm:      { tag: '"amenity"="atm"',                  icon: '🏧', label: 'ATM' },
    bank:     { tag: '"amenity"="bank"',                  icon: '🏦', label: 'Bank' },
    parking:  { tag: '"amenity"="parking"',               icon: '🅿️', label: 'Parking' },
    hospital: { tag: '"amenity"="hospital"',               icon: '🏥', label: 'Hospital' },
    pharmacy: { tag: '"amenity"="pharmacy"',               icon: '💊', label: 'Pharmacy' },
    fuel:     { tag: '"amenity"="fuel"',                   icon: '⛽', label: 'Fuel' },
    hotel:    { tag: '"tourism"~"hotel|guest_house"',     icon: '🏨', label: 'Hotels' },
    shopping: { tag: '"shop"~"mall|supermarket"',          icon: '🛍️', label: 'Shopping' },
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
      if (chip.dataset.sort === 'rating') {
        // OSM/Overpass has no ratings field — showing this as a working
        // sort would be faking data. Disable it honestly instead, with
        // a tooltip explaining why, rather than silently doing nothing.
        chip.style.opacity = '0.4';
        chip.style.cursor = 'not-allowed';
        chip.title = 'Ratings aren\'t available from free map data — tap "View on Google Maps" on any result for real ratings/reviews';
        chip.onclick = (e) => e.preventDefault();
        return;
      }
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

  // FIX (Phase 3): these two used to POST straight to a single hardcoded
  // 'overpass-api.de' endpoint with no timeout and no fallback — that
  // exact server has been overloaded/shedding load, so any nearby search
  // would just hang or fail outright when it was slow/down. They now go
  // through window.OverpassService, which already races 7 independent
  // mirrors + a backend proxy + an offline cache (see overpass-service.js).
  // Same input/output shape as before, so nothing downstream changes.
  async function overpassNear(tag, center, radius) {
    if (!window.OverpassService) throw new Error('search engine not loaded');
    const query = `[out:json][timeout:20];(node[${tag}](around:${radius},${center.lat},${center.lng});way[${tag}](around:${radius},${center.lat},${center.lng}));out center 30;`;
    const data = await window.OverpassService.runQuery(query);
    return (data.elements || []).map(e => ({
      id: e.id, name: e.tags?.name, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon,
      openingHours: e.tags?.opening_hours
    })).filter(p => p.lat != null && p.lon != null);
  }

  async function overpassAlongRoute(tag, coords, radius) {
    if (!window.OverpassService) throw new Error('search engine not loaded');
    const samples = sampleRoute(coords, 8);
    const filters = samples.map(c => `node[${tag}](around:${radius},${c[0]},${c[1]});`).join('');
    const query = `[out:json][timeout:20];(${filters});out center 40;`;
    const data = await window.OverpassService.runQuery(query);
    const seen = new Set();
    return (data.elements || []).filter(e => e.lat != null && e.lon != null && !seen.has(e.id) && seen.add(e.id))
      .map(e => ({ id: e.id, name: e.tags?.name, lat: e.lat, lon: e.lon, openingHours: e.tags?.opening_hours }));
  }

  // Real best-effort parser for OSM's opening_hours syntax (covers the
  // vast majority of real-world tags: "Mo-Fr 09:00-18:00; Sa 10:00-14:00",
  // "24/7", "Mo-Su 08:00-22:00", overnight spans like "18:00-02:00").
  // Returns true (assume open) when the tag is missing or genuinely too
  // exotic to parse — we never hide a place just because we couldn't
  // read its hours.
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  function isOpenNow(hoursStr) {
    if (!hoursStr) return null; // unknown — caller shows no badge
    if (/24\/7/i.test(hoursStr)) return true;
    try {
      const now = new Date();
      const todayCode = DOW[now.getDay()];
      const minutesNow = now.getHours() * 60 + now.getMinutes();
      const rules = hoursStr.split(';').map(r => r.trim()).filter(Boolean);
      let matched = false, open = false;
      for (const rule of rules) {
        if (/off|closed/i.test(rule)) continue;
        const m = rule.match(/^((?:[A-Za-z]{2}(?:-[A-Za-z]{2})?,?\s*)+)\s+(.+)$/);
        if (!m) continue;
        const dayPart = m[1].trim(), timePart = m[2].trim();
        const dayCodes = new Set();
        dayPart.split(',').forEach(seg => {
          seg = seg.trim();
          const range = seg.match(/^([A-Za-z]{2})-([A-Za-z]{2})$/);
          if (range) {
            let i = DOW.indexOf(range[1]), end = DOW.indexOf(range[2]);
            if (i === -1 || end === -1) return;
            while (true) { dayCodes.add(DOW[i]); if (i === end) break; i = (i + 1) % 7; }
          } else if (DOW.includes(seg)) dayCodes.add(seg);
        });
        if (!dayCodes.has(todayCode)) continue;
        matched = true;
        timePart.split(',').forEach(span => {
          const t = span.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
          if (!t) return;
          const start = (+t[1]) * 60 + (+t[2]);
          let end = (+t[3]) * 60 + (+t[4]);
          if (end <= start) end += 24 * 60; // overnight span (e.g. 18:00-02:00)
          if (minutesNow >= start && minutesNow <= end) open = true;
        });
      }
      return matched ? open : null; // today not mentioned at all — unknown, not closed
    } catch (e) {
      return null;
    }
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
      let ctx = resolveSearchContext();
      if (!ctx) {
        // Background tracker just hasn't produced a fix yet (or the
        // person opened Nearby before location permission settled) —
        // ask the browser for a one-off fix right now instead of just
        // giving up and blaming "location is off".
        ctx = await new Promise((resolve) => {
          if (!navigator.geolocation) return resolve(null);
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              if (window.S) window.S.myLoc = window.S.myLoc || fix;
              resolve({ mode: 'current', center: fix });
            },
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
          );
        });
      }
      if (!ctx) { resultsEl.innerHTML = `<div class="empty">Couldn't get your location — check the browser's location permission for this site.</div>`; return; }

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
    if (nearbySort === 'open') {
      const open = places.filter(p => isOpenNow(p.openingHours) === true);
      const unknown = places.filter(p => isOpenNow(p.openingHours) === null);
      const closed = places.filter(p => isOpenNow(p.openingHours) === false);
      return open.concat(unknown, closed);
    }
    return places; // 'rating' — OSM has no reliable rating field; chip is disabled in the UI (see buildNearbyChips)
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
      places.map(p => {
        const openState = isOpenNow(p.openingHours); // true / false / null(unknown)
        const badge = openState === true ? `<span style="color:#3ddc84;font-weight:700">● Open</span>`
          : openState === false ? `<span style="color:#f87171;font-weight:700">● Closed</span>`
          : '';
        // No $0 source has real ratings for a place — rather than fake a
        // number, link straight to Google Maps' own listing (no API key
        // needed, just a query deep-link) so the user can see real
        // ratings/reviews there if they want them.
        const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name || t.label)}&query_place_id=&center=${p.lat},${p.lon}`;
        return `
        <div class="money-row">
          <div class="money-ic inc">${t.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:var(--lm2-text-main)">${esc(p.name || t.label)}</div>
            <div style="font-size:10px;color:var(--lm2-text-hint);display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${p._distKm != null ? p._distKm.toFixed(1) + ' km away' : ''}${badge ? ' · ' + badge : ''}
              · <a href="${gmapsUrl}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none" onclick="event.stopPropagation()">★ View on Google Maps ↗</a>
            </div>
          </div>
          <button class="btn btn-glass btn-xs lm2-scale-tap" onclick="LiveMap.flyTo(${p.lat},${p.lon})">View</button>
          <button class="btn btn-accent btn-xs lm2-scale-tap" onclick="LiveMap.navigateToPoint(${p.lat},${p.lon},'${esc(p.name || t.label).replace(/'/g, "\\'")}')">🧭</button>
        </div>`;
      }).join('');
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
        if (page === 'map') { restructure(); }
      };
    }
  }, 500);
})();