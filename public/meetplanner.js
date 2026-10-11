/* ══════════════════════════════════════════════════════════════
   MEET PLANNER 2.0 — client logic
   Flow: Home → Plan New → Find Places → Your Stops → Itinerary
         → Route map · Saved Meetups → Meetup detail (countdown, notes) → Options
   Free APIs only: Nominatim (geocode), Overpass (POIs), OSRM (routing).
   Backend + saved-plan format are unchanged (routes/meetplanner.js).
   ══════════════════════════════════════════════════════════════ */
'use strict';

const API = 'https://us-app-av6d.onrender.com';

/* ── LOCAL STATE FROM PARENT APP (same-origin localStorage) ── */
let AppS = {};
try { AppS = JSON.parse(localStorage.getItem('uwl_v5') || '{}'); } catch (e) {}
const coupleId = AppS.coupleId || null;
const myRole   = AppS.role || 'user1';
let myName      = AppS.myName || 'You';
let partnerName = AppS.partnerName || 'Partner';
let myAvatar    = AppS.myAvatar || '';
let partnerAvatar = AppS.partnerAvatar || '';

window.addEventListener('message', e => {
  if (!e.data || !e.data.type) return;
  if (e.data.type === 'names') {
    myName = e.data.my || myName; partnerName = e.data.partner || partnerName;
    if (e.data.myAvatar) myAvatar = e.data.myAvatar;
    if (e.data.partnerAvatar) partnerAvatar = e.data.partnerAvatar;
    renderHome();
  }
  if (e.data.type === 'theme' && e.data.vars) {
    Object.entries(e.data.vars).forEach(([k, v]) => { if (v) document.documentElement.style.setProperty(k, v); });
  }
});

/* ── helpers ── */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function $(id) { return document.getElementById(id); }
function toast(msg, dur = 3000) { const t = $('mpToast'); if (!t) return; t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; clearTimeout(window._mpToastTimer); window._mpToastTimer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(12px)'; }, dur); }
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function haversine(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function openM(id) { $(id).classList.add('open'); }
function mpCloseModal(id) { $(id).classList.remove('open'); }
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.mp-modal-bg').forEach(bg => bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); }));
});
const ico = {
  pin:   '<svg class="i" viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  route: '<svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>',
  clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  cal:   '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  wallet:'<svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/></svg>',
  plus:  '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  up:    '<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down:  '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  x:     '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev:  '<svg class="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  dots:  '<svg class="i" viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  edit:  '<svg class="i" viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  share: '<svg class="i" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  copy:  '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  trash: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  map:   '<svg class="i" viewBox="0 0 24 24"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>',
  nav:   '<svg class="i" viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
  photo: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>',
  party: '<svg class="i" viewBox="0 0 24 24"><path d="M5.8 21l3-9.5 6.5 6.5L5.8 21zM14 4l.5 2M19 8l-2 .5M18 3l-1.5 1.5M21 13l-2-.5"/></svg>',
  heart: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.6 5 6 5c2 0 3.4 1 4 2.2h4c.6-1.2 2-2.2 4-2.2 3.4 0 5.1 3.4 3.6 6.8C19.5 16.4 12 21 12 21z"/></svg>'
};

/* ── STATE ─────────────────────────────────────────────────── */
const MP = {
  city: null,            // { name, lat, lng, bbox, display }
  poiCat: 'hotel', poiMode: 'cat', poiQuery: '',
  poiResults: [],
  stops: [],             // { id, name, cat, icon, lat, lng, address, isAnchor }
  travelMode: 'car',
  tripType: 'weekend',
  route: { geometry: null, distanceKm: 0, durationMin: 0, legs: [] },
  routeBuilt: false,
  checklist: [],
  savedPlans: [], savedFilter: 'all',
  detailId: null, optId: null,
  stopsMap: null, routeMap: null,
};

const CAT_META = {
  hotel:         { ico: '🏨', label: 'Hotel',         chip: 'Hotels',        query: '["tourism"="hotel"]',    searchIds: ['hotel'],        stay: 45 },
  tourist:       { ico: '🗿', label: 'Tourist Place', chip: 'Tourist',       query: '["tourism"="attraction"]', searchIds: ['tourist_place'], stay: 90 },
  cafe:          { ico: '☕', label: 'Cafe',          chip: 'Cafes',         query: '["amenity"="cafe"]',     searchIds: ['cafe'],         stay: 45 },
  restaurant:    { ico: '🍽️', label: 'Restaurant',    chip: 'Restaurants',   query: '["amenity"="restaurant"]', searchIds: ['restaurant'],   stay: 60 },
  mall:          { ico: '🛍️', label: 'Shopping Mall', chip: 'Malls',         query: '["shop"="mall"]',        searchIds: ['mall'],         stay: 90 },
  park:          { ico: '🌳', label: 'Park',          chip: 'Parks',         query: '["leisure"="park"]',     searchIds: ['park'],         stay: 60 },
  museum:        { ico: '🏛️', label: 'Museum',        chip: 'Museums',       query: '["tourism"="museum"]',   searchIds: ['museum'],       stay: 90 },
  temple:        { ico: '🛕', label: 'Temple',        chip: 'Temples',       query: '["amenity"="place_of_worship"]', searchIds: ['temple', 'mosque', 'church'], stay: 45 },
  entertainment: { ico: '🎬', label: 'Entertainment', chip: 'Entertainment', query: '["amenity"~"cinema|theatre|nightclub"]', searchIds: ['movie_theatre'], stay: 120 },
  custom:        { ico: '📍', label: 'Place',         stay: 60 },
};
const CAT_GRAD = {
  hotel: ['#7c3aed', '#2e1065'], tourist: ['#f97316', '#7c2d12'], cafe: ['#b45309', '#431407'], restaurant: ['#e11d48', '#4c0519'],
  mall: ['#db2777', '#500724'], park: ['#16a34a', '#052e16'], museum: ['#0ea5e9', '#082f49'], temple: ['#f59e0b', '#78350f'],
  entertainment: ['#8b5cf6', '#2e1065'], custom: ['#ff2d55', '#5b0a1f']
};
const MODE_META = {
  car:     { ico: '🚗', label: 'Car',     kmh: null, g: 'driving' },
  bike:    { ico: '🏍️', label: 'Bike',    kmh: 32,   g: 'two-wheeler' },
  cycle:   { ico: '🚲', label: 'Cycle',   kmh: 15,   g: 'bicycling' },
  walk:    { ico: '🚶', label: 'Walk',    kmh: 5,    g: 'walking' },
  transit: { ico: '🚌', label: 'Transit', kmh: 22,   g: 'transit' },
};
const POPULAR = [
  { n: 'Bengaluru',     lat: 12.9716, lng: 77.5946, e: '🏙️', g: ['#ff3b5c', '#5b0a1f'] },
  { n: 'Hyderabad',     lat: 17.3850, lng: 78.4867, e: '🕌', g: ['#8b5cf6', '#2e1065'] },
  { n: 'Visakhapatnam', lat: 17.6868, lng: 83.2185, e: '🌊', g: ['#0ea5e9', '#082f49'] },
  { n: 'Goa',           lat: 15.2993, lng: 74.1240, e: '🏖️', g: ['#f59e0b', '#78350f'] },
  { n: 'Mysuru',        lat: 12.2958, lng: 76.6394, e: '🏰', g: ['#f97316', '#7c2d12'] },
  { n: 'Ooty',          lat: 11.4102, lng: 76.6950, e: '🌄', g: ['#16a34a', '#052e16'] },
  { n: 'Coorg',         lat: 12.3375, lng: 75.8069, e: '🌿', g: ['#10b981', '#022c22'] },
  { n: 'Chennai',       lat: 13.0827, lng: 80.2707, e: '🌅', g: ['#e11d48', '#4c0519'] },
  { n: 'Munnar',        lat: 10.0889, lng: 77.0595, e: '🍃', g: ['#22c55e', '#052e16'] },
  { n: 'Pondicherry',   lat: 11.9416, lng: 79.8083, e: '⛱️', g: ['#ec4899', '#500724'] },
];

