// ═══════════════════════════════════════════════════════════════
//  Tracking Routes — Phase: Background Location Upgrade
//  Mount in server.js:
//    app.use('/api/tracking', require('./routes/tracking'));
//
//  This is ADDITIVE to routes/location.js and routes/route.js —
//  it does not change their behavior. It adds the pieces the
//  browser-only flow never had:
//    - batch ingest (native background service queues points while
//      offline, then flushes them all here at once on reconnect)
//    - known-place detection + reverse geocoding
//    - geofence enter/leave events
//    - a daily_statistics rollup cache
// ═══════════════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const STOP_RADIUS_M     = 60;   // matches routes/route.js's stop clustering radius
const STOP_MIN_MINUTES  = 5;
const GEOFENCE_DEFAULT_RADIUS_M = 120;

function haversineM(a, b) {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const { sendPushToPartner, sendFCMToPartner } = require('./auth');

const _spoofCooldownBatch = new Map();
const SPOOF_ALERT_COOLDOWN_MS = 20 * 60 * 1000;
async function _alertPossibleSpoofing(coupleId, role) {
  const key = coupleId + '|' + role;
  const last = _spoofCooldownBatch.get(key) || 0;
  if (Date.now() - last < SPOOF_ALERT_COOLDOWN_MS) return;
  _spoofCooldownBatch.set(key, Date.now());
  const payload = { title: '⚠️ Location Check', body: 'Their location looks like it may be coming from a mock/fake GPS source.', tag: 'safety-possible_spoofing' };
  await Promise.all([
    sendPushToPartner(coupleId, role, payload).catch(() => {}),
    sendFCMToPartner(coupleId, role, payload).catch(() => {})
  ]);
}

// ── POST /api/tracking/batch ─────────────────────────────────────
// The native Android foreground service calls this after it has been
// offline (no internet) and accumulated points locally. Each point
// goes through the exact same storage path as a normal live ping —
// live_locations gets the LAST point only (so partner sees "caught
// up" instantly), and every point in the batch is inserted into
// route_points (if the person has route history enabled) so no
// history is lost. Idempotent-ish: duplicate timestamps just insert
// twice into route_points, which is harmless for a polyline/report.
router.post('/batch', async (req, res) => {
  const { coupleId, role, points } = req.body;
  if (!coupleId || !role || !Array.isArray(points) || !points.length) {
    return res.status(400).json({ error: 'Missing coupleId/role/points[]' });
  }
  if (points.length > 2000) return res.status(400).json({ error: 'Batch too large — split into multiple calls' });

  // Route history opt-in — same gate as the live ping path.
  const { data: pref } = await supabase
    .from('route_history_prefs').select('enabled')
    .eq('couple_id', coupleId).eq('role', role).maybeSingle();
  const routeHistoryEnabled = !!pref?.enabled;

  if (routeHistoryEnabled) {
    const rows = points.map(p => ({
      couple_id: coupleId, role,
      lat: p.lat, lng: p.lng,
      accuracy: p.accuracy ?? null,
      speed: p.speed ?? null,
      heading: p.heading ?? null,
      altitude: p.altitude ?? null,
      battery_level: p.batteryLevel ?? null,
      activity_type: p.activityType || null,
      mock_location: !!p.mockLocation,
      local_date: p.localDate || new Date(p.ts || Date.now()).toISOString().slice(0, 10),
      source: 'offline_sync',
      created_at: p.ts ? new Date(p.ts).toISOString() : undefined
    }));
    // Insert in chunks of 500 — Supabase/PostgREST payload limits.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('route_points').insert(rows.slice(i, i + 500));
      if (error) console.warn('batch route_points insert failed:', error.message);
    }
  }

  if (points.some(p => p.mockLocation)) _alertPossibleSpoofing(coupleId, role).catch(() => {});

  // Update live_locations with the most recent point so the partner's
  // screen reflects reality immediately instead of waiting for the
  // next live ping.
  const last = points[points.length - 1];
  await supabase.from('live_locations').upsert({
    couple_id: coupleId, role,
    lat: last.lat, lng: last.lng,
    accuracy: last.accuracy ?? null, heading: last.heading ?? null, speed: last.speed ?? null,
    moving: !!last.moving, status: 'active',
    updated_at: new Date().toISOString()
  }, { onConflict: 'couple_id,role' });

  // Run place-visit + geofence detection across the recovered gap
  // (best-effort, doesn't block the response to the device).
  detectPlacesAndGeofences(coupleId, role, points).catch(e => console.warn('batch place detection failed:', e.message));

  return res.json({ ok: true, inserted: points.length });
});

