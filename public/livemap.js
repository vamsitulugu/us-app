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
  const POLL_INTERVAL_MS     = 8000;   // partner-location poll cadence (unchanged — safety net)
  const ONLINE_WINDOW_MS     = 60000;

  // ── Realtime "changed" ping ──────────────────────────────────────────
  // This is purely additive: it triggers an immediate _pollOnce() the moment
  // the partner pings, instead of waiting up to 8s for the next tick. The
  // existing 8s poll above is left fully intact as the safety net for this
  // geofencing/safe-arrival feature — realtime never replaces it here.
  let _lmSb = null, _lmChannel = null;
  function _getLmSupabase() {
    if (_lmSb) return _lmSb;
    try {
      if (window.__SHARED_SB__) { _lmSb = window.__SHARED_SB__; return _lmSb; }
      if (window.supabase && window.supabase.createClient && window.__SUPABASE_URL__ && window.__SUPABASE_ANON_KEY__) {
        _lmSb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
      }
    } catch (e) { console.warn('LiveMap Supabase init failed', e); }
    return _lmSb;
  }
  function _setupLmRealtime() {
    if (_lmChannel || !S.coupleId) return;
    const sb = _getLmSupabase();
    if (!sb) return;
    try {
      _lmChannel = sb.channel('location:' + S.coupleId, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'location_ping' }, () => { _pollOnce(); })
        .subscribe();
    } catch (e) { console.warn('LiveMap realtime channel failed', e); _lmChannel = null; }
  }
  function _teardownLmRealtime() {
    if (_lmChannel && _lmSb) {
      try { _lmSb.removeChannel(_lmChannel); } catch (e) {}
    }
    _lmChannel = null;
  }
  function _pingLmChanged() {
    if (!_lmChannel) return;
    try { _lmChannel.send({ type: 'broadcast', event: 'location_ping', payload: {} }); } catch (e) {}
  }
  window.addEventListener('pagehide', _teardownLmRealtime);

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
    routeViewRole: null, // set on openRouteHistory — 'user1' | 'user2', defaults to self
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
    _clearPauseTimer();
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

  let _pauseTimer = null, _pauseUntil = null;
  function _clearPauseTimer() { if (_pauseTimer) { clearTimeout(_pauseTimer); _pauseTimer = null; } _pauseUntil = null; }

  function _pushStatus(status, untilMinutes) {
    if (!S.coupleId) return;
    api('POST', '/api/location/status', { coupleId: S.coupleId, role: S.role, status, untilMinutes: untilMinutes || null }).catch(() => {});
  }
  function pauseSharing(minutes) {
    _clearPauseTimer();
    stopTracking(true); // stopTracking(true) already hits /api/location/stop, which sets status:'paused' server-side
    if (minutes) { // null/0 = "until manually resumed"
      _pauseUntil = Date.now() + minutes * 60000;
      _pauseTimer = setTimeout(() => { startTracking(); toast('Live tracking auto-resumed 📡'); _renderPrivacyPanel(); }, minutes * 60000);
      _pushStatus('paused', minutes);
      toast(`Location sharing paused for ${minutes >= 60 ? (minutes / 60) + 'h' : minutes + 'm'} ⏸`);
    } else {
      _pushStatus('paused', null);
      toast('Location sharing paused until you resume it ⏸');
    }
    _renderPrivacyPanel();
  }
  function resumeSharing() {
    _clearPauseTimer();
    startTracking();
    _pushStatus('active', null);
    toast('Live tracking resumed 📡');
    _renderPrivacyPanel();
  }
  function togglePrivacyPanel() {
    const panel = document.getElementById('lmPrivacyPanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    if (panel.style.display === 'block') _renderPrivacyPanel();
  }
  function toggleApproxLocation() {
    st.approxLocation = !st.approxLocation;
    st.lastPingPos = null; // force an immediate re-send at the new precision
    toast(st.approxLocation ? '📍 Switched to approximate location (~1km)' : '📍 Switched to exact location');
    _renderPrivacyPanel();
  }
  function toggleInvisibleMode() {
    st.invisible = !st.invisible;
    if (st.invisible) {
      toast('🕶️ Invisible mode on — your partner won\'t see new updates');
    } else {
      st.lastPingPos = null; // force an immediate re-send now that we're visible again
      toast('👀 Invisible mode off — sharing resumed');
    }
    _renderPrivacyPanel();
  }
  function emergencyShare() {
    if (!navigator.geolocation) { toast('GPS not available on this device'); return; }
    toast('🚨 Sending your exact location now…');
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
      if (!S.coupleId) return;
      api('POST', '/api/location/ping', {
        coupleId: S.coupleId, role: S.role, lat, lng,
        accuracy: accuracy || null, heading: heading || null, speed: speed || null,
        moving: (speed || 0) > 1, localDate: _localDateStr(), emergency: true
      }).then(() => {
        _pingLmChanged();
        toast('🚨 Emergency location sent to ' + (S.partnerName || 'your partner'));
      }).catch(() => toast('Couldn\'t send right now — check your connection'));
    }, () => toast('Couldn\'t get a GPS fix for emergency share'), { enableHighAccuracy: true, timeout: 10000 });
  }
  async function _batteryNetworkLine() {
    let batteryTxt = '', netTxt = '';
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        batteryTxt = `🔋 ${Math.round(b.level * 100)}%${b.charging ? ' (charging)' : ''}`;
      }
    } catch (e) {}
    try {
      const c = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
      if (c) netTxt = `📶 ${(c.effectiveType || 'unknown').toUpperCase()}`;
    } catch (e) {}
    return [batteryTxt, netTxt].filter(Boolean).join(' · ') || null;
  }
  function _renderPrivacyPanel() {
    const panel = document.getElementById('lmPrivacyPanel');
    if (!panel || panel.style.display !== 'block') return;
    const statusLine = st.invisible
      ? '🕶️ Invisible mode — partner sees no live updates'
      : !st.tracking
      ? (_pauseUntil ? `⏸ Paused — auto-resumes ${new Date(_pauseUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '⏸ Paused until you resume it')
      : '🟢 Sharing your live location';
    panel.innerHTML = `
      <div style="font-size:11px;color:var(--white);font-weight:600;margin-bottom:8px">${statusLine}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn btn-glass btn-xs" onclick="LiveMap.pauseSharing(15)">Pause 15m</button>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.pauseSharing(60)">Pause 1h</button>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.pauseSharing(0)">Pause manually</button>
        <button class="btn btn-accent btn-xs" onclick="LiveMap.resumeSharing()">Resume now</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn ${st.approxLocation ? 'btn-accent' : 'btn-glass'} btn-xs" onclick="LiveMap.toggleApproxLocation()">${st.approxLocation ? '📍 Approximate (~1km)' : '🎯 Exact location'}</button>
        <button class="btn ${st.invisible ? 'btn-accent' : 'btn-glass'} btn-xs" onclick="LiveMap.toggleInvisibleMode()">🕶️ Invisible mode</button>
      </div>
      <button class="btn btn-sm" style="background:var(--red);width:100%;margin-bottom:8px" onclick="LiveMap.emergencyShare()">🚨 Emergency Share (send exact location now)</button>
      <div id="lmBatteryNetLine" style="font-size:10px;color:var(--text3)">Checking device status…</div>
      <div style="font-size:9px;color:var(--text3);margin-top:8px">While paused or invisible, your partner sees "last seen" instead of your live position.</div>`;
    _batteryNetworkLine().then(line => {
      const el = document.getElementById('lmBatteryNetLine');
      if (el) el.textContent = line || 'Battery/network status not available on this device';
    });
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
    // Self-healing: if we keep rejecting fixes (meaning our anchor point
    // was itself probably wrong — e.g. a bad first network-location fix),
    // give up rejecting after a few tries and accept the new fix as truth.
    if (S.myLoc && S.myLoc.ts) {
      const dtSec = Math.max(0.5, (now - S.myLoc.ts) / 1000);
      const jumpKm = haversine(S.myLoc, { lat, lng });
      const impliedSpeed = (jumpKm * 1000) / dtSec; // m/s
      if (impliedSpeed > MAX_PLAUSIBLE_SPEED_MPS && (st._rejectStreak || 0) < 3) {
        st._rejectStreak = (st._rejectStreak || 0) + 1;
        console.warn('LiveMap: rejecting implausible jump (' + Math.round(impliedSpeed) + ' m/s), streak ' + st._rejectStreak);
        return;
      }
    }
    st._rejectStreak = 0;

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
    _renderRoutePoiList(); // no-op unless a route-POI search is active; purely local, no network
    _renderNavProgressUI(); // no-op unless navigation is active; purely local, no network

    // Throttle server pings — time-based OR distance-based trigger
    const moved = st.lastPingPos ? haversine(st.lastPingPos, { lat: outLat, lng: outLng }) * 1000 : Infinity;
    const dueTime = now - st.lastPingAt >= PING_MIN_INTERVAL_MS;
    if (!st.invisible && ((dueTime && moved > 2) || moved > PING_MIN_DISTANCE_M || !st.lastPingPos)) {
      st.lastPingAt = now;
      st.lastPingPos = { lat: outLat, lng: outLng };
      if (navigator.onLine && S.coupleId) {
        // Approximate mode: partner (and route history) only ever see a coordinate
        // rounded to ~1km precision. Your own marker/map always use the exact fix.
        const sendLat = st.approxLocation ? +outLat.toFixed(2) : outLat;
        const sendLng = st.approxLocation ? +outLng.toFixed(2) : outLng;
        api('POST', '/api/location/ping', {
          coupleId: S.coupleId, role: S.role, lat: sendLat, lng: sendLng,
          accuracy: st.approxLocation ? Math.max(accuracy || 0, 1000) : (accuracy || null),
          heading: st.approxLocation ? null : (heading || null),
          speed: speed || null, moving: (speed || 0) > 1,
          localDate: _localDateStr()
        }).then(() => { _pingLmChanged(); })
          .catch(() => { /* offline or transient — next tick will retry */ });
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
    _setupLmRealtime();
  }
  function _stopPolling() { if (st.pollTimer) { clearInterval(st.pollTimer); st.pollTimer = null; } _teardownLmRealtime(); }

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
  const wasOnline = st.ptLast ? st.ptLast.online : null;
  st.ptLast = theirs;
  if (changed && theirs.lat != null && theirs.lng != null) {
    S.ptLoc = { lat: theirs.lat, lng: theirs.lng, ts: Date.parse(theirs.updatedAt), moving: theirs.moving, accuracy: theirs.accuracy, heading: theirs.heading };
    _animateMarker('pt', theirs.lat, theirs.lng, theirs.accuracy, theirs.heading, !theirs.online);
  } else if (wasOnline !== theirs.online && st.ptMarker) {
    // Online/offline flipped with no position change (e.g. partner just went stale) — repaint marker in place.
    const p = st.ptMarker.getLatLng();
    _ensureMarker('pt', p.lat, p.lng, theirs.accuracy, theirs.heading, !theirs.online);
  }
}
      }
      _updateMyStatusUI(); _updatePtStatusUI(); _updateStatsUI();
    } catch (e) {
      if (offlineEl) offlineEl.style.display = 'flex';
    }
  }

  /* ── STATUS UI ────────────────────────────────────────────── */
  /** Classify movement from speed (m/s): stationary / walking / running / cycling / driving. */
  function _activityFromSpeed(speedMps) {
    if (speedMps == null) return null;
    const kmh = speedMps * 3.6;
    if (kmh < 1) return null; // stationary — handled separately
    if (kmh < 7) return { label: 'Walking', icon: '🚶' };
    if (kmh < 15) return { label: 'Running', icon: '🏃' };
    if (kmh < 35) return { label: 'Cycling', icon: '🚴' };
    return { label: 'Driving', icon: '🚗' };
  }
  function _statusLine(loc, moving, placeLat, placeLng) {
    const place = (placeLat != null) ? _nearestPlaceName(placeLat, placeLng) : null;
    if (moving) {
      const act = _activityFromSpeed(loc && loc.speed) || { label: 'Moving', icon: '🚗' };
      return `${act.icon} ${act.label}`;
    }
    if (place) return `📍 At ${place}`;
    return 'Online';
  }

  function _updateMyStatusUI() {
    const st1 = document.getElementById('lmMyStatus'), dot1 = document.getElementById('lmMyDot');
    if (!st1) return;
    if (st.permState === 'denied') { st1.textContent = 'Location blocked'; if (dot1) dot1.style.background = 'var(--red)'; return; }
    if (st.permState === 'unsupported') { st1.textContent = 'Not supported'; if (dot1) dot1.style.background = 'var(--text3)'; return; }
    if (!st.tracking) { st1.textContent = '⏸ Sharing paused'; if (dot1) dot1.style.background = 'var(--yellow)'; return; }
    if (st.myLast) {
      st1.textContent = _statusLine(S.myLoc, S.myLoc?.moving, S.myLoc?.lat, S.myLoc?.lng);
      if (dot1) dot1.style.background = 'var(--green)';
    }
    else { st1.textContent = 'Locating…'; if (dot1) dot1.style.background = 'var(--yellow)'; }
  }
  function _updatePtStatusUI() {
    const st2 = document.getElementById('lmPtStatus'), dot2 = document.getElementById('lmPtDot');
    if (!st2) return;
    if (!S.paired) { st2.textContent = 'Not paired yet'; if (dot2) dot2.style.background = 'var(--text3)'; return; }
    if (st.ptLast && st.ptLast.status === 'paused') {
      const until = st.ptLast.statusUntil ? new Date(st.ptLast.statusUntil) : null;
      st2.textContent = until ? `⏸ Paused — resumes ${until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '⏸ Sharing paused';
      if (dot2) dot2.style.background = 'var(--yellow)';
    } else if (st.ptLast && st.ptLast.online) {
      st2.textContent = _statusLine(st.ptLast, st.ptLast.moving, st.ptLast.lat, st.ptLast.lng);
      if (dot2) dot2.style.background = 'var(--green)';
    } else if (st.ptLast) {
      st2.textContent = 'Last seen ' + fmtAgo(st.ptLast.updatedAt);
      if (dot2) dot2.style.background = 'var(--text3)';
    } else {
      st2.textContent = 'No location shared yet';
      if (dot2) dot2.style.background = 'var(--text3)';
    }
    _updateEmergencyBanner();
  }
  let _emergencyDismissed = false;
  function _updateEmergencyBanner() {
    const el = document.getElementById('lmEmergencyBanner');
    if (!el) return;
    if (st.ptLast && st.ptLast.emergency && !_emergencyDismissed) {
      el.style.display = 'flex';
      el.querySelector('.lm-emg-text').textContent = `🚨 ${S.partnerName || 'Partner'} sent an emergency location share`;
    } else {
      el.style.display = 'none';
      if (!(st.ptLast && st.ptLast.emergency)) _emergencyDismissed = false; // reset once the alert itself clears server-side
    }
  }
  function dismissEmergencyBanner() {
    _emergencyDismissed = true;
    _updateEmergencyBanner();
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

  /* ── WEATHER OVERLAY (lightweight, no API key — Open-Meteo) ─── */
  const WEATHER_ICONS = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌦️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
    71: '🌨️', 73: '🌨️', 75: '❄️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
    95: '⛈️', 96: '⛈️', 99: '⛈️'
  };
  let _weatherCache = null; // { key, at, data }
  async function getWeather() {
    const panel = document.getElementById('lmWeatherPanel');
    if (!panel) return;
    const loc = S.myLoc || (st.myLast ? { lat: st.myLast.lat, lng: st.myLast.lng } : null);
    if (!loc || loc.lat == null) {
      panel.style.display = 'block';
      panel.innerHTML = 'Waiting for your location to fetch weather…';
      return;
    }
    // Toggle off if already open and fresh
    if (panel.style.display === 'block' && _weatherCache && Date.now() - _weatherCache.at < 600000) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    panel.innerHTML = 'Loading weather…';
    const key = loc.lat.toFixed(2) + ',' + loc.lng.toFixed(2);
    if (_weatherCache && _weatherCache.key === key && Date.now() - _weatherCache.at < 600000) {
      _renderWeather(_weatherCache.data);
      return;
    }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,precipitation&daily=sunrise,sunset,uv_index_max&timezone=auto`;
      const resp = await fetch(url);
      const data = await resp.json();
      _weatherCache = { key, at: Date.now(), data };
      _renderWeather(data);
    } catch (e) {
      panel.innerHTML = 'Couldn\'t load weather right now.';
    }
  }
  function _renderWeather(data) {
    const panel = document.getElementById('lmWeatherPanel');
    if (!panel || !data || !data.current) { if (panel) panel.innerHTML = 'Weather unavailable.'; return; }
    const c = data.current;
    const icon = WEATHER_ICONS[c.weather_code] || '🌡️';
    const sunrise = data.daily?.sunrise?.[0] ? new Date(data.daily.sunrise[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const sunset = data.daily?.sunset?.[0] ? new Date(data.daily.sunset[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const uv = data.daily?.uv_index_max?.[0];
    const uvLabel = uv == null ? '—' : uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very High' : 'Extreme';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="font-size:28px">${icon}</div>
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--white)">${Math.round(c.temperature_2m)}°C</div>
          <div style="font-size:10px">Feels like your location right now</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;font-size:10px">
        <div>💧 Humidity: ${c.relative_humidity_2m}%</div>
        <div>💨 Wind: ${Math.round(c.wind_speed_10m)} km/h</div>
        <div>🌧️ Rain: ${c.precipitation ?? 0} mm</div>
        <div>☀️ UV Index: ${uv != null ? uv.toFixed(1) : '—'} (${uvLabel})</div>
        <div>🌅 Sunrise: ${sunrise}</div>
        <div>🌇 Sunset: ${sunset}</div>
      </div>`;
  }

  /* ── SMOOTH MARKER ANIMATION ─────────────────────────────── */
  function _animateMarker(who, lat, lng, accuracy, heading, offline) {
    if (!st.map || !window.L) return;
    const fromMarker = who === 'my' ? st.myMarker : st.ptMarker;
    const from = fromMarker ? fromMarker.getLatLng() : { lat, lng };
    if (who === 'my') { st.myAnimFrom = from; st.myAnimTarget = { lat, lng }; st.myAnimStart = performance.now(); }
    else { st.ptAnimFrom = from; st.ptAnimTarget = { lat, lng }; st.ptAnimStart = performance.now(); }
    _ensureMarker(who, lat, lng, accuracy, heading, offline);
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

  function _ensureMarker(who, lat, lng, accuracy, heading, offline) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    console.warn('LiveMap: ignoring invalid coords for', who, lat, lng);
    return;
  }
  _ensureAccuracyCircle(who, lat, lng, accuracy);
  const name = who === 'my' ? (S.myName || 'U') : (S.partnerName || 'P');
  const avatar = who === 'my' ? S.myAvatar : S.partnerAvatar;
  const size = who === 'my' ? 30 : 38;
  const inner = avatar
    ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;position:absolute;inset:0;${offline ? 'filter:grayscale(1)' : ''}">`
    : esc(name[0] || (who === 'my' ? 'U' : 'P'));
  const color = offline ? '#7a7a7a' : (who === 'my' ? 'var(--accent)' : 'var(--accent2)');
  const arrow = (!offline && heading != null && !isNaN(heading))
    ? `<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${heading}deg);transform-origin:50% ${size/2+9}px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${who==='my'?'#5b9bff':'#ff6baf'}"></div>`
    : '';
  const offlineBadge = offline
    ? `<div style="position:absolute;bottom:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:#555;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:8px">💤</div>`
    : '';
  const html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:${size*0.4}px;font-weight:700;border:3px solid #fff;opacity:${offline ? 0.55 : 1};box-shadow:0 0 0 4px ${offline ? 'rgba(120,120,120,0.25)' : (who==='my'?'rgba(91,155,255,0.35)':'rgba(255,107,175,0.35)')},0 4px 14px rgba(0,0,0,0.4)">${arrow}${inner}${offlineBadge}</div>`;
  const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
  if (who === 'my') {
    if (!st.myMarker) st.myMarker = L.marker([lat, lng], { icon, zIndexOffset: 400 }).addTo(st.map);
    else st.myMarker.setIcon(icon);
  } else {
    if (!st.ptMarker) st.ptMarker = L.marker([lat, lng], { icon, zIndexOffset: 500 }).addTo(st.map);
    else st.ptMarker.setIcon(icon);
    const popupText = offline
      ? `<b>${esc(S.partnerName || 'Partner')}</b><br>💤 Offline — last known location<br>${fmtAgo(st.ptLast ? st.ptLast.updatedAt : null)}`
      : `<b>${esc(S.partnerName || 'Partner')}</b>`;
    st.ptMarker.bindPopup(popupText);
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
    try {
      st.map = L.map('mapView', { zoomControl: true }).setView([20.2961, 85.8245], 5);
    } catch (e) {
      // Container already had a Leaflet instance from somewhere else — reset
      // the div and retry once instead of leaving the whole page dead.
      console.warn('LiveMap: mapView already initialized, resetting', e);
      if (mapDiv._leaflet_id) delete mapDiv._leaflet_id;
      mapDiv.innerHTML = '';
      st.map = L.map('mapView', { zoomControl: true }).setView([20.2961, 85.8245], 5);
    }
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
    if (myEl) {
      if (mine.length) myEl.innerHTML = mine.map(p => rowHtml(p, true)).join('');
      else if (window.PS) PS.empty(myEl, { icon: 'home', title: 'No places saved yet', desc: 'Add Home, College, Office \u2014 anywhere you want a quick shortcut to.', actionLabel: 'Add Place', onAction: () => LiveMap.openPlaceModal('self'), compact: true });
      else myEl.innerHTML = '<div class="empty">No places saved yet — add Home, College, Office…</div>';
    }
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

  // ── Sunrise/sunset (no API — standard NOAA approximation) ──────────
  // Good to within a couple minutes almost everywhere, which is plenty
  // for deciding "is it light or dark out" for the map theme.
  function _sunTimesUTCMinutes(lat, lng, date) {
    const rad = Math.PI / 180;
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000) + 1;
    const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
    const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    const zenith = 90.833 * rad;
    const cosH = (Math.cos(zenith) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    if (cosH > 1 || cosH < -1) return null; // polar day/night
    const haDeg = Math.acos(cosH) / rad;
    const sunriseMin = 720 - 4 * (lng + haDeg) - eqTime;
    const sunsetMin = 720 - 4 * (lng - haDeg) - eqTime;
    return { sunriseMin, sunsetMin };
  }
  function _isDaytime(lat, lng) {
    const now = new Date();
    const t = _sunTimesUTCMinutes(lat, lng, now);
    if (!t) return true; // polar edge case — default to day theme
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    return nowMin >= t.sunriseMin && nowMin <= t.sunsetMin;
  }
  let _autoStyleTimer = null;
  function _applyAutoStyle() {
    const loc = S.myLoc || (st.myLast ? st.myLast : null);
    const style = (loc && loc.lat != null) ? (_isDaytime(loc.lat, loc.lng) ? 'street' : 'dark') : 'street';
    _setTileLayer(style);
    document.querySelectorAll('.lm-style-btn').forEach(b => b.classList.toggle('active', b.dataset.style === 'auto'));
  }
  function _setTileLayer(style) {
    if (!st.map || !TILE_LAYERS[style]) return;
    if (st.tileLayer) st.map.removeLayer(st.tileLayer);
    const cfg = TILE_LAYERS[style];
    st.tileLayer = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: 19 }).addTo(st.map);
  }
  function setMapStyle(style) {
    if (!st.map) return;
    if (_autoStyleTimer) { clearInterval(_autoStyleTimer); _autoStyleTimer = null; }
    if (style === 'auto') {
      st.mapStyle = 'auto';
      _applyAutoStyle();
      _autoStyleTimer = setInterval(_applyAutoStyle, 15 * 60 * 1000); // re-check every 15 min
      document.querySelectorAll('.lm-style-btn').forEach(b => b.classList.toggle('active', b.dataset.style === 'auto'));
      return;
    }
    if (!TILE_LAYERS[style]) return;
    _setTileLayer(style);
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
  /* ══════════════════════════════════════════════════════════
     NAVIGATE TO PARTNER
     Real routing via the free public OSRM demo server (no API key)
     for the "drive" profile, which is the only profile that public
     instance hosts. Walk/bike modes, and any routing failure, fall
     back gracefully to a straight-line distance/ETA estimate that's
     clearly labeled as approximate — never a silent wrong number.
     ══════════════════════════════════════════════════════════ */
  const NAV_PROFILES = {
    drive: { osrm: 'driving', label: 'Driving', icon: '🚗', kmh: 40 },
    walk:  { osrm: null,      label: 'Walking',  icon: '🚶', kmh: 5 },
    bike:  { osrm: null,      label: 'Cycling',  icon: '🚴', kmh: 15 }
  };
  let _navMode = 'drive';
  let _navTarget = null; // null = navigate to partner; else { lat, lng, label }
  function toggleNavPanel() {
    const panel = document.getElementById('lmNavPanel');
    if (!panel) return;
    const opening = panel.style.display !== 'block';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) { _navTarget = null; navigateToPartner(_navMode); }
    else { _clearNavRoute(); _navTarget = null; }
  }
  function navigateToPoint(lat, lng, label) {
    _navTarget = { lat, lng, label: label || 'destination' };
    const panel = document.getElementById('lmNavPanel');
    if (panel) panel.style.display = 'block';
    navigateToPartner(_navMode);
  }
  function _clearNavRoute() {
    if (st.navLine) { st.map.removeLayer(st.navLine); st.navLine = null; }
    if (st.navAltLines) { st.navAltLines.forEach(l => st.map.removeLayer(l)); st.navAltLines = []; }
    (st.routePoiMarkers || []).forEach(m => st.map.removeLayer(m));
    st.routePoiMarkers = [];
    st.navRouteCoords = null;
    _routePoiActive = null;
    st.routePoiCache = null;
    st.navProgress = null;
  }

  /* ══════════════════════════════════════════════════════════
     SEARCH ALONG ROUTE — find ATMs/food/fuel/etc along the
     currently-drawn nav route (or the straight-line fallback for
     walk/bike). Uses the same free Overpass endpoint as Meeting
     Point, but corridor-filters results to points actually near
     the route polyline (not just near the destination).
     ══════════════════════════════════════════════════════════ */
  const ROUTE_POI_TYPES = {
    atm:      { tag: '"amenity"="atm"',                          icon: '🏧', label: 'ATM' },
    food:     { tag: '"amenity"~"restaurant|fast_food"',         icon: '🍽️', label: 'Food' },
    fuel:     { tag: '"amenity"="fuel"',                         icon: '⛽', label: 'Fuel' },
    pharmacy: { tag: '"amenity"="pharmacy"',                     icon: '💊', label: 'Pharmacy' },
    hospital: { tag: '"amenity"="hospital"',                     icon: '🏥', label: 'Hospital' },
    ev:       { tag: '"amenity"="charging_station"',             icon: '🔌', label: 'EV Charging' },
    parking:  { tag: '"amenity"="parking"',                      icon: '🅿️', label: 'Parking' },
    coffee:   { tag: '"amenity"="cafe"',                         icon: '☕', label: 'Coffee' }
  };
  let _routePoiActive = null;

  function _navPoiSectionHtml() {
    return `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
      <div style="font-size:10px;color:var(--text3);margin-bottom:6px">Search along route</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${Object.keys(ROUTE_POI_TYPES).map(k => {
          const t = ROUTE_POI_TYPES[k];
          return `<div class="lm-poi-chip${k === _routePoiActive ? ' active' : ''}" data-poi="${k}" onclick="LiveMap.searchAlongRoute('${k}')">${t.icon} ${t.label}</div>`;
        }).join('')}
      </div>
      <div id="lmRoutePoiResults" style="margin-top:8px;display:none"></div>
    </div>`;
  }

  // Perpendicular distance (meters) from point p to segment a-b, via a small
  // equirectangular projection around `a` — accurate enough at route scale.
  function _pointToSegDistM(p, a, b) {
    const R = 6371000;
    const toXY = (pt) => ({
      x: (pt.lng - a.lng) * Math.PI / 180 * Math.cos(a.lat * Math.PI / 180) * R,
      y: (pt.lat - a.lat) * Math.PI / 180 * R
    });
    const A = { x: 0, y: 0 }, B = toXY(b), P = toXY(p);
    const dx = B.x - A.x, dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = A.x + t * dx, cy = A.y + t * dy;
    return Math.hypot(P.x - cx, P.y - cy);
  }
  function _minDistToRouteM(p, coords) {
    let min = Infinity;
    for (let i = 1; i < coords.length; i++) {
      const d = _pointToSegDistM(p, { lat: coords[i - 1][0], lng: coords[i - 1][1] }, { lat: coords[i][0], lng: coords[i][1] });
      if (d < min) min = d;
    }
    return min;
  }
  // Approx distance-along-route (km-scale), used only for sorting results
  // into the order you'd actually encounter them while driving.
  function _distAlongRouteKm(p, coords) {
    let best = Infinity, bestCum = 0, cum = 0;
    for (let i = 0; i < coords.length; i++) {
      const v = { lat: coords[i][0], lng: coords[i][1] };
      const d = haversine(p, v);
      if (d < best) { best = d; bestCum = cum; }
      if (i < coords.length - 1) cum += haversine(v, { lat: coords[i + 1][0], lng: coords[i + 1][1] });
    }
    return bestCum;
  }
  function _sampleRouteCoords(coords, n) {
    if (!coords || coords.length <= n) return coords || [];
    const out = [];
    for (let i = 0; i < n; i++) out.push(coords[Math.round(i * (coords.length - 1) / (n - 1))]);
    return out;
  }

  async function searchAlongRoute(key) {
    const coords = st.navRouteCoords;
    const t = ROUTE_POI_TYPES[key];
    if (!coords || coords.length < 2 || !t) { toast('Start navigation first'); return; }
    _routePoiActive = key;
    document.querySelectorAll('.lm-poi-chip').forEach(c => c.classList.toggle('active', c.dataset.poi === key));
    const resultsEl = document.getElementById('lmRoutePoiResults');
    if (!resultsEl) return;
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = `<div class="empty">Searching ${t.label.toLowerCase()} along the route…</div>`;
    (st.routePoiMarkers || []).forEach(m => st.map.removeLayer(m));
    st.routePoiMarkers = [];

    const radius = 700; // corridor half-width, meters
    const samples = _sampleRouteCoords(coords, 8);
    const filters = samples.map(c => `node[${t.tag}](around:${radius},${c[0]},${c[1]});`).join('');
    const query = `[out:json][timeout:15];(${filters});out center 40;`;
    try {
      const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(query) });
      if (!resp.ok) throw new Error('overpass error');
      const data = await resp.json();
      const seen = new Set();
      let places = (data.elements || []).filter(e => {
        if (e.lat == null || e.lon == null || seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      // Corridor filter: an "around" hit near a sample point can still be off
      // to the side of the actual road — drop anything not genuinely close
      // to the route line itself.
      places = places.filter(p => _minDistToRouteM({ lat: p.lat, lng: p.lon }, coords) <= radius);
      places.forEach(p => { p._prog = _distAlongRouteKm({ lat: p.lat, lng: p.lon }, coords); });
      places.sort((a, b) => a._prog - b._prog);
      places = places.slice(0, 15);
      // Cache the full result set (with route-progress already computed) so
      // live GPS updates can re-filter/re-sort locally with zero extra network calls.
      st.routePoiCache = { key, t, coords, places };
      _renderRoutePoiList();
    } catch (e) {
      resultsEl.innerHTML = '<div class="empty">Couldn\'t search along the route right now — try again.</div>';
    }
  }

  // Re-renders the active route-POI list/markers from the cached result set,
  // dropping anything already behind the current position and showing
  // "X km ahead" instead of absolute route km. No network calls — pure local
  // re-filter, called on every accepted GPS fix while a search is active.
  function _renderRoutePoiList() {
    const cache = st.routePoiCache;
    if (!cache || !_routePoiActive || cache.key !== _routePoiActive) return;
    const { t, coords, places: all } = cache;
    const resultsEl = document.getElementById('lmRoutePoiResults');
    if (!resultsEl) return;

    const myProg = S.myLoc ? _distAlongRouteKm(S.myLoc, coords) : 0;
    const BEHIND_BUFFER_KM = 0.15; // small grace so we don't drop a POI we're still passing
    const ahead = all.filter(p => p._prog >= myProg - BEHIND_BUFFER_KM);

    (st.routePoiMarkers || []).forEach(m => st.map.removeLayer(m));
    st.routePoiMarkers = [];

    if (!ahead.length) {
      resultsEl.innerHTML = `<div class="empty">No more ${t.label.toLowerCase()} ahead on this route.</div>`;
      return;
    }
    resultsEl.innerHTML = ahead.map(p => {
      const name = p.tags?.name || t.label;
      const remainKm = Math.max(0, p._prog - myProg);
      return `<div class="money-row">
        <div class="money-ic inc">${t.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:var(--white)">${esc(name)}</div>
          <div style="font-size:10px;color:var(--text3)">${remainKm.toFixed(1)} km ahead</div>
        </div>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.flyTo(${p.lat},${p.lon})">View</button>
        <button class="btn btn-accent btn-xs" onclick="LiveMap.navigateToPoint(${p.lat},${p.lon},'${esc(name).replace(/'/g, "\\'")}')">🧭</button>
      </div>`;
    }).join('');
    ahead.forEach(p => {
      const mIcon = L.divIcon({ html: `<div style="width:20px;height:20px;border-radius:50%;background:#2a2a2a;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px">${t.icon}</div>`, className: '', iconSize: [20, 20] });
      const m = L.marker([p.lat, p.lon], { icon: mIcon }).addTo(st.map).bindPopup(esc(p.tags?.name || t.label));
      st.routePoiMarkers.push(m);
    });
  }
  async function navigateToPartner(mode) {
    _navMode = mode || _navMode;
    const panel = document.getElementById('lmNavPanel');
    if (!panel) return;
    panel.style.display = 'block';
    const dest = _navTarget || (S.ptLoc ? { lat: S.ptLoc.lat, lng: S.ptLoc.lng, label: S.partnerName || 'Partner' } : null);
    if (!S.myLoc || !dest) {
      panel.innerHTML = _navModeButtons() + '<div style="margin-top:8px">Both of you need to share location first.</div>';
      return;
    }
    panel.innerHTML = _navModeButtons() + `<div style="margin-top:8px">Finding route to ${esc(dest.label)}…</div>`;
    const prof = NAV_PROFILES[_navMode];
    _clearNavRoute();

    if (prof.osrm) {
      try {
        const url = `https://router.project-osrm.org/route/v1/${prof.osrm}/${S.myLoc.lng},${S.myLoc.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&alternatives=true&steps=true`;
        const resp = await fetch(url);
        const data = await resp.json();
        const routes = (data.routes || []).slice(0, 3);
        if (!routes.length) throw new Error('no route');
        _renderNavRoutes(routes, dest, prof, 0);
        return;
      } catch (e) {
        // Fall through to straight-line estimate below — graceful, not silent.
      }
    }
    // Straight-line fallback (walk/bike modes, or driving route lookup failed)
    const km = haversine(S.myLoc, dest);
    const mins = Math.round((km / prof.kmh) * 60);
    st.navLine = L.polyline([[S.myLoc.lat, S.myLoc.lng], [dest.lat, dest.lng]], { color: '#5b9bff', weight: 4, opacity: 0.6, dashArray: '8,8' }).addTo(st.map);
    st.map.fitBounds(st.navLine.getBounds(), { padding: [50, 50] });
    st.navRouteCoords = [[S.myLoc.lat, S.myLoc.lng], [dest.lat, dest.lng]];
    _startNavProgress({ totalKm: km, totalMins: mins, steps: null, dest });
    panel.innerHTML = _navModeButtons() + `
      <div style="margin-top:8px;font-size:11px">
        <div style="font-weight:700;color:var(--white)">${prof.icon} To ${esc(dest.label)} — ~${km.toFixed(1)} km · ~${mins} min</div>
        <div style="color:var(--text3);margin-top:2px">Straight-line estimate — turn-by-turn ${prof.osrm ? "routing failed, showing a fallback" : "isn't available for this mode"}.</div>
      </div><div id="lmNavProgress"></div>` + _navPoiSectionHtml();
    _renderNavProgressUI();
  }
  function _navModeButtons() {
    return `<div style="display:flex;gap:6px">${Object.keys(NAV_PROFILES).map(k => {
      const p = NAV_PROFILES[k];
      return `<button class="btn ${k === _navMode ? 'btn-accent' : 'btn-glass'} btn-xs" onclick="LiveMap.navigateToPartner('${k}')">${p.icon} ${p.label}</button>`;
    }).join('')}</div>`;
  }

  let _navRoutesCache = null; // { routes, dest, prof }
  function _renderNavRoutes(routes, dest, prof, activeIdx) {
    _navRoutesCache = { routes, dest, prof };
    _clearNavRoute();
    st.navAltLines = st.navAltLines || [];
    st.navAltLines.forEach(l => st.map.removeLayer(l));
    st.navAltLines = [];

    // Draw alternates first (thin, dim) so the active route paints on top.
    routes.forEach((route, i) => {
      if (i === activeIdx) return;
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
      const line = L.polyline(coords, { color: '#8a8a8a', weight: 4, opacity: 0.45 })
        .addTo(st.map).on('click', () => _renderNavRoutes(routes, dest, prof, i));
      st.navAltLines.push(line);
    });
    const active = routes[activeIdx];
    const coords = active.geometry.coordinates.map(c => [c[1], c[0]]);
    st.navLine = L.polyline(coords, { color: '#5b9bff', weight: 5, opacity: 0.9 }).addTo(st.map);
    st.map.fitBounds(coords, { padding: [50, 50] });
    st.navRouteCoords = coords;
    // Switching/re-picking a route invalidates any in-progress POI search
    // against the old line — clear it so results can't silently go stale.
    (st.routePoiMarkers || []).forEach(m => st.map.removeLayer(m));
    st.routePoiMarkers = [];
    _routePoiActive = null;

    const km = (active.distance / 1000).toFixed(1);
    const mins = Math.round(active.duration / 60);
    const eta = new Date(Date.now() + active.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const panel = document.getElementById('lmNavPanel');
    if (!panel) return;
    const altPicker = routes.length > 1 ? `
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${routes.map((r, i) => `<button class="btn ${i === activeIdx ? 'btn-accent' : 'btn-glass'} btn-xs" onclick="LiveMap.selectNavRoute(${i})">
          Route ${i + 1} · ${(r.distance / 1000).toFixed(1)} km · ${Math.round(r.duration / 60)} min
        </button>`).join('')}
      </div>` : '';
    // Flatten OSRM steps (across all legs, there's normally just one leg for a
    // 2-point route) into a single cumulative-distance list for progress lookup.
    const steps = [];
    let cum = 0;
    (active.legs || []).forEach(leg => (leg.steps || []).forEach(s => {
      cum += s.distance;
      steps.push({ cumKm: cum / 1000, name: s.name || '', maneuver: s.maneuver });
    }));
    _startNavProgress({ totalKm: parseFloat(km), totalMins: mins, steps: steps.length ? steps : null, dest });
    panel.innerHTML = _navModeButtons() + `
      <div style="margin-top:8px;font-size:11px">
        <div style="font-weight:700;color:var(--white)">${prof.icon} To ${esc(dest.label)} — ${km} km · ${mins} min</div>
        <div style="color:var(--text3);margin-top:2px">Estimated arrival ${eta}${routes.length > 1 ? ` · ${routes.length} routes found` : ''}</div>
      </div><div id="lmNavProgress"></div>${altPicker}${_navPoiSectionHtml()}`;
    _renderNavProgressUI();
  }
  function selectNavRoute(idx) {
    if (!_navRoutesCache) return;
    _renderNavRoutes(_navRoutesCache.routes, _navRoutesCache.dest, _navRoutesCache.prof, idx);
  }

  /* ── LIVE ROUTE PROGRESS ──────────────────────────────────────
     Drives the progress bar / speed / next-waypoint panel shown while
     navigating. Purely derived from GPS fixes we already receive — no
     extra network calls, no polling timers (battery-friendly). */
  function _startNavProgress({ totalKm, totalMins, steps, dest }) {
    st.navProgress = {
      totalKm, totalMins, steps, dest, startTs: Date.now(), lastProgKm: 0, lastTs: Date.now(), curSpeedKmh: 0,
      // trip-summary accumulators (item 16) — filled in as GPS fixes arrive, purely local
      movingSec: 0, stoppedSec: 0, maxSpeedKmh: 0, stopStartTs: null, stops: [], arrived: false
    };
  }
  const STOP_SPEED_KMH = 1.5;  // below this we count the interval as "stopped", not crawling traffic
  const MIN_STOP_MIN    = 0.5; // ignore sub-30s pauses (red lights, GPS jitter) as real "stops"
  const ARRIVAL_KM      = 0.03; // ~30m from destination counts as arrived
  function _maneuverText(man, roadName) {
    const name = roadName ? esc(roadName) : '';
    if (!man) return name || 'Continue';
    const dir = man.modifier ? man.modifier.replace(/_/g, ' ') : '';
    let action;
    switch (man.type) {
      case 'depart': action = 'Head out'; break;
      case 'arrive': return 'Arrive at destination';
      case 'turn': action = dir ? `Turn ${dir}` : 'Turn'; break;
      case 'merge': action = dir ? `Merge ${dir}` : 'Merge'; break;
      case 'roundabout': case 'rotary': action = 'Enter the roundabout'; break;
      case 'fork': action = dir ? `Keep ${dir}` : 'Keep straight'; break;
      case 'end of road': action = dir ? `Turn ${dir}` : 'Continue'; break;
      case 'continue': action = dir === 'straight' ? 'Continue straight' : (dir ? `Continue ${dir}` : 'Continue'); break;
      default: action = 'Continue';
    }
    return name ? `${action} onto ${name}` : action;
  }
  function _renderNavProgressUI() {
    const np = st.navProgress;
    const el = document.getElementById('lmNavProgress');
    if (!np || !el || !st.navRouteCoords) return;
    if (np.arrived) return; // trip summary already shown — frozen until nav panel is reopened
    const coords = st.navRouteCoords;
    const rawProg = S.myLoc ? _distAlongRouteKm(S.myLoc, coords) : 0;
    const progKm = Math.min(Math.max(rawProg, 0), np.totalKm);
    const pct = np.totalKm > 0 ? (progKm / np.totalKm) * 100 : 0;
    const remainKm = Math.max(0, np.totalKm - progKm);

    // Current speed: distance covered along the route since the last render
    // tick, over elapsed time — only recompute once enough time has passed
    // so a single GPS jitter doesn't spike the reading. Same tick also feeds
    // the trip-summary accumulators (moving/stopped time, max speed, stops)
    // — all purely local, no extra network calls.
    const now = Date.now();
    const dtSec = (now - np.lastTs) / 1000;
    if (dtSec >= 2) {
      const dKm = progKm - np.lastProgKm;
      if (dKm >= 0) np.curSpeedKmh = Math.max(0, (dKm / dtSec) * 3600);
      if (np.curSpeedKmh > np.maxSpeedKmh) np.maxSpeedKmh = np.curSpeedKmh;
      if (np.curSpeedKmh < STOP_SPEED_KMH) {
        np.stoppedSec += dtSec;
        if (np.stopStartTs == null) np.stopStartTs = np.lastTs;
      } else {
        np.movingSec += dtSec;
        if (np.stopStartTs != null) {
          const stopMins = (np.lastTs - np.stopStartTs) / 60000;
          if (stopMins >= MIN_STOP_MIN) np.stops.push({ mins: stopMins });
          np.stopStartTs = null;
        }
      }
      np.lastProgKm = progKm;
      np.lastTs = now;
    }

    // ── Arrival → freeze tracking and show the trip summary instead ──
    if (np.totalKm > 0.05 && remainKm <= ARRIVAL_KM) {
      np.arrived = true;
      if (np.stopStartTs != null) { // close out a trailing stop right at arrival
        const stopMins = (now - np.stopStartTs) / 60000;
        if (stopMins >= MIN_STOP_MIN) np.stops.push({ mins: stopMins });
        np.stopStartTs = null;
      }
      toast(`🎉 Arrived at ${np.dest?.label || 'destination'}!`);
      _renderTripSummary(np);
      return;
    }

    const elapsedHrs = Math.max((now - np.startTs) / 3600000, 1 / 3600);
    const avgSpeedKmh = progKm / elapsedHrs;
    const remainMins = avgSpeedKmh > 1
      ? Math.round((remainKm / avgSpeedKmh) * 60)
      : Math.round(np.totalMins * (remainKm / Math.max(np.totalKm, 0.001)));

    let nextWaypoint = `Continue toward ${esc(np.dest?.label || 'destination')}`;
    if (np.steps && np.steps.length) {
      const next = np.steps.find(s => s.cumKm > progKm + 0.02);
      nextWaypoint = next ? _maneuverText(next.maneuver, next.name) : `Arriving at ${esc(np.dest?.label || 'destination')}`;
    }

    el.innerHTML = `
      <div style="margin-top:10px;padding:10px;background:var(--g1);border-radius:var(--rs);border:1px solid var(--border)">
        <div class="study-progress"><div class="study-fill" style="width:${pct.toFixed(0)}%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--text3)">
          <span>${progKm.toFixed(1)} km done</span><span>${remainKm.toFixed(1)} km left · ~${remainMins} min</span>
        </div>
        <div style="display:flex;gap:14px;margin-top:8px;font-size:10px;color:var(--text3)">
          <div>⚡ ${np.curSpeedKmh.toFixed(0)} km/h now</div>
          <div>📊 ${avgSpeedKmh.toFixed(0)} km/h avg</div>
        </div>
        <div style="margin-top:6px;font-size:11px;color:var(--white);font-weight:500">↪ ${nextWaypoint}</div>
      </div>`;
  }

  /* ── TRIP SUMMARY (item 16) ────────────────────────────────────
     Shown once in place of the live progress panel when navigation
     detects arrival (~30m from destination). Everything here is
     derived from accumulators fed by _renderNavProgressUI on every
     GPS fix during the trip — no extra network calls, no polling.
     Reuses the existing .period-stats/.pstat classes from Daily
     Route history so the look matches the rest of the app exactly.
     "Replay Journey" hands off to that same Daily Route feature,
     since today's just-finished trip is already part of today's
     saved route/points on the server. */
  function _renderTripSummary(np) {
    const el = document.getElementById('lmNavProgress');
    if (!el) return;
    const totalSec = Math.max(1, (Date.now() - np.startTs) / 1000);
    const travelMin = Math.max(1, Math.round(totalSec / 60));
    const movingMin = Math.round(np.movingSec / 60);
    const stoppedMin = Math.max(0, travelMin - movingMin);
    const avgKmh = np.totalKm / (totalSec / 3600);
    const longestStop = np.stops.reduce((a, b) => (b.mins > (a ? a.mins : 0) ? b : a), null);

    el.innerHTML = `
      <div style="margin-top:10px;padding:12px;background:var(--g1);border-radius:var(--rs);border:1px solid var(--border)">
        <div style="font-weight:700;color:var(--white);font-size:13px;margin-bottom:10px">🎉 Arrived at ${esc(np.dest?.label || 'destination')}!</div>
        <div class="period-stats" style="margin-bottom:8px">
          <div class="pstat"><div class="pstat-n">${np.totalKm.toFixed(1)} km</div><div class="pstat-l">Distance</div></div>
          <div class="pstat"><div class="pstat-n">${travelMin} min</div><div class="pstat-l">Travel Time</div></div>
          <div class="pstat"><div class="pstat-n">${np.stops.length}</div><div class="pstat-l">Stops</div></div>
        </div>
        <div class="period-stats" style="margin-bottom:8px">
          <div class="pstat"><div class="pstat-n">${movingMin} min</div><div class="pstat-l">Moving Time</div></div>
          <div class="pstat"><div class="pstat-n">${stoppedMin} min</div><div class="pstat-l">Stopped Time</div></div>
          <div class="pstat"><div class="pstat-n">${avgKmh.toFixed(0)} km/h</div><div class="pstat-l">Avg Speed</div></div>
          <div class="pstat"><div class="pstat-n">${np.maxSpeedKmh.toFixed(0)} km/h</div><div class="pstat-l">Max Speed</div></div>
        </div>
        ${longestStop ? `<div style="font-size:10px;color:var(--text3);margin-bottom:10px">⏱️ Longest stop: <b style="color:var(--white)">${Math.round(longestStop.mins)} min</b></div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-glass btn-xs" onclick="LiveMap.openRouteHistory()">📼 Replay Journey</button>
          <button class="btn btn-accent btn-xs" onclick="LiveMap.toggleNavPanel()">Done</button>
        </div>
      </div>`;
  }

  const MEETING_PLACE_TYPES = {
    cafe:        { tag: '"amenity"="cafe"',                icon: '☕', label: 'Cafe' },
    restaurant:  { tag: '"amenity"="restaurant"',           icon: '🍽️', label: 'Restaurant' },
    mall:        { tag: '"shop"="mall"',                    icon: '🛍️', label: 'Mall' },
    park:        { tag: '"leisure"="park"',                 icon: '🌳', label: 'Park' },
    cinema:      { tag: '"amenity"="cinema"',                icon: '🎬', label: 'Cinema' },
    temple:      { tag: '"amenity"="place_of_worship"',      icon: '🛕', label: 'Temple' },
    fuel:        { tag: '"amenity"="fuel"',                  icon: '⛽', label: 'Petrol Station' }
  };
  async function showMeetingPoint() {
    if (!S.myLoc || !S.ptLoc) { toast('Both of you need to share location first'); return; }
    const mid = { lat: (S.myLoc.lat + S.ptLoc.lat) / 2, lng: (S.myLoc.lng + S.ptLoc.lng) / 2 };
    if (st.meetingMarker) st.map.removeLayer(st.meetingMarker);
    const icon = L.divIcon({
      html: `<div style="width:30px;height:30px;border-radius:50%;background:#ffd166;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,0.4)">🤝</div>`,
      className: '', iconSize: [30, 30]
    });
    st.meetingMarker = L.marker([mid.lat, mid.lng], { icon }).addTo(st.map)
      .bindPopup('<b>Meeting point</b><br>Roughly halfway between you two').openPopup();
    st.map.setView([mid.lat, mid.lng], 14);
    const distEach = haversine(S.myLoc, mid);
    toast(`🤝 Meeting point set — about ${distEach.toFixed(1)} km from each of you`);
    _findMeetingPlaceSuggestions(mid);
  }
  st.meetingPlaceMarkers = st.meetingPlaceMarkers || [];
  async function _findMeetingPlaceSuggestions(mid) {
    const panel = document.getElementById('lmMeetingSuggestions');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = '<div class="empty">Finding nearby cafes, restaurants & more…</div>';
    (st.meetingPlaceMarkers || []).forEach(m => st.map.removeLayer(m));
    st.meetingPlaceMarkers = [];

    const radius = 1500; // meters
    const filters = Object.values(MEETING_PLACE_TYPES).map(t => `node[${t.tag}](around:${radius},${mid.lat},${mid.lng});`).join('');
    const query = `[out:json][timeout:12];(${filters});out center 24;`;
    try {
      const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(query) });
      if (!resp.ok) throw new Error('overpass error');
      const data = await resp.json();
      const places = (data.elements || []).filter(e => e.lat != null && e.lon != null).slice(0, 8);
      if (!places.length) { panel.innerHTML = '<div class="empty">No nearby places found within 1.5 km — try a different area.</div>'; return; }
      panel.innerHTML = places.map(p => {
        const name = p.tags?.name || 'Unnamed place';
        const typeKey = Object.keys(MEETING_PLACE_TYPES).find(k => {
          const t = MEETING_PLACE_TYPES[k];
          const [key, val] = t.tag.replace(/"/g, '').split('=');
          return p.tags?.[key] === val;
        });
        const meta = MEETING_PLACE_TYPES[typeKey] || { icon: '📍', label: 'Place' };
        const myD = haversine(S.myLoc, { lat: p.lat, lng: p.lon });
        const ptD = haversine(S.ptLoc, { lat: p.lat, lng: p.lon });
        return `<div class="money-row">
          <div class="money-ic inc">${meta.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;color:var(--white)">${esc(name)} <span style="color:var(--text3);font-weight:400">· ${meta.label}</span></div>
            <div style="font-size:10px;color:var(--text3)">You: ${myD.toFixed(1)} km (~${Math.round(myD/40*60)} min) · ${esc(S.partnerName || 'Partner')}: ${ptD.toFixed(1)} km (~${Math.round(ptD/40*60)} min)</div>
          </div>
          <button class="btn btn-glass btn-xs" onclick="LiveMap.flyTo(${p.lat},${p.lon})">View</button>
          <button class="btn btn-accent btn-xs" onclick="LiveMap.navigateToPoint(${p.lat},${p.lon},'${esc(name).replace(/'/g, "\\'")}')">🧭</button>
        </div>`;
      }).join('');
      places.forEach(p => {
        const typeKey = Object.keys(MEETING_PLACE_TYPES).find(k => {
          const t = MEETING_PLACE_TYPES[k];
          const [key, val] = t.tag.replace(/"/g, '').split('=');
          return p.tags?.[key] === val;
        });
        const meta = MEETING_PLACE_TYPES[typeKey] || { icon: '📍' };
        const mIcon = L.divIcon({ html: `<div style="width:22px;height:22px;border-radius:50%;background:#2a2a2a;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px">${meta.icon}</div>`, className: '', iconSize: [22, 22] });
        const m = L.marker([p.lat, p.lon], { icon: mIcon }).addTo(st.map).bindPopup(esc(p.tags?.name || meta.label));
        st.meetingPlaceMarkers.push(m);
      });
    } catch (e) {
      panel.innerHTML = '<div class="empty">Couldn\'t reach the places lookup right now — showing just the midpoint above.</div>';
    }
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
  async function openRouteHistory(role) {
    st.routeViewRole = role || S.role;
    openM('lmRouteModal');
    document.getElementById('lmRouteBody').innerHTML = '<div class="empty">Loading dates…</div>';
    _renderRouteRoleToggle();
    try {
      const { dates } = await api('GET', `/api/route/${S.coupleId}/${st.routeViewRole}/dates`);
      st.routeDates = dates || [];
      const today = _localDateStr();
      if (!st.routeDates.includes(today)) st.routeDates.unshift(today);
      _renderRouteDatePicker();
      loadRouteDay(st.routeDates[0]);
    } catch (e) {
      document.getElementById('lmRouteBody').innerHTML = '<div class="empty">Couldn\'t load route history — try again</div>';
    }
  }
  function switchRouteRole(role) {
    if (role === st.routeViewRole) return;
    openRouteHistory(role);
  }
  function _renderRouteRoleToggle() {
    const el = document.getElementById('lmRouteRoleToggle');
    if (!el) return;
    const partnerRole = S.role === 'user1' ? 'user2' : 'user1';
    el.innerHTML = `
      <div class="lm-tool-btn ${st.routeViewRole === S.role ? 'active' : ''}" onclick="LiveMap.switchRouteRole('${S.role}')"><span class="lm-tool-ico">🧍</span>${esc(S.myName || 'You')}</div>
      <div class="lm-tool-btn ${st.routeViewRole === partnerRole ? 'active' : ''}" onclick="LiveMap.switchRouteRole('${partnerRole}')"><span class="lm-tool-ico">💜</span>${esc(S.partnerName || 'Partner')}</div>`;
  }

  /** Find the nearest saved place (either owner) within radius, for labeling stops. */
  function _nearestPlaceName(lat, lng, radiusM) {
    radiusM = radiusM || 150;
    let best = null, bestD = Infinity;
    (S.placesList || []).forEach(p => {
      const d = haversine({ lat, lng }, { lat: p.lat, lng: p.lng }) * 1000;
      if (d <= radiusM && d < bestD) { bestD = d; best = p; }
    });
    return best ? (best.name || best.cat) : null;
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
    if (st.playbackTimer) { clearInterval(st.playbackTimer); st.playbackTimer = null; }
    if (st.playbackMarker && st.map) { st.map.removeLayer(st.playbackMarker); st.playbackMarker = null; }
    st.playbackIdx = 0;
    st.routeSelectedDate = date;
    _renderRouteDatePicker();
    const body = document.getElementById('lmRouteBody');
    body.innerHTML = '<div class="empty">Loading route…</div>';
    try {
      const role = st.routeViewRole || S.role;
      const data = await api('GET', `/api/route/${S.coupleId}/${role}/${date}`);
      st.routeData = data;
      _renderRouteStats(data);
      _drawRouteOnMap(data.points);
      _renderStopsList(data.stops);
      _renderJourneySummary(data.stops);
    } catch (e) {
      body.innerHTML = '<div class="empty">No route data for this day yet</div>';
    }
  }
  /** "Home → College → Shopping → Home" style summary line, using saved place names, plus longest-stop / most-visited-place callouts. */
  function _renderJourneySummary(stops) {
    const el = document.getElementById('lmJourneySummary');
    if (!el) return;
    if (!stops || !stops.length) { el.innerHTML = ''; return; }
    const names = stops.map(s => _nearestPlaceName(s.lat, s.lng) || 'Unknown stop');
    // Collapse consecutive duplicates (e.g. two clusters at the same place back-to-back)
    const collapsed = names.filter((n, i) => n !== names[i - 1]);
    let html = `<div class="lm-journey-line">${collapsed.map(esc).join(' <span class="lm-journey-arrow">→</span> ')}</div>`;

    const longest = stops.reduce((a, b) => (b.minutes > (a?.minutes || 0) ? b : a), null);
    const counts = {};
    names.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
    const mostVisited = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    html += `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:10px;color:var(--text3)">
      ${longest ? `<span>⏱️ Longest stop: <b style="color:var(--white)">${esc(_nearestPlaceName(longest.lat, longest.lng) || 'a stop')}</b> · ${longest.minutes} min</span>` : ''}
      ${mostVisited ? `<span>📌 Most visited: <b style="color:var(--white)">${esc(mostVisited)}</b> ${counts[mostVisited] > 1 ? '×' + counts[mostVisited] : ''}</span>` : ''}
    </div>`;
    el.innerHTML = html;
  }
  /** Client-side extended stats from raw points — moving/stopped time, speed, mode-split distance, accuracy. */
  function _computeExtendedStats(points, totalDurationMin) {
    const out = { movingMin: 0, stoppedMin: 0, avgKmh: 0, maxKmh: 0, walkKm: 0, driveKm: 0, cycleKm: 0, avgAccuracy: null };
    if (!points || points.length < 2) return out;
    let movingSec = 0, speedSumKmh = 0, speedSamples = 0, maxKmh = 0, accSum = 0, accN = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dtSec = Math.max(0.5, (new Date(b.created_at) - new Date(a.created_at)) / 1000);
      const segKm = haversine(a, b);
      const kmh = (segKm * 1000 / dtSec) * 3.6;
      if (kmh > 1) {
        movingSec += dtSec;
        speedSumKmh += kmh; speedSamples++;
        if (kmh > maxKmh) maxKmh = kmh;
        if (kmh < 7) out.walkKm += segKm;
        else if (kmh < 35) out.cycleKm += segKm;
        else out.driveKm += segKm;
      }
      if (a.accuracy != null) { accSum += a.accuracy; accN++; }
    }
    out.movingMin = Math.round(movingSec / 60);
    out.stoppedMin = Math.max(0, Math.round((totalDurationMin || 0) - out.movingMin));
    out.avgKmh = speedSamples ? +(speedSumKmh / speedSamples).toFixed(1) : 0;
    out.maxKmh = +maxKmh.toFixed(1);
    out.walkKm = +out.walkKm.toFixed(2); out.driveKm = +out.driveKm.toFixed(2); out.cycleKm = +out.cycleKm.toFixed(2);
    out.avgAccuracy = accN ? Math.round(accSum / accN) : null;
    return out;
  }

  function _renderRouteStats(data) {
    const body = document.getElementById('lmRouteBody');
    if (!data.points || !data.points.length) {
      body.innerHTML = '<div class="empty">No movement recorded for this day</div>';
      return;
    }
    const ext = _computeExtendedStats(data.points, data.stats.durationMin);
    body.innerHTML = `
      <div class="period-stats" style="margin-bottom:8px">
        <div class="pstat"><div class="pstat-n">${data.stats.distanceKm} km</div><div class="pstat-l">Distance</div></div>
        <div class="pstat"><div class="pstat-n">${data.stats.durationMin} min</div><div class="pstat-l">Duration</div></div>
        <div class="pstat"><div class="pstat-n">${data.stops.length}</div><div class="pstat-l">Stops</div></div>
      </div>
      <div class="period-stats" style="margin-bottom:10px">
        <div class="pstat"><div class="pstat-n">${ext.movingMin} min</div><div class="pstat-l">Moving Time</div></div>
        <div class="pstat"><div class="pstat-n">${ext.stoppedMin} min</div><div class="pstat-l">Stopped Time</div></div>
        <div class="pstat"><div class="pstat-n">${ext.avgKmh} km/h</div><div class="pstat-l">Avg Speed</div></div>
        <div class="pstat"><div class="pstat-n">${ext.maxKmh} km/h</div><div class="pstat-l">Max Speed</div></div>
      </div>
      <div class="period-stats" style="margin-bottom:10px">
        <div class="pstat"><div class="pstat-n">${ext.walkKm} km</div><div class="pstat-l">🚶 Walking</div></div>
        <div class="pstat"><div class="pstat-n">${ext.cycleKm} km</div><div class="pstat-l">🚴 Cycling</div></div>
        <div class="pstat"><div class="pstat-n">${ext.driveKm} km</div><div class="pstat-l">🚗 Driving</div></div>
        <div class="pstat"><div class="pstat-n">${ext.avgAccuracy != null ? ext.avgAccuracy + ' m' : '—'}</div><div class="pstat-l">GPS Accuracy</div></div>
      </div>
      <div id="lmJourneySummary"></div>
      <div class="lm-playback-bar" style="display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap">
        <button class="btn btn-glass btn-sm" id="lmPlaybackPlayBtn" onclick="LiveMap.playbackRoute()">▶ Play Journey</button>
        <button class="btn btn-glass btn-sm" id="lmPlaybackPauseBtn" style="display:none" onclick="LiveMap.pausePlayback()">⏸ Pause</button>
        <select id="lmPlaybackSpeed" class="lm-speed-select" onchange="LiveMap.setPlaybackSpeed(this.value)" style="background:var(--g1);border:1px solid var(--border);border-radius:8px;color:var(--white);font-size:11px;padding:4px 6px">
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </div>
      <div id="lmPlaybackProgress" style="display:none;font-size:10px;color:var(--text3);margin-bottom:8px">
        <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;margin-bottom:4px">
          <div id="lmPlaybackBar" style="height:100%;width:0%;background:var(--accent);transition:width .15s linear"></div>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span id="lmPlaybackTime">00:00</span>
          <span id="lmPlaybackDist">0.0 km</span>
          <span id="lmPlaybackSpeedNow">— km/h</span>
        </div>
      </div>
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
    el.innerHTML = stops.map((s, i) => {
      const placeName = _nearestPlaceName(s.lat, s.lng);
      return `
      <div class="money-row">
        <div class="money-ic inc">📍</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:500;color:var(--white)">${placeName ? esc(placeName) : 'Stop ' + (i + 1)} · ${s.minutes} min</div>
          <div style="font-size:10px;color:var(--text3)">${new Date(s.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(s.leftAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.flyTo(${s.lat},${s.lng})">View</button>
        <button class="btn btn-glass btn-xs" onclick="LiveMap.openStreetView(${s.lat},${s.lng})">👁</button>
      </div>`;
    }).join('');
    stops.forEach(s => {
      const icon = L.divIcon({ html: `<div style="width:16px;height:16px;border-radius:50%;background:#ffd166;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`, className: '', iconSize: [16, 16] });
      const m = L.marker([s.lat, s.lng], { icon }).addTo(st.map).bindPopup(`Stopped ${s.minutes} min`);
      st.routeStopMarkers.push(m);
    });
  }
  function _fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function _setPlaybackButtons(playing) {
    const playBtn = document.getElementById('lmPlaybackPlayBtn');
    const pauseBtn = document.getElementById('lmPlaybackPauseBtn');
    if (playBtn) playBtn.style.display = playing ? 'none' : '';
    if (pauseBtn) pauseBtn.style.display = playing ? '' : 'none';
    if (playBtn) playBtn.textContent = (st.playbackIdx > 0 && !playing) ? '▶ Resume' : '▶ Play Journey';
  }
  function _tickPlayback() {
    const points = st.routeData?.points;
    if (!points || !st.playbackMarker) return;
    st.playbackIdx++;
    if (st.playbackIdx >= points.length) {
      clearInterval(st.playbackTimer); st.playbackTimer = null;
      _setPlaybackButtons(false);
      const playBtn = document.getElementById('lmPlaybackPlayBtn');
      if (playBtn) playBtn.textContent = '▶ Replay Journey';
      st.playbackIdx = 0;
      return;
    }
    const p = points[st.playbackIdx];
    st.playbackMarker.setLatLng([p.lat, p.lng]);

    // Live progress: elapsed time, distance so far, instantaneous speed
    let distM = 0;
    for (let i = 1; i <= st.playbackIdx; i++) distM += haversine(points[i - 1], points[i]) * 1000;
    const elapsedSec = (new Date(p.created_at) - new Date(points[0].created_at)) / 1000;
    const prev = points[st.playbackIdx - 1];
    const dtSec = Math.max(1, (new Date(p.created_at) - new Date(prev.created_at)) / 1000);
    const segM = haversine(prev, p) * 1000;
    const kmh = (segM / dtSec) * 3.6;

    const bar = document.getElementById('lmPlaybackBar');
    if (bar) bar.style.width = Math.round((st.playbackIdx / (points.length - 1)) * 100) + '%';
    const t = document.getElementById('lmPlaybackTime'); if (t) t.textContent = _fmtClock(elapsedSec);
    const d = document.getElementById('lmPlaybackDist'); if (d) d.textContent = (distM / 1000).toFixed(2) + ' km';
    const s = document.getElementById('lmPlaybackSpeedNow'); if (s) s.textContent = Math.round(kmh) + ' km/h';
  }
  function _playbackIntervalMs() {
    const points = st.routeData?.points || [];
    const base = Math.max(20, Math.floor(4000 / Math.max(1, points.length)));
    return Math.max(15, Math.round(base / (st.playbackSpeed || 1)));
  }
  function playbackRoute() {
    const points = st.routeData?.points;
    if (!points || points.length < 2) { toast('Nothing to play back'); return; }
    if (st.playbackTimer) { clearInterval(st.playbackTimer); st.playbackTimer = null; }
    // Resume from where we paused, unless we already finished (idx reset to 0)
    if (st.playbackIdx === 0 || !st.playbackMarker) {
      if (st.playbackMarker) { st.map.removeLayer(st.playbackMarker); }
      const icon = L.divIcon({ html: `<div style="width:22px;height:22px;border-radius:50%;background:var(--accent);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.5)"></div>`, className: '', iconSize: [22, 22] });
      st.playbackMarker = L.marker([points[0].lat, points[0].lng], { icon, zIndexOffset: 600 }).addTo(st.map);
      st.playbackIdx = 0;
    }
    const prog = document.getElementById('lmPlaybackProgress'); if (prog) prog.style.display = 'block';
    _setPlaybackButtons(true);
    st.playbackTimer = setInterval(_tickPlayback, _playbackIntervalMs());
  }
  function pausePlayback() {
    if (st.playbackTimer) { clearInterval(st.playbackTimer); st.playbackTimer = null; }
    _setPlaybackButtons(false);
  }
  function setPlaybackSpeed(v) {
    st.playbackSpeed = parseFloat(v) || 1;
    if (st.playbackTimer) { // live-apply while playing
      clearInterval(st.playbackTimer);
      st.playbackTimer = setInterval(_tickPlayback, _playbackIntervalMs());
    }
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
  const offlineEl = document.getElementById('lmOfflineBanner');
  if (offlineEl) offlineEl.style.display = navigator.onLine ? 'none' : 'flex'; // reflect current state immediately, don't wait for an event
}
  function onLeavePage() {
    st.pageActive = false;
    _stopPolling();
    // GPS watch (startTracking) keeps running in background so tracking is
    // continuous even off the map page (per requirement: "location updates
    // continuously"). But UI-only timers tied to this page's DOM should stop —
    // leaving them running was a memory/battery leak across page navigations.
    if (st.playbackTimer) { clearInterval(st.playbackTimer); st.playbackTimer = null; }
    if (_autoStyleTimer) { clearInterval(_autoStyleTimer); _autoStyleTimer = null; }
    // Note: the pause-sharing timer (_pauseTimer) is intentionally left running —
    // it's a user-initiated commitment ("resume in 15m") that should honor
    // itself regardless of which page the user is currently on.
  }

  // One-time listeners for the whole module lifetime — NOT inside onEnterPage,
  // which used to re-register these on every visit to the map page and stack
  // duplicate handlers (each stacked 'online' handler fired an extra _pollOnce,
  // compounding network calls the longer the app was used).
  window.addEventListener('online', () => {
    const el = document.getElementById('lmOfflineBanner');
    if (el) el.style.display = 'none';
    if (st.pageActive) { _pollOnce(); _teardownLmRealtime(); _setupLmRealtime(); }
  });
  window.addEventListener('offline', () => {
    const el = document.getElementById('lmOfflineBanner');
    if (el && st.pageActive) el.style.display = 'flex';
  });

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
    openRouteHistory, loadRouteDay, playbackRoute, pausePlayback, setPlaybackSpeed, switchRouteRole,
    getWeather,
    pauseSharing, resumeSharing, togglePrivacyPanel,
    toggleApproxLocation, toggleInvisibleMode, emergencyShare, dismissEmergencyBanner,
    toggleNavPanel, navigateToPartner, navigateToPoint, selectNavRoute, searchAlongRoute,
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