// ═══════════════════════════════════════════════════════
//  Live Meet Planner — client logic
//  Free APIs only: Nominatim, Open-Meteo, OSRM, Overpass
// ═══════════════════════════════════════════════════════
'use strict';

const MP_API = 'https://us-app-api.onrender.com';

let mpCoupleId = null, mpRole = 'user1', mpMyName = 'You', mpPartnerName = 'Partner';
let mpLoc1 = null, mpLoc2 = null; // {label, lat, lng, city, state, country}
let mpMidpoint = null; // {lat, lng, city, state, country}
let mpTravelMode = 'car';
let mpRouteData = {}; // cache per mode: {car:{distanceKm,durationMin}, ...}
let mpChecklist = [];
let mpPlans = [];
let mpMap = null, mpMapMarkers = [];
let mpPoiCache = {}; // cat -> [{name,lat,lng,dist,tags}]
let mpPoiCat = 'cafe';
let mpCompletePhotos = [];
let mpLocSearchTimer = { 1: null, 2: null };
let mpCountdownTimer = null;

const MP_MOODS = ['😊 Happy', '🥰 Romantic', '😌 Peaceful', '🤩 Excited', '🥹 Emotional', '😴 Relaxed'];

const MP_TRAVEL_MODES = [
  { id: 'car',    ico: '🚗', label: 'Car',    osrmProfile: 'driving', speedKmh: 55  },
  { id: 'taxi',   ico: '🚖', label: 'Taxi',   osrmProfile: 'driving', speedKmh: 50  },
  { id: 'bike',   ico: '🚴', label: 'Cycle',  osrmProfile: 'cycling', speedKmh: 16  },
  { id: 'walk',   ico: '🚶', label: 'Walk',   osrmProfile: 'foot',    speedKmh: 5   },
  { id: 'bus',    ico: '🚌', label: 'Bus',    osrmProfile: 'driving', speedKmh: 35  },
  { id: 'train',  ico: '🚆', label: 'Train',  osrmProfile: null,      speedKmh: 70  },
  { id: 'flight', ico: '✈️', label: 'Flight', osrmProfile: null,      speedKmh: 550 },
];

const MP_POI_CATS = {
  cafe:       { ico: '☕', overpass: '["amenity"="cafe"]' },
  restaurant: { ico: '🍽', overpass: '["amenity"="restaurant"]' },
  park:       { ico: '🌳', overpass: '["leisure"="park"]' },
  hotel:      { ico: '🏨', overpass: '["tourism"="hotel"]' },
  attraction: { ico: '🎬', overpass: '["tourism"="attraction"]' },
  shop:       { ico: '🛍', overpass: '["shop"]' },
};

// ─── OFFLINE CACHE ──────────────────────────────────────
function mpSaveCache() {
  try { localStorage.setItem('mp_cache', JSON.stringify({ plans: mpPlans, ts: Date.now() })); } catch (e) {}
}
function mpLoadCache() {
  try {
    const raw = localStorage.getItem('mp_cache');
    if (raw) mpPlans = (JSON.parse(raw).plans) || [];
  } catch (e) {}
}

// ─── TOAST (matches existing pages) ────────────────────
let _mpToastTimer;
function mpToast(msg, dur = 2800) {
  const t = document.getElementById('mpToast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(_mpToastTimer);
  _mpToastTimer = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(12px)';
  }, dur);
}

function mpEsc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mpFmtDate(s) {
  if (!s) return '—';
  try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return s; }
}

// ─── THEME / NAMES SYNC (matches globe.html / places.html pattern) ──
window.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'theme') {
    const root = document.documentElement;
    Object.entries(e.data.vars || {}).forEach(([k, v]) => root.style.setProperty(k, v));
  }
  if (e.data.type === 'names') {
    mpMyName = e.data.my || 'You';
    mpPartnerName = e.data.partner || 'Partner';
    mpApplyNames();
  }
});

function mpApplyNames() {
  const l1 = document.getElementById('mpLoc1Label');
  const l2 = document.getElementById('mpLoc2Label');
  if (l1) l1.textContent = mpMyName + "'s Location";
  if (l2) l2.textContent = mpPartnerName + "'s Location";
  const av1 = document.getElementById('mpAv1');
  const av2 = document.getElementById('mpAv2');
  if (av1) av1.textContent = (mpMyName || 'U')[0];
  if (av2) av2.textContent = (mpPartnerName || 'P')[0];
}

// ─── INIT: read coupleId/role from parent's localStorage key ──
function mpReadLocalState() {
  try {
    const raw = localStorage.getItem('uwl_v5');
    if (raw) {
      const s = JSON.parse(raw);
      mpCoupleId = s.coupleId || null;
      mpRole = s.role || 'user1';
      mpMyName = s.myName || 'You';
      mpPartnerName = s.partnerName || 'Partner';
    }
  } catch (e) {}
}

// ─── TAB SWITCHING ──────────────────────────────────────
function mpSwitchTab(tab, el) {
  document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.mp-sec').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('mp-sec-' + tab).classList.add('active');
  if (tab === 'saved') mpRenderSavedList();
  if (tab === 'result' && mpMap) setTimeout(() => mpMap.invalidateSize(), 80);
}

