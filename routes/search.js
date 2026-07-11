// ═══════════════════════════════════════════════════════
//  Search Routes — server-side proxy for Overpass API
//  Mount in server.js:
//    app.use('/api/search', require('./routes/search'));
//
//  WHY THIS EXISTS:
//  Public Overpass mirrors (overpass-api.de etc.) frequently reject
//  cross-origin POSTs from browser apps deployed on random domains
//  (CORS block / 406). Server-to-server requests don't hit browser
//  CORS at all, so we proxy through here instead of calling Overpass
//  directly from overpass-service.js.
//
//  BONUS: this is also the read-through cache layer — identical
//  category+area queries within CACHE_TTL are served from Supabase
//  instead of re-hitting Overpass, which is both faster and keeps
//  us well under public API rate limits.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — POIs don't move often

// Rounds lat/lng to ~1km grid so nearby repeat searches hit the same cache row
function cacheKeyFor(query) {
  return require('crypto').createHash('md5').update(query).digest('hex');
}

// ── POST /api/search/overpass ───────────────────────────
// Body: { query: "<raw Overpass QL string>" }
router.post('/overpass', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing "query" string in body' });
  }

  const key = cacheKeyFor(query);

  // 1. Try cache first
  try {
    const { data: cached } = await supabase
      .from('poi_cache')
      .select('result, updated_at')
      .eq('cache_key', key)
      .single();

    if (cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_TTL_MS) {
      return res.json({ ...cached.result, _cached: true });
    }
  } catch (e) {
    // Cache miss or table not present yet — fall through to live fetch
  }

  // 2. Live fetch, trying each mirror until one works
  let lastErr = null;
  for (const mirror of MIRRORS) {
    try {
      const r = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query
      });
      if (!r.ok) throw new Error(`${mirror} returned ${r.status}`);
      const json = await r.json();

      // 3. Best-effort cache write (never blocks the response)
      supabase.from('poi_cache').upsert({
        cache_key: key,
        result: json,
        updated_at: new Date().toISOString()
      }, { onConflict: 'cache_key' }).then(() => {}).catch(() => {});

      return res.json(json);
    } catch (e) {
      lastErr = e;
      // try next mirror
    }
  }

  console.error('[search/overpass] all mirrors failed:', lastErr?.message);
  res.status(502).json({ error: 'All Overpass mirrors failed', detail: lastErr?.message });
});

module.exports = router;