/* ── date / format helpers ── */
function _today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function _ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _addDays(str, n) { const d = new Date((str || _ymd(_today())) + 'T00:00:00'); d.setDate(d.getDate() + n); return _ymd(d); }
function _daysUntil(str) { if (!str) return null; return Math.round((new Date(str + 'T00:00:00') - _today()) / 864e5); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _fmtDate(str) { if (!str) return ''; const d = new Date(str + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function _fmtRange(a, b) { if (!a) return 'Date not set'; if (!b || b === a) return _fmtDate(a); return _fmtDate(a).replace(/ \d{4}$/, '') + ' – ' + _fmtDate(b); }
function _fmtDur(min) { min = Math.round(min || 0); return min >= 60 ? Math.floor(min / 60) + 'h ' + String(min % 60).padStart(2, '0') + 'm' : min + ' min'; }
function _fmtClock(mins) { mins = ((Math.round(mins) % 1440) + 1440) % 1440; const h = Math.floor(mins / 60), m = mins % 60; return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); }
function _whenLabel(dateStr) {
  const n = _daysUntil(dateStr); if (n === null) return '';
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 ? 'In ' + n + ' days' : Math.abs(n) + 'd ago';
}

/* Extra trip info (end date, trip type) has no DB column — it rides along as one
   hidden header line at the top of `notes` and is stripped everywhere it's shown. */
const META_RE = /^\[\[mp:(\{.*?\})\]\]\n?/;
function _parseNotes(raw) {
  raw = raw || ''; const m = raw.match(META_RE); let meta = {};
  if (m) { try { meta = JSON.parse(m[1]); } catch (_) {} }
  return { meta, text: raw.replace(META_RE, '') };
}
function _buildNotes(text, meta) {
  const clean = {}; Object.entries(meta || {}).forEach(([k, v]) => { if (v) clean[k] = v; });
  const head = Object.keys(clean).length ? '[[mp:' + JSON.stringify(clean) + ']]\n' : '';
  return (head + (text || '').trim()).trim() || null;
}
function _planStops(p) { return Array.isArray(p.stops) ? [...p.stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []; }
function _nights(p, meta) { return meta.to && p.meet_date ? Math.max(0, Math.round((new Date(meta.to + 'T00:00:00') - new Date(p.meet_date + 'T00:00:00')) / 864e5)) : null; }
function _grad(cat) { const g = CAT_GRAD[cat] || CAT_GRAD.custom; return `linear-gradient(145deg,${g[0]},${g[1]})`; }

/* ── NAVIGATION (stack of in-page screens) ─────────────────── */
const VIEW_IDS = ['home', 'plan', 'search', 'stops', 'itin', 'route', 'saved', 'detail'];
let navStack = ['home'];
let _cdTimer = null;
function mpGo(v) { if (navStack[navStack.length - 1] !== v) navStack.push(v); _show(v); }
function mpBack() { if (navStack.length > 1) navStack.pop(); _show(navStack[navStack.length - 1]); }
function mpReset(v) { navStack = ['home']; if (v && v !== 'home') navStack.push(v); _show(navStack[navStack.length - 1]); }
function _currentView() { return navStack[navStack.length - 1]; }
function _show(v) {
  VIEW_IDS.forEach(id => $('v-' + id).classList.toggle('active', id === v));
  $('mpApp').scrollTop = 0;
  clearInterval(_cdTimer);
  if (v === 'home') renderHome();
  if (v === 'plan') _syncPlanForm();
  if (v === 'search') renderSearch();
  if (v === 'stops') { _renderStops(); setTimeout(_renderStopsMap, 80); }
  if (v === 'itin') renderItin();
  if (v === 'saved') { mpLoadSavedPlans(); }
  if (v === 'detail') { renderDetail(); _cdTimer = setInterval(_tickCountdown, 20000); }
}

/* ── HOME ──────────────────────────────────────────────────── */
function _avatarHTML(url, name) {
  if (url && /^(https?:|data:|\/)/.test(url)) return `<img src="${esc(url)}" alt="" onerror="this.remove()">`;
  return esc((name || '?').trim().charAt(0).toUpperCase());
}
function _upcomingPlan() {
  const planned = MP.savedPlans.filter(p => p.status !== 'completed');
  const dated = planned.filter(p => p.meet_date && _daysUntil(p.meet_date) >= 0).sort((a, b) => a.meet_date.localeCompare(b.meet_date));
  return dated[0] || planned.find(p => !p.meet_date) || null;
}
function renderHome() {
  if (!Array.isArray(MP.savedPlans)) MP.savedPlans = [];
  $('mpAvMe').innerHTML = _avatarHTML(myAvatar, myName);
  $('mpAvPt').innerHTML = _avatarHTML(partnerAvatar, partnerName);
  $('mpHeroNames').textContent = myName + ' & ' + partnerName;
  const up = MP.savedPlans.filter(p => p.status !== 'completed').length;
  const done = MP.savedPlans.filter(p => p.status === 'completed').length;
  $('mpMiniStats').innerHTML = `
    <div class="mp-mini"><b>${MP.savedPlans.length}</b><span>Total</span></div>
    <div class="mp-mini"><b>${up}</b><span>Upcoming</span></div>
    <div class="mp-mini"><b>${done}</b><span>Completed</span></div>`;

  $('mpDraftBox').innerHTML = MP.stops.length ? `
    <div class="mp-draft" onclick="${MP.routeBuilt ? "mpGo('itin')" : "mpGo('stops')"}">
      <div class="di">${ico.route}</div>
      <div><b>Continue your plan${MP.city ? ' · ' + esc(MP.city.name) : ''}</b><small>${MP.stops.length} stop${MP.stops.length === 1 ? '' : 's'} picked${MP.routeBuilt ? ' · route ready to save' : ''}</small></div>
      <span class="go">${ico.chev}</span>
    </div>` : '';

  const p = _upcomingPlan();
  if (!p) {
    $('mpUpcomingBox').innerHTML = `<div class="mp-empty-card" onclick="mpStartNew()"><div class="big">💌</div>No upcoming meetup yet.<br><b style="color:#fff">Tap to plan your first one</b></div>`;
  } else {
    const { meta } = _parseNotes(p.notes);
    const stops = _planStops(p), nights = _nights(p, meta);
    const d = p.meet_date ? new Date(p.meet_date + 'T00:00:00') : null;
    $('mpUpcomingBox').innerHTML = `
      <div class="mp-up" onclick="mpOpenPlan('${esc(p.id)}')">
        <div class="mp-up-date"><b>${d ? d.getDate() : '—'}</b><span>${d ? MONTHS[d.getMonth()] : 'No date'}</span></div>
        <div class="mp-up-body">
          ${p.meet_date ? `<div class="mp-when">${_whenLabel(p.meet_date)}</div>` : ''}
          <h3>${esc(p.title)}</h3>
          <div class="mp-up-sub">${esc(_fmtRange(p.meet_date, meta.to))}${p.city_name ? ' · ' + esc(p.city_name) : ''}</div>
          <div class="mp-up-meta">
            <span>${ico.pin} ${stops.length} stops</span>
            ${nights !== null ? `<span>${ico.clock} ${nights} night${nights === 1 ? '' : 's'}</span>` : ''}
            ${p.total_distance_km ? `<span>${ico.route} ${Number(p.total_distance_km).toFixed(1)} km</span>` : ''}
          </div>
        </div>
      </div>`;
  }
  if (!$('mpPopular').dataset.done) {
    $('mpPopular').dataset.done = '1';
    $('mpPopular').innerHTML = POPULAR.map((c, i) => `
      <div class="mp-dest" style="background:linear-gradient(150deg,${c.g[0]},${c.g[1]})" onclick="mpPickPopular(${i})">
        <div class="mp-art">${c.e}</div><div class="mp-dest-n">${c.n}</div></div>`).join('');
  }
}
function _resetDraft() {
  MP.city = null; MP.stops = []; MP.poiResults = []; MP.checklist = []; MP.routeBuilt = false;
  MP.route = { geometry: null, distanceKm: 0, durationMin: 0, legs: [] };
  MP.poiCat = 'hotel'; MP.poiMode = 'cat'; MP.travelMode = 'car';
  ['mpTitle', 'mpBudget', 'mpNotes', 'mpCityInput', 'mpCustomSearchInput'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  $('mpDate').value = _ymd(_today());
  mpSetTripType('weekend');
}
function mpStartNew() { _resetDraft(); mpGo('plan'); }
function mpPickPopular(i) {
  const c = POPULAR[i];
  _resetDraft();
  _setCity({ name: c.n, display: c.n, lat: c.lat, lng: c.lng, bbox: null });
  mpGo('plan');
}
function mpOpenItinerary() { mpGo('itin'); }

/* ── PLAN NEW ──────────────────────────────────────────────── */
const TRIP_DAYS = { day: 0, weekend: 2, long: 5 };
function _syncPlanForm() {
  _renderModeUIs();
  document.querySelectorAll('#mpTripType div').forEach(d => d.classList.toggle('on', d.dataset.t === MP.tripType));
  const badge = $('mpCityBadge');
  if (MP.city) { badge.classList.add('show'); $('mpCityBadgeLbl').textContent = MP.city.name; $('mpCityRow').style.display = 'none'; }
  else { badge.classList.remove('show'); $('mpCityRow').style.display = ''; }
  if (!$('mpDateTo').value) mpSetTripType(MP.tripType || 'weekend');
}
function mpSetTripType(t) {
  MP.tripType = t;
  const from = $('mpDate').value || _ymd(_today());
  if (!$('mpDate').value) $('mpDate').value = from;
  $('mpDateTo').value = _addDays(from, TRIP_DAYS[t]);
  document.querySelectorAll('#mpTripType div').forEach(d => d.classList.toggle('on', d.dataset.t === t));
}
function mpDateFromChanged() {
  const from = $('mpDate').value; if (!from) return;
  if (MP.tripType) $('mpDateTo').value = _addDays(from, TRIP_DAYS[MP.tripType]);
  else if (!$('mpDateTo').value || $('mpDateTo').value < from) $('mpDateTo').value = from;
}
function mpDateToChanged() {
  MP.tripType = null;
  document.querySelectorAll('#mpTripType div').forEach(d => d.classList.remove('on'));
  const from = $('mpDate').value, to = $('mpDateTo').value;
  if (from && to && to < from) $('mpDateTo').value = from;
}
function mpCreatePlan() {
  if (!MP.city) { toast('Choose a city first 📍'); $('mpCityInput').focus(); return; }
  mpGo('search');
}

/* ── CITY SEARCH (Nominatim) ──────────────────────────────── */
let _cityDebounce;
function mpSearchCity(q) {
  clearTimeout(_cityDebounce);
  const box = $('mpCityResults');
  if (!q || q.trim().length < 2) { box.classList.remove('show'); return; }
  _cityDebounce = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&featureType=city&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await r.json();
      if (!data.length) { box.innerHTML = '<div class="mp-res"><small>No cities found</small></div>'; box.classList.add('show'); return; }
      box.innerHTML = data.map((d, i) => `
        <div class="mp-res" onclick="mpPickCity(${i})"><b>${esc(d.display_name.split(',')[0])}</b><small>${esc(d.display_name)}</small></div>`).join('');
      box.classList.add('show');
      window._mpCityCandidates = data;
    } catch (e) { toast('City search failed — check connection'); }
  }, 350);
}
function mpPickCity(i) {
  const d = window._mpCityCandidates[i];
  _setCity({ name: d.display_name.split(',')[0], display: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon), bbox: d.boundingbox ? d.boundingbox.map(parseFloat) : null });
  $('mpCityResults').classList.remove('show');
  $('mpCityInput').value = '';
}
document.addEventListener('click', (e) => {
  const box = $('mpCityResults');
  if (box && !box.parentElement.contains(e.target)) box.classList.remove('show');
});
function mpUseGeoForCity() {
  if (!navigator.geolocation) { toast('Geolocation not supported'); return; }
  toast('Getting your location...');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const d = await r.json();
      const name = d.address?.city || d.address?.town || d.address?.county || d.display_name.split(',')[0];
      _setCity({ name, display: d.display_name, lat, lng, bbox: d.boundingbox ? d.boundingbox.map(parseFloat) : null });
    } catch (e) { toast('Could not resolve your city'); }
  }, () => toast('Location permission denied'));
}
function _setCity(city) {
  MP.city = city; MP.stops = []; MP.poiResults = []; MP.routeBuilt = false; MP.poiMode = 'cat';
  $('mpCityBadge').classList.add('show');
  $('mpCityBadgeLbl').textContent = city.name;
  $('mpCityRow').style.display = 'none';
  $('mpSearchSub').textContent = 'in ' + city.name;
  mpSearchPOI();
}
function mpChangeCity() {
  MP.city = null; MP.stops = []; MP.poiResults = []; MP.routeBuilt = false;
  $('mpCityBadge').classList.remove('show');
  $('mpCityRow').style.display = ''; $('mpCityInput').focus();
}

