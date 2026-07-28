// ═══════════════════════════════════════════════════════
//  Live Location Routes — cheap, dedicated GPS sync
//  Mount in server.js:
//    app.use('/api/location', require('./routes/location'));
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const ONLINE_WINDOW_MS = 60 * 1000; // last ping within 60s = "online"
const ROUTE_DEDUPE_MIN_METERS = 8;   // skip storing a route point if it barely moved from the last stored one
const ROUTE_DEDUPE_MAX_AGE_MS = 5 * 60 * 1000; // still store a point if this much time passed, even if stationary

// ── Route history opt-in gate ────────────────────────────────────
// Route recording is OFF by default. A row only allows recording once
// the person has explicitly turned it on via POST /api/route/settings
// (see routes/route.js). Cached in memory for ~2 min per couple/role
// so a normal ~8-10s ping cadence doesn't cost a DB read every time;
// FAILS CLOSED — if the pref row is missing or the lookup errors, we
// do NOT record, since privacy-sensitive behavior should never fail
// open just because of a transient DB hiccup.
const _routePrefsCache = new Map(); // key -> { enabled, at }
const ROUTE_PREFS_CACHE_MS = 2 * 60 * 1000;
async function _isRouteHistoryEnabled(coupleId, role) {
  const key = coupleId + ':' + role;
  const cached = _routePrefsCache.get(key);
  if (cached && Date.now() - cached.at < ROUTE_PREFS_CACHE_MS) return cached.enabled;
  try {
    const { data, error } = await supabase
      .from('route_history_prefs')
      .select('enabled')
      .eq('couple_id', coupleId).eq('role', role)
      .maybeSingle();
    const enabled = !error && !!data?.enabled;
    _routePrefsCache.set(key, { enabled, at: Date.now() });
    return enabled;
  } catch (e) {
    _routePrefsCache.set(key, { enabled: false, at: Date.now() });
    return false;
  }
}

// ── Real-time sync fix ────────────────────────────────────────────
// The frontend (livemap.js) already subscribes to a Supabase Realtime
// broadcast channel `location:<coupleId>` / event `location_ping` and
// triggers an instant refresh when it fires — but nothing was ever
// actually sending that broadcast, so the partner's screen only ever
// updated on the 8s polling fallback. This uses Supabase's stateless
// Broadcast-over-HTTP endpoint (no server-side websocket to maintain)
// to actually push it. Best-effort/fire-and-forget: if it fails, the
// 8s poll still covers it, so a ping response is never blocked on this.
async function _broadcastLocationPing(coupleId) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ messages: [{ topic: `location:${coupleId}`, event: 'location_ping', payload: {} }] })
    });
  } catch (e) { /* fire-and-forget — polling fallback covers this */ }
}

