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
  const { coupleId, role, lat, lng, accuracy, heading, speed, moving } = req.body;
  if (!coupleId || !role || lat == null || lng == null) {
    return res.status(400).json({ error: 'Missing coupleId/role/lat/lng' });
  }

  const { error } = await supabase.from('live_locations').upsert({
    couple_id: coupleId,
    role,
    lat, lng,
    accuracy: accuracy ?? null,
    heading:  heading ?? null,
    speed:    speed ?? null,
    moving:   !!moving,
    updated_at: new Date().toISOString()
  }, { onConflict: 'couple_id,role' });

  if (error) return res.status(500).json({ error: error.message });

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

  // Phase 2 — daily route history (separate table, not trimmed to 60,
  // grouped by calendar day for the Daily Route feature). Best-effort,
  // never blocks or fails the ping response. Skips near-duplicate points
  // (stationary device / GPS jitter) to keep storage and reads lean.
  const localDate = req.body.localDate || new Date().toISOString().slice(0, 10);
  if (_shouldStoreRoutePoint(coupleId, role, lat, lng, localDate)) {
    supabase.from('route_points').insert({
      couple_id: coupleId, role, lat, lng,
      accuracy: accuracy ?? null, speed: speed ?? null,
      local_date: localDate
    }).then(() => {}).catch(() => {});
  }

  return res.json({ ok: true });
});

// ── GET /api/location/:coupleId ─────────────────────────
// Returns both partners' last known location + computed online status.
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('live_locations')
    .select('role, lat, lng, accuracy, heading, speed, moving, updated_at')
    .eq('couple_id', req.params.coupleId);

  if (error) return res.status(500).json({ error: error.message });

  const now = Date.now();
  const out = { user1: null, user2: null };
  (data || []).forEach(row => {
    const age = now - new Date(row.updated_at).getTime();
    out[row.role] = {
      lat: row.lat, lng: row.lng,
      accuracy: row.accuracy, heading: row.heading, speed: row.speed,
      moving: row.moving,
      updatedAt: row.updated_at,
      online: age < ONLINE_WINDOW_MS,
      ageMs: age
    };
  });
  return res.json(out);
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
  // Push updated_at far into the past so it reads as offline immediately.
  await supabase.from('live_locations')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('couple_id', coupleId).eq('role', role);
  return res.json({ ok: true });
});

module.exports = router;