/* ── FIND PLACES ──────────────────────────────────────────── */
function renderSearch() {
  $('mpSearchSub').textContent = MP.city ? 'in ' + MP.city.name : 'Add places to your plan';
  $('mpPoiChips').innerHTML = Object.keys(CAT_META).filter(k => k !== 'custom').map(k =>
    `<div class="mp-chip ${MP.poiMode === 'cat' && MP.poiCat === k ? 'on' : ''}" onclick="mpSetPoiCat('${k}')">${CAT_META[k].ico} ${CAT_META[k].chip}</div>`).join('');
  if (!MP.poiResults.length && MP.city && !$('mpPoiBody').dataset.loading) mpSearchPOI(); else _renderPoiList();
  _updateDock();
}
function mpSetPoiCat(cat) {
  MP.poiCat = cat; MP.poiMode = 'cat'; $('mpCustomSearchInput').value = '';
  document.querySelectorAll('#mpPoiChips .mp-chip').forEach((c, i) => c.classList.toggle('on', Object.keys(CAT_META).filter(k => k !== 'custom')[i] === cat));
  mpSearchPOI();
}
async function mpSearchPOI() {
  if (!MP.city) return;
  const body = $('mpPoiBody'); const meta = CAT_META[MP.poiCat];
  body.dataset.loading = '1';
  body.innerHTML = `<div class="mp-note"><span class="mp-spin"></span> Searching ${esc(meta.label.toLowerCase())}s in ${esc(MP.city.name)}…</div>`;
  const { lat, lng } = MP.city;
  const catAtStart = MP.poiCat;
  try {
    if (!window.SearchService) throw new Error('SearchService not loaded');
    const results = await window.SearchService.searchCategory(meta.searchIds || [MP.poiCat], { lat, lng, radiusM: 12000, limit: 30 });
    if (catAtStart !== MP.poiCat || MP.poiMode !== 'cat') return; // user already moved on
    MP.poiResults = results.map(r => ({ id: r.id, name: r.name, cat: catAtStart, icon: r.icon || meta.ico, lat: r.lat, lng: r.lng, address: r.address, distKm: r.distKm }));
    delete body.dataset.loading;
    _renderPoiList(results.length && results[0]._live === false);
  } catch (e) {
    console.warn('[meetplanner] POI search failed:', e.message);
    delete body.dataset.loading;
    body.innerHTML = '<div class="mp-note">⚠️ Category search is temporarily unavailable.<br>Try the search box above instead.</div>';
  }
}
async function mpCustomSearch() {
  const q = $('mpCustomSearchInput').value.trim();
  if (!q || !MP.city) { if (!MP.city) toast('Choose a city first'); return; }
  const body = $('mpPoiBody');
  MP.poiMode = 'search'; MP.poiQuery = q;
  document.querySelectorAll('#mpPoiChips .mp-chip').forEach(c => c.classList.remove('on'));
  body.dataset.loading = '1';
  body.innerHTML = `<div class="mp-note"><span class="mp-spin"></span> Searching “${esc(q)}”…</div>`;
  try {
    if (!window.SearchService) throw new Error('SearchService not loaded');
    const results = await window.SearchService.searchText(q + ' ' + MP.city.name, { near: MP.city, limit: 15 });
    MP.poiResults = results.map(r => ({ id: r.id, name: r.name, cat: 'custom', icon: CAT_META.custom.ico, lat: r.lat, lng: r.lng, address: r.address, distKm: r.distKm }));
    delete body.dataset.loading;
    _renderPoiList();
  } catch (e) {
    console.warn('[meetplanner] custom search failed:', e.message);
    delete body.dataset.loading;
    body.innerHTML = '<div class="mp-note">Search failed — check your connection and try again</div>';
  }
}
function _poiRow(p, i) {
  const sel = MP.stops.some(s => s.id === p.id);
  return `<div class="mp-poi ${sel ? 'sel' : ''}" onclick="mpOpenPlace('poi',${i})">
    <div class="mp-thumb" style="background:${_grad(p.cat)}"><span class="mp-art" style="position:static;font-size:26px;filter:none">${p.icon}</span></div>
    <div class="mp-poi-b"><b>${esc(p.name)}</b><small>${p.distKm != null ? p.distKm.toFixed(1) + ' km' : ''}${p.distKm != null && p.address ? ' · ' : ''}${p.address ? esc(p.address.slice(0, 44)) : esc(CAT_META[p.cat]?.label || '')}</small></div>
    <div class="mp-plus" onclick="event.stopPropagation();mpToggleStop(${i})">${sel ? ico.check : ico.plus}</div>
  </div>`;
}
function _renderPoiList(offlineNote) {
  const body = $('mpPoiBody'); if (!body) return;
  const list = MP.poiResults;
  if (!list.length) { body.innerHTML = '<div class="mp-note">No results nearby 🧭<br>Try another category or a different search</div>'; _updateDock(); return; }
  let html = offlineNote ? '<div class="mp-note" style="padding:8px 0">⚠️ Live search unavailable — showing saved results</div>' : '';
  if (MP.poiMode === 'cat') {
    const top = list.slice(0, 6);
    html += `<div class="mp-h2">Nearby Popular</div><div class="mp-rail">${top.map((p, i) => {
      const sel = MP.stops.some(s => s.id === p.id);
      return `<div class="mp-tile ${sel ? 'sel' : ''}" style="background:${_grad(p.cat)}" onclick="mpOpenPlace('poi',${i})">
        <div class="mp-art">${p.icon}</div>
        <div class="mp-tile-add" onclick="event.stopPropagation();mpToggleStop(${i})">${sel ? ico.check : ico.plus}</div>
        <div class="mp-tile-t"><b>${esc(p.name)}</b><small>${p.distKm != null ? p.distKm.toFixed(1) + ' km' : esc(CAT_META[p.cat]?.label || '')}</small></div></div>`;
    }).join('')}</div>`;
    if (list.length > 6) html += `<div class="mp-h2">Trending in ${esc(MP.city?.name || '')}</div><div id="mpPoiRows">${list.slice(6).map((p, k) => _poiRow(p, k + 6)).join('')}</div>`;
  } else {
    html += `<div class="mp-h2">Results for “${esc(MP.poiQuery)}”</div><div id="mpPoiRows">${list.map((p, i) => _poiRow(p, i)).join('')}</div>`;
  }
  body.innerHTML = html;
  _updateDock();
}
function _updateDock() {
  const n = MP.stops.length;
  $('mpSearchDock').classList.toggle('show', n > 0);
  $('mpDockCount').textContent = n + ' stop' + (n === 1 ? '' : 's') + ' selected';
}
function _toggleStopObj(p) {
  const idx = MP.stops.findIndex(s => s.id === p.id);
  if (idx >= 0) MP.stops.splice(idx, 1);
  else MP.stops.push({ ...p, isAnchor: p.cat === 'hotel' && !MP.stops.some(s => s.isAnchor) });
  MP.routeBuilt = false;
}
function mpToggleStop(i) { const p = MP.poiResults[i]; if (!p) return; _toggleStopObj(p); _renderPoiList(); }

