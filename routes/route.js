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
    .select('lat,lng,accuracy,speed,created_at')
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

// ── POST /api/route/prune ────────────────────────────────────────
// Housekeeping — deletes route_points older than N days. Call this
// from a scheduled job (Supabase cron / external cron hitting this
// endpoint), NOT automatically on every request.
router.post('/prune', async (req, res) => {
  const days = Math.max(7, parseInt(req.body?.days, 10) || 30);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { error, count } = await supabase
    .from('route_points')
    .delete({ count: 'exact' })
    .lt('local_date', cutoff);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, deleted: count ?? null, cutoff });
});

module.exports = router;