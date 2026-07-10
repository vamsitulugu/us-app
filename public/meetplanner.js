/* ══════════════════════════════════════════════════════════════
   MEET PLANNER v2 — client logic
   City-based multi-destination search → optimized route → itinerary
   Free APIs only: Nominatim (geocode/search), Overpass (POIs), OSRM (routing)
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

window.addEventListener('message', e => {
  if (!e.data || !e.data.type) return;
  if (e.data.type === 'names') { myName = e.data.my || myName; partnerName = e.data.partner || partnerName; renderHero(); }
  if (e.data.type === 'theme' && e.data.vars) {
    Object.entries(e.data.vars).forEach(([k, v]) => { if (v) document.documentElement.style.setProperty(k, v); });
  }
});

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, dur = 3000) { const t = document.getElementById('mpToast'); if (!t) return; t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; clearTimeout(window._mpToastTimer); window._mpToastTimer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(12px)'; }, dur); }
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
function openM(id) { document.getElementById(id).classList.add('open'); }
function mpCloseModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.mp-modal-bg').forEach(bg => bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); }));
});

/* ── STATE ─────────────────────────────────────────────────── */
const MP = {
  city: null,            // { name, lat, lng, bbox: [south,north,west,east], display }
  poiCat: 'hotel',
  poiResults: [],
  stops: [],             // selected + ordered: { id, name, cat, icon, lat, lng, address, isAnchor }
  travelMode: 'car',
  route: { geometry: null, distanceKm: 0, durationMin: 0, legs: [] },
  checklist: [],
  savedPlans: [],
  map: null, viewMap: null,
  routeLayer: null, stopMarkers: [],
};

const CAT_META = {
  hotel:         { ico: '🏨', label: 'Hotel',         query: '["tourism"="hotel"]' },
  tourist:       { ico: '🗿', label: 'Tourist Place',  query: '["tourism"="attraction"]' },
  cafe:          { ico: '☕', label: 'Cafe',           query: '["amenity"="cafe"]' },
  restaurant:    { ico: '🍽️', label: 'Restaurant',     query: '["amenity"="restaurant"]' },
  mall:          { ico: '🛍️', label: 'Shopping Mall',  query: '["shop"="mall"]' },
  park:          { ico: '🌳', label: 'Park',           query: '["leisure"="park"]' },
  museum:        { ico: '🏛️', label: 'Museum',         query: '["tourism"="museum"]' },
  temple:        { ico: '🛕', label: 'Temple',         query: '["amenity"="place_of_worship"]' },
  entertainment: { ico: '🎬', label: 'Entertainment',  query: '["amenity"~"cinema|theatre|nightclub"]' },
  custom:        { ico: '📍', label: 'Custom' },
};
const MODE_META = {
  car:     { ico: '🚗', label: 'Car',     kmh: null /* uses OSRM duration */ },
  bike:    { ico: '🏍️', label: 'Bike',    kmh: 32 },
  cycle:   { ico: '🚲', label: 'Cycle',   kmh: 15 },
  walk:    { ico: '🚶', label: 'Walk',    kmh: 5 },
  transit: { ico: '🚌', label: 'Transit', kmh: 22 },
};

/* ── HERO ──────────────────────────────────────────────────── */
function renderHero() {
  const el = document.getElementById('mpHero'); if (!el) return;
  const upcoming = MP.savedPlans.filter(p => p.status === 'planned').length;
  const completed = MP.savedPlans.filter(p => p.status === 'completed').length;
  el.innerHTML = `
    <div class="mp-stat"><div class="mp-stat-n">${MP.savedPlans.length}</div><div class="mp-stat-l">Total Plans</div></div>
    <div class="mp-stat"><div class="mp-stat-n">${upcoming}</div><div class="mp-stat-l">Upcoming</div></div>
    <div class="mp-stat"><div class="mp-stat-n">${completed}</div><div class="mp-stat-l">Completed</div></div>
    <div class="mp-stat"><div class="mp-stat-n">${MP.stops.length}</div><div class="mp-stat-l">Stops Selected</div></div>`;
}

/* ── TABS ──────────────────────────────────────────────────── */
function mpSwitchTab(tab, el) {
  document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.mp-sec').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('mp-sec-' + tab).classList.add('active');
  if (tab === 'saved') mpLoadSavedPlans();
  if (tab === 'result') setTimeout(() => { if (MP.map) MP.map.invalidateSize(); }, 100);
}