/* ── PLACE DETAILS (sheet) ────────────────────────────────── */
let _sheet = null;
function mpOpenPlace(src, i) {
  const p = src === 'poi' ? MP.poiResults[i] : MP.stops[i]; if (!p) return;
  _sheet = { src, i, p };
  const sel = MP.stops.some(s => s.id === p.id);
  const gl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  const osm = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`;
  $('mpPlaceBody').innerHTML = `
    <div class="mp-place-hero" style="background:${_grad(p.cat)}"><div class="mp-art">${p.icon}</div><h3>${esc(p.name)}</h3></div>
    <div class="mp-info" style="margin:0 0 6px"><span>${esc(CAT_META[p.cat]?.label || 'Place')}</span>${p.distKm != null ? `<span>${ico.pin} ${p.distKm.toFixed(1)} km from centre</span>` : ''}${sel ? `<span style="color:#34d399">${ico.check} In your plan</span>` : ''}</div>
    ${p.address ? `<div class="mp-prow">${ico.pin}<div>${esc(p.address)}</div></div>` : ''}
    <div class="mp-prow">${ico.route}<div>${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}</div></div>
    <div class="mp-row" style="margin-top:16px">
      <a class="mp-btn mp-btn-ghost" style="text-decoration:none" href="${gl}" target="_blank" rel="noopener">${ico.nav} Get Directions</a>
      <a class="mp-btn mp-btn-ghost" style="text-decoration:none" href="${osm}" target="_blank" rel="noopener">${ico.map} View on Map</a>
    </div>
    <button class="mp-btn ${sel ? 'mp-btn-danger' : 'mp-btn-red'} mp-btn-full" style="margin-top:10px;padding:14px" onclick="mpSheetToggle()">${sel ? 'Remove from Plan' : '+ Add to Plan'}</button>`;
  openM('mpPlaceSheet');
}
function mpSheetToggle() {
  if (!_sheet) return;
  _toggleStopObj(_sheet.p);
  mpCloseModal('mpPlaceSheet');
  const v = _currentView();
  if (v === 'search') _renderPoiList(); else if (v === 'stops') { _renderStops(); _renderStopsMap(); } else if (v === 'itin') renderItin();
}

/* ── YOUR STOPS ───────────────────────────────────────────── */
function _estimate(stops) {
  let km = 0; for (let i = 0; i < stops.length - 1; i++) km += haversine(stops[i], stops[i + 1]);
  km *= 1.3; // straight-line → rough road distance
  const kmh = MODE_META[MP.travelMode].kmh || 38;
  return { km, min: (km / kmh) * 60 };
}
function _renderStops() {
  const n = MP.stops.length;
  $('mpStopsCount').textContent = n + ' selected';
  $('mpStopsList').innerHTML = n ? MP.stops.map((s, i) => {
    const leg = i > 0 ? haversine(MP.stops[i - 1], s) * 1.3 : null;
    return `<div class="mp-stop">
      <div class="mp-num">${i + 1}</div>
      <div class="mp-stop-b" onclick="mpOpenPlace('stop',${i})"><b><span>${esc(s.name)}</span>${s.isAnchor ? '<span class="mp-anchor">Start/End</span>' : ''}</b>
        <small>${esc(CAT_META[s.cat]?.label || s.cat)}${leg != null ? ' · ~' + leg.toFixed(1) + ' km from previous' : ''}</small></div>
      <div class="mp-acts">
        <div class="mp-act" onclick="mpMoveStop(${i},-1)">${ico.up}</div>
        <div class="mp-act" onclick="mpMoveStop(${i},1)">${ico.down}</div>
        <div class="mp-act del" onclick="mpRemoveStop(${i})">${ico.x}</div>
      </div></div>`;
  }).join('') : `<div class="mp-note">No stops yet 🗺️<br>Add a few places to build your day</div>`;
  const est = _estimate(MP.stops);
  $('mpEstDist').textContent = n > 1 ? '~' + est.km.toFixed(1) + ' km' : '—';
  $('mpEstTime').textContent = n > 1 ? '~' + _fmtDur(est.min) : '—';
  $('mpEstStops').textContent = n;
  $('mpBuildBtn').disabled = n < 2;
  $('mpBuildHint').style.display = n < 2 ? 'block' : 'none';
}
function mpMoveStop(i, dir) {
  const j = i + dir; if (j < 0 || j >= MP.stops.length) return;
  [MP.stops[i], MP.stops[j]] = [MP.stops[j], MP.stops[i]];
  MP.routeBuilt = false; _renderStops(); _renderStopsMap();
}
function mpRemoveStop(i) { MP.stops.splice(i, 1); MP.routeBuilt = false; _renderStops(); _renderStopsMap(); }

/* ── MAPS ─────────────────────────────────────────────────── */
/* Leaflet's defaults make a map a scroll trap inside a scrolling page, so inside
   scrolling screens one finger scrolls the page and two fingers drive the map. */
function _mpMapOptions(extra) {
  const touch = !!(window.L && L.Browser && (L.Browser.mobile || L.Browser.touch));
  return Object.assign({ scrollWheelZoom: false, dragging: !touch, tap: false, touchZoom: true }, extra || {});
}
function _mpTameMapScroll(map) {
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
  return map;
}
function _pinIcon(n) { return L.divIcon({ html: `<div class="mp-pin">${n}</div>`, className: '', iconSize: [30, 30], iconAnchor: [15, 15] }); }
function _drawStops(map, stops, geometry, dashed) {
  if (geometry && geometry.coordinates) L.polyline(geometry.coordinates.map(c => [c[1], c[0]]), { color: '#ff2d55', weight: 5, opacity: .9 }).addTo(map);
  else if (stops.length > 1) L.polyline(stops.map(s => [s.lat, s.lng]), { color: '#ff2d55', weight: 3, opacity: .8, dashArray: dashed ? '7,8' : null }).addTo(map);
  stops.forEach((s, i) => L.marker([s.lat, s.lng], { icon: _pinIcon(i + 1) }).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${esc(CAT_META[s.cat]?.label || '')}`));
  if (stops.length) map.fitBounds(stops.map(s => [s.lat, s.lng]), { padding: [36, 36], maxZoom: 15 });
}
function _renderStopsMap() {
  if (!window.L || _currentView() !== 'stops') return;
  if (MP.stopsMap) { MP.stopsMap.remove(); MP.stopsMap = null; }
  const c = MP.city || { lat: 20.59, lng: 78.96 };
  MP.stopsMap = _mpTameMapScroll(L.map('mpStopsMap', _mpMapOptions({ zoomControl: true }))).setView([c.lat, c.lng], MP.city ? 12 : 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(MP.stopsMap);
  _drawStops(MP.stopsMap, MP.stops, null, true);
  setTimeout(() => MP.stopsMap && MP.stopsMap.invalidateSize(), 120);
}

/* ── ROUTE OPTIMIZATION (nearest-neighbour heuristic) ─────── */
function _optimizeOrder(stops) {
  if (stops.length <= 2) return [...stops];
  const anchor = stops.find(s => s.isAnchor);
  const rest = stops.filter(s => s !== anchor);
  const start = anchor || stops[0];
  const pool = anchor ? [...rest] : stops.slice(1);
  const ordered = [start]; let current = start;
  while (pool.length) {
    let bestIdx = 0, bestDist = Infinity;
    pool.forEach((p, idx) => { const d = haversine(current, p); if (d < bestDist) { bestDist = d; bestIdx = idx; } });
    current = pool.splice(bestIdx, 1)[0]; ordered.push(current);
  }
  if (anchor) ordered.push(anchor); // round trip back to hotel
  return ordered;
}
async function mpBuildRoute() {
  if (MP.stops.length < 2) { toast('Select at least 2 destinations'); return; }
  const btn = $('mpBuildBtn'); btn.disabled = true; btn.innerHTML = '<span class="mp-spin"></span> Building…';
  try {
    MP.stops = _optimizeOrder(MP.stops);
    await _computeRouteForMode();
    MP.routeBuilt = true;
    mpGo('itin');
  } finally { btn.innerHTML = 'Build Itinerary →'; btn.disabled = MP.stops.length < 2; }
}
async function _computeRouteForMode() {
  const coords = MP.stops.map(s => `${s.lng},${s.lat}`).join(';');
  const mm = MODE_META[MP.travelMode];
  let distanceKm = 0, durationMin = 0, geometry = null, legs = [];
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
    const data = await r.json();
    if (data.routes && data.routes[0]) {
      const route = data.routes[0];
      distanceKm = route.distance / 1000; geometry = route.geometry;
      legs = route.legs.map(l => ({ distanceKm: l.distance / 1000, durationMin: mm.kmh ? (l.distance / 1000 / mm.kmh) * 60 : l.duration / 60 }));
      durationMin = mm.kmh ? (distanceKm / mm.kmh) * 60 : route.duration / 60;
    } else throw new Error('no route');
  } catch (e) {
    for (let i = 0; i < MP.stops.length - 1; i++) {
      const d = haversine(MP.stops[i], MP.stops[i + 1]);
      distanceKm += d; legs.push({ distanceKm: d, durationMin: (d / (mm.kmh || 30)) * 60 });
    }
    durationMin = (distanceKm / (mm.kmh || 30)) * 60;
    geometry = { type: 'LineString', coordinates: MP.stops.map(s => [s.lng, s.lat]) };
  }
  MP.route = { geometry, distanceKm, durationMin, legs };
}

