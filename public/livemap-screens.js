/* ══════════════════════════════════════════════════════════════════
   LMScreens — screen-stack controller for the Live Map page.
   Screens: map (root) · track · partner · places · more · alerts ·
            privacy · search.   Every screen has a back button; the
   hardware/gesture Back (Capacitor) walks the same stack, and when the
   stack is empty it falls through to the app's own goBack().

   Load AFTER /livemap.js (it needs window.LiveMap) and after the page
   markup. It never touches GPS, Supabase or routing — all of that stays
   in LiveMap; this file is navigation + presentation + a few small
   options (follow / route line / place labels / weather / export).
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const LM = () => window.LiveMap;
  const ST = () => (window.LiveMap && window.LiveMap._debug) || {};
  const APP = () => window.S || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = m => { try { window.toast ? window.toast(m) : console.log(m); } catch (_) {} };
  const hav = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, dL = (b.lat - a.lat) * Math.PI / 180, dG = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dL / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dG / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const localDate = (d) => { d = d || new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const ago = (ts) => {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  };
  const fmtDur = (min) => { min = Math.max(0, Math.round(min || 0)); const h = Math.floor(min / 60), m = min % 60; return h ? (h + 'h ' + String(m).padStart(2, '0') + 'm') : (m + 'm'); };
  const fmtDist = (km) => km == null ? '—' : (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km');
  const clock = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  const partnerRole = () => APP().role === 'user1' ? 'user2' : 'user1';

  /* ── persisted UI options (device-level, not synced) ─────────────── */
  const UI_KEY = 'lms_ui_v1';
  let ui = { trail: false, places: true, weather: false };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (_) {}
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ trail: ui.trail, places: ui.places, weather: ui.weather })); } catch (_) {} };

  /* ══════════════════════════════════════════════════════════════════
     NAVIGATION STACK
     ══════════════════════════════════════════════════════════════════ */
  const stack = ['map'];
  let quiet = false;
  const cur = () => stack[stack.length - 1];
  const screenEl = n => document.querySelector('#lmScreens .lms-screen[data-screen="' + n + '"]');

  function placeMap(where) {
    const wrap = $('lmsMapWrap'); if (!wrap) return;
    if ($('lm2CallDock')) return; // a call is docked beside the map — leave it alone
    const slot = $(where === 'track' ? 'lmsTrackMapSlot' : 'lmsMapSlot');
    if (slot && wrap.parentNode !== slot) slot.appendChild(wrap);
    invalidate();
  }
  function invalidate() {
    const m = ST().map;
    if (m && m.invalidateSize) { requestAnimationFrame(() => requestAnimationFrame(() => { try { m.invalidateSize(); } catch (_) {} })); }
  }

  function show(name, dir) {
    const root = $('lmScreens'); const target = screenEl(name);
    if (!root || !target) return;
    root.querySelectorAll('.lms-screen').forEach(s => s.classList.remove('active', 'lms-push', 'lms-pop'));
    target.classList.add('active');
    if (dir === 'push') target.classList.add('lms-push'); else if (dir === 'pop') target.classList.add('lms-pop');
    root.dataset.screen = name;
    placeMap(name === 'track' ? 'track' : 'map');
    closeSheet(); toggleStylePop(false);
    if (dir === 'push') { const b = target.querySelector('.lms-body'); if (b) b.scrollTop = 0; }
    onShown(name);
  }

  function open(name, opts) {
    opts = opts || {};
    if (!screenEl(name)) return;
    if (cur() !== name) { stack.push(name); show(name, 'push'); }
    enter(name, opts);
  }

  function leave(name) {
    if (name === 'search') { const r = $('lmGmSearchResults'); if (r) r.classList.remove('show'); const i = $('lmGmSearchInput'); if (i) i.blur(); }
    if (name === 'privacy') { const p = $('lmPrivacyPanel'); if (p) p.style.display = 'none'; }
    if (name === 'track') {
      try { LM().clearRouteOverlay(); } catch (_) {}
      const rs = $('lmRouteSettingsPanel'); if (rs) rs.style.display = 'none';
      range = 'today'; syncRangeButtons();
    }
  }

  function pop() {
    if (stack.length <= 1) return false;
    const leaving = stack.pop();
    leave(leaving);
    show(cur(), 'pop');
    if (cur() === 'map') { try { LM().fitBoth(); } catch (_) {} }
    return true;
  }

  /** Closes the single topmost transient thing. Returns true if it closed something. */
  function closeTop() {
    const sh = $('lmsSheet'); if (sh && sh.classList.contains('open')) { closeSheet(); return true; }
    const sp = $('lmsStylePop'); if (sp && sp.classList.contains('open')) { toggleStylePop(false); return true; }
    if (cur() !== 'map') return pop();
    return false;
  }

  /** Header back arrow: close one layer inside Live Map, else go to the previous app page. */
  function back() {
    try { if (LM() && LM().closeTopOverlayIfOpen && LM().closeTopOverlayIfOpen()) return; } catch (_) {}
    if (typeof window.goBack === 'function') window.goBack();
    else if (typeof window.goto === 'function') window.goto('dashboard');
  }

  /** Called by LiveMap whenever it needs the map in view (locate, search pick, directions…). */
  function ensureMap() {
    if (cur() === 'map') return;
    const left = stack.splice(1); left.reverse().forEach(leave);
    show('map', 'pop');
  }
  /** Used by LiveMap.openRouteHistory so it never re-enters this controller. */
  function showTrackQuiet() {
    if (cur() !== 'track') { stack.push('track'); quiet = true; show('track', 'push'); quiet = false; }
  }

  /* ── per-screen entry work ──────────────────────────────────────── */
  function onShown(name) {
    refresh();
    if (name === 'map') { syncOpts(); }
  }
  function enter(name, opts) {
    if (quiet) return;
    if (name === 'track') {
      const role = opts.role === 'partner' ? partnerRole() : APP().role;
      range = 'today'; syncRangeButtons();
      setBlocksForRange();
      try { LM().openRouteHistory(role); } catch (e) { console.warn(e); }
    } else if (name === 'places') {
      setPlacesTab(opts.tab || 'mine');
    } else if (name === 'more') {
      syncOpts();
    } else if (name === 'alerts') {
      syncAlerts(); loadAlertFeed();
    } else if (name === 'privacy') {
      const p = $('lmPrivacyPanel');
      if (p) { p.style.display = 'none'; try { LM().togglePrivacyPanel(); } catch (_) {} }
    } else if (name === 'search') {
      setTimeout(() => { const i = $('lmGmSearchInput'); if (i) { i.focus(); try { LM().gmSearchFocus(); } catch (_) {} } }, 140);
    } else if (name === 'partner') {
      refresh(true);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     LIVE REFRESH (header pill, avatars, partner screen, share toggle)
     ══════════════════════════════════════════════════════════════════ */
  function activityLabel(speedMps) {
    const k = (speedMps || 0) * 3.6;
    if (k < 1) return 'Stationary';
    if (k < 7) return 'Walking';
    if (k < 15) return 'Running';
    if (k < 35) return 'Cycling';
    return 'Driving';
  }
  function paintAvatars() {
    const S = APP();
    document.querySelectorAll('#lmScreens [data-av]').forEach(el => {
      const mine = el.dataset.av === 'me';
      const src = mine ? S.myAvatar : S.partnerAvatar;
      const name = (mine ? S.myName : S.partnerName) || (mine ? 'You' : 'Partner');
      const key = (src || '') + '|' + name;
      if (el.__k === key) return; el.__k = key;
      if (src) el.innerHTML = '<img alt="" src="' + esc(src) + '">'; else el.textContent = (name[0] || '?').toUpperCase();
    });
  }
  function nearestSaved(lat, lng, r) {
    let best = null, bd = Infinity;
    (APP().placesList || []).forEach(p => { const d = hav({ lat, lng }, p) * 1000; if (d <= (r || 150) && d < bd) { bd = d; best = p; } });
    return best;
  }
  const geoCache = new Map(); let geoBusy = false, geoLast = 0;
  function reverseGeo(lat, lng, cb) {
    const key = lat.toFixed(3) + ',' + lng.toFixed(3);
    if (geoCache.has(key)) return geoCache.get(key);
    if (geoBusy || Date.now() - geoLast < 15000) return null;
    geoBusy = true; geoLast = Date.now();
    fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=' + lat + '&lon=' + lng, { headers: { 'Accept': 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j) return;
        const a = j.address || {};
        const main = a.neighbourhood || a.suburb || a.road || a.village || a.town || a.city_district || a.city || (j.name || '');
        const sub = [a.suburb && a.suburb !== main ? a.suburb : null, a.city || a.town || a.village || a.county, a.state].filter(Boolean).join(', ');
        geoCache.set(key, { main: main || 'Unknown area', sub: sub || (j.display_name || '').split(',').slice(0, 3).join(',') });
        if (cb) cb();
      })
      .catch(() => {})
      .finally(() => { geoBusy = false; });
    return null;
  }

  function refresh(force) {
    const S = APP(), s = ST();
    if (!$('lmScreens')) return;
    paintAvatars();
    const pn = S.partnerName || 'Partner';
    document.querySelectorAll('#lmScreens .lms-ptname').forEach(e => { e.textContent = pn; });
    const pName = $('lmsPName'); if (pName) pName.textContent = pn;

    // header pill + share toggle
    const pill = $('lmsLivePill'), txt = $('lmsLiveTxt');
    if (pill && txt) {
      const paused = !s.tracking, invis = !!s.invisible;
      pill.classList.toggle('paused', paused || invis);
      txt.textContent = paused ? 'Paused' : (invis ? 'Invisible' : 'Live');
    }
    const sh = $('lmsShareToggle'); if (sh) sh.checked = !!s.tracking;

    // partner screen
    const pt = s.ptLast;
    const stEl = $('lmsPState'), seen = $('lmsPSeen');
    if (stEl && seen) {
      let label = 'No location yet', cls = 'off', seenTxt = 'Hasn\u2019t shared a location yet';
      if (!S.paired) { label = 'Not paired yet'; seenTxt = '—'; }
      else if (pt && pt.status === 'paused') { label = 'Sharing paused'; cls = 'pause'; seenTxt = 'Last seen: ' + ago(pt.updatedAt); }
      else if (pt && pt.online) { label = 'Online'; cls = ''; seenTxt = 'Last seen: Just now'; }
      else if (pt) { label = 'Offline'; seenTxt = 'Last seen: ' + ago(pt.updatedAt); }
      stEl.textContent = label; stEl.className = 'lms-profile-st' + (cls ? ' ' + cls : ''); seen.textContent = seenTxt;
    }
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('lmsPMove', pt && pt.online ? (pt.moving ? activityLabel(pt.speed) : 'Stationary') : '—');
    set('lmsPUpd', pt ? ago(pt.updatedAt) : '—');
    const d = hav(S.myLoc, S.ptLoc);
    set('lmsPDist', fmtDist(d));
    set('lmsPEta', d == null ? '—' : Math.max(1, Math.round(d / 40 * 60)) + ' min');

    // "Near …" card
    const near = $('lmsPNear'), nearSub = $('lmsPNearSub');
    if (near && nearSub) {
      if (!S.ptLoc || S.ptLoc.lat == null) { near.textContent = 'Location not shared yet'; nearSub.textContent = 'Ask ' + pn + ' to turn on sharing'; }
      else {
        const sp = nearestSaved(S.ptLoc.lat, S.ptLoc.lng, 150);
        if (sp) { near.textContent = 'At ' + (sp.name || sp.cat); nearSub.textContent = sp.address || 'Saved place'; }
        else {
          const g = reverseGeo(S.ptLoc.lat, S.ptLoc.lng, () => refresh());
          if (g) { near.textContent = 'Near ' + g.main; nearSub.textContent = g.sub || 'Tap to view on the map'; }
          else { near.textContent = 'Shared location'; nearSub.textContent = S.ptLoc.lat.toFixed(4) + ', ' + S.ptLoc.lng.toFixed(4); }
        }
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     PARTNER SCREEN ACTIONS
     ══════════════════════════════════════════════════════════════════ */
  function viewPartnerLive() {
    ensureMap();
    setTimeout(() => { try { LM().locatePartner(); } catch (_) {} }, 60);
  }
  function onShareToggle(on) {
    const s = ST();
    if (!!s.tracking !== !!on) { try { LM().toggleTracking(); } catch (_) {} }
    setTimeout(refresh, 50);
  }

  /* ══════════════════════════════════════════════════════════════════
     PLACES SCREEN
     ══════════════════════════════════════════════════════════════════ */
  let placesTab = 'mine';
  function setPlacesTab(tab) {
    placesTab = tab;
    document.querySelectorAll('#lmsPlacesTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const map = { mine: 'myPlacesList', partner: 'ptPlacesList', fav: 'lmFavoritesPanel' };
    Object.keys(map).forEach(k => { const e = $(map[k]); if (e) e.style.display = (k === tab) ? (k === 'fav' ? 'block' : 'flex') : 'none'; });
    const add = $('lmsAddPlaceBtn'); if (add) add.style.display = tab === 'mine' ? '' : 'none';
    try { LM().renderPlaces(); if (tab === 'fav') LM().renderFavorites(); } catch (_) {}
  }

  function placeMenu(id) {
    const S = APP(); const p = (S.placesList || []).find(x => x.id === id); if (!p) return;
    const mine = p.owner === S.role;
    openSheet(`
      <div class="lms-sheet-t">${esc(p.name || p.cat)}</div>
      <div class="lms-sheet-s">${esc(p.address || (p.cat + ' · ' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4)))}</div>
      <button type="button" class="lms-row" onclick="LMScreens.placeAction('view','${esc(id)}')"><span class="lms-row-ico"><svg class="lmi"><use href="#lmi-map"/></svg></span><span class="lms-row-t">View on map</span></button>
      <button type="button" class="lms-row" onclick="LMScreens.placeAction('go','${esc(id)}')"><span class="lms-row-ico"><svg class="lmi"><use href="#lmi-nav"/></svg></span><span class="lms-row-t">Get directions</span></button>
      <button type="button" class="lms-row" onclick="LMScreens.placeAction('street','${esc(id)}')"><span class="lms-row-ico"><svg class="lmi"><use href="#lmi-eye"/></svg></span><span class="lms-row-t">Street view</span></button>
      ${mine ? `<button type="button" class="lms-row danger" onclick="LMScreens.placeAction('del','${esc(id)}')"><span class="lms-row-ico"><svg class="lmi"><use href="#lmi-trash"/></svg></span><span class="lms-row-t">Delete place</span></button>` : ''}`);
  }
  function placeAction(kind, id) {
    const p = (APP().placesList || []).find(x => x.id === id); if (!p) { closeSheet(); return; }
    if (kind === 'view') { closeSheet(); LM().flyTo(p.lat, p.lng); }
    else if (kind === 'go') { closeSheet(); ensureMap(); setTimeout(() => LM().navigateToPoint(p.lat, p.lng, p.name || p.cat), 60); }
    else if (kind === 'street') { closeSheet(); LM().openStreetView(p.lat, p.lng); }
    else if (kind === 'del') {
      confirmSheet('Delete this place?', (p.name || p.cat) + ' will be removed for both of you.', 'Delete', () => { LM().deletePlace(id); say('Place deleted'); });
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     TRACK SCREEN
     ══════════════════════════════════════════════════════════════════ */
  let range = 'today';
  function syncRangeButtons() {
    document.querySelectorAll('#lmsTrackRange button').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  }
  function setBlocksForRange() {
    const today = range === 'today';
    const mb = $('lmsTrackMapBlock'); if (mb) mb.style.display = today ? '' : 'none';
    ['lmsTimelineTitle', 'lmDailyTimeline', 'lmJourneySummary'].forEach(id => { const e = $(id); if (e) e.style.display = today ? '' : 'none'; });
    const dp = $('lmRouteDatePicker'); if (dp) dp.style.display = today ? '' : 'none';
    const rl = $('lmsRangeList'); if (rl) { rl.style.display = today ? 'none' : ''; if (today) rl.innerHTML = ''; }
  }
  function setTrackRange(r) {
    range = r; syncRangeButtons(); setBlocksForRange();
    if (r === 'today') {
      const s = ST();
      try { LM().loadRouteDay(s.routeSelectedDate || localDate()); } catch (_) {}
    } else {
      try { LM().clearRouteOverlay(); } catch (_) {}
      loadRange(r);
    }
  }
  function statsHtml(o) {
    return `<div class="lms-trackstats">
      <div class="lms-ts"><span>Total Distance</span><b>${o.dist}<small>km</small></b></div>
      <div class="lms-ts"><span>Total Time</span><b>${o.time}</b></div>
      <div class="lms-ts"><span>Places Visited</span><b id="lmsPlacesVisited">${o.places}</b></div>
      <div class="lms-ts"><span>Avg Speed</span><b>${o.avg}<small>km/h</small></b></div>
    </div>`;
  }
  function routeOffNotice(isMine) {
    const s = ST();
    const off = isMine && s.routeHistorySettings && s.routeHistorySettings.enabled === false;
    if (off) return `<div class="lms-card" style="text-align:center"><div class="lms-row-t" style="margin-bottom:6px">Route history is off</div><div class="lms-row-s" style="margin-bottom:12px">Turn it on to see where you go each day — only you can see and control your own recording.</div><button type="button" class="lms-cta lms-cta--sm" onclick="LMScreens.toggleTrackSettings()">Turn on in settings</button></div>`;
    return `<div class="lms-empty">No movement recorded for this day${isMine ? '' : ' — ' + esc(APP().partnerName || 'your partner') + ' may have route history turned off'}</div>`;
  }
  /** Called by LiveMap.loadRouteDay once a day's data arrives. */
  function renderTrackDay(data) {
    if (range !== 'today') { range = 'today'; syncRangeButtons(); setBlocksForRange(); }
    const body = $('lmRouteBody'); if (!body) return;
    const s = ST(); const isMine = (s.routeViewRole || APP().role) === APP().role;
    const mb = $('lmsTrackMapBlock');
    if (!data || !data.points || !data.points.length) {
      body.innerHTML = routeOffNotice(isMine);
      if (mb) mb.style.display = 'none';
      return;
    }
    if (mb) mb.style.display = '';
    const ext = LM().computeExtendedStats(data.points, data.stats.durationMin);
    body.innerHTML = statsHtml({
      dist: (+data.stats.distanceKm).toFixed(1), time: fmtDur(data.stats.durationMin),
      places: (data.stops || []).length, avg: Math.round(ext.avgKmh || 0)
    });
    const t0 = $('lmsT0'), t1 = $('lmsT1');
    if (t0) t0.textContent = clock(data.points[0].created_at);
    if (t1) t1.textContent = clock(data.points[data.points.length - 1].created_at);
    invalidate();
  }
  /** Called when the daily timeline loads — gives the real "places visited" count. */
  function onTimeline(events) {
    const e = $('lmsPlacesVisited');
    if (e && events && events.length) e.textContent = events.length;
  }

  async function loadRange(r) {
    const S = APP(), s = ST();
    const role = s.routeViewRole || S.role; const days = r === 'week' ? 7 : 30;
    const body = $('lmRouteBody'), list = $('lmsRangeList');
    if (body) body.innerHTML = '<div class="lms-empty">Loading…</div>';
    if (list) list.innerHTML = '';
    const cutoff = localDate(new Date(Date.now() - (days - 1) * 86400000));
    const dates = (s.routeDates || []).filter(d => d >= cutoff).sort().reverse();
    if (!dates.length) { if (body) body.innerHTML = routeOffNotice(role === S.role); return; }
    const get = (p) => window.api('GET', p).catch(() => null);
    const [reports, timelines] = await Promise.all([
      Promise.all(dates.map(d => get('/api/tracking/' + S.coupleId + '/' + role + '/daily-report/' + d))),
      Promise.all(dates.map(d => get('/api/tracking/' + S.coupleId + '/' + role + '/timeline/' + d)))
    ]);
    if (range !== r) return; // user switched tab while loading
    let dist = 0, mins = 0, places = 0, wsum = 0, wdur = 0;
    const rows = [];
    dates.forEach((d, i) => {
      const rep = reports[i]; const ev = (timelines[i] && timelines[i].events) || [];
      places += ev.length;
      if (rep) {
        dist += +rep.distance_km || 0; mins += +rep.duration_min || 0;
        wsum += (+rep.avg_speed_kmh || 0) * (+rep.duration_min || 0); wdur += (+rep.duration_min || 0);
      }
      rows.push({ d, km: rep ? +rep.distance_km || 0 : 0, min: rep ? +rep.duration_min || 0 : 0, n: ev.length });
    });
    const avg = wdur ? Math.round(wsum / wdur) : (mins ? Math.round(dist / (mins / 60)) : 0);
    if (body) body.innerHTML = statsHtml({ dist: dist.toFixed(1), time: fmtDur(mins), places, avg });
    if (list) {
      const label = d => d === localDate() ? 'Today' : d === localDate(new Date(Date.now() - 86400000)) ? 'Yesterday' : new Date(d + 'T00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
      list.innerHTML = '<div class="lms-sec-t" style="margin-bottom:2px">Days</div>' + rows.map(r2 => `
        <div class="lms-range-row" onclick="LMScreens.openDay('${r2.d}')">
          <span class="lms-row-txt"><b>${label(r2.d)}</b><span>${r2.n} place${r2.n === 1 ? '' : 's'} visited</span></span>
          <span class="lms-range-r">${r2.km.toFixed(1)} km<br><span>${fmtDur(r2.min)}</span></span>
        </div>`).join('');
    }
  }
  function openDay(d) { range = 'today'; syncRangeButtons(); setBlocksForRange(); try { LM().loadRouteDay(d); } catch (_) {} }
  function toggleTrackSettings() { try { LM().toggleRouteSettingsPanel(); } catch (_) {} }

  /* ── export / clear ─────────────────────────────────────────────── */
  async function exportRoute() {
    const S = APP(), s = ST();
    let data = s.routeData;
    if (!data || !data.points || !data.points.length) {
      try { data = await window.api('GET', '/api/route/' + S.coupleId + '/' + S.role + '/' + localDate()); } catch (_) { data = null; }
    }
    if (!data || !data.points || !data.points.length) { say('No route recorded to export yet'); return; }
    const who = (s.routeViewRole && s.routeViewRole !== S.role) ? (S.partnerName || 'partner') : (S.myName || 'me');
    const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Twin Hearts" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>' + esc(who + ' ' + data.date) + '</name><trkseg>\n' +
      data.points.map(p => '<trkpt lat="' + p.lat + '" lon="' + p.lng + '">' + (p.altitude != null ? '<ele>' + p.altitude + '</ele>' : '') + '<time>' + new Date(p.created_at).toISOString() + '</time></trkpt>').join('\n') +
      '\n</trkseg></trk></gpx>';
    const name = 'route-' + data.date + '.gpx';
    try {
      const file = new File([gpx], name, { type: 'application/gpx+xml' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Route ' + data.date }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    say('Route exported 📥');
  }
  function clearHistory() {
    confirmSheet('Clear your route history?', 'All of your recorded locations will be deleted. This can\u2019t be undone.', 'Delete', () => { LM().deleteMyRouteHistory(true); });
  }

  /* ══════════════════════════════════════════════════════════════════
     MORE OPTIONS
     ══════════════════════════════════════════════════════════════════ */
  function toggleStylePop(force) {
    const p = $('lmsStylePop'); if (!p) return;
    p.classList.toggle('open', typeof force === 'boolean' ? force : !p.classList.contains('open'));
  }

  function syncOpts() {
    const s = ST(); const set = (id, v) => { const e = $(id); if (e) e.checked = !!v; };
    set('lmsOpt3d', s.cameraMode && s.cameraMode !== 'top');
    set('lmsOptFollow', followOn);
    set('lmsOptTrail', ui.trail);
    set('lmsOptPlaces', ui.places);
    set('lmsOptWeather', ui.weather);
    const lab = $('lmCameraModeLabel'); if (lab && !s.cameraMode) lab.textContent = 'Top';
    refresh();
  }

  function opt(key, on) {
    if (key === '3d') {
      const m = ST().map;
      if (!m || typeof m.setCameraMode !== 'function') { say('3D camera needs a browser that supports WebGL'); const e = $('lmsOpt3d'); if (e) e.checked = false; return; }
      LM().setCameraMode(on ? 'tilt' : 'top');
    } else if (key === 'follow') { on ? startFollow() : stopFollow(); }
    else if (key === 'trail') { ui.trail = on; saveUi(); on ? startTrail() : stopTrail(); }
    else if (key === 'places') { ui.places = on; saveUi(); try { LM().renderPlaces(); } catch (_) {} }
    else if (key === 'weather') { ui.weather = on; saveUi(); applyWeather(); }
  }
  const placesVisible = () => ui.places !== false;

  function applyWeather() {
    const p = $('lmWeatherPanel'); if (!p) return;
    if (ui.weather) { try { LM().getWeather(true); } catch (_) {} } else { p.style.display = 'none'; }
  }

  /* auto-follow partner */
  let followOn = false, followTimer = null;
  function startFollow() {
    const S = APP(), m = ST().map;
    if (!S.ptLoc || S.ptLoc.lat == null) { say('Partner hasn\u2019t shared their location yet'); followOn = false; const e = $('lmsOptFollow'); if (e) e.checked = false; return; }
    followOn = true; stopFollowTimer();
    if (m) { m.on('dragstart', userMoved); }
    followTimer = setInterval(() => {
      const loc = APP().ptLoc, mm = ST().map;
      if (!followOn || !mm || !loc || loc.lat == null) return;
      if (!ST().pageActive || cur() !== 'map') return;
      try { mm.panTo([loc.lat, loc.lng], { animate: true, duration: 0.8, easeLinearity: 0.4 }); } catch (_) {}
    }, 1500);
    say('Following ' + (S.partnerName || 'partner') + ' 💜');
  }
  function stopFollowTimer() { if (followTimer) { clearInterval(followTimer); followTimer = null; } }
  function stopFollow() {
    followOn = false; stopFollowTimer();
    const m = ST().map; if (m && m.off) { try { m.off('dragstart', userMoved); } catch (_) {} }
    const e = $('lmsOptFollow'); if (e) e.checked = false;
  }
  function userMoved() { if (followOn) { stopFollow(); say('Auto-follow off'); } }

  /* live route line (recent breadcrumb trail of both people) */
  let trailTimer = null, trailLayers = [];
  const LL = () => window.MapLibreLeafletShim || window.L;
  async function drawTrail() {
    const S = APP(), m = ST().map, L = LL();
    if (!ui.trail || !m || !L || !S.coupleId || !ST().pageActive) return;
    try {
      const roles = [[S.role, '#E50914'], [partnerRole(), '#ff9a9a']];
      const res = await Promise.all(roles.map(r => window.api('GET', '/api/location/' + S.coupleId + '/trail/' + r[0]).catch(() => [])));
      trailLayers.forEach(l => { try { m.removeLayer(l); } catch (_) {} }); trailLayers = [];
      res.forEach((pts, i) => {
        if (!Array.isArray(pts) || pts.length < 2) return;
        const line = L.polyline(pts.map(p => [p.lat, p.lng]), { color: roles[i][1], weight: 4, opacity: .85, lineCap: 'round', lineJoin: 'round' }).addTo(m);
        trailLayers.push(line);
      });
    } catch (_) {}
  }
  function startTrail() { stopTrailTimer(); drawTrail(); trailTimer = setInterval(drawTrail, 15000); }
  function stopTrailTimer() { if (trailTimer) { clearInterval(trailTimer); trailTimer = null; } }
  function stopTrail() {
    stopTrailTimer(); const m = ST().map;
    trailLayers.forEach(l => { try { m && m.removeLayer(l); } catch (_) {} }); trailLayers = [];
  }

  /* ══════════════════════════════════════════════════════════════════
     LOCATION ALERTS
     ══════════════════════════════════════════════════════════════════ */
  function alertOn(k) { const a = APP().lmAlerts; return !a || a[k] !== false; }
  function setAlert(k, v) {
    const S = APP(); S.lmAlerts = S.lmAlerts || {}; S.lmAlerts[k] = !!v;
    try { window.scheduleSave && window.scheduleSave(); } catch (_) {}
  }
  function syncAlerts() { document.querySelectorAll('#lmsAlerts [data-alert]').forEach(i => { i.checked = alertOn(i.dataset.alert); }); }
  async function loadAlertFeed() {
    const box = $('lmsAlertFeed'); if (!box) return; const S = APP();
    if (!S.coupleId) { box.innerHTML = '<div class="lms-empty">Pair with your partner to see activity</div>'; return; }
    try {
      const ev = await window.api('GET', '/api/tracking/' + S.coupleId + '/' + partnerRole() + '/geofence-events');
      if (!Array.isArray(ev) || !ev.length) { box.innerHTML = '<div class="lms-empty">No place activity yet — it appears here when ' + esc(S.partnerName || 'your partner') + ' arrives at or leaves a saved place.</div>'; return; }
      box.innerHTML = ev.slice(0, 12).map(e => {
        const enter = e.event_type === 'enter';
        return `<div class="lms-feed-i"><span class="lms-row-ico ${enter ? 'lms-ico--green' : 'lms-ico--amber'}"><svg class="lmi"><use href="#${enter ? 'lmi-pin' : 'lmi-logout'}"/></svg></span><span>${enter ? 'Arrived at' : 'Left'} <b>${esc(e.label || 'a place')}</b></span><time>${esc(ago(e.occurred_at))}</time></div>`;
      }).join('');
    } catch (_) { box.innerHTML = '<div class="lms-empty">Couldn\u2019t load activity right now</div>'; }
  }

  /* ══════════════════════════════════════════════════════════════════
     SEARCH SCREEN
     ══════════════════════════════════════════════════════════════════ */
  function searchChip(q) {
    const i = $('lmGmSearchInput'); if (!i) return;
    i.value = q; try { LM().gmSearchInput(q); } catch (_) {} i.focus();
  }

  /* ══════════════════════════════════════════════════════════════════
     BOTTOM SHEET
     ══════════════════════════════════════════════════════════════════ */
  function openSheet(html) {
    const sh = $('lmsSheet'), bg = $('lmsSheetBg'); if (!sh || !bg) return;
    sh.innerHTML = html; sh.classList.add('open'); bg.classList.add('open');
  }
  function closeSheet() {
    const sh = $('lmsSheet'), bg = $('lmsSheetBg');
    if (sh) sh.classList.remove('open'); if (bg) bg.classList.remove('open');
  }
  let confirmCb = null;
  function confirmSheet(title, text, okLabel, cb) {
    confirmCb = cb;
    openSheet(`<div class="lms-sheet-t">${esc(title)}</div><div class="lms-sheet-s">${esc(text)}</div>
      <div class="lms-sheet-btns"><button type="button" onclick="LMScreens.closeSheet()">Cancel</button><button type="button" class="primary" onclick="LMScreens.confirmOk()">${esc(okLabel || 'OK')}</button></div>`);
  }
  function confirmOk() { const cb = confirmCb; confirmCb = null; closeSheet(); if (cb) cb(); }

  /* ══════════════════════════════════════════════════════════════════
     PAGE LIFECYCLE (called from LiveMap.onEnterPage / onLeavePage)
     ══════════════════════════════════════════════════════════════════ */
  let ticker = null;
  function onEnter() {
    // entering the Map tab always starts at the root screen, like a tab bar
    if (cur() !== 'map' || stack.length > 1) { const left = stack.splice(1); left.reverse().forEach(leave); }
    show('map');
    syncOpts(); applyWeather();
    if (ui.trail) startTrail();
    if (!ticker) ticker = setInterval(() => { if (ST().pageActive) refresh(); }, 20000);
  }
  function onLeave() {
    stopTrailTimer(); stopFollow();
    if (ticker) { clearInterval(ticker); ticker = null; }
    closeSheet(); toggleStylePop(false);
  }

  /* tap outside the style popover closes it */
  document.addEventListener('click', (e) => {
    const p = $('lmsStylePop'); if (!p || !p.classList.contains('open')) return;
    if (p.contains(e.target) || (e.target.closest && e.target.closest('#lmsLayersBtn'))) return;
    p.classList.remove('open');
  }, true);

  /* camera label doubles as a "tap to switch 3D / eye-level" control */
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest('#lmCameraModeLabel'); if (!t) return;
    try { LM().cycleCameraMode(); } catch (_) {}
    setTimeout(syncOpts, 60);
  });

  window.LMScreens = {
    open, show, back, closeTop, ensureMap, showTrackQuiet, refresh,
    onEnter, onLeave, renderTrackDay, onTimeline,
    setTrackRange, openDay, toggleTrackSettings, exportRoute, clearHistory,
    setPlacesTab, placeMenu, placeAction,
    viewPartnerLive, onShareToggle, setAlert, alertOn, opt, placesVisible,
    toggleStylePop, searchChip, closeSheet, confirmOk, openSheet,
    current: cur
  };
})();