// ─── LOCATION SEARCH (Nominatim) — mirrors globe.html's searchLocation ──
function mpSearchLoc(which, q) {
  clearTimeout(mpLocSearchTimer[which]);
  const resEl = document.getElementById('mpLocResults' + which);
  if (!q || q.length < 3) { resEl.classList.remove('show'); return; }
  mpLocSearchTimer[which] = setTimeout(async () => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`, {
        headers: { 'Accept-Language': 'en' }
      });
      const data = await r.json();
      if (!data.length) {
        resEl.innerHTML = '<div class="mp-loc-result-item" style="cursor:default;color:var(--text3)">No results found</div>';
        resEl.classList.add('show');
        return;
      }
      resEl.innerHTML = data.map(d => {
        const city = d.address?.city || d.address?.town || d.address?.village || d.address?.county || d.name || q;
        const country = d.address?.country || '';
        const state = d.address?.state || '';
        const label = d.display_name.split(',').slice(0, 2).join(',');
        return `<div class="mp-loc-result-item" onclick="mpSelectLoc(${which},'${mpEsc(label)}',${d.lat},${d.lon},'${mpEsc(city)}','${mpEsc(state)}','${mpEsc(country)}')">
          <div class="nm">${mpEsc(city)}</div>
          <div class="sb">${mpEsc(state ? state + ', ' : '')}${mpEsc(country)}</div>
        </div>`;
      }).join('');
      resEl.classList.add('show');
    } catch (e) { console.warn('Nominatim search:', e); }
  }, 400);
}

function mpSelectLoc(which, label, lat, lng, city, state, country) {
  const loc = { label, lat: parseFloat(lat), lng: parseFloat(lng), city, state, country };
  if (which === 1) mpLoc1 = loc; else mpLoc2 = loc;
  document.getElementById('mpLoc' + which + 'Input').value = label;
  document.getElementById('mpLocResults' + which).classList.remove('show');
  mpUpdateFindBtnState();
}

function mpUseGeo(which) {
  if (!navigator.geolocation) { mpToast('Geolocation not supported on this device'); return; }
  mpToast('Getting your location... 📡');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, {
        headers: { 'Accept-Language': 'en' }
      });
      const d = await r.json();
      const city = d.address?.city || d.address?.town || d.address?.village || d.address?.county || 'Current Location';
      const state = d.address?.state || '';
      const country = d.address?.country || '';
      const label = city + (state ? ', ' + state : '') + (country ? ', ' + country : '');
      mpSelectLoc(which, label, lat, lng, city, state, country);
      mpToast('📍 Location set!');
    } catch (e) {
      mpSelectLoc(which, 'Current Location', lat, lng, 'Current Location', '', '');
      mpToast('📍 Location set (reverse-geocode unavailable)');
    }
  }, () => mpToast('Location permission denied'), { enableHighAccuracy: true, timeout: 10000 });
}

function mpUpdateFindBtnState() {
  const btn = document.getElementById('mpFindBtn');
  if (btn) btn.disabled = !(mpLoc1 && mpLoc2);
}

document.addEventListener('click', e => {
  if (!e.target.closest('.mp-loc-field')) {
    document.querySelectorAll('.mp-loc-results').forEach(r => r.classList.remove('show'));
  }
});

// ─── HAVERSINE DISTANCE (km) ────────────────────────────
function mpHaversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ─── FIND MIDPOINT (main flow) ──────────────────────────
async function mpFindMidpoint() {
  if (!mpLoc1 || !mpLoc2) { mpToast('Pick both locations first'); return; }
  const btn = document.getElementById('mpFindBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="mp-spinner"></span> Finding midpoint...';

  // Geographic midpoint (simple average — good enough for same-region trips;
  // for very long distances this is an approximation, which is expected for a free-API tool)
  const midLat = (mpLoc1.lat + mpLoc2.lat) / 2;
  const midLng = (mpLoc1.lng + mpLoc2.lng) / 2;

  mpMidpoint = { lat: midLat, lng: midLng, city: '', state: '', country: '' };

  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${midLat}&lon=${midLng}&format=json&addressdetails=1`, {
      headers: { 'Accept-Language': 'en' }
    });
    const d = await r.json();
    mpMidpoint.city = d.address?.city || d.address?.town || d.address?.village || d.address?.county || 'Midpoint';
    mpMidpoint.state = d.address?.state || '';
    mpMidpoint.country = d.address?.country || '';
    mpMidpoint.displayName = d.display_name || '';
  } catch (e) {
    mpMidpoint.city = 'Midpoint';
    mpMidpoint.displayName = '';
  }

  // Reset cached route/poi/weather data for fresh search
  mpRouteData = {};
  mpPoiCache = {};

  mpRenderMidpointResult();
  await mpFetchAllTravelModes();
  await mpFetchWeather();
  await mpFetchPois(mpPoiCat);
  mpRenderChecklistCard();
  mpRenderCountdownCard();

  document.getElementById('mpSaveBtn').style.display = 'block';

  btn.disabled = false;
  btn.innerHTML = '💕 Find Our Midpoint';

  // Jump to result tab
  mpSwitchTab('result', document.querySelector('.mp-tab[data-tab="result"]'));
  mpToast('Found your midpoint! 💕');
}

