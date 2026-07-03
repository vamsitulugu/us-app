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
    watchId: null,
    tracking: true,
    lastPingAt: 0,
    lastPingPos: null,
    pollTimer: null,
    pageActive: false,
    myLast: null, ptLast: null,
    permState: 'unknown', // unknown | granted | denied | unsupported
  };

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
    st.watchId = navigator.geolocation.watchPosition(_onPosition, _onPosError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000
    });
    st.tracking = true;
    _syncTrackToggle();
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

  function _onPosition(pos) {
    st.permState = 'granted';
    _hidePermBanner();
    const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
    const now = Date.now();

    S.myLoc = { lat, lng, ts: now, moving: (speed || 0) > 1 };
    st.myLast = { lat, lng, updatedAt: new Date(now).toISOString(), online: true };
    _animateMarker('my', lat, lng);
    _updateMyStatusUI();

    // Throttle server pings — time-based OR distance-based trigger
    const moved = st.lastPingPos ? haversine(st.lastPingPos, { lat, lng }) * 1000 : Infinity;
    const dueTime = now - st.lastPingAt >= PING_MIN_INTERVAL_MS;
    if ((dueTime && moved > 2) || moved > PING_MIN_DISTANCE_M || !st.lastPingPos) {
      st.lastPingAt = now;
      st.lastPingPos = { lat, lng };
      if (navigator.onLine && S.coupleId) {
        api('POST', '/api/location/ping', {
          coupleId: S.coupleId, role: S.role, lat, lng,
          accuracy: accuracy || null, heading: heading || null,
          speed: speed || null, moving: (speed || 0) > 1
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
  if (changed && theirs.lat != null && theirs.lng != null && S.ptLoc?.lat !== theirs.lat) {
    S.ptLoc = { lat: theirs.lat, lng: theirs.lng, ts: Date.parse(theirs.updatedAt), moving: theirs.moving };
    _animateMarker('pt', theirs.lat, theirs.lng);
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
  function _animateMarker(who, lat, lng) {
    if (!st.map || !window.L) return;
    const fromMarker = who === 'my' ? st.myMarker : st.ptMarker;
    const from = fromMarker ? fromMarker.getLatLng() : { lat, lng };
    if (who === 'my') { st.myAnimFrom = from; st.myAnimTarget = { lat, lng }; st.myAnimStart = performance.now(); }
    else { st.ptAnimFrom = from; st.ptAnimTarget = { lat, lng }; st.ptAnimStart = performance.now(); }
    _ensureMarker(who, lat, lng);
    _tickAnim();
  }

  function _ensureMarker(who, lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    console.warn('LiveMap: ignoring invalid coords for', who, lat, lng);
    return;
  }
    const name = who === 'my' ? (S.myName || 'U') : (S.partnerName || 'P');
    const avatar = who === 'my' ? S.myAvatar : S.partnerAvatar;
    const cls = who === 'my' ? 'av1' : 'av2';
    const size = who === 'my' ? 30 : 38;
    const inner = avatar
      ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;position:absolute;inset:0">`
      : esc(name[0] || (who === 'my' ? 'U' : 'P'));
    const color = who === 'my' ? 'var(--accent)' : 'var(--accent2)';
    const html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:${size*0.4}px;font-weight:700;border:3px solid #fff;box-shadow:0 0 0 4px ${who==='my'?'rgba(91,155,255,0.35)':'rgba(255,107,175,0.35)'},0 4px 14px rgba(0,0,0,0.4)">${inner}</div>`;
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(st.map);
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
      const m = L.marker([p.lat, p.lng], { icon }).addTo(st.map).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.cat)}`);
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

  /* ── ADD / DELETE PLACE ──────────────────────────────────── */
  function openPlaceModal() {
    document.getElementById('lmPlaceCat').value = 'Home';
    document.getElementById('lmPlaceCustomNameWrap').style.display = 'none';
    document.getElementById('lmPlaceCustomName').value = '';
    document.getElementById('lmPlaceLat').value = '';
    document.getElementById('lmPlaceLng').value = '';
    document.getElementById('lmPlaceAddress').value = '';
    openM('lmPlaceModal');
  }
  function onCatChange() {
    const v = document.getElementById('lmPlaceCat').value;
    document.getElementById('lmPlaceCustomNameWrap').style.display = v === 'Custom' ? 'block' : 'none';
  }
  function useCurrentLocForPlace() {
    if (!S.myLoc) { toast('No current location yet — enable tracking first'); return; }
    document.getElementById('lmPlaceLat').value = S.myLoc.lat.toFixed(6);
    document.getElementById('lmPlaceLng').value = S.myLoc.lng.toFixed(6);
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
    flyTo,
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