/* ── CITY SEARCH (Nominatim) ──────────────────────────────── */
let _cityDebounce;
function mpSearchCity(q) {
  clearTimeout(_cityDebounce);
  const box = document.getElementById('mpCityResults');
  if (!q || q.trim().length < 2) { box.classList.remove('show'); return; }
  _cityDebounce = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&featureType=city&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await r.json();
      if (!data.length) { box.innerHTML = '<div class="mp-loc-result-item">No cities found</div>'; box.classList.add('show'); return; }
      box.innerHTML = data.map((d, i) => `
        <div class="mp-loc-result-item" onclick="mpPickCity(${i})">
          <div class="nm">${esc(d.display_name.split(',')[0])}</div>
          <div class="sb">${esc(d.display_name)}</div>
        </div>`).join('');
      box.classList.add('show');
      window._mpCityCandidates = data;
    } catch (e) { toast('City search failed — check connection'); }
  }, 350);
}
function mpPickCity(i) {
  const d = window._mpCityCandidates[i];
  _setCity({
    name: d.display_name.split(',')[0],
    display: d.display_name,
    lat: parseFloat(d.lat), lng: parseFloat(d.lon),
    bbox: d.boundingbox ? d.boundingbox.map(parseFloat) : null // [south,north,west,east]
  });
  document.getElementById('mpCityResults').classList.remove('show');
  document.getElementById('mpCityInput').value = '';
}
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
  MP.city = city;
  MP.stops = []; MP.poiResults = [];
  document.getElementById('mpCityBadge').classList.add('show');
  document.getElementById('mpCityBadgeLbl').textContent = city.name;
  document.getElementById('mpDestCard').style.display = 'block';
  document.getElementById('mpStopsCard').style.display = 'none';
  mpSearchPOI(); // auto-load default category (hotel)
  renderHero();
}
function mpChangeCity() {
  document.getElementById('mpCityBadge').classList.remove('show');
  document.getElementById('mpDestCard').style.display = 'none';
  document.getElementById('mpStopsCard').style.display = 'none';
  MP.city = null; MP.stops = [];
  renderHero();
}