// ── Reverse geocoding (Nominatim — no API key needed) ────────────
// Rate-limited to 1 req/sec per Nominatim's usage policy; only ever
// called when a NEW stop is detected (not per-ping), so volume stays
// low for a 2-person app.
let _lastGeocodeAt = 0;
async function reverseGeocode(lat, lng) {
  const wait = 1100 - (Date.now() - _lastGeocodeAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastGeocodeAt = Date.now();
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
      headers: { 'User-Agent': 'TwinHeartsApp/1.0 (couple location sharing)' }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const cat = classifyOsmPlace(d);
    const label = d.name || d.display_name?.split(',')[0] || null;
    return { label, category: cat };
  } catch (e) { return null; }
}

// Maps OSM's raw class/type tags onto the app's simple category set
// (item 6 — 🏠 Home, 🏫 College, 💼 Office, 🍴 Restaurant, 🛍 Mall,
// 🏥 Hospital, ⛽ Petrol Pump, 🏋 Gym, 🌳 Park). "Home" is never
// inferred from OSM (a residential address doesn't mean it's THIS
// couple's home) — it's only ever assigned by matching against a
// known_places row the person has manually confirmed as Home.
function classifyOsmPlace(d) {
  const t = (d.type || '') + ' ' + (d.category || '') + ' ' + (d.class || '');
  const amenity = (d.address?.amenity || '') + ' ' + t;
  if (/university|college|school/i.test(amenity)) return 'college';
  if (/office|company|coworking/i.test(amenity)) return 'office';
  if (/restaurant|cafe|fast_food|food_court/i.test(amenity)) return 'restaurant';
  if (/mall|department_store|supermarket|marketplace/i.test(amenity)) return 'mall';
  if (/hospital|clinic|pharmacy/i.test(amenity)) return 'hospital';
  if (/fuel|petrol|gas_station/i.test(amenity)) return 'fuel';
  if (/gym|fitness/i.test(amenity)) return 'gym';
  if (/park|garden|nature_reserve/i.test(amenity)) return 'park';
  return 'other';
}

// ── Core detection: given a fresh batch of points (or a live ping's
//    recent trail), find stops that just STARTED, stops that just
//    ENDED, and any known_place radius crossings (geofence events).
async function detectPlacesAndGeofences(coupleId, role, points) {
  if (!points.length) return;

  // 1) Known places for this person — used for geofence enter/leave.
  const { data: places } = await supabase.from('known_places').select('*').eq('couple_id', coupleId).eq('role', role);
  const knownPlaces = places || [];

  // Current geofence membership (which known_places the LAST point of
  // the previous batch was inside) is derived from the most recent
  // open place_visit rows — avoids needing separate session state.
  const { data: openVisits } = await supabase.from('place_visits').select('*').eq('couple_id', coupleId).eq('role', role).is('left_at', null);
  const openByPlace = new Map((openVisits || []).map(v => [v.known_place_id, v]));

  for (const kp of knownPlaces) {
    const last = points[points.length - 1];
    const dist = haversineM({ lat: kp.lat, lng: kp.lng }, { lat: last.lat, lng: last.lng });
    const inside = dist <= (kp.radius_m || GEOFENCE_DEFAULT_RADIUS_M);
    const wasOpen = openByPlace.has(kp.id);

    if (inside && !wasOpen) {
      // Entered
      await supabase.from('geofence_events').insert({
        couple_id: coupleId, role, known_place_id: kp.id, label: kp.label,
        event_type: 'enter', lat: last.lat, lng: last.lng
      });
      await supabase.from('place_visits').insert({
        couple_id: coupleId, role, known_place_id: kp.id, label: kp.label, category: kp.category,
        lat: last.lat, lng: last.lng, arrived_at: new Date().toISOString(),
        local_date: new Date().toISOString().slice(0, 10)
      });
      await supabase.from('known_places').update({ visit_count: (kp.visit_count || 0) + 1, updated_at: new Date().toISOString() }).eq('id', kp.id);
    } else if (!inside && wasOpen) {
      // Left
      const visit = openByPlace.get(kp.id);
      const leftAt = new Date();
      const arrivedAt = new Date(visit.arrived_at);
      await supabase.from('place_visits').update({
        left_at: leftAt.toISOString(),
        duration_min: Math.max(1, Math.round((leftAt - arrivedAt) / 60000))
      }).eq('id', visit.id);
      await supabase.from('geofence_events').insert({
        couple_id: coupleId, role, known_place_id: kp.id, label: kp.label,
        event_type: 'leave', lat: last.lat, lng: last.lng
      });
    }
  }

  // 2) New-place auto-detection: cluster this batch's points; any
  //    cluster held for STOP_MIN_MINUTES+ that ISN'T already inside a
  //    known_place gets reverse-geocoded and logged as an ad-hoc
  //    place_visit (unlabeled points still get a location + category
  //    even before the person "confirms" it as a known place).
  let cluster = [points[0]];
  const flush = async () => {
    if (cluster.length < 2) return;
    const start = new Date(cluster[0].ts || Date.now());
    const end = new Date(cluster[cluster.length - 1].ts || Date.now());
    const minutes = (end - start) / 60000;
    if (minutes < STOP_MIN_MINUTES) return;
    const centroid = cluster.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
    centroid.lat /= cluster.length; centroid.lng /= cluster.length;
    const nearKnown = knownPlaces.find(kp => haversineM(kp, centroid) <= (kp.radius_m || GEOFENCE_DEFAULT_RADIUS_M));
    if (nearKnown) return; // already handled by the geofence branch above
    const geo = await reverseGeocode(centroid.lat, centroid.lng);
    await supabase.from('place_visits').insert({
      couple_id: coupleId, role, label: geo?.label || null, category: geo?.category || 'other',
      lat: centroid.lat, lng: centroid.lng,
      arrived_at: start.toISOString(), left_at: end.toISOString(),
      duration_min: Math.round(minutes),
      local_date: start.toISOString().slice(0, 10)
    });
  };
  for (let i = 1; i < points.length; i++) {
    const centroid = cluster.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
    centroid.lat /= cluster.length; centroid.lng /= cluster.length;
    if (haversineM(centroid, points[i]) <= STOP_RADIUS_M) cluster.push(points[i]);
    else { await flush(); cluster = [points[i]]; }
  }
  await flush();
}

