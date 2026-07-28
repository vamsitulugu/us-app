// ═══════════════════════════════════════════════════════════════
//  Daily Route History Routes — Phase 2
//  Mount in server.js:
//    app.use('/api/route', require('./routes/route'));
//  Purely additive — reads/writes only the new route_points table.
// ═══════════════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const STOP_RADIUS_M    = 60;    // points within this radius count as "same place"
const STOP_MIN_MINUTES = 5;     // must linger this long to count as a stop

function haversineM(a, b) {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Simple clustering stop-detector: walk the points in order, group
// consecutive points that stay within STOP_RADIUS_M of the cluster's
// centroid; if the group spans >= STOP_MIN_MINUTES, it's a stop.
function detectStops(points) {
  const stops = [];
  if (!points.length) return stops;
  let cluster = [points[0]];

  function flush() {
    if (cluster.length < 2) return;
    const start = new Date(cluster[0].created_at);
    const end = new Date(cluster[cluster.length - 1].created_at);
    const minutes = (end - start) / 60000;
    if (minutes >= STOP_MIN_MINUTES) {
      const lat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length;
      const lng = cluster.reduce((s, p) => s + p.lng, 0) / cluster.length;
      stops.push({ lat, lng, arrivedAt: cluster[0].created_at, leftAt: cluster[cluster.length - 1].created_at, minutes: Math.round(minutes) });
    }
  }

  for (let i = 1; i < points.length; i++) {
    const centroid = cluster.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
    centroid.lat /= cluster.length; centroid.lng /= cluster.length;
    const d = haversineM(centroid, points[i]);
    if (d <= STOP_RADIUS_M) {
      cluster.push(points[i]);
    } else {
      flush();
      cluster = [points[i]];
    }
  }
  flush();
  return stops;
}

// ── GET /api/route/:coupleId/:role/dates ────────────────────────
// List of calendar dates that have route data (for the date picker).
router.get('/:coupleId/:role/dates', async (req, res) => {
  const { data, error } = await supabase
    .from('route_points')
    .select('local_date')
    .eq('couple_id', req.params.coupleId)
    .eq('role', req.params.role)
    .order('local_date', { ascending: false })
    .limit(2000);
  if (error) return res.status(500).json({ error: error.message });
  const dates = [...new Set((data || []).map(r => r.local_date))].slice(0, 60);
  return res.json({ dates });
});

// ── GET /api/route/:coupleId/:role/:date ─────────────────────────
// Points for one day + computed distance, duration, stop list.
router.get('/:coupleId/:role/:date', async (req, res) => {
  const { coupleId, role, date } = req.params;
  const { data, error } = await supabase
    .from('route_points')
    .select('lat,lng,accuracy,speed,heading,altitude,activity_type,created_at')
    .eq('couple_id', coupleId).eq('role', role).eq('local_date', date)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) return res.status(500).json({ error: error.message });

  const points = data || [];
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += haversineM(points[i - 1], points[i]);

  const durationSec = points.length >= 2
    ? (new Date(points[points.length - 1].created_at) - new Date(points[0].created_at)) / 1000
    : 0;

  const stops = detectStops(points);

  return res.json({
    date,
    points,
    stats: {
      distanceKm: +(distanceM / 1000).toFixed(2),
      durationMin: Math.round(durationSec / 60),
      pointCount: points.length
    },
    stops
  });
});

// ── GET /api/route/:coupleId/:role/settings ──────────────────────
// Route History toggle + retention preference for one person.
router.get('/:coupleId/:role/settings', async (req, res) => {
  const { coupleId, role } = req.params;
  const { data, error } = await supabase
    .from('route_history_prefs')
    .select('enabled, retention_days')
    .eq('couple_id', coupleId).eq('role', role)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    enabled: !!data?.enabled,
    retentionDays: data ? data.retention_days : null // null = forever (only meaningful once enabled)
  });
});

// ── POST /api/route/settings ──────────────────────────────────────
// Body: { coupleId, role, enabled, retentionDays }  retentionDays:
// 7 | 30 | null (forever). Each person controls only their own row —
// there is no way for one partner to turn on recording for the other.
router.post('/settings', async (req, res) => {
  const { coupleId, role, enabled, retentionDays } = req.body;
  if (!coupleId || !role || !['user1', 'user2'].includes(role) || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Missing/invalid coupleId/role/enabled' });
  }
  const retention = (retentionDays === 7 || retentionDays === 30) ? retentionDays : null;
  const { error } = await supabase
    .from('route_history_prefs')
    .upsert({ couple_id: coupleId, role, enabled, retention_days: retention, updated_at: new Date().toISOString() },
      { onConflict: 'couple_id,role' });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, enabled, retentionDays: retention });
});

// ── DELETE /api/route/:coupleId/:role/history ─────────────────────
// Self-serve wipe of one person's own recorded route history. Either
// partner can delete their own — never the other partner's — history.
router.delete('/:coupleId/:role/history', async (req, res) => {
  const { coupleId, role } = req.params;
  const { error, count } = await supabase
    .from('route_points')
    .delete({ count: 'exact' })
    .eq('couple_id', coupleId).eq('role', role);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, deleted: count ?? null });
});

// ── POST /api/route/prune ────────────────────────────────────────
// Housekeeping — deletes route_points past each person's own retention
// setting (7d / 30d). Rows with retention_days = null ("Forever") are
// never auto-deleted. Call this from a scheduled job (Supabase cron /
// external cron hitting this endpoint), NOT automatically per-request.
router.post('/prune', async (req, res) => {
  const { data: prefs, error: prefsErr } = await supabase
    .from('route_history_prefs')
    .select('couple_id, role, retention_days')
    .not('retention_days', 'is', null); // "Forever" rows are skipped entirely
  if (prefsErr) return res.status(500).json({ error: prefsErr.message });

  let totalDeleted = 0;
  for (const pref of (prefs || [])) {
    const days = Math.max(1, pref.retention_days);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const { error, count } = await supabase
      .from('route_points')
      .delete({ count: 'exact' })
      .eq('couple_id', pref.couple_id).eq('role', pref.role)
      .lt('local_date', cutoff);
    if (!error) totalDeleted += (count || 0);
  }
  return res.json({ ok: true, deleted: totalDeleted, prefsChecked: (prefs || []).length });
});

module.exports = router;