// ═══════════════════════════════════════════════════════
//  Live Location Routes — cheap, dedicated GPS sync
//  Mount in server.js:
//    app.use('/api/location', require('./routes/location'));
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const ONLINE_WINDOW_MS = 60 * 1000; // last ping within 60s = "online"

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

  return res.json({ ok: true });
});

// ── GET /api/location/:coupleId ─────────────────────────
// Returns both partners' last known location + computed online status.
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('live_locations')
    .select('*')
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