// ── GET /api/tracking/:coupleId/:role/geofence-events ────────────
// Recent enter/leave feed (item 12) — "Reached College", "Left Home".
router.get('/:coupleId/:role/geofence-events', async (req, res) => {
  const { data, error } = await supabase
    .from('geofence_events').select('*')
    .eq('couple_id', req.params.coupleId).eq('role', req.params.role)
    .order('occurred_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── GET/POST /api/tracking/:coupleId/:role/known-places ──────────
router.get('/:coupleId/:role/known-places', async (req, res) => {
  const { data, error } = await supabase.from('known_places').select('*')
    .eq('couple_id', req.params.coupleId).eq('role', req.params.role).order('visit_count', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});
router.post('/:coupleId/:role/known-places', async (req, res) => {
  const { label, category, lat, lng, radiusM } = req.body;
  if (!label || lat == null || lng == null) return res.status(400).json({ error: 'Missing label/lat/lng' });
  const { data, error } = await supabase.from('known_places').insert({
    couple_id: req.params.coupleId, role: req.params.role,
    label, category: category || 'other', lat, lng, radius_m: radiusM || GEOFENCE_DEFAULT_RADIUS_M
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── GET /api/tracking/:coupleId/:role/timeline/:date ─────────────
// Daily narrative timeline (item 2): every place_visit that day —
// known place or auto-detected/reverse-geocoded stop — in order,
// with arrival/departure time, duration, and category for the icon
// chain ("🏠 Left Home → 🎓 Arrived College → 🍴 Restaurant → 🏠 Home").
// Purely additive: reads place_visits, which detectPlacesAndGeofences()
// already populates on every live ping and batch sync — no new writes.
router.get('/:coupleId/:role/timeline/:date', async (req, res) => {
  const { coupleId, role, date } = req.params;
  const { data, error } = await supabase
    .from('place_visits')
    .select('id, label, category, known_place_id, lat, lng, arrived_at, left_at, duration_min')
    .eq('couple_id', coupleId).eq('role', role).eq('local_date', date)
    .order('arrived_at', { ascending: true })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  const visits = data || [];
  // Collapse back-to-back duplicates at the same known place (can happen
  // if a geofence briefly flickers in/out at the radius boundary).
  const collapsed = [];
  for (const v of visits) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.known_place_id && prev.known_place_id === v.known_place_id && !prev.left_at) continue;
    collapsed.push(v);
  }
  const events = collapsed.map(v => ({
    id: v.id,
    label: v.label || 'Unknown place',
    category: v.category || 'other',
    arrivedAt: v.arrived_at,
    leftAt: v.left_at,
    durationMin: v.duration_min ?? (v.left_at ? Math.round((new Date(v.left_at) - new Date(v.arrived_at)) / 60000) : null),
    ongoing: !v.left_at
  }));
  return res.json({ date, events });
});

// Cooldown per (coupleId, role, type) so a flapping condition (e.g. battery
// hovering right at the threshold) can't spam the partner's phone. In-memory
// is fine here — worst case after a server restart is one extra alert.
const _alertCooldowns = new Map(); // key: coupleId|role|type -> timestamp
const SAFETY_ALERT_COOLDOWN_MS = 20 * 60 * 1000; // 20 min per alert type

const SAFETY_ALERT_COPY = {
  battery_low:        { title: '🔋 Battery Low', body: name => `${name}'s phone battery is running low — location sharing may stop soon.` },
  gps_disabled:       { title: '📡 GPS Issue', body: name => `${name}'s device can't get a GPS fix right now.` },
  permission_revoked: { title: '🚫 Location Permission Off', body: name => `${name} turned off location permission — live sharing has stopped.` },
  internet_lost:      { title: '📶 Internet Lost', body: name => `${name} lost internet connection — location will resume once they're back online.` },
  long_stop:          { title: '⏱️ Unexpected Long Stop', body: name => `${name} has been stopped for a while during an active trip.` },
  possible_spoofing:  { title: '⚠️ Location Check', body: name => `${name}'s location looks like it may be coming from a mock/fake GPS source.` }
};

// ── POST /api/tracking/safety-alert ───────────────────────────────
// Body: { coupleId, role, type, senderName }. `role` is the person the
// alert is ABOUT (i.e. the sender describing their own device state);
// the notification always goes to the OTHER partner.
router.post('/safety-alert', async (req, res) => {
  const { coupleId, role, type, senderName } = req.body;
  if (!coupleId || !role || !SAFETY_ALERT_COPY[type]) {
    return res.status(400).json({ error: 'Missing/invalid coupleId/role/type' });
  }
  const key = `${coupleId}|${role}|${type}`;
  const last = _alertCooldowns.get(key) || 0;
  if (Date.now() - last < SAFETY_ALERT_COOLDOWN_MS) {
    return res.json({ ok: true, throttled: true });
  }
  _alertCooldowns.set(key, Date.now());

  const copy = SAFETY_ALERT_COPY[type];
  const payload = { title: copy.title, body: copy.body(senderName || 'Your partner'), tag: 'safety-' + type };
  await Promise.all([
    sendPushToPartner(coupleId, role, payload).catch(() => {}),
    sendFCMToPartner(coupleId, role, payload).catch(() => {})
  ]);
  return res.json({ ok: true });
});

// ── GET /api/tracking/:coupleId/:role/daily-report/:date ─────────
// Same computation routes/route.js already does per-day, exposed
// here with the cache table populated for fast 7d/30d history lists.
router.get('/:coupleId/:role/daily-report/:date', async (req, res) => {
  const { coupleId, role, date } = req.params;
  const { data: cached } = await supabase.from('daily_statistics').select('*')
    .eq('couple_id', coupleId).eq('role', role).eq('local_date', date).maybeSingle();
  if (cached) return res.json(cached);

  const { data: points, error } = await supabase.from('route_points')
    .select('lat,lng,speed,activity_type,created_at')
    .eq('couple_id', coupleId).eq('role', role).eq('local_date', date)
    .order('created_at', { ascending: true }).limit(5000);
  if (error) return res.status(500).json({ error: error.message });
  if (!points || points.length < 2) return res.json(null);

  let distanceKm = 0, walkingMin = 0, drivingMin = 0, stoppedMin = 0, maxKmh = 0;
  const speeds = [];
  for (let i = 1; i < points.length; i++) {
    const d = haversineM(points[i - 1], points[i]);
    distanceKm += d / 1000;
    const dtMin = (new Date(points[i].created_at) - new Date(points[i - 1].created_at)) / 60000;
    const kmh = points[i].speed != null ? points[i].speed * 3.6 : (dtMin > 0 ? (d / 1000) / (dtMin / 60) : 0);
    speeds.push(kmh);
    maxKmh = Math.max(maxKmh, kmh);
    if (kmh < 1) stoppedMin += dtMin;
    else if (kmh < 8) walkingMin += dtMin;
    else drivingMin += dtMin;
  }
  const avgKmh = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const row = {
    couple_id: coupleId, role, local_date: date,
    distance_km: Math.round(distanceKm * 100) / 100,
    duration_min: Math.round(walkingMin + drivingMin + stoppedMin),
    walking_min: Math.round(walkingMin), driving_min: Math.round(drivingMin), stopped_min: Math.round(stoppedMin),
    avg_speed_kmh: Math.round(avgKmh * 10) / 10, max_speed_kmh: Math.round(maxKmh * 10) / 10,
    stops_count: 0, // filled by routes/route.js's detectStops if the caller wants exact stop clustering
    first_lat: points[0].lat, first_lng: points[0].lng,
    last_lat: points[points.length - 1].lat, last_lng: points[points.length - 1].lng,
    updated_at: new Date().toISOString()
  };
  await supabase.from('daily_statistics').upsert(row, { onConflict: 'couple_id,role,local_date' });
  return res.json(row);
});

module.exports = router;
