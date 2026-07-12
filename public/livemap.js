/* ══════════════════════════════════════════════════════════════
   LIVE MAP MODULE — us-app
   Load AFTER your main index.html script (and after index_patch.js
   if you use it). Requires: Leaflet (already loaded), global `S`,
   `api()`, `toast()`, `esc()`, `scheduleSave()`, `goto()` from the
   main app.

   <script src="/livemap.js"></script>
   ══════════════════════════════════════════════════════════════ */
'use strict';

const LiveMap = (() => {

  const PING_MIN_INTERVAL_MS = 8000;   // never ping more than once per 8s
  const PING_MIN_DISTANCE_M  = 15;     // or unless moved >15m
  const POLL_INTERVAL_MS     = 8000;   // partner-location poll cadence
  const ONLINE_WINDOW_MS     = 60000;

  const CATS = {
    Home:       { ico: '🏠' },
    College:    { ico: '🎓' },
    Office:     { ico: '🏢' },
    Hostel:     { ico: '🏨' },
    Cafe:       { ico: '☕' },
    Restaurant: { ico: '🍽️' },
    Gym:        { ico: '💪' },
    Custom:     { ico: '📍' },
    Other:      { ico: '📍' } // legacy label from v1 places
  };

  const st = {
    map: null,
    myMarker: null, ptMarker: null,
    myAnimTarget: null, ptAnimTarget: null,
    myAnimFrom: null, ptAnimFrom: null,
    myAnimStart: 0, ptAnimStart: 0,
    placeMarkers: [],
    searchResults: [],
    watchId: null,
    tracking: true,
    lastPingAt: 0,
    lastPingPos: null,
    pollTimer: null,
    pageActive: false,
    myLast: null, ptLast: null,
    permState: 'unknown', // unknown | granted | denied | unsupported
    // Phase 2
    tileLayer: null, mapStyle: 'street', // street | dark | satellite
    routeLine: null, routeStopMarkers: [], routeDates: [], routeSelectedDate: null, routeData: null,
    playbackTimer: null, playbackIdx: 0, playbackMarker: null,
    geofenceState: {}, // placeId -> 'inside' | 'outside'
    meetingMarker: null,
  };

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function _localDateStr(d) { d = d || new Date(); const tz = d.getTimezoneOffset() * 60000; return new Date(d - tz).toISOString().slice(0, 10); }
  function haversine(a, b) {
    if (!a || !b) return null;
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function fmtAgo(ts) {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  /* ── PLACES MODEL ──────────────────────────────────────────
     S.placesList = [{ id, owner:'user1'|'user2', cat, name, lat, lng, address, ts }]
     Migrates legacy S.places (object keyed by label: Home/College/Office/Other)
     into the new array on first load. */
  function migrateLegacyPlaces() {
    if (!Array.isArray(S.placesList)) S.placesList = [];
    if (S.places && typeof S.places === 'object') {
      Object.values(S.places).forEach(p => {
        if (!p || p.lat == null) return;
        const already = S.placesList.some(x => x.lat === p.lat && x.lng === p.lng && x.owner === (p.by || S.role));
        if (!already) {
          S.placesList.push({
            id: 'legacy_' + Math.random().toString(36).slice(2),
            owner: p.by || S.role,
            cat: CATS[p.label] ? p.label : 'Custom',
            name: p.name || p.label || 'Place',
            lat: p.lat, lng: p.lng, address: '', ts: Date.now()
          });
        }
      });
    }
  }

  /* ── PERMISSION / TRACKING LIFECYCLE ─────────────────────── */
  function startTracking() {
    if (!navigator.geolocation) {
      st.permState = 'unsupported';
      _showPermBanner('📍 Your browser/device doesn\'t support GPS location. You can still add places manually.');
      return;
    }
    if (st.watchId != null) return; // already tracking
    st._highAccuracyFailed = false;
    st.watchId = navigator.geolocation.watchPosition(_onPosition, _onPosErrorWithFallback, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000
    });
    st.tracking = true;
    _syncTrackToggle();
  }

  // If high-accuracy GPS repeatedly fails (common indoors/older devices), fall
  // back once to a relaxed watch (network/coarse location) so we still get a
  // rough fix instead of leaving the user stuck on "Locating…" forever.
  function _onPosErrorWithFallback(err) {
    if (!st._highAccuracyFailed && (err.code === 2 || err.code === 3)) {
      st._highAccuracyFailed = true;
      if (st.watchId != null) { navigator.geolocation.clearWatch(st.watchId); st.watchId = null; }
      st.watchId = navigator.geolocation.watchPosition(_onPosition, _onPosError, {
        enableHighAccuracy: false, maximumAge: 20000, timeout: 20000
      });
      _showPermBanner('⚠️ High-accuracy GPS unavailable — using network location instead (less precise).');
      return;
    }
    _onPosError(err);
  }

  function stopTracking(explicit) {
    if (st.watchId != null) { navigator.geolocation.clearWatch(st.watchId); st.watchId = null; }
    st.tracking = false;
    _syncTrackToggle();
    if (explicit && S.coupleId) {
      api('POST', '/api/location/stop', { coupleId: S.coupleId, role: S.role }).catch(() => {});
    }
  }

  function toggleTracking() {
    if (st.tracking) { stopTracking(true); toast('Live tracking paused'); }
    else { startTracking(); toast('Live tracking resumed 📡'); }
  }

  function _syncTrackToggle() {
    const t = document.getElementById('lmTrackToggle');
    if (t) t.classList.toggle('on', st.tracking);
  }

  function _onPosError(err) {
    st.permState = err.code === 1 ? 'denied' : 'error';
    if (err.code === 1) {
      _showPermBanner('🚫 Location permission denied. Enable location access in your browser/device settings to share your live position, or add places manually below.');
    } else {
      _showPermBanner('⚠️ Couldn\'t get your location right now (' + (err.message || 'GPS error') + '). Retrying automatically…');
    }
    _updateMyStatusUI();
  }

  const MAX_ACCEPTABLE_ACCURACY_M = 100;   // reject fixes worse than this (cell/wifi-only)
  const MAX_PLAUSIBLE_SPEED_MPS   = 60;    // ~216 km/h — beyond this, treat as GPS glitch, not a real jump
  const SMOOTH_ALPHA              = 0.35;  // EMA smoothing factor (lower = smoother, higher = snappier)

  function _onPosition(pos) {
    st.permState = 'granted';
    _hidePermBanner();
    const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
    const now = Date.now();

    // ── Accuracy gate: reject low-quality fixes (cell/wifi triangulation) ──
    // unless it's our very first fix ever (better a rough dot than no dot).
    if (accuracy != null && accuracy > MAX_ACCEPTABLE_ACCURACY_M && S.myLoc) {
      console.warn('LiveMap: rejecting low-accuracy fix (' + Math.round(accuracy) + 'm)');
      return;
    }

    // ── Outlier gate: reject physically implausible jumps ──
    if (S.myLoc && S.myLoc.ts) {
      const dtSec = Math.max(0.5, (now - S.myLoc.ts) / 1000);
      const jumpKm = haversine(S.myLoc, { lat, lng });
      const impliedSpeed = (jumpKm * 1000) / dtSec; // m/s
      if (impliedSpeed > MAX_PLAUSIBLE_SPEED_MPS) {
        console.warn('LiveMap: rejecting implausible jump (' + Math.round(impliedSpeed) + ' m/s)');
        return;
      }
    }

    // ── Smoothing: exponential moving average blends new fix with last known ──
    // point, so stationary jitter doesn't visibly wander. Skipped for the first fix
    // and for large accuracy-confirmed real moves (don't smooth away real travel).
    let outLat = lat, outLng = lng;
    if (S.myLoc && accuracy != null && accuracy < 30) {
      const rawJumpM = haversine(S.myLoc, { lat, lng }) * 1000;
      if (rawJumpM < 25) { // only smooth small jitter, not genuine movement
        outLat = S.myLoc.lat + (lat - S.myLoc.lat) * SMOOTH_ALPHA;
        outLng = S.myLoc.lng + (lng - S.myLoc.lng) * SMOOTH_ALPHA;
      }
    }

    S.myLoc = { lat: outLat, lng: outLng, ts: now, moving: (speed || 0) > 1, accuracy, heading };
    st.myLast = { lat: outLat, lng: outLng, updatedAt: new Date(now).toISOString(), online: true, accuracy, heading };
    _animateMarker('my', outLat, outLng, accuracy, heading);
    _updateMyStatusUI();
    _checkGeofences(outLat, outLng);

    // Throttle server pings — time-based OR distance-based trigger
    const moved = st.lastPingPos ? haversine(st.lastPingPos, { lat: outLat, lng: outLng }) * 1000 : Infinity;
    const dueTime = now - st.lastPingAt >= PING_MIN_INTERVAL_MS;
    if ((dueTime && moved > 2) || moved > PING_MIN_DISTANCE_M || !st.lastPingPos) {
      st.lastPingAt = now;
      st.lastPingPos = { lat: outLat, lng: outLng };
      if (navigator.onLine && S.coupleId) {
        api('POST', '/api/location/ping', {
          coupleId: S.coupleId, role: S.role, lat: outLat, lng: outLng,
          accuracy: accuracy || null, heading: heading || null,
          speed: speed || null, moving: (speed || 0) > 1,
          localDate: _localDateStr()
        }).catch(() => { /* offline or transient — next tick will retry */ });
      }
    }
  }

  function _showPermBanner(msg) {
    const el = document.getElementById('lmPermBanner');
    if (!el) return;
    el.style.display = 'block'; el.textContent = msg;
  }
  function _hidePermBanner() {
    const el = document.getElementById('lmPermBanner');
    if (el) el.style.display = 'none';
  }

  /* ── PARTNER POLLING ──────────────────────────────────────── */
  function _startPolling() {
    _stopPolling();
    _pollOnce();
    st.pollTimer = setInterval(_pollOnce, POLL_INTERVAL_MS);
  }
  function _stopPolling() { if (st.pollTimer) { clearInterval(st.pollTimer); st.pollTimer = null; } }

  async function _pollOnce() {
    const offlineEl = document.getElementById('lmOfflineBanner');
    if (!navigator.onLine) {
      if (offlineEl) offlineEl.style.display = 'flex';
      _updatePtStatusUI(); _updateMyStatusUI();
      return;
    }
    if (!S.coupleId) return;
    try {
      const data = await api('GET', '/api/location/' + S.coupleId);
      if (offlineEl) offlineEl.style.display = 'none';
      if (data.user1 || data.user2) {
        const mine = data[S.role];
        const theirs = data[S.role === 'user1' ? 'user2' : 'user1'];
        if (mine) st.myLast = mine;
        if (theirs) {
  const changed = !st.ptLast || st.ptLast.lat !== theirs.lat || st.ptLast.lng !== theirs.lng;
  st.ptLast = theirs;
  if (changed && theirs.lat != null && theirs.lng != null) {
    S.ptLoc = { lat: theirs.lat, lng: theirs.lng, ts: Date.parse(theirs.updatedAt), moving: theirs.moving, accuracy: theirs.accuracy, heading: theirs.heading };
    _animateMarker('pt', theirs.lat, theirs.lng, theirs.accuracy, theirs.heading);
  }
}
      }
      _updateMyStatusUI(); _updatePtStatusUI(); _updateStatsUI();
    } catch (e) {
      if (offlineEl) offlineEl.style.display = 'flex';
    }
  }

  /* ── STATUS UI ────────────────────────────────────────────── */
  function _updateMyStatusUI() {
    const st1 = document.getElementById('lmMyStatus'), dot1 = document.getElementById('lmMyDot');
    if (!st1) return;
    if (st.permState === 'denied') { st1.textContent = 'Location blocked'; if (dot1) dot1.style.background = 'var(--red)'; return; }
    if (st.permState === 'unsupported') { st1.textContent = 'Not supported'; if (dot1) dot1.style.background = 'var(--text3)'; return; }
    if (st.myLast) { st1.textContent = (S.myLoc?.moving ? '🚗 Moving · ' : '') + 'Online'; if (dot1) dot1.style.background = 'var(--green)'; }
    else { st1.textContent = 'Locating…'; if (dot1) dot1.style.background = 'var(--yellow)'; }
  }
  function _updatePtStatusUI() {
    const st2 = document.getElementById('lmPtStatus'), dot2 = document.getElementById('lmPtDot');
    if (!st2) return;
    if (!S.paired) { st2.textContent = 'Not paired yet'; if (dot2) dot2.style.background = 'var(--text3)'; return; }
    if (st.ptLast && st.ptLast.online) {
      st2.textContent = (st.ptLast.moving ? '🚗 Moving · ' : '') + 'Online';
      if (dot2) dot2.style.background = 'var(--green)';
    } else if (st.ptLast) {
      st2.textContent = 'Last seen ' + fmtAgo(st.ptLast.updatedAt);
      if (dot2) dot2.style.background = 'var(--text3)';
    } else {
      st2.textContent = 'No location shared yet';
      if (dot2) dot2.style.background = 'var(--text3)';
    }
  }
  function _updateStatsUI() {
    const dist = haversine(S.myLoc, S.ptLoc);
    const de = document.getElementById('mapDistance'); if (de) de.textContent = dist != null ? (dist < 1 ? Math.round(dist * 1000) + ' m' : dist.toFixed(1) + ' km') : '—';
    const ee = document.getElementById('mapETA'); if (ee) ee.textContent = dist != null ? Math.max(1, Math.round(dist / 40 * 60)) + ' min' : '—';
    const lastTs = Math.max((S.myLoc || {}).ts || 0, st.ptLast ? Date.parse(st.ptLast.updatedAt) : 0);
    const ue = document.getElementById('mapUpdated'); if (ue) ue.textContent = lastTs ? fmtAgo(new Date(lastTs).toISOString()) : '—';
    const noteEl = document.getElementById('mapTravelNote');
    if (noteEl) {
      if (st.ptLast && st.ptLast.moving) { noteEl.style.display = 'block'; noteEl.textContent = '🚗 ' + (S.partnerName || 'Partner') + ' is on the move'; }
      else if (!st.ptLast) { noteEl.style.display = 'block'; noteEl.textContent = '💡 Partner hasn\'t shared their location yet.'; }
      else noteEl.style.display = 'none';
    }
  }

  /* ── SMOOTH MARKER ANIMATION ─────────────────────────────── */
  function _animateMarker(who, lat, lng, accuracy, heading) {
    if (!st.map || !window.L) return;
    const fromMarker = who === 'my' ? st.myMarker : st.ptMarker;
    const from = fromMarker ? fromMarker.getLatLng() : { lat, lng };
    if (who === 'my') { st.myAnimFrom = from; st.myAnimTarget = { lat, lng }; st.myAnimStart = performance.now(); }
    else { st.ptAnimFrom = from; st.ptAnimTarget = { lat, lng }; st.ptAnimStart = performance.now(); }
    _ensureMarker(who, lat, lng, accuracy, heading);
    _tickAnim();
  }

  function _ensureAccuracyCircle(who, lat, lng, accuracy) {
    const key = who === 'my' ? 'myAccCircle' : 'ptAccCircle';
    if (accuracy == null || !(accuracy > 0)) {
      if (st[key]) { st.map.removeLayer(st[key]); st[key] = null; }
      return;
    }
    const color = who === 'my' ? '#5b9bff' : '#ff6baf';
    if (!st[key]) {
      st[key] = L.circle([lat, lng], { radius: accuracy, color, weight: 1, fillColor: color, fillOpacity: 0.10, interactive: false }).addTo(st.map);
    } else {
      st[key].setLatLng([lat, lng]);
      st[key].setRadius(accuracy);
    }
  }

  function _ensureMarker(who, lat, lng, accuracy, heading) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    console.warn('LiveMap: ignoring invalid coords for', who, lat, lng);
    return;
  }
  _ensureAccuracyCircle(who, lat, lng, accuracy);
  const name = who === 'my' ? (S.myName || 'U') : (S.partnerName || 'P');
  const avatar = who === 'my' ? S.myAvatar : S.partnerAvatar;
  const size = who === 'my' ? 30 : 38;
  const inner = avatar
    ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;position:absolute;inset:0">`
    : esc(name[0] || (who === 'my' ? 'U' : 'P'));
  const color = who === 'my' ? 'var(--accent)' : 'var(--accent2)';
  const arrow = (heading != null && !isNaN(heading))
    ? `<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${heading}deg);transform-origin:50% ${size/2+9}px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${who==='my'?'#5b9bff':'#ff6baf'}"></div>`
    : '';
  const html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:${size*0.4}px;font-weight:700;border:3px solid #fff;box-shadow:0 0 0 4px ${who==='my'?'rgba(91,155,255,0.35)':'rgba(255,107,175,0.35)'},0 4px 14px rgba(0,0,0,0.4)">${arrow}${inner}</div>`;
  const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
  if (who === 'my') {
    if (!st.myMarker) st.myMarker = L.marker([lat, lng], { icon, zIndexOffset: 400 }).addTo(st.map);
    else st.myMarker.setIcon(icon);
  } else {
    if (!st.ptMarker) st.ptMarker = L.marker([lat, lng], { icon, zIndexOffset: 500 }).addTo(st.map);
    else st.ptMarker.setIcon(icon);
  }
}

  let _animRunning = false;
  function _tickAnim() {
    if (_animRunning) return;
    _animRunning = true;
    const DUR = 900; // ms glide between pings — feels "live" without teleporting
    function frame(t) {
      let stillGoing = false;
      if (st.myMarker && st.myAnimTarget) {
        const p = Math.min(1, (t - st.myAnimStart) / DUR);
        const lat = st.myAnimFrom.lat + (st.myAnimTarget.lat - st.myAnimFrom.lat) * p;
        const lng = st.myAnimFrom.lng + (st.myAnimTarget.lng - st.myAnimFrom.lng) * p;
        st.myMarker.setLatLng([lat, lng]);
        if (p < 1) stillGoing = true;
      }
      if (st.ptMarker && st.ptAnimTarget) {
        const p = Math.min(1, (t - st.ptAnimStart) / DUR);
        const lat = st.ptAnimFrom.lat + (st.ptAnimTarget.lat - st.ptAnimFrom.lat) * p;
        const lng = st.ptAnimFrom.lng + (st.ptAnimTarget.lng - st.ptAnimFrom.lng) * p;
        st.ptMarker.setLatLng([lat, lng]);
        if (p < 1) stillGoing = true;
      }
      if (stillGoing) requestAnimationFrame(frame);
      else _animRunning = false;
    }
    requestAnimationFrame(frame);
  }

  /* ── MAP INIT & PLACES RENDERING ──────────────────────────── */
  function _initMap() {
    if (st.map || !window.L) return;
    const mapDiv = document.getElementById('mapView');
    if (!mapDiv) return;
    st.map = L.map('mapView', { zoomControl: true }).setView([20.2961, 85.8245], 5);
    setMapStyle(st.mapStyle || 'street');
    setTimeout(() => st.map.invalidateSize(), 100);
  }

 function _fitBoth() {
  if (!st.map) return;
  const pts = [];
  if (S.myLoc && S.myLoc.lat != null && S.myLoc.lng != null) pts.push([S.myLoc.lat, S.myLoc.lng]);
  if (S.ptLoc && S.ptLoc.lat != null && S.ptLoc.lng != null) pts.push([S.ptLoc.lat, S.ptLoc.lng]);
  if (pts.length === 2) st.map.fitBounds(pts, { padding: [60, 60] });
  else if (pts.length === 1) st.map.setView(pts[0], 13);
}

  function _renderPlaceMarkers() {
    if (!st.map) return;
    st.placeMarkers.forEach(m => st.map.removeLayer(m));
    st.placeMarkers = [];
    (S.placesList || []).forEach(p => {
      const ico = (CATS[p.cat] || CATS.Custom).ico;
      const color = p.owner === S.role ? 'var(--accent)' : 'var(--accent2)';
      const icon = L.divIcon({
        html: `<div style="width:26px;height:26px;border-radius:8px;background:${color};display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)">${ico}</div>`,
        className: '', iconSize: [26, 26]
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(st.map).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.cat)}<br><a href="#" onclick="LiveMap.openStreetView(${p.lat},${p.lng});return false;">👁 Street View</a>`);
      st.placeMarkers.push(m);
    });
  }

  function _renderPlacesLists() {
    migrateLegacyPlaces();
    const mine = (S.placesList || []).filter(p => p.owner === S.role);
    const theirs = (S.placesList || []).filter(p => p.owner !== S.role);
    const rowHtml = (p, deletable) => `
      <div class="money-row">
        <div class="money-ic inc">${(CATS[p.cat] || CATS.Custom).ico}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;color:var(--white)">${esc(p.cat)}${p.name && p.name !== p.cat ? ' · ' + esc(p.name) : ''}</div>
          <div style="font-size:10px;color:var(--text3)">${p.address ? esc(p.address) + ' · ' : ''}${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
        </div>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.flyTo(${p.lat},${p.lng})">View</button>
        ${deletable ? `<button class="del-btn" onclick="LiveMap.deletePlace('${p.id}')">✕</button>` : ''}
      </div>`;
    const myEl = document.getElementById('myPlacesList');
    if (myEl) myEl.innerHTML = mine.length ? mine.map(p => rowHtml(p, true)).join('') : '<div class="empty">No places saved yet — add Home, College, Office…</div>';
    const ptEl = document.getElementById('ptPlacesList');
    if (ptEl) ptEl.innerHTML = theirs.length ? theirs.map(p => rowHtml(p, false)).join('') : '<div class="empty">Synced once your partner adds places</div>';
    _renderPlaceMarkers();
  }

  function flyTo(lat, lng) { if (st.map) st.map.setView([lat, lng], 15); }

  /* ── PLACE SEARCH (via SearchService — Overpass/Nominatim/Photon engine) ── */
  const CAT_SEARCH_MAP = { College: 'college', Hostel: 'hotel', Cafe: 'cafe', Restaurant: 'restaurant', Gym: 'gym' };
  const CAT_GUESS_FROM_OSM = {
    college: 'College', university: 'College',
    hotel: 'Hostel', hostel: 'Hostel', guest_house: 'Hostel',
    cafe: 'Cafe', restaurant: 'Restaurant',
    fitness_centre: 'Gym', gym: 'Gym'
  };
  let _lmSearchTimer = null;

  function _searchOrigin() {
    if (S.myLoc && S.myLoc.lat != null && S.myLoc.lng != null) return { lat: S.myLoc.lat, lng: S.myLoc.lng };
    if (st.map) { const c = st.map.getCenter(); return { lat: c.lat, lng: c.lng }; }
    return null;
  }

  function _renderSearchChips() {
    const chipsEl = document.getElementById('lmPlaceSearchChips');
    if (!chipsEl) return;
    chipsEl.innerHTML = Object.keys(CAT_SEARCH_MAP).map(label =>
      `<div class="lm-chip" data-cat="${label}" onclick="LiveMap.searchByChip('${label}')">${CATS[label].ico} ${label}s nearby</div>`
    ).join('');
  }

  function _renderSearchResults(results) {
    const resultsEl = document.getElementById('lmPlaceSearchResults');
    resultsEl.className = 'lm-search-results show';
    if (!results.length) { resultsEl.innerHTML = '<div class="lm-sr-empty">No results — try a different search or category</div>'; return; }
    resultsEl.innerHTML = results.map((r, i) => `
      <div class="lm-sr-item" onclick="LiveMap.pickSearchResult(${i})">
        <div class="lm-sr-ico">${r.icon || '📍'}</div>
        <div class="lm-sr-body">
          <div class="lm-sr-name">${esc(r.name)}</div>
          <div class="lm-sr-meta">${r.distKm != null ? r.distKm.toFixed(1) + ' km · ' : ''}${esc((r.address || '').slice(0, 50))}${r.fromOfflineCache ? ' · saved' : ''}</div>
        </div>
      </div>`).join('');
  }

  /** Live-typing search box — free text via SearchService (Nominatim+Photon merged, ranked, fuzzy). */
  function onSearchInput(q) {
    clearTimeout(_lmSearchTimer);
    document.querySelectorAll('#lmPlaceSearchChips .lm-chip').forEach(c => c.classList.remove('active'));
    const resultsEl = document.getElementById('lmPlaceSearchResults');
    if (!q || q.trim().length < 2) { resultsEl.classList.remove('show'); resultsEl.innerHTML = ''; return; }
    resultsEl.className = 'lm-search-results show';
    resultsEl.innerHTML = '<div class="lm-sr-empty">Searching…</div>';
    _lmSearchTimer = setTimeout(async () => {
      if (!window.SearchService) { resultsEl.innerHTML = '<div class="lm-sr-empty">Search engine still loading — try again in a moment</div>'; return; }
      try {
        const results = await window.SearchService.searchText(q.trim(), { near: _searchOrigin(), limit: 12 });
        st.searchResults = results;
        _renderSearchResults(results);
      } catch (e) {
        resultsEl.innerHTML = '<div class="lm-sr-empty">Search failed — try again</div>';
      }
    }, 300);
  }

  /** Category chip tap — nearby-by-category via SearchService (Overpass multi-mirror engine). */
  async function searchByChip(label) {
    document.querySelectorAll('#lmPlaceSearchChips .lm-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === label));
    const origin = _searchOrigin();
    const resultsEl = document.getElementById('lmPlaceSearchResults');
    if (!origin) { toast('Enable location, or open the map first'); return; }
    if (!window.SearchService) { resultsEl.className = 'lm-search-results show'; resultsEl.innerHTML = '<div class="lm-sr-empty">Search engine still loading — try again in a moment</div>'; return; }
    resultsEl.className = 'lm-search-results show';
    resultsEl.innerHTML = `<div class="lm-sr-empty">Searching ${label.toLowerCase()}s nearby…</div>`;
    try {
      const results = await window.SearchService.searchCategory([CAT_SEARCH_MAP[label]], { lat: origin.lat, lng: origin.lng, radiusM: 8000, limit: 20 });
      st.searchResults = results;
      _renderSearchResults(results);
    } catch (e) {
      resultsEl.innerHTML = '<div class="lm-sr-empty">Search failed — try again</div>';
    }
  }

  /** User tapped a search result — auto-fill the Add Place form from it. */
  function pickSearchResult(i) {
    const r = (st.searchResults || [])[i];
    if (!r) return;
    document.getElementById('lmPlaceLat').value = r.lat.toFixed(6);
    document.getElementById('lmPlaceLng').value = r.lng.toFixed(6);
    document.getElementById('lmPlaceAddress').value = r.address || '';
    const guess = CAT_GUESS_FROM_OSM[r.category] || 'Custom';
    document.getElementById('lmPlaceCat').value = guess;
    onCatChange();
    if (guess === 'Custom') document.getElementById('lmPlaceCustomName').value = r.name;
    document.getElementById('lmPlaceSearchInput').value = r.name;
    document.getElementById('lmPlaceSearchResults').classList.remove('show');
    document.querySelectorAll('#lmPlaceSearchChips .lm-chip').forEach(c => c.classList.remove('active'));
    if (window.SearchService) window.SearchService.recordVisit(r);
    toast('📍 ' + r.name + ' selected — review & save');
  }

  /* ── ADD / DELETE PLACE ──────────────────────────────────── */
  function openPlaceModal() {
    document.getElementById('lmPlaceCat').value = 'Home';
    document.getElementById('lmPlaceCustomNameWrap').style.display = 'none';
    document.getElementById('lmPlaceCustomName').value = '';
    document.getElementById('lmPlaceLat').value = '';
    document.getElementById('lmPlaceLng').value = '';
    document.getElementById('lmPlaceAddress').value = '';
    document.getElementById('lmPlaceSearchInput').value = '';
    const resultsEl = document.getElementById('lmPlaceSearchResults');
    resultsEl.classList.remove('show'); resultsEl.innerHTML = '';
    st.searchResults = [];
    _renderSearchChips();
    openM('lmPlaceModal');
    useCurrentLocForPlace(true /* silent — don't toast if GPS not ready yet */);
  }
  function onCatChange() {
    const v = document.getElementById('lmPlaceCat').value;
    document.getElementById('lmPlaceCustomNameWrap').style.display = v === 'Custom' ? 'block' : 'none';
  }
  async function useCurrentLocForPlace(silent) {
    if (!S.myLoc) { if (!silent) toast('No current location yet — enable tracking first'); return; }
    const latEl = document.getElementById('lmPlaceLat'), lngEl = document.getElementById('lmPlaceLng'), addrEl = document.getElementById('lmPlaceAddress');
    latEl.value = S.myLoc.lat.toFixed(6);
    lngEl.value = S.myLoc.lng.toFixed(6);
    if (!addrEl.value) {
      addrEl.value = 'Detecting address…';
      try {
        if (window.NominatimService) {
          const r = await window.NominatimService.reverse(S.myLoc.lat, S.myLoc.lng);
          addrEl.value = r?.address || r?.displayName || '';
        } else {
          addrEl.value = '';
        }
      } catch (e) {
        addrEl.value = '';
        console.warn('LiveMap: reverse geocode failed', e);
      }
    }
  }
  function savePlace() {
    const cat = document.getElementById('lmPlaceCat').value;
    const lat = parseFloat(document.getElementById('lmPlaceLat').value);
    const lng = parseFloat(document.getElementById('lmPlaceLng').value);
    if (isNaN(lat) || isNaN(lng)) { toast('Set coordinates first (or use current location)'); return; }
    const name = cat === 'Custom' ? (document.getElementById('lmPlaceCustomName').value.trim() || 'Custom Place') : cat;
    if (!Array.isArray(S.placesList)) S.placesList = [];
    S.placesList.push({
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      owner: S.role, cat, name, lat, lng,
      address: document.getElementById('lmPlaceAddress').value.trim(),
      ts: Date.now()
    });
    closeM('lmPlaceModal'); _renderPlacesLists(); scheduleSave(); toast('Place saved 📌'); if (typeof spawnPetals === 'function') spawnPetals(4);
  }
  function deletePlace(id) {
    S.placesList = (S.placesList || []).filter(p => p.id !== id);
    _renderPlacesLists(); scheduleSave();
  }

  /* ══════════════════════════════════════════════════════════
     PHASE 2 — MAP STYLES
     ══════════════════════════════════════════════════════════ */
  const TILE_LAYERS = {
    street:    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' },
    dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '© OpenStreetMap, © CARTO' },
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri' }
  };
  function setMapStyle(style) {
    if (!st.map || !TILE_LAYERS[style]) return;
    if (st.tileLayer) st.map.removeLayer(st.tileLayer);
    const cfg = TILE_LAYERS[style];
    st.tileLayer = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: 19 }).addTo(st.map);
    st.mapStyle = style;
    document.querySelectorAll('.lm-style-btn').forEach(b => b.classList.toggle('active', b.dataset.style === style));
  }

  /* ══════════════════════════════════════════════════════════
     PHASE 2 — LOCATE ME / LOCATE PARTNER
     ══════════════════════════════════════════════════════════ */
  function locateMe() {
    if (!S.myLoc) { toast('Still finding your location…'); return; }
    st.map && st.map.setView([S.myLoc.lat, S.myLoc.lng], 16);
  }
  function locatePartner() {
    if (!S.ptLoc) { toast('Partner hasn\'t shared their location yet'); return; }
    st.map && st.map.setView([S.ptLoc.lat, S.ptLoc.lng], 16);
  }

  /* ══════════════════════════════════════════════════════════
     PHASE 2 — MEETING POINT (simple geographic midpoint)
     ══════════════════════════════════════════════════════════ */
  function showMeetingPoint() {
    if (!S.myLoc || !S.ptLoc) { toast('Both of you need to share location first'); return; }
    const mid = { lat: (S.myLoc.lat + S.ptLoc.lat) / 2, lng: (S.myLoc.lng + S.ptLoc.lng) / 2 };
    if (st.meetingMarker) st.map.removeLayer(st.meetingMarker);
    const icon = L.divIcon({
      html: `<div style="width:30px;height:30px;border-radius:50%;background:#ffd166;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,0.4)">🤝</div>`,
      className: '', iconSize: [30, 30]
    });
    st.meetingMarker = L.marker([mid.lat, mid.lng], { icon }).addTo(st.map)
      .bindPopup('<b>Meeting point</b><br>Roughly halfway between you two').openPopup();
    st.map.setView([mid.lat, mid.lng], 13);
    const distEach = haversine(S.myLoc, mid);
    toast(`🤝 Meeting point set — about ${distEach.toFixed(1)} km from each of you`);
  }

  /* ══════════════════════════════════════════════════════════
     PHASE 2 — STREET VIEW (Mapillary iframe, graceful fallback)
     No API key required for the public Mapillary embed viewer.
     If it has no imagery for the point, we fall back to a direct
     "open in Google Maps Street View" link (no API key needed —
     this is just a URL scheme, not a billed API call).
     ══════════════════════════════════════════════════════════ */
  function openStreetView(lat, lng) {
    const modal = document.getElementById('lmStreetViewModal');
    const body = document.getElementById('lmStreetViewBody');
    if (!modal || !body) { window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`, '_blank'); return; }
    body.innerHTML = `
      <iframe id="lmSvFrame" width="100%" height="360" frameborder="0"
        style="border-radius:var(--rs);background:#111"
        src="https://www.mapillary.com/embed?map_style=Mapillary%20streets&lat=${lat}&lng=${lng}&z=17"
        onerror="LiveMap._svFallback(${lat},${lng})">
      </iframe>
      <div style="font-size:10px;color:var(--text3);margin-top:8px">
        No imagery here? <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}" target="_blank" style="color:var(--accent)">Open Google Street View instead ↗</a>
      </div>`;
    openM('lmStreetViewModal');
  }
  function _svFallback(lat, lng) {
    const body = document.getElementById('lmStreetViewBody');
    if (body) body.innerHTML = `<div class="empty">Street-level imagery isn't available for this spot.<br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}" target="_blank" style="color:var(--accent)">Try Google Street View ↗</a></div>`;
  }

  /* ══════════════════════════════════════════════════════════
     PHASE 2 — SAFE ARRIVAL / GEOFENCE (entered / left a saved place)
     Runs client-side every time a fresh GPS fix comes in — no new
     backend calls, purely derived from S.myLoc + S.placesList.
     ══════════════════════════════════════════════════════════ */
  const GEOFENCE_RADIUS_M = 100;
  function _checkGeofences(lat, lng) {
    if (!Array.isArray(S.placesList)) return;
    S.placesList.filter(p => p.owner === S.role).forEach(p => {
      const d = haversine({ lat, lng }, { lat: p.lat, lng: p.lng }) * 1000;
      const inside = d <= GEOFENCE_RADIUS_M;
      const prev = st.geofenceState[p.id];
      if (inside && prev !== 'inside') {
        st.geofenceState[p.id] = 'inside';
        toast(`✅ Arrived at ${p.name || p.cat}`);
        if (window.fireBackgroundNotification) window.fireBackgroundNotification(`Safe arrival 💕`, `You've arrived at ${p.name || p.cat}`);
      } else if (!inside && prev === 'inside') {
        st.geofenceState[p.id] = 'outside';
        toast(`👋 Left ${p.name || p.cat}`);
      } else if (!prev) {
        st.geofenceState[p.id] = inside ? 'inside' : 'outside';
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
     PHASE 2 — DAILY ROUTE / TIMELINE / JOURNEY PLAYBACK
     ══════════════════════════════════════════════════════════ */
  async function openRouteHistory() {
    openM('lmRouteModal');
    document.getElementById('lmRouteBody').innerHTML = '<div class="empty">Loading dates…</div>';
    try {
      const { dates } = await api('GET', `/api/route/${S.coupleId}/${S.role}/dates`);
      st.routeDates = dates || [];
      const today = _localDateStr();
      if (!st.routeDates.includes(today)) st.routeDates.unshift(today);
      _renderRouteDatePicker();
      loadRouteDay(st.routeDates[0]);
    } catch (e) {
      document.getElementById('lmRouteBody').innerHTML = '<div class="empty">Couldn\'t load route history — try again</div>';
    }
  }
  function _renderRouteDatePicker() {
    const el = document.getElementById('lmRouteDatePicker');
    if (!el) return;
    el.innerHTML = st.routeDates.slice(0, 14).map(d => {
      const label = d === _localDateStr() ? 'Today' : d === _localDateStr(new Date(Date.now() - 86400000)) ? 'Yesterday' : d.slice(5);
      return `<div class="lm-chip ${d === st.routeSelectedDate ? 'active' : ''}" onclick="LiveMap.loadRouteDay('${d}')">${label}</div>`;
    }).join('');
  }
  async function loadRouteDay(date) {
    st.routeSelectedDate = date;
    _renderRouteDatePicker();
    const body = document.getElementById('lmRouteBody');
    body.innerHTML = '<div class="empty">Loading route…</div>';
    try {
      const data = await api('GET', `/api/route/${S.coupleId}/${S.role}/${date}`);
      st.routeData = data;
      _renderRouteStats(data);
      _drawRouteOnMap(data.points);
      _renderStopsList(data.stops);
    } catch (e) {
      body.innerHTML = '<div class="empty">No route data for this day yet</div>';
    }
  }
  function _renderRouteStats(data) {
    const body = document.getElementById('lmRouteBody');
    if (!data.points || !data.points.length) {
      body.innerHTML = '<div class="empty">No movement recorded for this day</div>';
      return;
    }
    body.innerHTML = `
      <div class="period-stats" style="margin-bottom:10px">
        <div class="pstat"><div class="pstat-n">${data.stats.distanceKm} km</div><div class="pstat-l">Distance</div></div>
        <div class="pstat"><div class="pstat-n">${data.stats.durationMin} min</div><div class="pstat-l">Duration</div></div>
        <div class="pstat"><div class="pstat-n">${data.stops.length}</div><div class="pstat-l">Stops</div></div>
      </div>
      <button class="btn btn-glass btn-sm" onclick="LiveMap.playbackRoute()">▶ Play Journey</button>
      <div id="lmStopsList" style="margin-top:10px"></div>`;
  }
  function _drawRouteOnMap(points) {
    if (!st.map) return;
    if (st.routeLine) { st.map.removeLayer(st.routeLine); st.routeLine = null; }
    st.routeStopMarkers.forEach(m => st.map.removeLayer(m)); st.routeStopMarkers = [];
    if (!points || points.length < 2) return;
    const latlngs = points.map(p => [p.lat, p.lng]);
    st.routeLine = L.polyline(latlngs, { color: 'var(--accent)', weight: 4, opacity: 0.75 }).addTo(st.map);
    st.map.fitBounds(latlngs, { padding: [50, 50] });
  }
  function _renderStopsList(stops) {
    const el = document.getElementById('lmStopsList');
    if (!el) return;
    if (!stops || !stops.length) { el.innerHTML = '<div class="empty">No stops detected — mostly on the move</div>'; return; }
    el.innerHTML = stops.map((s, i) => `
      <div class="money-row">
        <div class="money-ic inc">📍</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:500;color:var(--white)">Stop ${i + 1} · ${s.minutes} min</div>
          <div style="font-size:10px;color:var(--text3)">${new Date(s.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(s.leftAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.flyTo(${s.lat},${s.lng})">View</button>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.openStreetView(${s.lat},${s.lng})">👁</button>
      </div>`).join('');
    stops.forEach(s => {
      const icon = L.divIcon({ html: `<div style="width:16px;height:16px;border-radius:50%;background:#ffd166;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`, className: '', iconSize: [16, 16] });
      const m = L.marker([s.lat, s.lng], { icon }).addTo(st.map).bindPopup(`Stopped ${s.minutes} min`);
      st.routeStopMarkers.push(m);
    });
  }
  function playbackRoute() {
    const points = st.routeData?.points;
    if (!points || points.length < 2) { toast('Nothing to play back'); return; }
    if (st.playbackTimer) { clearInterval(st.playbackTimer); st.playbackTimer = null; }
    st.playbackIdx = 0;
    if (st.playbackMarker) { st.map.removeLayer(st.playbackMarker); }
    const icon = L.divIcon({ html: `<div style="width:22px;height:22px;border-radius:50%;background:var(--accent);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.5)"></div>`, className: '', iconSize: [22, 22] });
    st.playbackMarker = L.marker([points[0].lat, points[0].lng], { icon, zIndexOffset: 600 }).addTo(st.map);
    const speedMs = Math.max(20, Math.floor(4000 / points.length)); // finish in ~4s regardless of point count
    st.playbackTimer = setInterval(() => {
      st.playbackIdx++;
      if (st.playbackIdx >= points.length) { clearInterval(st.playbackTimer); st.playbackTimer = null; return; }
      const p = points[st.playbackIdx];
      st.playbackMarker.setLatLng([p.lat, p.lng]);
    }, speedMs);
  }

  /* ── PAGE LIFECYCLE ──────────────────────────────────────── */
  function onEnterPage() {
  st.pageActive = true;
  _initMap();
  migrateLegacyPlaces();
  document.getElementById('lmMyName').textContent = S.myName || 'You';
  document.getElementById('lmPtName').textContent = S.partnerName || 'Partner';
  document.getElementById('lmAv1').textContent = (S.myName || 'U')[0];
  document.getElementById('lmAv2').textContent = (S.partnerName || 'P')[0];
  if (S.myAvatar) { const e = document.getElementById('lmAv1'); e.innerHTML = `<img src="${S.myAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`; }
  if (S.partnerAvatar) { const e = document.getElementById('lmAv2'); e.innerHTML = `<img src="${S.partnerAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`; }
  if (S.myLoc && S.myLoc.lat != null && S.myLoc.lng != null) _animateMarker('my', S.myLoc.lat, S.myLoc.lng);
  if (S.ptLoc && S.ptLoc.lat != null && S.ptLoc.lng != null) _animateMarker('pt', S.ptLoc.lat, S.ptLoc.lng);
  _renderPlacesLists();
  _fitBoth();
  startTracking();
  _startPolling();
  window.addEventListener('online', _pollOnce);
  window.addEventListener('offline', () => { const el = document.getElementById('lmOfflineBanner'); if (el) el.style.display = 'flex'; });
}
  function onLeavePage() {
    st.pageActive = false;
    _stopPolling();
    // Keep GPS watch running in background so tracking is continuous
    // even off the map page (per requirement: "location updates continuously").
  }

  /* ── PUBLIC API ── */
  return {
    onEnterPage, onLeavePage,
    toggleTracking, startTracking, stopTracking,
    openPlaceModal, onCatChange, useCurrentLocForPlace, savePlace, deletePlace,
    onSearchInput, searchByChip, pickSearchResult,
    flyTo,
    // Phase 2
    setMapStyle, locateMe, locatePartner, showMeetingPoint,
    openStreetView, _svFallback,
    openRouteHistory, loadRouteDay, playbackRoute,
    _debug: st
  };
})();

/* ── WIRE INTO EXISTING APP (goto patch, renderMapPage override) ── */
(function hookLiveMap() {
  function patch() {
    if (typeof window.goto !== 'function' || window._liveMapPatched) { if (!window._liveMapPatched) setTimeout(patch, 400); return; }
    window._liveMapPatched = true;

    const _origGoto = window.goto;
    window.goto = function (page) {
      const wasMap = document.getElementById('page-map')?.classList.contains('active');
      _origGoto(page);
      if (page === 'map') LiveMap.onEnterPage();
      else if (wasMap) LiveMap.onLeavePage();
    };

    // Old renderMapPage() calls (e.g. from shareMyLocation) now defer to LiveMap
    window.renderMapPage = function () { LiveMap.onEnterPage(); };
    window.shareMyLocation = function () { LiveMap.startTracking(); toast('Live tracking started 📡'); };

    console.log('💓 LiveMap wired into app');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(patch, 600));
  else setTimeout(patch, 600);
})();