function mpRenderMidpointResult() {
  document.getElementById('mpMidpointCard').style.display = 'block';
  document.getElementById('mpTravelCard').style.display = 'block';
  document.getElementById('mpWeatherCard').style.display = 'block';
  document.getElementById('mpPoiCard').style.display = 'block';
  document.getElementById('mpChecklistCard').style.display = 'block';

  const sub = [mpMidpoint.city, mpMidpoint.state, mpMidpoint.country].filter(Boolean).join(', ');
  document.getElementById('mpMidpointSub').textContent = sub ? '· ' + sub : '';

  const distYou = mpHaversine(mpLoc1, mpMidpoint);
  const distPt = mpHaversine(mpLoc2, mpMidpoint);
  const distTotal = mpHaversine(mpLoc1, mpLoc2);

  document.getElementById('mpDistVal').textContent = distTotal < 1 ? Math.round(distTotal * 1000) + ' m' : distTotal.toFixed(1) + ' km';
  document.getElementById('mpYouDist').textContent = distYou < 1 ? Math.round(distYou * 1000) + ' m' : distYou.toFixed(1) + ' km';
  document.getElementById('mpPtDist').textContent = distPt < 1 ? Math.round(distPt * 1000) + ' m' : distPt.toFixed(1) + ' km';

  mpRenderMap();
  mpRenderModeRow();
}

// ─── MAP (Leaflet, matches index.html / globe.html style) ───
function mpRenderMap() {
  const mapDiv = document.getElementById('mpMapView');
  if (!mapDiv) return;
  if (!mpMap && window.L) {
    mpMap = L.map('mpMapView', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mpMap);
  }
  if (!mpMap) return;

  mpMapMarkers.forEach(m => mpMap.removeLayer(m));
  mpMapMarkers = [];

  const icon1 = L.divIcon({ html: `<div style="background:var(--accent);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)">${mpEsc((mpMyName||'U')[0])}</div>`, className: '', iconSize: [28, 28] });
  const icon2 = L.divIcon({ html: `<div style="background:var(--accent2);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)">${mpEsc((mpPartnerName||'P')[0])}</div>`, className: '', iconSize: [28, 28] });
  const iconMid = L.divIcon({ html: `<div style="background:linear-gradient(135deg,var(--accent),var(--accent2));width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #fff;box-shadow:0 0 0 5px rgba(255,255,255,0.15),0 4px 14px rgba(0,0,0,0.4)">❤️</div>`, className: '', iconSize: [38, 38] });

  const m1 = L.marker([mpLoc1.lat, mpLoc1.lng], { icon: icon1 }).addTo(mpMap);
  const m2 = L.marker([mpLoc2.lat, mpLoc2.lng], { icon: icon2 }).addTo(mpMap);
  const m3 = L.marker([mpMidpoint.lat, mpMidpoint.lng], { icon: iconMid }).addTo(mpMap);
  mpMapMarkers.push(m1, m2, m3);

  const line = L.polyline([[mpLoc1.lat, mpLoc1.lng], [mpMidpoint.lat, mpMidpoint.lng], [mpLoc2.lat, mpLoc2.lng]], {
    color: 'var(--accent)', weight: 2, opacity: 0.55, dashArray: '6,8'
  }).addTo(mpMap);
  mpMapMarkers.push(line);

  mpMap.fitBounds([[mpLoc1.lat, mpLoc1.lng], [mpLoc2.lat, mpLoc2.lng], [mpMidpoint.lat, mpMidpoint.lng]], { padding: [40, 40] });
  setTimeout(() => mpMap.invalidateSize(), 100);
}

// ─── TRAVEL MODES (OSRM where possible, estimate otherwise) ──
function mpRenderModeRow() {
  const row = document.getElementById('mpModeRow');
  row.innerHTML = MP_TRAVEL_MODES.map(m => `
    <div class="mp-mode-pill${m.id === mpTravelMode ? ' active' : ''}" data-mode="${m.id}" onclick="mpSelectMode('${m.id}')">
      <span class="ico">${m.ico}</span>
      <span class="lbl">${m.label}</span>
      <span class="eta" id="mpEta-${m.id}">…</span>
    </div>
  `).join('');
  mpUpdateModeDisplay();
}