/* ── TRAVEL MODE pickers (Plan screen + Itinerary screen) ──── */
function _renderModeUIs() {
  const html = Object.entries(MODE_META).map(([k, m]) =>
    `<div class="mp-mode ${MP.travelMode === k ? 'on' : ''}" onclick="mpSetMode('${k}')"><span class="me">${m.ico}</span><small>${m.label}</small></div>`).join('');
  $('mpModePick').innerHTML = html; $('mpModeRow').innerHTML = html;
}
async function mpSetMode(mode) {
  MP.travelMode = mode; _renderModeUIs();
  if (MP.routeBuilt && MP.stops.length >= 2) { await _computeRouteForMode(); if (_currentView() === 'itin') renderItin(); }
}

/* ── ITINERARY ────────────────────────────────────────────── */
function renderItin() {
  const ok = MP.routeBuilt && MP.stops.length >= 2;
  $('mpItinBody').style.display = ok ? 'block' : 'none';
  const empty = $('mpItinEmpty'); empty.style.display = ok ? 'none' : 'block';
  if (!ok) {
    empty.innerHTML = MP.stops.length >= 2
      ? `Your stops changed since the last route.<br><br><button class="mp-btn mp-btn-red" onclick="mpBuildRoute()">Build Itinerary</button>`
      : `No itinerary yet 🗺️<br>Pick places and tap <b>Build Itinerary</b>.<br><br><button class="mp-btn mp-btn-red" onclick="mpStartNew()">Plan New</button>`;
    return;
  }
  $('mpItinSub').textContent = (MP.city ? MP.city.name + ' · ' : '') + MP.stops.length + ' stops';
  $('mpTotalDist').textContent = MP.route.distanceKm.toFixed(1) + ' km';
  $('mpTotalTime').textContent = _fmtDur(MP.route.durationMin);
  $('mpStopCount2').textContent = MP.stops.length;
  _renderModeUIs(); _renderTimeline(); _renderChecklist();
}
function _renderTimeline() {
  const el = $('mpTimeline'); if (!el || !MP.stops.length) return;
  const [h, m] = ($('mpStartTime').value || '09:00').split(':').map(Number);
  let t = h * 60 + (m || 0);
  el.innerHTML = MP.stops.map((s, i) => {
    const stay = CAT_META[s.cat]?.stay || 60, leg = MP.route.legs[i];
    const row = `<div class="mp-tl-row">
      <div class="mp-tl-time">${_fmtClock(t)}</div>
      <div class="mp-tl-rail"><div class="mp-tl-dot"></div><div class="mp-tl-line"></div></div>
      <div style="flex:1;min-width:0">
        <div class="mp-tl-card" onclick="mpOpenPlace('stop',${i})">
          <div class="mp-thumb" style="background:${_grad(s.cat)};width:50px;height:50px"><span class="mp-art" style="position:static;font-size:24px;filter:none">${s.icon}</span></div>
          <div class="mp-poi-b"><b>${esc(s.name)}</b><small>${esc(CAT_META[s.cat]?.label || '')} · ~${stay} min</small></div>
          <span style="color:var(--mp-text3)">${ico.chev}</span></div>
        ${leg ? `<div class="mp-tl-leg">${MODE_META[MP.travelMode].ico} ${_fmtDur(leg.durationMin)} · ${leg.distanceKm.toFixed(1)} km to next stop</div>` : ''}
      </div></div>`;
    t += stay + (leg ? leg.durationMin : 0);
    return row;
  }).join('');
}

/* ── CHECKLIST ────────────────────────────────────────────── */
function mpAddChecklistItem() {
  const inp = $('mpChecklistInput'); const v = inp.value.trim(); if (!v) return;
  MP.checklist.push({ id: Date.now(), text: v, done: false }); inp.value = ''; _renderChecklist();
}
function mpToggleChecklist(id) { const c = MP.checklist.find(x => x.id === id); if (c) c.done = !c.done; _renderChecklist(); }
function mpDelChecklist(id) { MP.checklist = MP.checklist.filter(x => x.id !== id); _renderChecklist(); }
function _renderChecklist() {
  const el = $('mpChecklistList'); if (!el) return;
  if (!MP.checklist.length) { el.innerHTML = '<div class="mp-note" style="padding:12px">Add packing / travel reminders</div>'; return; }
  el.innerHTML = MP.checklist.map(c => `
    <div class="mp-cl"><div class="mp-cb ${c.done ? 'done' : ''}" onclick="mpToggleChecklist(${c.id})">${c.done ? ico.check : ''}</div>
      <span class="${c.done ? 'done' : ''}">${esc(c.text)}</span><em onclick="mpDelChecklist(${c.id})">✕</em></div>`).join('');
}

/* ── SAVE PLAN ────────────────────────────────────────────── */
async function mpSavePlan() {
  if (!coupleId) { toast('Not connected to your couple space'); return; }
  const btn = $('mpSaveBtn'); btn.disabled = true;
  const title = $('mpTitle').value.trim() || ('Meetup in ' + (MP.city?.name || ''));
  const plan = {
    title,
    meetDate: $('mpDate').value || null,
    budget: parseFloat($('mpBudget').value) || null,
    currency: 'INR',
    cityName: MP.city?.name || null, cityLat: MP.city?.lat ?? null, cityLng: MP.city?.lng ?? null,
    stops: MP.stops.map((s, i) => ({ ...s, order: i })),
    routeGeometry: MP.route.geometry,
    totalDistanceKm: MP.route.distanceKm, totalDurationMin: MP.route.durationMin,
    travelMode: MP.travelMode, checklist: MP.checklist,
    notes: _buildNotes($('mpNotes').value, { to: $('mpDateTo').value, type: MP.tripType }),
    createdBy: myRole
  };
  try {
    await api('POST', '/api/meetplanner', { coupleId, plan, senderRole: myRole, myName });
    toast('Itinerary saved! 💾');
    _resetDraft();
    mpReset('saved');
  } catch (e) { toast('Save failed: ' + e.message); }
  finally { btn.disabled = false; }
}