/* ── POI SEARCH (Overpass) ────────────────────────────────── */
function mpSetPoiCat(cat, el) {
  MP.poiCat = cat;
  document.querySelectorAll('.mp-poi-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  mpSearchPOI();
}
async function mpSearchPOI() {
  if (!MP.city) return;
  const listEl = document.getElementById('mpPoiList');
  listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3)"><span class="mp-spinner"></span> Searching ${CAT_META[MP.poiCat].label.toLowerCase()}s in ${esc(MP.city.name)}...</div>`;
  const meta = CAT_META[MP.poiCat];
  const { lat, lng } = MP.city;
  const radius = 12000; // 12km around city center
  const query = `[out:json][timeout:20];(node${meta.query}(around:${radius},${lat},${lng});way${meta.query}(around:${radius},${lat},${lng}););out center 30;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    const data = await r.json();
    const items = (data.elements || []).map(el => {
      const p = el.center || el;
      const tags = el.tags || {};
      return {
        id: 'osm_' + el.type + el.id,
        name: tags.name || meta.label,
        cat: MP.poiCat, icon: meta.ico,
        lat: p.lat, lng: p.lon,
        address: [tags['addr:street'], tags['addr:suburb']].filter(Boolean).join(', '),
        distKm: haversine({ lat, lng }, { lat: p.lat, lng: p.lon })
      };
    }).filter(x => x.lat && x.lng).sort((a, b) => a.distKm - b.distKm).slice(0, 25);
    MP.poiResults = items;
    _renderPoiList();
  } catch (e) {
    listEl.innerHTML = '<div class="mp-loc-result-item">Search failed — try again or use custom search</div>';
  }
}
async function mpCustomSearch() {
  const q = document.getElementById('mpCustomSearchInput').value.trim();
  if (!q || !MP.city) return;
  const listEl = document.getElementById('mpPoiList');
  listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3)"><span class="mp-spinner"></span> Searching "${esc(q)}"...</div>`;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=15&q=${encodeURIComponent(q + ' ' + MP.city.name)}`;
    const r = await fetch(url);
    const data = await r.json();
    MP.poiResults = data.map(d => ({
      id: 'nom_' + d.place_id, name: d.display_name.split(',')[0], cat: 'custom', icon: CAT_META.custom.ico,
      lat: parseFloat(d.lat), lng: parseFloat(d.lon),
      address: d.display_name, distKm: haversine(MP.city, { lat: parseFloat(d.lat), lng: parseFloat(d.lon) })
    }));
    document.querySelectorAll('.mp-poi-chip').forEach(c => c.classList.remove('active'));
    _renderPoiList();
  } catch (e) { listEl.innerHTML = '<div class="mp-loc-result-item">Search failed</div>'; }
}
function _renderPoiList() {
  const listEl = document.getElementById('mpPoiList');
  if (!MP.poiResults.length) { listEl.innerHTML = '<div class="mp-loc-result-item">No results nearby — try another category or search term</div>'; return; }
  listEl.innerHTML = MP.poiResults.map((p, i) => {
    const sel = MP.stops.some(s => s.id === p.id);
    return `<div class="mp-poi-item ${sel ? 'selected' : ''}" onclick="mpToggleStop(${i})">
      <div class="mp-poi-ico">${p.icon}</div>
      <div class="mp-poi-body">
        <div class="mp-poi-name">${esc(p.name)}</div>
        <div class="mp-poi-meta">${p.distKm != null ? p.distKm.toFixed(1) + ' km away' : ''}${p.address ? ' · ' + esc(p.address.slice(0, 40)) : ''}</div>
      </div>
      <div class="mp-poi-check">${sel ? '✓' : ''}</div>
    </div>`;
  }).join('');
}
function mpToggleStop(i) {
  const p = MP.poiResults[i];
  const idx = MP.stops.findIndex(s => s.id === p.id);
  if (idx >= 0) MP.stops.splice(idx, 1);
  else MP.stops.push({ ...p, isAnchor: p.cat === 'hotel' && !MP.stops.some(s => s.isAnchor) });
  _renderPoiList();
  _renderStopsList();
  renderHero();
}

/* ── STOPS LIST (selected destinations, editable order) ─────── */
function _renderStopsList() {
  const card = document.getElementById('mpStopsCard');
  const countEl = document.getElementById('mpStopsCount');
  const listEl = document.getElementById('mpStopsList');
  const buildBtn = document.getElementById('mpBuildBtn');
  if (!MP.stops.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  countEl.textContent = MP.stops.length + ' selected';
  listEl.innerHTML = MP.stops.map((s, i) => `
    <div class="mp-stop-row">
      <div class="mp-stop-num">${i + 1}</div>
      <div class="mp-stop-body">
        <div class="mp-stop-name">${s.icon} ${esc(s.name)}${s.isAnchor ? '<span class="mp-anchor-badge">Start/End</span>' : ''}</div>
        <div class="mp-stop-cat">${esc(CAT_META[s.cat]?.label || s.cat)}</div>
      </div>
      <div class="mp-stop-actions">
        <button class="mp-stop-btn" onclick="mpMoveStop(${i},-1)" title="Move up">↑</button>
        <button class="mp-stop-btn" onclick="mpMoveStop(${i},1)" title="Move down">↓</button>
        <button class="mp-stop-btn danger" onclick="mpRemoveStop(${i})" title="Remove">✕</button>
      </div>
    </div>`).join('');
  buildBtn.disabled = MP.stops.length < 2;
}
function mpMoveStop(i, dir) {
  const j = i + dir; if (j < 0 || j >= MP.stops.length) return;
  [MP.stops[i], MP.stops[j]] = [MP.stops[j], MP.stops[i]];
  _renderStopsList();
}
function mpRemoveStop(i) { MP.stops.splice(i, 1); _renderStopsList(); _renderPoiList(); renderHero(); }

/* ── ROUTE OPTIMIZATION (nearest-neighbor TSP heuristic) ─────── */
function _optimizeOrder(stops) {
  if (stops.length <= 2) return [...stops];
  const anchor = stops.find(s => s.isAnchor);
  const rest = stops.filter(s => s !== anchor);
  const start = anchor || stops[0];
  const pool = anchor ? [...rest] : stops.slice(1);
  const ordered = [start];
  let current = start;
  while (pool.length) {
    let bestIdx = 0, bestDist = Infinity;
    pool.forEach((p, idx) => {
      const d = haversine(current, p);
      if (d < bestDist) { bestDist = d; bestIdx = idx; }
    });
    current = pool.splice(bestIdx, 1)[0];
    ordered.push(current);
  }
  if (anchor) ordered.push(anchor); // round trip back to hotel
  return ordered;
}

/* ── BUILD ROUTE (optimize + OSRM routing) ───────────────────── */
async function mpBuildRoute() {
  if (MP.stops.length < 2) { toast('Select at least 2 destinations'); return; }
  document.getElementById('mpResultEmpty').style.display = 'none';
  document.getElementById('mpRouteCard').style.display = 'block';
  document.getElementById('mpChecklistCard').style.display = 'block';
  document.getElementById('mpSaveBtn').style.display = 'flex';
  document.querySelectorAll('.mp-tab')[1].click();

  MP.stops = _optimizeOrder(MP.stops);
  _renderModeRow();
  await _computeRouteForMode();
  _renderStopsList();
}
function _renderModeRow() {
  const el = document.getElementById('mpModeRow'); if (!el) return;
  el.innerHTML = Object.entries(MODE_META).map(([k, m]) => `
    <div class="mp-mode-pill ${MP.travelMode === k ? 'active' : ''}" onclick="mpSetMode('${k}')">
      <div class="ico">${m.ico}</div><div class="lbl">${m.label}</div>
    </div>`).join('');
}
async function mpSetMode(mode) {
  MP.travelMode = mode;
  _renderModeRow();
  await _computeRouteForMode();
}

async function _computeRouteForMode() {
  const coords = MP.stops.map(s => `${s.lng},${s.lat}`).join(';');
  let distanceKm = 0, durationMin = 0, geometry = null, legs = [];
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.routes && data.routes[0]) {
      const route = data.routes[0];
      distanceKm = route.distance / 1000;
      geometry = route.geometry;
      legs = route.legs.map(l => ({ distanceKm: l.distance / 1000, durationMin: l.duration / 60 }));
      const modeMeta = MODE_META[MP.travelMode];
      durationMin = modeMeta.kmh ? (distanceKm / modeMeta.kmh) * 60 : route.duration / 60;
    } else throw new Error('no route');
  } catch (e) {
    // Fallback: straight-line distance chain + speed-based estimate
    for (let i = 0; i < MP.stops.length - 1; i++) {
      const d = haversine(MP.stops[i], MP.stops[i + 1]);
      distanceKm += d;
      legs.push({ distanceKm: d, durationMin: (d / (MODE_META[MP.travelMode].kmh || 30)) * 60 });
    }
    durationMin = (distanceKm / (MODE_META[MP.travelMode].kmh || 30)) * 60;
    geometry = { type: 'LineString', coordinates: MP.stops.map(s => [s.lng, s.lat]) };
  }
  MP.route = { geometry, distanceKm, durationMin, legs };
  _renderRouteMap();
  _renderRouteStats();
  _renderItinerarySummary();
}

function _renderRouteStats() {
  document.getElementById('mpTotalDist').textContent = MP.route.distanceKm.toFixed(1) + ' km';
  document.getElementById('mpTotalTime').textContent = MP.route.durationMin >= 60
    ? Math.floor(MP.route.durationMin / 60) + 'h ' + Math.round(MP.route.durationMin % 60) + 'm'
    : Math.round(MP.route.durationMin) + ' min';
  document.getElementById('mpStopCount2').textContent = MP.stops.length;
}
function _renderItinerarySummary() {
  const el = document.getElementById('mpItinerarySummary'); if (!el) return;
  el.innerHTML = `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">📋 Roadmap</div>
    ${MP.stops.map((s, i) => `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);padding:4px 0">
        <span style="width:20px;height:20px;border-radius:50%;background:var(--g2);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--white);flex-shrink:0">${i + 1}</span>
        <span>${s.icon} ${esc(s.name)}</span>
        ${i < MP.stops.length - 1 ? `<span style="margin-left:auto;color:var(--text3);font-size:10px">${(MP.route.legs[i]?.distanceKm || 0).toFixed(1)} km</span>` : ''}
      </div>
      ${i < MP.stops.length - 1 ? '<div style="padding-left:9px;color:var(--text3);font-size:11px">↓</div>' : ''}
    `).join('')}
  </div>`;
}

/* ── MAP RENDERING ────────────────────────────────────────── */
function _renderRouteMap() {
  if (!window.L) return;
  if (!MP.map) {
    MP.map = L.map('mpMapView', { zoomControl: true }).setView([MP.city.lat, MP.city.lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(MP.map);
  }
  if (MP.routeLayer) MP.map.removeLayer(MP.routeLayer);
  MP.stopMarkers.forEach(m => MP.map.removeLayer(m));
  MP.stopMarkers = [];

  if (MP.route.geometry) {
    const latlngs = MP.route.geometry.coordinates.map(c => [c[1], c[0]]);
    MP.routeLayer = L.polyline(latlngs, { color: 'var(--accent, #5b9bff)'.includes('var') ? '#5b9bff' : '#5b9bff', weight: 4, opacity: 0.85 }).addTo(MP.map);
  }
  MP.stops.forEach((s, i) => {
    const icon = L.divIcon({
      html: `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#5b9bff,#ff6bd6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${i + 1}</div>`,
      className: '', iconSize: [28, 28]
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(MP.map).bindPopup(`<b>${esc(s.name)}</b><br>${esc(CAT_META[s.cat]?.label || s.cat)}`);
    MP.stopMarkers.push(m);
  });
  const bounds = MP.stops.map(s => [s.lat, s.lng]);
  if (bounds.length) MP.map.fitBounds(bounds, { padding: [40, 40] });
  setTimeout(() => MP.map.invalidateSize(), 150);
}