async function mpFetchAllTravelModes() {
  // Try OSRM for car/bike/walk (free public OSRM demo server)
  const osrmModes = MP_TRAVEL_MODES.filter(m => m.osrmProfile);
  for (const m of osrmModes) {
    try {
      const url = `https://router.project-osrm.org/route/v1/${m.osrmProfile}/${mpLoc1.lng},${mpLoc1.lat};${mpLoc2.lng},${mpLoc2.lat}?overview=false`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.routes && d.routes[0]) {
        mpRouteData[m.id] = {
          distanceKm: d.routes[0].distance / 1000,
          durationMin: d.routes[0].duration / 60,
          source: 'osrm'
        };
      } else {
        mpEstimateMode(m);
      }
    } catch (e) {
      mpEstimateMode(m);
    }
    const etaEl = document.getElementById('mpEta-' + m.id);
    if (etaEl && mpRouteData[m.id]) etaEl.textContent = mpFmtDuration(mpRouteData[m.id].durationMin);
  }
  // Estimate-only modes (bus uses driving distance, train/flight use straight-line)
  MP_TRAVEL_MODES.filter(m => !m.osrmProfile).forEach(m => {
    mpEstimateMode(m);
    const etaEl = document.getElementById('mpEta-' + m.id);
    if (etaEl) etaEl.textContent = mpFmtDuration(mpRouteData[m.id].durationMin);
  });
  // Bus: reuse car distance/duration but slower average speed
  if (mpRouteData.car) {
    mpRouteData.bus = {
      distanceKm: mpRouteData.car.distanceKm,
      durationMin: (mpRouteData.car.distanceKm / 35) * 60,
      source: 'estimate'
    };
    const etaEl = document.getElementById('mpEta-bus');
    if (etaEl) etaEl.textContent = mpFmtDuration(mpRouteData.bus.durationMin);
  }
  mpUpdateModeDisplay();
}

function mpEstimateMode(m) {
  const straightKm = mpHaversine(mpLoc1, mpLoc2);
  // Flight/train get a small routing-inefficiency multiplier vs straight-line
  const distanceKm = m.id === 'flight' ? straightKm * 1.05 : straightKm * 1.15;
  mpRouteData[m.id] = {
    distanceKm,
    durationMin: (distanceKm / m.speedKmh) * 60 + (m.id === 'flight' ? 90 : 0), // +90min flight overhead (airport time)
    source: 'estimate'
  };
}

function mpFmtDuration(min) {
  if (min == null || isNaN(min)) return '—';
  if (min < 60) return Math.round(min) + ' min';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
}

function mpSelectMode(modeId) {
  mpTravelMode = modeId;
  document.querySelectorAll('.mp-mode-pill').forEach(p => p.classList.toggle('active', p.dataset.mode === modeId));
  mpUpdateModeDisplay();
}

function mpUpdateModeDisplay() {
  const rd = mpRouteData[mpTravelMode];
  document.getElementById('mpEtaVal').textContent = rd ? mpFmtDuration(rd.durationMin) : '—';
  document.getElementById('mpDistVal2').textContent = rd ? (rd.distanceKm < 1 ? Math.round(rd.distanceKm * 1000) + ' m' : rd.distanceKm.toFixed(1) + ' km') : '—';
}