/* ── SAVED PLANS ──────────────────────────────────────────── */
function mpSetSavedFilter(f) { MP.savedFilter = f; mpExitSelectMode(); renderSaved(); }
async function mpLoadSavedPlans() {
  if (!coupleId) { renderSaved(); return; }
  const el = $('mpSavedList');
  if (_currentView() === 'saved' && !MP.savedPlans.length) el.innerHTML = `<div class="mp-note" style="grid-column:1/-1"><span class="mp-spin"></span> Loading…</div>`;
  try {
    const data = await api('GET', '/api/meetplanner/' + coupleId);
    MP.savedPlans = Array.isArray(data) ? data : (Array.isArray(data?.plans) ? data.plans : (Array.isArray(data?.data) ? data.data : []));
    renderHome(); renderSaved();
    if (_currentView() === 'detail') renderDetail();
  } catch (e) {
    if (_currentView() === 'saved') el.innerHTML = `<div class="mp-note" style="grid-column:1/-1">⚠️ Couldn't load saved meetups.<br>${esc(e.message)}</div>`;
  }
}
function _sortedPlans() {
  const planned = MP.savedPlans.filter(p => p.status !== 'completed').sort((a, b) => (a.meet_date || '9999').localeCompare(b.meet_date || '9999'));
  const done = MP.savedPlans.filter(p => p.status === 'completed').sort((a, b) => (b.meet_date || '').localeCompare(a.meet_date || ''));
  return { planned, done };
}
function renderSaved() {
  const { planned, done } = _sortedPlans();
  document.querySelectorAll('#mpSavedTabs div').forEach(t => {
    const f = t.dataset.f, n = f === 'all' ? planned.length + done.length : f === 'upcoming' ? planned.length : done.length;
    t.textContent = { all: 'All', upcoming: 'Upcoming', completed: 'Completed' }[f] + ' · ' + n;
    t.classList.toggle('on', f === MP.savedFilter);
  });
  const list = MP.savedFilter === 'upcoming' ? planned : MP.savedFilter === 'completed' ? done : [...planned, ...done];
  const el = $('mpSavedList');
  if (!list.length) {
    el.innerHTML = `<div class="mp-note" style="grid-column:1/-1"><div style="font-size:42px;margin-bottom:6px">${MP.savedFilter === 'completed' ? '🌍' : '💌'}</div>${MP.savedFilter === 'completed' ? 'No completed meetups yet.<br>Finish one to add it to your Memory Globe!' : 'No saved meetups yet.'}<br><br><button class="mp-btn mp-btn-red" onclick="mpStartNew()">Plan a Meetup</button></div>`;
    return;
  }
  el.innerHTML = list.map(p => {
    const { meta } = _parseNotes(p.notes);
    const stops = _planStops(p), isDone = p.status === 'completed';
    const d = p.meet_date ? new Date(p.meet_date + 'T00:00:00') : null;
    const pill = isDone ? '<span class="mp-pill c">✓ Completed</span>' : p.meet_date ? `<span class="mp-pill p">${_whenLabel(p.meet_date)}</span>` : '<span class="mp-pill n">Date not set</span>';
    return `<div class="mp-plan sd-selectable ${isDone ? 'done' : ''} ${d ? '' : 'nodate'}" data-plan-id="${esc(p.id)}">
      <div class="sd-check"><i data-lucide="check"></i></div>
      <div class="mp-kebab mp-plan-actions" onclick="event.stopPropagation();mpOpenOptions('${esc(p.id)}')">${ico.dots}</div>
      <div class="mp-plan-d"><b>${d ? d.getDate() : '—'}</b><span>${d ? MONTHS[d.getMonth()] : 'TBD'}</span></div>
      <div class="mp-plan-b">
        <h3>${esc(p.title)}</h3>
        <div class="mp-plan-sub">${esc(_fmtRange(p.meet_date, meta.to))}${p.city_name ? ' · ' + esc(p.city_name) : ''}</div>
        <div class="mp-plan-m"><span>${ico.pin} ${stops.length} stops</span>${p.total_distance_km ? `<span>${ico.route} ${Number(p.total_distance_km).toFixed(1)} km</span>` : ''}${p.budget ? `<span>${ico.wallet} ₹${esc(p.budget)}</span>` : ''}</div>
        ${pill}
      </div></div>`;
  }).join('');
  if (window.lucide) { try { lucide.createIcons(); } catch (_) {} }
  mpWireSelection();
}

/* ── Long-press multi-select (page-scoped) ─────────────────── */
let mpSelection = null;
let mpSelectMode = false;
function mpWireSelection() {
  if (!mpSelection) {
    mpSelection = createSelectionController({
      onChange: (ids) => {
        $('mpSelectCount').textContent = ids.size + ' selected';
        $('mpSelectTrashBtn').disabled = ids.size === 0;
        if (ids.size === 0 && mpSelectMode) mpExitSelectMode();
      }
    });
  }
  document.querySelectorAll('#mpSavedList .mp-plan').forEach(card => {
    const id = card.dataset.planId;
    const actionsEl = card.querySelector('.mp-plan-actions');
    attachLongPress(card, {
      onPressStart: (e) => { if (actionsEl && actionsEl.contains(e.target)) return; card.classList.add('sd-pressing'); },
      onPressCancel: () => card.classList.remove('sd-pressing'),
      onLongPress: (e) => {
        card.classList.remove('sd-pressing');
        if (actionsEl && actionsEl.contains(e.target)) return;
        if (!mpSelectMode) mpEnterSelectMode();
        mpSelection.select(id); card.classList.add('sd-selected');
      },
      onTap: (e) => {
        if (actionsEl && actionsEl.contains(e.target)) return;
        if (mpSelectMode) { const now = mpSelection.toggle(id); card.classList.toggle('sd-selected', now); }
        else mpOpenPlan(id);
      }
    });
  });
}
function mpEnterSelectMode() { mpSelectMode = true; $('mpSavedList').classList.add('sd-select-mode'); $('mpSelectToolbar').classList.add('show'); }
function mpExitSelectMode() {
  mpSelectMode = false;
  if (mpSelection) mpSelection.clear();
  document.querySelectorAll('#mpSavedList .mp-plan.sd-selected').forEach(c => c.classList.remove('sd-selected'));
  $('mpSavedList').classList.remove('sd-select-mode'); $('mpSelectToolbar').classList.remove('show');
}

/* Android hardware back: the PARENT's single backButton listener calls this inside
   the iframe. Closes the top-most overlay first, then steps back one screen.
   Returns false only on Home so the app can leave the page. */
function closeTopOverlayIfOpen() {
  const lightbox = $('mpLightbox');
  if (lightbox && lightbox.classList.contains('open')) { closeMpLightbox(); return true; }
  const openConfirm = document.querySelector('.sd-overlay.show');
  if (openConfirm) { openConfirm.classList.remove('show'); return true; }
  const openModal = document.querySelector('.mp-modal-bg.open');
  if (openModal) { openModal.classList.remove('open'); return true; }
  const cityResults = $('mpCityResults');
  if (cityResults && cityResults.classList.contains('show')) { cityResults.classList.remove('show'); return true; }
  if (mpSelectMode) { mpExitSelectMode(); return true; }
  if (navStack.length > 1) { mpBack(); return true; }
  return false;
}
window.closeTopOverlayIfOpen = closeTopOverlayIfOpen;

async function mpBulkDeletePlans() {
  if (!mpSelection || !mpSelection.size) return;
  const ids = mpSelection.all();
  confirmDelete({
    itemType: 'meetup plan', count: ids.length,
    message: 'These meetup plans and their saved routes will be permanently deleted.',
    onConfirm: async () => {
      const { succeeded, failed } = await runBulkDelete(ids, (id) => api('DELETE', '/api/meetplanner/' + id, { coupleId }));
      mpExitSelectMode(); await mpLoadSavedPlans();
      toast(failed.length ? `${succeeded.length} deleted. ${failed.length} couldn't be deleted.` : (succeeded.length > 1 ? `${succeeded.length} meetups deleted` : 'Deleted'));
    }
  });
}