function haversineM(a, b) {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// In-memory cache of the last stored route_point per couple/role, so we can
// skip inserting near-duplicate points (device stationary, GPS jitter) without
// an extra DB read on every ping. Best-effort only — resets on server restart,
// which just means we store one extra point after a redeploy. Fine.
const _lastRoutePoint = new Map(); // key: `${coupleId}:${role}` -> { lat, lng, at, date }
function _shouldStoreRoutePoint(coupleId, role, lat, lng, localDate) {
  const key = coupleId + ':' + role;
  const prev = _lastRoutePoint.get(key);
  const now = Date.now();
  if (!prev || prev.date !== localDate) { _lastRoutePoint.set(key, { lat, lng, at: now, date: localDate }); return true; }
  const movedM = haversineM(prev, { lat, lng });
  const ageMs = now - prev.at;
  if (movedM < ROUTE_DEDUPE_MIN_METERS && ageMs < ROUTE_DEDUPE_MAX_AGE_MS) return false;
  _lastRoutePoint.set(key, { lat, lng, at: now, date: localDate });
  return true;
}

// ── POST /api/location/ping ─────────────────────────────
// Called every ~8-10s (or on >15m movement) while the Live Map
// page is open, and via background geolocation.watchPosition.
// Tiny payload — does NOT touch app_state / chat / photos.
router.post('/ping', async (req, res) => {
  const { coupleId, role, lat, lng, accuracy, heading, speed, moving, emergency, vehicleType } = req.body;
  if (!coupleId || !role || lat == null || lng == null) {
    return res.status(400).json({ error: 'Missing coupleId/role/lat/lng' });
  }

  // Self-declared travel mode (walking/bike/car/bus). GPS speed alone can't
  // tell a car from a bus — that's assigned by booking in Uber/Intercity/ABHI
  // Bus, not inferred — so this comes from an explicit selector the person
  // sets themselves. Only written when provided, so it doesn't clobber the
  // last known value on pings that don't include it.
  const ALLOWED_VEHICLE_TYPES = ['walking', 'bike', 'car', 'bus'];
  const upsertRow = {
    couple_id: coupleId,
    role,
    lat, lng,
    accuracy: accuracy ?? null,
    heading:  heading ?? null,
    speed:    speed ?? null,
    moving:   !!moving,
    updated_at: new Date().toISOString(),
    status: 'active' // a normal ping always implies active sharing (pauses go through /status instead)
  };
  if (vehicleType && ALLOWED_VEHICLE_TYPES.includes(vehicleType)) {
    upsertRow.vehicle_type = vehicleType;
  }
  if (emergency) { upsertRow.emergency = true; upsertRow.emergency_at = new Date().toISOString(); }

  const { error } = await supabase.from('live_locations').upsert(upsertRow, { onConflict: 'couple_id,role' });

  if (error) return res.status(500).json({ error: error.message });

  // Push the instant partner-side refresh (fire-and-forget, doesn't
  // block this response) — see _broadcastLocationPing above for why.
  _broadcastLocationPing(coupleId);

  // Breadcrumb trail (best-effort, non-blocking for the response)
  supabase.from('live_location_history').insert({
    couple_id: coupleId, role, lat, lng
  }).then(() => {
    // Trim to last 60 points per couple/role, fire-and-forget
    supabase
      .from('live_location_history')
      .select('id')
      .eq('couple_id', coupleId).eq('role', role)
      .order('created_at', { ascending: false })
      .range(60, 200)
      .then(({ data }) => {
        if (data && data.length) {
          const ids = data.map(r => r.id);
          supabase.from('live_location_history').delete().in('id', ids).then(() => {});
        }
      });
  });

  // Phase 4 — daily route history (separate table, not trimmed to 60,
  // grouped by calendar day for the Daily Route feature). Best-effort,
  // never blocks or fails the ping response. Skips near-duplicate points
  // (stationary device / GPS jitter) to keep storage and reads lean.
  // PRIVACY: only recorded if this person has explicitly opted in via
  // the Route History toggle — see routes/route.js /settings.
  const localDate = req.body.localDate || new Date().toISOString().slice(0, 10);
  _isRouteHistoryEnabled(coupleId, role).then(enabled => {
    if (!enabled) return;
    if (_shouldStoreRoutePoint(coupleId, role, lat, lng, localDate)) {
      supabase.from('route_points').insert({
      couple_id: coupleId, role, lat, lng,
      accuracy: accuracy ?? null, speed: speed ?? null,
      heading: req.body.heading ?? null,
      battery_level: req.body.batteryLevel ?? null,
      activity_type: req.body.activityType || null,
      source: req.body.source || 'foreground',
      local_date: localDate
    }).then(() => {}).catch(() => {});
    }
  }).catch(() => {});

  return res.json({ ok: true });
});

// ── GET /api/location/:coupleId ─────────────────────────
// Returns both partners' last known location + computed online status.
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('live_locations')
    .select('role, lat, lng, accuracy, heading, speed, moving, updated_at, status, status_until, emergency, emergency_at, vehicle_type')
    .eq('couple_id', req.params.coupleId);

  if (error) return res.status(500).json({ error: error.message });

  const EMERGENCY_ALERT_WINDOW_MS = 10 * 60 * 1000; // show the 🚨 banner for 10 min after an emergency share
  const now = Date.now();
  const out = { user1: null, user2: null };
  (data || []).forEach(row => {
    const age = now - new Date(row.updated_at).getTime();
    const emergencyAge = row.emergency_at ? now - new Date(row.emergency_at).getTime() : Infinity;
    out[row.role] = {
      lat: row.lat, lng: row.lng,
      accuracy: row.accuracy, heading: row.heading, speed: row.speed,
      moving: row.moving,
      updatedAt: row.updated_at,
      online: age < ONLINE_WINDOW_MS,
      ageMs: age,
      status: row.status || 'active',
      statusUntil: row.status_until,
      emergency: !!row.emergency && emergencyAge < EMERGENCY_ALERT_WINDOW_MS,
      vehicleType: row.vehicle_type || 'walking'
    };
  });
  return res.json(out);
});

// ── POST /api/location/status ────────────────────────────
// Sets a partner-visible sharing status without needing a GPS fix —
// used by Pause 15m / Pause 1h / Pause manually / Resume. (Invisible
// Mode deliberately does NOT call this — it must stay undetectable,
// so the client just stops pinging instead.)
router.post('/status', async (req, res) => {
  const { coupleId, role, status, untilMinutes } = req.body;
  if (!coupleId || !role || !['active', 'paused'].includes(status)) {
    return res.status(400).json({ error: 'Missing/invalid coupleId/role/status' });
  }
  const statusUntil = (status === 'paused' && untilMinutes) ? new Date(Date.now() + untilMinutes * 60000).toISOString() : null;
  const { error } = await supabase.from('live_locations')
    .update({ status, status_until: statusUntil })
    .eq('couple_id', coupleId).eq('role', role);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// ── GET /api/location/:coupleId/trail/:role ─────────────
// Recent breadcrumb points for drawing a "path so far" line.
router.get('/:coupleId/trail/:role', async (req, res) => {
  const { data, error } = await supabase
    .from('live_location_history')
    .select('lat,lng,created_at')
    .eq('couple_id', req.params.coupleId)
    .eq('role', req.params.role)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).reverse());
});

// ── POST /api/location/stop ─────────────────────────────
// Explicitly mark a device offline (e.g. user toggled off sharing,
// or logged out) so the partner sees "offline" immediately instead
// of waiting for the 60s timeout.
router.post('/stop', async (req, res) => {
  const { coupleId, role } = req.body;
  if (!coupleId || !role) return res.status(400).json({ error: 'Missing data' });
  // Push updated_at far into the past so it reads as offline immediately,
  // and mark status paused (manual) for the partner-visible pause UI.
  await supabase.from('live_locations')
    .update({ updated_at: new Date(0).toISOString(), status: 'paused', status_until: null })
    .eq('couple_id', coupleId).eq('role', role);
  return res.json({ ok: true });
});

module.exports = router;