// ─── WEATHER (Open-Meteo) ───────────────────────────────
async function mpFetchWeather() {
  const grid = document.getElementById('mpWeatherGrid');
  grid.innerHTML = Array.from({ length: 5 }).map(() => '<div class="mp-weather-card"><div class="mp-skel" style="height:40px"></div></div>').join('');
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${mpMidpoint.lat}&longitude=${mpMidpoint.lng}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,windspeed_10m_max&timezone=auto`;
    const r = await fetch(url);
    const d = await r.json();
    const cw = d.current_weather || {};
    const daily = d.daily || {};
    const wcodeMap = { 0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫', 51: '🌦', 61: '🌧', 63: '🌧', 65: '🌧', 71: '🌨', 73: '🌨', 75: '❄️', 80: '🌦', 95: '⛈' };
    const wico = wcodeMap[cw.weathercode] ?? '🌤';

    grid.innerHTML = `
      <div class="mp-weather-card"><div class="mp-weather-ico">${wico}</div><div class="mp-weather-v">${Math.round(cw.temperature ?? 0)}°C</div><div class="mp-weather-l">Now</div></div>
      <div class="mp-weather-card"><div class="mp-weather-ico">🌡</div><div class="mp-weather-v">${Math.round(daily.temperature_2m_max?.[0] ?? 0)}° / ${Math.round(daily.temperature_2m_min?.[0] ?? 0)}°</div><div class="mp-weather-l">High / Low</div></div>
      <div class="mp-weather-card"><div class="mp-weather-ico">🌧</div><div class="mp-weather-v">${daily.precipitation_probability_max?.[0] ?? 0}%</div><div class="mp-weather-l">Rain Chance</div></div>
      <div class="mp-weather-card"><div class="mp-weather-ico">💨</div><div class="mp-weather-v">${Math.round(daily.windspeed_10m_max?.[0] ?? cw.windspeed ?? 0)} km/h</div><div class="mp-weather-l">Wind</div></div>
      <div class="mp-weather-card"><div class="mp-weather-ico">🌅</div><div class="mp-weather-v">${mpFmtTime(daily.sunrise?.[0])}</div><div class="mp-weather-l">Sunrise</div></div>
      <div class="mp-weather-card"><div class="mp-weather-ico">🌇</div><div class="mp-weather-v">${mpFmtTime(daily.sunset?.[0])}</div><div class="mp-weather-l">Sunset</div></div>
    `;
    mpMidpoint.weatherSummary = `${wico} ${Math.round(cw.temperature ?? 0)}°C`;
  } catch (e) {
    grid.innerHTML = '<div class="mp-empty" style="grid-column:1/-1;padding:20px"><div class="mp-empty-ico">🌤</div><div class="mp-empty-text">Weather unavailable right now</div></div>';
  }
}
function mpFmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; }
}

// ─── NEARBY PLACES (Overpass API) ───────────────────────
function mpSetPoiCat(cat, el) {
  mpPoiCat = cat;
  document.querySelectorAll('.mp-poi-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
  mpFetchPois(cat);
}

async function mpFetchPois(cat) {
  const listEl = document.getElementById('mpPoiList');
  if (mpPoiCache[cat]) { mpRenderPoiList(mpPoiCache[cat]); return; }
  listEl.innerHTML = Array.from({ length: 4 }).map(() => '<div class="mp-poi-item"><div class="mp-skel" style="width:36px;height:36px;border-radius:10px;flex-shrink:0"></div><div style="flex:1"><div class="mp-skel" style="width:70%;margin-bottom:5px"></div><div class="mp-skel" style="width:40%;height:10px"></div></div></div>').join('');

  const filter = MP_POI_CATS[cat].overpass;
  const radius = 4000; // 4km around midpoint
  const query = `[out:json][timeout:15];(node${filter}(around:${radius},${mpMidpoint.lat},${mpMidpoint.lng});way${filter}(around:${radius},${mpMidpoint.lat},${mpMidpoint.lng}););out center 25;`;

  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    });
    const d = await r.json();
    const items = (d.elements || []).map(el => {
      const lat = el.lat || el.center?.lat;
      const lng = el.lon || el.center?.lon;
      if (!lat || !lng) return null;
      const dist = mpHaversine(mpMidpoint, { lat, lng });
      return {
        name: el.tags?.name || 'Unnamed ' + cat,
        lat, lng, dist,
        openingHours: el.tags?.opening_hours || null,
        cuisine: el.tags?.cuisine || null,
        website: el.tags?.website || null,
      };
    }).filter(Boolean).sort((a, b) => a.dist - b.dist).slice(0, 15);

    mpPoiCache[cat] = items;
    mpRenderPoiList(items);
  } catch (e) {
    listEl.innerHTML = '<div class="mp-empty" style="padding:20px"><div class="mp-empty-ico">📍</div><div class="mp-empty-text">Couldn\'t load nearby places — check your connection</div></div>';
  }
}

function mpRenderPoiList(items) {
  const listEl = document.getElementById('mpPoiList');
  if (!items.length) {
    listEl.innerHTML = '<div class="mp-empty" style="padding:24px"><div class="mp-empty-ico">📍</div><div class="mp-empty-text">No places found nearby in this category</div></div>';
    return;
  }
  const ico = MP_POI_CATS[mpPoiCat].ico;
  listEl.innerHTML = items.map(p => `
    <div class="mp-poi-item" onclick="mpFlyToPoi(${p.lat},${p.lng})">
      <div class="mp-poi-ico">${ico}</div>
      <div class="mp-poi-body">
        <div class="mp-poi-name">${mpEsc(p.name)}</div>
        <div class="mp-poi-meta">
          ${p.cuisine ? `<span>${mpEsc(p.cuisine)}</span>` : ''}
          ${p.openingHours ? `<span>🕒 ${mpEsc(p.openingHours.slice(0, 24))}</span>` : ''}
        </div>
      </div>
      <div class="mp-poi-dist">${p.dist < 1 ? Math.round(p.dist * 1000) + 'm' : p.dist.toFixed(1) + 'km'}</div>
    </div>
  `).join('');
}

function mpFlyToPoi(lat, lng) {
  if (!mpMap) return;
  mpMap.setView([lat, lng], 15);
  mpSwitchTab('result', document.querySelector('.mp-tab[data-tab="result"]'));
  setTimeout(() => mpMap.invalidateSize(), 80);
}

// ─── CHECKLIST ───────────────────────────────────────────
const MP_DEFAULT_CHECKLIST = ['Confirm time with partner', 'Check travel route', 'Book a table if needed', 'Charge your phone 🔋'];

function mpRenderChecklistCard() {
  if (!mpChecklist.length) {
    mpChecklist = MP_DEFAULT_CHECKLIST.map(t => ({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), text: t, done: false }));
  }
  mpRenderChecklistList();
}
function mpRenderChecklistList() {
  const el = document.getElementById('mpChecklistList');
  if (!mpChecklist.length) { el.innerHTML = '<div class="mp-empty" style="padding:14px"><div class="mp-empty-text">No checklist items yet</div></div>'; return; }
  el.innerHTML = mpChecklist.map(c => `
    <div class="mp-check-row">
      <div class="mp-cb${c.done ? ' done' : ''}" onclick="mpToggleCheck('${c.id}')">${c.done ? '✓' : ''}</div>
      <div class="mp-check-text${c.done ? ' done' : ''}">${mpEsc(c.text)}</div>
      <button class="mp-check-del" onclick="mpDelCheck('${c.id}')">✕</button>
    </div>
  `).join('');
}
function mpAddChecklistItem() {
  const inp = document.getElementById('mpChecklistInput');
  const v = inp.value.trim();
  if (!v) return;
  mpChecklist.push({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), text: v, done: false });
  inp.value = '';
  mpRenderChecklistList();
}
function mpToggleCheck(id) {
  const c = mpChecklist.find(x => x.id === id);
  if (c) c.done = !c.done;
  mpRenderChecklistList();
}
function mpDelCheck(id) {
  mpChecklist = mpChecklist.filter(x => x.id !== id);
  mpRenderChecklistList();
}

// ─── COUNTDOWN ───────────────────────────────────────────
function mpRenderCountdownCard() {
  const dateVal = document.getElementById('mpDate').value;
  const card = document.getElementById('mpCountdownCard');
  if (!dateVal) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  clearInterval(mpCountdownTimer);
  mpUpdateCountdown(dateVal);
  mpCountdownTimer = setInterval(() => mpUpdateCountdown(dateVal), 1000 * 30);
}
function mpUpdateCountdown(dateVal) {
  const target = new Date(dateVal + 'T00:00:00').getTime();
  const now = Date.now();
  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const row = document.getElementById('mpCountdownRow');
  if (!row) return;
  if (diff <= 0) {
    row.innerHTML = `<div class="mp-cd-box" style="min-width:180px"><div class="mp-cd-n">🎉</div><div class="mp-cd-l">It's today!</div></div>`;
    return;
  }
  row.innerHTML = `
    <div class="mp-cd-box"><div class="mp-cd-n">${days}</div><div class="mp-cd-l">Days</div></div>
    <div class="mp-cd-box"><div class="mp-cd-n">${hours}</div><div class="mp-cd-l">Hours</div></div>
    <div class="mp-cd-box"><div class="mp-cd-n">${mins}</div><div class="mp-cd-l">Mins</div></div>
  `;
}