/* ── MEETUP DETAIL (countdown & notes) ─────────────────────── */
function mpOpenPlan(id) { MP.detailId = id; mpGo('detail'); }
function _detailPlan() { return MP.savedPlans.find(x => String(x.id) === String(MP.detailId)); }
function _countdownParts(p) {
  const diff = new Date(p.meet_date + 'T00:00:00') - new Date();
  if (diff <= 0) return null;
  return { d: Math.floor(diff / 864e5), h: Math.floor(diff % 864e5 / 36e5), m: Math.floor(diff % 36e5 / 6e4) };
}
function _tickCountdown() {
  const p = _detailPlan(); if (!p || !p.meet_date || p.status === 'completed') return;
  const c = _countdownParts(p); if (!c) { renderDetail(); return; }
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set('mpCdD', c.d); set('mpCdH', c.h); set('mpCdM', c.m);
}
function renderDetail() {
  const p = _detailPlan(), body = $('mpDetBody');
  if (!p) { body.innerHTML = '<div class="mp-note">This meetup is no longer available.</div>'; $('mpDetTitle').textContent = 'Meetup'; return; }
  const { meta, text } = _parseNotes(p.notes);
  const stops = _planStops(p), isDone = p.status === 'completed', mm = MODE_META[p.travel_mode] || MODE_META.car;
  $('mpDetTitle').textContent = p.title;
  $('mpDetSub').textContent = p.city_name || '';

  let hero;
  if (isDone) {
    hero = `<div class="mp-dhero done"><div class="mp-script">What a beautiful memory</div><small>Completed${p.meet_date ? ' · ' + esc(_fmtDate(p.meet_date)) : ''} · saved in your Memory Globe 🌍</small></div>`;
  } else if (!p.meet_date) {
    hero = `<div class="mp-dhero"><div class="mp-script">Can't wait to see you!</div><small>Pick a date to start the countdown</small><div style="margin-top:14px"><button class="mp-btn mp-btn-red mp-btn-sm" onclick="mpOpenEdit('${esc(p.id)}')">Set a date</button></div></div>`;
  } else {
    const c = _countdownParts(p), n = _daysUntil(p.meet_date);
    hero = `<div class="mp-dhero"><div class="mp-script">Can't wait to see you! ❤️</div><small>${esc(_fmtRange(p.meet_date, meta.to))}</small>
      ${c ? `<div class="mp-cd"><div><b id="mpCdD">${c.d}</b><span>Days</span></div><div><b id="mpCdH">${c.h}</b><span>Hours</span></div><div><b id="mpCdM">${c.m}</b><span>Minutes</span></div></div>`
          : `<div style="margin-top:16px;font-size:15px;font-weight:700">${n === 0 ? "Today's the day! 🎉" : 'This date has passed — how did it go?'}</div>`}</div>`;
  }
  const nights = _nights(p, meta);
  const chips = `<div class="mp-info">
      ${p.city_name ? `<span>${ico.pin} ${esc(p.city_name)}</span>` : ''}
      <span>${ico.cal} ${esc(_fmtRange(p.meet_date, meta.to))}</span>
      ${nights !== null && nights > 0 ? `<span>${ico.clock} ${nights} night${nights === 1 ? '' : 's'}</span>` : ''}
      <span>${mm.ico} ${mm.label}</span>
      ${p.budget ? `<span>${ico.wallet} ₹${esc(p.budget)}</span>` : ''}</div>`;
  const stats = `<div class="mp-stats" style="margin-top:14px">
      <div class="mp-st"><b>${stops.length}</b><small>Stops</small></div>
      <div class="mp-st"><b>${p.total_distance_km ? Number(p.total_distance_km).toFixed(1) + ' km' : '—'}</b><small>Distance</small></div>
      <div class="mp-st"><b>${p.total_duration_min ? _fmtDur(p.total_duration_min) : '—'}</b><small>Travel Time</small></div></div>`;
  const notes = `<div class="mp-panel"><h4 style="display:flex;justify-content:space-between;align-items:center">Notes <span class="mp-bar-pill" style="cursor:pointer" onclick="mpOpenEdit('${esc(p.id)}')">Edit</span></h4>
      ${text.trim() ? `<div class="mp-notes-txt">${esc(text)}</div>` : '<div class="mp-notes-empty">No notes yet — add ideas, reminders or surprises.</div>'}</div>`;
  const route = stops.length ? `<div class="mp-panel"><h4 style="display:flex;justify-content:space-between;align-items:center">Route <span class="mp-bar-pill" style="cursor:pointer" onclick="mpOpenRoute('${esc(p.id)}')">View map</span></h4>
      ${stops.map((s, i) => `<div class="mp-mini-stop"><div class="mp-num">${i + 1}</div><span class="mp-art" style="position:static;font-size:16px;filter:none">${s.icon || '📍'}</span><span>${esc(s.name)}</span></div>`).join('')}</div>` : '';
  const cl = Array.isArray(p.checklist) && p.checklist.length ? `<div class="mp-panel"><h4>Checklist</h4>${p.checklist.map((c, i) => `
      <div class="mp-cl"><div class="mp-cb ${c.done ? 'done' : ''}" onclick="mpToggleSavedCheck(${i})">${c.done ? ico.check : ''}</div><span class="${c.done ? 'done' : ''}">${esc(c.text)}</span></div>`).join('')}</div>` : '';
  const actions = `<div class="mp-actions">
      ${!isDone ? `<button class="mp-btn mp-btn-red" onclick="mpOpenComplete('${esc(p.id)}')">${ico.party} Mark Complete</button>` : (p.globe_memory_id ? `<button class="mp-btn mp-btn-red" onclick="mpViewPlanPhotos('${esc(p.id)}')">${ico.photo} View Photos</button>` : '<span></span>')}
      <button class="mp-btn mp-btn-ghost" onclick="mpOpenEdit('${esc(p.id)}')">${ico.edit} Edit Details</button></div>`;
  body.innerHTML = hero + chips + stats + notes + route + cl + actions;
}
async function mpToggleSavedCheck(i) {
  const p = _detailPlan(); if (!p || !Array.isArray(p.checklist)) return;
  const list = p.checklist.map((c, k) => k === i ? { ...c, done: !c.done } : c);
  p.checklist = list; renderDetail();
  try { await api('PATCH', '/api/meetplanner/' + p.id, { coupleId, plan: { checklist: list } }); }
  catch (e) { toast('Could not update checklist'); mpLoadSavedPlans(); }
}