/* ── CHECKLIST ────────────────────────────────────────────── */
function mpAddChecklistItem() {
  const inp = document.getElementById('mpChecklistInput');
  const v = inp.value.trim(); if (!v) return;
  MP.checklist.push({ id: Date.now(), text: v, done: false });
  inp.value = ''; _renderChecklist();
}
function mpToggleChecklist(id) { const c = MP.checklist.find(x => x.id === id); if (c) c.done = !c.done; _renderChecklist(); }
function mpDelChecklist(id) { MP.checklist = MP.checklist.filter(x => x.id !== id); _renderChecklist(); }
function _renderChecklist() {
  const el = document.getElementById('mpChecklistList'); if (!el) return;
  if (!MP.checklist.length) { el.innerHTML = '<div style="text-align:center;padding:14px;color:var(--text3);font-size:12px">Add packing/travel reminders</div>'; return; }
  el.innerHTML = MP.checklist.map(c => `
    <div class="mp-check-row">
      <div class="mp-cb ${c.done ? 'done' : ''}" onclick="mpToggleChecklist(${c.id})">${c.done ? '✓' : ''}</div>
      <div class="mp-check-text ${c.done ? 'done' : ''}">${esc(c.text)}</div>
      <button class="mp-check-del" onclick="mpDelChecklist(${c.id})">✕</button>
    </div>`).join('');
}