// ─── API HELPER ─────────────────────────────────────────
async function mpApi(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(MP_API + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── SAVE PLAN ───────────────────────────────────────────
async function mpSavePlan() {
  if (!mpCoupleId) { mpToast('Please pair your account first'); return; }
  if (!mpMidpoint || !mpLoc1 || !mpLoc2) { mpToast('Find your midpoint first'); return; }

  const title = document.getElementById('mpTitle').value.trim() || 'Our Meetup';
  const meetDate = document.getElementById('mpDate').value || null;
  const budget = parseFloat(document.getElementById('mpBudget').value) || null;
  const rd = mpRouteData[mpTravelMode] || {};

  const planPayload = {
    title, meetDate, budget, currency: 'INR',
    loc1Label: mpLoc1.label, loc1Lat: mpLoc1.lat, loc1Lng: mpLoc1.lng,
    loc2Label: mpLoc2.label, loc2Lat: mpLoc2.lat, loc2Lng: mpLoc2.lng,
    midLat: mpMidpoint.lat, midLng: mpMidpoint.lng,
    midCity: mpMidpoint.city, midState: mpMidpoint.state, midCountry: mpMidpoint.country,
    travelMode: mpTravelMode, distanceKm: rd.distanceKm || null, durationMin: rd.durationMin || null,
    checklist: mpChecklist,
    notes: mpMidpoint.weatherSummary ? `Weather at midpoint: ${mpMidpoint.weatherSummary}` : '',
    createdBy: mpRole
  };

  try {
    const saved = await mpApi('POST', '/api/meetplanner', { coupleId: mpCoupleId, plan: planPayload });
    mpPlans.unshift(saved);
    mpSaveCache();
    mpToast('Meetup saved! 💌');
    mpSwitchTab('saved', document.querySelector('.mp-tab[data-tab="saved"]'));
  } catch (e) {
    // Offline fallback — keep locally, sync later
    const offlinePlan = { ...planPayload, id: 'local_' + Date.now(), status: 'planned', _offline: true };
    mpPlans.unshift(offlinePlan);
    mpSaveCache();
    mpToast('Saved offline — will sync when back online 📡');
    mpSwitchTab('saved', document.querySelector('.mp-tab[data-tab="saved"]'));
  }
}

// ─── LOAD PLANS ──────────────────────────────────────────
async function mpLoadPlans() {
  if (!mpCoupleId) { mpRenderSavedList(); return; }
  try {
    const data = await mpApi('GET', '/api/meetplanner/' + mpCoupleId);
    mpPlans = data;
    mpSaveCache();
    document.getElementById('mpOfflineBanner').classList.remove('show');
  } catch (e) {
    mpLoadCache();
    document.getElementById('mpOfflineBanner').classList.add('show');
  }
  mpRenderHero();
  mpRenderSavedList();
}

function mpRenderHero() {
  const total = mpPlans.length;
  const completed = mpPlans.filter(p => p.status === 'completed').length;
  const planned = mpPlans.filter(p => p.status === 'planned').length;
  const totalBudget = mpPlans.reduce((s, p) => s + (parseFloat(p.budget) || 0), 0);
  document.getElementById('mpHero').innerHTML = `
    <div class="mp-stat"><div class="mp-stat-n">${total}</div><div class="mp-stat-l">Total Meetups</div></div>
    <div class="mp-stat"><div class="mp-stat-n" style="color:var(--yellow)">${planned}</div><div class="mp-stat-l">Planned</div></div>
    <div class="mp-stat"><div class="mp-stat-n" style="color:var(--green)">${completed}</div><div class="mp-stat-l">Completed</div></div>
    <div class="mp-stat"><div class="mp-stat-n" style="color:var(--accent2)">₹${Math.round(totalBudget).toLocaleString('en-IN')}</div><div class="mp-stat-l">Total Budget</div></div>
  `;
}

function mpRenderSavedList() {
  const el = document.getElementById('mpSavedList');
  if (!mpPlans.length) {
    el.innerHTML = `<div class="mp-empty"><div class="mp-empty-ico">💌</div><div class="mp-empty-text">No meetups saved yet.<br>Plan your first one in the "Plan New" tab!</div></div>`;
    return;
  }
  const sorted = mpPlans.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  el.innerHTML = sorted.map(p => {
    const checklistDone = (p.checklist || []).filter(c => c.done).length;
    const checklistTotal = (p.checklist || []).length;
    return `
    <div class="mp-plan-card">
      <div class="mp-plan-top">
        <div class="mp-plan-title">📍 ${mpEsc(p.title)}</div>
        <div class="mp-plan-status ${p.status}">${p.status === 'completed' ? '✅ Done' : '⏳ Planned'}</div>
      </div>
      <div class="mp-plan-meta">
        ${p.meet_date ? `<span>📅 ${mpFmtDate(p.meet_date)}</span>` : ''}
        ${p.mid_city ? `<span>📍 ${mpEsc(p.mid_city)}</span>` : ''}
        ${p.budget ? `<span>💰 ₹${Number(p.budget).toLocaleString('en-IN')}</span>` : ''}
        ${checklistTotal ? `<span>✅ ${checklistDone}/${checklistTotal}</span>` : ''}
        ${p._offline ? `<span style="color:var(--yellow)">📡 Not synced yet</span>` : ''}
      </div>
      <div class="mp-plan-actions">
        ${p.status !== 'completed' ? `<button class="mp-btn mp-btn-accent mp-btn-sm" onclick="mpOpenCompleteModal('${p.id}')">🎉 Mark Complete</button>` : ''}
        <button class="mp-btn mp-btn-glass mp-btn-sm" onclick="mpOpenEditModal('${p.id}')">✏️ Edit</button>
        <button class="mp-btn mp-btn-danger mp-btn-sm" onclick="mpDeletePlan('${p.id}')">🗑️ Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ─── EDIT PLAN ───────────────────────────────────────────
function mpOpenEditModal(id) {
  const p = mpPlans.find(x => x.id === id);
  if (!p) return;
  document.getElementById('mpEditTitle').value = p.title || '';
  document.getElementById('mpEditDate').value = p.meet_date || '';
  document.getElementById('mpEditBudget').value = p.budget || '';
  document.getElementById('mpEditNotes').value = p.notes || '';
  document.getElementById('mpEditPlanId').value = id;
  document.getElementById('mpEditModal').classList.add('open');
}
async function mpSaveEdit() {
  const id = document.getElementById('mpEditPlanId').value;
  const updates = {
    title: document.getElementById('mpEditTitle').value.trim() || 'Our Meetup',
    meetDate: document.getElementById('mpEditDate').value || null,
    budget: parseFloat(document.getElementById('mpEditBudget').value) || null,
    notes: document.getElementById('mpEditNotes').value.trim()
  };
  try {
    const updated = await mpApi('PATCH', '/api/meetplanner/' + id, { coupleId: mpCoupleId, plan: updates });
    const idx = mpPlans.findIndex(x => x.id === id);
    if (idx > -1) mpPlans[idx] = updated;
    mpSaveCache();
    mpCloseModal('mpEditModal');
    mpRenderSavedList();
    mpRenderHero();
    mpToast('Meetup updated! 💕');
  } catch (e) {
    mpToast('Could not update — check your connection');
  }
}

// ─── DELETE PLAN ─────────────────────────────────────────
async function mpDeletePlan(id) {
  if (!confirm('Delete this meetup plan?')) return;
  try {
    await mpApi('DELETE', '/api/meetplanner/' + id, { coupleId: mpCoupleId });
  } catch (e) {}
  mpPlans = mpPlans.filter(x => x.id !== id);
  mpSaveCache();
  mpRenderSavedList();
  mpRenderHero();
  mpToast('Meetup removed');
}

// ─── COMPLETE → MEMORY GLOBE ─────────────────────────────
function mpOpenCompleteModal(id) {
  document.getElementById('mpCompletePlanId').value = id;
  document.getElementById('mpCompleteMood').value = '';
  document.getElementById('mpCompleteNotes').value = '';
  mpCompletePhotos = [];
  mpRenderCompletePhotoThumbs();
  document.getElementById('mpCompleteMoodPicker').innerHTML = MP_MOODS.map(m =>
    `<div class="mp-mood-opt" onclick="mpSelectCompleteMood(this,'${m}')">${m}</div>`
  ).join('');
  document.getElementById('mpCompleteModal').classList.add('open');
}
function mpSelectCompleteMood(el, mood) {
  document.querySelectorAll('#mpCompleteMoodPicker .mp-mood-opt').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
  document.getElementById('mpCompleteMood').value = mood;
}
function mpLoadCompletePhotos(input) {
  Array.from(input.files).forEach(f => {
    const r = new FileReader();
    r.onload = e => { mpCompletePhotos.push(e.target.result); mpRenderCompletePhotoThumbs(); };
    r.readAsDataURL(f);
  });
}
function mpRenderCompletePhotoThumbs() {
  document.getElementById('mpCompletePhotoThumbs').innerHTML = mpCompletePhotos.map((p, i) => `
    <div class="mp-photo-thumb"><img src="${p}"><button onclick="mpCompletePhotos.splice(${i},1);mpRenderCompletePhotoThumbs()">✕</button></div>
  `).join('');
}

async function mpConfirmComplete() {
  const id = document.getElementById('mpCompletePlanId').value;
  const mood = document.getElementById('mpCompleteMood').value;
  const extraNotes = document.getElementById('mpCompleteNotes').value.trim();

  if (!mpCoupleId) { mpToast('Please pair your account first'); return; }

  try {
    const result = await mpApi('POST', `/api/meetplanner/${id}/complete`, {
      coupleId: mpCoupleId, mood, photos: mpCompletePhotos, extraNotes
    });
    mpCloseModal('mpCompleteModal');
    const idx = mpPlans.findIndex(x => x.id === id);
    if (idx > -1) mpPlans[idx] = result.plan;
    mpSaveCache();
    mpRenderSavedList();
    mpRenderHero();
    if (result.alreadySynced) {
      mpToast('Already saved to Memory Globe 🌍');
    } else {
      mpToast('Meetup complete! Added to Memory Globe 🌍💕');
      mpSpawnHearts();
    }
  } catch (e) {
    mpToast('Could not complete — check your connection: ' + e.message);
  }
}

function mpSpawnHearts() {
  for (let i = 0; i < 10; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      p.style.cssText = `position:fixed;pointer-events:none;z-index:9999;font-size:${18 + Math.random() * 18}px;left:${20 + Math.random() * 60}vw;bottom:${30 + Math.random() * 20}px;animation:mpRiseUp ${1.5 + Math.random() * 1.5}s cubic-bezier(0.16,1,0.3,1) forwards;--rot:${Math.random() > 0.5 ? '360deg' : '-360deg'}`;
      p.textContent = ['❤️', '💕', '🌍', '✨', '💫'][Math.floor(Math.random() * 5)];
      if (!document.getElementById('mpRiseUpStyle')) {
        const s = document.createElement('style');
        s.id = 'mpRiseUpStyle';
        s.textContent = `@keyframes mpRiseUp{0%{transform:translateY(0) rotate(0) scale(1);opacity:1}100%{transform:translateY(-80vh) rotate(var(--rot)) scale(0.3);opacity:0}}`;
        document.head.appendChild(s);
      }
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 3500);
    }, i * 120);
  }
}

// ─── MODAL HELPERS ───────────────────────────────────────
function mpCloseModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.mp-modal-bg').forEach(bg => {
    bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); });
  });
});

// ─── DATE FIELD WIRES COUNTDOWN LIVE ─────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('mpDate');
  if (dateInput) {
    dateInput.addEventListener('change', () => { if (mpMidpoint) mpRenderCountdownCard(); });
  }
});

// ─── ONLINE/OFFLINE DETECTION ────────────────────────────
window.addEventListener('online', () => {
  document.getElementById('mpOfflineBanner').classList.remove('show');
  mpSyncOfflinePlans();
});
window.addEventListener('offline', () => {
  document.getElementById('mpOfflineBanner').classList.add('show');
});

async function mpSyncOfflinePlans() {
  const offline = mpPlans.filter(p => p._offline);
  if (!offline.length || !mpCoupleId) return;
  for (const p of offline) {
    try {
      const { _offline, id, status, ...payload } = p;
      const saved = await mpApi('POST', '/api/meetplanner', { coupleId: mpCoupleId, plan: payload });
      const idx = mpPlans.findIndex(x => x.id === id);
      if (idx > -1) mpPlans[idx] = saved;
    } catch (e) { /* still offline or server issue, leave as-is */ }
  }
  mpSaveCache();
  mpRenderSavedList();
  mpRenderHero();
}

// ─── INIT ────────────────────────────────────────────────
async function mpInit() {
  mpReadLocalState();
  mpApplyNames();
  mpLoadCache();
  mpRenderHero();
  await mpLoadPlans();
  if (navigator.onLine === false) document.getElementById('mpOfflineBanner').classList.add('show');
}

mpInit();
