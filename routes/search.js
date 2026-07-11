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

// overpass-api.de began broadly rejecting requests with 406 in April 2026
// (a known, widespread anti-scraper measure, not specific to us) — kept
// last as a final fallback rather than removed entirely.
const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

const OVERPASS_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
  'User-Agent': 'US-CouplesApp/1.0 (search feature; contact via app)'
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — POIs don't move often
const MIRROR_TIMEOUT_MS = 9000; // fail a slow mirror fast, don't let it eat Render's gateway timeout

// Rounds lat/lng to ~1km grid so nearby repeat searches hit the same cache row
function cacheKeyFor(query) {
  return require('crypto').createHash('md5').update(query).digest('hex');
}

/** fetch() with a hard timeout — Overpass mirrors can hang instead of erroring. */
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

  // 2. Live fetch — race all mirrors in parallel (first success wins), each
  //    capped at MIRROR_TIMEOUT_MS. Running in parallel (not sequentially)
  //    keeps total wall-clock time bounded even if one mirror hangs.
  const attempts = MIRRORS.map(mirror =>
    fetchWithTimeout(mirror, {
      method: 'POST',
      headers: OVERPASS_HEADERS,
      body: 'data=' + encodeURIComponent(query)
    }, MIRROR_TIMEOUT_MS).then(async r => {
      if (!r.ok) throw new Error(`${mirror} returned ${r.status}`);
      return r.json();
    })
  );

  let json;
  try {
    json = await Promise.any(attempts);
  } catch (aggregateErr) {
    const lastErr = aggregateErr.errors?.[aggregateErr.errors.length - 1] || aggregateErr;
    console.error('[search/overpass] all mirrors failed:', lastErr?.message);
    return res.status(502).json({ error: 'All Overpass mirrors failed', detail: lastErr?.message });
  }

  // 3. Best-effort cache write (never blocks the response)
  supabase.from('poi_cache').upsert({
    cache_key: key,
    result: json,
    updated_at: new Date().toISOString()
  }, { onConflict: 'cache_key' }).then(() => {}).catch(() => {});

  res.json(json);
});

module.exports = router;

// ── GET /api/search/_diag ───────────────────────────────
// TEMPORARY diagnostic route — tests raw connectivity from this
// server to each Overpass mirror and reports timing/status for each.
// Delete this route once the mirror issue is resolved.
router.get('/_diag', async (req, res) => {
  const testQuery = '[out:json];node(1);out;';
  const results = await Promise.all(MIRRORS.map(async mirror => {
    const start = Date.now();
    try {
      const r = await fetchWithTimeout(mirror, {
        method: 'POST',
        headers: OVERPASS_HEADERS,
        body: 'data=' + encodeURIComponent(testQuery)
      }, 15000);
      return { mirror, status: r.status, ok: r.ok, ms: Date.now() - start };
    } catch (e) {
      return { mirror, error: e.name + ': ' + e.message, ms: Date.now() - start };
    }
  }));
  res.json({ results });
});