/* ── SAVE PLAN ────────────────────────────────────────────── */
async function mpSavePlan() {
  if (!coupleId) { toast('Not connected to your couple space'); return; }
  const title = document.getElementById('mpTitle').value.trim() || ('Meetup in ' + (MP.city?.name || ''));
  const plan = {
    title,
    meetDate: document.getElementById('mpDate').value || null,
    budget: parseFloat(document.getElementById('mpBudget').value) || null,
    currency: 'INR',
    cityName: MP.city?.name || null,
    cityLat: MP.city?.lat ?? null,
    cityLng: MP.city?.lng ?? null,
    stops: MP.stops.map((s, i) => ({ ...s, order: i })),
    routeGeometry: MP.route.geometry,
    totalDistanceKm: MP.route.distanceKm,
    totalDurationMin: MP.route.durationMin,
    travelMode: MP.travelMode,
    checklist: MP.checklist,
    createdBy: myRole
  };
  try {
    await api('POST', '/api/meetplanner', { coupleId, plan });
    toast('Itinerary saved! 💾');
    mpSwitchTab('saved', document.querySelectorAll('.mp-tab')[2]);
  } catch (e) { toast('Save failed: ' + e.message); }
}

/* ── SAVED PLANS LIST ─────────────────────────────────────── */
async function mpLoadSavedPlans() {
  if (!coupleId) return;
  const el = document.getElementById('mpSavedList');
  el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3)"><span class="mp-spinner"></span> Loading...</div>`;
  try {
    const data = await api('GET', '/api/meetplanner/' + coupleId);
    MP.savedPlans = data || [];
    renderHero();
    if (!MP.savedPlans.length) {
      el.innerHTML = `<div class="mp-empty"><div class="mp-empty-ico">💌</div><div class="mp-empty-text">No saved meetups yet.<br>Plan one in the "Plan New" tab!</div></div>`;
      return;
    }
    el.innerHTML = MP.savedPlans.map(p => {
      const stops = Array.isArray(p.stops) ? [...p.stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
      const routeText = stops.length ? stops.map(s => (s.icon || '📍') + ' ' + s.name).join(' → ') : (p.mid_city || p.city_name || '');
      return `<div class="mp-plan-card" onclick="mpViewPlan('${p.id}')">
        <div class="mp-plan-top">
          <div class="mp-plan-title">${esc(p.title)}</div>
          <div class="mp-plan-status ${p.status}">${p.status === 'completed' ? '✅ Completed' : '📅 Planned'}</div>
        </div>
        <div class="mp-plan-meta">
          ${p.city_name ? '🏙️ ' + esc(p.city_name) : ''}
          ${p.meet_date ? '📅 ' + esc(p.meet_date) : ''}
          ${p.total_distance_km ? '📏 ' + Number(p.total_distance_km).toFixed(1) + ' km' : ''}
          ${p.budget ? '💰 ₹' + p.budget : ''}
        </div>
        <div class="mp-plan-route">${esc(routeText.slice(0, 140))}${routeText.length > 140 ? '…' : ''}</div>
        <div class="mp-plan-actions" onclick="event.stopPropagation()">
          ${p.status !== 'completed' ? `<button class="mp-btn mp-btn-accent mp-btn-sm" onclick="mpOpenComplete('${p.id}')">🎉 Mark Complete</button>` : ''}
          <button class="mp-btn mp-btn-glass mp-btn-sm" onclick="mpOpenEdit('${p.id}')">✏️ Edit</button>
          <button class="mp-btn mp-btn-danger mp-btn-sm" onclick="mpDeletePlan('${p.id}')">🗑️ Delete</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) { el.innerHTML = `<div class="mp-empty"><div class="mp-empty-ico">⚠️</div><div class="mp-empty-text">Couldn't load saved meetups.<br>${esc(e.message)}</div></div>`; }
}

function mpViewPlan(id) {
  const p = MP.savedPlans.find(x => String(x.id) === String(id)); if (!p) return;
  document.getElementById('mpViewTitle').textContent = p.title;
  const stops = Array.isArray(p.stops) ? [...p.stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  document.getElementById('mpViewStops').innerHTML = stops.map((s, i) => `
    <div class="mp-stop-row" style="margin-bottom:6px">
      <div class="mp-stop-num">${i + 1}</div>
      <div class="mp-stop-body"><div class="mp-stop-name">${s.icon || '📍'} ${esc(s.name)}</div></div>
    </div>`).join('') || '<div style="color:var(--text3);font-size:12px">No stops recorded for this plan.</div>';
  openM('mpViewModal');
  setTimeout(() => {
    if (MP.viewMap) { MP.viewMap.remove(); MP.viewMap = null; }
    if (!stops.length) return;
    MP.viewMap = L.map('mpViewMap').setView([stops[0].lat, stops[0].lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(MP.viewMap);
    const latlngs = stops.map(s => [s.lat, s.lng]);
    if (p.route_geometry?.coordinates) L.polyline(p.route_geometry.coordinates.map(c => [c[1], c[0]]), { color: '#5b9bff', weight: 4 }).addTo(MP.viewMap);
    else L.polyline(latlngs, { color: '#5b9bff', weight: 3, dashArray: '6,6' }).addTo(MP.viewMap);
    stops.forEach((s, i) => {
      const icon = L.divIcon({ html: `<div style="width:24px;height:24px;border-radius:50%;background:#5b9bff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff">${i + 1}</div>`, className: '', iconSize: [24, 24] });
      L.marker([s.lat, s.lng], { icon }).addTo(MP.viewMap);
    });
    MP.viewMap.fitBounds(latlngs, { padding: [30, 30] });
    setTimeout(() => MP.viewMap.invalidateSize(), 100);
  }, 80);
}

/* ── EDIT ─────────────────────────────────────────────────── */
function mpOpenEdit(id) {
  const p = MP.savedPlans.find(x => String(x.id) === String(id)); if (!p) return;
  document.getElementById('mpEditPlanId').value = p.id;
  document.getElementById('mpEditTitle').value = p.title || '';
  document.getElementById('mpEditDate').value = p.meet_date || '';
  document.getElementById('mpEditBudget').value = p.budget || '';
  document.getElementById('mpEditNotes').value = p.notes || '';
  openM('mpEditModal');
}
async function mpSaveEdit() {
  const id = document.getElementById('mpEditPlanId').value;
  try {
    await api('PATCH', '/api/meetplanner/' + id, {
      coupleId,
      plan: {
        title: document.getElementById('mpEditTitle').value.trim(),
        meetDate: document.getElementById('mpEditDate').value || null,
        budget: parseFloat(document.getElementById('mpEditBudget').value) || null,
        notes: document.getElementById('mpEditNotes').value.trim() || null
      }
    });
    mpCloseModal('mpEditModal'); toast('Updated ✏️'); mpLoadSavedPlans();
  } catch (e) { toast('Update failed: ' + e.message); }
}
async function mpDeletePlan(id) {
  if (!confirm('Delete this meetup plan?')) return;
  try { await api('DELETE', '/api/meetplanner/' + id, { coupleId }); toast('Deleted'); mpLoadSavedPlans(); }
  catch (e) { toast('Delete failed: ' + e.message); }
}

/* ── COMPLETE → MEMORY GLOBE ──────────────────────────────── */
const MOODS = ['😍 Amazing', '🥰 Sweet', '😂 Fun', '😌 Relaxing', '🥹 Emotional', '🎉 Exciting'];
let _completePhotos = [];
function mpOpenComplete(id) {
  document.getElementById('mpCompletePlanId').value = id;
  document.getElementById('mpCompleteMood').value = '';
  document.getElementById('mpCompleteNotes').value = '';
  _completePhotos = [];
  document.getElementById('mpCompletePhotoThumbs').innerHTML = '';
  document.getElementById('mpCompleteMoodPicker').innerHTML = MOODS.map(m => `<div class="mp-mood-opt" onclick="mpPickMood(this,'${m}')">${m}</div>`).join('');
  openM('mpCompleteModal');
}
function mpPickMood(el, mood) {
  document.querySelectorAll('.mp-mood-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel');
  document.getElementById('mpCompleteMood').value = mood;
}
function mpLoadCompletePhotos(input) {
  Array.from(input.files).forEach(file => {
    const r = new FileReader();
    r.onload = e => { _completePhotos.push(e.target.result); _renderCompleteThumbs(); };
    r.readAsDataURL(file);
  });
}
function _renderCompleteThumbs() {
  document.getElementById('mpCompletePhotoThumbs').innerHTML = _completePhotos.map((p, i) => `
    <div class="mp-photo-thumb"><img src="${p}"><button onclick="mpRemoveCompletePhoto(${i})">✕</button></div>`).join('');
}
function mpRemoveCompletePhoto(i) { _completePhotos.splice(i, 1); _renderCompleteThumbs(); }
async function mpConfirmComplete() {
  const id = document.getElementById('mpCompletePlanId').value;
  try {
    await api('POST', '/api/meetplanner/' + id + '/complete', {
      coupleId,
      mood: document.getElementById('mpCompleteMood').value || null,
      photos: _completePhotos,
      extraNotes: document.getElementById('mpCompleteNotes').value.trim() || null
    });
    mpCloseModal('mpCompleteModal');
    toast('Saved to Memory Globe! 🌍💕');
    mpLoadSavedPlans();
  } catch (e) { toast('Failed: ' + e.message); }
}

/* ── INIT ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderHero();
  if (coupleId) mpLoadSavedPlans();
  document.getElementById('mpDate').value = new Date().toISOString().slice(0, 10);
});