/* ── ROUTE PREVIEW (full map + navigation) ────────────────── */
let _routeData = null;
function mpOpenRoute(src) {
  if (src === 'draft') {
    if (MP.stops.length < 2) { toast('Pick at least 2 stops first'); return; }
    _routeData = { title: MP.city?.name || 'Your route', stops: MP.stops, geometry: MP.route.geometry, km: MP.route.distanceKm, min: MP.route.durationMin, mode: MP.travelMode };
  } else {
    const p = MP.savedPlans.find(x => String(x.id) === String(src)); if (!p) return;
    const stops = _planStops(p); if (!stops.length) { toast('No stops saved for this meetup'); return; }
    _routeData = { title: p.title, stops, geometry: p.route_geometry, km: p.total_distance_km, min: p.total_duration_min, mode: p.travel_mode || 'car' };
  }
  mpCloseModal('mpOptSheet');
  mpGo('route');
  $('mpRouteSub').textContent = _routeData.title;
  $('mpRtDist').textContent = _routeData.km ? Number(_routeData.km).toFixed(1) + ' km' : '—';
  $('mpRtTime').textContent = _routeData.min ? _fmtDur(_routeData.min) : '—';
  $('mpRtStops').textContent = _routeData.stops.length;
  setTimeout(() => {
    if (!window.L) return;
    if (MP.routeMap) { MP.routeMap.remove(); MP.routeMap = null; }
    MP.routeMap = L.map('mpRouteMap', { zoomControl: true, tap: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(MP.routeMap);
    MP.routeMap.setView([_routeData.stops[0].lat, _routeData.stops[0].lng], 12);
    _drawStops(MP.routeMap, _routeData.stops, _routeData.geometry, true);
    setTimeout(() => MP.routeMap && MP.routeMap.invalidateSize(), 120);
  }, 80);
}
function mpStartNavigation() {
  if (!_routeData) return;
  const st = _routeData.stops, pt = s => s.lat + ',' + s.lng;
  let url = `https://www.google.com/maps/dir/?api=1&origin=${pt(st[0])}&destination=${pt(st[st.length - 1])}&travelmode=${(MODE_META[_routeData.mode] || MODE_META.car).g}`;
  const mid = st.slice(1, -1).slice(0, 9).map(pt).join('|');
  if (mid) url += '&waypoints=' + encodeURIComponent(mid);
  window.open(url, '_blank', 'noopener');
}

/* ── OPTIONS (sheet) ──────────────────────────────────────── */
function mpOpenOptions(id) {
  MP.optId = id || MP.detailId;
  const p = MP.savedPlans.find(x => String(x.id) === String(MP.optId)); if (!p) return;
  const done = p.status === 'completed';
  $('mpOptBody').innerHTML = `
    <div class="mp-opt" onclick="mpOpenEdit('${esc(p.id)}')">${ico.edit}<span>Edit Plan Details</span><span class="chev">${ico.chev}</span></div>
    <div class="mp-opt" onclick="mpOpenRoute('${esc(p.id)}')">${ico.map}<span>Route on Map</span><span class="chev">${ico.chev}</span></div>
    ${!done ? `<div class="mp-opt red" onclick="mpOptComplete()">${ico.party}<span>Mark Complete</span><span class="chev">${ico.chev}</span></div>` : ''}
    ${done && p.globe_memory_id ? `<div class="mp-opt" onclick="mpOptPhotos()">${ico.photo}<span>View Photos</span><span class="chev">${ico.chev}</span></div>` : ''}
    <div class="mp-opt" onclick="mpSharePlan()">${ico.share}<span>Share Plan</span><span class="chev">${ico.chev}</span></div>
    <div class="mp-opt" onclick="mpCopyPlan()">${ico.copy}<span>Copy Itinerary</span><span class="chev">${ico.chev}</span></div>
    <div class="mp-opt danger" onclick="mpOptDelete()">${ico.trash}<span>Delete Plan</span></div>`;
  openM('mpOptSheet');
}
function mpOptComplete() { mpCloseModal('mpOptSheet'); mpOpenComplete(MP.optId); }
function mpOptPhotos() { mpCloseModal('mpOptSheet'); mpViewPlanPhotos(MP.optId); }
function mpOptDelete() { mpCloseModal('mpOptSheet'); mpDeletePlan(MP.optId); }
function _planText(p) {
  const { meta, text } = _parseNotes(p.notes), stops = _planStops(p);
  return [`💕 ${p.title}`, `📅 ${_fmtRange(p.meet_date, meta.to)}${p.city_name ? ' · ' + p.city_name : ''}`, '',
    ...stops.map((s, i) => `${i + 1}. ${s.icon || '📍'} ${s.name}`),
    p.total_distance_km ? `\n📏 ${Number(p.total_distance_km).toFixed(1)} km${p.total_duration_min ? ' · ' + _fmtDur(p.total_duration_min) : ''}` : '',
    p.budget ? `💰 Budget ₹${p.budget}` : '', text.trim() ? '\n' + text.trim() : ''].filter(x => x !== '').join('\n');
}
async function _copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (_) {}
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; }
}
async function mpSharePlan() {
  const p = MP.savedPlans.find(x => String(x.id) === String(MP.optId)); if (!p) return;
  mpCloseModal('mpOptSheet');
  const t = _planText(p);
  if (navigator.share) { try { await navigator.share({ title: p.title, text: t }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  toast((await _copyText(t)) ? 'Itinerary copied — paste it anywhere 📋' : 'Could not share');
}
async function mpCopyPlan() {
  const p = MP.savedPlans.find(x => String(x.id) === String(MP.optId)); if (!p) return;
  mpCloseModal('mpOptSheet');
  toast((await _copyText(_planText(p))) ? 'Itinerary copied 📋' : 'Could not copy');
}

/* ── EDIT / DELETE ────────────────────────────────────────── */
function mpOpenEdit(id) {
  const p = MP.savedPlans.find(x => String(x.id) === String(id)); if (!p) return;
  mpCloseModal('mpOptSheet');
  const { meta, text } = _parseNotes(p.notes);
  $('mpEditPlanId').value = p.id;
  $('mpEditTitle').value = p.title || '';
  $('mpEditDate').value = p.meet_date || '';
  $('mpEditDateTo').value = meta.to || '';
  $('mpEditBudget').value = p.budget || '';
  $('mpEditNotes').value = text;
  openM('mpEditModal');
}
async function mpSaveEdit() {
  const id = $('mpEditPlanId').value;
  const p = MP.savedPlans.find(x => String(x.id) === String(id)); const { meta } = _parseNotes(p && p.notes);
  const from = $('mpEditDate').value || null; let to = $('mpEditDateTo').value || null;
  if (from && to && to < from) to = from;
  try {
    await api('PATCH', '/api/meetplanner/' + id, { coupleId, plan: {
      title: $('mpEditTitle').value.trim(), meetDate: from,
      budget: parseFloat($('mpEditBudget').value) || null,
      notes: _buildNotes($('mpEditNotes').value, { to, type: meta.type })
    } });
    mpCloseModal('mpEditModal'); toast('Updated ✏️'); mpLoadSavedPlans();
  } catch (e) { toast('Update failed: ' + e.message); }
}
function mpDeletePlan(id) {
  confirmDelete({
    itemType: 'meetup plan',
    message: 'This meetup plan and its saved route will be permanently deleted.',
    onConfirm: async () => {
      await api('DELETE', '/api/meetplanner/' + id, { coupleId });
      toast('Deleted');
      if (_currentView() === 'detail') mpBack();
      await mpLoadSavedPlans();
    }
  });
}

/* ── COMPLETE → MEMORY GLOBE ──────────────────────────────── */
const MOODS = ['😍 Amazing', '🥰 Sweet', '😂 Fun', '😌 Relaxing', '🥹 Emotional', '🎉 Exciting'];
let _completePhotos = [];
let _mpLbEngine = null;
function _mpLbGetEngine() {
  if (_mpLbEngine) return _mpLbEngine;
  _mpLbEngine = new GalleryEngine($('mpLightboxStage'), {
    renderItem(item) { const img = document.createElement('img'); img.src = item.url; img.alt = 'Meetup photo'; return img; },
    onIndexChange(i) { const c = $('mpLightboxCounter'); if (c) c.textContent = _mpLbEngine.items.length > 1 ? (i + 1) + ' / ' + _mpLbEngine.items.length : ''; },
    onEscape() { closeMpLightbox(); },
    onDismiss() { closeMpLightbox(); },
    onDragProgress(t) { const el = $('mpLightbox'); if (el) el.style.setProperty('--gve-backdrop-fade', String(1 - t * 0.85)); }
  });
  return _mpLbEngine;
}
function openMpLightbox(urls, index) {
  if (!urls || !urls.length) return;
  _mpLbGetEngine().open(urls.map(url => ({ url, type: 'photo' })), index || 0);
  $('mpLightbox').classList.add('open');
}
function closeMpLightbox() { $('mpLightbox').classList.remove('open'); if (_mpLbEngine) _mpLbEngine.close(); }
// Photos live in globe_memory_media (written by /complete), not on the plan row.
async function mpViewPlanPhotos(planId) {
  const plan = MP.savedPlans.find(p => String(p.id) === String(planId));
  if (!plan || !plan.globe_memory_id) return;
  try {
    const memories = await api('GET', '/api/globe/' + coupleId);
    const list = Array.isArray(memories) ? memories : (Array.isArray(memories?.data) ? memories.data : []);
    const memory = list.find(m => m.id === plan.globe_memory_id);
    const media = Array.isArray(memory?.globe_memory_media) ? memory.globe_memory_media : [];
    const urls = media.filter(m => m.type === 'photo').map(m => m.url);
    if (!urls.length) { toast('No photos saved for this meetup.'); return; }
    openMpLightbox(urls, 0);
  } catch (e) { toast('Could not load photos: ' + e.message); }
}
function mpOpenComplete(id) {
  mpCloseModal('mpOptSheet');
  $('mpCompletePlanId').value = id; $('mpCompleteMood').value = ''; $('mpCompleteNotes').value = '';
  _completePhotos = []; $('mpCompletePhotoThumbs').innerHTML = '';
  $('mpCompleteMoodPicker').innerHTML = MOODS.map(m => `<div class="mp-mood-opt" onclick="mpPickMood(this,'${m}')">${m}</div>`).join('');
  openM('mpCompleteModal');
}
function mpPickMood(el, mood) {
  document.querySelectorAll('.mp-mood-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel'); $('mpCompleteMood').value = mood;
}
function mpLoadCompletePhotos(input) {
  Array.from(input.files).forEach(async (file) => {
    const idx = _completePhotos.push({ url: null, uploading: true }) - 1;
    _renderCompleteThumbs();
    try {
      const form = new FormData(); form.append('file', file, file.name); form.append('coupleId', coupleId);
      const r = await fetch(API + '/api/media/upload', { method: 'POST', body: form });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      _completePhotos[idx] = { url: data.url, uploading: false };
    } catch (e) { toast('Photo upload failed for ' + file.name); _completePhotos.splice(idx, 1); }
    _renderCompleteThumbs();
  });
}
function _renderCompleteThumbs() {
  $('mpCompletePhotoThumbs').innerHTML = _completePhotos.map((p, i) => `
    <div class="mp-photo-thumb" ${p.uploading ? '' : `onclick="mpViewCompletePreview(${i})"`}>${p.uploading ? '⏳' : `<img src="${p.url}" loading="lazy" decoding="async">`}<button onclick="event.stopPropagation();mpRemoveCompletePhoto(${i})">✕</button></div>`).join('');
}
function mpViewCompletePreview(i) {
  const ready = _completePhotos.filter(p => p.url);
  const tapped = _completePhotos[i] && _completePhotos[i].url;
  openMpLightbox(ready.map(p => p.url), Math.max(0, ready.findIndex(p => p.url === tapped)));
}
function mpRemoveCompletePhoto(i) { _completePhotos.splice(i, 1); _renderCompleteThumbs(); }
async function mpConfirmComplete() {
  const id = $('mpCompletePlanId').value;
  try {
    await api('POST', '/api/meetplanner/' + id + '/complete', {
      coupleId, mood: $('mpCompleteMood').value || null,
      photos: _completePhotos.filter(p => p.url).map(p => p.url),
      extraNotes: $('mpCompleteNotes').value.trim() || null
    });
    mpCloseModal('mpCompleteModal'); toast('Saved to Memory Globe! 🌍💕'); mpLoadSavedPlans();
  } catch (e) { toast('Failed: ' + e.message); }
}

/* ── INIT ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  $('mpDate').value = _ymd(_today());
  mpSetTripType('weekend');
  _renderModeUIs();
  renderHome();
  if (coupleId) mpLoadSavedPlans();
  const w = $('mpApp'); if (w) w.addEventListener('scroll', () => {}, { passive: true });
});
